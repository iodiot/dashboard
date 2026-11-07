import { MESSAGES, DashboardError } from './errors.js';
import { decryptEnvelope } from './crypto.js';
import { validateDashboard } from './schema.js';

export async function openDashboard(envelope, password) {
  const plaintext = await decryptEnvelope(envelope, password);
  let parsed;
  try {
    parsed = JSON.parse(plaintext);
  } catch {
    throw new DashboardError('schema', MESSAGES.schema);
  }
  try {
    return validateDashboard(parsed);
  } catch {
    throw new DashboardError('schema', MESSAGES.schema);
  }
}
