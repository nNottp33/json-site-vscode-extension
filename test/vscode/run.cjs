const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const root = path.resolve(__dirname, '../..');
(async () => {
  const userData = path.join(root, 'test-results/vscode-profile');
  await fs.mkdir(path.join(userData, 'User'), { recursive: true });
  await fs.writeFile(path.join(userData, 'User/settings.json'), JSON.stringify({ 'telemetry.telemetryLevel': 'off', 'update.mode': 'none', 'extensions.autoUpdate': false, 'workbench.startupEditor': 'none', 'window.restoreWindows': 'none', 'security.workspace.trust.enabled': false }));
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const executable = process.env.JSON_WORKBENCH_VSCODE || path.join(process.env.LOCALAPPDATA, 'Programs/Microsoft VS Code/Code.exe');
  const child = spawn(executable, ['--user-data-dir=' + userData, '--extensions-dir=' + path.join(root, 'test-results/vscode-extensions'), '--extensionDevelopmentPath=' + root, '--extensionTestsPath=' + path.join(__dirname, 'suite.cjs'), '--disable-updates', '--skip-welcome', '--skip-release-notes', '--disable-workspace-trust'], { windowsHide: true, env });
  child.stdout.on('data', chunk => process.stdout.write(chunk));
  child.stderr.on('data', chunk => process.stderr.write(chunk));
  child.once('error', error => { console.error(error); process.exitCode = 1; });
  child.once('exit', async code => { console.log(await fs.readFile(path.join(root, 'test-results/vscode-results.json'), 'utf8').catch(() => 'No extension host results produced.')); process.exitCode = code || 0; });
})().catch(error => { console.error(error); process.exit(1); });
