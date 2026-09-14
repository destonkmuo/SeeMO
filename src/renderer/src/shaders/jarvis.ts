export const JARVIS_WGSL = /* wgsl */ `
struct Uniforms {
  time: f32,
  resolution: vec2f,
  speaking: f32,
  colorMix: f32,
};

@group(0) @binding(0) var<uniform> u: Uniforms;

const GRAY: vec3f = vec3f(0.40, 0.44, 0.48);
const BLUE: vec3f = vec3f(0.22, 0.65, 1.0);
const BRIGHT: vec3f = vec3f(0.60, 0.90, 1.0);
const PI: f32 = 3.141592653589793;

@vertex
fn vs_main(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[vi], 0.0, 1.0);
}

fn ring(p: vec2f, radius: f32, width: f32) -> f32 {
  return abs(length(p) - radius) - width;
}

@fragment
fn fs_main(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  var uv = (frag.xy * 2.0 - u.resolution) / u.resolution.y;

  let t = u.time;

  // Expand / contract while speaking.
  let pulse = 0.5 + 0.5 * sin(t * 3.0);
  let speakScale = 1.0 + u.speaking * 0.14 * pulse;

  // Subtle idle breathing, always on.
  let breath = 1.0 + 0.025 * sin(t * 1.1);

  let s = speakScale * breath;
  let p = uv / s;

  let d = length(p);

  // Base color ramps gray -> blue as the agent activates.
  let base = mix(GRAY, BLUE, u.colorMix);

  // --- Background ---
  var col = vec3f(0.015, 0.025, 0.04);
  col += base * exp(-d * 2.4) * 0.08;

  // --- Atmosphere glow ---
  let glow = exp(-d * 3.0);
  col += base * glow * (0.55 + u.speaking * 0.9 * pulse);

  // --- Core disc, brighter toward center ---
  let coreMask = 1.0 - smoothstep(0.0, 0.34, d);
  let coreGlow = mix(BRIGHT, base, clamp(d / 0.34, 0.0, 1.0));
  col += coreGlow * coreMask * 0.95;

  // --- Rim highlight ---
  let rim = 1.0 - smoothstep(0.27, 0.36, d);
  col += BRIGHT * rim * 0.28;

  // --- Ring 1: rotating tick marks ---
  let a1 = atan2(p.y, p.x);
  let r1 = ring(p, 0.46, 0.006);
  let ticks1 = 0.5 + 0.5 * sin(a1 * 24.0 - t * 1.5);
  let ring1 = 1.0 - smoothstep(0.001, 0.004, abs(r1));
  col += base * ring1 * (0.30 + 0.70 * ticks1);

  // --- Ring 2: counter-rotating ticks ---
  let r2 = ring(p, 0.62, 0.004);
  let ticks2 = 0.5 + 0.5 * sin(a1 * 40.0 + t * 2.0);
  let ring2 = 1.0 - smoothstep(0.001, 0.004, abs(r2));
  col += base * ring2 * (0.14 + 0.36 * ticks2);

  // --- Ring 3: segmented arc ---
  let r3 = ring(p, 0.78, 0.005);
  let seg = step(0.5, 0.5 + 0.5 * sin(a1 * 12.0 - t * 1.0));
  let ring3 = 1.0 - smoothstep(0.001, 0.004, abs(r3));
  col += base * ring3 * seg * 0.4;

  // --- Orbiting dots ---
  var dots = 0.0;
  for (var i: i32 = 0; i < 3; i = i + 1) {
    let fi = f32(i);
    let ang = t * (0.5 + 0.3 * fi) + fi * (PI * 2.0 / 3.0);
    let radius = 0.46 + 0.16 * fi;
    let pos = vec2f(cos(ang), sin(ang)) * radius;
    let dd = length(p - pos);
    dots += 1.0 - smoothstep(0.02, 0.06, dd);
  }
  col += BRIGHT * dots * 0.5;

  // Extra energy while speaking.
  col += base * glow * u.speaking * pulse * 0.5;

  return vec4f(col, 1.0);
}
`
