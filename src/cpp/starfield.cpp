// starfield.cpp — the drifting particle field behind the Pale Diamond hero.
//
// The reference art sits in a deep blue galaxy. This module owns the motion of
// those particles: position, depth, drift and twinkle. Positions are written to
// a flat buffer that the TypeScript layer reads once per frame and draws to a
// canvas.
//
// Built freestanding for wasm32, so there is no standard library, no heap and
// no exceptions — storage is a fixed-size static array.

#define WASM_EXPORT extern "C" __attribute__((visibility("default")))

namespace {

constexpr int kMaxParticles = 2048;
constexpr float kPi = 3.14159265358979323846f;

// Per-particle state. Kept as a struct-of-arrays so the output buffer can be
// handed to JavaScript as one contiguous Float32Array.
struct Particle {
    float x;          // 0..1 across the surface
    float y;          // 0..1 down the surface
    float depth;      // 0..1, drives size and parallax
    float phase;      // twinkle offset
    float driftX;     // units per second
    float driftY;
};

Particle particles[kMaxParticles];

// Four floats per particle: x, y, size, brightness.
float output[kMaxParticles * 4];

int particleCount = 0;

// Deterministic PRNG so every visitor sees the same sky, and so the layout can
// be reproduced when debugging.
unsigned int rngState = 0x9E3779B9u;

unsigned int nextRandom() {
    rngState ^= rngState << 13;
    rngState ^= rngState >> 17;
    rngState ^= rngState << 5;
    return rngState;
}

// Uniform float in [0, 1).
float randomUnit() {
    return static_cast<float>(nextRandom() & 0x00FFFFFFu) / 16777216.0f;
}

float wrapPi(float x) {
    while (x > kPi) x -= 2.0f * kPi;
    while (x < -kPi) x += 2.0f * kPi;
    return x;
}

// Seventh-order Taylor sine, adequate for twinkle and far cheaper than a call
// into a math library we do not link.
float fastSin(float x) {
    x = wrapPi(x);

    const float x2 = x * x;
    const float x3 = x2 * x;
    const float x5 = x3 * x2;
    const float x7 = x5 * x2;

    return x - x3 / 6.0f + x5 / 120.0f - x7 / 5040.0f;
}

// Keep a coordinate inside [0, 1) by wrapping, so particles that drift off one
// edge reappear on the other.
float wrapUnit(float value) {
    while (value < 0.0f) value += 1.0f;
    while (value >= 1.0f) value -= 1.0f;
    return value;
}

}  // namespace

WASM_EXPORT const float *starfield_ptr() { return output; }

WASM_EXPORT int starfield_max() { return kMaxParticles; }

// Lay out `count` particles. `seed` selects the sky; pass the same seed to get
// the same arrangement back.
WASM_EXPORT int starfield_init(int count, unsigned int seed) {
    if (count < 0) count = 0;
    if (count > kMaxParticles) count = kMaxParticles;

    particleCount = count;
    rngState = seed ? seed : 0x9E3779B9u;

    for (int i = 0; i < particleCount; i++) {
        Particle &p = particles[i];

        p.x = randomUnit();
        p.y = randomUnit();

        // Bias toward the far field so most particles are small and dim, with
        // a handful of close, bright ones for depth.
        const float d = randomUnit();
        p.depth = d * d;

        p.phase = randomUnit() * 2.0f * kPi;

        // Nearer particles drift faster, which reads as parallax.
        const float speed = 0.004f + p.depth * 0.02f;
        const float angle = randomUnit() * 2.0f * kPi;
        p.driftX = fastSin(angle + kPi / 2.0f) * speed;
        p.driftY = fastSin(angle) * speed * 0.4f;
    }

    return particleCount;
}

// Advance the field by `dt` seconds and write the render buffer.
//
// `time` is the absolute clock used for twinkle; `pointerX` / `pointerY` are
// the cursor position in 0..1, which pushes the near field slightly for a
// parallax response. Returns the number of particles written.
WASM_EXPORT int starfield_step(float dt, float time, float pointerX, float pointerY) {
    if (dt < 0.0f) dt = 0.0f;
    if (dt > 0.1f) dt = 0.1f;                 // clamp after a backgrounded tab

    for (int i = 0; i < particleCount; i++) {
        Particle &p = particles[i];

        p.x = wrapUnit(p.x + p.driftX * dt);
        p.y = wrapUnit(p.y + p.driftY * dt);

        // Parallax: near particles (high depth) shift most with the pointer.
        const float parallax = p.depth * 0.03f;
        const float px = wrapUnit(p.x + (pointerX - 0.5f) * parallax);
        const float py = wrapUnit(p.y + (pointerY - 0.5f) * parallax);

        // Twinkle between roughly 0.35 and 1.0 of the base brightness.
        const float twinkle = 0.675f + 0.325f * fastSin(time * 1.7f + p.phase);

        const float size = 0.4f + p.depth * 2.2f;
        const float brightness = (0.25f + p.depth * 0.75f) * twinkle;

        output[i * 4 + 0] = px;
        output[i * 4 + 1] = py;
        output[i * 4 + 2] = size;
        output[i * 4 + 3] = brightness;
    }

    return particleCount;
}
