const COMMON = /* wgsl */ `
struct Particle {
  pos: vec3f,
  seed: f32,
  vel: vec3f,
  life: f32,
};

fn hash31(p: vec3f) -> f32 {
  var q = fract(p * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}

fn vnoise(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let w = f * f * (3.0 - 2.0 * f);

  let n000 = hash31(i + vec3f(0.0, 0.0, 0.0));
  let n100 = hash31(i + vec3f(1.0, 0.0, 0.0));
  let n010 = hash31(i + vec3f(0.0, 1.0, 0.0));
  let n110 = hash31(i + vec3f(1.0, 1.0, 0.0));
  let n001 = hash31(i + vec3f(0.0, 0.0, 1.0));
  let n101 = hash31(i + vec3f(1.0, 0.0, 1.0));
  let n011 = hash31(i + vec3f(0.0, 1.0, 1.0));
  let n111 = hash31(i + vec3f(1.0, 1.0, 1.0));

  let nx00 = mix(n000, n100, w.x);
  let nx10 = mix(n010, n110, w.x);
  let nx01 = mix(n001, n101, w.x);
  let nx11 = mix(n011, n111, w.x);

  let nxy0 = mix(nx00, nx10, w.y);
  let nxy1 = mix(nx01, nx11, w.y);

  return mix(nxy0, nxy1, w.z);
}

// Configurable vibration function
// t: current time
// seed: per-particle seed for variation
// freq: base speed of vibration
// intensity: strength scale of the vibration force
fn vibrate(t: f32, seed: f32, freq: f32, intensity: f32) -> vec3f {
  let phase = t * freq + seed * 100.0;
  return vec3f(
    sin(phase * 1.1),
    cos(phase * 0.9),
    sin(phase * 1.3)
  ) * intensity;
}
`

export const JARVIS_COMPUTE =
  COMMON +
  /* wgsl */ `
struct SimUniforms {
  dt: f32,
  time: f32,
  count: f32,
  energy: f32,
  breathAmp: f32,
  turbulence: f32,
  pulse: f32,
  swirl: f32,
  radius: f32,
  pad0: f32,
};

@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> sim: SimUniforms;

@compute @workgroup_size(64)
fn cs_main(@builtin(global_invocation_id) gid: vec3u) {
  let i = gid.x;
  if (i >= u32(sim.count)) {
    return;
  }

  var p = particles[i];
  let t = sim.time;
  let pos = p.pos;
  let r = max(length(pos), 0.0001);
  let dir = pos / r;

  // Tangential swirl around the vertical axis keeps the cloud alive.
  let up = vec3f(0.0, 1.0, 0.0);
  var tangent = cross(up, dir);
  let tl = length(tangent);
  if (tl > 0.001) {
    tangent = tangent / tl;
  }

  // Base target radius (contained size), scaled per state so the core
  // contracts in sleep and expands when speaking/working.
  let phase = p.seed * 6.2831853;
  let targetR = (0.30 + 0.78 * p.seed) * (1.0 + sim.breathAmp * sin(t * 1.3 + phase)) * sim.radius;

  var force = tangent * (0.5 + 0.7 * p.seed) * sim.swirl;
  force += dir * (targetR - r) * 2.8;

  // Speech-like vibration while talking back, milder churn while working.
  let vibration = vibrate(t, p.seed, 45.0, 1.8) * sim.energy;

  // Organic turbulence combined with vibration
  let n1 = vnoise(pos * 1.7 + t * 0.15);
  let n2 = vnoise(pos * 1.7 + vec3f(13.1, 4.3, 0.0) + t * 0.15);
  let n3 = vnoise(pos * 1.7 + vec3f(0.0, 7.7, 9.2) + t * 0.15);
  force += (vec3f(n1, n2, n3) - vec3f(0.5)) * sim.turbulence + vibration;

  // Traveling ripple: sweeps outward while listening, throbs at speech
  // cadence while talking, nearly still in sleep.
  let pulseWave = sin(r * 9.0 - t * 3.2 + phase) * sim.pulse;
  force += dir * pulseWave * 0.9;

  force.y += sin(t * 0.7 + phase) * 0.12;

  var vel = p.vel + force * sim.dt;
  vel *= 0.95;
  var newPos = pos + vel * sim.dt;

  // Keep tight boundary to avoid viewport overflow
  let nr = length(newPos);
  if (nr > 1.3) {
    newPos = newPos * (1.3 / nr);
    vel = vel * 0.4;
  }

  p.pos = newPos;
  p.vel = vel;
  particles[i] = p;
}
`

export const JARVIS_PARTICLE =
  COMMON +
  /* wgsl */ `
struct RenderUniforms {
  viewProj: mat4x4f,
  resolution: vec2f,
  time: f32,
  energy: f32,
  colorMix: f32,
  sizeScale: f32,
  brightness: f32,
  pulse: f32,
  warm: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};

@group(0) @binding(0) var<storage, read> particles: array<Particle>;
@group(0) @binding(1) var<uniform> ren: RenderUniforms;

struct VSOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) energy: f32,
  @location(2) radial: f32,
  @location(3) depth: f32,
};

@vertex
fn vs_particle(@builtin(vertex_index) vi: u32, @builtin(instance_index) inst: u32) -> VSOut {
  let p = particles[inst];
  let clip = ren.viewProj * vec4f(p.pos, 1.0);
  let speed = length(p.vel);
  let radial = length(p.pos);

  var corners = array<vec2f, 6>(
    vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0),
    vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0),
  );
  let c = corners[vi];

  let baseSize = ren.sizeScale * (0.6 + 0.9 * p.seed);
  let size = baseSize * (1.0 + speed * 0.9 + ren.energy * 0.25);

  var out: VSOut;
  out.pos = vec4f(clip.xy + c * size, clip.z, clip.w);
  out.uv = c;
  out.energy = 0.5 + 0.9 * clamp(speed, 0.0, 1.2);
  out.radial = radial;
  out.depth = clip.w;
  return out;
}

@fragment
fn fs_particle(in: VSOut) -> @location(0) vec4f {
  let d = length(in.uv);
  if (d > 1.0) {
    discard;
  }

  let core = exp(-d * d * 7.0);
  let glow = exp(-d * d * 2.0) * 0.35;

  // Cool blue ramp (sleep -> idle -> speaking) with an amber override
  // while working on an objective.
  let cool = mix(vec3f(0.30, 0.38, 0.50), vec3f(0.16, 0.58, 1.0), ren.colorMix);
  let base = mix(cool, vec3f(1.0, 0.55, 0.18), ren.warm * 0.85);
  var hot = mix(vec3f(0.85, 0.88, 0.92), vec3f(0.80, 0.96, 1.0), ren.colorMix);
  hot = mix(hot, vec3f(1.0, 0.90, 0.75), ren.warm * 0.7);

  let inner = clamp(1.0 - in.radial, 0.0, 1.0);
  let col = mix(base, hot, inner * inner * 0.5);

  let depthFade = 1.0 / (1.0 + max(in.depth - 3.0, 0.0) * 0.7);
  // Soft global throb synced with the simulation ripple.
  let throb = 1.0 + ren.pulse * 0.30 * sin(ren.time * 3.2 - in.radial * 6.0);
  let intensity = (core + glow) * in.energy * ren.brightness * depthFade * throb;

  return vec4f(col * intensity, intensity);
}
`

export const JARVIS_COMPOSITE = /* wgsl */ `
struct CompositeUniforms {
  resolution: vec2f,
  time: f32,
  colorMix: f32,
  energy: f32,
  pad0: f32,
  pad1: f32,
  pad2: f32,
};

@group(0) @binding(0) var<uniform> comp: CompositeUniforms;
@group(0) @binding(1) var sceneTex: texture_2d<f32>;
@group(0) @binding(2) var sceneSampler: sampler;

@vertex
fn vs_fullscreen(@builtin(vertex_index) vi: u32) -> @builtin(position) vec4f {
  var positions = array<vec2f, 3>(
    vec2f(-1.0, -1.0),
    vec2f(3.0, -1.0),
    vec2f(-1.0, 3.0),
  );
  return vec4f(positions[vi], 0.0, 1.0);
}

@fragment
fn fs_composite(@builtin(position) frag: vec4f) -> @location(0) vec4f {
  let sc = frag.xy / comp.resolution;
  var uv = (frag.xy * 2.0 - comp.resolution) / comp.resolution.y;
  uv.y = -uv.y;

  var col = textureSampleLevel(sceneTex, sceneSampler, sc, 0.0).rgb;
  col = vec3f(1.0) - exp(-col * 1.25);

  let rr = length(uv);

  // Soft subtle vignetting around the edges
  col *= 1.0 - 0.28 * smoothstep(0.5, 1.5, rr);

  return vec4f(col, 1.0);
}
`
