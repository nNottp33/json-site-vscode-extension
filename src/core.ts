import { jsonrepair } from 'jsonrepair';

// Raw JSON numbers preserve the original token, including integers beyond 2^53.
// Native JSON objects also preserve keys such as __proto__ without mutation.
const nativeJSON = JSON as typeof JSON & {
  rawJSON(text: string): { rawJSON: string };
  isRawJSON(value: unknown): value is { rawJSON: string };
};

export const MAX_BYTES = 100 * 1024 * 1024;
export type Indent = '1' | '2' | '3' | '4' | 'tab';
export function indentation(indent: string): string { return indent === 'tab' ? '\t' : ' '.repeat(['1', '2', '3', '4'].includes(indent) ? Number(indent) : 2); }
export function decodeBase64(text: string): string {
  const normalized = text.trim().replace(/\s+/g, '').replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4);
  if (!normalized || !/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) throw new Error('Not valid base64 data.');
  const bytes = Uint8Array.from(atob(padded), c => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}
export function decodeJwt(text: string): { header: unknown; payload: unknown; signature: string } {
  const parts = /^([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]*)$/.exec(text.trim());
  if (!parts) throw new Error('Not a JWT.');
  const [header, payload] = [parts[1], parts[2]].map(part => readJSON(decodeBase64(part)));
  if (!container(header) || !container(payload)) throw new Error('Not a JWT.');
  return { header, payload, signature: parts[3] };
}
// Only whole objects/arrays are auto-decoded: base64 of a bare number is indistinguishable from short words such as "OK".
export function pasteAction(text: string): 'jwt' | 'base64' | undefined {
  if (!/^[\sA-Za-z0-9+/=_.-]*$/.test(text)) return undefined;
  try { decodeJwt(text); return 'jwt'; } catch { /* not a JWT */ }
  try { return container(readJSON(decodeBase64(text))) ? 'base64' : undefined; } catch { return undefined; }
}
export function readJSON(text: string): unknown {
  if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('JSON exceeds the 100 MiB input limit.');
  if (typeof nativeJSON.rawJSON !== 'function') throw new Error('Update VS Code to a version with native JSON.rawJSON support.');
  return JSON.parse(text.replace(/^\uFEFF/, ''), (_key: string, value: unknown, context?: { source?: string }) => {
    if (typeof value !== 'number') return value;
    if (!context?.source) throw new Error('This VS Code version cannot preserve JSON number precision. Please update it.');
    return nativeJSON.rawJSON(context.source);
  });
}
export function writeJSON(value: unknown, indent?: string): string { return JSON.stringify(value, undefined, indent) ?? 'null'; }
export function kind(value: unknown): string {
  if (value === null) return 'null';
  if (nativeJSON.isRawJSON(value)) return 'number';
  if (Array.isArray(value)) return 'array';
  return typeof value;
}
export function container(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !nativeJSON.isRawJSON(value); }
export function preview(value: unknown): string {
  if (Array.isArray(value)) return `Array(${value.length})`;
  if (container(value)) return `Object(${Object.keys(value).length})`;
  const text = writeJSON(value);
  return text.length > 180 ? text.slice(0, 180) + '…' : text;
}
export function atPath(value: unknown, path: string[]): unknown {
  for (const key of path) {
    if (!container(value) || !Object.hasOwn(value, key)) throw new Error(`Path not found: ${pointer(path)}`);
    value = value[key];
  }
  return value;
}
export function pointer(path: string[]): string { return path.length ? '/' + path.map(p => p.replace(/~/g, '~0').replace(/\//g, '~1')).join('/') : ''; }
export function parsePointer(text: string): string[] {
  if (!text) return [];
  if (!text.startsWith('/') || /~(?![01])/u.test(text)) throw new Error('Use a JSON Pointer, such as /users/0/name.');
  return text.slice(1).split('/').map(p => p.replace(/~1/g, '/').replace(/~0/g, '~'));
}
export interface NodeRow { key: string; path: string[]; type: string; preview: string; expandable: boolean }
export function children(value: unknown, path: string[], offset = 0, limit = 100): { rows: NodeRow[]; total: number } {
  const target = atPath(value, path);
  const keys = container(target) ? Object.keys(target) : [];
  const entries = container(target) ? keys.slice(offset, offset + limit).map(key => ({ key, value: target[key], path: [...path, key] })) : offset ? [] : [{ key: '$', value: target, path }];
  return { rows: entries.map(e => ({ key: e.key, path: e.path, type: kind(e.value), preview: preview(e.value), expandable: container(e.value) })), total: container(target) ? keys.length : 1 };
}
export function table(value: unknown, path: string[], offset = 0, limit = 100) {
  const target = atPath(value, path);
  const all = Array.isArray(target) ? target : container(target) ? Object.entries(target).map(([key, value]) => ({ key, value })) : [target];
  const rows: Record<string, unknown>[] = all.slice(offset, offset + limit).map(row => container(row) && !Array.isArray(row) ? row : { value: row });
  const columns = [...new Set(rows.flatMap(row => Object.keys(row)))];
  return { columns, rows: rows.map(row => columns.map(col => Object.hasOwn(row, col) ? writeJSON(row[col]) : '')), total: all.length };
}
function sorted(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sorted);
  if (container(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, sorted(value[key])]));
  return value;
}
function decoded(value: unknown, depth = 0): unknown {
  if (depth > 100) throw new Error('Nested JSON exceeds 100 levels.');
  if (typeof value === 'string' && /^[\[{]/.test(value.trim())) { try { return decoded(readJSON(value), depth + 1); } catch { return value; } }
  if (Array.isArray(value)) return value.map(v => decoded(v, depth + 1));
  if (container(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, decoded(v, depth + 1)]));
  return value;
}
export function transform(text: string, action: string, indent = '2'): string {
  if (action === 'repair') return writeJSON(readJSON(jsonrepair(text)), indentation(indent));
  if (action === 'base64') { const decoded = decodeBase64(text); try { return writeJSON(readJSON(decoded), indentation(indent)); } catch { return decoded; } }
  if (action === 'jwt') return writeJSON(decodeJwt(text), indentation(indent));
  const value = readJSON(text);
  switch (action) {
    case 'format': return writeJSON(value, indentation(indent));
    case 'minify': return writeJSON(value);
    case 'stringify': return JSON.stringify(writeJSON(value));
    case 'unescape': return typeof value === 'string' ? value : writeJSON(value, indentation(indent));
    case 'deepParse': return writeJSON(decoded(value), indentation(indent));
    case 'sort': return writeJSON(sorted(value), indentation(indent));
    default: throw new Error('Unknown transformation.');
  }
}
export function errorPosition(error: unknown, text: string) {
  const message = error instanceof Error ? error.message : String(error);
  const match = /(?:position|at)\s+(\d+)/i.exec(message);
  const offset = match ? Math.min(Number(match[1]), text.length) : 0;
  const prefix = text.slice(0, offset).split('\n');
  return { message, line: prefix.length, column: prefix[prefix.length - 1].length + 1 };
}
