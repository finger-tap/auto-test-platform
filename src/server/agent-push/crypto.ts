// 2026-06-07: AES-256-GCM encryption for SSH credentials.
//
// We store the device row's `ssh_password` and `ssh_private_key` columns
// as AES-256-GCM ciphertext. The key comes from the AGENT_SSH_KEY_SECRET
// env var (32 raw bytes or 64 hex chars). On startup, the server warns
// and disables SSH push if the secret is missing — the rest of the
// system (heartbeats, etc.) keeps working.
//
// Format on disk: JSON `{iv, tag, ciphertext}` (all base64). AAD = the
// column name (`ssh_password` / `ssh_private_key`) so an attacker who
// reuses a ciphertext across columns breaks the MAC.
//
// Reference: src/server/auth/jwt.ts (does NOT use encryption; separate
// concern). The middleware that hands us a device row never decrypts —
// we only decrypt at the moment of an SSH push, in this module.

import crypto from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12; // GCM standard
const KEY_LEN = 32; // 256 bits

let _key: Buffer | null = null;
let _missingWarned = false;

function getKey(): Buffer | null {
  if (_key) return _key;
  const raw = process.env.AGENT_SSH_KEY_SECRET;
  if (!raw) {
    if (!_missingWarned) {
      console.warn('[agent-push:crypto] AGENT_SSH_KEY_SECRET not set — SSH push/stop endpoints will return 503');
      _missingWarned = true;
    }
    return null;
  }
  // Accept either 64 hex chars (preferred) or 32 raw bytes.
  if (/^[0-9a-fA-F]{64}$/.test(raw)) {
    _key = Buffer.from(raw, 'hex');
  } else if (Buffer.byteLength(raw, 'utf8') === KEY_LEN) {
    _key = Buffer.from(raw, 'utf8');
  } else {
    if (!_missingWarned) {
      console.warn(
        `[agent-push:crypto] AGENT_SSH_KEY_SECRET must be ${KEY_LEN} bytes (or 64 hex chars); got ${Buffer.byteLength(raw, 'utf8')} bytes — SSH push disabled`
      );
      _missingWarned = true;
    }
    return null;
  }
  return _key;
}

/** Returns true if the server has a usable SSH crypto key. */
export function isPushEnabled(): boolean {
  return getKey() !== null;
}

export interface EncryptedBlob {
  iv: string;          // base64
  tag: string;         // base64, 16 bytes
  ciphertext: string;  // base64
}

/**
 * Encrypt `plaintext` for storage in the named column. The column name is
 * used as AAD (additional authenticated data) so swapping ciphertexts
 * between columns breaks the MAC. Returns null if no key is configured.
 */
export function encryptColumn(column: 'ssh_password' | 'ssh_private_key', plaintext: string): EncryptedBlob | null {
  const key = getKey();
  if (!key) return null;
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key, iv);
  cipher.setAAD(Buffer.from(column, 'utf8'));
  const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    iv: iv.toString('base64'),
    tag: tag.toString('base64'),
    ciphertext: enc.toString('base64'),
  };
}

/**
 * Decrypt a stored blob back to plaintext. Returns null on any error
 * (bad format, wrong key, tampered ciphertext) so callers can fail
 * closed without throwing.
 */
export function decryptColumn(column: 'ssh_password' | 'ssh_private_key', stored: EncryptedBlob | string | null): string | null {
  if (!stored) return null;
  const key = getKey();
  if (!key) return null;
  let blob: EncryptedBlob;
  try {
    blob = typeof stored === 'string' ? (JSON.parse(stored) as EncryptedBlob) : stored;
    if (!blob.iv || !blob.tag || !blob.ciphertext) return null;
  } catch {
    return null;
  }
  try {
    const iv = Buffer.from(blob.iv, 'base64');
    const tag = Buffer.from(blob.tag, 'base64');
    const ct = Buffer.from(blob.ciphertext, 'base64');
    if (iv.length !== IV_LEN) return null;
    const decipher = crypto.createDecipheriv(ALGO, key, iv);
    decipher.setAuthTag(tag);
    decipher.setAAD(Buffer.from(column, 'utf8'));
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Convenience: serialize a blob to the string form we store in SQLite. */
export function serializeBlob(blob: EncryptedBlob): string {
  return JSON.stringify(blob);
}
