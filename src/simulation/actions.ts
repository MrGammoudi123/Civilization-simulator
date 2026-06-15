import { cultureBias } from './culture';
import type {
  ActionKind,
  Agent,
  AgentState,
  CultureMemory,
  Perception,
  Tribe,
} from './types';

/**
 * Action space + utility selection (W3). In "normal life" (no survival/safety override firing)
 * an agent no longer follows a rigid priority cascade: it generates the action options open to
 * it, scores each by utility, and picks the best. Utility blends inherited/learned policy
 * weights (brain), the current perception, role tendency, and a small deterministic per-agent
 * noise — so two agents with different histories diverge (W4 learning fills the brain), while the
 * stream stays reproducible (the noise is a pure hash, NOT a draw from the world RNG).
 *
 * Survival, fear, conflict, protest and hunger remain hard overrides in decisions.ts; this module
 * governs the rest of life (what a *fed* agent chooses to do), which is where learning lives.
 */

/** Deterministic per-agent noise in [0,1) — reproducible, independent of the world RNG order. */
export function actionNoise(id: number, cycle: number, salt: number): number {
  let h = (Math.imul(id, 374761393) + Math.imul(cycle, 668265263) + Math.imul(salt, 40503)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

/** Coarse context bucket (W4 learning keys its value estimates on this). Compact + stable. */
export function contextHash(p: Perception, role: string): string {
  const b = (v: number) => (v < 0.33 ? 0 : v < 0.66 ? 1 : 2);
  return `${role[0]}${b(p.energyFrac)}${b(p.danger)}${b(p.scarcity)}${b(p.socialOpportunity)}${b(p.cityUnrest)}`;
}

export interface ActionContext {
  helpId: number; // -1 if none
  allyId: number;
  followId: number;
  leaderId: number; // own tribe leader, for organize
  discovery: number; // world discoveryRisk
}

interface Option {
  action: ActionKind;
  state: AgentState;
  target: number | null;
  base: number; // hand-shaped base utility (reproduces the old cascade's intent on day one)
}

/**
 * The agent's role vocation as a concrete option (state + a representative ActionKind key for
 * learning). Mirrors the old assignRoleState so role-driven diversity is preserved — but now it
 * *competes* by utility instead of being hard-wired. Returns null for roles with no settled
 * vocation (gatherer / idle thief), which fall through to social/rest/wander options.
 */
function roleVocation(a: Agent, ctx: ActionContext, hasTribe: boolean): Option | null {
  const mk = (action: ActionKind, state: AgentState, target: number | null, base: number): Option => ({
    action,
    state,
    target,
    base,
  });
  switch (a.role) {
    case 'builder':
      return hasTribe ? mk('build', 'building', null, 0.5) : null;
    case 'leader':
      return hasTribe ? mk('organize', 'governing', null, 0.55) : null;
    case 'historian':
      return hasTribe ? mk('teach', 'archiving_history', null, 0.45) : null;
    case 'guard':
      return hasTribe ? mk('rest', 'guarding', null, 0.45) : null;
    case 'rebel':
      return hasTribe ? mk('organize', 'organizing_protest', ctx.leaderId >= 0 ? ctx.leaderId : null, 0.45) : null;
    case 'trader':
      return ctx.allyId >= 0 ? mk('trade', 'trading', ctx.allyId, 0.45) : null;
    case 'healer':
      return ctx.helpId >= 0 ? mk('share', 'healing', ctx.helpId, 0.5) : null;
    case 'priest':
      return mk('worship', 'worshipping', null, 0.45);
    case 'prophet':
      return mk('worship', ctx.discovery > 0.4 ? 'debating' : 'worshipping', null, 0.45);
    case 'farmer':
      return mk('harvest', 'farming', null, 0.45);
    case 'scout':
    case 'explorer':
      return mk('seek_energy', 'scouting', null, 0.45);
    case 'investigator':
      return mk('investigate', a.traits.curiosity > 0 && ctx.discovery > 0.35 ? 'investigating_reality' : 'scouting', null, 0.45);
    case 'refugee':
      return a.tribeId === null ? mk('migrate', 'migrating', null, 0.5) : null;
    default:
      return null; // gatherer, idle thief
  }
}

/**
 * Choose the agent's state for normal (non-emergency) life by utility. Returns the winning
 * state + target. Deterministic given (agent, perception, context, cycle).
 */
export function chooseNormalLifeState(
  a: Agent,
  p: Perception,
  ctx: ActionContext,
  myTribe: Tribe | undefined,
  cycle: number,
  culture?: CultureMemory,
): { state: AgentState; target: number | null; action: ActionKind } {
  const t = a.traits;
  const brain = a.brain;
  const options: Option[] = [];

  // role vocation (preserves diversity; now competes rather than dictates)
  const voc = roleVocation(a, ctx, myTribe !== undefined);
  if (voc) options.push(voc);

  // rest — only attractive when genuinely full
  options.push({
    action: 'rest',
    state: 'resting',
    target: null,
    base: p.energyFrac > 0.85 ? 0.25 + (p.energyFrac - 0.85) * 1.5 : 0.05,
  });

  // follow a trusted/admired model (the old socialNeed tier)
  if (ctx.followId >= 0) {
    options.push({
      action: 'follow',
      state: 'following_leader',
      target: ctx.followId,
      base: t.socialNeed * 0.6 + p.socialOpportunity * 0.3,
    });
  }

  // help a needy neighbor (the old altruism tier)
  if (ctx.helpId >= 0 && p.energyFrac > 0.55) {
    options.push({
      action: 'share',
      state: 'helping',
      target: ctx.helpId,
      base: t.empathy * 0.7 + (p.energyFrac - 0.55) * 0.4,
    });
  }

  // trade with an ally
  if (ctx.allyId >= 0) {
    options.push({
      action: 'trade',
      state: 'trading',
      target: ctx.allyId,
      base: t.socialNeed * 0.25 + t.greed * 0.2 + (p.nearbyCity ? 0.2 : 0),
    });
  }

  // top up energy even when not starving (scouts/explorers range; others forage locally)
  {
    const ranged = a.role === 'scout' || a.role === 'explorer' || a.role === 'investigator';
    options.push({
      action: 'seek_energy',
      state: ranged ? 'scouting' : 'searching_energy',
      target: null,
      base: (1 - p.energyFrac) * 0.5 + (1 - p.nearbyEnergy) * t.curiosity * 0.15,
    });
  }

  // organize dissent when the city is restless and the agent is ambitious/disloyal
  if (myTribe && p.cityUnrest > 0.45) {
    options.push({
      action: 'organize',
      state: 'organizing_protest',
      target: ctx.leaderId >= 0 ? ctx.leaderId : null,
      base: t.ambition * 0.4 + t.aggression * 0.2 + (p.cityUnrest - 0.45) * 0.6 - t.loyalty * 0.3,
    });
  }

  // investigate — evidence-gated (W1.4 consistency: needs personal suspicion, not just society's)
  if (p.suspicionEvidence > 0) {
    options.push({
      action: 'investigate',
      state: 'investigating_reality',
      target: null,
      base: p.suspicionEvidence * 0.6 + t.curiosity * t.intelligence * 0.25,
    });
  }

  // experiment — probe the world's materials (W7). Curious/experimental minds do this readily;
  // it competes with vocations so discovery emerges without being forced.
  options.push({
    action: 'experiment',
    state: 'scouting',
    target: null,
    base: 0.12 + p.experimentOpportunity * (brain ? brain.experimentationBias : t.curiosity) * 0.4,
  });

  // migrate away when rootless / under heavy scarcity + fear
  if (a.tribeId === null || (p.scarcity > 0.8 && t.fear > 0.5)) {
    options.push({
      action: 'migrate',
      state: 'migrating',
      target: null,
      base: t.fear * 0.3 + p.scarcity * 0.25 + (a.tribeId === null ? 0.3 : 0),
    });
  }

  // wander — the floor option
  options.push({ action: 'move_random', state: 'wandering', target: null, base: 0.1 });

  // score: base + learned policy weight + learned context value + small deterministic noise
  const ch = contextHash(p, a.role);
  const qCtx = brain ? brain.qByContext[ch] : undefined;
  let best = options[0];
  let bestScore = -Infinity;
  for (let i = 0; i < options.length; i++) {
    const o = options[i];
    const pw = brain && brain.policyWeights[o.action] !== undefined ? (brain.policyWeights[o.action] as number) : 0;
    const q = qCtx && qCtx[o.action] !== undefined ? (qCtx[o.action] as number) : 0;
    const cb = culture ? cultureBias(culture, o.action) : 0; // W8 — the tribe's customs pull the choice
    const score = o.base + pw + q + cb + actionNoise(a.id, cycle, i + 1) * 0.05;
    if (score > bestScore) {
      bestScore = score;
      best = o;
    }
  }
  return { state: best.state, target: best.target, action: best.action };
}
