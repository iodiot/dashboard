import { MESSAGES, DashboardError } from './src/errors.js';
import { DATA_URL } from './src/data-url.js';
import { loadEncryptedDashboard } from './src/load.js';
import { openDashboard } from './src/open.js';
import { normalizeHttpUrl } from './src/schema.js';
import { localTimeZone, upcomingDays, overlapsCivilDay } from './src/time.js';

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

const view = {
  tab: 'bots',
  botQuery: '',
  botStatus: 'all',
  eventQuery: '',
  eventCategory: 'all',
  eventLimit: 10,
  calendarPage: 0
};

const TABS = [
  { id: 'bots', label: 'Bots' },
  { id: 'handoffs', label: 'Handoffs' },
  { id: 'events', label: 'Events' },
  { id: 'calendar', label: 'Calendar' },
  { id: 'usage', label: 'Usage' }
];

const CATEGORY_LABEL = {
  application: 'Application',
  recruiter: 'Recruiter',
  social: 'Social',
  calendar: 'Calendar'
};

const SVG = 'http://www.w3.org/2000/svg';

function resetView() {
  view.tab = 'bots';
  view.botQuery = '';
  view.botStatus = 'all';
  view.eventQuery = '';
  view.eventCategory = 'all';
  view.eventLimit = 10;
  view.calendarPage = 0;
}

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

function zoneOf(dashboard) {
  return dashboard && dashboard.timezone ? dashboard.timezone : localTimeZone();
}

function formatStamp(iso, timeZone = zoneOf(state.dashboard)) {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
    timeZoneName: 'short'
  }).format(date);
}

function formatClock(iso, timeZone) {
  return new Intl.DateTimeFormat('en-US', {
    timeZone,
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23'
  }).format(new Date(iso));
}

function formatCivilDay(key) {
  const [year, month, day] = key.split('-').map(Number);
  return new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC',
    weekday: 'short',
    month: 'short',
    day: 'numeric'
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

function formatAmount(value) {
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 4 }).format(value);
}

function amountText(used, limit, unit) {
  const suffix = unit ? ` ${unit}` : '';
  if (limit > 0) return `${formatAmount(used)} / ${formatAmount(limit)}${suffix}`;
  return `${formatAmount(used)}${suffix}`;
}

function rowAmountText(row, unit) {
  if (row.limit === undefined || row.limit === 0) return amountText(row.used, 0, unit);
  return amountText(row.used, row.limit, unit);
}

function clearDecrypted() {
  resetView();
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

function listOf(dashboard, key) {
  const value = dashboard[key];
  return Array.isArray(value) ? value : [];
}

function botById(dashboard, id) {
  return dashboard.bots.find((bot) => bot.id === id) || null;
}

function botLabel(dashboard, id) {
  const bot = botById(dashboard, id);
  return bot ? bot.name : id;
}

function includesQuery(query, parts) {
  if (query === '') return true;
  const needle = query.toLocaleLowerCase();
  return parts.some((part) => String(part).toLocaleLowerCase().includes(needle));
}

function captureFocus() {
  const active = document.activeElement;
  if (!active || !active.id) return null;
  return {
    id: active.id,
    start: typeof active.selectionStart === 'number' ? active.selectionStart : null,
    end: typeof active.selectionEnd === 'number' ? active.selectionEnd : null
  };
}

function restoreFocus(saved) {
  if (!saved) return;
  const node = document.getElementById(saved.id);
  if (!node) return;
  node.focus();
  if (saved.start !== null && node.setSelectionRange) node.setSelectionRange(saved.start, saved.end);
}

function syncTabs() {
  for (const button of document.querySelectorAll('[role="tab"]')) {
    const selected = button.dataset.tab === view.tab;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
  }
}

function replacePanel() {
  const saved = captureFocus();
  const current = document.getElementById('panel');
  if (!current || !state.dashboard) return;
  current.replaceWith(renderPanel(state.dashboard));
  restoreFocus(saved);
}

function selectTab(id, focus) {
  view.tab = id;
  syncTabs();
  replacePanel();
  if (focus) {
    const button = document.getElementById(`tab-${id}`);
    if (button) button.focus();
  }
}

function onTabKey(event) {
  const order = TABS.map((tab) => tab.id);
  const index = order.indexOf(event.currentTarget.dataset.tab);
  if (index < 0) return;
  let next = null;
  if (event.key === 'ArrowRight') next = order[(index + 1) % order.length];
  else if (event.key === 'ArrowLeft') next = order[(index - 1 + order.length) % order.length];
  else if (event.key === 'Home') next = order[0];
  else if (event.key === 'End') next = order[order.length - 1];
  else return;
  event.preventDefault();
  selectTab(next, true);
}

function renderTablist() {
  const list = el('div', 'tablist');
  list.setAttribute('role', 'tablist');
  list.setAttribute('aria-label', 'Sections');
  for (const tab of TABS) {
    const button = el('button', 'tab', tab.label);
    button.type = 'button';
    button.id = `tab-${tab.id}`;
    button.dataset.tab = tab.id;
    button.setAttribute('role', 'tab');
    button.setAttribute('aria-controls', 'panel');
    const selected = view.tab === tab.id;
    button.setAttribute('aria-selected', selected ? 'true' : 'false');
    button.tabIndex = selected ? 0 : -1;
    button.addEventListener('click', () => selectTab(tab.id, false));
    button.addEventListener('keydown', onTabKey);
    list.append(button);
  }
  return list;
}

function renderCaption(text) {
  return el('p', 'caption', text);
}

function renderEmpty(text) {
  return el('p', 'empty', text);
}

function renderFilterButton(label, pressed, onClick) {
  const button = el('button', pressed ? 'chip is-on' : 'chip', label);
  button.type = 'button';
  button.setAttribute('aria-pressed', pressed ? 'true' : 'false');
  button.addEventListener('click', onClick);
  return button;
}

function renderSearch(id, label, value, onInput) {
  const field = el('label', 'search');
  field.append(el('span', null, label));
  const input = document.createElement('input');
  input.id = id;
  input.type = 'search';
  input.autocomplete = 'off';
  input.spellcheck = false;
  input.value = value;
  input.setAttribute('autocomplete', 'off');
  input.addEventListener('input', () => onInput(input.value));
  field.append(input);
  return field;
}

function renderBotCard(bot) {
  const article = el('article', STATUS_LABEL[bot.status] ? `bot bot-${bot.status}` : 'bot');
  const head = el('div', 'bot-head');
  const title = el('h3', null, bot.name);
  head.append(title);
  const pillClass = STATUS_LABEL[bot.status] ? `pill pill-${bot.status}` : 'pill';
  head.append(el('p', pillClass, STATUS_LABEL[bot.status] || bot.status));
  article.append(head, el('p', 'bot-id', bot.id), el('p', 'summary', bot.summary));
  const next = el('div', 'next');
  next.append(el('p', 'kicker', 'Next action'));
  next.append(el('p', bot.nextAction === null ? 'muted' : null, bot.nextAction === null ? 'No next action' : bot.nextAction));
  article.append(next);
  const updated = el('p', 'updated');
  updated.append(el('span', null, 'Updated '));
  const time = document.createElement('time');
  time.dateTime = bot.updatedAt;
  time.textContent = formatStamp(bot.updatedAt);
  updated.append(time);
  article.append(updated);
  const extra = Boolean(bot.details) || Boolean(bot.tags) || bot.links.length > 0;
  if (extra) {
    const details = document.createElement('details');
    details.className = 'more';
    const summary = document.createElement('summary');
    summary.textContent = 'Details';
    details.append(summary);
    if (bot.details) details.append(el('p', 'details', bot.details));
    if (bot.tags) {
      const tags = el('ul', 'tags');
      for (const tag of bot.tags) tags.append(el('li', null, tag));
      details.append(tags);
    }
    if (bot.links.length > 0) {
      const list = el('ul', 'links');
      for (const link of bot.links) {
        const anchor = safeLink(link);
        if (!anchor) continue;
        const item = el('li');
        item.append(anchor);
        list.append(item);
      }
      details.append(list);
    }
    article.append(details);
  }
  return article;
}

function renderBots(dashboard) {
  const panel = el('section', 'panel-block');
  panel.append(el('h2', null, 'Bots'), renderCaption('Status is a label from the decrypted file, not a live check.'));
  const tiles = el('div', 'tiles');
  for (const status of ['active', 'idle', 'blocked']) {
    const count = dashboard.bots.filter((bot) => bot.status === status).length;
    const tile = el('article', `tile tile-${status}`);
    tile.append(el('p', 'kicker', STATUS_LABEL[status]), el('p', 'tile-count', String(count)));
    tiles.append(tile);
  }
  panel.append(tiles);
  if (dashboard.bots.length === 0) {
    panel.append(renderEmpty('No bots in this dashboard.'));
    return panel;
  }
  const controls = el('div', 'controls');
  const filters = el('div', 'chips');
  filters.setAttribute('role', 'group');
  filters.setAttribute('aria-label', 'Status');
  const choices = ['all', ...['active', 'idle', 'blocked'].filter((status) => dashboard.bots.some((bot) => bot.status === status))];
  for (const status of choices) {
    const count = status === 'all' ? dashboard.bots.length : dashboard.bots.filter((bot) => bot.status === status).length;
    const label = status === 'all' ? `All ${count}` : `${STATUS_LABEL[status]} ${count}`;
    filters.append(renderFilterButton(label, view.botStatus === status, () => {
      view.botStatus = status;
      replacePanel();
    }));
  }
  controls.append(filters, renderSearch('bot-search', 'Search bots', view.botQuery, (value) => {
    view.botQuery = value;
    replacePanel();
  }));
  panel.append(controls);
  const matched = dashboard.bots.filter((bot) => {
    if (view.botStatus !== 'all' && bot.status !== view.botStatus) return false;
    return includesQuery(view.botQuery, [
      bot.name,
      bot.id,
      bot.summary,
      bot.nextAction || '',
      bot.details || '',
      ...(bot.tags || [])
    ]);
  });
  const live = el('p', 'result-count');
  live.setAttribute('aria-live', 'polite');
  live.textContent = matched.length === 1 ? '1 bot matches.' : `${matched.length} bots match.`;
  panel.append(live);
  if (matched.length === 0) {
    panel.append(renderEmpty('No bots match.'));
    return panel;
  }
  const grid = el('div', 'bot-grid');
  for (const bot of matched) grid.append(renderBotCard(bot));
  panel.append(grid);
  return panel;
}

function renderHandoffs(dashboard) {
  const panel = el('section', 'panel-block');
  panel.append(el('h2', null, 'Handoffs'), renderCaption('Only links present in the decrypted file are shown.'));
  const handoffs = listOf(dashboard, 'handoffs');
  if (handoffs.length === 0) {
    panel.append(renderEmpty('No handoffs in this dashboard.'));
    return panel;
  }
  panel.append(renderGraph(dashboard, handoffs), renderHandoffList(dashboard, handoffs));
  return panel;
}

function renderGraph(dashboard, handoffs) {
  const wrap = el('div', 'graph-wrap');
  const indegree = new Map(dashboard.bots.map((bot) => [bot.id, 0]));
  for (const handoff of handoffs) indegree.set(handoff.to, (indegree.get(handoff.to) || 0) + 1);
  const columns = [];
  for (const bot of dashboard.bots) {
    const column = indegree.get(bot.id) || 0;
    while (columns.length <= column) columns.push([]);
    columns[column].push(bot);
  }
  const boxW = 168;
  const boxH = 56;
  const colW = 320;
  const rowH = 88;
  const positions = new Map();
  columns.forEach((column, columnIndex) => {
    column.forEach((bot, rowIndex) => {
      positions.set(bot.id, { x: 16 + columnIndex * colW, y: 16 + rowIndex * rowH, bot });
    });
  });
  const width = 16 + columns.length * colW;
  const height = 16 + Math.max(1, ...columns.map((column) => column.length)) * rowH;
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('class', 'graph');
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', 'Handoff diagram');
  const defs = document.createElementNS(SVG, 'defs');
  const marker = document.createElementNS(SVG, 'marker');
  marker.setAttribute('id', 'arrowhead');
  marker.setAttribute('viewBox', '0 0 10 10');
  marker.setAttribute('refX', '9');
  marker.setAttribute('refY', '5');
  marker.setAttribute('markerWidth', '7');
  marker.setAttribute('markerHeight', '7');
  marker.setAttribute('orient', 'auto-start-reverse');
  const head = document.createElementNS(SVG, 'path');
  head.setAttribute('d', 'M 0 0 L 10 5 L 0 10 z');
  head.setAttribute('class', 'arrow-head');
  marker.append(head);
  defs.append(marker);
  svg.append(defs);
  handoffs.forEach((handoff, index) => {
    const from = positions.get(handoff.from);
    const to = positions.get(handoff.to);
    if (!from || !to) return;
    const same = from.bot.id === to.bot.id;
    const forward = from.x <= to.x;
    const x1 = same ? from.x + boxW / 2 : (forward ? from.x + boxW : from.x);
    const y1 = from.y + boxH / 2;
    const x2 = same ? from.x + boxW / 2 + 36 : (forward ? to.x : to.x + boxW);
    const y2 = same ? from.y + boxH / 2 : to.y + boxH / 2;
    const path = document.createElementNS(SVG, 'path');
    const d = same
      ? `M ${x1} ${from.y} C ${x1} ${from.y - 28}, ${x2} ${from.y - 28}, ${x2} ${y2}`
      : `M ${x1} ${y1} L ${x2} ${y2}`;
    path.setAttribute('d', d);
    path.setAttribute('class', 'edge');
    path.dataset.from = handoff.from;
    path.dataset.to = handoff.to;
    path.setAttribute('marker-end', 'url(#arrowhead)');
    svg.append(path);
    const label = document.createElementNS(SVG, 'text');
    label.setAttribute('class', 'edge-label');
    label.setAttribute('text-anchor', 'middle');
    label.setAttribute('x', String((x1 + x2) / 2));
    label.setAttribute('y', String(Math.min(y1, y2) - 10));
    label.textContent = handoff.what;
    svg.append(label);
    void index;
  });
  for (const [id, position] of positions) {
    const group = document.createElementNS(SVG, 'g');
    group.setAttribute('class', `node node-${position.bot.status}`);
    group.dataset.node = id;
    const rect = document.createElementNS(SVG, 'rect');
    rect.setAttribute('x', String(position.x));
    rect.setAttribute('y', String(position.y));
    rect.setAttribute('width', String(boxW));
    rect.setAttribute('height', String(boxH));
    rect.setAttribute('rx', '12');
    const text = document.createElementNS(SVG, 'text');
    text.setAttribute('x', String(position.x + 12));
    text.setAttribute('y', String(position.y + 34));
    text.textContent = position.bot.name;
    group.append(rect, text);
    group.addEventListener('mouseenter', () => highlightNode(svg, id));
    group.addEventListener('mouseleave', () => svg.classList.remove('is-hot'));
    group.addEventListener('focus', () => highlightNode(svg, id));
    group.addEventListener('blur', () => svg.classList.remove('is-hot'));
    group.tabIndex = 0;
    svg.append(group);
  }
  wrap.append(svg);
  return wrap;
}

function highlightNode(svg, id) {
  svg.classList.add('is-hot');
  for (const node of svg.querySelectorAll('[data-node]')) node.classList.toggle('is-on', node.dataset.node === id);
  for (const edge of svg.querySelectorAll('.edge')) {
    edge.classList.toggle('is-on', edge.dataset.from === id || edge.dataset.to === id);
  }
}

function renderHandoffList(dashboard, handoffs) {
  const list = el('ol', 'handoff-list');
  handoffs.forEach((handoff, index) => {
    const item = el('li');
    if (handoff.id) item.dataset.handoffId = handoff.id;
    const line = el('p', 'handoff-line');
    line.append(
      el('span', null, botLabel(dashboard, handoff.from)),
      el('span', 'muted', ' → '),
      el('span', null, botLabel(dashboard, handoff.to))
    );
    item.append(line, el('p', null, handoff.what));
    list.append(item);
    void index;
  });
  return list;
}

function renderEvents(dashboard) {
  const panel = el('section', 'panel-block');
  panel.append(el('h2', null, 'Events'), renderCaption('Newest first.'));
  const events = listOf(dashboard, 'events').map((item, index) => ({ item, index }));
  if (events.length === 0) {
    panel.append(renderEmpty('No events in this dashboard.'));
    return panel;
  }
  const categories = ['application', 'recruiter', 'social', 'calendar'].filter((category) => events.some((entry) => entry.item.category === category));
  const controls = el('div', 'controls');
  const chips = el('div', 'chips');
  chips.setAttribute('role', 'group');
  chips.setAttribute('aria-label', 'Event category');
  chips.append(renderFilterButton(`All ${events.length}`, view.eventCategory === 'all', () => {
    view.eventCategory = 'all';
    view.eventLimit = 10;
    replacePanel();
  }));
  for (const category of categories) {
    const count = events.filter((entry) => entry.item.category === category).length;
    chips.append(renderFilterButton(`${CATEGORY_LABEL[category]} ${count}`, view.eventCategory === category, () => {
      view.eventCategory = category;
      view.eventLimit = 10;
      replacePanel();
    }));
  }
  controls.append(chips, renderSearch('event-search', 'Search events', view.eventQuery, (value) => {
    view.eventQuery = value;
    view.eventLimit = 10;
    replacePanel();
  }));
  panel.append(controls);
  const matched = events.filter(({ item }) => {
    if (view.eventCategory !== 'all' && item.category !== view.eventCategory) return false;
    return includesQuery(view.eventQuery, [item.title, item.summary || '', item.id, item.botId ? botLabel(dashboard, item.botId) : '']);
  }).sort((a, b) => Date.parse(b.item.at) - Date.parse(a.item.at) || a.index - b.index);
  const live = el('p', 'result-count');
  live.setAttribute('aria-live', 'polite');
  live.textContent = matched.length === 1 ? '1 event matches.' : `${matched.length} events match.`;
  panel.append(live);
  if (matched.length === 0) {
    panel.append(renderEmpty('No events match.'));
    return panel;
  }
  const feed = el('ol', 'feed');
  for (const { item } of matched.slice(0, view.eventLimit)) {
    const row = el('li', 'event');
    const time = document.createElement('time');
    time.dateTime = item.at;
    time.textContent = formatStamp(item.at);
    const body = el('div', 'event-body');
    const head = el('div', 'bot-head');
    head.append(el('h3', null, item.title), el('p', 'pill', CATEGORY_LABEL[item.category] || item.category));
    body.append(head);
    if (item.summary) body.append(el('p', 'summary', item.summary));
    if (item.botId) body.append(el('p', 'muted', botLabel(dashboard, item.botId)));
    if (item.url) {
      const anchor = safeLink({ label: 'Open', url: item.url });
      if (anchor) body.append(anchor);
    }
    row.append(time, body);
    feed.append(row);
  }
  panel.append(feed);
  if (matched.length > view.eventLimit) {
    const more = el('button', 'btn btn-ghost', 'Show more');
    more.type = 'button';
    more.addEventListener('click', () => {
      view.eventLimit += 10;
      replacePanel();
    });
    panel.append(more);
  }
  return panel;
}

function renderCalendar(dashboard) {
  const panel = el('section', 'panel-block');
  const zone = zoneOf(dashboard);
  panel.append(el('h2', null, 'Calendar'), renderCaption('Three days from today. Times use the file time zone when one is set, otherwise this browser’s time zone.'));
  const items = listOf(dashboard, 'calendar');
  const nav = el('div', 'cal-nav');
  const previous = el('button', 'chip', 'Previous 3 days');
  previous.type = 'button';
  previous.addEventListener('click', () => {
    view.calendarPage -= 1;
    replacePanel();
  });
  const next = el('button', 'chip', 'Next 3 days');
  next.type = 'button';
  next.addEventListener('click', () => {
    view.calendarPage += 1;
    replacePanel();
  });
  nav.append(previous, next);
  panel.append(nav);
  if (items.length === 0) {
    panel.append(renderEmpty('No calendar entries in this dashboard.'));
    return panel;
  }
  const days = upcomingDays(zone, view.calendarPage);
  const grid = el('div', 'days');
  let visible = 0;
  for (const day of days) {
    const column = el('section', 'day');
    column.append(el('h3', null, formatCivilDay(day)));
    const rows = items.filter((item) => overlapsCivilDay(item, day, zone))
      .sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    visible += rows.length;
    if (rows.length === 0) column.append(el('p', 'muted', 'Nothing scheduled.'));
    const list = el('ul', 'day-list');
    for (const item of rows) {
      const row = el('li');
      const when = document.createElement('time');
      when.dateTime = item.startsAt;
      when.textContent = item.endsAt
        ? `${formatClock(item.startsAt, zone)}–${formatClock(item.endsAt, zone)}`
        : formatClock(item.startsAt, zone);
      row.append(when, el('h4', null, item.title));
      if (item.where) row.append(el('p', null, item.where));
      if (item.summary) row.append(el('p', 'summary', item.summary));
      if (item.botId) row.append(el('p', 'muted', botLabel(dashboard, item.botId)));
      if (item.url) {
        const anchor = safeLink({ label: 'Open', url: item.url });
        if (anchor) row.append(anchor);
      }
      list.append(row);
    }
    if (rows.length > 0) column.append(list);
    grid.append(column);
  }
  if (visible === 0) {
    panel.append(renderEmpty(view.calendarPage === 0 ? 'No upcoming entries.' : 'Nothing scheduled in these three days.'));
  }
  panel.append(grid);
  return panel;
}

function renderUsage(dashboard) {
  const panel = el('section', 'panel-block');
  panel.append(el('h2', null, 'Usage'), renderCaption('Figures compare used with limit. A unit is shown only when the file supplies one.'));
  if (!dashboard.usage) {
    panel.append(renderEmpty('No usage figures in this dashboard.'));
    return panel;
  }
  const { used, limit, resetAt, byBot, unit } = dashboard.usage;
  const figure = el('div', 'usage-top');
  figure.append(renderDonut(used, limit, unit));
  const copy = el('div');
  const summary = el('p', 'usage-figure');
  summary.textContent = amountText(used, limit, unit);
  const reset = el('p', 'updated');
  reset.append(el('span', null, 'Resets '));
  const time = document.createElement('time');
  time.dateTime = resetAt;
  time.textContent = formatStamp(resetAt);
  reset.append(time);
  copy.append(summary, reset);
  if (limit === 0) copy.append(el('p', 'muted', 'No limit.'));
  else if (used > limit) copy.append(el('p', 'over', 'Over the limit.'));
  figure.append(copy);
  panel.append(figure);
  if (byBot.length === 0) {
    panel.append(renderEmpty('No per-bot breakdown in this dashboard.'));
    return panel;
  }
  const scale = Math.max(limit, ...byBot.map((row) => Math.max(row.used, row.limit || 0)), 1);
  const list = el('ul', 'bars');
  for (const row of byBot) {
    const item = el('li');
    const name = botLabel(dashboard, row.botId);
    const label = el('p', 'bar-label');
    label.append(el('span', null, name), el('span', null, rowAmountText(row, unit)));
    item.append(label, renderBar(name, row.used, scale));
    list.append(item);
  }
  panel.append(list);
  return panel;
}

function renderDonut(used, limit, unit) {
  const ratio = limit > 0 ? Math.min(1, used / limit) : 0;
  const radius = 42;
  const circumference = 2 * Math.PI * radius;
  const dash = (ratio * circumference).toFixed(2);
  const gap = (circumference - ratio * circumference).toFixed(2);
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 120 120');
  svg.setAttribute('class', 'donut');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', limit > 0 ? `${formatAmount(used)} of ${formatAmount(limit)}${unit ? ` ${unit}` : ''}` : `${formatAmount(used)}${unit ? ` ${unit}` : ''}, no limit`);
  const track = document.createElementNS(SVG, 'circle');
  track.setAttribute('cx', '60');
  track.setAttribute('cy', '60');
  track.setAttribute('r', String(radius));
  track.setAttribute('class', 'donut-track');
  const arc = document.createElementNS(SVG, 'circle');
  arc.setAttribute('cx', '60');
  arc.setAttribute('cy', '60');
  arc.setAttribute('r', String(radius));
  arc.setAttribute('class', limit > 0 && used > limit ? 'donut-arc is-over' : 'donut-arc');
  arc.setAttribute('stroke-dasharray', `${dash} ${gap}`);
  arc.setAttribute('stroke-dashoffset', String((circumference / 4).toFixed(2)));
  const text = document.createElementNS(SVG, 'text');
  text.setAttribute('x', '60');
  text.setAttribute('y', '66');
  text.setAttribute('text-anchor', 'middle');
  text.setAttribute('class', 'donut-label');
  text.textContent = limit > 0 ? `${Math.round((used / limit) * 100)}%` : '—';
  svg.append(track, arc, text);
  return svg;
}

function renderBar(name, used, scale) {
  const width = Math.max(0, Math.min(100, (used / scale) * 100));
  const svg = document.createElementNS(SVG, 'svg');
  svg.setAttribute('viewBox', '0 0 100 8');
  svg.setAttribute('class', 'bar');
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', `${name}: ${formatAmount(used)}`);
  const track = document.createElementNS(SVG, 'rect');
  track.setAttribute('x', '0');
  track.setAttribute('y', '0');
  track.setAttribute('width', '100');
  track.setAttribute('height', '8');
  track.setAttribute('rx', '4');
  track.setAttribute('class', 'bar-track');
  const fill = document.createElementNS(SVG, 'rect');
  fill.setAttribute('x', '0');
  fill.setAttribute('y', '0');
  fill.setAttribute('width', width.toFixed(2));
  fill.setAttribute('height', '8');
  fill.setAttribute('rx', '4');
  fill.setAttribute('class', 'bar-fill');
  svg.append(track, fill);
  return svg;
}

function renderPanel(dashboard) {
  const panel = el('div', 'panel-host');
  panel.id = 'panel';
  panel.setAttribute('role', 'tabpanel');
  panel.setAttribute('aria-labelledby', `tab-${view.tab}`);
  panel.tabIndex = 0;
  if (view.tab === 'handoffs') panel.append(renderHandoffs(dashboard));
  else if (view.tab === 'events') panel.append(renderEvents(dashboard));
  else if (view.tab === 'calendar') panel.append(renderCalendar(dashboard));
  else if (view.tab === 'usage') panel.append(renderUsage(dashboard));
  else panel.append(renderBots(dashboard));
  return panel;
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
  const workspace = el('div', 'workspace');
  workspace.append(renderTablist(), renderPanel(dashboard));
  app.replaceChildren(workspace);
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
