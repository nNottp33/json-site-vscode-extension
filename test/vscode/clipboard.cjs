// Real VS Code (Electron) end-to-end check: Ctrl+C / Ctrl+X / Ctrl+V / Ctrl+Z inside the webview's Monaco editor.
// VS Code intercepts these keys in webviews and replays them as document.execCommand(), so a browser-only test cannot cover them.
// Windows only: it drives the system clipboard through PowerShell and Ctrl-based shortcuts, and it overwrites the clipboard.
const { chromium } = require('playwright');
const { spawn, execFileSync } = require('node:child_process');
const net = require('node:net');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
if (process.platform !== 'win32') { console.error('npm run test:clipboard only runs on Windows.'); process.exit(1); }
const root = path.resolve(__dirname, '../..');
const clipboard = {
  write: text => execFileSync('powershell', ['-NoProfile', '-Command', '[Console]::In.ReadToEnd() | Set-Clipboard'], { input: text }),
  read: () => execFileSync('powershell', ['-NoProfile', '-Command', 'Get-Clipboard -Raw'], { encoding: 'utf8' }).replace(/\r?\n$/, '')
};
const freePort = () => new Promise(resolve => { const s = net.createServer().listen(0, '127.0.0.1', () => { const { port } = s.address(); s.close(() => resolve(port)); }); });
(async () => {
  const userData = path.join(root, 'test-results/vscode-profile-clipboard');
  await fs.mkdir(path.join(userData, 'User'), { recursive: true });
  await fs.writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'security.workspace.trust.enabled': false }));
  await fs.rm(path.join(userData, 'User/globalStorage/nnottp33.json-workbench'), { recursive: true, force: true }); // no draft from a previous run
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.JSON_WORKBENCH_VSCODE || path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe');
  const port = await freePort();
  const child = spawn(executable, [`--remote-debugging-port=${port}`, '--user-data-dir=' + userData, '--extensions-dir=' + path.join(root, 'test-results/vscode-extensions'), '--extensionDevelopmentPath=' + root, '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust', '--disable-telemetry'], { env, windowsHide: true, stdio: 'ignore' });
  process.on('SIGINT', () => { child.kill(); process.exit(130); });
  const checks = [];
  let browser;
  let page;
  child.once('exit', code => { if (!browser) { console.error(`VS Code exited early with code ${code}.`); process.exit(1); } });
  try {
    for (let attempt = 0; ; attempt++) {
      try { browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`); break; }
      catch (error) { if (attempt > 60) throw error; await new Promise(r => setTimeout(r, 1000)); }
    }
    const started = Date.now();
    while (!page) {
      page = browser.contexts().flatMap(c => c.pages()).find(p => p.url().includes('workbench.html'));
      if (!page) { if (Date.now() - started > 60000) throw new Error('VS Code workbench window did not appear.'); await new Promise(r => setTimeout(r, 500)); }
    }
    await page.waitForSelector('.monaco-workbench', { timeout: 60000 });
    await page.waitForTimeout(3000);
    await page.keyboard.press('F1');
    await page.keyboard.type('JSON Workbench: Open');
    await page.waitForTimeout(500);
    await page.keyboard.press('Enter');
    const inner = page.frameLocator('iframe.webview.ready').frameLocator('#active-frame');
    const editor = inner.locator('#input-editor .view-lines');
    await editor.waitFor({ timeout: 60000 });
    await page.waitForTimeout(1500);
    const status = () => inner.locator('#input-status').innerText();
    const waitStatus = async (value, timeout = 8000) => { const start = Date.now(); while (Date.now() - start < timeout) { if ((await status()).includes(value)) return; await page.waitForTimeout(150); } throw new Error(`Expected input status to include "${value}", got "${await status()}"`); };
    const copyButton = async () => { clipboard.write('sentinel'); await inner.locator('#input-toolbar').getByRole('button', { name: 'Copy', exact: true }).click(); await page.waitForTimeout(500); return clipboard.read(); };
    const clear = async () => { await editor.click(); await page.keyboard.press('Control+A'); await page.keyboard.press('Delete'); await waitStatus('Paste JSON to begin'); };
    const text = '{"pasted":true,"n":1}';

    await clear();
    await page.keyboard.type('{}');
    await waitStatus('Valid JSON');
    await clear();
    checks.push('Typing reaches the focused editor');

    clipboard.write(text);
    await page.keyboard.press('Control+V');
    await waitStatus('Valid JSON');
    assert.equal(await copyButton(), text, 'Ctrl+V must insert exactly the clipboard text');
    checks.push('Ctrl+V pastes clipboard text into the editor');

    clipboard.write('sentinel');
    await editor.click();
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+C');
    await page.waitForTimeout(500);
    assert.equal(clipboard.read(), text, 'Ctrl+C must copy the editor selection');
    checks.push('Ctrl+C copies the editor selection');

    clipboard.write('sentinel');
    await page.keyboard.press('Control+A');
    await page.keyboard.press('Control+X');
    await waitStatus('Paste JSON to begin');
    assert.equal(clipboard.read(), text, 'Ctrl+X must copy the editor selection');
    checks.push('Ctrl+X cuts the editor selection');

    await page.keyboard.press('Control+Z');
    await waitStatus('Valid JSON');
    assert.equal(await copyButton(), text, 'Ctrl+Z must restore exactly the cut text');
    checks.push('Ctrl+Z restores the cut text');

    await clear();
    clipboard.write(Buffer.from('{"encoded":"base64"}').toString('base64'));
    await page.keyboard.press('Control+V');
    await waitStatus('Valid JSON');
    assert.match(await copyButton(), /"encoded": "base64"/, 'pasted base64 JSON must be decoded and formatted');
    checks.push('Pasting base64-encoded JSON decodes and formats it');

    await clear();
    const b64url = value => Buffer.from(JSON.stringify(value)).toString('base64url');
    clipboard.write(`${b64url({ alg: 'HS256', typ: 'JWT' })}.${b64url({ sub: '42', name: 'Ada' })}.sig-nature_x`);
    await page.keyboard.press('Control+V');
    await waitStatus('Valid JSON');
    const jwt = JSON.parse(await copyButton());
    assert.equal(jwt.header.alg, 'HS256'); assert.equal(jwt.payload.name, 'Ada'); assert.equal(jwt.signature, 'sig-nature_x');
    checks.push('Pasting a JWT decodes header and payload');

    await clear();
    clipboard.write('OK');
    await page.keyboard.press('Control+V');
    await waitStatus('Invalid JSON');
    assert.equal(await copyButton(), 'OK', 'plain words must not be rewritten as base64');
    checks.push('Pasting a plain word leaves it untouched');

    await fs.writeFile(path.join(root, 'test-results/vscode-clipboard-results.json'), JSON.stringify({ checks }, null, 2));
    console.log(JSON.stringify({ checks }, null, 2));
  } catch (error) {
    if (page) await page.screenshot({ path: path.join(root, 'test-results/clipboard-failure.png') }).catch(() => undefined);
    console.error(JSON.stringify({ checks }, null, 2));
    throw error;
  } finally { await browser?.close().catch(() => undefined); child.kill(); }
})().catch(error => { console.error(error); process.exit(1); });
