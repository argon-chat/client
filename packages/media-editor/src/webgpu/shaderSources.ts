export const vertexShaderSource = /* wgsl */`
struct Params {
  rotation_angle: f32,
  zoom: f32,
  mirror: vec2f,
  source_dimensions: vec2f,
  viewport: vec2f,
  offset: vec2f,
  // per-effect intensities (aligned to 16 bytes)
  enhance: f32,
  saturation: f32,
  brightness: f32,
  contrast: f32,
  warmth: f32,
  fade: f32,
  shadows: f32,
  highlights: f32,
  vignette: f32,
  grain: f32,
  sharpen: f32,
  _padding: f32,
}

struct VSOutput {
  @builtin(position) clip_pos: vec4f,
  @location(0) uv: vec2f,
}

@group(0) @binding(0) var<uniform> p: Params;

@vertex
fn vs_main(@location(0) pos_in: vec2f, @location(1) uv_in: vec2f) -> VSOutput {
  var pos = pos_in;

  // Move origin to image center
  pos -= p.source_dimensions * 0.5;

  // Apply mirror and zoom
  pos = pos * p.mirror * p.zoom;

  // Rotation
  let sin_a = sin(p.rotation_angle);
  let cos_a = cos(p.rotation_angle);
  pos = vec2f(pos.x * cos_a + pos.y * sin_a, pos.y * cos_a - pos.x * sin_a);

  // Recenter in viewport
  pos += p.viewport * 0.5;

  // Normalize to clip space [-1, 1]
  pos = ((pos + p.offset) / p.viewport) * 2.0 - 1.0;
  pos.y = -pos.y; // WebGPU Y-up

  var output: VSOutput;
  output.clip_pos = vec4f(pos, 0.0, 1.0);
  output.uv = uv_in;
  return output;
}
`;

export const fragmentShaderSource = /* wgsl */`
struct Params {
  rotation_angle: f32,
  zoom: f32,
  mirror: vec2f,
  source_dimensions: vec2f,
  viewport: vec2f,
  offset: vec2f,
  enhance: f32,
  saturation: f32,
  brightness: f32,
  contrast: f32,
  warmth: f32,
  fade: f32,
  shadows: f32,
  highlights: f32,
  vignette: f32,
  grain: f32,
  sharpen: f32,
  _padding: f32,
}

@group(0) @binding(0) var<uniform> p: Params;
@group(0) @binding(1) var src_texture: texture_2d<f32>;
@group(0) @binding(2) var src_sampler: sampler;

// ─── Constants ─────────────────────────────────────────────────────
const LUMA_WEIGHTS: vec3f = vec3f(0.2126, 0.7152, 0.0722);
const HS_BLEND_WEIGHT: vec3f = vec3f(0.3, 0.3, 0.3);
const NOISE_CELL: f32 = 1.0 / 256.0;
const NOISE_CELL_HALF: f32 = 0.5 / 256.0;
const GRAIN_SCALE: f32 = 2.3;

// ─── Color space helpers ───────────────────────────────────────────

fn to_yuv(rgb: vec3f) -> vec3f {
  let y = 0.299 * rgb.r + 0.587 * rgb.g + 0.114 * rgb.b;
  return vec3f(y, 0.493 * (rgb.b - y), 0.877 * (rgb.r - y));
}

fn from_yuv(yuv: vec3f) -> vec3f {
  return vec3f(
    yuv.x + yuv.z / 0.877,
    yuv.x - 0.39393 * yuv.y - 0.58081 * yuv.z,
    yuv.x + yuv.y / 0.493
  );
}

fn luminance(c: vec3f) -> f32 {
  return dot(c, LUMA_WEIGHTS);
}

// ─── Noise utilities ───────────────────────────────────────────────

fn sigmoid_ease(x_in: f32, steepness: f32) -> f32 {
  let x = clamp(x_in, 0.0, 1.0);
  return 1.0 / (1.0 + exp(-steepness * (x - 0.5)));
}

fn hash_noise(tc: vec2f) -> vec4f {
  let n = sin(dot(tc, vec2f(12.9898, 78.233))) * 43758.5453;
  return vec4f(
    fract(n) * 2.0 - 1.0,
    fract(n * 1.2154) * 2.0 - 1.0,
    fract(n * 1.3453) * 2.0 - 1.0,
    fract(n * 1.3647) * 2.0 - 1.0,
  );
}

fn quintic(t: f32) -> f32 {
  return t * t * t * (t * (t * 6.0 - 15.0) + 10.0);
}

fn perlin3d(coord: vec3f) -> f32 {
  let gi = NOISE_CELL * floor(coord) + NOISE_CELL_HALF;
  let gf = fract(coord);

  let p00 = hash_noise(gi.xy).a;
  let g000 = hash_noise(vec2f(p00, gi.z)).rgb * 4.0 - 1.0;
  let d000 = dot(g000, gf);
  let g001 = hash_noise(vec2f(p00, gi.z + NOISE_CELL)).rgb * 4.0 - 1.0;
  let d001 = dot(g001, gf - vec3f(0.0, 0.0, 1.0));

  let p01 = hash_noise(gi.xy + vec2f(0.0, NOISE_CELL)).a;
  let g010 = hash_noise(vec2f(p01, gi.z)).rgb * 4.0 - 1.0;
  let d010 = dot(g010, gf - vec3f(0.0, 1.0, 0.0));
  let g011 = hash_noise(vec2f(p01, gi.z + NOISE_CELL)).rgb * 4.0 - 1.0;
  let d011 = dot(g011, gf - vec3f(0.0, 1.0, 1.0));

  let p10 = hash_noise(gi.xy + vec2f(NOISE_CELL, 0.0)).a;
  let g100 = hash_noise(vec2f(p10, gi.z)).rgb * 4.0 - 1.0;
  let d100 = dot(g100, gf - vec3f(1.0, 0.0, 0.0));
  let g101 = hash_noise(vec2f(p10, gi.z + NOISE_CELL)).rgb * 4.0 - 1.0;
  let d101 = dot(g101, gf - vec3f(1.0, 0.0, 1.0));

  let p11 = hash_noise(gi.xy + vec2f(NOISE_CELL, NOISE_CELL)).a;
  let g110 = hash_noise(vec2f(p11, gi.z)).rgb * 4.0 - 1.0;
  let d110 = dot(g110, gf - vec3f(1.0, 1.0, 0.0));
  let g111 = hash_noise(vec2f(p11, gi.z + NOISE_CELL)).rgb * 4.0 - 1.0;
  let d111 = dot(g111, gf - vec3f(1.0, 1.0, 1.0));

  let blend_x = mix(vec4f(d000, d001, d010, d011), vec4f(d100, d101, d110, d111), quintic(gf.x));
  let blend_xy = mix(blend_x.xy, blend_x.zw, quintic(gf.y));
  return mix(blend_xy.x, blend_xy.y, quintic(gf.z));
}

fn rotate_uv(uv: vec2f, angle: f32) -> vec2f {
  let centered = uv * 2.0 - 1.0;
  let ca = cos(angle); let sa = sin(angle);
  return vec2f(centered.x * ca - centered.y * sa, centered.y * ca + centered.x * sa) * 0.5 + 0.5;
}

// ─── Adjustment passes ─────────────────────────────────────────────

fn brightness_pass(color: vec4f, intensity: f32) -> vec4f {
  let mag = intensity * 1.045;
  let power = select(1.0 + abs(mag), 1.0 / (1.0 + abs(mag)), mag < 0.0);
  let adjusted = vec3f(
    1.0 - pow(1.0 - color.r + 1e-4, power),
    1.0 - pow(1.0 - color.g + 1e-4, power),
    1.0 - pow(1.0 - color.b + 1e-4, power),
  );
  return vec4f(clamp(adjusted, vec3f(0.0), vec3f(1.0)), color.a);
}

fn contrast_pass(color: vec4f, intensity: f32) -> vec4f {
  let k = intensity * 0.3;
  return vec4f(clamp(0.5 + (1.0 + k) * (color.rgb - 0.5), vec3f(0.0), vec3f(1.0)), color.a);
}

fn saturation_pass(color: vec4f, intensity: f32) -> vec4f {
  let gray = vec3f(luminance(color.rgb));
  return vec4f(mix(gray, color.rgb, 1.0 + intensity), color.a);
}

fn warmth_pass(color: vec4f, intensity: f32) -> vec4f {
  let shift = select(-vec3f(0.0588, 0.1569, -0.1255), vec3f(0.1765, -0.1255, 0.0902), intensity > 0.0);
  var yuv = to_yuv(color.rgb);
  let curve = sin(yuv.r * 3.14159);
  yuv += 0.375 * intensity * curve * shift;
  return vec4f(clamp(from_yuv(yuv), vec3f(0.0), vec3f(1.0)), color.a);
}

fn fade_pass(color: vec4f, intensity: f32) -> vec4f {
  let c1 = vec3f(-0.9772); let c2 = vec3f(1.708);
  let c3 = vec3f(-0.1603); let c4 = vec3f(0.2878);
  let curve = c1 * pow(color.rgb, vec3f(3.0)) + c2 * pow(color.rgb, vec3f(2.0)) + c3 * color.rgb + c4;
  let faded = color.rgb + (curve - color.rgb) * 0.9;
  return vec4f(mix(color.rgb, faded, intensity), color.a);
}

fn highlights_shadows_pass(color: vec4f, hi: f32, sh: f32) -> vec4f {
  let lum = dot(color.rgb, HS_BLEND_WEIGHT);

  let shadow_adj = clamp(
    (pow(lum, 1.0 / sh) + (-0.76) * pow(lum, 2.0 / sh)) - lum, 0.0, 1.0
  );
  let highlight_adj = clamp(
    (1.0 - (pow(1.0 - lum, 1.0 / (2.0 - hi)) + (-0.8) * pow(1.0 - lum, 2.0 / (2.0 - hi)))) - lum, -1.0, 0.0
  );
  var result = (lum + shadow_adj + highlight_adj) * (color.rgb / (lum + 1e-6));

  let contrast_lum = (lum - 0.5) * 1.5 + 0.5;
  let white_blend = contrast_lum * contrast_lum * contrast_lum;
  result = mix(result, vec3f(1.0), clamp(white_blend * (clamp(hi, 1.0, 2.0) - 1.0), 0.0, 1.0));

  let dark_blend = pow(1.0 - contrast_lum, 3.0);
  result = mix(result, vec3f(0.0), clamp(dark_blend * (1.0 - clamp(sh, 0.0, 1.0)), 0.0, 1.0));

  return vec4f(result, color.a);
}

fn vignette_pass(color: vec4f, intensity: f32, uv: vec2f) -> vec4f {
  let dist = length(uv - 0.5) / sqrt(0.5);
  let falloff = sigmoid_ease(dist * 0.7, 0.62) * intensity * 0.645;
  let darkened = mix(pow(color.rgb, vec3f(1.0 / (1.0 - falloff))), vec3f(0.0), falloff * falloff);
  return vec4f(darkened, color.a);
}

fn grain_pass(color: vec4f, intensity: f32, uv: vec2f) -> vec4f {
  if (intensity < 0.001) { return color; }
  let rotated = rotate_uv(uv, 1.425);
  let noise_val = vec3f(perlin3d(vec3f(rotated * p.source_dimensions / GRAIN_SCALE, 0.0)));
  let lum = smoothstep(0.2, 0.0, dot(color.rgb, vec3f(0.299, 0.587, 0.114))) + dot(color.rgb, vec3f(0.299, 0.587, 0.114));
  let masked = mix(noise_val, vec3f(0.0), pow(lum, 4.0));
  return vec4f(color.rgb + masked * intensity, color.a);
}

fn sharpen_pass(intensity: f32, uv: vec2f) -> vec4f {
  let texel = 1.0 / p.viewport;
  let d = texel * 1.5;
  let s_a = textureSample(src_texture, src_sampler, uv + vec2f(-d.x, -d.y)).rgb;
  let s_b = textureSample(src_texture, src_sampler, uv + vec2f( d.x, -d.y)).rgb;
  let s_c = textureSample(src_texture, src_sampler, uv + vec2f(-d.x,  d.y)).rgb;
  let s_d = textureSample(src_texture, src_sampler, uv + vec2f( d.x,  d.y)).rgb;
  let neighbors = intensity * (s_a + s_b + s_c + s_d);
  let center = textureSample(src_texture, src_sampler, uv);
  return vec4f(clamp(center.rgb * (1.0 + 4.0 * intensity) - neighbors, vec3f(0.0), vec3f(1.0)), center.a);
}

// ─── Main fragment entry ───────────────────────────────────────────

@fragment
fn fs_main(@location(0) uv: vec2f) -> @location(0) vec4f {
  var c = sharpen_pass(p.sharpen * 0.45 + p.enhance * 0.15, uv);
  c = grain_pass(c, p.grain * 0.04, uv);
  c = saturation_pass(c, p.saturation + p.enhance * 0.2);
  c = warmth_pass(c, p.warmth);
  c = fade_pass(c, p.fade);
  c = highlights_shadows_pass(c, (p.highlights + p.enhance * 0.15) * 0.75 + 1.0, (p.shadows - p.enhance * 0.075) * 0.55 + 1.0);
  c = contrast_pass(c, p.contrast + p.enhance * 0.1);
  c = brightness_pass(c, p.brightness + p.enhance * 0.25);
  c = vignette_pass(c, p.vignette, uv);
  return c;
}
`;
