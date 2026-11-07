export class DashboardError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'DashboardError';
    this.code = code;
  }
}

export const MESSAGES = {
  auth: 'Incorrect password or damaged data',
  malformed: 'Encrypted data is malformed.',
  schema: 'Decrypted data does not match the dashboard schema.',
  load: 'Could not load encrypted data.',
  enterPassword: 'Enter a password.'
};
