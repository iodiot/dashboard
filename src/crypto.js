import { LIMITS } from './limits.js';
import { DashboardError, MESSAGES } from './errors.js';

const B64_RE = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const ENVELOPE_KEYS = new Set(['version', 'kdf', 'cipher', 'ciphertext']);
const KDF_KEYS = new Set(['name', 'hash', 'iterations', 'salt']);
const CIPHER_KEYS = new Set(['name', 'keyLength', 'iv', 'tagLength']);

function malformed() {
  return new DashboardError('malformed-envelope', MESSAGES.malformed);
}

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertExactKeys(value, allowed) {
  const keys = Object.keys(value);
  if (keys.length !== allowed.size) return false;
  return keys.every((key) => allowed.has(key));
}

export function bytesToBase64(bytes) {
  let binary = '';
  const chunk = 0x2000;
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk));
  }
  return btoa(binary);
}

export function base64ToBytes(value, minBytes, maxBytes) {
  if (typeof value !== 'string' || value.length === 0 || value.length % 4 !== 0) throw malformed();
  if (value.length > (maxBytes * 4) / 3 + 8) throw malformed();
  if (!B64_RE.test(value)) throw malformed();
  let binary;
  try {
    binary = atob(value);
  } catch {
    throw malformed();
  }
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  if (bytes.length < minBytes || bytes.length > maxBytes) throw malformed();
  if (bytesToBase64(bytes) !== value) throw malformed();
  return bytes;
}

export function validateEnvelope(value) {
  if (!isPlainObject(value) || !assertExactKeys(value, ENVELOPE_KEYS)) throw malformed();
  if (!Number.isInteger(value.version) || value.version !== 1) throw malformed();
  if (!isPlainObject(value.kdf) || !assertExactKeys(value.kdf, KDF_KEYS)) throw malformed();
  if (value.kdf.name !== 'PBKDF2' || value.kdf.hash !== 'SHA-256') throw malformed();
  if (!Number.isSafeInteger(value.kdf.iterations)) throw malformed();
  if (value.kdf.iterations < LIMITS.minIterations || value.kdf.iterations > LIMITS.maxIterations) {
    throw malformed();
  }
  if (!isPlainObject(value.cipher) || !assertExactKeys(value.cipher, CIPHER_KEYS)) throw malformed();
  if (value.cipher.name !== 'AES-GCM') throw malformed();
  if (!Number.isInteger(value.cipher.keyLength) || value.cipher.keyLength !== LIMITS.keyBits) throw malformed();
  if (!Number.isInteger(value.cipher.tagLength) || value.cipher.tagLength !== LIMITS.tagBits) throw malformed();
  const salt = base64ToBytes(value.kdf.salt, LIMITS.minSaltBytes, LIMITS.maxSaltBytes);
  const iv = base64ToBytes(value.cipher.iv, LIMITS.ivBytes, LIMITS.ivBytes);
  const ciphertext = base64ToBytes(value.ciphertext, LIMITS.minCiphertextBytes, LIMITS.maxCiphertextBytes);
  return {
    version: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: value.kdf.iterations,
      salt: bytesToBase64(salt)
    },
    cipher: {
      name: 'AES-GCM',
      keyLength: LIMITS.keyBits,
      iv: bytesToBase64(iv),
      tagLength: LIMITS.tagBits
    },
    ciphertext: bytesToBase64(ciphertext),
    saltBytes: salt,
    ivBytes: iv,
    ciphertextBytes: ciphertext
  };
}

async function deriveKey(password, salt, iterations, usages) {
  const material = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveKey']
  );
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations, hash: 'SHA-256' },
    material,
    { name: 'AES-GCM', length: LIMITS.keyBits },
    false,
    usages
  );
}

export async function encryptString(plaintext, password) {
  if (typeof password !== 'string' || password.length === 0) {
    throw new DashboardError('password', 'Password is empty.');
  }
  if (typeof plaintext !== 'string') throw new DashboardError('schema', 'Invalid dashboard JSON: root');
  const plaintextBytes = new TextEncoder().encode(plaintext);
  if (plaintextBytes.byteLength + LIMITS.tagBytes > LIMITS.maxCiphertextBytes) {
    throw new DashboardError('schema', 'Invalid dashboard JSON: root');
  }
  const salt = crypto.getRandomValues(new Uint8Array(LIMITS.saltBytes));
  const iv = crypto.getRandomValues(new Uint8Array(LIMITS.ivBytes));
  const key = await deriveKey(password, salt, LIMITS.minIterations, ['encrypt']);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv, tagLength: LIMITS.tagBits },
    key,
    plaintextBytes
  );
  const ciphertext = new Uint8Array(encrypted);
  if (ciphertext.byteLength !== plaintextBytes.byteLength + LIMITS.tagBytes) throw malformed();
  return {
    version: 1,
    kdf: {
      name: 'PBKDF2',
      hash: 'SHA-256',
      iterations: LIMITS.minIterations,
      salt: bytesToBase64(salt)
    },
    cipher: {
      name: 'AES-GCM',
      keyLength: LIMITS.keyBits,
      iv: bytesToBase64(iv),
      tagLength: LIMITS.tagBits
    },
    ciphertext: bytesToBase64(ciphertext)
  };
}

export async function decryptEnvelope(envelope, password) {
  const checked = validateEnvelope(envelope);
  if (typeof password !== 'string') {
    throw new DashboardError('auth', MESSAGES.auth);
  }
  const key = await deriveKey(password, checked.saltBytes, checked.kdf.iterations, ['decrypt']);
  let plainBuffer;
  try {
    plainBuffer = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: checked.ivBytes, tagLength: LIMITS.tagBits },
      key,
      checked.ciphertextBytes
    );
  } catch {
    throw new DashboardError('auth', MESSAGES.auth);
  }
  try {
    return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(plainBuffer);
  } catch {
    throw new DashboardError('schema', MESSAGES.schema);
  }
}
