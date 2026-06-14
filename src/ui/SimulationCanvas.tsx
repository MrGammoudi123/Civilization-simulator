import { useEffect, useRef } from 'react';
import type { Engine } from '../simulation/engine';
import { CanvasRenderer } from '../rendering/canvasRenderer';
import { Camera } from '../rendering/camera';

/**
 * Hosts the simulation <canvas>. Owns a Camera + CanvasRenderer, keeps the backing store
 * sized to its container (DPR-aware), wires pan/zoom + click-to-select interaction, and
 * registers the renderer's draw call with the engine's per-frame loop. While an agent is
 * selected the camera follows it.
 */
export function SimulationCanvas({ engine }: { engine: Engine }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const wrap = wrapRef.current;
    if (!canvas || !wrap) return;

    const camera = new Camera();
    const renderer = new CanvasRenderer(canvas, camera);

    let fitted = false;
    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      renderer.resize(rect.width, rect.height, dpr);
      if (!fitted && rect.width > 0 && rect.height > 0) {
        camera.fitToWorld(engine.getWorld().params);
        fitted = true;
      }
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(wrap);

    // --- pan / zoom / select interaction ---
    let dragging = false;
    let moved = false;
    let lastX = 0;
    let lastY = 0;
    let downX = 0;
    let downY = 0;

    const onDown = (e: PointerEvent) => {
      dragging = true;
      moved = false;
      lastX = e.clientX;
      lastY = e.clientY;
      downX = e.clientX;
      downY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    };
    const onMove = (e: PointerEvent) => {
      if (!dragging) return;
      if (Math.hypot(e.clientX - downX, e.clientY - downY) > 4) moved = true;
      camera.pan(e.clientX - lastX, e.clientY - lastY);
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onUp = (e: PointerEvent) => {
      dragging = false;
      if (canvas.hasPointerCapture(e.pointerId)) canvas.releasePointerCapture(e.pointerId);
      if (!moved) {
        // a click (not a drag): select the nearest agent under the cursor
        const rect = canvas.getBoundingClientRect();
        const [wx, wy] = camera.screenToWorld(e.clientX - rect.left, e.clientY - rect.top);
        engine.selectAgentAt(wx, wy);
      }
    };
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      camera.zoomAt(e.clientX - rect.left, e.clientY - rect.top, factor);
    };

    canvas.addEventListener('pointerdown', onDown);
    canvas.addEventListener('pointermove', onMove);
    canvas.addEventListener('pointerup', onUp);
    canvas.addEventListener('pointercancel', onUp);
    canvas.addEventListener('wheel', onWheel, { passive: false });

    const unsubFrame = engine.onFrame((world, alpha) => {
      const sid = engine.getSelectedId();
      renderer.setSelected(sid);
      if (sid !== null && !dragging) {
        const a = world.agents.find((x) => x.id === sid);
        if (a) {
          camera.x += (a.x - camera.x) * 0.12;
          camera.y += (a.y - camera.y) * 0.12;
        }
      }
      renderer.render(world, alpha);
    });

    return () => {
      unsubFrame();
      ro.disconnect();
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointermove', onMove);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointercancel', onUp);
      canvas.removeEventListener('wheel', onWheel);
    };
  }, [engine]);

  return (
    <div className="canvas-wrap" ref={wrapRef}>
      <canvas ref={canvasRef} className="sim-canvas" />
    </div>
  );
}
