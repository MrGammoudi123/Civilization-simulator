import { RNG } from './rng';
import type {
  Agent,
  City,
  ConversationMessage,
  MessageCategory,
  MessageTone,
  Tribe,
  WorldState,
} from './types';

/**
 * Rule-based language system (NO LLM). Agents compose short, context-driven messages from
 * their state, role, recent memory, relationships, and their tribe/city situation. Messages
 * surface as speech bubbles and in the (filterable) Conversations panel. Deterministic: every
 * random choice goes through the passed RNG.
 *
 * Phase 12 makes messages contextual: they weave in agent/tribe/city/leader names, energy-
 * source directions, recent events (protest, famine, reform, revolution), Hidden Council
 * clues, and cover many more categories than the original survival/conflict bias.
 */

/** Neighbor context computed once during the decision pass and handed to the speaker. */
export interface SpeechCtx {
  nearbyCount: number;
  rivalId: number;
  rivalName: string | null;
  allyId: number;
  allyName: string | null;
  leaderId: number;
  leaderName: string | null;
}

const LOG_CAP = 500;
const BUBBLE_TICKS = 90;

const TONE: Record<MessageCategory, MessageTone> = {
  survival: 'neutral',
  fear: 'afraid',
  friendship: 'happy',
  bonding: 'happy',
  trade: 'neutral',
  leadership: 'hopeful',
  conflict: 'angry',
  revolution: 'angry',
  suspicion: 'afraid',
  discovery: 'curious',
  myth: 'hopeful',
  council_rumor: 'curious',
  city_life: 'neutral',
  protest: 'angry',
  reform: 'hopeful',
  cult: 'curious',
  investigation: 'curious',
  migration: 'afraid',
  grief: 'sad',
  gratitude: 'happy',
  betrayal: 'angry',
  building: 'hopeful',
  history: 'hopeful',
};

// Templates without a named recipient. {place}/{dir} from location; {tribe}/{city}/{leader}
// from the speaker's situation (filled when known, otherwise a neutral fallback).
const PLAIN: Record<MessageCategory, string[]> = {
  survival: [
    'The {dir} fields are fading, but {city} still holds its stores.',
    'There is light to the {dir}, near {place}.',
    'I must feed soon — the {place} runs thin.',
    'The energy here is fading.',
  ],
  fear: ['Danger is near {place}.', 'I do not feel safe in the {dir}.', 'Stay alert, the {dir} is restless.', 'I am afraid the light is fading.'],
  friendship: ['We should stay together in {tribe}.', 'There is strength in numbers.', 'Do not wander alone.'],
  bonding: ['I feel less alone in {tribe} now.', 'Stay close.', 'We are bound together.'],
  trade: ['Energy for energy?', 'Let us trade, the markets of {city} are fair.', 'I will share if you share.'],
  leadership: ['{leader} must guide {city} through this.', 'Someone must lead {tribe}.', 'We need a steady hand.'],
  conflict: ['This is mine.', 'Keep away from me.', 'I will not forget this.'],
  revolution: ['Some hoard while {city} starves.', 'Why is there never enough under {leader}?', 'This cannot go on.', 'We deserve better than this.'],
  suspicion: ['Every time the lights return, the archive changes. Something watches {city}.', 'The sky is not empty.', 'Things change without reason.', 'I feel watched.'],
  discovery: ['I have found something hidden to the {dir}.', 'There is more here than we see, near {place}.', 'A strange light, to the {dir}.'],
  myth: ['The first ones gave {tribe} its light.', 'We come from the light.', 'There is a purpose to all this.'],
  council_rumor: ['The world has rules we did not write.', 'Something changes the energy of {city}.', 'Maybe the makers are still watching.'],
  city_life: ['Life in {city} grows harder as discontent rises.', '{city} endures, for now.', 'The streets of {city} are uneasy.'],
  protest: ['{city} is stirring — {leader} must answer for the hunger!', 'No more! Not while we starve!', 'We stand against {leader}!'],
  reform: ['{leader} has eased the burden on {city}.', 'Perhaps {city} can change without blood.', 'The new measures give {city} hope.'],
  cult: ['Gather, and the watchers will reveal themselves.', 'There is meaning behind the glitches of {city}.', 'Follow the signs to the {dir}.'],
  investigation: ['Did you see that? It was not natural.', 'The patterns near {place} are too perfect.', 'I will find what changes {city}.'],
  migration: ['There is nothing left here. We must go to the {dir}.', '{tribe} cannot stay — the land is dead.', 'I am leaving for the {dir}.'],
  grief: ['So many gone near {place}.', 'I mourn what {tribe} has lost.', 'The dead deserved better.'],
  gratitude: ['I will not forget the kindness of {tribe}.', 'Thank you — I would have starved.', 'We carry each other in {city}.'],
  betrayal: ['I trusted them. Never again.', 'Betrayed, here in {city}.', 'They turned on their own.'],
  building: ['We raise {city} stone by stone.', 'The walls of {city} grow.', 'Build, so {tribe} endures.'],
  history: ['Remember when {tribe} first rose.', 'The archive of {city} keeps our story.', 'Let it be recorded for those who follow.'],
};

// Templates addressed to a specific agent ({name}).
const NAMED: Partial<Record<MessageCategory, string[]>> = {
  friendship: ['I remember when you helped me, {name}.', 'You are a friend, {name}.', 'I trust you, {name}.'],
  bonding: ['I feel close to you, {name}.', 'Stay with me, {name}.', 'Do not leave, {name}.'],
  conflict: ['You took what was mine, {name}!', 'I will not forget what you did, {name}.', 'Stay away from me, {name}.'],
  leadership: ['Follow {name}, they lead {city} wisely.', '{name} should lead us.', 'I will follow {name}.'],
  protest: ['I stand with you, {name}, against {leader}!', 'Rise with me, {name}!'],
  trade: ['Trade with me, {name}?', 'A fair exchange, {name}.'],
  gratitude: ['Thank you, {name} — I owe you my life.', 'I will repay you, {name}.'],
  grief: ['I will remember {name}.', 'We lost {name} near here.'],
  betrayal: ['You betrayed me, {name}.', 'I trusted you once, {name}.'],
  investigation: ['Did you see what {name} saw? It is not natural.'],
};

interface Vars {
  name?: string | null;
  place?: string;
  dir?: string;
  tribe?: string;
  city?: string;
  leader?: string;
}

function fill(template: string, vars: Vars): string {
  return template
    .replace('{name}', vars.name ?? 'you')
    .replace('{place}', vars.place ?? 'here')
    .replace('{dir}', vars.dir ?? 'distance')
    .replace('{tribe}', vars.tribe ?? 'our people')
    .replace('{city}', vars.city ?? 'this place')
    .replace('{leader}', vars.leader ?? 'the leader');
}

function placeName(x: number, y: number, w: WorldState): string {
  const cx = w.params.width / 2;
  const cy = w.params.height / 2;
  const dx = x - cx;
  const dy = y - cy;
  if (Math.hypot(dx, dy) < Math.min(w.params.width, w.params.height) * 0.18) return 'the center';
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'the eastern field' : 'the western field';
  return dy > 0 ? 'the southern reach' : 'the northern reach';
}

function dirName(x: number, y: number, w: WorldState): string {
  const dx = x - w.params.width / 2;
  const dy = y - w.params.height / 2;
  if (Math.abs(dx) > Math.abs(dy)) return dx > 0 ? 'east' : 'west';
  return dy > 0 ? 'south' : 'north';
}

interface Composed {
  text: string;
  tone: MessageTone;
  category: MessageCategory;
  recipientId: number | null;
  recipientName: string | null;
}

function mk(
  category: MessageCategory,
  rng: RNG,
  vars: Vars,
  recipientId: number | null = null,
  recipientName: string | null = null,
): Composed {
  const named = vars.name != null && NAMED[category];
  const pool = named ? (NAMED[category] as string[]) : PLAIN[category];
  return {
    text: fill(rng.pick(pool), vars),
    tone: TONE[category],
    category,
    recipientId,
    recipientName,
  };
}

/** Map a (Phase 11) memory kind to an emotional message category, if it should be voiced. */
function memoryCategory(kind: string): MessageCategory | null {
  switch (kind) {
    case 'stolen_from':
    case 'attacked_by':
      return 'conflict';
    case 'betrayed_by':
      return 'betrayal';
    case 'helped_by':
    case 'healed_by':
    case 'protected_by':
    case 'shared_energy':
      return 'gratitude';
    case 'traded_with':
      return 'trade';
    case 'built_with':
      return 'building';
    case 'witnessed_death':
    case 'mourned_dead':
      return 'grief';
    case 'witnessed_revolution':
      return 'revolution';
    case 'witnessed_reform':
      return 'reform';
    case 'witnessed_miracle':
    case 'discovered_anomaly':
      return 'discovery';
    case 'suspected_council':
      return 'suspicion';
    case 'migrated':
      return 'migration';
    case 'celebrated_survival':
      return 'gratitude';
    default:
      return null;
  }
}

/** Choose what (if anything) to say. Priority: events → state → role/situation → musings. */
function compose(a: Agent, world: WorldState, ctx: SpeechCtx, rng: RNG): Composed | null {
  const frac = a.energy / a.maxEnergy;
  const tribe: Tribe | undefined = a.tribeId !== null ? world.tribes.find((t) => t.id === a.tribeId) : undefined;
  const city: City | undefined = a.cityId !== null ? world.cities.find((c) => c.id === a.cityId) : undefined;
  const leaderName =
    city && city.leaderId !== null
      ? world.agents.find((x) => x.id === city.leaderId)?.name ?? null
      : tribe && tribe.leaderId !== null
        ? world.agents.find((x) => x.id === tribe.leaderId)?.name ?? null
        : ctx.leaderName;
  const base: Vars = {
    place: placeName(a.x, a.y, world),
    dir: dirName(a.x, a.y, world),
    tribe: tribe ? tribe.name : undefined,
    city: city ? city.name : undefined,
    leader: leaderName ?? undefined,
  };

  const last = a.memory.length ? a.memory[a.memory.length - 1] : null;
  const recent = last && world.cycle - last.cycle <= 45 ? last : null;

  // Event-driven (something just happened) — now spans the full Phase 11 memory vocabulary.
  if (recent) {
    const cat = memoryCategory(recent.kind);
    if (recent.kind === 'found_energy' && recent.x != null && recent.y != null) {
      return mk('survival', rng, { ...base, place: placeName(recent.x, recent.y, world), dir: dirName(recent.x, recent.y, world) });
    }
    if (cat) {
      const otherName = recent.otherId != null ? world.agents.find((x) => x.id === recent.otherId)?.name ?? null : null;
      const named = otherName ?? (cat === 'conflict' ? ctx.rivalName : cat === 'gratitude' ? ctx.allyName : null);
      return mk(cat, rng, { ...base, name: named }, named ? recent.otherId : null, named);
    }
  }

  // Active-state driven.
  if (a.state === 'protesting' || a.state === 'organizing_protest') {
    return mk('protest', rng, { ...base, name: ctx.allyName }, ctx.allyId >= 0 ? ctx.allyId : null, ctx.allyName);
  }
  if (a.state === 'migrating') return mk('migration', rng, base);
  if (a.state === 'building' || a.state === 'repairing') return mk('building', rng, base);
  if (a.state === 'archiving_history') return mk('history', rng, base);
  if (a.state === 'worshipping') return mk('cult', rng, base);
  if (a.state === 'investigating_reality') return mk('investigation', rng, base);
  if (a.state === 'trading' && ctx.allyId >= 0) return mk('trade', rng, { ...base, name: ctx.allyName }, ctx.allyId, ctx.allyName);

  // Distress.
  if (frac < 0.3) {
    if (a.traits.ambition > 0.6 || a.traits.aggression > 0.55) return mk('revolution', rng, base);
    if (a.traits.fear > 0.55) return mk('fear', rng, base);
    return mk('survival', rng, base);
  }

  // City situation: high unrest breeds protest/reform/city-life talk.
  if (city) {
    if (city.unrest > 0.55 && rng.chance(0.5)) return mk('protest', rng, base);
    if (city.politics && city.politics.phase === 'reform' && rng.chance(0.5)) return mk('reform', rng, base);
    if (city.unrest > 0.35 && rng.chance(0.3)) return mk('city_life', rng, base);
  }

  // Social.
  if (ctx.rivalId >= 0 && rng.chance(0.35)) {
    return mk('conflict', rng, { ...base, name: ctx.rivalName }, ctx.rivalId, ctx.rivalName);
  }
  if (ctx.allyId >= 0) {
    const cat: MessageCategory = a.traits.socialNeed > 0.6 && rng.chance(0.45) ? 'bonding' : 'friendship';
    return mk(cat, rng, { ...base, name: ctx.allyName }, ctx.allyId, ctx.allyName);
  }
  if (ctx.leaderId >= 0) {
    return mk('leadership', rng, { ...base, name: ctx.leaderName }, ctx.leaderId, ctx.leaderName);
  }

  // Hidden Council discovery: the curious + intelligent grow suspicious as risk rises.
  const council = world.hiddenCouncil;
  if (
    council.enabled &&
    (council.revealed || council.discoveryRisk > 0.55) &&
    a.traits.curiosity * a.traits.intelligence > 0.28 &&
    rng.chance(0.4)
  ) {
    return mk(a.role === 'investigator' || a.role === 'prophet' ? 'investigation' : 'council_rumor', rng, base);
  }

  // Idle musings (trait/role-flavored).
  if (a.role === 'historian' && rng.chance(0.4)) return mk('history', rng, base);
  if ((a.role === 'priest' || a.role === 'prophet') && rng.chance(0.4)) return mk('cult', rng, base);
  if (a.traits.curiosity > 0.6 && a.traits.intelligence > 0.55 && rng.chance(0.5)) return mk('suspicion', rng, base);
  if (a.traits.empathy > 0.6 && rng.chance(0.3)) return mk('myth', rng, base);
  if (rng.chance(0.5)) return mk('survival', rng, base);
  return null;
}

function pushMessage(world: WorldState, m: ConversationMessage): void {
  world.conversationLog.push(m);
  if (world.conversationLog.length > LOG_CAP) world.conversationLog.shift();
}

/**
 * Called once per agent decision: decrement the speak cooldown and, if it fires, compose
 * and emit a message (sets the agent's bubble + appends to the conversation log).
 */
export function emitSpeech(a: Agent, world: WorldState, ctx: SpeechCtx, rng: RNG): void {
  if (a.bubble && a.bubble.until <= world.cycle) a.bubble = null;
  if (a.speakCooldown > 0) {
    a.speakCooldown -= 1;
    return;
  }

  const hasEvent = a.memory.length > 0 && world.cycle - a.memory[a.memory.length - 1].cycle <= 45;
  let chance = 0.05 + a.traits.socialNeed * 0.08;
  if (hasEvent) chance += 0.4;
  if (ctx.nearbyCount === 0 && !hasEvent) chance *= 0.2; // less likely to talk to no one
  if (!rng.chance(chance)) return;

  const composed = compose(a, world, ctx, rng);
  if (!composed) return;

  a.speakCooldown = 3 + rng.int(0, 6); // in decision intervals
  a.bubble = { text: composed.text, tone: composed.tone, until: world.cycle + BUBBLE_TICKS };

  pushMessage(world, {
    id: world.nextMessageId++,
    cycle: world.cycle,
    speakerId: a.id,
    speakerName: a.name,
    recipientId: composed.recipientId,
    recipientName: composed.recipientName,
    text: composed.text,
    tone: composed.tone,
    category: composed.category,
    x: a.x,
    y: a.y,
    tribeId: a.tribeId,
  });
}
