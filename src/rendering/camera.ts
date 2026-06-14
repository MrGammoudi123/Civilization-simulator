import type { WorldParams } from '../simulation/types';

/**
 * 2D camera mapping world coordinates <-> screen (CSS) pixels. Supports pan and
 * cursor-anchored zoom. (x, y) is the world point shown at the viewport center.
 */
export class Camera {
  x = 0;
  y = 0;
  zoom = 1;
  viewportW = 0;
  viewportH = 0;

  private static readonly MIN_ZOOM = 0.05;
  private static readonly MAX_ZOOM = 8;

  setViewport(w: number, h: number): void {
    this.viewportW = w;
    this.viewportH = h;
  }

  /** Center on the world and pick a zoom that fits it within the viewport. */
  fitToWorld(params: WorldParams, padding = 48): void {
    this.x = params.width / 2;
    this.y = params.height / 2;
    const zx = (this.viewportW - padding * 2) / params.width;
    const zy = (this.viewportH - padding * 2) / params.height;
    this.zoom = clamp(Math.min(zx, zy), Camera.MIN_ZOOM, Camera.MAX_ZOOM);
  }

  worldToScreen(wx: number, wy: number): [number, number] {
    return [
      (wx - this.x) * this.zoom + this.viewportW / 2,
      (wy - this.y) * this.zoom + this.viewportH / 2,
    ];
  }

  screenToWorld(sx: number, sy: number): [number, number] {
    return [
      (sx - this.viewportW / 2) / this.zoom + this.x,
      (sy - this.viewportH / 2) / this.zoom + this.y,
    ];
  }

  /** Pan by a screen-space delta (e.g. mouse drag). */
  pan(dxScreen: number, dyScreen: number): void {
    this.x -= dxScreen / this.zoom;
    this.y -= dyScreen / this.zoom;
  }

  /** Zoom by `factor` while keeping the world point under (sx, sy) fixed. */
  zoomAt(sx: number, sy: number, factor: number): void {
    const [wx, wy] = this.screenToWorld(sx, sy);
    this.zoom = clamp(this.zoom * factor, Camera.MIN_ZOOM, Camera.MAX_ZOOM);
    this.x = wx - (sx - this.viewportW / 2) / this.zoom;
    this.y = wy - (sy - this.viewportH / 2) / this.zoom;
  }
}

function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}
