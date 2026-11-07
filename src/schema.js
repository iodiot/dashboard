import { LIMITS } from './limits.js';
import { DashboardError } from './errors.js';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROOT_KEYS = new Set(['schemaVersion', 'updatedAt', 'title', 'note', 'bots']);
const BOT_KEYS = new Set(['id', 'name', 'status', 'summary', 'nextAction', 'updatedAt', 'details', 'tags', 'links']);
const LINK_KEYS = new Set(['label', 'url']);
const STATUSES = new Set(['active', 'idle', 'blocked']);

function fail(path) {
  throw new DashboardError('schema', `Invalid dashboard JSON: ${path}`);
}

function isObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value) &&
    (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null);
}

function hasControls(value, allowNewlines) {
  for (const char of value) {
    const code = char.codePointAt(0);
    if (code === 0x9 || code === 0xa || code === 0xd) {
      if (!allowNewlines) return true;
      continue;
    }
    if (code < 0x20 || code === 0x7f || code === 0x2028 || code === 0x2029) return true;
  }
  return false;
}

function isBlank(value) {
  return /^[\t\n\r ]*$/.test(value);
}

export function isIsoDateTime(value) {
  if (typeof value !== 'string' || value.length > 40) return false;
  const match = ISO_RE.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const hour = Number(match[4]);
  const minute = Number(match[5]);
  const second = Number(match[6]);
  if (month < 1 || month > 12 || hour > 23 || minute > 59 || second > 59) return false;
  const utc = new Date(Date.UTC(year, month - 1, day));
  if (utc.getUTCFullYear() !== year || utc.getUTCMonth() !== month - 1 || utc.getUTCDate() !== day) {
    return false;
  }
  const offset = match[8];
  if (offset !== 'Z') {
    const hours = Number(offset.slice(1, 3));
    const minutes = Number(offset.slice(4, 6));
    if (hours > 23 || minutes > 59) return false;
  }
  return true;
}

export function normalizeHttpUrl(value) {
  if (typeof value !== 'string' || value.length < 8 || value.length > LIMITS.maxUrlLength) return null;
  if (/[\u0000-\u0020\u007f]/.test(value) || /\s/u.test(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (url.username !== '' || url.password !== '') return null;
  if (url.hostname === '') return null;
  if (url.href.length > LIMITS.maxUrlLength) return null;
  return url.href;
}

function rejectUnknown(value, allowed, path) {
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) fail(path);
  }
}

function requireString(value, path, { min, max, allowNewlines, allowEmpty, exact }) {
  if (typeof value !== 'string') fail(path);
  if (exact !== undefined && value !== exact) fail(path);
  const length = [...value].length;
  if (length > max || length < min) fail(path);
  if (!allowEmpty && isBlank(value)) fail(path);
  if (hasControls(value, allowNewlines)) fail(path);
  return value;
}

function sanitizeLink(value, path) {
  if (!isObject(value)) fail(path);
  rejectUnknown(value, LINK_KEYS, path);
  if (!Object.hasOwn(value, 'label') || !Object.hasOwn(value, 'url')) fail(path);
  const label = requireString(value.label, `${path}.label`, {
    min: 1,
    max: LIMITS.maxLabelLength,
    allowNewlines: false,
    allowEmpty: false
  });
  const url = normalizeHttpUrl(value.url);
  if (url === null) fail(`${path}.url`);
  return { label, url };
}

function sanitizeBot(value, path, ids) {
  if (!isObject(value)) fail(path);
  rejectUnknown(value, BOT_KEYS, path);
  for (const key of ['id', 'name', 'status', 'summary', 'nextAction', 'updatedAt', 'links']) {
    if (!Object.hasOwn(value, key)) fail(`${path}.${key}`);
  }
  const id = requireString(value.id, `${path}.id`, {
    min: 1,
    max: LIMITS.maxIdLength,
    allowNewlines: false,
    allowEmpty: false
  });
  if (!SLUG_RE.test(id)) fail(`${path}.id`);
  if (ids.has(id)) fail(`${path}.id`);
  ids.add(id);
  const name = requireString(value.name, `${path}.name`, {
    min: 1,
    max: LIMITS.maxNameLength,
    allowNewlines: false,
    allowEmpty: false
  });
  if (!STATUSES.has(value.status)) fail(`${path}.status`);
  const summary = requireString(value.summary, `${path}.summary`, {
    min: 0,
    max: LIMITS.maxSummaryLength,
    allowNewlines: true,
    allowEmpty: true
  });
  let nextAction = null;
  if (value.nextAction !== null) {
    nextAction = requireString(value.nextAction, `${path}.nextAction`, {
      min: 1,
      max: LIMITS.maxNextActionLength,
      allowNewlines: false,
      allowEmpty: false
    });
  }
  if (!isIsoDateTime(value.updatedAt)) fail(`${path}.updatedAt`);
  if (!Array.isArray(value.links) || value.links.length > LIMITS.maxLinks) fail(`${path}.links`);
  const links = value.links.map((link, index) => sanitizeLink(link, `${path}.links[${index}]`));
  const bot = {
    id,
    name,
    status: value.status,
    summary,
    nextAction,
    updatedAt: value.updatedAt,
    links
  };
  if (Object.hasOwn(value, 'details')) {
    bot.details = requireString(value.details, `${path}.details`, {
      min: 1,
      max: LIMITS.maxDetailsLength,
      allowNewlines: true,
      allowEmpty: false
    });
  }
  if (Object.hasOwn(value, 'tags')) {
    if (!Array.isArray(value.tags) || value.tags.length < 1 || value.tags.length > LIMITS.maxTags) {
      fail(`${path}.tags`);
    }
    const seen = new Set();
    bot.tags = value.tags.map((tag, index) => {
      const clean = requireString(tag, `${path}.tags[${index}]`, {
        min: 1,
        max: LIMITS.maxTagLength,
        allowNewlines: false,
        allowEmpty: false
      });
      if (!SLUG_RE.test(clean) || seen.has(clean)) fail(`${path}.tags[${index}]`);
      seen.add(clean);
      return clean;
    });
  }
  return bot;
}

export function validateDashboard(value) {
  if (!isObject(value)) fail('root');
  rejectUnknown(value, ROOT_KEYS, 'root');
  for (const key of ['schemaVersion', 'updatedAt', 'title', 'bots']) {
    if (!Object.hasOwn(value, key)) fail(key);
  }
  if (value.schemaVersion !== LIMITS.schemaVersion || !Number.isInteger(value.schemaVersion)) fail('schemaVersion');
  if (!isIsoDateTime(value.updatedAt)) fail('updatedAt');
  const title = requireString(value.title, 'title', {
    min: 1,
    max: LIMITS.maxTitleLength,
    allowNewlines: false,
    allowEmpty: false
  });
  if (!Array.isArray(value.bots) || value.bots.length > LIMITS.maxBots) fail('bots');
  const ids = new Set();
  const bots = value.bots.map((bot, index) => sanitizeBot(bot, `bots[${index}]`, ids));
  const dashboard = {
    schemaVersion: LIMITS.schemaVersion,
    updatedAt: value.updatedAt,
    title,
    bots
  };
  if (Object.hasOwn(value, 'note')) {
    dashboard.note = requireString(value.note, 'note', {
      min: 1,
      max: LIMITS.maxNoteLength,
      allowNewlines: false,
      allowEmpty: false
    });
  }
  return dashboard;
}

export function canonicalizeDashboard(dashboard) {
  const root = {
    schemaVersion: dashboard.schemaVersion,
    updatedAt: dashboard.updatedAt,
    title: dashboard.title
  };
  if (Object.hasOwn(dashboard, 'note')) root.note = dashboard.note;
  root.bots = dashboard.bots.map((bot) => {
    const copy = {
      id: bot.id,
      name: bot.name,
      status: bot.status,
      summary: bot.summary,
      nextAction: bot.nextAction,
      updatedAt: bot.updatedAt
    };
    if (Object.hasOwn(bot, 'details')) copy.details = bot.details;
    if (Object.hasOwn(bot, 'tags')) copy.tags = bot.tags;
    copy.links = bot.links.map((link) => ({ label: link.label, url: link.url }));
    return copy;
  });
  return JSON.stringify(root);
}
