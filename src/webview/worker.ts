import { readJSON, writeJSON, indentation, transform, errorPosition, children, table, atPath, kind } from '../core';
let value: unknown;
let valid = false;
let revision = 0;
self.onmessage = (event: MessageEvent) => {
  const m = event.data;
  try {
    let result: unknown;
    if (m.type === 'parse') {
      valid = false;
      revision = m.revision;
      value = readJSON(m.text);
      valid = true;
      result = { text: writeJSON(value, indentation(m.indent)), rootType: kind(value) };
    } else if (m.type === 'transform') {
      result = { text: transform(m.text, m.action, m.indent) };
    } else {
      if (!valid || m.revision !== revision) throw new Error('JSON changed; refresh this view.');
      const path = m.path || [];
      if (m.type === 'children') result = children(value, path, m.offset || 0);
      else if (m.type === 'table') result = table(value, path, m.offset || 0);
      else if (m.type === 'extract') result = { text: writeJSON(atPath(value, path), indentation(m.indent)) };
      else throw new Error('Unknown request.');
    }
    self.postMessage({ id: m.id, revision: m.revision, ok: true, result });
  } catch (error) {
    self.postMessage({ id: m.id, revision: m.revision, ok: false, error: errorPosition(error, m.text || '') });
  }
};
