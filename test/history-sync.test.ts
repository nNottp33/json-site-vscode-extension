import test from 'node:test';
import assert from 'node:assert/strict';
import { historyEntry, type HistoryEntry } from '../src/host';
import {
  HistorySync, packDocument, unpackRecord, readSnapshot, mergeDeletions, makeSnapshot,
  SYNC_KEY, SYNC_ENABLED_KEY, SYNC_MAX_ITEMS, SYNC_ITEM_BYTES,
  type SyncState, type HistoryPort, type SyncRecord
} from '../src/history-sync';

// A two-device double: SYNC_KEY is the only value Settings Sync would carry, so
// tests move it between devices with propagate() to model VS Code's transport.
function device() {
  const store = new Map<string, unknown>();
  const files = new Map<string, string>();
  let syncedKeys: string[] = [];
  const state = {
    get: (key: string, fallback: unknown) => store.has(key) ? store.get(key) : fallback,
    update: async (key: string, value: unknown) => { store.set(key, value); },
    setKeysForSync: (keys: readonly string[]) => { syncedKeys = [...keys]; }
  } as unknown as SyncState;
  const list = () => (store.get('history') as HistoryEntry[] | undefined) ?? [];
  const port: HistoryPort = {
    list,
    read: async id => { const text = files.get(id); if (text === undefined) throw new Error('missing file'); return text; },
    apply: async (documents, deleted) => {
      const tomb = new Map(deleted.map(d => [d.id, d.date]));
      const index = list();
      const byId = new Map(index.map(e => [e.id, e]));
      for (const doc of documents) {
        const t = tomb.get(doc.entry.id);
        if (t && t >= doc.entry.date) continue;
        const existing = byId.get(doc.entry.id);
        if (existing && existing.date >= doc.entry.date) continue;
        files.set(doc.entry.id, doc.text);
        byId.set(doc.entry.id, doc.entry);
      }
      for (const [id, entry] of [...byId]) { const t = tomb.get(id); if (t && t >= entry.date) byId.delete(id); }
      let size = 0;
      const kept = [...byId.values()].sort((a, b) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id)).filter((item, i) => { size += item.bytes; return i < 50 && size <= 200 * 1024 * 1024; });
      store.set('history', kept);
      const keptIds = new Set(kept.map(e => e.id));
      for (const id of [...files.keys()]) if (!keptIds.has(id)) files.delete(id);
    }
  };
  const add = (text: string, name: string, date: string) => {
    const entry = { ...historyEntry(text, name), date };
    files.set(entry.id, text);
    store.set('history', [entry, ...list().filter(e => e.id !== entry.id)].slice(0, 50));
    return entry.id;
  };
  return { store, files, state, port, add, syncedKeys: () => syncedKeys };
}
const propagate = (from: ReturnType<typeof device>, to: ReturnType<typeof device>) => {
  const value = from.store.get(SYNC_KEY);
  to.store.set(SYNC_KEY, value === undefined ? undefined : JSON.parse(JSON.stringify(value)));
};
const rec = async (text: string, name: string, date: string): Promise<SyncRecord> =>
  (await packDocument({ entry: { ...historyEntry(text, name), date }, text }))!;
const ID = (text: string, name = 'n') => historyEntry(text, name).id;

test('pack/unpack round trips and rejects size overflow and tampering', async () => {
  const doc = { entry: { ...historyEntry('{"a":1}', 'a.json'), date: '2026-05-01T00:00:00.000Z' }, text: '{"a":1}' };
  const packed = await packDocument(doc);
  assert.ok(packed);
  const back = await unpackRecord(packed);
  assert.equal(back.text, '{"a":1}');
  assert.equal(back.entry.id, doc.entry.id);
  assert.equal(await packDocument({ entry: historyEntry('x'.repeat(SYNC_ITEM_BYTES + 1), 'big'), text: 'x'.repeat(SYNC_ITEM_BYTES + 1) }), undefined);
  await assert.rejects(unpackRecord({ ...packed, bytes: packed.bytes + 1 }));   // declared size lies
  await assert.rejects(unpackRecord({ ...packed, id: 'a'.repeat(64) }));         // content hash mismatch
});

test('readSnapshot validates version, ids, content and bounds', () => {
  assert.deepEqual(readSnapshot(undefined), { version: 1, records: [], deleted: [] });
  assert.throws(() => readSnapshot('nope'));
  assert.throws(() => readSnapshot({ version: 2, records: [], deleted: [] }));
  assert.throws(() => readSnapshot({ version: 1, records: [], deleted: Array.from({ length: 101 }, () => ({ id: 'a'.repeat(64), date: '2026-05-01T00:00:00.000Z' })) }));
});

test('readSnapshot rejects malformed records but accepts valid ones', async () => {
  const good = await rec('{"a":1}', 'a', '2026-05-01T00:00:00.000Z');
  assert.ok(readSnapshot({ version: 1, records: [good], deleted: [] }));
  assert.throws(() => readSnapshot({ version: 1, records: [{ ...good, id: 'zz' }], deleted: [] }));
  assert.throws(() => readSnapshot({ version: 1, records: [{ ...good, content: 'not base64!!' }], deleted: [] }));
});

test('mergeDeletions keeps newest per id, drops expired and invalid, caps at 100', () => {
  const now = Date.parse('2026-06-01T00:00:00.000Z');
  const a = 'a'.repeat(64), b = 'b'.repeat(64);
  const merged = mergeDeletions([
    [{ id: a, date: '2026-05-01T00:00:00.000Z' }],
    [{ id: a, date: '2026-05-02T00:00:00.000Z' }, { id: b, date: '2026-05-01T00:00:00.000Z' }]
  ], now);
  assert.equal(merged.length, 2);
  assert.equal(merged.find(d => d.id === a)!.date, '2026-05-02T00:00:00.000Z');
  assert.equal(mergeDeletions([[{ id: a, date: '2020-01-01T00:00:00.000Z' }]], now).length, 0);
  assert.equal(mergeDeletions([[{ id: 'bad', date: '2026-05-01T00:00:00.000Z' }]], now).length, 0);
});

test('makeSnapshot suppresses tombstoned records, honours newer re-adds and caps count', async () => {
  const old = await rec('{"a":1}', 'a', '2026-05-01T00:00:00.000Z');
  const tomb = [{ id: old.id, date: '2026-05-02T00:00:00.000Z' }];
  assert.equal(makeSnapshot([old], tomb).records.length, 0);
  const readd = await rec('{"a":1}', 'a', '2026-05-03T00:00:00.000Z');   // same content id, newer than tombstone
  assert.equal(makeSnapshot([readd], tomb).records.length, 1);
  const many = [];
  for (let i = 0; i < 30; i++) many.push(await rec(JSON.stringify({ i }), `n${i}`, `2026-05-${String(i + 1).padStart(2, '0')}T00:00:00.000Z`));
  assert.equal(makeSnapshot(many, []).records.length, SYNC_MAX_ITEMS);
});

test('two devices exchange history through the shared snapshot', async () => {
  const A = device(), B = device();
  await A.state.update(SYNC_ENABLED_KEY, true);
  await B.state.update(SYNC_ENABLED_KEY, true);
  const syncA = new HistorySync(A.state, A.port), syncB = new HistorySync(B.state, B.port);
  assert.deepEqual(A.syncedKeys(), [SYNC_KEY]);
  A.add('{"shared":1}', 'shared.json', '2026-05-01T00:00:00.000Z');
  const status = await syncA.reconcile();
  assert.equal(status.prepared, 1);
  propagate(A, B);
  await syncB.reconcile();
  const id = ID('{"shared":1}', 'shared.json');
  assert.equal(B.port.list().length, 1);
  assert.equal(B.port.list()[0].id, id);
  assert.equal(await B.port.read(id), '{"shared":1}');
});

test('deletions propagate and stale records never resurrect', async () => {
  const A = device(), B = device();
  await A.state.update(SYNC_ENABLED_KEY, true);
  await B.state.update(SYNC_ENABLED_KEY, true);
  const syncA = new HistorySync(A.state, A.port), syncB = new HistorySync(B.state, B.port);
  const id = A.add('{"x":1}', 'x', '2026-05-01T00:00:00.000Z');
  await syncA.reconcile(); propagate(A, B); await syncB.reconcile();
  assert.equal(B.port.list().length, 1);
  // A deletes: tombstone, remove local entry (as the host does), then reconcile.
  const t = Date.parse('2026-05-02T00:00:00.000Z');
  await syncA.deleted(id, t);
  A.store.set('history', A.port.list().filter(e => e.id !== id)); A.files.delete(id);
  await syncA.reconcile(t);
  assert.equal(A.port.list().length, 0);
  propagate(A, B);
  await syncB.reconcile(t);
  assert.equal(B.port.list().length, 0);
  // Even a stale snapshot that still carries the old record must not bring it back.
  const stale = await rec('{"x":1}', 'x', '2026-05-01T00:00:00.000Z');
  B.store.set(SYNC_KEY, { version: 1, records: [stale], deleted: [{ id, date: '2026-05-02T00:00:00.000Z' }] });
  await syncB.reconcile(Date.parse('2026-05-03T00:00:00.000Z'));
  assert.equal(B.port.list().length, 0);
});

test('an intentional re-add supersedes an earlier deletion across devices', async () => {
  const A = device(), B = device();
  await A.state.update(SYNC_ENABLED_KEY, true);
  await B.state.update(SYNC_ENABLED_KEY, true);
  const syncA = new HistorySync(A.state, A.port), syncB = new HistorySync(B.state, B.port);
  const id = A.add('{"x":1}', 'x', '2026-05-01T00:00:00.000Z');
  await syncA.reconcile(); propagate(A, B); await syncB.reconcile();
  const t = Date.parse('2026-05-02T00:00:00.000Z');
  await syncA.deleted(id, t);
  A.store.set('history', A.port.list().filter(e => e.id !== id)); A.files.delete(id);
  await syncA.reconcile(t); propagate(A, B); await syncB.reconcile(t);
  assert.equal(B.port.list().length, 0);
  // B re-adds the same content with a newer date.
  B.add('{"x":1}', 'x', '2026-05-04T00:00:00.000Z');
  const t2 = Date.parse('2026-05-04T00:00:00.000Z');
  await syncB.reconcile(t2);
  assert.equal(B.port.list().length, 1);
  propagate(B, A);
  await syncA.reconcile(t2);
  assert.equal(A.port.list().length, 1);
});

test('disabled sync writes nothing and registers no synced keys', async () => {
  const C = device();
  const syncC = new HistorySync(C.state, C.port);
  assert.deepEqual(C.syncedKeys(), []);
  C.add('{"n":1}', 'n', '2026-05-01T00:00:00.000Z');
  const status = await syncC.reconcile();
  assert.equal(status.enabled, false);
  assert.equal(C.store.get(SYNC_KEY), undefined);
  const enabled = await syncC.setEnabled(true);
  assert.deepEqual(C.syncedKeys(), [SYNC_KEY]);
  assert.equal(enabled.enabled, true);
  assert.ok(C.store.get(SYNC_KEY));
  await syncC.setEnabled(false);
  assert.deepEqual(C.syncedKeys(), []);
});

test('items larger than the per-item cap stay local and are counted', async () => {
  const D = device();
  await D.state.update(SYNC_ENABLED_KEY, true);
  const syncD = new HistorySync(D.state, D.port);
  D.add('"' + 'x'.repeat(SYNC_ITEM_BYTES) + '"', 'big.json', '2026-05-01T00:00:00.000Z');
  D.add('{"small":1}', 'small.json', '2026-05-02T00:00:00.000Z');
  const status = await syncD.reconcile();
  assert.equal(status.prepared, 1);
  assert.equal(status.localOnly, 1);
});

test('reconcile does not rewrite state when nothing changed', async () => {
  const E = device();
  await E.state.update(SYNC_ENABLED_KEY, true);
  let updates = 0;
  const counting = {
    get: (E.state as any).get,
    update: async (key: string, value: unknown) => { updates++; return (E.state as any).update(key, value); },
    setKeysForSync: (E.state as any).setKeysForSync
  } as unknown as SyncState;
  const syncE = new HistorySync(counting, E.port);
  E.add('{"a":1}', 'a', '2026-05-01T00:00:00.000Z');
  await syncE.reconcile(1000);
  const afterFirst = updates;
  assert.ok(afterFirst >= 1);
  await syncE.reconcile(1000);
  assert.equal(updates, afterFirst);   // fingerprint short-circuits the second pass
});

test('a hash-mismatched incoming snapshot is rejected before local history changes', async () => {
  const F = device();
  await F.state.update(SYNC_ENABLED_KEY, true);
  const syncF = new HistorySync(F.state, F.port);
  F.add('{"keep":1}', 'keep', '2026-05-01T00:00:00.000Z');
  const good = await rec('{"real":1}', 'r', '2026-05-01T00:00:00.000Z');
  F.store.set(SYNC_KEY, { version: 1, records: [{ ...good, id: 'a'.repeat(64) }], deleted: [] });
  await assert.rejects(() => syncF.reconcile());
  assert.equal(F.port.list().length, 1);   // local history untouched by the bad snapshot
});
