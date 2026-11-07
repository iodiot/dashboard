import { LIMITS } from './limits.js';
import { DashboardError } from './errors.js';
import { isIanaTimeZone } from './time.js';

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/;
const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const ROOT_KEYS = new Set(['schemaVersion', 'updatedAt', 'title', 'note', 'timezone', 'bots', 'events', 'calendar', 'usage', 'handoffs']);
const BOT_KEYS = new Set(['id', 'name', 'status', 'summary', 'nextAction', 'updatedAt', 'details', 'tags', 'links']);
const LINK_KEYS = new Set(['label', 'url']);
const EVENT_KEYS = new Set(['id', 'at', 'category', 'title', 'summary', 'botId', 'url']);
const CALENDAR_KEYS = new Set(['id', 'startsAt', 'title', 'endsAt', 'summary', 'where', 'botId', 'url']);
const USAGE_KEYS = new Set(['used', 'limit', 'resetAt', 'byBot', 'unit']);
const BY_BOT_KEYS = new Set(['botId', 'used', 'limit']);
const HANDOFF_KEYS = new Set(['id', 'from', 'to', 'what']);
const STATUSES = new Set(['active', 'idle', 'blocked']);
const CATEGORIES = new Set(['application', 'recruiter', 'social', 'calendar']);

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

function requireSlug(value, path, ids) {
  const id = requireString(value, path, {
    min: 1,
    max: LIMITS.maxIdLength,
    allowNewlines: false,
    allowEmpty: false
  });
  if (!SLUG_RE.test(id)) fail(path);
  if (ids) {
    if (ids.has(id)) fail(path);
    ids.add(id);
  }
  return id;
}

function requireAmount(value, path) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > LIMITS.maxCount) fail(path);
  return value;
}

function knownBot(id, path, botIds) {
  if (!botIds.has(id)) fail(path);
  return id;
}

function optionalUrl(value, path) {
  const url = normalizeHttpUrl(value);
  if (url === null) fail(path);
  return url;
}

function instant(iso) {
  return Date.parse(iso);
}

function sanitizeEvents(value, botIds) {
  if (!Array.isArray(value) || value.length > LIMITS.maxEvents) fail('events');
  const ids = new Set();
  return value.map((item, index) => {
    const path = `events[${index}]`;
    if (!isObject(item)) fail(path);
    rejectUnknown(item, EVENT_KEYS, path);
    for (const key of ['id', 'at', 'category', 'title']) {
      if (!Object.hasOwn(item, key)) fail(`${path}.${key}`);
    }
    const event = {
      id: requireSlug(item.id, `${path}.id`, ids),
      at: item.at,
      category: item.category,
      title: requireString(item.title, `${path}.title`, {
        min: 1,
        max: LIMITS.maxEventTitle,
        allowNewlines: false,
        allowEmpty: false
      })
    };
    if (!isIsoDateTime(event.at)) fail(`${path}.at`);
    if (!CATEGORIES.has(event.category)) fail(`${path}.category`);
    if (Object.hasOwn(item, 'summary')) {
      event.summary = requireString(item.summary, `${path}.summary`, {
        min: 1,
        max: LIMITS.maxEventSummary,
        allowNewlines: true,
        allowEmpty: false
      });
    }
    if (Object.hasOwn(item, 'botId')) {
      event.botId = knownBot(requireSlug(item.botId, `${path}.botId`), `${path}.botId`, botIds);
    }
    if (Object.hasOwn(item, 'url')) event.url = optionalUrl(item.url, `${path}.url`);
    return event;
  });
}

function sanitizeCalendar(value, botIds) {
  if (!Array.isArray(value) || value.length > LIMITS.maxCalendar) fail('calendar');
  const ids = new Set();
  return value.map((item, index) => {
    const path = `calendar[${index}]`;
    if (!isObject(item)) fail(path);
    rejectUnknown(item, CALENDAR_KEYS, path);
    for (const key of ['id', 'startsAt', 'title']) {
      if (!Object.hasOwn(item, key)) fail(`${path}.${key}`);
    }
    const entry = {
      id: requireSlug(item.id, `${path}.id`, ids),
      startsAt: item.startsAt,
      title: requireString(item.title, `${path}.title`, {
        min: 1,
        max: LIMITS.maxEventTitle,
        allowNewlines: false,
        allowEmpty: false
      })
    };
    if (!isIsoDateTime(entry.startsAt)) fail(`${path}.startsAt`);
    if (Object.hasOwn(item, 'endsAt')) {
      if (!isIsoDateTime(item.endsAt)) fail(`${path}.endsAt`);
      if (instant(item.endsAt) < instant(entry.startsAt)) fail(`${path}.endsAt`);
      entry.endsAt = item.endsAt;
    }
    if (Object.hasOwn(item, 'summary')) {
      entry.summary = requireString(item.summary, `${path}.summary`, {
        min: 1,
        max: LIMITS.maxEventSummary,
        allowNewlines: true,
        allowEmpty: false
      });
    }
    if (Object.hasOwn(item, 'where')) {
      entry.where = requireString(item.where, `${path}.where`, {
        min: 1,
        max: LIMITS.maxWhereLength,
        allowNewlines: false,
        allowEmpty: false
      });
    }
    if (Object.hasOwn(item, 'botId')) {
      entry.botId = knownBot(requireSlug(item.botId, `${path}.botId`), `${path}.botId`, botIds);
    }
    if (Object.hasOwn(item, 'url')) entry.url = optionalUrl(item.url, `${path}.url`);
    return entry;
  });
}

function sanitizeUsage(value, botIds) {
  if (!isObject(value)) fail('usage');
  rejectUnknown(value, USAGE_KEYS, 'usage');
  for (const key of ['used', 'limit', 'resetAt', 'byBot']) {
    if (!Object.hasOwn(value, key)) fail(`usage.${key}`);
  }
  const used = requireAmount(value.used, 'usage.used');
  const limit = requireAmount(value.limit, 'usage.limit');
  if (!isIsoDateTime(value.resetAt)) fail('usage.resetAt');
  if (!Array.isArray(value.byBot) || value.byBot.length > LIMITS.maxBots) fail('usage.byBot');
  const seen = new Set();
  const byBot = value.byBot.map((item, index) => {
    const path = `usage.byBot[${index}]`;
    if (!isObject(item)) fail(path);
    rejectUnknown(item, BY_BOT_KEYS, path);
    if (!Object.hasOwn(item, 'botId') || !Object.hasOwn(item, 'used')) fail(path);
    const row = {
      botId: knownBot(requireSlug(item.botId, `${path}.botId`), `${path}.botId`, botIds),
      used: requireAmount(item.used, `${path}.used`)
    };
    if (seen.has(row.botId)) fail(`${path}.botId`);
    seen.add(row.botId);
    if (Object.hasOwn(item, 'limit')) row.limit = requireAmount(item.limit, `${path}.limit`);
    return row;
  });
  const usage = { used, limit, resetAt: value.resetAt, byBot };
  if (Object.hasOwn(value, 'unit')) {
    usage.unit = requireString(value.unit, 'usage.unit', {
      min: 1,
      max: LIMITS.maxUnitLength,
      allowNewlines: false,
      allowEmpty: false
    });
  }
  return usage;
}

function sanitizeHandoffs(value, botIds) {
  if (!Array.isArray(value) || value.length > LIMITS.maxHandoffs) fail('handoffs');
  const ids = new Set();
  return value.map((item, index) => {
    const path = `handoffs[${index}]`;
    if (!isObject(item)) fail(path);
    rejectUnknown(item, HANDOFF_KEYS, path);
    for (const key of ['from', 'to', 'what']) {
      if (!Object.hasOwn(item, key)) fail(`${path}.${key}`);
    }
    const handoff = {
      from: knownBot(requireSlug(item.from, `${path}.from`), `${path}.from`, botIds),
      to: knownBot(requireSlug(item.to, `${path}.to`), `${path}.to`, botIds),
      what: requireString(item.what, `${path}.what`, {
        min: 1,
        max: LIMITS.maxHandoffWhat,
        allowNewlines: false,
        allowEmpty: false
      })
    };
    if (Object.hasOwn(item, 'id')) handoff.id = requireSlug(item.id, `${path}.id`, ids);
    return handoff;
  });
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
  if (Object.hasOwn(value, 'timezone')) {
    if (!isIanaTimeZone(value.timezone)) fail('timezone');
    dashboard.timezone = value.timezone;
  }
  if (Object.hasOwn(value, 'events')) dashboard.events = sanitizeEvents(value.events, ids);
  if (Object.hasOwn(value, 'calendar')) dashboard.calendar = sanitizeCalendar(value.calendar, ids);
  if (Object.hasOwn(value, 'usage')) dashboard.usage = sanitizeUsage(value.usage, ids);
  if (Object.hasOwn(value, 'handoffs')) dashboard.handoffs = sanitizeHandoffs(value.handoffs, ids);
  return dashboard;
}

export function canonicalizeDashboard(dashboard) {
  const root = {
    schemaVersion: dashboard.schemaVersion,
    updatedAt: dashboard.updatedAt,
    title: dashboard.title
  };
  if (Object.hasOwn(dashboard, 'note')) root.note = dashboard.note;
  if (Object.hasOwn(dashboard, 'timezone')) root.timezone = dashboard.timezone;
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
  if (Object.hasOwn(dashboard, 'events')) {
    root.events = dashboard.events.map((item) => {
      const copy = { id: item.id, at: item.at, category: item.category, title: item.title };
      if (Object.hasOwn(item, 'summary')) copy.summary = item.summary;
      if (Object.hasOwn(item, 'botId')) copy.botId = item.botId;
      if (Object.hasOwn(item, 'url')) copy.url = item.url;
      return copy;
    });
  }
  if (Object.hasOwn(dashboard, 'calendar')) {
    root.calendar = dashboard.calendar.map((item) => {
      const copy = { id: item.id, startsAt: item.startsAt, title: item.title };
      if (Object.hasOwn(item, 'endsAt')) copy.endsAt = item.endsAt;
      if (Object.hasOwn(item, 'summary')) copy.summary = item.summary;
      if (Object.hasOwn(item, 'where')) copy.where = item.where;
      if (Object.hasOwn(item, 'botId')) copy.botId = item.botId;
      if (Object.hasOwn(item, 'url')) copy.url = item.url;
      return copy;
    });
  }
  if (Object.hasOwn(dashboard, 'usage')) {
    root.usage = {
      used: dashboard.usage.used,
      limit: dashboard.usage.limit,
      resetAt: dashboard.usage.resetAt,
      byBot: dashboard.usage.byBot.map((item) => {
        const copy = { botId: item.botId, used: item.used };
        if (Object.hasOwn(item, 'limit')) copy.limit = item.limit;
        return copy;
      })
    };
    if (Object.hasOwn(dashboard.usage, 'unit')) root.usage.unit = dashboard.usage.unit;
  }
  if (Object.hasOwn(dashboard, 'handoffs')) {
    root.handoffs = dashboard.handoffs.map((item) => {
      const copy = { from: item.from, to: item.to, what: item.what };
      if (Object.hasOwn(item, 'id')) copy.id = item.id;
      return copy;
    });
  }
  return JSON.stringify(root);
}
