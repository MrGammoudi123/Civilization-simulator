import { RNG } from './rng';
import { CONFLICT } from './config';
import { adjust, ensureRel } from './relationships';
import { remember } from './memory';
import type { Agent, ConflictPulseKind, WorldState } from './types';

/**
 * Combat resolution. Conflict is emergent: an aggressive agent that is stronger than a
 * rival (or an enemy-tribe member during war) attacks instead of fleeing; the decision
 * lives in decisions.ts, the consequences here. Fights deal damage, provoke retaliation,
 * poison relationships, and can kill — adding conflict to the list of death causes.
 */

/** Drop a transient on-map effect (combat flash / uprising / crackdown). */
export function pushPulse(
  world: WorldState,
  x: number,
  y: number,
  kind: ConflictPulseKind,
  ticks: number,
): void {
  world.conflictPulses.push({ x, y, born: world.cycle, until: world.cycle + ticks, kind });
  if (world.conflictPulses.length > CONFLICT.pulseCap) world.conflictPulses.shift();
}

/** Resolve one strike from `attacker` against `defender`. */
export function resolveFight(attacker: Agent, defender: Agent, world: WorldState, rng: RNG): void {
  const damage = CONFLICT.baseDamage + attacker.traits.aggression * CONFLICT.aggressionDamage;
  defender.energy -= damage;
  // the defender bites back (cheaper) — fighting is costly for both
  attacker.energy -= CONFLICT.retaliation * defender.traits.aggression + 0.5;
  attacker.state = 'attacking';
  world.totalConflicts += 1;

  const dr = ensureRel(defender, attacker.id, world.cycle);
  adjust(dr, 'fear', 0.2);
  adjust(dr, 'resentment', 0.25);
  adjust(dr, 'rivalry', 0.2);
  adjust(dr, 'trust', -0.2);
  dr.interactions += 1;
  dr.lastCycle = world.cycle;
  remember(defender, 'attacked_by', world.cycle, { otherId: attacker.id, strength: 0.85 });

  const ar = ensureRel(attacker, defender.id, world.cycle);
  adjust(ar, 'rivalry', 0.15);
  ar.interactions += 1;
  ar.lastCycle = world.cycle;

  // A clash between members of different tribes is a skirmish — flag a few visually.
  const skirmish =
    attacker.tribeId !== null && defender.tribeId !== null && attacker.tribeId !== defender.tribeId;
  if (skirmish && rng.chance(0.15)) {
    pushPulse(world, (attacker.x + defender.x) / 2, (attacker.y + defender.y) / 2, 'fight', CONFLICT.pulseTicks);
  }

  if (defender.energy <= 0) {
    defender.energy = 0;
    defender.alive = false;
    defender.state = 'dying';
  }
}
