// Item Grant Effect WGSL Shader
export const itemGrantEffectShader = `
struct Uniforms {
  time: f32,
  resolution: vec2<f32>,
  color: vec3<f32>,
  intensity: f32,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

struct VertexOutput {
  @builtin(position) position: vec4<f32>,
  @location(0) texCoord: vec2<f32>,
}

@vertex
fn vertexMain(@location(0) pos: vec2<f32>) -> VertexOutput {
  var output: VertexOutput;
  output.position = vec4<f32>(pos, 0.0, 1.0);
  output.texCoord = vec2<f32>(pos.x * 0.5 + 0.5, 1.0 - (pos.y * 0.5 + 0.5));
  return output;
}

// Noise function
fn random(st: vec2<f32>) -> f32 {
  return fract(sin(dot(st, vec2<f32>(12.9898, 78.233))) * 43758.5453123);
}

// Radial rays - for legendary/relic    
fn rays(uv: vec2<f32>, time: f32, intensity: f32) -> f32 {
  let centered = uv - vec2<f32>(0.5, 0.30);
  let angle = atan2(centered.y, centered.x);
  let radius = length(centered);
  
  let rayCount = 16.0 + intensity * 8.0;
  var raysField = 0.0;
  
  for(var i = 0.0; i < rayCount; i += 1.0) {
    let rayAngle = (i / rayCount) * 6.28318;
    let rayLength = 0.3 + random(vec2<f32>(i, 0.0)) * 0.15;
    let rayWidth = 0.02 + random(vec2<f32>(i, 1.0)) * 0.03;
    let rayBrightness = 0.5 + random(vec2<f32>(i, 2.0)) * 0.5;
    let rayPulse = 0.6 + 0.4 * sin(time * (1.0 + random(vec2<f32>(i, 3.0)) * 2.0) + i);
    let angleDiff = abs((angle - rayAngle + 3.14159) % 6.28318 - 3.14159);
    
    var rayIntensity = smoothstep(rayWidth, 0.0, angleDiff);
    rayIntensity *= smoothstep(rayLength, 0.0, radius);
    rayIntensity *= smoothstep(0.0, 0.08, radius);
    rayIntensity *= rayBrightness * rayPulse;
    
    raysField += rayIntensity;
  }
  
  return raysField * 0.8;
}

// Particles - for all
fn particles(uv: vec2<f32>, time: f32) -> f32 {
  var particleField = 0.0;
  
  for(var i = 0.0; i < 40.0; i += 1.0) {
    let particlePos = vec2<f32>(
      random(vec2<f32>(i, 0.0)),
      (random(vec2<f32>(i, 1.0)) + time * 0.08 * (1.0 + random(vec2<f32>(i, 2.0)) * 0.5)) % 1.0
    );
    
    let dist = distance(uv, particlePos);
    let particleSize = 0.002 + random(vec2<f32>(i, 3.0)) * 0.004;
    let brightness = 0.5 + random(vec2<f32>(i, 4.0)) * 0.6;
    particleField += smoothstep(particleSize, 0.0, dist) * brightness;
  }
  
  return particleField * 0.8;
}

// Spiral - for epic+
fn spiral(uv: vec2<f32>, time: f32) -> f32 {
  let centered = uv - vec2<f32>(0.5, 0.30);
  let angle = atan2(centered.y, centered.x);
  let radius = length(centered);
  
  var spiralPattern = sin(radius * 15.0 - angle * 3.0 - time * 2.0);
  spiralPattern *= smoothstep(0.35, 0.0, radius);
  spiralPattern *= smoothstep(0.0, 0.08, radius);
  
  return spiralPattern * 0.5;
}

// Lightning - for legendary+
fn lightning(uv: vec2<f32>, time: f32) -> f32 {
  let centered = uv - vec2<f32>(0.5, 0.30);
  let angle = atan2(centered.y, centered.x);
  let radius = length(centered);
  
  var bolt = 0.0;
  for(var i = 0.0; i < 6.0; i += 1.0) {
    let boltAngle = time * 3.0 + i * 1.047;
    let angleDiff = abs((angle - boltAngle + 3.14159) % 6.28318 - 3.14159);
    
    bolt += smoothstep(0.06, 0.0, angleDiff) * smoothstep(0.35, 0.08, radius) * 
            (0.5 + 0.5 * sin(time * 5.0 + i));
  }
  
  return bolt * 0.6;
}

// Rings - for rare+
fn rings(uv: vec2<f32>, time: f32) -> f32 {
  let centered = uv - vec2<f32>(0.5, 0.30);
  let radius = length(centered);
  
  var ring = 0.0;
  for(var i = 0.0; i < 3.0; i += 1.0) {
    let ringRadius = ((time * 0.15 + i * 0.33) % 1.0) * 0.35;
    let ringDist = abs(radius - ringRadius);
    ring += smoothstep(0.025, 0.0, ringDist) * (1.0 - ringRadius * 2.0);
  }
  
  return ring * 0.4;
}

// Center glow - for all
fn centerGlow(uv: vec2<f32>, time: f32) -> f32 {
  let centered = uv - vec2<f32>(0.5, 0.30);
  let radius = length(centered);
  
  let glow = exp(-radius * 4.0) * (0.6 + sin(time * 2.0) * 0.3);
  return glow;
}

// Energy wisps - for relic
fn wisps(uv: vec2<f32>, time: f32) -> f32 {
  var wispField = 0.0;
  
  for(var i = 0.0; i < 5.0; i += 1.0) {
    let wispTime = time * 0.5 + i * 1.256;
    let wispPos = vec2<f32>(0.5, 0.30) + vec2<f32>(
      sin(wispTime) * 0.2,
      cos(wispTime * 1.3) * 0.15
    );
    
    let dist = distance(uv, wispPos);
    wispField += smoothstep(0.04, 0.0, dist) * (0.5 + 0.5 * sin(time * 2.0 + i));
  }
  
  return wispField * 0.5;
}

// Vortex particles - cyclone effect for epic+
fn vortex(uv: vec2<f32>, time: f32) -> f32 {
  let centered = uv - vec2<f32>(0.5, 0.30);
  let angle = atan2(centered.y, centered.x);
  let radius = length(centered);
  
  var vortexField = 0.0;
  
  // Spiral bands
  for(var i = 0.0; i < 3.0; i += 1.0) {
    let spiralAngle = angle + radius * 8.0 - time * 2.0 + i * 2.094;
    var spiralIntensity = sin(spiralAngle * 2.0) * 0.5 + 0.5;
    spiralIntensity *= smoothstep(0.35, 0.0, radius);
    spiralIntensity *= smoothstep(0.0, 0.05, radius);
    vortexField += spiralIntensity * 0.3;
  }
  
  // Rotating particles
  for(var i = 0.0; i < 80.0; i += 1.0) {
    let randomSpeed = 0.8 + random(vec2<f32>(i, 0.0)) * 0.8;
    let randomOffset = random(vec2<f32>(i, 1.0)) * 6.28318;
    let randomRadiusSpeed = 0.2 + random(vec2<f32>(i, 2.0)) * 0.3;
    
    let particleAngle = time * 1.2 * randomSpeed + i * 0.0785 + randomOffset;
    let particleRadius = 0.03 + ((i * 0.0125 + time * randomRadiusSpeed) % 0.32);
    
    let particlePos = vec2<f32>(0.5, 0.30) + vec2<f32>(
      cos(particleAngle) * particleRadius,
      sin(particleAngle) * particleRadius
    );
    
    let dist = distance(uv, particlePos);
    let particleSize = 0.008 + random(vec2<f32>(i, 3.0)) * 0.006;
    let luminosity = 0.4 + random(vec2<f32>(i, 4.0)) * 0.7;
    let pulse = 0.5 + 0.5 * sin(time * (2.0 + random(vec2<f32>(i, 5.0)) * 3.0) + i);
    
    vortexField += smoothstep(particleSize, 0.0, dist) * luminosity * pulse;
  }
  
  return vortexField;
}

@fragment
fn fragmentMain(input: VertexOutput) -> @location(0) vec4<f32> {
  let uv = input.texCoord;
  var totalIntensity = 0.0;
  
  // Base effects for all - enhanced
  totalIntensity += centerGlow(uv, uniforms.time) * 1.2;
  totalIntensity += particles(uv, uniforms.time) * 2.0;
  
  // Different effects based on intensity (rarity)
  if(uniforms.intensity > 0.4) { // rare+
    totalIntensity += rings(uv, uniforms.time) * uniforms.intensity * 2.0;
  }
  
  if(uniforms.intensity > 0.7) { // epic+
    totalIntensity += spiral(uv, uniforms.time) * uniforms.intensity * 1.5;
    totalIntensity += vortex(uv, uniforms.time) * uniforms.intensity * 1.2;
  }
  
  if(uniforms.intensity > 1.0) { // legendary+
    totalIntensity += rays(uv, uniforms.time, uniforms.intensity) * uniforms.intensity * 2.0;
    totalIntensity += lightning(uv, uniforms.time) * uniforms.intensity * 1.5;
  }
  
  if(uniforms.intensity > 1.3) { // relic
    totalIntensity += wisps(uv, uniforms.time) * uniforms.intensity * 1.5;
  }
  
  var finalColor = uniforms.color * totalIntensity;
  
  // Bloom
  let bloom = smoothstep(0.4, 1.0, totalIntensity) * 0.4;
  finalColor += vec3<f32>(bloom) * uniforms.color;
  
  // Fade in
  let fadeIn = smoothstep(0.0, 0.5, uniforms.time);
  
  return vec4<f32>(finalColor * fadeIn, totalIntensity * fadeIn * 0.85);
}
`
