// Save slots in localStorage: cash, mission progress, position and wanted level. Every call is
// guarded because storage can be blocked (private windows, sandboxed iframes) and the game must
// still run without it.
//
// v2 stores the clock in minutes (v1 wrote a 0..1 fraction, which loaders silently ignored) and
// keeps a version tag so an old slot migrates instead of being thrown away. The mission index is
// clamped to the arc's eight jobs, and a slot is only offered to "Continue" when it parses.

const KEY = 'neonbay.save.v1';
const VERSION = 2;
const ARC_LENGTH = 8;
export const DEFAULT_CLOCK = 21 * 60 + 40;

function toNumber(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function normalizeSave(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const time = toNumber(raw.time, DEFAULT_CLOCK);
  // A v1 slot stored the time as a fraction of a day; anything under 24 is read as hours.
  const minutes = raw.version === VERSION ? time : time < 24 ? time * 60 : time;
  return {
    version: VERSION,
    cash: Math.max(0, Math.round(toNumber(raw.cash, 0))),
    mission: Math.max(0, Math.min(ARC_LENGTH - 1, Math.floor(toNumber(raw.mission, 0)))),
    missionsDone: Array.isArray(raw.missionsDone)
      ? [...new Set(raw.missionsDone.map(Number).filter((n) => Number.isInteger(n) && n >= 1 && n <= ARC_LENGTH))]
      : [],
    x: toNumber(raw.x, 3.2),
    z: toNumber(raw.z, 96),
    wanted: Math.max(0, Math.min(5, Math.round(toNumber(raw.wanted, 0)))),
    time: ((Math.round(minutes) % 1440) + 1440) % 1440,
    savedAt: Math.max(0, Math.round(toNumber(raw.savedAt, 0))),
  };
}

export function readSave() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return null;
    return normalizeSave(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function hasSave() {
  return readSave() !== null;
}

export function writeSave(data) {
  try {
    const normalized = normalizeSave({ ...data, version: VERSION });
    if (!normalized) return false;
    localStorage.setItem(KEY, JSON.stringify(normalized));
    return true;
  } catch {
    return false;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(KEY);
    return true;
  } catch {
    return false;
  }
}

// A one-line summary for the title screen's Continue button, or null with no slot.
export function saveSummary() {
  const save = readSave();
  if (!save) return null;
  const pad = String(save.time % 60).padStart(2, '0');
  return `Save · $${save.cash.toLocaleString('en-US')} · ${String(Math.floor(save.time / 60)).padStart(2, '0')}:${pad}`;
}
