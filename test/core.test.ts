import test from 'node:test';
import assert from 'node:assert/strict';
import { transform, readJSON, writeJSON, children, table, parsePointer, pointer, atPath, MAX_BYTES } from '../src/core';

test('format and minify preserve large integer and decimal number lexemes', () => {
  const source = '{"id":9007199254740993,"price":1234567890.123456789,"tiny":1e-900,"__proto__":{"safe":true}}';
  assert.equal(transform(transform(source, 'format'), 'minify'), source);
  assert.equal(({} as any).safe, undefined);
});
test('all indent options and top-level primitives work', () => {
  for (const indent of ['1', '2', '3', '4', 'tab']) assert.ok(transform('{"x":1}', 'format', indent).includes('\n' + (indent === 'tab' ? '\t' : ' '.repeat(Number(indent))) + '"x"'));
  for (const text of ['null', 'false', '42', '"hello"', '[]', '{}']) assert.equal(transform(text, 'minify'), text);
});
test('invalid input is rejected and explicit repair accepts malformed JSON', () => {
  assert.throws(() => readJSON('{"x":}'));
  assert.equal(transform("{name:'Ada', count:2,}", 'repair'), '{\n  "name": "Ada",\n  "count": 2\n}');
});
test('stringify/unescape round trip and deep parsing leave ordinary strings intact', () => {
  const text = '{"message":"สวัสดี 🌏","nested":"{\\"x\\":1}","plain":"hello"}';
  assert.equal(transform(transform(text, 'stringify'), 'unescape'), text);
  assert.equal(transform(transform(text, 'deepParse'), 'minify'), '{"message":"สวัสดี 🌏","nested":{"x":1},"plain":"hello"}');
});
test('JSON pointers escape special keys and reject inherited properties', () => {
  const value = readJSON('{"a/b":{"~x":[10]},"__proto__":{"x":1}}');
  assert.deepEqual(parsePointer(pointer(['a/b', '~x', '0'])), ['a/b', '~x', '0']);
  assert.equal(writeJSON(atPath(value, ['a/b', '~x', '0'])), '10');
  assert.equal(writeJSON(atPath(value, ['__proto__', 'x'])), '1');
  assert.throws(() => atPath(value, ['constructor']));
  assert.throws(() => parsePointer('$.users'));
  assert.throws(() => parsePointer('/bad~2'));
});
test('tree pagination and table include heterogeneous rows, nulls and special keys', () => {
  const value = readJSON(JSON.stringify(Array.from({ length: 250 }, (_, id) => ({ id }))));
  assert.equal(children(value, [], 100).rows[0].key, '100');
  assert.equal(children(value, [], 200).rows.length, 50);
  assert.equal(children(value, [], 0).total, 250);
  const result = table(readJSON('[{"x":1},{"y":null},false]'), []);
  assert.deepEqual(result.columns, ['x', 'y', 'value']);
  assert.deepEqual(result.rows, [['1', '', ''], ['', 'null', ''], ['', '', 'false']]);
});
test('recursive sorting preserves arrays and prototype-like keys', () => {
  assert.equal(transform(transform('{"z":[{"b":1,"a":2}],"__proto__":3,"a":4}', 'sort'), 'minify'), '{"__proto__":3,"a":4,"z":[{"a":2,"b":1}]}');
});
test('number-like and toJSON user keys remain ordinary JSON data', () => {
  const text = '{"isLosslessNumber":true,"value":"123","rawJSON":"0","toJSON":"hello"}';
  assert.equal(transform(text, 'minify'), text);
});
test('UTF-8 BOM accepted; 100 MiB boundary enforced without clipping', () => {
  assert.equal(transform('\uFEFF{"x":1}', 'minify'), '{"x":1}');
  const source = '"' + 'x'.repeat(MAX_BYTES - 2) + '"';
  assert.equal((readJSON(source) as string).length, MAX_BYTES - 2);
  assert.throws(() => readJSON(source + ' '), /100 MiB/);
});
