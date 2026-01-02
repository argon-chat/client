export function generateFragmentShader(): string {
  return `
precision highp float;
varying vec2 v_texCoord;
uniform float u_time;
uniform vec2 u_resolution;

#define T u_time
#define PI 3.1415926
#define TAU 6.283185
#define S smoothstep
#define s1(v) (sin(v)*.5+.5)
const float EPSILON = 1e-3;

// tanh implementation for WebGL 1.0
float tanh(float x) {
  float e2x = exp(2.0 * x);
  return (e2x - 1.0) / (e2x + 1.0);
}

vec3 tanh(vec3 x) {
  return vec3(tanh(x.x), tanh(x.y), tanh(x.z));
}

// 2D rotation matrix
mat2 rot2D(float angle) {
  float c = cos(angle);
  float s = sin(angle);
  return mat2(c, -s, s, c);
}

// HSV to RGB conversion for vibrant colors
vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}

void main() {
  vec2 R = u_resolution.xy;
  vec2 I = gl_FragCoord.xy;
  vec2 uv = (I*2.-R)/R.y;

  // Pulsing zoom effect
  float pulse = 1.0 + sin(T * 2.0) * 0.1;
  uv *= pulse;

  // Rotation effect
  float rotAngle = T * 1.5;
  uv *= rot2D(rotAngle);

  // Jitter effect
  uv += tanh(sin(T*30.)*0.1)*.06 - .03;
  
  // Chromatic aberration offset
  float aberration = 0.002 * sin(T * 3.0);

  vec4 O;
  O.rgb = vec3(0.);
  O.a = 1.;

  vec3 ro = vec3(0.,0.,-10.);
  vec3 rd = normalize(vec3(uv, 1.));
  vec3 rd_r = normalize(vec3(uv + aberration, 1.));
  vec3 rd_b = normalize(vec3(uv - aberration, 1.));

  float z = .1;
  
  vec3 col = vec3(0);
  vec3 col_r = vec3(0);
  vec3 col_b = vec3(0);
  vec3 C = vec3(3,2,1);
  
  // Dynamic color shift over time
  float hueShift = T * 0.1;
  
  for(int i = 0; i < 80; i++){
    vec3 p = ro + rd * z;
    vec3 p_r = ro + rd_r * z;
    vec3 p_b = ro + rd_b * z;
    vec3 q = p;

    p.xy = abs(p.xy);
    p.z += T*3.;
    
    p_r.xy = abs(p_r.xy);
    p_r.z += T*3.;
    
    p_b.xy = abs(p_b.xy);
    p_b.z += T*3.;

    for(float s = 1.;s<4.;s++){
      p.xy += abs(fract(p.yx*s)-.5)/s;
      p_r.xy += abs(fract(p_r.yx*s)-.5)/s;
      p_b.xy += abs(fract(p_b.yx*s)-.5)/s;
    }

    C += dot(cos(p.xz),vec2(.1, .05));

    float d = dot(abs(fract(p*1.2)-.5), vec3(.1));
    float d_r = dot(abs(fract(p_r*1.2)-.5), vec3(.1));
    float d_b = dot(abs(fract(p_b*1.2)-.5), vec3(.1));
    
    d = max(0.01, d);
    d_r = max(0.01, d_r);
    d_b = max(0.01, d_b);

    // Create colorful gradient based on depth and position
    float hue = fract(hueShift + z * 0.05 + length(p.xy) * 0.1);
    vec3 rainbowCol = hsv2rgb(vec3(hue, 0.8, 1.0));
    
    col += rainbowCol * pow(s1(C)*.1/d,vec3(2.));
    col_r.r += pow(s1(C).r*.1/d_r, 2.0) * (0.5 + 0.5 * sin(hueShift));
    col_b.b += pow(s1(C).b*.1/d_b, 2.0) * (0.5 + 0.5 * cos(hueShift));
    
    z += d;
  }

  col = tanh(col / 3e2);
  col_r.r = tanh(col_r.r / 3e2);
  col_b.b = tanh(col_b.b / 3e2);
  
  // Mix chromatic aberration
  col.r = mix(col.r, col_r.r, 0.5);
  col.b = mix(col.b, col_b.b, 0.5);
  
  // Enhance saturation
  float luma = dot(col, vec3(0.299, 0.587, 0.114));
  col = mix(vec3(luma), col, 1.5);
  
  // Add vignette effect
  float vignette = 1.0 - length(uv) * 0.3;
  col *= vignette;
  
  // Add color grading for more vibrant look
  col = pow(col, vec3(0.9));
  col *= 1.2;

  O.rgb = col;
  gl_FragColor = O;
}
`;
}
