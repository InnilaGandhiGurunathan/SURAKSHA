import { base64url, fromBase64url } from './id';

/**
 * Device-local cryptography.
 *
 * Two different jobs, deliberately kept apart:
 *  1. **Passwords** are never stored. They are stretched with PBKDF2-SHA256 and
 *     compared against a stored verifier, so the device-account fallback has the
 *     same "we cannot recover your password" property as a server account.
 *  2. **Guardian snapshots** are encrypted with AES-GCM using a key that lives
 *     only in the share URL fragment. The server therefore stores ciphertext it
 *     cannot read, which is what makes guardian sharing permission-based and
 *     privacy-preserving.
 *
 * If `crypto.subtle` is unavailable (insecure context), encryption degrades to a
 * clearly-labelled unencrypted envelope instead of pretending to be secure.
 */

const PBKDF2_ITERATIONS = 150_000;
const encoder = new TextEncoder();
const decoder = new TextDecoder();

export interface EncryptedEnvelope {
  /** `AES-GCM` when real encryption happened, `none` when it could not. */
  alg: 'AES-GCM' | 'none';
  iv?: string;
  ciphertext: string;
  /** Set when the payload is stored without encryption — surfaced in the UI. */
  warning?: string;
}

export function subtleAvailable(): boolean {
  return typeof crypto !== 'undefined' && Boolean(crypto.subtle);
}

export function randomBytes(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  return bytes;
}

/* ------------------------------- Passwords -------------------------------- */

export async function derivePasswordKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  );
}

export async function deriveVerifier(password: string, salt: Uint8Array): Promise<string> {
  const material = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, [
    'deriveBits',
  ]);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', salt: toArrayBuffer(salt), iterations: PBKDF2_ITERATIONS, hash: 'SHA-256' },
    material,
    256,
  );
  return base64url(new Uint8Array(bits));
}

/** Constant-time-ish comparison so verification does not leak prefix length. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i += 1) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

/* ------------------------------- AES-GCM ---------------------------------- */

export async function generateShareKey(): Promise<{ key: CryptoKey; encoded: string }> {
  const raw = randomBytes(32);
  const key = await crypto.subtle.importKey('raw', toArrayBuffer(raw), 'AES-GCM', true, [
    'encrypt',
    'decrypt',
  ]);
  return { key, encoded: base64url(raw) };
}

export async function importShareKey(encoded: string): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', toArrayBuffer(fromBase64url(encoded)), 'AES-GCM', false, [
    'encrypt',
    'decrypt',
  ]);
}

export async function encryptJson(value: unknown, key: CryptoKey): Promise<EncryptedEnvelope> {
  if (!subtleAvailable()) {
    return {
      alg: 'none',
      ciphertext: base64url(encoder.encode(JSON.stringify(value))),
      warning:
        'This browser cannot encrypt in the background (no WebCrypto in an insecure context). The shared snapshot is stored unencrypted — revoke the link when you are done.',
    };
  }

  const iv = randomBytes(12);
  const plaintext = encoder.encode(JSON.stringify(value));
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(plaintext),
  );
  return { alg: 'AES-GCM', iv: base64url(iv), ciphertext: base64url(new Uint8Array(ciphertext)) };
}

export async function decryptJson<T>(envelope: EncryptedEnvelope, key: CryptoKey): Promise<T> {
  if (envelope.alg === 'none') {
    return JSON.parse(decoder.decode(fromBase64url(envelope.ciphertext))) as T;
  }
  if (!envelope.iv) throw new Error('Encrypted payload is missing its initialisation vector.');
  const plaintext = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: toArrayBuffer(fromBase64url(envelope.iv)) },
    key,
    toArrayBuffer(fromBase64url(envelope.ciphertext)),
  );
  return JSON.parse(decoder.decode(plaintext)) as T;
}

/* -------------------------------- Utilities -------------------------------- */

export async function sha256(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(input));
  return base64url(new Uint8Array(digest));
}

/** Copy into a fresh ArrayBuffer so Uint8Array<ArrayBufferLike> satisfies WebCrypto. */
export function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return copy;
}

export function bytesToBlobPart(bytes: Uint8Array): ArrayBuffer {
  return toArrayBuffer(bytes);
}

/**
 * Deterministic, non-reversible hash used to key local caches that must not
 * contain readable personal data (guardian tokens, for example).
 */
export async function hashedKey(value: string): Promise<string> {
  return sha256(value);
}
