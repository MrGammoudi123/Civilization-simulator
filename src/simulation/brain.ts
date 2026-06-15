import { actionNoise } from './actions';
import type { ActionKind, Agent, AgentBrain, AgentLexicon, PersonalityTraits } from './types';

/**
 * The agent learning brain. Deterministic contextual-utility learning — NOT a neural network.
 * A brain is seeded from traits (W2); over a lifetime (W4) it updates per-context action values
 * (`qByContext`) and action biases (`policyWeights`) from the *reward* each chosen action earns,
 * so two agents with different histories diverge even with identical traits.
 *
 * All of this is pure arithmetic (no RNG) so it never perturbs the world's deterministic stream.
 */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

// W4 learning bounds + caps (kept small so brains stay compact for long runs / saves — W11).
const MAX_ACTION_MEMORY = 16;
const MAX_CONTEXTS = 32;
const POLICY_WEIGHT_LIMIT = 2;

/** A fresh brain whose biases are derived from personality (no learned values yet). */
export function createBrain(traits: PersonalityTraits): AgentBrain {
  return {
    policyWeights: {},
    qByContext: {},
    actionMemory: [],
    beliefs: [],
    curiosityPressure: clamp01(traits.curiosity),
    experimentationBias: clamp01((traits.curiosity + traits.intelligence) / 2),
    imitationBias: clamp01(traits.socialNeed),
    riskTolerance: clamp01(1 - traits.fear),
    lastReward: 0,
    learningRate: clamp01(0.08 + traits.intelligence * 0.12),
  };
}

/** A fresh, empty lexicon (no invented tokens, no dialect yet). */
export function createLexicon(): AgentLexicon {
  return { tokens: [], dialectId: null };
}

/** Guarantee an agent has a brain (used on load / migration). Returns it. */
export function ensureBrain(a: Agent): AgentBrain {
  if (!a.brain) a.brain = createBrain(a.traits);
  return a.brain;
}

/** Guarantee an agent has a lexicon. Returns it. */
export function ensureLexicon(a: Agent): AgentLexicon {
  if (!a.lexicon) a.lexicon = createLexicon();
  return a.lexicon;
}

// ----------------------------------------------------------------- lifetime learning (W4)

/**
 * Net social standing: positive bonds minus hostility across the agent's (capped) relationships.
 * The change in this between actions is the social component of reward (sharing/helping/trading
 * make allies → reward; stealing/attacking make enemies → punishment). Cheap (≤ REL_CAP entries).
 */
export function socialBalance(a: Agent): number {
  let s = 0;
  for (const r of a.relationships.values()) {
    s += r.friendship + 0.6 * r.trust + 0.4 * r.loyalty - r.rivalry - r.resentment - r.fear;
  }
  return s;
}

/** Small per-action shaping: a faint cost for idling/probing so they aren't free. */
function actionShaping(action: ActionKind): number {
  switch (action) {
    case 'experiment':
      return -0.04; // experimenting costs time now; W7 makes the payoff real
    case 'move_random':
      return -0.03; // aimless wandering is mildly wasteful
    case 'rest':
      return -0.01;
    default:
      return 0;
  }
}

/**
 * Snapshot the action just chosen so its outcome can be scored at the next decision. Called from
 * the decision pass right after an action is selected (W4). Pure.
 */
export function recordActionStart(a: Agent, action: ActionKind, contextHash: string): void {
  const br = a.brain;
  if (!br) return;
  br.lastAction = action;
  br.lastContext = contextHash;
  br.lastEnergyAtAction = a.energy;
  br.lastSocialAtAction = socialBalance(a);
}

/**
 * Score the outcome of the last chosen action and learn from it (W4). Computes a reward from the
 * energy + social change since the action was chosen (plus a survival bonus and action shaping),
 * updates the per-context value estimate toward that reward, nudges the action's policy weight
 * (bounded), and records a capped outcome memory. Deterministic. No-op until an action exists.
 *
 *   reward = energyDelta + socialDelta + survival − (injury, wasted time, enemies made)
 */
export function learnFromOutcome(a: Agent, cycle: number): void {
  const br = a.brain;
  if (!br || br.lastAction === undefined || br.lastAction === null) return;

  const energyDelta = a.energy - (br.lastEnergyAtAction ?? a.energy);
  const socialDelta = socialBalance(a) - (br.lastSocialAtAction ?? 0);
  const action = br.lastAction;
  const ctx = br.lastContext ?? '';

  // blended reward (energy is the survival backbone; social shapes cooperation/conflict)
  const reward =
    energyDelta * 0.08 + // +energy good, −energy (injury/cost) bad
    socialDelta * 0.5 + // allies gained vs enemies made
    0.05 + // being alive another interval
    actionShaping(action);
  br.lastReward = reward;

  // per-context value estimate (contextual bandit update)
  const q = (br.qByContext[ctx] ??= {});
  const prevQ = q[action] ?? 0;
  q[action] = prevQ + br.learningRate * (reward - prevQ);

  // policy-weight nudge toward the sign of reward, bounded so weights can't run away
  const pw = br.policyWeights[action] ?? 0;
  br.policyWeights[action] = clamp(
    pw + br.learningRate * Math.tanh(reward) * 0.15,
    -POLICY_WEIGHT_LIMIT,
    POLICY_WEIGHT_LIMIT,
  );

  // capped outcome memory (oldest dropped)
  br.actionMemory.push({
    cycle,
    contextHash: ctx,
    action,
    reward,
    energyDelta,
    trustDelta: socialDelta,
    injuryDelta: Math.min(0, energyDelta),
    statusDelta: 0,
    reproductionDelta: 0,
  });
  if (br.actionMemory.length > MAX_ACTION_MEMORY) br.actionMemory.shift();

  // bound the number of remembered contexts (drop the oldest-inserted key)
  const keys = Object.keys(br.qByContext);
  if (keys.length > MAX_CONTEXTS) delete br.qByContext[keys[0]];
}

// --------------------------------------------------------- genetic + cultural evolution (W5)

const BRAIN_MUTATION = 0.1;

/**
 * Inherit a brain from a parent (W5). The child starts life with the parent's *learned* action
 * biases (`policyWeights`) and learning parameters — its evolved instinct — each mutated, so good
 * strategies spread across generations and drift. Lifetime-specific state (per-context values,
 * outcome memory, beliefs) is NOT inherited — each child learns its own. Pure + deterministic:
 * mutation uses the per-agent hash keyed on the child's id (no world-RNG draw), so inheritance
 * never perturbs the world's random stream.
 */
export function inheritBrain(parent: AgentBrain | undefined, traits: PersonalityTraits, childId: number): AgentBrain {
  const base = createBrain(traits);
  if (!parent) return base;
  const mut = (v: number, salt: number) => v + (actionNoise(childId, salt, 7) - 0.5) * 2 * BRAIN_MUTATION;
  let i = 0;
  for (const k of Object.keys(parent.policyWeights) as ActionKind[]) {
    base.policyWeights[k] = clamp(mut(parent.policyWeights[k] ?? 0, i + 1), -POLICY_WEIGHT_LIMIT, POLICY_WEIGHT_LIMIT);
    i += 1;
  }
  base.learningRate = clamp01(mut(parent.learningRate, 101));
  base.experimentationBias = clamp01(mut(parent.experimentationBias, 102));
  base.imitationBias = clamp01(mut(parent.imitationBias, 103));
  base.riskTolerance = clamp01(mut(parent.riskTolerance, 104));
  base.curiosityPressure = clamp01(mut(parent.curiosityPressure, 105));
  return base;
}

/**
 * Imitation (W5): a learner nudges its action biases toward a successful model's, scaled by its
 * own imitation bias. This is how a good strategy spreads *within* a generation (the follower of
 * a thriving leader/elder/discoverer slowly adopts their habits). Pure (no RNG).
 */
export function imitate(learner: Agent, model: Agent): void {
  const lb = learner.brain;
  const mb = model.brain;
  if (!lb || !mb) return;
  const rate = lb.imitationBias * 0.05;
  if (rate <= 0) return;
  for (const k of Object.keys(mb.policyWeights) as ActionKind[]) {
    const mv = mb.policyWeights[k] ?? 0;
    const lv = lb.policyWeights[k] ?? 0;
    lb.policyWeights[k] = clamp(lv + (mv - lv) * rate, -POLICY_WEIGHT_LIMIT, POLICY_WEIGHT_LIMIT);
  }
}
