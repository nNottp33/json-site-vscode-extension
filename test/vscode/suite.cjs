const vscode = require('vscode');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
exports.run = async function () {
  const checks = [];
  try {
    const manifest = require('../../package.json');
    const extension = vscode.extensions.getExtension(`${manifest.publisher}.${manifest.name}`);
    assert.ok(extension, 'Extension discovered by VS Code');
    await extension.activate();
    checks.push('Extension discovered and activated in the real VS Code extension host');
    await vscode.commands.executeCommand('jsonWorkbench.open');
    assert.ok(vscode.window.tabGroups.all.some(g => g.tabs.some(t => t.label === 'JSON Workbench')));
    checks.push('Open command creates the JSON Workbench tab');
    await vscode.commands.executeCommand('jsonWorkbench.open');
    assert.equal(vscode.window.tabGroups.all.flatMap(g => g.tabs).filter(t => t.label === 'JSON Workbench').length, 1);
    checks.push('Open command reuses the existing panel');
    const doc = await vscode.workspace.openTextDocument({ language: 'json', content: '{"test":"VS Code extension host","id":9007199254740993}' });
    await vscode.window.showTextDocument(doc);
    await vscode.commands.executeCommand('jsonWorkbench.openSelection');
    checks.push('Selection or document command accepts an actual VS Code text document');
    await new Promise(resolve => setTimeout(resolve, 5000));
    await fs.writeFile(path.resolve(__dirname, '../../test-results/vscode-results.json'), JSON.stringify({ vscode: vscode.version, checks }, null, 2));
  } catch (error) {
    await fs.writeFile(path.resolve(__dirname, '../../test-results/vscode-results.json'), JSON.stringify({ checks, error: error.stack }, null, 2));
    throw error;
  }
};
