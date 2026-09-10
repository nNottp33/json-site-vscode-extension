import { createHash } from 'node:crypto';
import { deflateRawSync, inflateRawSync } from 'node:zlib';
import { MAX_BYTES } from './core';
export interface HistoryEntry { id: string; name: string; date: string; bytes: number }
export function textMessage(message: unknown): message is { type: string; text: string; name?: string; id?: number } {
  if (!message || typeof message !== 'object') return false;
  const m = message as Record<string, unknown>;
  return typeof m.type === 'string' && typeof m.text === 'string' && Buffer.byteLength(m.text) <= MAX_BYTES;
}
export function historyEntry(text: string, name: string): HistoryEntry {
  return { id: createHash('sha256').update(text).digest('hex'), name: name.slice(0, 100), date: new Date().toISOString(), bytes: Buffer.byteLength(text) };
}
export function encodeShare(text: string): string {
  if (Buffer.byteLength(text) > 1024 * 1024) throw new Error('Share links support up to 1 MiB. Export a JSON file for larger documents.');
  const encoded = deflateRawSync(Buffer.from(text)).toString('base64url');
  if (encoded.length > 12000) throw new Error('This document is too large for a portable link. Export a JSON file instead.');
  return encoded;
}
export function decodeShare(encoded: string): string {
  if (encoded.length > 12000 || !/^[A-Za-z0-9_-]+$/.test(encoded)) throw new Error('Invalid share link.');
  return inflateRawSync(Buffer.from(encoded, 'base64url'), { maxOutputLength: 1024 * 1024 }).toString('utf8');
}
