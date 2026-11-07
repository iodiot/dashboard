import { LIMITS } from './limits.js';
import { MESSAGES } from './errors.js';
import { validateEnvelope } from './crypto.js';

function publicEnvelope(envelope) {
  return {
    version: envelope.version,
    kdf: {
      name: envelope.kdf.name,
      hash: envelope.kdf.hash,
      iterations: envelope.kdf.iterations,
      salt: envelope.kdf.salt
    },
    cipher: {
      name: envelope.cipher.name,
      keyLength: envelope.cipher.keyLength,
      iv: envelope.cipher.iv,
      tagLength: envelope.cipher.tagLength
    },
    ciphertext: envelope.ciphertext
  };
}

export async function loadEncryptedDashboard(url, fetchImpl = globalThis.fetch) {
  let response;
  try {
    response = await fetchImpl(url, { cache: 'no-store', credentials: 'omit', redirect: 'follow' });
  } catch {
    return { state: 'load-error', message: MESSAGES.load };
  }
  if (response && typeof response.url === 'string' && response.url !== '') {
    let finalUrl;
    let expectedUrl;
    try {
      finalUrl = new URL(response.url);
      expectedUrl = new URL(url);
    } catch {
      return { state: 'load-error', message: MESSAGES.load };
    }
    if (finalUrl.origin !== expectedUrl.origin || finalUrl.pathname !== expectedUrl.pathname) {
      return { state: 'load-error', message: MESSAGES.load };
    }
  }
  if (!response || response.status === 404 || response.status === 204) {
    return { state: 'setup-pending' };
  }
  if (response.ok !== true) return { state: 'load-error', message: MESSAGES.load };
  let text;
  try {
    text = await response.text();
  } catch {
    return { state: 'load-error', message: MESSAGES.load };
  }
  if (typeof text !== 'string') return { state: 'malformed', message: MESSAGES.malformed };
  if (text.length === 0 || text.trim() === '') return { state: 'setup-pending' };
  if (text.length > LIMITS.maxEnvelopeChars) return { state: 'malformed', message: MESSAGES.malformed };
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { state: 'malformed', message: MESSAGES.malformed };
  }
  try {
    return { state: 'locked', envelope: publicEnvelope(validateEnvelope(parsed)) };
  } catch {
    return { state: 'malformed', message: MESSAGES.malformed };
  }
}
