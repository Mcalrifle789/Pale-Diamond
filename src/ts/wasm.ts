/**
 * Bridge to the compiled visual modules.
 *
 *   dist/wasm/caustics.wasm  <- src/rust/src/lib.rs   (refracted light field)
 *   dist/wasm/facets.wasm    <- src/c/facets.c        (brilliant-cut geometry)
 *   dist/wasm/starfield.wasm <- src/cpp/starfield.cpp (particle field)
 *
 * Every module is optional. If a `.wasm` file is missing or fails to
 * instantiate, the equivalent TypeScript implementation below takes over, so
 * the page always renders — it simply does a little more work on the main
 * thread. That matters because the WASM artifacts are produced by a CI job
 * that a fork or a local checkout may not have run.
 */

// --- Module shapes ---------------------------------------------------------

interface CausticsExports {
  memory: WebAssembly.Memory;
  framebuffer_ptr(): number;
  max_pixels(): number;
  render(width: number, height: number, time: number, intensity: number): number;
}

interface FacetsExports {
  memory: WebAssembly.Memory;
  segments_ptr(): number;
  outline_ptr(): number;
  max_segments(): number;
  build_outline(points: number, sharpness: number): number;
  build_facets(rings: number, spokes: number, twist: number): number;
  facet_brightness(index: number, time: number): number;
}

interface StarfieldExports {
  memory: WebAssembly.Memory;
  starfield_ptr(): number;
  starfield_max(): number;
  starfield_init(count: number, seed: number): number;
  starfield_step(dt: number, time: number, pointerX: number, pointerY: number): number;
}

async function instantiate<T>(url: string): Promise<T | null> {
  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error('HTTP ' + response.status);

    const bytes = await response.arrayBuffer();
    const { instance } = await WebAssembly.instantiate(bytes, {});
    return instance.exports as unknown as T;
  } catch (error) {
    console.info('[wasm] ' + url + ' unavailable, using TypeScript fallback', error);
    return null;
  }
}

// --- Public interfaces the renderer consumes -------------------------------

export interface Caustics {
  /** Render into `image`, which must be width x height. */
  render(image: ImageData, width: number, height: number, time: number, intensity: number): void;
  readonly accelerated: boolean;
}

export interface Facets {
  /** Facet edge segments as [x1, y1, x2, y2, ...] in a 0..1 unit square. */
  segments(rings: number, spokes: number, twist: number): Float32Array;
  /** Outline points as [x, y, ...] in a 0..1 unit square. */
  outline(points: number, sharpness: number): Float32Array;
  brightness(index: number, time: number): number;
  readonly accelerated: boolean;
}

export interface Starfield {
  init(count: number, seed: number): number;
  /** Particle buffer as [x, y, size, brightness, ...]. */
  step(dt: number, time: number, pointerX: number, pointerY: number): Float32Array;
  readonly accelerated: boolean;
}

// --- TypeScript fallbacks --------------------------------------------------

const TAU = Math.PI * 2;

const fallbackCaustics: Caustics = {
  accelerated: false,
  render(image, width, height, time, intensity) {
    const data = image.data;
    const halfW = width * 0.5;
    const halfH = height * 0.5;
    const scale = 1 / Math.max(halfW, 1);

    for (let y = 0; y < height; y++) {
      const ny = (y - halfH) * scale;

      for (let x = 0; x < width; x++) {
        const nx = (x - halfW) * scale;

        const a = Math.sin((nx * Math.cos(time * 0.21) + ny * Math.sin(time * 0.21)) * 8.5 + time * 0.9);
        const b = Math.sin((nx * Math.cos(2.1 - time * 0.17) + ny * Math.sin(2.1 - time * 0.17)) * 12 - time * 0.7);
        const c = Math.sin((nx * Math.cos(4.2 + time * 0.11) + ny * Math.sin(4.2 + time * 0.11)) * 5.5 + time * 0.45);

        let light = 1 - Math.abs((a + b + c) / 3);
        light = light * light * light;

        const falloff = 1 - Math.min(nx * nx + ny * ny, 1);
        light *= falloff * falloff * intensity;

        const offset = (y * width + x) * 4;
        data[offset] = Math.min(light * 196, 255);
        data[offset + 1] = Math.min(light * 214, 255);
        data[offset + 2] = Math.min(light * 255, 255);
        data[offset + 3] = Math.min(light * 235, 255);
      }
    }
  },
};

const fallbackFacets: Facets = {
  accelerated: false,
  segments(rings, spokes, twist) {
    const out: number[] = [];

    for (let ring = 0; ring < rings; ring++) {
      const inner = 0.5 * (ring / rings);
      const outer = 0.5 * ((ring + 1) / rings);
      const rotation = twist * ring;

      for (let spoke = 0; spoke < spokes; spoke++) {
        const a0 = (spoke / spokes) * TAU + rotation;
        const a1 = ((spoke + 1) / spokes) * TAU + rotation;

        out.push(
          0.5 + inner * Math.cos(a0), 0.5 + inner * Math.sin(a0),
          0.5 + outer * Math.cos(a0), 0.5 + outer * Math.sin(a0),
          0.5 + outer * Math.cos(a0), 0.5 + outer * Math.sin(a0),
          0.5 + outer * Math.cos(a1), 0.5 + outer * Math.sin(a1),
        );
      }
    }

    return Float32Array.from(out);
  },
  outline(points, sharpness) {
    const out: number[] = [];

    for (let i = 0; i < points; i++) {
      const angle = (i / points) * TAU - Math.PI / 2;
      const radius = i % 2 === 0 ? 0.5 : 0.5 - 0.5 * sharpness * 0.18;
      out.push(0.5 + radius * Math.cos(angle), 0.5 + radius * Math.sin(angle));
    }

    return Float32Array.from(out);
  },
  brightness(index, time) {
    const offset = index * 0.618033988;
    const value = 0.5
      + 0.35 * Math.sin(time * 0.6 + offset * TAU)
      + 0.15 * Math.sin(time * 1.9 + offset * TAU * 2);
    return Math.max(0, Math.min(1, value));
  },
};

function makeFallbackStarfield(): Starfield {
  type P = { x: number; y: number; depth: number; phase: number; dx: number; dy: number };
  let particles: P[] = [];
  let buffer = new Float32Array(0);

  return {
    accelerated: false,
    init(count, seed) {
      // Same xorshift as the C++ module, so both paths produce the same sky.
      let state = seed || 0x9e3779b9;
      const random = () => {
        state ^= state << 13; state ^= state >>> 17; state ^= state << 5;
        return (state >>> 8) / 16777216;
      };

      particles = [];
      for (let i = 0; i < count; i++) {
        const d = random();
        const depth = d * d;
        const speed = 0.004 + depth * 0.02;
        const angle = random() * TAU;
        particles.push({
          x: random(), y: random(), depth, phase: random() * TAU,
          dx: Math.cos(angle) * speed, dy: Math.sin(angle) * speed * 0.4,
        });
      }

      buffer = new Float32Array(count * 4);
      return count;
    },
    step(dt, time, pointerX, pointerY) {
      const step = Math.max(0, Math.min(dt, 0.1));
      const wrap = (v: number) => ((v % 1) + 1) % 1;

      particles.forEach((p, i) => {
        p.x = wrap(p.x + p.dx * step);
        p.y = wrap(p.y + p.dy * step);

        const parallax = p.depth * 0.03;
        const twinkle = 0.675 + 0.325 * Math.sin(time * 1.7 + p.phase);

        buffer[i * 4] = wrap(p.x + (pointerX - 0.5) * parallax);
        buffer[i * 4 + 1] = wrap(p.y + (pointerY - 0.5) * parallax);
        buffer[i * 4 + 2] = 0.4 + p.depth * 2.2;
        buffer[i * 4 + 3] = (0.25 + p.depth * 0.75) * twinkle;
      });

      return buffer;
    },
  };
}

// --- Loaders ---------------------------------------------------------------

export async function loadCaustics(): Promise<Caustics> {
  const wasm = await instantiate<CausticsExports>('wasm/caustics.wasm');
  if (!wasm) return fallbackCaustics;

  const base = wasm.framebuffer_ptr();
  const limit = wasm.max_pixels();

  return {
    accelerated: true,
    render(image, width, height, time, intensity) {
      if (width * height > limit) {
        fallbackCaustics.render(image, width, height, time, intensity);
        return;
      }

      const written = wasm.render(width, height, time, intensity);
      if (written === 0) return;

      // A fresh view each frame: memory can grow and detach an old one.
      const pixels = new Uint8ClampedArray(wasm.memory.buffer, base, written * 4);
      image.data.set(pixels);
    },
  };
}

export async function loadFacets(): Promise<Facets> {
  const wasm = await instantiate<FacetsExports>('wasm/facets.wasm');
  if (!wasm) return fallbackFacets;

  return {
    accelerated: true,
    segments(rings, spokes, twist) {
      const count = wasm.build_facets(rings, spokes, twist);
      return new Float32Array(wasm.memory.buffer, wasm.segments_ptr(), count * 4).slice();
    },
    outline(points, sharpness) {
      const count = wasm.build_outline(points, sharpness);
      return new Float32Array(wasm.memory.buffer, wasm.outline_ptr(), count * 2).slice();
    },
    brightness: (index, time) => wasm.facet_brightness(index, time),
  };
}

export async function loadStarfield(): Promise<Starfield> {
  const wasm = await instantiate<StarfieldExports>('wasm/starfield.wasm');
  if (!wasm) return makeFallbackStarfield();

  let count = 0;

  return {
    accelerated: true,
    init(requested, seed) {
      count = wasm.starfield_init(Math.min(requested, wasm.starfield_max()), seed);
      return count;
    },
    step(dt, time, pointerX, pointerY) {
      const written = wasm.starfield_step(dt, time, pointerX, pointerY);
      return new Float32Array(wasm.memory.buffer, wasm.starfield_ptr(), written * 4);
    },
  };
}
