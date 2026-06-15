import { RNG } from './rng';
import { CITY, CIV, SIM } from './config';
import { recordEvent } from './chronicle';
import { inheritCulture } from './culture';
import { remember } from './memory';
import { emptyPolitics } from './revolution';
import type { Agent, BuildingType, City, CityBuilding, CityRuin, Tribe, TribeIdeology, WorldState } from './types';

/**
 * Cities. A large, stable (or long-lived) tribe with a treasury crystallizes into a city:
 * a fixed center with stored energy, social classes, taxation, laws, and buildings that
 * grow with conditions. The city taxes residents into a treasury and redistributes it
 * according to the tribe's ideology — authoritarian cities concentrate wealth in an elite
 * (inequality up), cooperative cities fund welfare (inequality down). Cities disband when
 * their tribe collapses. Runs right after the tribe update.
 */

const TAX_BY_IDEOLOGY: Record<TribeIdeology, number> = {
  cooperative: 0.08,
  spiritual: 0.1,
  trader: 0.15,
  isolationist: 0.12,
  expansionist: 0.18,
  revolutionary: 0.14,
  authoritarian: 0.25,
  militaristic: 0.22,
};

// Share of each payout going to the elite vs welfare for the poor (rest is reinvested).
function distribution(ideology: TribeIdeology): { elite: number; welfare: number } {
  switch (ideology) {
    case 'authoritarian':
    case 'militaristic':
      return { elite: 0.7, welfare: 0.1 };
    case 'cooperative':
      return { elite: 0.2, welfare: 0.65 };
    case 'spiritual':
      return { elite: 0.3, welfare: 0.5 };
    case 'revolutionary':
      return { elite: 0.25, welfare: 0.55 };
    default:
      return { elite: 0.45, welfare: 0.35 };
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Small Roman numeral for rebuilt-city dynasties (II, III, …); falls back to the number. */
function roman(n: number): string {
  const map: [number, string][] = [[10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I']];
  if (n > 39) return String(n);
  let out = '';
  let v = n;
  for (const [val, sym] of map) {
    while (v >= val) {
      out += sym;
      v -= val;
    }
  }
  return out;
}

function logHistory(city: City, cycle: number, text: string): void {
  city.history.push({ cycle, text });
  if (city.history.length > CITY.historyCap) city.history.shift();
}

function gridGroupByTribe(world: WorldState): Map<number, Agent[]> {
  const byTribe = new Map<number, Agent[]>();
  for (const a of world.agents) {
    if (a.tribeId === null) continue;
    let g = byTribe.get(a.tribeId);
    if (!g) {
      g = [];
      byTribe.set(a.tribeId, g);
    }
    g.push(a);
  }
  return byTribe;
}

export function updateCities(world: WorldState, rng: RNG): void {
  const byTribe = gridGroupByTribe(world);
  const tribeById = new Map<number, Tribe>();
  for (const t of world.tribes) tribeById.set(t.id, t);

  // 1. update or disband existing cities
  const survivors: City[] = [];
  for (const city of world.cities) {
    const tribe = tribeById.get(city.tribeId);
    const members = tribe ? (byTribe.get(tribe.id) ?? []) : [];
    if (!tribe || members.length < CITY.disbandPop) {
      collapseCity(world, city, tribe, members);
      continue; // disband
    }
    updateCity(city, tribe, members, world.cycle);
    survivors.push(city);
  }
  world.cities = survivors;

  // 2. found cities from qualifying tribes that don't have one
  const tribesWithCity = new Set(survivors.map((c) => c.tribeId));
  for (const tribe of world.tribes) {
    if (tribesWithCity.has(tribe.id)) continue;
    const members = byTribe.get(tribe.id) ?? [];
    const age = world.cycle - tribe.foundedCycle;
    if (
      members.length >= CITY.minPop &&
      (tribe.stability >= CITY.minStability || age >= CITY.ageBypass) &&
      tribe.sharedEnergy >= CITY.minSharedEnergy
    ) {
      createCity(world, tribe, members, rng);
    }
  }

  // 3. stamp residency (cityId) on every agent from its tribe's city
  const tribeCityId = new Map<number, number>();
  for (const c of world.cities) tribeCityId.set(c.tribeId, c.id);
  for (const a of world.agents) {
    a.cityId = a.tribeId !== null ? (tribeCityId.get(a.tribeId) ?? null) : null;
  }
}

/** Find a remembered ruin near a point (Phase 6) — successors rebuild on the old stones. */
function findRuinNear(world: WorldState, x: number, y: number, radius: number): CityRuin | null {
  let best: CityRuin | null = null;
  let bestD = radius;
  for (const r of world.ruins) {
    const d = Math.hypot(r.x - x, r.y - y);
    if (d < bestD) {
      bestD = d;
      best = r;
    }
  }
  return best;
}

/**
 * A city collapses (Phase 6): it leaves ruins on the map, scatters a share of its people into
 * refugees who carry the memory of the fallen city, and is mourned in the Chronicle.
 */
function collapseCity(world: WorldState, city: City, tribe: Tribe | undefined, members: Agent[]): void {
  const ideology: TribeIdeology = tribe ? tribe.ideology : 'cooperative';
  const leaderName = city.leaderId !== null ? world.agents.find((a) => a.id === city.leaderId)?.name ?? null : null;
  world.ruins.push({
    id: world.nextRuinId++,
    name: city.name,
    x: city.x,
    y: city.y,
    fallCycle: world.cycle,
    peakPopulation: Math.max(city.population, members.length),
    ideology,
    lastLeaderName: leaderName,
    rebuiltCount: 0,
  });
  if (world.ruins.length > CIV.ruinsCap) world.ruins.shift();

  const sorted = members.slice().sort((a, b) => a.energy - b.energy);
  const nRef = Math.floor(sorted.length * CIV.refugeeShare);
  for (let i = 0; i < sorted.length; i++) {
    const m = sorted[i];
    m.cityId = null;
    if (i < nRef) {
      m.role = 'refugee';
      remember(m, 'migrated', world.cycle, { x: city.x, y: city.y, strength: 0.6 });
    }
    remember(m, 'mourned_dead', world.cycle, { x: city.x, y: city.y, strength: 0.4 });
  }
  recordEvent(world, {
    category: 'collapse',
    severity: 4,
    title: 'A City Falls',
    description: `${city.name} collapsed into ruins; its people scattered as refugees.`,
    cityId: city.id,
  });
}

function createCity(world: WorldState, tribe: Tribe, members: Agent[], rng: RNG): City {
  const id = world.nextCityId++;
  // Phase 6 — rebuild on nearby ruins, inheriting the fallen city's name + culture.
  const ruin = findRuinNear(world, tribe.cx, tribe.cy, 90);
  let name: string;
  if (ruin) {
    ruin.rebuiltCount += 1;
    name = ruin.rebuiltCount > 1 ? `${ruin.name} ${roman(ruin.rebuiltCount)}` : `New ${ruin.name}`;
    if (tribe.foundedCycle >= ruin.fallCycle && world.cycle - ruin.fallCycle <= CIV.rebuildBonusCycles) {
      tribe.ideology = ruin.ideology; // inherited ideology for a swift successor
      // W8 — a swift successor also inherits a fragment of a fallen culture (norms/myths).
      if (SIM.enableCulture) inheritCulture(world, tribe.id);
    }
    recordEvent(world, {
      category: 'culture',
      severity: 3,
      title: 'A City Reborn',
      description: `${name} rose on the ruins of ${ruin.name}, inheriting the old ways.`,
      tribeId: tribe.id,
      cityId: id,
    });
  } else {
    name = tribe.name.replace(/^The /, '');
  }
  const city: City = {
    id,
    tribeId: tribe.id,
    name,
    x: tribe.cx,
    y: tribe.cy,
    population: members.length,
    storedEnergy: tribe.sharedEnergy, // the tribe's treasury seeds the city
    taxRate: TAX_BY_IDEOLOGY[tribe.ideology],
    classElite: 0,
    classMiddle: 0,
    classPoor: 0,
    inequality: 0,
    unrest: 0,
    buildings: [
      makeBuilding('council_hall', 0),
      makeBuilding('energy_storage', 1),
    ],
    leaderId: tribe.leaderId,
    foundedCycle: world.cycle,
    history: [],
    politics: emptyPolitics(world.cycle),
  };
  tribe.sharedEnergy = 0;
  logHistory(city, world.cycle, `${city.name} founded (${members.length} residents)`);
  recordEvent(world, {
    category: 'politics',
    severity: 3,
    title: 'A City Rises',
    description: `${city.name} was founded with ${members.length} residents.`,
    tribeId: tribe.id,
    cityId: city.id,
  });
  void rng; // naming is derived from the tribe; rng reserved for future variation
  updateCity(city, tribe, members, world.cycle);
  world.cities.push(city);
  return city;
}

function makeBuilding(type: BuildingType, index: number): CityBuilding {
  const angle = index * (Math.PI / 4) + 0.4;
  const dist = 26 + (index % 2) * 8;
  return { type, dx: Math.cos(angle) * dist, dy: Math.sin(angle) * dist, level: 1, damaged: false };
}

function updateCity(city: City, tribe: Tribe, members: Agent[], cycle: number): void {
  city.population = members.length;
  city.x = tribe.cx;
  city.y = tribe.cy;
  city.leaderId = tribe.leaderId;
  city.taxRate = TAX_BY_IDEOLOGY[tribe.ideology];

  runCityEconomy(city, members, tribe.ideology);

  // social classes by energy
  const sorted = members.slice().sort((a, b) => b.energy - a.energy);
  const nElite = Math.max(1, Math.floor(sorted.length * 0.2));
  const nPoorStart = Math.floor(sorted.length * 0.6);
  city.classElite = nElite;
  city.classMiddle = Math.max(0, nPoorStart - nElite);
  city.classPoor = sorted.length - nPoorStart;

  // inequality among residents (gini)
  let total = 0;
  for (const m of members) total += m.energy;
  let cum = 0;
  const asc = members.slice().sort((a, b) => a.energy - b.energy);
  for (let i = 0; i < asc.length; i++) cum += asc[i].energy * (i + 1);
  const n = members.length;
  city.inequality = total > 0 ? clamp01((2 * cum) / (n * total) - (n + 1) / n) : 0;

  // poor / starving fraction + leader trust → unrest
  let starving = 0;
  let loy = 0;
  let counted = 0;
  for (const m of members) {
    if (m.energy < CITY.starveThreshold) starving += 1;
    if (city.leaderId !== null && m.id !== city.leaderId) {
      const rel = m.relationships.get(city.leaderId);
      loy += rel ? rel.trust * 0.6 + rel.loyalty * 0.4 : 0;
      counted += 1;
    }
  }
  const avgTrust = counted > 0 ? loy / counted : 0.5;
  city.unrest = clamp01(city.inequality * 0.5 + (starving / n) * 0.3 + (1 - avgTrust) * 0.2);

  maybeGrowBuilding(city, tribe, cycle);
}

export function runCityEconomy(city: City, members: Agent[], ideology: TribeIdeology): void {
  // collect tax on surplus above subsistence
  let collected = 0;
  for (const m of members) {
    if (m.energy > CITY.subsistence) {
      const t = (m.energy - CITY.subsistence) * city.taxRate * CITY.collectFrac;
      m.energy -= t;
      collected += t;
    }
  }
  city.storedEnergy += collected;

  // pay out a fraction of the treasury, split by ideology
  const payout = city.storedEnergy * CITY.payoutFrac;
  city.storedEnergy -= payout;
  const { elite, welfare } = distribution(ideology);
  city.storedEnergy += payout * (1 - elite - welfare); // reinvested

  const sorted = members.slice().sort((a, b) => b.energy - a.energy);
  const nElite = Math.max(1, Math.floor(sorted.length * 0.2));
  const eliteMembers = sorted.slice(0, nElite);
  const poorMembers = sorted.slice(Math.floor(sorted.length * 0.6));

  give(city, eliteMembers, payout * elite);
  give(city, poorMembers, payout * welfare);
}

/** Distribute `pool` equally across `recipients`, returning any overflow to the treasury. */
function give(city: City, recipients: Agent[], pool: number): void {
  if (recipients.length === 0 || pool <= 0) {
    city.storedEnergy += pool;
    return;
  }
  const each = pool / recipients.length;
  for (const m of recipients) {
    const room = m.maxEnergy - m.energy;
    const g = Math.min(each, room);
    m.energy += g;
    city.storedEnergy += each - g; // overflow conserved
  }
}

function hasBuilding(city: City, type: BuildingType): boolean {
  for (const b of city.buildings) if (b.type === type) return true;
  return false;
}

function maybeGrowBuilding(city: City, tribe: Tribe, cycle: number): void {
  let atWar = false;
  for (const rel of tribe.relations.values()) if (rel.war) atWar = true;

  const wants: BuildingType | null =
    tribe.ideology === 'trader' && !hasBuilding(city, 'market')
      ? 'market'
      : atWar && !hasBuilding(city, 'defense_wall')
        ? 'defense_wall'
        : tribe.ideology === 'spiritual' && !hasBuilding(city, 'temple')
          ? 'temple'
          : city.unrest > 0.55 && !hasBuilding(city, 'prison')
            ? 'prison'
            : city.population >= 16 && !hasBuilding(city, 'memory_archive')
              ? 'memory_archive'
              : city.storedEnergy > 120 && !hasBuilding(city, 'market')
                ? 'market'
                : null;

  if (wants) {
    city.buildings.push(makeBuilding(wants, city.buildings.length));
    logHistory(city, cycle, `built a ${wants.replace('_', ' ')}`);
  }
}
