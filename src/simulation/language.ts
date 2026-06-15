import { actionNoise } from './actions';
import { ensureLexicon } from './brain';
import type { Agent, AgentLexicon, MessageCategory, SymbolToken, WorldState } from './types';

/**
 * Emergent symbolic language (W6). Agents do not speak hardcoded sentences — they invent short
 * pronounceable *tokens* and ground them in a fixed space of meaning DIMENSIONS (the developer
 * writes the physics of meaning, never the words). A token gains meaning by being used in a
 * context, confidence by being reused, and spreads when nearby listeners copy it (imitation).
 * Copies occasionally drift, so isolated groups diverge into dialects over time. The UI reads a
 * token's meaning vector to show an *estimated* gloss + confidence — interpretation, not script.
 *
 * Deterministic: tokens are generated from a world counter and drift is a per-agent hash — no
 * draw from the world RNG, so language never perturbs the deterministic simulation stream.
 */

// The meaning space — dimensions only. Tokens become meaningful by use; these are never spoken.
export const CONCEPTS = [
  'energy', 'danger', 'self', 'other', 'help', 'death',
  'anomaly', 'trade', 'tribe', 'move', 'good', 'bad',
] as const;
export type Concept = (typeof CONCEPTS)[number];

type Meaning = Partial<Record<Concept, number>>;

/**
 * Grounding: what each message category *means* (a target vector over concepts). This is the
 * developer-authored meaning physics that replaces the old sentence templates — an agent that
 * speaks in a category grounds a token in this meaning, but the token string itself is invented.
 */
const GROUNDING: Partial<Record<MessageCategory, Meaning>> = {
  survival: { energy: 1, self: 0.3 },
  fear: { danger: 1, bad: 0.6 },
  friendship: { other: 0.8, good: 0.7, tribe: 0.4 },
  bonding: { other: 0.9, good: 0.6, tribe: 0.5 },
  trade: { trade: 1, other: 0.6, good: 0.3 },
  leadership: { tribe: 0.8, other: 0.5, good: 0.4 },
  conflict: { bad: 0.9, other: 0.7, danger: 0.5 },
  revolution: { bad: 0.8, tribe: 0.6, danger: 0.5 },
  suspicion: { anomaly: 1, danger: 0.4 },
  discovery: { anomaly: 0.7, good: 0.5, energy: 0.4 },
  myth: { tribe: 0.6, good: 0.5, anomaly: 0.3 },
  council_rumor: { anomaly: 0.9, danger: 0.4 },
  city_life: { tribe: 0.7, self: 0.3 },
  protest: { bad: 0.8, tribe: 0.6, other: 0.5 },
  reform: { good: 0.8, tribe: 0.6 },
  cult: { anomaly: 0.6, tribe: 0.6, good: 0.4 },
  investigation: { anomaly: 1, self: 0.4 },
  migration: { move: 1, danger: 0.4, self: 0.3 },
  grief: { death: 1, bad: 0.6, other: 0.4 },
  gratitude: { help: 1, good: 0.8, other: 0.5 },
  betrayal: { bad: 0.9, other: 0.7 },
  building: { tribe: 0.7, good: 0.5, energy: 0.3 },
  history: { tribe: 0.7, self: 0.3, good: 0.3 },
};

const SYL_C = ['n', 'v', 'r', 'm', 'k', 't', 'l', 's', 'd', 'z', 'b', 'x'];
const SYL_V = ['a', 'e', 'i', 'o', 'u'];
const MAX_TOKENS_PER_AGENT = 24; // W11 cap
const MATCH_THRESHOLD = 0.5; // dot-product above which an existing token is reused vs. invented
const DRIFT_RATE = 0.12; // fraction of cross-agent copies that mutate a syllable (→ dialects)

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Deterministic, pronounceable, collision-free token from a sequence number (base-60 syllables). */
export function makeToken(seq: number): string {
  const pairs = SYL_C.length * SYL_V.length; // 60
  let n = seq + 1;
  let s = '';
  do {
    const d = n % pairs;
    s += SYL_C[Math.floor(d / SYL_V.length)] + SYL_V[d % SYL_V.length];
    n = Math.floor(n / pairs);
  } while (n > 0);
  return s;
}

function dot(a: Meaning, b: Meaning): number {
  let s = 0;
  for (const k in b) s += (a[k as Concept] ?? 0) * (b[k as Concept] ?? 0);
  return s;
}

/** Move `v`'s meaning a little toward `target` — grounding strengthens with use. */
function blendMeaning(v: Meaning, target: Meaning, rate: number): void {
  for (const k in target) {
    const key = k as Concept;
    v[key] = (v[key] ?? 0) + ((target[key] ?? 0) - (v[key] ?? 0)) * rate;
  }
}

/** The dominant concepts of a meaning vector, as a human-readable gloss (UI interpretation). */
export function topConcepts(v: Meaning, n: number): string {
  return (Object.keys(v) as Concept[])
    .sort((a, b) => (v[b] ?? 0) - (v[a] ?? 0))
    .slice(0, n)
    .filter((k) => (v[k] ?? 0) > 0.05)
    .join('·');
}

/** Drop the weakest tokens (low confidence × uses) when over the per-agent cap. */
function capLexicon(lex: AgentLexicon): void {
  if (lex.tokens.length <= MAX_TOKENS_PER_AGENT) return;
  lex.tokens.sort((a, b) => b.confidence * b.uses - a.confidence * a.uses);
  lex.tokens.length = MAX_TOKENS_PER_AGENT;
}

function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) >>> 0;
  return h;
}

/** Mutate one syllable of a token deterministically (per listener) — the engine of dialect drift. */
function driftToken(token: string, listenerId: number): string {
  const pairs = token.length / 2;
  if (pairs < 1) return token;
  const idx = Math.floor(actionNoise(listenerId, strHash(token), 11) * pairs);
  const cv = Math.floor(actionNoise(listenerId, strHash(token), 13) * SYL_C.length);
  const vv = Math.floor(actionNoise(listenerId, strHash(token), 17) * SYL_V.length);
  const at = idx * 2;
  return token.slice(0, at) + SYL_C[cv] + SYL_V[vv] + token.slice(at + 2);
}

export interface Utterance {
  phrase: string;
  tokens: string[];
  meaning: string; // estimated gloss
  confidence: number;
  token: SymbolToken; // the underlying symbol (so listeners can imitate it)
}

/**
 * The agent speaks a category: pick (or invent) a token grounded in that category's meaning,
 * reinforce it, and return the token phrase + an estimated gloss. Deterministic. Returns null
 * if the category has no grounding (falls back to no token phrase).
 */
export function speak(a: Agent, world: WorldState, category: MessageCategory): Utterance | null {
  const target = GROUNDING[category];
  if (!target) return null;
  const lex = ensureLexicon(a);

  // best-matching existing token (deterministic; id-stable tie order via token string)
  let best: SymbolToken | null = null;
  let bestScore = 0;
  for (const tk of lex.tokens) {
    const sc = dot(tk.meaningVector, target);
    if (sc > bestScore || (sc === bestScore && best && tk.token < best.token)) {
      bestScore = sc;
      best = tk;
    }
  }

  if (!best || bestScore < MATCH_THRESHOLD) {
    // invent a new token grounded in this meaning
    const seq = world.nextSymbolSeq ?? 0;
    world.nextSymbolSeq = seq + 1;
    best = {
      token: makeToken(seq),
      meaningVector: { ...target },
      confidence: 0.2,
      uses: 1,
      inventedBy: a.id,
      inventedCycle: world.cycle,
    };
    lex.tokens.push(best);
    capLexicon(lex);
  } else {
    // reinforce: a reused token grows in confidence and grounds harder toward the meaning
    best.uses += 1;
    best.confidence = clamp01(best.confidence + 0.03);
    blendMeaning(best.meaningVector, target, 0.1);
  }

  return {
    phrase: best.token,
    tokens: [best.token],
    meaning: topConcepts(best.meaningVector, 2),
    confidence: best.confidence,
    token: best,
  };
}

/**
 * A listener hears a token and copies it into its own lexicon (imitation). A faithful copy lets a
 * group converge on shared words; an occasional drifted copy seeds dialect divergence. If the
 * listener already knows the token, the shared meaning is reinforced. Deterministic.
 */
export function hearToken(listener: Agent, spoken: SymbolToken): void {
  const lex = ensureLexicon(listener);
  const existing = lex.tokens.find((t) => t.token === spoken.token);
  if (existing) {
    existing.uses += 1;
    existing.confidence = clamp01(existing.confidence + 0.02);
    blendMeaning(existing.meaningVector, spoken.meaningVector, 0.1);
    return;
  }
  const drift = actionNoise(listener.id, strHash(spoken.token), 19) < DRIFT_RATE;
  const token = drift ? driftToken(spoken.token, listener.id) : spoken.token;
  lex.tokens.push({
    token,
    meaningVector: { ...spoken.meaningVector },
    confidence: clamp01(spoken.confidence * 0.6),
    uses: 1,
    inventedBy: spoken.inventedBy,
    inventedCycle: spoken.inventedCycle,
  });
  capLexicon(lex);
}

/** Find the token an agent would use for a category (its current "word" for that concept). */
export function wordFor(a: Agent, category: MessageCategory): string | null {
  const target = GROUNDING[category];
  if (!target || !a.lexicon) return null;
  let best: SymbolToken | null = null;
  let bestScore = 0;
  for (const tk of a.lexicon.tokens) {
    const sc = dot(tk.meaningVector, target);
    if (sc > bestScore) {
      bestScore = sc;
      best = tk;
    }
  }
  return best && bestScore >= MATCH_THRESHOLD ? best.token : null;
}
