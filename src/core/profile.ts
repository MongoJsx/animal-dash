// The player's own progress, kept on this device: coins earned from races,
// wins, best times per map and the last choices made on the menu. Gems and the
// shop are placeholders for later, so nothing spends anything yet.
export interface Profile {
  name: string;
  coins: number;
  gems: number;
  races: number;
  wins: number;
  /** Best finish time (s) per map and lane count, e.g. "japan/5". */
  best: Record<string, number>;
  char?: string;
  lanes?: number;
  /** Items switched on for races (all of them when unset). */
  items?: string[];
}

const KEY = 'profile';
const fresh = (): Profile => ({ name: 'นักวิ่ง', coins: 0, gems: 0, races: 0, wins: 0, best: {} });

function load(): Profile {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...fresh(), ...JSON.parse(raw) };
  } catch { /* private mode or bad data: start over */ }
  return fresh();
}

export const profile: Profile = load();

export function saveProfile() {
  try { localStorage.setItem(KEY, JSON.stringify(profile)); } catch { /* private mode */ }
}

/** Coins for a finishing place out of `field` runners. */
export const raceReward = (place: number, field: number) =>
  place === 1 ? 100 : place === 2 ? 60 : place === 3 && field > 3 ? 40 : 20;

/** Book a finished race; returns the coins it paid. */
export function recordRace(place: number, field: number, time: number | null, key: string) {
  const coins = raceReward(place, field);
  profile.coins += coins;
  profile.races++;
  if (place === 1) profile.wins++;
  if (time !== null && !(profile.best[key] <= time)) profile.best[key] = time;
  saveProfile();
  return coins;
}
