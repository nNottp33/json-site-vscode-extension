import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { Worker } from 'node:worker_threads';
import { MAX_BYTES } from './core';
import { textMessage, historyEntry, encodeShare, decodeShare, type HistoryEntry } from './host';
import { markup } from './markup';

const languages = new Set(['typescript', 'javascript', 'python', 'go', 'java', 'csharp', 'rust', 'swift', 'kotlin', 'dart', 'cpp', 'ruby', 'schema']);
const utf8 = new TextEncoder();
const decoder = new TextDecoder('utf-8', { fatal: true });
export function activate(context: vscode.ExtensionContext) {
  let current: vscode.WebviewPanel | undefined;
  let loadCurrent: ((text: string, name: string) => void) | undefined;
  let storageQueue: Promise<unknown> = Promise.resolve();
  const storage = (file: string) => vscode.Uri.joinPath(context.globalStorageUri, file);
  const historyIndex = () => context.globalState.get<HistoryEntry[]>('history', []);
  async function readText(uri: vscode.Uri) {
    const stat = await vscode.workspace.fs.stat(uri);
    if (stat.size > MAX_BYTES) throw new Error('Files up to 100 MiB are supported.');
    return decoder.decode(await vscode.workspace.fs.readFile(uri));
  }
  async function remember(text: string, name: string) {
    if (!text.trim()) return;
    await vscode.workspace.fs.createDirectory(context.globalStorageUri);
    const entry = historyEntry(text, name);
    const old = historyIndex();
    if (old[0]?.id === entry.id) return;
    await vscode.workspace.fs.writeFile(storage(`${entry.id}.json`), utf8.encode(text));
    const items = [entry, ...old.filter(item => item.id !== entry.id)];
    let size = 0;
    const kept = items.filter((item, index) => { size += item.bytes; return index < 50 && size <= 200 * 1024 * 1024; });
    await context.globalState.update('history', kept);
    for (const item of items.filter(item => !kept.some(k => k.id === item.id))) await vscode.workspace.fs.delete(storage(`${item.id}.json`)).then(undefined, () => undefined);
  }
  function launch(initial?: { text: string; name: string }, restored?: vscode.WebviewPanel) {
    if (current && !restored) {
      current.reveal();
      if (initial) loadCurrent?.(initial.text, initial.name);
      return;
    }
    const panel = restored ?? vscode.window.createWebviewPanel('jsonWorkbench', 'JSON Workbench', vscode.ViewColumn.Active, { enableScripts: true, retainContextWhenHidden: true });
    current = panel;
    panel.webview.options = { enableScripts: true, localResourceRoots: [vscode.Uri.joinPath(context.extensionUri, 'dist')] };
    let ready = false;
    let pending = initial;
    const typeJobs = new Set<Worker>();
    const send = (message: unknown) => panel.webview.postMessage(message);
    loadCurrent = (text, name) => { if (ready) void send({ type: 'load', text, name }); else pending = { text, name }; };
    panel.onDidDispose(() => { if (current === panel) { current = undefined; loadCurrent = undefined; } for (const job of typeJobs) void job.terminate(); });
    panel.webview.onDidReceiveMessage(async (m: unknown) => {
      if (!m || typeof m !== 'object' || typeof (m as any).type !== 'string') return;
      const message = m as Record<string, any>;
      const respond = (result: unknown) => send({ type: 'response', id: message.id, ok: true, result });
      try {
        switch (message.type) {
          case 'ready': {
            ready = true;
            if (pending) { await send({ type: 'load', ...pending }); pending = undefined; }
            else {
              try { const draft = JSON.parse(decoder.decode(await vscode.workspace.fs.readFile(storage('draft.json')))); await send({ type: 'restore', draft }); }
              catch (error) { if (!(error instanceof vscode.FileSystemError && error.code === 'FileNotFound')) await send({ type: 'notice', text: 'Could not restore the previous draft.' }); }
            }
            await send({ type: 'history', entries: historyIndex() });
            break;
          }
          case 'import': {
            const uris = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { JSON: ['json', 'jsonc', 'txt'], 'All files': ['*'] } });
            if (uris?.[0]) await send({ type: 'load', text: await readText(uris[0]), name: uris[0].path.split('/').pop(), side: message.side });
            break;
          }
          case 'copy':
            if (!textMessage(m)) throw new Error('Invalid clipboard data.');
            await vscode.env.clipboard.writeText(message.text);
            await respond({ text: 'Copied to clipboard' });
            break;
          case 'export': {
            if (!textMessage(m)) throw new Error('Invalid file data.');
            const uri = await vscode.window.showSaveDialog({ defaultUri: vscode.Uri.file(message.isType ? 'types.txt' : 'document.json'), filters: message.isType ? { Text: ['txt'] } : { JSON: ['json'] } });
            if (uri) { await vscode.workspace.fs.writeFile(uri, utf8.encode(message.text)); await respond({ text: 'File saved' }); }
            else await respond({ text: 'Save cancelled' });
            break;
          }
          case 'draft': {
            if (!textMessage({ type: 'draft', text: message.draft?.input }) || !textMessage({ type: 'draft', text: message.draft?.output })) throw new Error('Draft exceeds the supported size.');
            storageQueue = storageQueue.catch(() => undefined).then(async () => {
              await vscode.workspace.fs.createDirectory(context.globalStorageUri);
              await vscode.workspace.fs.writeFile(storage('draft.json'), utf8.encode(JSON.stringify(message.draft)));
              await remember(message.draft.input, typeof message.draft.name === 'string' ? message.draft.name : 'Untitled JSON');
              await send({ type: 'history', entries: historyIndex() });
            });
            await storageQueue;
            break;
          }
          case 'historyOpen': {
            const entry = historyIndex().find(e => e.id === message.entryId);
            if (entry) await send({ type: 'load', text: await readText(storage(`${entry.id}.json`)), name: entry.name });
            break;
          }
          case 'historyDelete': {
            storageQueue = storageQueue.catch(() => undefined).then(async () => {
              const items = historyIndex();
              const entry = items.find(e => e.id === message.entryId);
              if (entry) {
                await context.globalState.update('history', items.filter(e => e.id !== entry.id));
                await vscode.workspace.fs.delete(storage(`${entry.id}.json`));
              }
              await send({ type: 'history', entries: historyIndex() });
            });
            await storageQueue;
            break;
          }
          case 'share': {
            if (!textMessage(m)) throw new Error('Invalid share data.');
            const encoded = encodeShare(message.text);
            const link = `${vscode.env.uriScheme}://${context.extension.id}/open?data=${encoded}`;
            await vscode.env.clipboard.writeText(link);
            await respond({ text: 'Share link copied. The recipient needs JSON Workbench installed. The link contains your JSON.' });
            break;
          }
          case 'types': {
            if (!textMessage(m) || !languages.has(message.language)) throw new Error('Invalid type generation request.');
            if (Buffer.byteLength(message.text) > 2 * 1024 * 1024) throw new Error('Generate types from a sample of 2 MiB or less.');
            for (const old of typeJobs) void old.terminate();
            typeJobs.clear();
            const job = new Worker(vscode.Uri.joinPath(context.extensionUri, 'dist', 'types-worker.cjs').fsPath, { workerData: { text: message.text, language: message.language }, resourceLimits: { maxOldGenerationSizeMb: 256 } });
            typeJobs.add(job);
            await new Promise<void>((resolve, reject) => {
              const timeout = setTimeout(() => { void job.terminate(); reject(new Error('Type generation timed out. Use a smaller sample.')); }, 30000);
              job.once('message', result => { if (result.error) reject(new Error(result.error)); else { void respond(result); resolve(); } });
              job.once('error', reject);
              job.once('exit', () => { clearTimeout(timeout); typeJobs.delete(job); resolve(); });
            });
            break;
          }
        }
      } catch (error) {
        const text = error instanceof Error ? error.message : String(error);
        await send({ type: 'response', id: message.id, ok: false, error: text });
      }
    });
    const asset = (name: string) => panel.webview.asWebviewUri(vscode.Uri.joinPath(context.extensionUri, 'dist', name)).toString();
    panel.webview.html = markup({ csp: panel.webview.cspSource, nonce: randomBytes(18).toString('hex'), app: asset('app.js'), editorCss: asset('app.css'), css: asset('styles.css'), worker: asset('worker.js'), editorWorker: asset('editor.worker.js') });
  }
  context.subscriptions.push(
    vscode.commands.registerCommand('jsonWorkbench.open', () => launch()),
    vscode.commands.registerCommand('jsonWorkbench.openSelection', async (uri?: vscode.Uri) => {
      try {
        if (uri) launch({ text: await readText(uri), name: uri.path.split('/').pop() || 'JSON' });
        else {
          const editor = vscode.window.activeTextEditor;
          if (editor) launch({ text: editor.document.getText(editor.selection.isEmpty ? undefined : editor.selection), name: editor.document.uri.path.split('/').pop() || 'Selection' });
          else launch();
        }
      } catch (e) { void vscode.window.showErrorMessage(String(e)); }
    }),
    vscode.window.registerWebviewPanelSerializer('jsonWorkbench', { async deserializeWebviewPanel(panel) { launch(undefined, panel); } }),
    vscode.window.registerUriHandler({ handleUri(uri) {
      try { if (uri.path === '/open') launch({ text: decodeShare(new URLSearchParams(uri.query).get('data') || ''), name: 'Shared JSON' }); }
      catch (error) { void vscode.window.showErrorMessage(String(error)); }
    } }),
    { dispose() { current?.dispose(); } }
  );
}
