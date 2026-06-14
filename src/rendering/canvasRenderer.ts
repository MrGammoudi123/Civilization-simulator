import type { AgentState, EnergyKind, MessageTone, WorldState } from '../simulation/types';
import { Camera } from './camera';

const TAU = Math.PI * 2;

const TONE_COLORS: Record<MessageTone, string> = {
  neutral: 'rgba(210, 224, 245, 0.92)',
  happy: 'rgba(140, 240, 175, 0.95)',
  afraid: 'rgba(255, 215, 120, 0.95)',
  angry: 'rgba(255, 130, 110, 0.96)',
  sad: 'rgba(150, 180, 230, 0.92)',
  hopeful: 'rgba(180, 200, 255, 0.95)',
  curious: 'rgba(190, 170, 255, 0.95)',
};

// Cap bubbles drawn per frame to avoid clutter/overdraw at large populations.
const MAX_BUBBLES = 48;

const AGENT_STATE_DEFAULT: [number, number, number] = [150, 200, 255];
// Only states with a distinct tint are listed; others fall back to the default blue.
const AGENT_STATE_COLORS: Partial<Record<AgentState, [number, number, number]>> = {
  dying: [255, 80, 80],
  fleeing: [255, 210, 90],
  helping: [120, 240, 160],
  attacking: [255, 120, 60],
  following_leader: [180, 150, 255],
};

const ENERGY_COLORS: Record<EnergyKind, [number, number, number]> = {
  common: [80, 220, 160],
  rare: [245, 205, 90],
  unstable: [255, 130, 70],
  hidden: [150, 255, 210],
  renewable: [120, 240, 130], // verdant green — the stable backbone
  deep: [110, 150, 250], // deep blue — far, vast, slow
  sacred: [220, 180, 255], // pale violet — revered
};

function rgba(c: [number, number, number], a: number): string {
  return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`;
}

/**
 * Canvas 2D renderer. Deliberately framework-free — it just draws a WorldState through
 * a Camera each frame. Chosen over PixiJS for the MVP (no heavy dependency; Canvas 2D
 * comfortably draws thousands of points). The class is the swap point if a WebGL/PixiJS
 * backend is needed for the 1,000-agent target later.
 */
export class CanvasRenderer {
  private ctx: CanvasRenderingContext2D;
  private dpr = 1;
  private tribeColorById = new Map<number, [number, number, number]>();
  private selectedId: number | null = null;

  setSelected(id: number | null): void {
    this.selectedId = id;
  }

  constructor(
    private canvas: HTMLCanvasElement,
    public camera: Camera,
  ) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('2D canvas context unavailable');
    this.ctx = ctx;
  }

  /** Resize backing store for device pixel ratio and update the camera viewport. */
  resize(cssW: number, cssH: number, dpr: number): void {
    this.dpr = dpr;
    this.canvas.width = Math.max(1, Math.floor(cssW * dpr));
    this.canvas.height = Math.max(1, Math.floor(cssH * dpr));
    this.canvas.style.width = `${cssW}px`;
    this.canvas.style.height = `${cssH}px`;
    this.camera.setViewport(cssW, cssH);
  }

  render(world: WorldState, _alpha: number): void {
    const { ctx, dpr, camera } = this;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0); // draw in CSS pixels regardless of DPR

    const w = camera.viewportW;
    const h = camera.viewportH;

    const grad = ctx.createLinearGradient(0, 0, 0, h);
    grad.addColorStop(0, '#070a13');
    grad.addColorStop(1, '#04050b');
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, w, h);

    this.tribeColorById.clear();
    for (let i = 0; i < world.tribes.length; i++) {
      this.tribeColorById.set(world.tribes[i].id, world.tribes[i].color);
    }

    this.drawWorldBounds(world);
    this.drawGrid(world);
    this.drawSubstrate(world);
    this.drawTerritories(world);
    this.drawCities(world);
    this.drawEnergy(world);
    this.drawAgents(world);
    this.drawConflictPulses(world);
    this.drawBubbles(world);
    this.drawHud(world);
  }

  private drawConflictPulses(world: WorldState): void {
    const { ctx, camera } = this;
    const pulses = world.conflictPulses;
    for (let i = 0; i < pulses.length; i++) {
      const p = pulses[i];
      if (p.until <= world.cycle) continue;
      const [sx, sy] = camera.worldToScreen(p.x, p.y);
      if (!this.onScreen(sx, sy, 120)) continue;
      const life = p.until - p.born;
      const t = life > 0 ? (world.cycle - p.born) / life : 1;
      const r = Math.max(2, (12 + t * 48) * camera.zoom);
      const alpha = Math.max(0, (1 - t) * 0.6);
      const c =
        p.kind === 'revolution'
          ? [255, 60, 60]
          : p.kind === 'repression'
            ? [255, 150, 50]
            : p.kind === 'council'
              ? [150, 110, 255]
              : [255, 90, 90];
      ctx.strokeStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.stroke();
    }
  }

  private drawCities(world: WorldState): void {
    const { ctx, camera } = this;
    const cities = world.cities;
    for (let i = 0; i < cities.length; i++) {
      const c = cities[i];
      const col = this.tribeColorById.get(c.tribeId) ?? [205, 205, 215];
      const [sx, sy] = camera.worldToScreen(c.x, c.y);
      if (!this.onScreen(sx, sy, 60)) continue;

      // buildings as small squares around the center
      const bs = Math.max(2, 3 * camera.zoom);
      for (let b = 0; b < c.buildings.length; b++) {
        const bld = c.buildings[b];
        const [bx, by] = camera.worldToScreen(c.x + bld.dx, c.y + bld.dy);
        if (bld.damaged) {
          ctx.fillStyle = 'rgba(60, 20, 22, 0.75)';
          ctx.strokeStyle = 'rgba(248, 81, 73, 0.85)';
        } else {
          ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, 0.7)`;
          ctx.strokeStyle = 'rgba(8, 12, 20, 0.6)';
        }
        ctx.fillRect(bx - bs, by - bs, bs * 2, bs * 2);
        ctx.lineWidth = 1;
        ctx.strokeRect(bx - bs, by - bs, bs * 2, bs * 2);
      }

      // central council node — a diamond
      const r = Math.max(4, 7 * camera.zoom);
      ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, 0.95)`;
      ctx.beginPath();
      ctx.moveTo(sx, sy - r);
      ctx.lineTo(sx + r, sy);
      ctx.lineTo(sx, sy + r);
      ctx.lineTo(sx - r, sy);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = c.unrest > 0.55 ? 'rgba(248, 81, 73, 0.9)' : 'rgba(255,255,255,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();

      if (camera.zoom > 0.4) {
        ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = `rgba(${col[0]}, ${col[1]}, ${col[2]}, 0.95)`;
        const label = `▲ ${c.name}`;
        ctx.fillText(label, sx - ctx.measureText(label).width / 2, sy + r + 14);
      }
    }
  }

  private drawTerritories(world: WorldState): void {
    const { ctx, camera } = this;
    const tribes = world.tribes;
    for (let i = 0; i < tribes.length; i++) {
      const t = tribes[i];
      const [sx, sy] = camera.worldToScreen(t.cx, t.cy);
      const r = t.radius * camera.zoom;
      if (!this.onScreen(sx, sy, r + 40)) continue;
      const c = t.color;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.05)`;
      ctx.fill();
      ctx.strokeStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.28)`;
      ctx.lineWidth = 1;
      ctx.stroke();
      // tribe label
      if (camera.zoom > 0.45) {
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.7)`;
        ctx.fillText(t.name, sx - ctx.measureText(t.name).width / 2, sy - r - 4);
      }
    }
  }

  private onScreen(sx: number, sy: number, margin: number): boolean {
    return (
      sx >= -margin &&
      sy >= -margin &&
      sx <= this.camera.viewportW + margin &&
      sy <= this.camera.viewportH + margin
    );
  }

  private drawEnergy(world: WorldState): void {
    const { ctx, camera } = this;
    const sources = world.energySources;
    for (let i = 0; i < sources.length; i++) {
      const s = sources[i];
      const [sx, sy] = camera.worldToScreen(s.x, s.y);
      if (!this.onScreen(sx, sy, 60)) continue;
      const color = ENERGY_COLORS[s.kind];

      if (s.kind === 'hidden' && !s.discovered) {
        // barely perceptible shimmer until an agent discovers it
        ctx.fillStyle = rgba(color, 0.06);
        ctx.beginPath();
        ctx.arc(sx, sy, 2.5, 0, TAU);
        ctx.fill();
        continue;
      }

      const frac = s.capacity > 0 ? s.amount / s.capacity : 0;
      const r = Math.max(2, s.radius * camera.zoom);
      const pulse = s.kind === 'rare' || s.radius > 20 ? 0.85 + 0.15 * Math.sin(world.cycle * 0.05 + s.id) : 1;

      const glowR = r * 2.4 * pulse;
      const grad = ctx.createRadialGradient(sx, sy, 0, sx, sy, glowR);
      grad.addColorStop(0, rgba(color, 0.15 + 0.5 * frac));
      grad.addColorStop(1, rgba(color, 0));
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sx, sy, glowR, 0, TAU);
      ctx.fill();

      ctx.fillStyle = rgba(color, 0.85);
      ctx.beginPath();
      ctx.arc(sx, sy, Math.max(1.2, r * (0.4 + 0.5 * frac)), 0, TAU);
      ctx.fill();
    }
  }

  private drawAgents(world: WorldState): void {
    const { ctx, camera } = this;
    const agents = world.agents;
    const r = Math.max(1.4, 2.6 * camera.zoom);
    for (let i = 0; i < agents.length; i++) {
      const a = agents[i];
      const [sx, sy] = camera.worldToScreen(a.x, a.y);
      if (!this.onScreen(sx, sy, 16)) continue;

      const ef = a.maxEnergy > 0 ? a.energy / a.maxEnergy : 0;
      // Base color = tribe color; dramatic states override. Tribeless agents show their
      // behavioral-state tint so feral vs. tribal agents read differently.
      const tribeColor = a.tribeId !== null ? this.tribeColorById.get(a.tribeId) : undefined;
      let col: [number, number, number];
      if (a.state === 'dying') col = [255, 80, 80];
      else if (a.state === 'attacking') col = [255, 120, 60];
      else if (a.state === 'protesting') col = [235, 70, 95];
      else if (tribeColor) col = tribeColor;
      else col = AGENT_STATE_COLORS[a.state] ?? AGENT_STATE_DEFAULT;
      ctx.fillStyle = rgba(col, 0.35 + 0.6 * ef);
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, TAU);
      ctx.fill();

      if (ef > 0.6) {
        ctx.fillStyle = rgba([220, 235, 255], 0.5);
        ctx.beginPath();
        ctx.arc(sx, sy, r * 0.5, 0, TAU);
        ctx.fill();
      }

      if (a.id === this.selectedId) {
        ctx.strokeStyle = 'rgba(255, 255, 255, 0.9)';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        ctx.arc(sx, sy, Math.max(6, r + 4), 0, TAU);
        ctx.stroke();
      }
    }
  }

  private drawBubbles(world: WorldState): void {
    const { ctx, camera } = this;
    if (camera.zoom < 0.55) return; // too zoomed out to read
    ctx.font = '11px ui-sans-serif, system-ui, sans-serif';
    ctx.textBaseline = 'alphabetic';
    let budget = MAX_BUBBLES;
    const agents = world.agents;
    for (let i = 0; i < agents.length && budget > 0; i++) {
      const a = agents[i];
      const b = a.bubble;
      if (!b || b.until <= world.cycle) continue;
      const [sx, sy] = camera.worldToScreen(a.x, a.y);
      if (!this.onScreen(sx, sy, 80)) continue;

      const text = b.text.length > 30 ? `${b.text.slice(0, 29)}…` : b.text;
      const w = ctx.measureText(text).width;
      const padX = 6;
      const bx = sx - w / 2 - padX;
      const by = sy - 22;
      const bw = w + padX * 2;
      const bh = 16;

      ctx.fillStyle = 'rgba(8, 12, 20, 0.78)';
      this.roundRect(bx, by, bw, bh, 4);
      ctx.fill();

      ctx.fillStyle = TONE_COLORS[b.tone];
      ctx.fillText(text, sx - w / 2, by + 12);
      budget -= 1;
    }
  }

  private roundRect(x: number, y: number, w: number, h: number, r: number): void {
    const { ctx } = this;
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  private drawWorldBounds(world: WorldState): void {
    const { ctx, camera } = this;
    const [x0, y0] = camera.worldToScreen(0, 0);
    const [x1, y1] = camera.worldToScreen(world.params.width, world.params.height);
    ctx.fillStyle = 'rgba(18, 28, 48, 0.35)';
    ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
    ctx.strokeStyle = 'rgba(74, 168, 255, 0.28)';
    ctx.lineWidth = 1;
    ctx.strokeRect(x0, y0, x1 - x0, y1 - y0);
  }

  private drawGrid(world: WorldState): void {
    const { ctx, camera } = this;
    const step = 100;
    ctx.strokeStyle = 'rgba(70, 100, 150, 0.09)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = 0; gx <= world.params.width; gx += step) {
      const [sx, syTop] = camera.worldToScreen(gx, 0);
      const [, syBot] = camera.worldToScreen(gx, world.params.height);
      ctx.moveTo(sx, syTop);
      ctx.lineTo(sx, syBot);
    }
    for (let gy = 0; gy <= world.params.height; gy += step) {
      const [sxLeft, sy] = camera.worldToScreen(0, gy);
      const [sxRight] = camera.worldToScreen(world.params.width, gy);
      ctx.moveTo(sxLeft, sy);
      ctx.lineTo(sxRight, sy);
    }
    ctx.stroke();
  }

  private drawSubstrate(world: WorldState): void {
    const { ctx, camera } = this;
    // Slow pulse driven by the cycle clock — visibly "breathes" only while the sim ticks.
    const pulse = 0.5 + 0.5 * Math.sin(world.cycle * 0.02);
    for (const n of world.backgroundNodes) {
      const [sx, sy] = camera.worldToScreen(n.x, n.y);
      if (sx < -8 || sy < -8 || sx > camera.viewportW + 8 || sy > camera.viewportH + 8) {
        continue; // cull off-screen
      }
      const r = Math.max(0.5, n.r * camera.zoom * (1 + 0.3 * pulse));
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(120, 180, 255, ${n.intensity * (0.6 + 0.4 * pulse)})`;
      ctx.fill();
    }
  }

  private drawHud(world: WorldState): void {
    const { ctx, camera } = this;
    ctx.font = '11px ui-monospace, SFMono-Regular, Menlo, monospace';
    ctx.fillStyle = 'rgba(120, 150, 200, 0.5)';
    ctx.fillText(
      `world ${world.params.width}×${world.params.height}  ·  zoom ${camera.zoom.toFixed(2)}×  ·  drag to pan, scroll to zoom`,
      12,
      camera.viewportH - 14,
    );
  }
}
