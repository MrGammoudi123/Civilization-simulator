import { recordEvent } from './chronicle';
import type { ActionKind, Agent, CultureMemory, SymbolToken, Tribe, WorldState } from './types';

/**
 * Culture (W8). Tribes are not just an ideology label — they accumulate a CultureMemory that
 * *emerges* from what actually keeps happening to their people: repeated theft hardens into an
 * anti-theft taboo, repeated sharing-that-saves into a generosity norm, anomalies into Watcher
 * myths, migrations-that-rescue into migration myths, storage-that-prevents-famine into law.
 * Culture then *influences* behavior (it shifts action utility) without dictating it, drifts and
 * decays, and is partly inherited by successor tribes that rise on the ruins. It also carries the
 * tribe's dialect — the tokens its people most use (W6).
 *
 * Deterministic: signals are accumulated from world state, thresholds are fixed — no RNG.
 */

const FORM_THRESHOLD = 5; // accumulated signal before a custom crystallizes
const SIGNAL_DECAY = 0.97;
const CULTURE_CAP = 200; // bound on remembered cultures (archived ones dropped first)
const DIALECT_CAP = 16; // tokens kept as the tribe's shared dialect

// Which cultural theme each (normal-life) action speaks to — the channel culture biases behavior.
const ACTION_THEME: Partial<Record<ActionKind, string>> = {
  share: 'generosity',
  trade: 'generosity',
  investigate: 'anomaly',
  worship: 'anomaly',
  migrate: 'migration',
  build: 'order',
  store_energy: 'order',
  organize: 'justice',
};

export function ensureCulture(world: WorldState, tribeId: number): CultureMemory {
  if (!Array.isArray(world.cultures)) world.cultures = [];
  let c = world.cultures.find((x) => x.tribeId === tribeId);
  if (!c) {
    c = {
      tribeId,
      lexicon: [],
      norms: [],
      laws: [],
      taboos: [],
      myths: [],
      discoveries: [],
      teaching: [],
      techLevel: 0,
      archived: false,
      signals: {},
    };
    world.cultures.push(c);
    if (world.cultures.length > CULTURE_CAP) {
      const idx = world.cultures.findIndex((x) => x.archived);
      if (idx >= 0) world.cultures.splice(idx, 1);
    }
  }
  return c;
}

function formNorm(c: CultureMemory, subject: string, valence: number, level: number, world: WorldState, t: Tribe): void {
  if (level < FORM_THRESHOLD || c.norms.some((n) => n.subject === subject)) return;
  c.norms.push({ id: `${subject}@${t.id}`, subject, valence, strength: 0.6, originCycle: world.cycle });
  recordEvent(world, { category: 'culture', severity: 2, title: 'A Custom Takes Hold', description: `${t.name} came to value ${subject}.`, tribeId: t.id });
}

function formTaboo(c: CultureMemory, subject: string, level: number, world: WorldState, t: Tribe): void {
  if (level < FORM_THRESHOLD || c.taboos.some((tb) => tb.subject === subject)) return;
  c.taboos.push({ id: `taboo-${subject}@${t.id}`, subject, strength: 0.7, originCycle: world.cycle });
  recordEvent(world, { category: 'culture', severity: 2, title: 'A Taboo Forms', description: `${t.name} turned against ${subject} after repeated harm.`, tribeId: t.id });
}

function formMyth(c: CultureMemory, theme: string, level: number, world: WorldState, t: Tribe): void {
  if (level < FORM_THRESHOLD || c.myths.some((m) => m.theme === theme)) return;
  c.myths.push({ id: `myth-${theme}@${t.id}`, theme, aboutId: t.leaderId, strength: 0.6, originCycle: world.cycle });
  recordEvent(world, { category: 'culture', severity: 3, title: 'A Myth Is Born', description: `${t.name} wove a myth around ${theme}.`, tribeId: t.id });
}

function formLaw(c: CultureMemory, rule: string, level: number, world: WorldState, t: Tribe): void {
  if (level < FORM_THRESHOLD || c.laws.some((l) => l.rule === rule)) return;
  c.laws.push({ id: `law-${rule}@${t.id}`, rule, strength: 0.6, enactedCycle: world.cycle });
  recordEvent(world, { category: 'culture', severity: 3, title: 'A Law Is Enacted', description: `${t.name} codified a law of ${rule}.`, tribeId: t.id });
}

/** Collect the tribe's most-used tokens as its shared dialect (W6 × W8). */
function aggregateDialect(c: CultureMemory, members: Agent[]): void {
  const byToken = new Map<string, SymbolToken>();
  for (const a of members) {
    if (!a.lexicon) continue;
    for (const tk of a.lexicon.tokens) {
      const ex = byToken.get(tk.token);
      if (!ex || tk.uses > ex.uses) byToken.set(tk.token, tk);
    }
  }
  c.lexicon = [...byToken.values()].sort((a, b) => b.uses * b.confidence - a.uses * a.confidence).slice(0, DIALECT_CAP);
}

/**
 * Advance every tribe's culture one batch: accumulate decaying event signals, crystallize new
 * customs at threshold, aggregate the dialect, and track tech level. Called each economy interval.
 */
export function updateCultures(world: WorldState): void {
  if (!Array.isArray(world.cultures)) world.cultures = [];
  const byTribe = new Map<number, Agent[]>();
  for (const a of world.agents) {
    if (!a.alive || a.tribeId === null) continue;
    let g = byTribe.get(a.tribeId);
    if (!g) byTribe.set(a.tribeId, (g = []));
    g.push(a);
  }

  // cultures whose tribe is gone are archived (preserved, not deleted — successors may inherit)
  const aliveTribes = new Set(world.tribes.map((t) => t.id));
  for (const c of world.cultures) if (!aliveTribes.has(c.tribeId)) c.archived = true;

  for (const t of world.tribes) {
    const members = byTribe.get(t.id) ?? [];
    if (members.length === 0) continue;
    const c = ensureCulture(world, t.id);
    const sig = (c.signals ??= {});
    for (const k in sig) sig[k] *= SIGNAL_DECAY;

    let theft = 0;
    let gen = 0;
    let anom = 0;
    let mig = 0;
    let just = 0;
    for (const a of members) {
      for (const m of a.memory) {
        if (world.cycle - m.cycle > 3000) continue;
        switch (m.kind) {
          case 'stolen_from':
          case 'betrayed_by':
            theft += 1;
            break;
          case 'shared_energy':
          case 'helped_by':
          case 'healed_by':
            gen += 1;
            break;
          case 'suspected_council':
          case 'discovered_anomaly':
          case 'witnessed_miracle':
            anom += 1;
            break;
          case 'migrated':
            mig += 1;
            break;
          case 'witnessed_reform':
          case 'witnessed_revolution':
            just += 1;
            break;
          default:
            break;
        }
      }
    }
    const n = members.length;
    sig.theft = (sig.theft ?? 0) + theft / n;
    sig.generosity = (sig.generosity ?? 0) + gen / n;
    sig.anomaly = (sig.anomaly ?? 0) + anom / n;
    sig.migration = (sig.migration ?? 0) + mig / n;
    sig.justice = (sig.justice ?? 0) + just / n;
    const city = world.cities.find((ci) => ci.tribeId === t.id);
    if (city && city.buildings.some((b) => b.type === 'energy_storage')) sig.order = (sig.order ?? 0) + 0.25;

    formNorm(c, 'generosity', 1, sig.generosity ?? 0, world, t);
    formTaboo(c, 'theft', sig.theft ?? 0, world, t);
    formMyth(c, 'anomaly', sig.anomaly ?? 0, world, t);
    formMyth(c, 'migration', sig.migration ?? 0, world, t);
    formNorm(c, 'justice', 1, sig.justice ?? 0, world, t);
    formLaw(c, 'order', sig.order ?? 0, world, t);

    aggregateDialect(c, members);
    c.techLevel = (world.discoveries ?? []).filter((d) => d.tribeId === t.id).length;
  }
}

/** Seed a fragment of a fallen culture into a successor tribe (W8 — inheritance on the ruins). */
export function inheritCulture(world: WorldState, newTribeId: number): boolean {
  if (!Array.isArray(world.cultures)) return false;
  // most recently archived culture (the freshest fallen people to inherit from)
  let source: CultureMemory | null = null;
  for (const c of world.cultures) {
    if (!c.archived || c.tribeId === newTribeId) continue;
    if (!source || (c.norms[0]?.originCycle ?? 0) >= (source.norms[0]?.originCycle ?? 0)) source = c;
  }
  if (!source) return false;
  const c = ensureCulture(world, newTribeId);
  for (const n of source.norms.slice(0, 2)) if (!c.norms.some((x) => x.subject === n.subject)) c.norms.push({ ...n, id: `${n.subject}@${newTribeId}`, strength: n.strength * 0.6 });
  for (const m of source.myths.slice(0, 2)) if (!c.myths.some((x) => x.theme === m.theme)) c.myths.push({ ...m, id: `myth-${m.theme}@${newTribeId}`, strength: m.strength * 0.6 });
  return c.norms.length > 0 || c.myths.length > 0;
}

/** How strongly the tribe's culture pulls an agent toward a given action (utility delta, W8). */
export function cultureBias(culture: CultureMemory | undefined, action: ActionKind): number {
  if (!culture) return 0;
  const theme = ACTION_THEME[action];
  if (!theme) return 0;
  let b = 0;
  for (const n of culture.norms) if (n.subject === theme) b += n.valence * n.strength * 0.3;
  for (const m of culture.myths) if (m.theme === theme) b += m.strength * 0.25;
  for (const l of culture.laws) if (l.rule === theme) b += l.strength * 0.2;
  return b;
}

/** Strength of a taboo against a subject (e.g. 'theft') — used to suppress the tabooed behavior. */
export function tabooStrength(culture: CultureMemory | undefined, subject: string): number {
  if (!culture) return 0;
  let s = 0;
  for (const tb of culture.taboos) if (tb.subject === subject) s += tb.strength;
  return s;
}

/** Total cultural elements in the world (for the World Health panel / tests). */
export function cultureElementCount(world: WorldState): number {
  let n = 0;
  for (const c of world.cultures ?? []) n += c.norms.length + c.laws.length + c.taboos.length + c.myths.length;
  return n;
}
