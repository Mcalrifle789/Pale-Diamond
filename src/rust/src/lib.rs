//! Caustics renderer for the Pale Diamond hero.
//!
//! Produces the moving light that appears to refract through the stone: a sum
//! of rotating sine ridges, folded so the bright seams cross like the facets of
//! a brilliant cut. The result is written straight into linear memory as RGBA8
//! and lifted into an `ImageData` on the JavaScript side.
//!
//! Compiled to `wasm32-unknown-unknown` with no runtime dependencies.

#![no_std]

use core::panic::PanicInfo;

#[panic_handler]
fn panic(_info: &PanicInfo) -> ! {
    core::arch::wasm32::unreachable()
}

/// Largest surface we will ever be asked to render, in pixels.
const MAX_PIXELS: usize = 1024 * 1024;

/// Output buffer. Static rather than heap-allocated so the module needs no
/// allocator and the JavaScript side gets a stable pointer.
static mut FRAMEBUFFER: [u8; MAX_PIXELS * 4] = [0; MAX_PIXELS * 4];

/// Pointer to the RGBA framebuffer.
#[no_mangle]
pub extern "C" fn framebuffer_ptr() -> *const u8 {
    core::ptr::addr_of!(FRAMEBUFFER) as *const u8
}

/// Maximum number of pixels `render` will accept.
#[no_mangle]
pub extern "C" fn max_pixels() -> u32 {
    MAX_PIXELS as u32
}

/// Fast sine over the full real line, accurate to about 1e-4.
///
/// Range-reduces to [-pi, pi] then applies the Bhaskara-style rational
/// approximation, which is smooth enough for a light field and far cheaper
/// than a series expansion.
fn fast_sin(x: f32) -> f32 {
    const PI: f32 = core::f32::consts::PI;
    const TWO_PI: f32 = 2.0 * PI;

    let mut t = x - (x / TWO_PI) as i32 as f32 * TWO_PI;
    if t > PI {
        t -= TWO_PI;
    } else if t < -PI {
        t += TWO_PI;
    }

    let (sign, t) = if t < 0.0 { (-1.0, -t) } else { (1.0, t) };
    let numerator = 16.0 * t * (PI - t);
    let denominator = 5.0 * PI * PI - 4.0 * t * (PI - t);

    sign * (numerator / denominator)
}

fn fast_cos(x: f32) -> f32 {
    fast_sin(x + core::f32::consts::FRAC_PI_2)
}

/// One rotating ridge of light. `angle` sets its direction, `frequency` how
/// tightly the bands pack, `phase` where it sits at t=0.
#[inline]
fn ridge(x: f32, y: f32, angle: f32, frequency: f32, phase: f32) -> f32 {
    let projected = x * fast_cos(angle) + y * fast_sin(angle);
    fast_sin(projected * frequency + phase)
}

/// Render one frame of caustics.
///
/// `width` * `height` must not exceed `max_pixels()`. `time` is in seconds.
/// `intensity` scales the whole field, letting the page fade the effect in.
#[no_mangle]
pub extern "C" fn render(width: u32, height: u32, time: f32, intensity: f32) -> u32 {
    let width = width as usize;
    let height = height as usize;
    let pixel_count = width * height;

    if pixel_count == 0 || pixel_count > MAX_PIXELS {
        return 0;
    }

    let half_w = width as f32 * 0.5;
    let half_h = height as f32 * 0.5;
    let scale = 1.0 / half_w.max(1.0);

    for y in 0..height {
        // Normalised coordinates centred on the middle of the surface.
        let ny = (y as f32 - half_h) * scale;

        for x in 0..width {
            let nx = (x as f32 - half_w) * scale;

            // Three ridges rotating at different rates cross to make the
            // bright points where a real stone throws caustics.
            let a = ridge(nx, ny, time * 0.21, 8.5, time * 0.9);
            let b = ridge(nx, ny, 2.1 - time * 0.17, 12.0, -time * 0.7);
            let c = ridge(nx, ny, 4.2 + time * 0.11, 5.5, time * 0.45);

            // Fold toward zero so only the crossings stay bright, then sharpen.
            let folded = (a + b + c) * 0.3333;
            let mut light = 1.0 - folded.abs();
            light = light * light * light;

            // Radial falloff keeps the edges of the plate dark.
            let radius = nx * nx + ny * ny;
            let falloff = 1.0 - radius.min(1.0);
            light *= falloff * falloff * intensity;

            // Cool blue-white, matching the hero art.
            let r = (light * 196.0).min(255.0) as u8;
            let g = (light * 214.0).min(255.0) as u8;
            let bl = (light * 255.0).min(255.0) as u8;
            let alpha = (light * 235.0).min(255.0) as u8;

            let offset = (y * width + x) * 4;
            unsafe {
                let buffer = core::ptr::addr_of_mut!(FRAMEBUFFER) as *mut u8;
                *buffer.add(offset) = r;
                *buffer.add(offset + 1) = g;
                *buffer.add(offset + 2) = bl;
                *buffer.add(offset + 3) = alpha;
            }
        }
    }

    pixel_count as u32
}
