require('tsx/cjs');
const { markup } = require('../src/markup.ts');
const { chromium } = require('playwright');
const { Worker } = require('node:worker_threads');
const { createServer } = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const results = path.join(root, 'test-results');
const { encodeShare, decodeShare } = require('../src/host.ts');

(async () => {
  await fs.mkdir(results, { recursive: true });
  const server = createServer(async (req, res) => {
    try {
      if (req.url === '/favicon.ico') { res.writeHead(204).end(); return; }
      if (req.url === '/') {
        res.setHeader('Content-Type', 'text/html');
        res.end(markup({ csp: "'self'", nonce: 'uitest', app: '/app.js', css: '/styles.css', editorCss: '/app.css', worker: '/worker.js', editorWorker: '/editor.worker.js' }));
      } else {
        const name = path.basename(req.url.split('?')[0]);
        res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'application/octet-stream');
        res.end(await fs.readFile(path.join(root, 'dist', name)));
      }
    } catch { res.writeHead(404).end(); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const browser = await chromium.launch({ headless: true, ...(process.env.JSON_WORKBENCH_CHROME ? { executablePath: process.env.JSON_WORKBENCH_CHROME } : process.platform === 'win32' ? { channel: 'chrome' } : {}) });
  const page = await browser.newPage({ viewport: { width: 1500, height: 960 } });
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  let draft;
  let copied = '';
  let exported = '';
  let history = [];
  let typeCount = 0;
  let syncEnabled = false;
  let helpOpened = false;
  const syncStatus = () => ({ enabled: syncEnabled, prepared: syncEnabled ? history.length : 0, localOnly: 0, bytes: 0, message: syncEnabled ? 'Prepared for Settings Sync.' : 'History stays on this device.' });
  const post = data => page.evaluate(m => window.postMessage(m, '*'), data);
  await page.exposeFunction('__hostMessage', async m => {
    const respond = (result, error) => post({ type: 'response', id: m.id, ok: !error, result, error });
    if (m.type === 'ready') { if (draft) await post({ type: 'restore', draft }); await post({ type: 'history', entries: history }); await post({ type: 'historySync', status: syncStatus() }); }
    else if (m.type === 'copy') { copied = m.text; await respond({ text: 'Copied to clipboard' }); }
    else if (m.type === 'export') { exported = m.text; await respond({ text: 'File saved' }); }
    else if (m.type === 'draft') { draft = m.draft; if (draft.input.trim()) history = [{ id: 'sample', name: draft.name, date: new Date().toISOString(), bytes: Buffer.byteLength(draft.input) }]; await post({ type: 'history', entries: history }); }
    else if (m.type === 'historyOpen') await post({ type: 'load', text: draft.input, name: draft.name });
    else if (m.type === 'historyDelete') { history = []; await post({ type: 'history', entries: [] }); }
    else if (m.type === 'import') await post({ type: 'load', text: '{"imported":true}', name: 'imported.json', side: m.side });
    else if (m.type === 'share') { copied = encodeShare(m.text); await respond({ text: 'Share link copied' }); }
    else if (m.type === 'historySyncToggle') { syncEnabled = m.enabled; await post({ type: 'historySync', status: syncStatus() }); }
    else if (m.type === 'historySyncRefresh') { await post({ type: 'historySync', status: syncStatus() }); }
    else if (m.type === 'historySyncHelp') { helpOpened = true; }
    else if (m.type === 'types') {
      typeCount++;
      const job = new Worker(path.join(root, 'dist/types-worker.cjs'), { workerData: m });
      job.once('message', r => respond(r, r.error));
      job.once('error', e => respond(null, e.message));
    }
  });
  await page.addInitScript(() => {
    window.acquireVsCodeApi = () => ({ postMessage: m => { void window.__hostMessage(m); }, getState: () => JSON.parse(localStorage.getItem('state') || 'null'), setState: s => localStorage.setItem('state', JSON.stringify(s)) });
  });
  const waitText = async (selector, value) => page.waitForFunction(({ selector, value }) => document.querySelector(selector)?.textContent.includes(value), { selector, value }, { timeout: 20000 });
  const load = async text => { await post({ type: 'load', text, name: 'test.json' }); await page.waitForTimeout(650); await waitText('#input-status', 'Valid JSON'); await waitText('#output-status', 'Valid JSON'); };
  const action = (side, name) => page.locator(`#${side}-toolbar`).getByRole('button', { name, exact: true }).click();
  const copy = async side => { copied = ''; await action(side, 'Copy'); await page.waitForTimeout(100); return copied; };
  const tab = (side, name) => page.locator(`#${side}-tabs`).getByRole('tab', { name, exact: true }).click();
  const checks = [];
  try {
    const appBundle = await fs.readFile(path.join(root, 'dist', 'app.js'), 'utf8');
    assert.ok(appBundle.includes('clipboardPasteAction'), 'Monaco clipboard contrib (Ctrl+C/X/V copy/cut/paste) must be bundled');
    checks.push('clipboard copy/cut/paste actions bundled');
    await page.goto(`http://127.0.0.1:${server.address().port}`, { waitUntil: 'networkidle' });
    await page.waitForFunction(() => document.querySelectorAll('.monaco-editor').length === 2);
    const sample = '{"title":"ทดสอบ 🌏","id":9007199254740993,"users":[{"name":"Ada","role":"Engineer"},{"name":"Lin","role":"Designer"}],"active":true,"nested":"{\\"x\\":1}"}';
    await load(sample);
    assert.match(await copy('output'), /9007199254740993/); checks.push('live format, Unicode and exact large integers');
    await page.selectOption('#indent', 'tab'); await page.waitForTimeout(700); assert.match(await copy('output'), /\n\t"title"/);
    await action('output', 'Minify'); await page.waitForTimeout(500); assert.equal(await copy('output'), sample);
    await action('output', 'Stringify'); await page.waitForTimeout(500); assert.equal(JSON.parse(await copy('output')), sample);
    await action('output', 'Unescape'); await page.waitForTimeout(500); assert.equal(await copy('output'), sample); checks.push('indent, minify, stringify and unescape');
    await action('output', 'Deep parse'); await page.waitForTimeout(500); assert.match(await copy('output'), /"nested": \{/); checks.push('deep parsing');
    await load(sample);
    await tab('output', 'Tree'); await waitText('#output-view', 'users');
    await page.locator('#output-view').getByRole('button', { name: 'Expand users', exact: true }).click();
    await waitText('#output-view', 'Object(2)');
    await page.locator('#output-view').getByRole('button', { name: 'Expand 0', exact: true }).click();
    await waitText('#output-view', 'Ada'); checks.push('lazy tree expansion');
    await page.getByRole('textbox', { name: 'output JSON Pointer', exact: true }).fill('/users/0/name');
    await page.locator('#output-view').getByRole('button', { name: 'Extract', exact: true }).click();
    await page.waitForTimeout(500); assert.equal(await copy('output'), '"Ada"'); checks.push('JSON Pointer extraction');
    await load(sample); await tab('output', 'Table');
    await page.getByRole('textbox', { name: 'output JSON Pointer', exact: true }).fill('/users');
    await page.locator('#output-view').getByRole('button', { name: 'Go', exact: true }).click();
    await waitText('#output-view', 'Designer'); assert.equal(await page.locator('#output-view tbody tr').count(), 2); checks.push('table with nested array');
    await tab('output', 'Graph'); await waitText('#output-view', 'users'); assert.ok(await page.locator('.graph-node').count() > 0); checks.push('graph');
    await tab('output', 'Type');
    for (const language of ['typescript', 'python', 'go', 'schema']) {
      await page.getByLabel('output Type language', { exact: true }).selectOption(language);
      await page.locator('#output-view').getByRole('button', { name: 'Generate', exact: true }).click();
      await page.waitForFunction(() => { const e = document.querySelector('.type-code'); return e && !e.textContent.includes('Generating') && e.textContent.length > 100; }, { timeout: 20000 });
      assert.doesNotMatch(await page.locator('.type-code').innerText(), /Error|timed out/);
    }
    assert.equal(typeCount, 4); checks.push('TypeScript, Python, Go and JSON Schema generation in actual bundled worker');
    await tab('output', 'Editor'); await page.locator('#diff').click(); await page.waitForSelector('.monaco-diff-editor'); await page.locator('#diff').click(); checks.push('Monaco diff');
    await page.selectOption('#theme', 'dark'); await tab('output', 'Tree'); await waitText('#output-view', 'users');
    await page.locator('#history-toggle').click(); await page.waitForTimeout(1200);
    await page.screenshot({ path: path.join(results, 'workbench-dark.png') });
    await page.selectOption('#theme', 'light'); await page.screenshot({ path: path.join(results, 'workbench-light.png') });
    await page.locator('#sync-toggle').check(); await waitText('#privacy-badge', 'Sync enabled'); await waitText('#sync-status', 'Prepared for Settings Sync');
    await page.locator('#sync-refresh').click(); await page.locator('#sync-help').click(); await page.waitForTimeout(100); assert.ok(helpOpened);
    await page.locator('#sync-toggle').uncheck(); await waitText('#privacy-badge', 'Local'); checks.push('history sync opt-in toggle, status and badge');
    await tab('output', 'Editor');
    await post({ type: 'load', text: '{"x":}', name: 'invalid.json' }); await waitText('#input-status', 'Invalid JSON');
    await post({ type: 'load', text: "{name:'Ada',}", name: 'repair.json' }); await waitText('#input-status', 'Invalid JSON');
    await action('input', 'Repair'); await waitText('#input-status', 'Valid JSON'); checks.push('validation and repair');
    await action('input', 'Open'); await waitText('#input-status', 'Valid JSON'); await page.waitForTimeout(700); assert.match(await copy('output'), /imported/); checks.push('import bridge');
    await action('output', 'Save'); await page.waitForTimeout(100); assert.match(exported, /imported/); checks.push('export bridge');
    await page.locator('#share').click(); await page.waitForTimeout(100); assert.match(decodeShare(copied), /imported/); checks.push('share round trip');
    await page.waitForTimeout(1500); await page.reload({ waitUntil: 'networkidle' }); await waitText('#output-status', 'Valid JSON'); assert.match(await copy('output'), /imported/); checks.push('draft restore after webview reload');
    await load('{"html":"<img src=x onerror=alert(1)>","__proto__":{"x":1}}'); await tab('output', 'Tree'); await waitText('#output-view', 'onerror'); assert.equal(await page.locator('#output-view img').count(), 0); checks.push('untrusted JSON rendered as text');
    const many = JSON.stringify(Array.from({ length: 250 }, (_, id) => ({ id, name: `row-${id}` })));
    await load(many); await tab('output', 'Table'); await waitText('#output-view', 'of 250'); assert.equal(await page.locator('#output-view tbody tr').count(), 100);
    await page.locator('#output-view').getByRole('button', { name: 'Next', exact: true }).click(); await waitText('#output-view', 'row-100'); checks.push('table pagination bounds DOM rows');
    await page.setViewportSize({ width: 620, height: 850 }); await page.screenshot({ path: path.join(results, 'workbench-narrow.png') });
    assert.deepEqual(errors.filter(e => !e.includes('favicon')), []);
    await fs.writeFile(path.join(results, 'ui-results.json'), JSON.stringify({ passed: checks, errors }, null, 2));
    console.log(JSON.stringify({ passed: checks, errors }, null, 2));
  } catch (error) { await page.screenshot({ path: path.join(results, 'failure.png') }); console.error('Browser errors:', errors); throw error; }
  finally { await browser.close(); server.close(); }
})().catch(e => { console.error(e); process.exit(1); });
