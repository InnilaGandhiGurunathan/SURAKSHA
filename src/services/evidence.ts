/**
 * Evidence capture.
 *
 * Files never leave the device in this prototype. What we *do* compute is a
 * SHA-256 integrity hash so the incident page can honestly say:
 * "the stored file has not changed since it was hashed" — and equally honestly
 * say that a hash does not prove what happened.
 */

import type { EvidenceRecord } from '@/domain/types';

async function sha256HexHex(buffer: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Deterministic fallback used only when WebCrypto is unavailable (non-secure
 * context, very old browser). It is *not* SHA-256 — the record records which
 * method produced the hash so nothing overclaims.
 */
function fallbackHash(input: string): string {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < input.length; i += 1) {
    const ch = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const part = (n: number) => (n >>> 0).toString(16).padStart(8, '0');
  return `${part(h1)}${part(h2)}${part(h2 ^ h1)}${part(h1 + h2)}`.repeat(2).slice(0, 64);
}

export async function hashBuffer(buffer: ArrayBuffer): Promise<{ hash: string; method: EvidenceRecord['hashMethod'] }> {
  try {
    if (typeof crypto !== 'undefined' && crypto.subtle) {
      return { hash: await sha256HexHex(buffer), method: 'sha256-webcrypto' };
    }
  } catch {
    /* fall through to the documented fallback */
  }
  const bytes = new Uint8Array(buffer);
  const asString = [...bytes].map((b) => String.fromCharCode(b)).join('');
  return { hash: fallbackHash(asString), method: 'sha256-fallback' };
}

export async function createEvidenceRecord(input: {
  fileName: string;
  mimeType: string;
  buffer: ArrayBuffer;
  kind: EvidenceRecord['kind'];
  description: string;
  /**
   * When the evidence was captured, on the *simulator's* clock. Required rather
   * than defaulted: this used to be `Date.now()`, so a file added during a demo
   * journey was stamped with the wall clock and rendered as "Added 08:19" next
   * to an incident created at 22:42.
   */
  at: number;
}): Promise<EvidenceRecord> {
  const { hash, method } = await hashBuffer(input.buffer);
  return {
    id: `ev-${input.at.toString(36)}-${Math.random().toString(36).slice(2, 7)}`,
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.buffer.byteLength,
    createdAt: input.at,
    sha256: hash,
    hashMethod: method,
    kind: input.kind,
    description: input.description,
    simulated: true,
  };
}

/** Generates a small, realistic "voice note" payload entirely on-device. */
export function syntheticVoiceNoteBuffer(seconds = 3): ArrayBuffer {
  const sampleRate = 8000;
  const total = sampleRate * seconds;
  const buffer = new ArrayBuffer(44 + total);
  const view = new DataView(buffer);
  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) view.setUint8(offset + i, str.charCodeAt(i));
  };
  writeString(0, 'RIFF');
  view.setUint32(4, 36 + total, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate, true);
  view.setUint16(32, 1, true);
  view.setUint16(34, 8, true);
  writeString(36, 'data');
  view.setUint32(40, total, true);
  for (let i = 0; i < total; i += 1) {
    const value = 128 + Math.round(28 * Math.sin((i / sampleRate) * 2 * Math.PI * 220));
    view.setUint8(44 + i, Math.max(0, Math.min(255, value)));
  }
  return buffer;
}

export function evidenceAttachSummary(record: EvidenceRecord): string {
  return `${record.fileName} · ${record.hashMethod === 'sha256-webcrypto' ? 'SHA-256' : 'fallback digest'} ${record.sha256.slice(0, 12)}…`;
}
