import { promisify } from 'node:util';
import { deflateRaw, inflateRaw } from 'node:zlib';
import { historyEntry, type HistoryEntry } from './host';

const compress = promisify(deflateRaw);
const decompress = promisify(inflateRaw);
export const SYNC_KEY = 'history.sync.v1';
export const SYNC_ENABLED_KEY = 'history.sync.enabled';
const DELETIONS_KEY = 'history.sync.deletions';
export const SYNC_MAX_BYTES = 64 * 1024;
export const SYNC_ITEM_BYTES = 1024 * 1024;
export const SYNC_MAX_ITEMS = 20;
const RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
export interface Deletion { id: string; date: string }
export interface HistoryDocument { entry: HistoryEntry; text: string }
export interface SyncRecord extends HistoryEntry { content: string }
export interface Snapshot { version: 1; records: SyncRecord[]; deleted: Deletion[] }
export interface SyncStatus { enabled: boolean; prepared: number; localOnly: number; bytes: number; message: string; error?: string }
export interface SyncState {
  get<T>(key: string, fallback: T): T;
  update(key: string, value: unknown): PromiseLike<void>;
  setKeysForSync(keys: readonly string[]): void;
}
export interface HistoryPort {
  list(): HistoryEntry[];
  read(id: string): Promise<string>;
  apply(documents: HistoryDocument[], deleted: Deletion[]): Promise<void>;
}
const newest = <T extends { id: string; date: string }>(a: T, b: T) => b.date.localeCompare(a.date) || a.id.localeCompare(b.id);
const isId = (value: unknown): value is string => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const isDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value));
const payloadBytes = (snapshot: Snapshot) => Buffer.byteLength(JSON.stringify(snapshot));
function empty(): Snapshot { return { version: 1, records: [], deleted: [] }; }
export function readSnapshot(value: unknown): Snapshot {
  if (value === undefined) return empty();
  if (!value || typeof value !== 'object') throw new Error('Invalid history sync snapshot.');
  const s = value as Snapshot;
  if (s.version !== 1 || !Array.isArray(s.records) || !Array.isArray(s.deleted) || s.records.length > SYNC_MAX_ITEMS || s.deleted.length > 100 || payloadBytes(s) > SYNC_MAX_BYTES) throw new Error('Unsupported or oversized history sync snapshot.');
  for (const r of s.records) {
    if (!r || !isId(r.id) || !isDate(r.date) || typeof r.name !== 'string' || r.name.length > 100 || !Number.isInteger(r.bytes) || r.bytes < 0 || r.bytes > SYNC_ITEM_BYTES || typeof r.content !== 'string' || !/^[A-Za-z0-9_-]+$/.test(r.content)) throw new Error('Invalid history sync entry.');
  }
  for (const d of s.deleted) if (!d || !isId(d.id) || !isDate(d.date)) throw new Error('Invalid history sync deletion.');
  return s;
}
export async function packDocument(document: HistoryDocument): Promise<SyncRecord | undefined> {
  const bytes = Buffer.byteLength(document.text);
  if (bytes > SYNC_ITEM_BYTES) return undefined;
  if (historyEntry(document.text, document.entry.name).id !== document.entry.id) throw new Error('History file integrity check failed.');
  return { ...document.entry, bytes, content: (await compress(Buffer.from(document.text))).toString('base64url') };
}
export async function unpackRecord(record: SyncRecord): Promise<HistoryDocument> {
  const bytes = await decompress(Buffer.from(record.content, 'base64url'), { maxOutputLength: SYNC_ITEM_BYTES });
  const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (bytes.length !== record.bytes || historyEntry(text, record.name).id !== record.id) throw new Error('History sync entry integrity check failed.');
  return { entry: { id: record.id, name: record.name, date: record.date, bytes: record.bytes }, text };
}
export function mergeDeletions(groups: Deletion[][], now = Date.now()): Deletion[] {
  const merged = new Map<string, Deletion>();
  for (const deletion of groups.flat()) {
    if (!isId(deletion.id) || !isDate(deletion.date) || Date.parse(deletion.date) < now - RETENTION_MS) continue;
    const previous = merged.get(deletion.id);
    if (!previous || previous.date < deletion.date) merged.set(deletion.id, deletion);
  }
  return [...merged.values()].sort(newest).slice(0, 100);
}
export function makeSnapshot(records: SyncRecord[], deleted: Deletion[]): Snapshot {
  const tombstones = new Map(deleted.map(d => [d.id, d.date]));
  const merged = new Map<string, SyncRecord>();
  for (const record of records) {
    if ((tombstones.get(record.id) || '') >= record.date) continue;
    const previous = merged.get(record.id);
    if (!previous || previous.date < record.date || (previous.date === record.date && previous.name > record.name)) merged.set(record.id, record);
  }
  const result: Snapshot = { version: 1, records: [], deleted };
  for (const record of [...merged.values()].sort(newest)) {
    if (result.records.length >= SYNC_MAX_ITEMS) break;
    result.records.push(record);
    if (payloadBytes(result) > SYNC_MAX_BYTES) result.records.pop();
  }
  return result;
}

// Call methods through the host's storage queue: local file writes and state
// reconciliation must not race with draft saves or history deletion.
export class HistorySync {
  private fingerprint = '';
  private lastStatus?: SyncStatus;
  constructor(private state: SyncState, private local: HistoryPort) {
    state.setKeysForSync(this.enabled ? [SYNC_KEY] : []);
  }
  get enabled() { return this.state.get(SYNC_ENABLED_KEY, false); }
  status(): SyncStatus {
    return this.lastStatus ?? { enabled: this.enabled, prepared: 0, localOnly: this.local.list().length, bytes: 0, message: this.enabled ? 'Waiting for history refresh.' : 'History stays on this device. Enable to share JSON through VS Code Settings Sync.' };
  }
  async setEnabled(enabled: boolean) {
    await this.state.update(SYNC_ENABLED_KEY, enabled);
    this.state.setKeysForSync(enabled ? [SYNC_KEY] : []);
    this.fingerprint = '';
    this.lastStatus = undefined;
    return this.reconcile();
  }
  async deleted(id: string, now = Date.now()) {
    if (!isId(id)) throw new Error('Invalid history entry ID.');
    const deleted = mergeDeletions([this.state.get<Deletion[]>(DELETIONS_KEY, []), [{ id, date: new Date(now).toISOString() }]], now);
    await this.state.update(DELETIONS_KEY, deleted);
    this.fingerprint = '';
  }
  async reconcile(now = Date.now()): Promise<SyncStatus> {
    if (!this.enabled) { this.lastStatus = undefined; return this.status(); }
    const raw = this.state.get<unknown>(SYNC_KEY, undefined);
    const localEntries = this.local.list();
    const localDeleted = this.state.get<Deletion[]>(DELETIONS_KEY, []);
    const fingerprint = JSON.stringify([raw, localEntries, localDeleted, Math.floor(now / 86400000)]);
    if (this.fingerprint === fingerprint && this.lastStatus) return this.lastStatus;
    const remote = readSnapshot(raw);
    // Fully validate incoming files before changing any local data.
    const documents = await Promise.all(remote.records.map(unpackRecord));
    const deleted = mergeDeletions([localDeleted, remote.deleted], now);
    await this.local.apply(documents, deleted);
    const localRecords: SyncRecord[] = [];
    for (const entry of this.local.list()) {
      if (entry.bytes > SYNC_ITEM_BYTES) continue;
      const packed = await packDocument({ entry, text: await this.local.read(entry.id) });
      if (packed) localRecords.push(packed);
    }
    const snapshot = makeSnapshot([...remote.records, ...localRecords], deleted);
    if (JSON.stringify(localDeleted) !== JSON.stringify(deleted)) await this.state.update(DELETIONS_KEY, deleted);
    if (JSON.stringify(raw) !== JSON.stringify(snapshot)) await this.state.update(SYNC_KEY, snapshot);
    const localOnly = this.local.list().filter(e => !snapshot.records.some(r => r.id === e.id)).length;
    this.lastStatus = { enabled: true, prepared: snapshot.records.length, localOnly, bytes: payloadBytes(snapshot), message: `${snapshot.records.length} prepared for Settings Sync; ${localOnly} local only. Enable VS Code Settings Sync on each device. Cloud transfer is managed by VS Code.` };
    this.fingerprint = JSON.stringify([snapshot, this.local.list(), deleted, Math.floor(now / 86400000)]);
    return this.lastStatus;
  }
}
