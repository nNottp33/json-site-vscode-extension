import test from 'node:test';
import assert from 'node:assert/strict';
import { deflateRawSync } from 'node:zlib';
import { encodeShare, decodeShare, textMessage, historyEntry } from '../src/host';
test('share round trip is Unicode safe and preserves exact JSON text', () => {
  const text = '{"name":"ทดสอบ 🌏","id":9007199254740993}';
  assert.equal(decodeShare(encodeShare(text)), text);
});
test('share rejects malformed and oversized decompressed content', () => {
  assert.throws(() => decodeShare('../test'));
  assert.throws(() => encodeShare('x'.repeat(1024 * 1024 + 1)), /1 MiB/);
  assert.throws(() => decodeShare(deflateRawSync('x'.repeat(2 * 1024 * 1024)).toString('base64url')));
});
test('bridge validates payloads and history ids cannot escape the storage directory', () => {
  assert.equal(textMessage({ type: 'copy', text: 'null' }), true);
  assert.equal(textMessage({ type: 'copy', text: {} }), false);
  assert.equal(textMessage(null), false);
  const entry = historyEntry('{"x":1}', '../../malicious');
  assert.match(entry.id, /^[a-f0-9]{64}$/);
  assert.equal(entry.id, historyEntry('{"x":1}', 'different name').id);
  assert.equal(entry.bytes, 7);
});
