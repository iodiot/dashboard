export function localTimeZone() {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === 'string' && zone.length > 0 ? zone : 'UTC';
}

export function isIanaTimeZone(value) {
  if (typeof value !== 'string' || value.length < 1 || value.length > 64) return false;
  if (/[\u0000-\u0020\u007f]/.test(value)) return false;
  try {
    Intl.DateTimeFormat('en-US', { timeZone: value }).format(0);
    return true;
  } catch {
    return false;
  }
}

export function dayKey(instant, timeZone) {
  const date = instant instanceof Date ? instant : new Date(instant);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(date);
  const map = {};
  for (const part of parts) {
    if (part.type !== 'literal') map[part.type] = part.value;
  }
  return `${map.year}-${map.month}-${map.day}`;
}

export function addCivilDays(key, days) {
  const [year, month, day] = key.split('-').map(Number);
  const shifted = new Date(Date.UTC(year, month - 1, day + days));
  const y = String(shifted.getUTCFullYear()).padStart(4, '0');
  const m = String(shifted.getUTCMonth() + 1).padStart(2, '0');
  const d = String(shifted.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function upcomingDays(timeZone, page, now = new Date()) {
  const start = addCivilDays(dayKey(now, timeZone), page * 3);
  return [0, 1, 2].map((offset) => addCivilDays(start, offset));
}

export function overlapsCivilDay(item, key, timeZone) {
  const startKey = dayKey(item.startsAt, timeZone);
  const endKey = dayKey(item.endsAt || item.startsAt, timeZone);
  return startKey <= key && key <= endKey;
}
