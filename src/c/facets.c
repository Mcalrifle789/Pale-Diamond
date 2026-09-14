/*
 * facets.c — brilliant-cut facet geometry for the Pale Diamond mask.
 *
 * The hero image is clipped to a diamond outline and overlaid with facet edges
 * that catch the light. This module generates that geometry: the outline used
 * for the CSS clip path, and the facet edge segments the canvas strokes.
 *
 * Built freestanding for wasm32 (no libc), so the trigonometry is implemented
 * here rather than pulled from math.h.
 */

#define WASM_EXPORT __attribute__((visibility("default")))

#define PI 3.14159265358979323846f
#define MAX_SEGMENTS 256

/* Flat output buffers. Each segment is four floats: x1, y1, x2, y2, all in a
 * 0..1 unit square so the JavaScript side can scale them to any size. */
static float segment_buffer[MAX_SEGMENTS * 4];
static float outline_buffer[MAX_SEGMENTS * 2];

/* --- Minimal trigonometry ------------------------------------------------ */

/* Wrap x into [-PI, PI]. */
static float wrap_pi(float x) {
    while (x > PI) x -= 2.0f * PI;
    while (x < -PI) x += 2.0f * PI;
    return x;
}

/* Seventh-order Taylor sine; accurate to ~1e-6 once the argument is wrapped. */
static float c_sin(float x) {
    x = wrap_pi(x);

    const float x2 = x * x;
    const float x3 = x2 * x;
    const float x5 = x3 * x2;
    const float x7 = x5 * x2;

    return x - x3 / 6.0f + x5 / 120.0f - x7 / 5040.0f;
}

static float c_cos(float x) {
    return c_sin(x + PI / 2.0f);
}

/* --- Geometry ------------------------------------------------------------ */

WASM_EXPORT const float *segments_ptr(void) { return segment_buffer; }
WASM_EXPORT const float *outline_ptr(void) { return outline_buffer; }
WASM_EXPORT int max_segments(void) { return MAX_SEGMENTS; }

/*
 * Build the outline of a brilliant cut viewed face-on: a `points`-sided polygon
 * inscribed in the unit square, with alternating radii so the girdle reads as
 * faceted rather than perfectly round.
 *
 * Returns the number of points written (each point is two floats).
 */
WASM_EXPORT int build_outline(int points, float sharpness) {
    if (points < 3) points = 3;
    if (points > MAX_SEGMENTS) points = MAX_SEGMENTS;

    for (int i = 0; i < points; i++) {
        const float angle = (float) i / (float) points * 2.0f * PI - PI / 2.0f;

        /* Alternate between the full radius and a slightly pulled-in one. */
        const float radius = (i % 2 == 0) ? 0.5f : 0.5f - 0.5f * sharpness * 0.18f;

        outline_buffer[i * 2] = 0.5f + radius * c_cos(angle);
        outline_buffer[i * 2 + 1] = 0.5f + radius * c_sin(angle);
    }

    return points;
}

/*
 * Build the facet edges.
 *
 * A brilliant cut is three bands: the table at the centre, a ring of star and
 * bezel facets around it, and the upper girdle facets running out to the edge.
 * `rings` controls how many bands are produced, `spokes` how many facets per
 * band. `twist` rotates each successive ring so the edges stagger.
 *
 * Returns the number of segments written (each segment is four floats).
 */
WASM_EXPORT int build_facets(int rings, int spokes, float twist) {
    if (rings < 1) rings = 1;
    if (spokes < 3) spokes = 3;

    int count = 0;

    for (int ring = 0; ring < rings; ring++) {
        /* Radii of this band and the next one out. */
        const float inner = 0.5f * ((float) ring / (float) rings);
        const float outer = 0.5f * ((float) (ring + 1) / (float) rings);
        const float rotation = twist * (float) ring;

        for (int spoke = 0; spoke < spokes; spoke++) {
            if (count + 2 > MAX_SEGMENTS) return count;

            const float a0 = (float) spoke / (float) spokes * 2.0f * PI + rotation;
            const float a1 = (float) (spoke + 1) / (float) spokes * 2.0f * PI + rotation;

            /* Radial edge: inner vertex out to the outer vertex. */
            segment_buffer[count * 4 + 0] = 0.5f + inner * c_cos(a0);
            segment_buffer[count * 4 + 1] = 0.5f + inner * c_sin(a0);
            segment_buffer[count * 4 + 2] = 0.5f + outer * c_cos(a0);
            segment_buffer[count * 4 + 3] = 0.5f + outer * c_sin(a0);
            count++;

            /* Girdle edge: chord along the outer radius to the next spoke. */
            segment_buffer[count * 4 + 0] = 0.5f + outer * c_cos(a0);
            segment_buffer[count * 4 + 1] = 0.5f + outer * c_sin(a0);
            segment_buffer[count * 4 + 2] = 0.5f + outer * c_cos(a1);
            segment_buffer[count * 4 + 3] = 0.5f + outer * c_sin(a1);
            count++;
        }
    }

    return count;
}

/*
 * Brightness of a facet at a given time, in 0..1.
 *
 * Each facet catches the light at its own rate so the stone appears to
 * scintillate rather than pulse as one piece.
 */
WASM_EXPORT float facet_brightness(int index, float time) {
    const float offset = (float) index * 0.618033988f;   /* golden-ratio stagger */
    const float slow = c_sin(time * 0.6f + offset * 6.2831853f);
    const float fast = c_sin(time * 1.9f + offset * 12.566370f);

    float value = 0.5f + 0.35f * slow + 0.15f * fast;

    if (value < 0.0f) value = 0.0f;
    if (value > 1.0f) value = 1.0f;

    return value;
}
