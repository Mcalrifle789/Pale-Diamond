/**
 * The hero stone.
 *
 * Three layers, drawn back to front:
 *
 *   1. starfield — the drifting particle sky (C++ module), painted across the
 *      whole hero so the title art dissolves into the page rather than sitting
 *      on it as a rectangle.
 *   2. the title image, clipped to the brilliant-cut outline (C module) and
 *      feathered at its edges so it masks into the background.
 *   3. caustics and facet edges (Rust and C modules) composited in `lighter`,
 *      which is what produces the reflection running across the stone.
 *
 * One canvas, one animation frame loop, and it pauses when off-screen or when
 * the visitor has asked for reduced motion.
 */

import { loadCaustics, loadFacets, loadStarfield, type Caustics, type Facets, type Starfield } from './wasm.js';

/** Caustics are rendered at low resolution and scaled up; they are all soft gradients. */
const CAUSTIC_SCALE = 0.25;

const PARTICLE_COUNT = 420;
const FACET_RINGS = 3;
const FACET_SPOKES = 8;

export class DiamondHero {
  private readonly canvas: HTMLCanvasElement;
  private readonly context: CanvasRenderingContext2D;

  private caustics!: Caustics;
  private facets!: Facets;
  private starfield!: Starfield;

  private causticCanvas = document.createElement('canvas');
  private causticContext!: CanvasRenderingContext2D;
  private causticImage!: ImageData;

  private image: HTMLImageElement | null = null;
  // Views may be backed by WebAssembly memory, hence the loose buffer type.
  private outline: Float32Array<ArrayBufferLike> = new Float32Array(0);
  private segments: Float32Array<ArrayBufferLike> = new Float32Array(0);

  private width = 0;
  private height = 0;
  private dpr = 1;

  private pointer = { x: 0.5, y: 0.5 };
  private lastFrame = 0;
  private running = false;
  private frameHandle = 0;
  private reducedMotion = false;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const context = canvas.getContext('2d', { alpha: true });
    if (!context) throw new Error('2D canvas is unavailable');
    this.context = context;
  }

  async start(imageSrc: string): Promise<void> {
    [this.caustics, this.facets, this.starfield] = await Promise.all([
      loadCaustics(), loadFacets(), loadStarfield(),
    ]);

    const causticContext = this.causticCanvas.getContext('2d', { alpha: true });
    if (!causticContext) throw new Error('2D canvas is unavailable');
    this.causticContext = causticContext;

    this.image = await loadImage(imageSrc).catch(() => null);

    this.outline = this.facets.outline(16, 1);
    this.segments = this.facets.segments(FACET_RINGS, FACET_SPOKES, 0.21);
    this.starfield.init(PARTICLE_COUNT, 0x9e3779b9);

    const motionQuery = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reducedMotion = motionQuery.matches;
    motionQuery.addEventListener('change', (event) => {
      this.reducedMotion = event.matches;
      this.reducedMotion ? this.stop() : this.resume();
      if (this.reducedMotion) this.draw(0);              // one static frame
    });

    this.resize();
    new ResizeObserver(() => this.resize()).observe(this.canvas.parentElement ?? this.canvas);

    this.canvas.parentElement?.addEventListener('pointermove', (event) => {
      const bounds = this.canvas.getBoundingClientRect();
      this.pointer.x = (event.clientX - bounds.left) / Math.max(bounds.width, 1);
      this.pointer.y = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    });

    // Stop the loop whenever the hero scrolls out of view.
    new IntersectionObserver((entries) => {
      for (const entry of entries) entry.isIntersecting ? this.resume() : this.stop();
    }, { threshold: 0.01 }).observe(this.canvas);

    document.addEventListener('visibilitychange', () => {
      document.hidden ? this.stop() : this.resume();
    });

    this.canvas.dataset.accelerated = String(
      this.caustics.accelerated && this.facets.accelerated && this.starfield.accelerated,
    );

    this.reducedMotion ? this.draw(0) : this.resume();
  }

  private resize(): void {
    const host = this.canvas.parentElement ?? this.canvas;
    const bounds = host.getBoundingClientRect();

    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.width = Math.max(1, Math.round(bounds.width));
    this.height = Math.max(1, Math.round(bounds.height));

    this.canvas.width = Math.round(this.width * this.dpr);
    this.canvas.height = Math.round(this.height * this.dpr);
    this.canvas.style.width = this.width + 'px';
    this.canvas.style.height = this.height + 'px';

    const cw = Math.max(1, Math.round(this.width * CAUSTIC_SCALE));
    const ch = Math.max(1, Math.round(this.height * CAUSTIC_SCALE));
    this.causticCanvas.width = cw;
    this.causticCanvas.height = ch;
    this.causticImage = this.causticContext.createImageData(cw, ch);

    if (!this.running) this.draw(this.lastFrame / 1000);
  }

  private resume(): void {
    if (this.running || this.reducedMotion) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.frameHandle = requestAnimationFrame((now) => this.tick(now));
  }

  private stop(): void {
    this.running = false;
    if (this.frameHandle) cancelAnimationFrame(this.frameHandle);
    this.frameHandle = 0;
  }

  private tick(now: number): void {
    if (!this.running) return;

    const dt = Math.min((now - this.lastFrame) / 1000, 0.1);
    this.lastFrame = now;

    this.draw(now / 1000, dt);
    this.frameHandle = requestAnimationFrame((next) => this.tick(next));
  }

  /** The diamond outline as a path, sized to the current canvas. */
  private outlinePath(cx: number, cy: number, size: number): Path2D {
    const path = new Path2D();

    for (let i = 0; i < this.outline.length; i += 2) {
      const x = cx + (this.outline[i] - 0.5) * size;
      const y = cy + (this.outline[i + 1] - 0.5) * size;
      i === 0 ? path.moveTo(x, y) : path.lineTo(x, y);
    }

    path.closePath();
    return path;
  }

  private draw(time: number, dt = 0): void {
    const ctx = this.context;
    const w = this.width;
    const h = this.height;

    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // --- 1. starfield ------------------------------------------------------
    const particles = this.starfield.step(dt, time, this.pointer.x, this.pointer.y);
    ctx.save();
    for (let i = 0; i < particles.length; i += 4) {
      const brightness = particles[i + 3];
      ctx.globalAlpha = Math.max(0, Math.min(brightness, 1)) * 0.9;
      ctx.fillStyle = brightness > 0.75 ? '#dbe6ff' : '#8fa4d8';
      ctx.beginPath();
      ctx.arc(particles[i] * w, particles[i + 1] * h, particles[i + 2], 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();

    // --- 2. the title image, clipped to the stone --------------------------
    const size = Math.min(w, h) * 0.86;
    const cx = w / 2;
    const cy = h / 2;
    const path = this.outlinePath(cx, cy, size);

    if (this.image) {
      ctx.save();
      ctx.clip(path);

      // Cover-fit the source art inside the outline.
      const scale = Math.max(size / this.image.width, size / this.image.height) * 1.18;
      const dw = this.image.width * scale;
      const dh = this.image.height * scale;
      ctx.drawImage(this.image, cx - dw / 2, cy - dh / 2, dw, dh);

      // Feather the edges into the page background so the art masks with the
      // rest of the site instead of ending on a hard rectangle.
      const feather = ctx.createRadialGradient(cx, cy, size * 0.18, cx, cy, size * 0.56);
      feather.addColorStop(0, 'rgba(6, 9, 20, 0)');
      feather.addColorStop(0.72, 'rgba(6, 9, 20, 0.12)');
      feather.addColorStop(1, 'rgba(6, 9, 20, 0.92)');
      ctx.fillStyle = feather;
      ctx.fillRect(cx - size, cy - size, size * 2, size * 2);

      ctx.restore();
    }

    // --- 3. caustics and facet edges --------------------------------------
    const intensity = this.reducedMotion ? 0.55 : 0.85;
    this.caustics.render(
      this.causticImage, this.causticCanvas.width, this.causticCanvas.height, time, intensity,
    );
    this.causticContext.putImageData(this.causticImage, 0, 0);

    ctx.save();
    ctx.clip(path);
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.7;
    ctx.drawImage(this.causticCanvas, cx - size / 2, cy - size / 2, size, size);

    // Facet edges, each catching the light at its own rate.
    ctx.lineWidth = 1;
    for (let i = 0, facet = 0; i < this.segments.length; i += 4, facet++) {
      const brightness = this.facets.brightness(facet, this.reducedMotion ? 0 : time);
      ctx.globalAlpha = 0.08 + brightness * 0.34;
      ctx.strokeStyle = '#e8f0ff';
      ctx.beginPath();
      ctx.moveTo(cx + (this.segments[i] - 0.5) * size, cy + (this.segments[i + 1] - 0.5) * size);
      ctx.lineTo(cx + (this.segments[i + 2] - 0.5) * size, cy + (this.segments[i + 3] - 0.5) * size);
      ctx.stroke();
    }
    ctx.restore();

    // Girdle: a bright rim so the stone reads as an object, not a cut-out.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = '#cfe0ff';
    ctx.lineWidth = 1.2;
    ctx.stroke(path);
    ctx.restore();
  }
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = 'async';
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('could not load ' + src));
    image.src = src;
  });
}
