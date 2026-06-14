import { RNG } from './rng';
import { POLITICS, REVOLUTION } from './config';
import { adjust, ensureRel } from './relationships';
import { remember } from './memory';
import { pushPulse } from './conflict';
import { recordEvent } from './chronicle';
import type { Agent, City, CityPolitics, Tribe, WorldState } from './types';

/**
 * Revolution & politics (Phase 7). The original code used a single instantaneous gate
 * (unrest ≥ 0.6 + a rebel in this very tick → revolt), so in a long-run world whose unrest
 * oscillated below the line, `totalRevolutions` stayed 0 forever despite hundreds of protests.
 *
 * This is now an escalation ladder with cumulative pressure + cooldowns + diverse outcomes:
 *
 *   stable → grievance → movement → riot → ( repression | reform | revolution | civil war )
 *
 * Per-city `politics` accumulates protest/revolutionary/reform pressure across intervals, so
 * sustained discontent eventually resolves — into a peaceful reform, a crackdown, a
 * revolution, or a civil war — instead of simmering indefinitely. Every outcome has real,
 * lasting consequences and an aftermath cooldown so revolutions don't spam.
 */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function emptyPolitics(cycle: number): CityPolitics {
  return {
    phase: 'stable',
    legitimacy: 0.6,
    protestPressure: 0,
    revolutionaryPressure: 0,
    repressionLevel: 0,
    reformPressure: 0,
    repressionCount: 0,
    lastProtestCycle: -1,
    lastRevolutionCycle: -1,
    lastReformCycle: -1,
    cooldownUntil: cycle,
  };
}

/** Fire a one-time chronicle milestone (keyed in world.milestones) for political firsts. */
function firstOnly(
  world: WorldState,
  key: string,
  ev: Parameters<typeof recordEvent>[1],
): void {
  if (world.milestones.includes(key)) return;
  world.milestones.push(key);
  recordEvent(world, ev);
}

export function updateRevolutions(world: WorldState, rng: RNG): void {
  const byTribe = new Map<number, Agent[]>();
  for (const a of world.agents) {
    if (!a.alive || a.tribeId === null) continue;
    let g = byTribe.get(a.tribeId);
    if (!g) byTribe.set(a.tribeId, (g = []));
    g.push(a);
  }
  const tribeById = new Map<number, Tribe>();
  for (const t of world.tribes) tribeById.set(t.id, t);

  for (const city of world.cities) {
    if (!city.politics) city.politics = emptyPolitics(world.cycle);
    const tribe = tribeById.get(city.tribeId);
    if (!tribe || tribe.leaderId === null) continue;
    const members = byTribe.get(tribe.id) ?? [];
    if (members.length < 4) continue;

    const leaderId = tribe.leaderId;
    const rebel = findRebel(members, leaderId);
    const p = city.politics;

    // --- inputs → legitimacy + pressures ---
    let starving = 0;
    let loy = 0;
    let counted = 0;
    for (const m of members) {
      if (m.energy < m.maxEnergy * 0.4) starving += 1;
      if (m.id !== leaderId) {
        const rel = m.relationships.get(leaderId);
        loy += rel ? rel.trust * 0.6 + rel.loyalty * 0.4 : 0;
        counted += 1;
      }
    }
    const leaderTrust = counted > 0 ? loy / counted : 0.5;
    const starveFrac = starving / members.length;
    p.legitimacy = clamp01(leaderTrust * 0.6 + (1 - city.inequality) * 0.2 + (1 - starveFrac) * 0.2);

    const u = city.unrest;
    p.protestPressure =
      u >= POLITICS.movementUnrest
        ? clamp01(p.protestPressure + POLITICS.pressureGain)
        : clamp01(p.protestPressure - POLITICS.pressureDecay);
    p.revolutionaryPressure =
      u >= POLITICS.riotUnrest
        ? clamp01(p.revolutionaryPressure + POLITICS.pressureGain * (1 - p.legitimacy + 0.3))
        : clamp01(p.revolutionaryPressure - POLITICS.pressureDecay);
    // reform appetite grows when there is strain but the regime still has some legitimacy
    const cooperativeLean = tribe.ideology === 'cooperative' || tribe.ideology === 'spiritual' || tribe.ideology === 'trader';
    p.reformPressure =
      u >= POLITICS.grievanceUnrest && (p.legitimacy > 0.35 || cooperativeLean)
        ? clamp01(p.reformPressure + POLITICS.pressureGain * (cooperativeLean ? 1.3 : 0.8))
        : clamp01(p.reformPressure - POLITICS.pressureDecay);
    p.repressionLevel = clamp01(p.repressionLevel - 0.04);

    // --- phase ---
    p.phase =
      u >= POLITICS.riotUnrest
        ? 'riot'
        : u >= POLITICS.movementUnrest
          ? 'movement'
          : u >= POLITICS.grievanceUnrest
            ? 'grievance'
            : 'stable';

    if (p.phase === 'grievance' || p.phase === 'movement') {
      assignProtests(members, leaderId, rebel, world, p);
      if (p.phase === 'movement') {
        firstOnly(world, 'firstMovement', {
          category: 'politics',
          severity: 2,
          title: 'A Movement Stirs',
          description: `Discontent in ${city.name} hardened into an organized movement.`,
          cityId: city.id,
        });
      }
    }

    // resolution only fires at riot phase and outside the aftermath cooldown
    if (p.phase === 'riot' && world.cycle >= p.cooldownUntil) {
      firstOnly(world, 'firstRiot', {
        category: 'politics',
        severity: 3,
        title: 'Riot',
        description: `${city.name} erupted into open riot.`,
        cityId: city.id,
      });
      const authoritarian = tribe.ideology === 'authoritarian' || tribe.ideology === 'militaristic';
      const leader = members.find((m) => m.id === leaderId);

      if (
        p.repressionCount >= POLITICS.repressionsBeforeReform &&
        world.cycle - p.lastReformCycle > POLITICS.repressionWindow
      ) {
        // repeated crackdowns force a reckoning: rigid regimes fracture, others reform
        if (authoritarian && rebel) civilWar(city, tribe, members, rebel, leaderId, world);
        else reform(city, tribe, members, leaderId, world);
        p.cooldownUntil = world.cycle + POLITICS.cooldown;
      } else if (p.revolutionaryPressure >= POLITICS.revoltPressure && rebel) {
        if (authoritarian && leader && leader.energy > 40 && rng.chance(0.55)) {
          repress(city, members, leaderId, rebel, world);
          p.repressionCount += 1;
          p.repressionLevel = 1;
          p.cooldownUntil = world.cycle + Math.floor(POLITICS.cooldown * 0.6);
        } else {
          revolt(city, tribe, members, rebel, leaderId, world);
          p.lastRevolutionCycle = world.cycle;
          p.revolutionaryPressure = 0;
          p.repressionCount = 0;
          p.cooldownUntil = world.cycle + POLITICS.cooldown;
        }
      } else if (p.reformPressure >= POLITICS.reformPressure) {
        reform(city, tribe, members, leaderId, world);
        p.lastReformCycle = world.cycle;
        p.reformPressure = 0;
        p.cooldownUntil = world.cycle + POLITICS.cooldown;
      } else {
        assignProtests(members, leaderId, rebel, world, p);
      }
    }

    // slow relaxation of unrest once a city is past its founding turmoil
    if (world.cycle - city.foundedCycle > 60) city.unrest = clamp01(city.unrest * POLITICS.unrestDecay);
  }
}

/** The most ambitious, aggressive, disloyal non-leader — preferring agents in the rebel role. */
function findRebel(members: Agent[], leaderId: number): Agent | null {
  let rebel: Agent | null = null;
  let best: number = POLITICS.rebelScoreMin;
  for (const m of members) {
    if (m.id === leaderId) continue;
    const rel = m.relationships.get(leaderId);
    const disloyal = rel ? Math.min(1, 1 - rel.loyalty + rel.resentment * 0.5 + rel.rivalry * 0.5) : 1;
    let score = m.traits.ambition * 0.5 + m.traits.aggression * 0.2 + disloyal * 0.3;
    if (m.role === 'rebel') score += 0.15;
    if (score > best || (score === best && rebel !== null && m.id < rebel.id)) {
      best = score;
      rebel = m;
    }
  }
  return rebel;
}

function revolt(
  city: City,
  tribe: Tribe,
  members: Agent[],
  rebel: Agent,
  oldLeaderId: number,
  world: WorldState,
): void {
  tribe.leaderId = rebel.id;
  city.leaderId = rebel.id;

  const sorted = members.slice().sort((a, b) => b.energy - a.energy);
  const nElite = Math.max(1, Math.floor(sorted.length * 0.2));
  let pool = city.storedEnergy * REVOLUTION.redistributeFrac;
  city.storedEnergy -= pool;
  for (let i = 0; i < nElite; i++) {
    const e = sorted[i];
    const skim = e.energy * REVOLUTION.eliteSkim;
    e.energy -= skim;
    pool += skim;
  }
  const poor = sorted.slice(Math.floor(sorted.length * 0.5));
  if (poor.length > 0) {
    const each = pool / poor.length;
    for (const pmem of poor) {
      const room = pmem.maxEnergy - pmem.energy;
      const g = Math.min(each, room);
      pmem.energy += g;
      city.storedEnergy += each - g;
    }
  } else {
    city.storedEnergy += pool;
  }

  for (const m of members) {
    if (m.id === rebel.id) continue;
    const rr = ensureRel(m, rebel.id, world.cycle);
    adjust(rr, 'loyalty', 0.2);
    adjust(rr, 'trust', 0.15);
    if (m.id !== oldLeaderId) {
      const lr = ensureRel(m, oldLeaderId, world.cycle);
      adjust(lr, 'trust', -0.3);
      adjust(lr, 'resentment', 0.2);
    }
    if (m.state === 'protesting' || m.state === 'organizing_protest') m.state = 'wandering';
    remember(m, 'witnessed_revolution', world.cycle, { otherId: rebel.id, strength: 0.7 });
  }

  city.unrest = 0.2;
  city.politics.legitimacy = 0.55;
  for (let i = city.buildings.length - 1; i >= 0; i--) {
    if (!city.buildings[i].damaged) {
      city.buildings[i].damaged = true;
      break;
    }
  }
  city.history.push({ cycle: world.cycle, text: `revolution — ${rebel.name} overthrew the leader` });
  if (city.history.length > 24) city.history.shift();
  world.totalRevolutions += 1;
  firstOnly(world, 'firstRevolution', {
    category: 'revolution',
    severity: 5,
    title: 'The First Revolution',
    description: `${rebel.name} led the first revolution, overthrowing the rulers of ${city.name}.`,
    agentIds: [rebel.id, oldLeaderId],
    tribeId: tribe.id,
    cityId: city.id,
  });
  recordEvent(world, {
    category: 'revolution',
    severity: 4,
    title: 'Revolution',
    description: `${rebel.name} overthrew the leadership of ${city.name} and seized the treasury for the poor.`,
    agentIds: [rebel.id, oldLeaderId],
    tribeId: tribe.id,
    cityId: city.id,
  });
  pushPulse(world, city.x, city.y, 'revolution', REVOLUTION.pulseTicks);
}

/** Peaceful reform: tax relief, redistribution, an ideology softening, restored legitimacy. */
function reform(city: City, tribe: Tribe, members: Agent[], leaderId: number, world: WorldState): void {
  city.taxRate = Math.max(0.05, city.taxRate - 0.05);
  // redistribute a modest share of the treasury to the poorest
  const sorted = members.slice().sort((a, b) => a.energy - b.energy);
  const poor = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.4)));
  let pool = city.storedEnergy * 0.3;
  city.storedEnergy -= pool;
  const each = pool / poor.length;
  for (const m of poor) {
    const room = m.maxEnergy - m.energy;
    const g = Math.min(each, room);
    m.energy += g;
    city.storedEnergy += each - g;
    remember(m, 'witnessed_reform', world.cycle, { strength: 0.5 });
  }
  // ideology softens toward cooperation
  if (tribe.ideology === 'authoritarian') tribe.ideology = 'cooperative';
  else if (tribe.ideology === 'militaristic') tribe.ideology = 'expansionist';
  // legitimacy + trust recover; unrest eases
  for (const m of members) {
    if (m.id === leaderId) continue;
    const lr = ensureRel(m, leaderId, world.cycle);
    adjust(lr, 'trust', 0.12);
    adjust(lr, 'resentment', -0.1);
    if (m.state === 'protesting' || m.state === 'organizing_protest') m.state = 'wandering';
  }
  city.unrest = clamp01(city.unrest - 0.3);
  city.politics.legitimacy = clamp01(city.politics.legitimacy + 0.25);
  city.politics.repressionCount = 0;
  city.history.push({ cycle: world.cycle, text: 'reforms eased the unrest' });
  if (city.history.length > 24) city.history.shift();
  firstOnly(world, 'firstReform', {
    category: 'politics',
    severity: 3,
    title: 'The First Reform',
    description: `${city.name} chose reform over ruin — taxes eased and the treasury opened to the poor.`,
    cityId: city.id,
  });
  recordEvent(world, {
    category: 'politics',
    severity: 2,
    title: 'Reform',
    description: `${city.name} reformed: lower taxes and redistribution calmed the unrest.`,
    cityId: city.id,
  });
}

/** Civil war: the regime fractures — the rebel ousts the leader and the old elite is exiled. */
function civilWar(
  city: City,
  tribe: Tribe,
  members: Agent[],
  rebel: Agent,
  oldLeaderId: number,
  world: WorldState,
): void {
  revolt(city, tribe, members, rebel, oldLeaderId, world);
  // a faction of the old elite is exiled — they leave the tribe to (re)form their own
  const sorted = members.slice().sort((a, b) => b.energy - a.energy);
  const exiles = sorted.slice(0, Math.max(1, Math.floor(sorted.length * 0.15)));
  let exiled = 0;
  for (const e of exiles) {
    if (e.id === rebel.id) continue;
    e.tribeId = null;
    e.cityId = null;
    e.energy = Math.max(1, e.energy - 6);
    remember(e, 'left_tribe', world.cycle, { strength: 0.6 });
    exiled += 1;
  }
  world.totalConflicts += exiled;
  city.unrest = clamp01(city.unrest + 0.15);
  firstOnly(world, 'firstCivilWar', {
    category: 'revolution',
    severity: 5,
    title: 'Civil War',
    description: `${city.name} tore itself apart — the old elite was driven into exile.`,
    cityId: city.id,
    tribeId: tribe.id,
  });
  recordEvent(world, {
    category: 'revolution',
    severity: 4,
    title: 'Civil War',
    description: `Faction fighting in ${city.name} exiled ${exiled} of the old elite.`,
    cityId: city.id,
    tribeId: tribe.id,
  });
}

function repress(city: City, members: Agent[], leaderId: number, rebel: Agent, world: WorldState): void {
  let crushed = 0;
  for (const m of members) {
    if (m.id !== rebel.id && m.state !== 'protesting' && m.state !== 'organizing_protest') continue;
    m.energy -= REVOLUTION.repressDamage;
    crushed += 1;
    const lr = ensureRel(m, leaderId, world.cycle);
    adjust(lr, 'resentment', 0.3);
    adjust(lr, 'fear', 0.2);
    if (m.energy <= 0) {
      m.energy = 0;
      m.alive = false;
      m.state = 'dying';
    } else if (m.state === 'protesting' || m.state === 'organizing_protest') {
      m.state = 'fleeing';
    }
  }
  world.totalConflicts += crushed;
  city.unrest = Math.max(0.2, city.unrest - 0.25);
  city.history.push({ cycle: world.cycle, text: `the leadership crushed unrest (${crushed} struck)` });
  if (city.history.length > 24) city.history.shift();
  if (crushed > 0) {
    firstOnly(world, 'firstRepression', {
      category: 'politics',
      severity: 3,
      title: 'The First Crackdown',
      description: `The rulers of ${city.name} answered dissent with force.`,
      cityId: city.id,
    });
    recordEvent(world, {
      category: 'conflict',
      severity: 3,
      title: 'Crackdown',
      description: `The rulers of ${city.name} crushed dissent — ${crushed} struck down.`,
      cityId: city.id,
    });
  }
  pushPulse(world, city.x, city.y, 'repression', REVOLUTION.pulseTicks);
}

function assignProtests(
  members: Agent[],
  leaderId: number,
  rebel: Agent | null,
  world: WorldState,
  p: CityPolitics,
): void {
  const target = rebel ? rebel.id : leaderId;
  const poor = members
    .filter((m) => m.id !== leaderId && m.energy < m.maxEnergy * 0.45)
    .sort((a, b) => a.energy - b.energy)
    .slice(0, REVOLUTION.maxProtesters);
  let added = 0;
  for (const m of poor) {
    if (m.state !== 'protesting') added += 1;
    m.state = 'protesting';
    m.targetAgentId = target;
  }
  world.totalProtests += added;
  if (added > 0) p.lastProtestCycle = world.cycle;
}
