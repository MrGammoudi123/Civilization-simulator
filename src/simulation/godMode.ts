import { RNG } from './rng';
import { createAgent } from './agent';
import { createEnergySource } from './energy';
import { pushPulse } from './conflict';
import { recordEvent } from './chronicle';
import type { GodActionType, MessageTone, WorldState } from './types';

/**
 * God Mode: direct user interventions. Each action mutates the world, is logged to the
 * chronicle, and — when visible — provokes reactions from nearby beings ("The sky gave us
 * energy", "The creators are real"). Uses the simulation RNG, so an intervention shifts the
 * deterministic stream from that point on (intended: the creator is changing the world).
 */

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

/** Make a few beings react out loud to a visible divine act. */
function react(world: WorldState, text: string, tone: MessageTone, count: number): void {
  const agents = world.agents;
  let spoken = 0;
  for (let i = 0; i < agents.length && spoken < count; i++) {
    const a = agents[i];
    a.bubble = { text, tone, until: world.cycle + 90 };
    world.conversationLog.push({
      id: world.nextMessageId++,
      cycle: world.cycle,
      speakerId: a.id,
      speakerName: a.name,
      recipientId: null,
      recipientName: null,
      text,
      tone,
      category: 'council_rumor',
      x: a.x,
      y: a.y,
      tribeId: a.tribeId,
    });
    spoken += 1;
  }
  if (world.conversationLog.length > 500) {
    world.conversationLog.splice(0, world.conversationLog.length - 500);
  }
}

function chronicle(world: WorldState, title: string, description: string): void {
  recordEvent(world, { category: 'discovery', severity: 3, title, description });
}

export function applyGodAction(world: WorldState, action: GodActionType, rng: RNG): void {
  const agents = world.agents;
  switch (action) {
    case 'add_energy': {
      world.energySources.push(createEnergySource(world.nextEnergyId++, rng, world.params, 'rare'));
      chronicle(world, 'Divine Gift', 'The creators seeded a rich source of energy.');
      react(world, 'The sky gave us energy.', 'hopeful', 4);
      break;
    }
    case 'remove_energy':
    case 'trigger_scarcity': {
      const f = action === 'trigger_scarcity' ? 0.35 : 0.6;
      for (const s of world.energySources) s.amount *= f;
      chronicle(world, 'The Light Dims', 'A great scarcity fell upon the world.');
      react(world, 'The light is fading.', 'afraid', 4);
      break;
    }
    case 'spawn_agent': {
      agents.push(createAgent(world.nextAgentId++, rng, world.params));
      world.totalBirths += 1;
      chronicle(world, 'A Being Appears', 'A new being was willed into existence.');
      react(world, 'A stranger appeared from nothing.', 'curious', 3);
      break;
    }
    case 'smite': {
      if (agents.length > 0) {
        const a = agents[rng.int(0, agents.length)];
        a.energy = 0;
        a.alive = false;
        a.state = 'dying';
        chronicle(world, 'A Being Vanishes', `${a.name} was struck from the world.`);
        react(world, 'A being disappeared before our eyes.', 'afraid', 4);
      }
      break;
    }
    case 'spawn_prophet': {
      if (agents.length > 0) {
        const a = agents[rng.int(0, agents.length)];
        a.traits.curiosity = clamp01(a.traits.curiosity + 0.3);
        a.traits.intelligence = clamp01(a.traits.intelligence + 0.3);
        a.traits.ambition = clamp01(a.traits.ambition + 0.2);
        a.energy = a.maxEnergy;
        world.hiddenCouncil.watchedAgentIds.push(a.id);
        chronicle(world, 'A Prophet Rises', `${a.name} was touched by the creators.`);
        react(world, 'One among us has been chosen.', 'hopeful', 3);
      }
      break;
    }
    case 'trigger_war': {
      if (world.tribes.length >= 2) {
        const a = world.tribes[0];
        const b = world.tribes[1];
        a.relations.set(b.id, { standing: -1, war: true });
        b.relations.set(a.id, { standing: -1, war: true });
        chronicle(world, 'War Declared', `${a.name} and ${b.name} were set against each other.`);
        react(world, 'War is upon us!', 'angry', 4);
      }
      break;
    }
    case 'trigger_peace': {
      for (const t of world.tribes) {
        for (const rel of t.relations.values()) {
          rel.war = false;
          if (rel.standing < 0) rel.standing = 0.2;
        }
      }
      chronicle(world, 'A Great Peace', 'All wars were quelled by an unseen hand.');
      react(world, 'The fighting has stopped.', 'happy', 4);
      break;
    }
    case 'reveal_council': {
      world.hiddenCouncil.enabled = true;
      world.hiddenCouncil.revealed = true;
      world.hiddenCouncil.discoveryRisk = clamp01(world.hiddenCouncil.discoveryRisk + 0.4);
      chronicle(world, 'The Veil Lifts', 'The hidden council revealed itself to the world.');
      react(world, 'The creators are real!', 'curious', 5);
      break;
    }
    case 'glitch': {
      pushPulse(world, rng.range(0, world.params.width), rng.range(0, world.params.height), 'council', 80);
      world.hiddenCouncil.discoveryRisk = clamp01(world.hiddenCouncil.discoveryRisk + 0.12);
      chronicle(world, 'Reality Glitch', 'The fabric of the world flickered.');
      react(world, 'The world changed suddenly.', 'afraid', 4);
      break;
    }
    case 'miracle': {
      const src = createEnergySource(world.nextEnergyId++, rng, world.params, 'rare');
      // place near the densest cluster (first agent) for a visible "miracle"
      if (agents.length > 0) {
        src.x = agents[0].x;
        src.y = agents[0].y;
        src.amount = src.capacity;
      }
      world.energySources.push(src);
      pushPulse(world, src.x, src.y, 'council', 90);
      chronicle(world, 'A Miracle', 'Light burst forth where the beings gathered.');
      react(world, 'A miracle! Light from nothing!', 'hopeful', 5);
      break;
    }
    default:
      break;
  }
}
