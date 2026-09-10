import * as monaco from 'monaco-editor/esm/vs/editor/editor.api.js';
import 'monaco-editor/esm/vs/editor/contrib/clipboard/browser/clipboard.js';
import 'monaco-editor/esm/vs/editor/contrib/find/browser/findController.js';
import 'monaco-editor/esm/vs/editor/contrib/folding/browser/folding.js';
import 'monaco-editor/esm/vs/editor/contrib/wordHighlighter/browser/wordHighlighter.js';
import { parsePointer, pointer, pasteAction, type NodeRow } from '../core';
declare function acquireVsCodeApi(): { postMessage(message: unknown): void; getState(): any; setState(state: unknown): void };
const vscode = acquireVsCodeApi();
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;
const input = (id: string) => $<HTMLInputElement>(id);
const select = (id: string) => $<HTMLSelectElement>(id);
let hostId = 0;
const hostPending = new Map<number, { resolve: (data: any) => void; reject: (error: Error) => void; timeout: ReturnType<typeof setTimeout> }>();
function host(type: string, data: Record<string, unknown> = {}): Promise<any> {
  const id = ++hostId;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { hostPending.delete(id); reject(new Error('The extension did not respond.')); }, 35000);
    hostPending.set(id, { resolve, reject, timeout });
    vscode.postMessage({ type, id, ...data });
  });
}
function notify(text: string) { $('toast').textContent = text; $('toast').hidden = false; clearTimeout(toastTimer); toastTimer = setTimeout(() => $('toast').hidden = true, 6000); }
let toastTimer: ReturnType<typeof setTimeout>;
function report(error: unknown) { $('error').textContent = error instanceof Error ? error.message : String(error); $('error').hidden = false; }
function button(text: string, action: () => unknown, title = text) {
  const b = document.createElement('button'); b.textContent = text; b.title = title;
  if (title !== text) b.setAttribute('aria-label', title);
  b.addEventListener('click', () => Promise.resolve().then(action).catch(report)); return b;
}
function element<K extends keyof HTMLElementTagNameMap>(tag: K, text?: string, className?: string) {
  const e = document.createElement(tag); if (text !== undefined) e.textContent = text; if (className) e.className = className; return e;
}
let saveTimer: ReturnType<typeof setTimeout>;
let initialized = false;
let left: Pane;
let right: Pane;
let diff: monaco.editor.IStandaloneDiffEditor | undefined;
let history: { id: string; name: string; date: string; bytes: number }[] = [];
function preferences() { return { indent: select('indent').value, theme: select('theme').value, font: select('font').value, wrap: $('wrap').getAttribute('aria-pressed') === 'true', binding: input('binding').checked, sidebar: !$('history').hidden, single: $('single').getAttribute('aria-pressed') === 'true' }; }
function persist() {
  if (!initialized) return;
  vscode.setState(preferences());
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => vscode.postMessage({ type: 'draft', draft: { input: left.editor.getValue(), output: right.editor.getValue(), name: input('document-name').value, ...preferences() } }), 1000);
}
class Pane {
  editor: monaco.editor.IStandaloneCodeEditor;
  worker: Worker;
  view = 'Editor';
  revision = 0;
  valid = false;
  private requestId = 0;
  private pending = new Map<number, { resolve: (v: any) => void; reject: (e: any) => void }>();
  private timer?: ReturnType<typeof setTimeout>;
  private suppress = false;
  private renderVersion = 0;
  constructor(public side: 'input' | 'output', workerUrl: string) {
    this.worker = new Worker(workerUrl);
    this.worker.onmessage = ({ data }) => {
      const request = this.pending.get(data.id); if (!request) return; this.pending.delete(data.id);
      if (data.ok) request.resolve(data.result); else request.reject(Object.assign(new Error(data.error.message), data.error));
    };
    this.worker.onerror = () => { for (const request of this.pending.values()) request.reject(new Error('JSON worker stopped. Reopen JSON Workbench to retry.')); this.pending.clear(); };
    this.editor = monaco.editor.create($(`${side}-editor`), { value: '', language: 'json', automaticLayout: true, minimap: { enabled: false }, fontSize: 14, fontFamily: 'Consolas, "Cascadia Code", monospace', scrollBeyondLastLine: false, wordWrap: 'on', folding: true, tabSize: 2, insertSpaces: true, renderWhitespace: 'selection', padding: { top: 16 }, ariaLabel: `${side === 'input' ? 'Input' : 'Output'} JSON editor`, accessibilitySupport: 'auto', bracketPairColorization: { enabled: true }, editContext: false });
    this.editor.onDidChangeModelContent(() => { if (!this.suppress) this.changed(); });
    this.editor.onDidPaste(() => { const action = pasteAction(this.editor.getValue()); if (action) void this.transform(action).catch(report); });
    for (const view of ['Editor', 'Tree', 'Table', 'Graph', 'Type']) {
      const b = button(view, () => this.setView(view)); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(view === this.view)); $(`${side}-tabs`).append(b);
    }
    const toolbar = $(`${side}-toolbar`);
    toolbar.append(button('Open', () => vscode.postMessage({ type: 'import', side })), button('Save', async () => notify((await host('export', { text: this.editor.getValue() })).text)), button('Copy', async () => notify((await host('copy', { text: this.editor.getValue() })).text)));
    const actions: [string, string][] = [['Format', 'format'], ['Minify', 'minify'], ['Stringify', 'stringify'], ['Unescape', 'unescape'], ['Deep parse', 'deepParse'], ['Repair', 'repair'], ['Sort', 'sort'], ['Base64', 'base64'], ['JWT', 'jwt']];
    for (const [label, action] of actions) toolbar.append(button(label, () => this.transform(action)));
    toolbar.append(button('↶', () => this.editor.trigger('toolbar', 'undo', null), 'Undo'), button('↷', () => this.editor.trigger('toolbar', 'redo', null), 'Redo'), button('Find', () => { this.setView('Editor'); this.editor.getAction('actions.find')?.run(); }), button('Fold', () => this.editor.getAction('editor.foldAll')?.run()), button('Expand', () => this.editor.getAction('editor.unfoldAll')?.run()), button('Clear', () => this.replace('')));
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () => void this.transform('format').catch(report));
    this.editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => void host('export', { text: this.editor.getValue() }).then(r => notify(r.text)).catch(report));
  }
  request(type: string, data: Record<string, unknown> = {}): Promise<any> {
    const id = ++this.requestId;
    return new Promise((resolve, reject) => { this.pending.set(id, { resolve, reject }); this.worker.postMessage({ id, type, revision: this.revision, indent: select('indent').value, ...data }); });
  }
  replace(text: string, reset = false, propagate = true) {
    this.suppress = true;
    if (reset) this.editor.setValue(text);
    else { this.editor.pushUndoStop(); this.editor.executeEdits('json-workbench', [{ range: this.editor.getModel()!.getFullModelRange(), text }]); this.editor.pushUndoStop(); }
    this.suppress = false;
    this.changed(propagate);
  }
  changed(propagate = true) {
    ++this.revision; this.valid = false; ++this.renderVersion;
    clearTimeout(this.timer);
    const text = this.editor.getValue();
    $(`${this.side}-status`).textContent = text.trim() ? 'Validating…' : 'Paste JSON to begin';
    if (this.view !== 'Editor') $(`${this.side}-view`).replaceChildren(element('p', text.trim() ? 'Validating…' : 'Paste JSON to begin', 'empty'));
    if (this.side === 'input') $('size').textContent = `${new TextEncoder().encode(text).length.toLocaleString()} bytes`;
    this.timer = setTimeout(() => void this.parse(propagate), text.length > 1024 * 1024 ? 600 : 180);
    persist();
  }
  async parse(propagate: boolean) {
    const revision = this.revision;
    const text = this.editor.getValue();
    monaco.editor.setModelMarkers(this.editor.getModel()!, 'json-workbench', []);
    if (!text.trim()) { if (this.side === 'input' && propagate && input('binding').checked) right.replace('', false, false); return; }
    try {
      const result = await this.request('parse', { text });
      if (revision !== this.revision) return;
      this.valid = true;
      $(`${this.side}-status`).textContent = `✓ Valid JSON · ${result.rootType}`;
      $(`${this.side}-status`).className = 'valid';
      if (this.side === 'input' && propagate && input('binding').checked) right.replace(result.text, false, false);
      $('error').hidden = true;
      if (this.view !== 'Editor') await this.render();
    } catch (error: any) {
      if (revision !== this.revision) return;
      $(`${this.side}-status`).textContent = `Invalid JSON · Ln ${error.line || 1}, Col ${error.column || 1}`;
      $(`${this.side}-status`).className = 'invalid';
      monaco.editor.setModelMarkers(this.editor.getModel()!, 'json-workbench', [{ severity: monaco.MarkerSeverity.Error, message: error.message, startLineNumber: error.line || 1, endLineNumber: error.line || 1, startColumn: error.column || 1, endColumn: (error.column || 1) + 1 }]);
      report(error);
      if (this.side === 'input' && propagate && input('binding').checked) $<HTMLElement>('output-status').textContent = 'Previous valid result · input has errors';
    }
  }
  async transform(action: string) {
    const revision = this.revision;
    const result = await this.request('transform', { text: this.editor.getValue(), action });
    if (revision === this.revision) this.replace(result.text);
  }
  setView(view: string) {
    this.view = view;
    for (const b of $(`${this.side}-tabs`).children) b.setAttribute('aria-selected', String(b.textContent === view));
    $(`${this.side}-editor`).hidden = view !== 'Editor';
    $(`${this.side}-view`).hidden = view === 'Editor';
    this.editor.layout();
    if (view !== 'Editor') void this.render().catch(report);
  }
  async render() {
    const version = ++this.renderVersion;
    const root = $(`${this.side}-view`); root.replaceChildren();
    if (!this.valid) { root.append(element('p', 'Enter valid JSON to use this view.', 'empty')); return; }
    if (this.view === 'Type') { this.renderTypes(root); return; }
    const controls = element('div', undefined, 'view-controls');
    const path = element('input'); path.placeholder = '/users/0 — JSON Pointer'; path.setAttribute('aria-label', `${this.side} JSON Pointer`);
    const content = element('div', undefined, this.view === 'Graph' ? 'graph' : 'structured');
    const search = element('input'); search.placeholder = 'Search visible rows…'; search.setAttribute('aria-label', `${this.side} Search visible rows`);
    search.oninput = () => { for (const row of content.querySelectorAll<HTMLElement>('[data-search]')) row.hidden = !row.dataset.search!.includes(search.value.toLowerCase()); };
    let offset = 0;
    const draw = async () => {
      const keys = parsePointer(path.value.trim());
      content.replaceChildren();
      search.value = '';
      if (this.view === 'Table') {
        const data = await this.request('table', { path: keys, offset });
        if (version !== this.renderVersion) return;
        const t = element('table'); const head = element('thead'); const tr = element('tr');
        for (const col of ['#', ...data.columns]) tr.append(element('th', col)); head.append(tr); t.append(head);
        const body = element('tbody');
        data.rows.forEach((row: string[], i: number) => { const tr = element('tr'); tr.dataset.search = row.join(' ').toLowerCase(); tr.append(element('td', String(offset + i))); for (const cell of row) { const td = element('td', cell); td.title = cell; tr.append(td); } body.append(tr); });
        t.append(body); content.append(t);
        const pager = element('div', undefined, 'pager'); pager.append(button('Previous', () => { offset = Math.max(0, offset - 100); return draw(); }), element('span', `${data.total ? offset + 1 : 0}–${Math.min(offset + 100, data.total)} of ${data.total.toLocaleString()}`), button('Next', () => { if (offset + 100 < data.total) offset += 100; return draw(); })); content.append(pager);
      } else {
        const tree = element('div', undefined, this.view === 'Graph' ? 'graph-root' : 'tree-root');
        if (this.view === 'Graph') tree.append(element('div', path.value || '$', 'graph-origin'));
        content.append(tree);
        await this.renderChildren(tree, keys, version, this.view === 'Graph');
      }
    };
    path.addEventListener('keydown', e => { if (e.key === 'Enter') { offset = 0; void draw().catch(report); } });
    controls.append(path, button('Go', () => { offset = 0; return draw(); }), button('Extract', async () => { const r = await this.request('extract', { path: parsePointer(path.value), indent: select('indent').value }); right.replace(r.text); right.setView('Editor'); }), search);
    root.append(controls, content);
    await draw();
  }
  private async renderChildren(root: HTMLElement, path: string[], version: number, graph: boolean, offset = 0) {
    const result = await this.request('children', { path, offset });
    if (version !== this.renderVersion) return;
    for (const row of result.rows as NodeRow[]) {
      const wrap = element('div', undefined, graph ? 'graph-node' : 'tree-node'); wrap.dataset.search = `${row.key} ${row.preview}`.toLowerCase();
      const header = element('div', undefined, 'node-header');
      const toggle = button(row.expandable ? '▸' : '·', async () => {
        if (!row.expandable) return;
        const existing = wrap.querySelector<HTMLElement>(':scope > .node-children');
        if (existing) { existing.hidden = !existing.hidden; toggle.textContent = existing.hidden ? '▸' : '▾'; toggle.setAttribute('aria-expanded', String(!existing.hidden)); return; }
        const kids = element('div', undefined, 'node-children'); wrap.append(kids); toggle.textContent = '▾'; toggle.setAttribute('aria-expanded', 'true'); await this.renderChildren(kids, row.path, version, graph);
      }, `Expand ${row.key}`);
      toggle.disabled = !row.expandable;
      if (row.expandable) toggle.setAttribute('aria-expanded', 'false');
      const key = element('span', row.key, 'node-key');
      const val = element('span', row.preview, `node-value ${row.type}`); val.title = row.preview;
      header.append(toggle, key, element('span', row.type, 'type-badge'), val, button('⧉', async () => { const r = await this.request('extract', { path: row.path }); notify((await host('copy', { text: r.text })).text); }, `Copy value of ${row.key}`), button('/', async () => notify((await host('copy', { text: pointer(row.path) })).text), `Copy path of ${row.key}`));
      wrap.append(header); root.append(wrap);
    }
    if (offset + result.rows.length < result.total) {
      const more = button(`Load next 100 (${result.total - offset - result.rows.length} remaining)`, async () => { more.remove(); await this.renderChildren(root, path, version, graph, offset + 100); }); root.append(more);
    }
  }
  private renderTypes(root: HTMLElement) {
    const controls = element('div', undefined, 'view-controls'); const language = element('select'); language.setAttribute('aria-label', `${this.side} Type language`);
    for (const [id, name] of [['typescript', 'TypeScript'], ['javascript', 'JavaScript'], ['python', 'Python'], ['go', 'Go'], ['java', 'Java'], ['csharp', 'C#'], ['rust', 'Rust'], ['swift', 'Swift'], ['kotlin', 'Kotlin'], ['dart', 'Dart'], ['cpp', 'C++'], ['ruby', 'Ruby'], ['schema', 'JSON Schema']]) { const option = element('option', name); option.value = id; language.append(option); }
    const code = element('pre', 'Choose a language and generate types from this JSON.', 'type-code');
    let generated = '';
    const generate = button('Generate', async () => {
      generate.disabled = true; code.textContent = 'Generating…';
      try { const r = await host('types', { text: this.editor.getValue(), language: language.value }); generated = r.text; code.textContent = generated; }
      catch (e) { code.textContent = e instanceof Error ? e.message : String(e); }
      finally { generate.disabled = false; }
    });
    controls.append(language, generate, button('Copy types', async () => { if (generated) notify((await host('copy', { text: generated })).text); }), button('Save types', async () => { if (generated) notify((await host('export', { text: generated, isType: true })).text); })); root.append(controls, code);
  }
}
function renderHistory() {
  const list = $('history-list'); list.replaceChildren();
  const query = input('history-search').value.toLowerCase();
  const entries = history.filter(e => e.name.toLowerCase().includes(query));
  if (!entries.length) list.append(element('p', 'Your JSON sessions will appear here.', 'empty'));
  for (const entry of entries) {
    const row = element('div', undefined, 'history-entry');
    const open = button(entry.name, () => vscode.postMessage({ type: 'historyOpen', entryId: entry.id }));
    open.append(element('small', `${new Date(entry.date).toLocaleString()} · ${(entry.bytes / 1024).toFixed(1)} KB`));
    row.append(open, button('×', () => vscode.postMessage({ type: 'historyDelete', entryId: entry.id }), `Delete ${entry.name} from history`)); list.append(row);
  }
}
function applySync(s: { enabled: boolean; message: string; error?: string }) {
  input('sync-toggle').checked = s.enabled;
  $('sync-status').textContent = s.error || s.message;
  $('sync-status').classList.toggle('sync-error', !!s.error);
  const badge = $('privacy-badge');
  badge.textContent = s.enabled ? '● Sync enabled' : '● Local';
  badge.classList.toggle('synced', s.enabled);
}
function applyTheme() {
  const mode = select('theme').value;
  const dark = mode === 'dark' || (mode === 'auto' && (document.body.classList.contains('vscode-dark') || document.body.classList.contains('vscode-high-contrast')));
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  monaco.editor.setTheme(mode === 'auto' && document.body.classList.contains('vscode-high-contrast') ? 'hc-black' : dark ? 'vs-dark' : 'vs');
}
function restorePreferences(p: any) {
  if (!p || typeof p !== 'object') return;
  for (const id of ['indent', 'theme', 'font']) if ([...select(id).options].some(o => o.value === p[id])) select(id).value = p[id];
  if (typeof p.binding === 'boolean') input('binding').checked = p.binding;
  if (typeof p.wrap === 'boolean') { $('wrap').setAttribute('aria-pressed', String(p.wrap)); for (const pane of [left, right]) pane.editor.updateOptions({ wordWrap: p.wrap ? 'on' : 'off' }); }
  if (typeof p.sidebar === 'boolean') $('history').hidden = !p.sidebar;
  if (typeof p.single === 'boolean') { $('panes').classList.toggle('single', p.single); $('single').setAttribute('aria-pressed', String(p.single)); }
  for (const pane of [left, right]) pane.editor.updateOptions({ fontSize: Number(select('font').value), tabSize: select('indent').value === 'tab' ? 4 : Number(select('indent').value), insertSpaces: select('indent').value !== 'tab' });
  applyTheme();
}
async function main() {
  const workerUrls = await Promise.all([document.body.dataset.worker!, document.body.dataset.editorWorker!].map(async url => {
    const response = await fetch(url); if (!response.ok) throw new Error('Could not load the bundled editor worker.');
    return URL.createObjectURL(new Blob([await response.text()], { type: 'text/javascript' }));
  }));
  (self as any).MonacoEnvironment = { getWorker: () => new Worker(workerUrls[1]) };
  monaco.languages.register({ id: 'json' });
  monaco.languages.setLanguageConfiguration('json', { brackets: [['{', '}'], ['[', ']']], autoClosingPairs: [{ open: '{', close: '}' }, { open: '[', close: ']' }, { open: '"', close: '"' }] });
  monaco.languages.setMonarchTokensProvider('json', { tokenizer: { root: [[/"(?:[^"\\]|\\.)*"(?=\s*:)/, 'type'], [/"(?:[^"\\]|\\.)*"/, 'string'], [/-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/, 'number'], [/\b(?:true|false|null)\b/, 'keyword'], [/[{}\[\]]/, '@brackets'], [/[,:]/, 'delimiter']] } });
  left = new Pane('input', workerUrls[0]); right = new Pane('output', workerUrls[0]);
  restorePreferences(vscode.getState());
  new MutationObserver(applyTheme).observe(document.body, { attributes: true, attributeFilter: ['class'] });
  $('history-toggle').onclick = () => { $('history').hidden = !$('history').hidden; persist(); };
  input('history-search').oninput = renderHistory;
  input('sync-toggle').onchange = () => vscode.postMessage({ type: 'historySyncToggle', enabled: input('sync-toggle').checked });
  $('sync-refresh').onclick = () => vscode.postMessage({ type: 'historySyncRefresh' });
  $('sync-help').onclick = () => vscode.postMessage({ type: 'historySyncHelp' });
  $('document-name').oninput = persist;
  $('sample').onclick = () => { input('document-name').value = 'Example · team.json'; left.replace(JSON.stringify({ name: 'JSON Workbench', private: true, version: '0.1.0', team: [{ id: 1, name: 'Ada', role: 'Engineer', active: true }, { id: 2, name: 'Lin', role: 'Designer', active: false }], settings: { theme: 'dark', indent: 2 }, tags: ['json', 'vscode', 'offline'] }), true); };
  $('new').onclick = () => { input('document-name').value = 'Untitled JSON'; left.replace(''); right.replace(''); };
  $('share').onclick = () => void host('share', { text: right.editor.getValue() || left.editor.getValue() }).then(r => notify(r.text)).catch(report);
  select('indent').onchange = () => { restorePreferences(preferences()); left.changed(); persist(); };
  select('theme').onchange = () => { applyTheme(); persist(); };
  select('font').onchange = () => { for (const p of [left, right]) p.editor.updateOptions({ fontSize: Number(select('font').value) }); persist(); };
  $('wrap').onclick = () => { const wrap = $('wrap').getAttribute('aria-pressed') !== 'true'; $('wrap').setAttribute('aria-pressed', String(wrap)); for (const p of [left, right]) p.editor.updateOptions({ wordWrap: wrap ? 'on' : 'off' }); persist(); };
  input('binding').onchange = () => { if (input('binding').checked) left.changed(); persist(); };
  $('single').onclick = () => { const single = $('panes').classList.toggle('single'); $('single').setAttribute('aria-pressed', String(single)); persist(); };
  $('diff').onclick = () => {
    const active = $('diff').getAttribute('aria-pressed') !== 'true'; $('diff').setAttribute('aria-pressed', String(active)); $('panes').hidden = active; $('diff-editor').hidden = !active;
    if (active) {
      if (!diff) diff = monaco.editor.createDiffEditor($('diff-editor'), { automaticLayout: true, readOnly: true, originalEditable: false, renderSideBySide: true, editContext: false });
      diff.setModel({ original: left.editor.getModel()!, modified: right.editor.getModel()! }); diff.layout();
    }
  };
  $('help').onclick = () => notify('Ctrl/Cmd+Enter: format · Ctrl/Cmd+S: save · Ctrl/Cmd+F: find · Ctrl/Cmd+Z: undo · Drop a JSON file into either pane.');
  const splitter = $('splitter'); let dragging = false;
  const resize = (percent: number) => { const bounded = Math.max(20, Math.min(80, percent)); $('panes').style.setProperty('--split', `${bounded}%`); splitter.setAttribute('aria-valuenow', String(Math.round(bounded))); };
  splitter.onpointerdown = e => { dragging = true; splitter.setPointerCapture(e.pointerId); };
  splitter.onpointermove = e => { if (dragging) { const r = $('panes').getBoundingClientRect(); resize((e.clientX - r.left) / r.width * 100); } };
  splitter.onpointerup = () => dragging = false;
  splitter.onkeydown = e => { if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') { e.preventDefault(); resize(Number(splitter.getAttribute('aria-valuenow')) + (e.key === 'ArrowLeft' ? -5 : 5)); } };
  for (const p of [left, right]) {
    const target = $(`${p.side}-pane`); target.ondragover = e => { e.preventDefault(); };
    target.ondrop = async e => { e.preventDefault(); const file = e.dataTransfer?.files[0]; if (!file) return; if (file.size > 100 * 1024 * 1024) { report(new Error('Files up to 100 MiB are supported.')); return; } input('document-name').value = file.name; p.replace(await file.text()); };
  }
  window.addEventListener('message', ({ data: m }) => {
    if (m.type === 'response') { const p = hostPending.get(m.id); if (p) { clearTimeout(p.timeout); hostPending.delete(m.id); if (m.ok) p.resolve(m.result); else p.reject(new Error(m.error)); } else if (!m.ok) report(m.error); }
    else if (m.type === 'load') { input('document-name').value = m.name || 'Untitled JSON'; (m.side === 'output' ? right : left).replace(m.text, true); }
    else if (m.type === 'restore') { const d = m.draft; restorePreferences(d); input('document-name').value = d.name || 'Untitled JSON'; left.replace(d.input || '', true, false); right.replace(d.output || '', true, false); }
    else if (m.type === 'history') { history = m.entries; renderHistory(); }
    else if (m.type === 'historySync') applySync(m.status);
    else if (m.type === 'notice') notify(m.text);
  });
  window.addEventListener('beforeunload', () => { left.worker.terminate(); right.worker.terminate(); for (const url of workerUrls) URL.revokeObjectURL(url); });
  initialized = true;
  vscode.postMessage({ type: 'ready' });
}
main().catch(report);
