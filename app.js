import { MESSAGES, DashboardError } from './src/errors.js';
import { DATA_URL } from './src/data-url.js';
import { loadEncryptedDashboard } from './src/load.js';
import { openDashboard } from './src/open.js';
import { normalizeHttpUrl } from './src/schema.js';

const app = document.querySelector('#app');
const titleEl = document.querySelector('#title');
const noteEl = document.querySelector('#note');
const updatedEl = document.querySelector('#updated');
const countEl = document.querySelector('#count');
const lockSlot = document.querySelector('#lock-slot');
const mainEl = document.querySelector('#content');

const state = {
  envelope: null,
  dashboard: null
};

let busy = false;

const STAMP = new Intl.DateTimeFormat('en-US', {
  timeZone: 'UTC',
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23'
});

const STATUS_LABEL = {
  active: 'Active',
  idle: 'Idle',
  blocked: 'Blocked'
};

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setState(phase) {
  document.documentElement.dataset.state = phase;
  if (mainEl) mainEl.setAttribute('aria-busy', phase === 'loading' || phase === 'unlocking' ? 'true' : 'false');
}

function formatStamp(iso) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return `${STAMP.format(date)} UTC`;
}

function clearDecrypted() {
  state.dashboard = null;
  document.title = 'Dashboard';
  titleEl.textContent = 'Dashboard';
  noteEl.textContent = '';
  noteEl.hidden = true;
  updatedEl.textContent = '';
  updatedEl.hidden = true;
  countEl.textContent = '';
  countEl.hidden = true;
  lockSlot.replaceChildren();
}

function addLockButton() {
  const button = el('button', 'btn btn-ghost', 'Lock');
  button.type = 'button';
  button.addEventListener('click', () => {
    clearDecrypted();
    renderLocked();
  });
  lockSlot.replaceChildren(button);
}

function renderMessage(className, text, role) {
  const node = el('p', className, text);
  if (role) node.setAttribute('role', role);
  return node;
}

function renderLoading() {
  clearDecrypted();
  setState('loading');
  app.replaceChildren(renderMessage('status-line', 'Loading encrypted data…', 'status'));
}

function renderSetupPending() {
  clearDecrypted();
  setState('setup-pending');
  const panel = el('section', 'panel pending');
  panel.append(
    el('h2', null, 'Setup pending'),
    el('p', null, 'No ciphertext has been published yet. Decryption stays off until data.enc.json is in the public data repository.')
  );
  const retry = el('button', 'btn btn-ghost', 'Check again');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    void boot();
  });
  panel.append(retry);
  app.replaceChildren(panel);
}

function renderLoadError() {
  clearDecrypted();
  setState('load-error');
  const panel = el('section', 'panel');
  const retry = el('button', 'btn btn-primary', 'Retry');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    void boot();
  });
  panel.append(renderMessage('alert', MESSAGES.load, 'alert'), retry);
  app.replaceChildren(panel);
}

function renderMalformed() {
  state.envelope = null;
  clearDecrypted();
  setState('malformed');
  const panel = el('section', 'panel');
  const retry = el('button', 'btn btn-primary', 'Retry');
  retry.type = 'button';
  retry.addEventListener('click', () => {
    void boot();
  });
  panel.append(renderMessage('alert', MESSAGES.malformed, 'alert'), retry);
  app.replaceChildren(panel);
}

function renderLocked({ message, password, invalid } = {}) {
  clearDecrypted();
  const phase = message === MESSAGES.auth
    ? 'auth-error'
    : message === MESSAGES.schema
      ? 'schema-error'
      : message === MESSAGES.enterPassword
        ? 'locked'
        : 'locked';
  setState(phase);
  if (message === MESSAGES.auth || message === MESSAGES.schema) addLockButton();
  const panel = el('section', message ? 'panel is-error' : 'panel');
  panel.append(
    el('h2', null, 'Unlock'),
    el('p', 'lede', 'Enter the password for this dashboard. It is used only in this browser and is not saved.')
  );
  if (message) {
    const alert = renderMessage('alert', message, 'alert');
    alert.id = 'feedback';
    panel.append(alert);
  }
  const field = el('label', 'field');
  field.append(el('span', null, 'Password'));
  const input = document.createElement('input');
  input.id = 'password';
  input.type = 'password';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.autocapitalize = 'off';
  input.setAttribute('autocorrect', 'off');
  input.setAttribute('autocomplete', 'off');
  if (message) input.setAttribute('aria-describedby', 'feedback');
  if (invalid) input.setAttribute('aria-invalid', 'true');
  if (typeof password === 'string') input.value = password;
  field.append(input);
  const submit = el('button', 'btn btn-primary', 'Unlock');
  submit.type = 'button';
  const run = () => {
    const entered = input.value;
    input.value = '';
    void unlock(entered);
  };
  submit.addEventListener('click', run);
  input.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    run();
  });
  panel.append(field, submit);
  app.replaceChildren(panel);
  input.focus();
}

function renderUnlocking() {
  clearDecrypted();
  setState('unlocking');
  const panel = el('section', 'panel');
  const input = document.createElement('input');
  input.type = 'password';
  input.disabled = true;
  input.value = '';
  input.setAttribute('aria-hidden', 'true');
  input.tabIndex = -1;
  const submit = el('button', 'btn btn-primary', 'Unlocking…');
  submit.type = 'button';
  submit.disabled = true;
  panel.append(
    el('h2', null, 'Unlock'),
    renderMessage('status-line', 'Unlocking…', 'status'),
    input,
    submit
  );
  app.replaceChildren(panel);
}

function safeLink(link) {
  const href = normalizeHttpUrl(link.url);
  if (href === null || (href.slice(0, 7) !== 'http://' && href.slice(0, 8) !== 'https://')) return null;
  const anchor = document.createElement('a');
  anchor.href = href;
  anchor.textContent = link.label;
  anchor.target = '_blank';
  anchor.rel = 'noopener noreferrer';
  anchor.referrerPolicy = 'no-referrer';
  return anchor;
}

function renderBot(bot) {
  const article = el('article', STATUS_LABEL[bot.status] ? `bot bot-${bot.status}` : 'bot');
  const head = el('div', 'bot-head');
  head.append(el('h2', null, bot.name));
  const pillClass = STATUS_LABEL[bot.status] ? `pill pill-${bot.status}` : 'pill';
  head.append(el('p', pillClass, STATUS_LABEL[bot.status] || bot.status));
  const summary = el('p', 'summary', bot.summary);
  article.append(head, el('p', 'bot-id', bot.id), summary);
  if (bot.details) article.append(el('p', 'details', bot.details));
  if (bot.tags) {
    const tags = el('ul', 'tags');
    for (const tag of bot.tags) tags.append(el('li', null, tag));
    article.append(tags);
  }
  const next = el('div', 'next');
  next.append(el('p', 'kicker', 'Next action'));
  next.append(el('p', bot.nextAction === null ? 'muted' : null, bot.nextAction === null ? 'No next action' : bot.nextAction));
  article.append(next);
  if (bot.links.length > 0) {
    const links = el('div', 'links-wrap');
    links.append(el('p', 'kicker', 'Links'));
    const list = el('ul', 'links');
    for (const link of bot.links) {
      const anchor = safeLink(link);
      if (!anchor) continue;
      const item = el('li');
      item.append(anchor);
      list.append(item);
    }
    links.append(list);
    article.append(links);
  }
  const updated = el('p', 'updated');
  updated.append(el('span', null, 'Updated '));
  const time = document.createElement('time');
  time.dateTime = bot.updatedAt;
  time.textContent = formatStamp(bot.updatedAt);
  updated.append(time);
  article.append(updated);
  return article;
}

function renderUnlocked() {
  const dashboard = state.dashboard;
  clearDecrypted();
  state.dashboard = dashboard;
  setState('unlocked');
  document.title = dashboard.title;
  titleEl.textContent = dashboard.title;
  if (dashboard.note) {
    noteEl.hidden = false;
    noteEl.textContent = dashboard.note;
  }
  updatedEl.hidden = false;
  const updatedTime = document.createElement('time');
  updatedTime.dateTime = dashboard.updatedAt;
  updatedTime.textContent = formatStamp(dashboard.updatedAt);
  updatedEl.append(el('span', null, 'Last updated '), updatedTime);
  const count = dashboard.bots.length;
  countEl.hidden = false;
  countEl.textContent = count === 1 ? '1 bot' : `${count} bots`;
  addLockButton();
  if (count === 0) {
    app.replaceChildren(el('p', 'empty', 'No bots in this dashboard yet.'));
    return;
  }
  const grid = el('div', 'bot-grid');
  for (const bot of dashboard.bots) grid.append(renderBot(bot));
  app.replaceChildren(grid);
}

async function unlock(password) {
  if (busy) return;
  if (typeof password !== 'string' || password.length === 0) {
    renderLocked({ message: MESSAGES.enterPassword, invalid: true });
    return;
  }
  busy = true;
  try {
    renderUnlocking();
    await new Promise((resolve) => {
      setTimeout(resolve, 40);
    });
    state.dashboard = await openDashboard(state.envelope, password);
    renderUnlocked();
  } catch (error) {
    state.dashboard = null;
    if (error instanceof DashboardError && error.code === 'auth') {
      renderLocked({ message: MESSAGES.auth, password, invalid: true });
    } else if (error instanceof DashboardError && error.code === 'malformed-envelope') {
      renderMalformed();
    } else {
      renderLocked({ message: MESSAGES.schema, invalid: true });
    }
  } finally {
    busy = false;
  }
}

async function boot() {
  if (busy) return;
  busy = true;
  renderLoading();
  try {
    const result = await loadEncryptedDashboard(DATA_URL);
    state.dashboard = null;
    if (result.state === 'locked') {
      state.envelope = result.envelope;
      renderLocked();
      return;
    }
    state.envelope = null;
    if (result.state === 'setup-pending') renderSetupPending();
    else if (result.state === 'malformed') renderMalformed();
    else renderLoadError();
  } finally {
    busy = false;
  }
}

void boot();
