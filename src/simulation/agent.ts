import { RNG } from './rng';
import { SIM } from './config';
import { createBrain, createLexicon, inheritBrain } from './brain';
import type { Agent, PersonalityTraits, WorldParams } from './types';

// Procedural name generation — deterministic given the RNG stream.
const SYLL_A = [
  'or', 'na', 'zi', 'ka', 've', 'lu', 'mi', 'ta', 'ro', 'en',
  'su', 'xa', 'ne', 'li', 'do', 'fa', 'ry', 'um', 'az', 'el',
];
const SYLL_B = [
  'ra', 'na', 'ko', 'li', 'sha', 'to', 'mi', 'va', 'ren', 'dor',
  'lis', 'tum', 'wen', 'kar', 'nys', 'vel', 'ash', 'rin', 'oth', 'ux',
];

export function makeName(rng: RNG): string {
  const name = rng.pick(SYLL_A) + rng.pick(SYLL_B);
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

export function randomTraits(rng: RNG): PersonalityTraits {
  return {
    curiosity: rng.next(),
    aggression: rng.next(),
    empathy: rng.next(),
    fear: rng.next(),
    greed: rng.next(),
    loyalty: rng.next(),
    intelligence: rng.next(),
    socialNeed: rng.next(),
    independence: rng.next(),
    ambition: rng.next(),
  };
}

/** Child traits = parent traits + bounded random mutation. */
export function inheritTraits(parent: PersonalityTraits, rng: RNG): PersonalityTraits {
  const m = SIM.mutationRate;
  const mut = (v: number) => clamp01(v + rng.range(-m, m));
  return {
    curiosity: mut(parent.curiosity),
    aggression: mut(parent.aggression),
    empathy: mut(parent.empathy),
    fear: mut(parent.fear),
    greed: mut(parent.greed),
    loyalty: mut(parent.loyalty),
    intelligence: mut(parent.intelligence),
    socialNeed: mut(parent.socialNeed),
    independence: mut(parent.independence),
    ambition: mut(parent.ambition),
  };
}

function lifespan(rng: RNG): number {
  return SIM.lifespanBase + rng.range(-SIM.lifespanVar, SIM.lifespanVar);
}

/** A founding agent (generation 1), placed randomly. */
export function createAgent(id: number, rng: RNG, params: WorldParams): Agent {
  const a: Agent = {
    id,
    name: makeName(rng),
    x: rng.range(0, params.width),
    y: rng.range(0, params.height),
    vx: 0,
    vy: 0,
    energy: rng.range(SIM.startEnergyMin, SIM.startEnergyMax),
    maxEnergy: SIM.agentMaxEnergy,
    age: 0,
    lifespan: lifespan(rng),
    generation: 1,
    tribeId: null,
    cityId: null,
    state: 'wandering',
    role: 'gatherer', // reassigned from traits/context by assignRoles within a few intervals
    roleAssignedCycle: 0,
    traits: randomTraits(rng),
    targetEnergyId: null,
    targetAgentId: null,
    reproduceCooldown: SIM.reproduceCooldown,
    relationships: new Map(),
    memory: [],
    speakCooldown: 0,
    bubble: null,
    alive: true,
  };
  // Seeded after the literal (pure, no RNG draw) so the deterministic RNG order is unchanged.
  a.brain = createBrain(a.traits);
  a.lexicon = createLexicon();
  return a;
}

/** A child spawned next to its parent, inheriting traits with mutation. */
export function createChild(id: number, parent: Agent, rng: RNG): Agent {
  const angle = rng.range(0, Math.PI * 2);
  const d = rng.range(6, 16);
  const child: Agent = {
    id,
    name: makeName(rng),
    x: parent.x + Math.cos(angle) * d,
    y: parent.y + Math.sin(angle) * d,
    vx: 0,
    vy: 0,
    energy: SIM.reproduceCost,
    maxEnergy: SIM.agentMaxEnergy,
    age: 0,
    lifespan: lifespan(rng),
    generation: parent.generation + 1,
    tribeId: parent.tribeId,
    cityId: parent.cityId,
    state: 'wandering',
    role: parent.role, // inherits the parent's vocation; drifts as assignRoles re-evaluates
    roleAssignedCycle: 0,
    traits: inheritTraits(parent.traits, rng),
    targetEnergyId: null,
    targetAgentId: null,
    reproduceCooldown: SIM.reproduceCooldown,
    relationships: new Map(),
    memory: [],
    speakCooldown: 0,
    bubble: null,
    alive: true,
  };
  // W5: inherit the parent's *learned* policy weights + learning params (mutated), so successful
  // strategies pass down the generations. Pure — mutation uses the child-id hash, not the world
  // RNG — so inheritance does not perturb the deterministic stream.
  child.brain = inheritBrain(parent.brain, child.traits, id);
  child.lexicon = createLexicon();
  return child;
}
