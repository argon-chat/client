<template>
  <div style="width: 100%; height: 100%; background-color: black; position: absolute; aspect-ratio: 1 / 1;">

    <canvas ref="canvas"></canvas>

    <div class="flex items-center justify-center h-screen">
      <div class="text-center">
        <h1 v-motion-fade-visible :duration="2200" class="text-8xl font-bold mb-4 select-none"
          style="font-size: 15rem;">
          Argon
        </h1>
      </div>
    </div>
    <div class="fixed bottom-10 left-10 z-20 mt-auto">
      <blockquote class="space-y-2">
        <p class="text-lg">
          &ldquo;{{ randomQuote.text }}.&rdquo;
        </p>
        <footer class="text-sm">
          {{ randomQuote.author }}
        </footer>
      </blockquote>
    </div>
    <div class="fixed top-4 right-4 w-96 bg-gray-900 text-white p-4 rounded-lg shadow-lg overflow-y-auto max-h-64"
      v-if="logs.length > 0">
      <div v-for="(log, index) in logs" :key="index" :class="log.type === 'error' ? 'text-red-400' : 'text-green-400'">
        [{{ log.time }}] {{ log.message }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import router from "@/router";
import { useAppState } from "@/store/appState";
import { ref, onMounted, onBeforeUnmount } from "vue";
import { logger } from "@/lib/logger";
import { usePoolStore } from "@/store/poolStore";
import { useSystemStore } from "@/store/systemStore";
const sys = useSystemStore();
const terminalContainer = ref(null);
const app = useAppState();
const logs = ref([] as any[]);
const canvas = ref<HTMLCanvasElement | null>(null);
let gl: WebGLRenderingContext | null = null;
let program: WebGLProgram | null = null;
let animationFrameId: number;
let startTime: number;
let u_timeLocation: WebGLUniformLocation | null = null;
let u_resolutionLocation: WebGLUniformLocation | null = null;

const quotes = [
  { text: "у меня на локалке все работает", author: "Юки" },
  { text: "Если намочить руку — то она будет мокрая.", author: "Арам" },
  {
    text: "А клыки нам даны, чтобы ... кору деревьев отгрызать?",
    author: "Miniature",
  },
  {
    text: "СЫН БЛЯДИ КОНЧЕННЫЙ УЕБОК Я ПО НОРМАЛЬНОМУ СПРОСИЛ БЛЯТЬ",
    author: "Беляш",
  },
  { text: "Блядь, ёбанный Юки", author: "Мурзилка" },
  { text: "Ненавижу блять солнце", author: "Юки" },
];
const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

function logMessage(message: string, type: "info" | "error") {
  logs.value.push({
    message,
    type,
    time: new Date().toLocaleTimeString(),
  } as any);
}

const initWebGL = () => {
  if (!canvas.value) return;
  const canvasElement = canvas.value;
  onResize();

  gl = canvasElement.getContext("webgl");

  if (!gl) {
    console.error("WebGL не поддерживается");
    return;
  }

  const vertexShaderSource = `
      attribute vec4 a_position;
      attribute vec2 a_texCoord;
      varying vec2 v_texCoord;
  
      void main() {
        gl_Position = a_position;
        v_texCoord = a_texCoord;
      }
    `;
  function getRandomFloat(min: number, max: number, decimals: number) {
    const str = (Math.random() * (max - min) + min).toFixed(decimals);

    return str;
  }

  const polyU = getRandomFloat(0, 15, 2);
  const polyV = getRandomFloat(0, 15, 2);
  const polyW = getRandomFloat(0, 15, 2);
  const ts = getRandomFloat(3, 5, 0);
  const mb = getRandomFloat(6, 12, 0);
  const tc = getRandomFloat(0.0005, 0.8005, 4);
  const no = getRandomFloat(0.115, 0.923, 4);
  const no3 = getRandomFloat(0.005, 0.205, 4);
  const Y1 = getRandomFloat(0, 1, 4);
  const Y2 = getRandomFloat(0, 1, 4);
  const Y3 = getRandomFloat(0, 1, 4);
  const CA = getRandomFloat(1, 5, 4);
  const R3 = getRandomFloat(0.1, 1, 4);
  const erd = getRandomFloat(1.0, 1.2, 2);
  const few = getRandomFloat(2.0, 8.0, 2);

  const fragmentShaderSource = `
precision highp float;
varying vec2 v_texCoord;
uniform float u_time;
uniform vec2 u_resolution;

const float rotation_speed= 0.15;

const float poly_U        = ${polyU};   // [0, inf]
const float poly_V        = ${polyV};  // [0, inf]
const float poly_W        = ${polyW};  // [0, inf]
const int   poly_type     = ${ts};    // [2, 5]
const float poly_zoom     = 2.0;

const float inner_sphere  = 1.;

const float refr_index    = 1.0;

const int MAX_BOUNCES2        = ${mb};

#define TIME        u_time
#define RESOLUTION  u_resolution
#define PI          3.141592654
#define TAU         (2.0*PI)

const vec4 hsv2rgb_K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
vec3 hsv2rgb(vec3 c) {
  vec3 p = abs(fract(c.xxx + hsv2rgb_K.xyz) * 6.0 - hsv2rgb_K.www);
  return c.z * mix(hsv2rgb_K.xxx, clamp(p - hsv2rgb_K.xxx, 0.0, 1.0), c.y);
}
#define HSV2RGB(c)  (c.z * mix(hsv2rgb_K.xxx, clamp(abs(fract(c.xxx + hsv2rgb_K.xyz) * 16.0 - hsv2rgb_K.www) - hsv2rgb_K.xxx, 0.0, 1.0), c.y))

// изменяет форму линзы
const float TOLERANCE2          = ${tc};
const int MAX_RAY_MARCHES2    = 11; 
// изменяет форму линзы
const float NORM_OFF2           = ${no};
#define BACKSTEP2

const float TOLERANCE3          = 0.0005;
const float MAX_RAY_LENGTH3     = 15.0;
const int MAX_RAY_MARCHES3    = 90;
const float NORM_OFF3           = ${no3};

const vec3 rayOrigin    = vec3(.0, 1., -5.);
const vec3 sunDir       = normalize(-rayOrigin);

const vec3 sunCol       = HSV2RGB(vec3(1.0, 0.0, 0.0))*1.;
const vec3 bottomBoxCol = HSV2RGB(vec3(1.0, 0.00, 0.1))*1.;
const vec3 topBoxCol    = HSV2RGB(vec3(0.0, 0.0, 0.0))*1.;
const vec3 glowCol0     = HSV2RGB(vec3(0.05 , 0.7, 1E-3))*1.;
const vec3 glowCol1     = HSV2RGB(vec3(0.15, 0.27, 1E-3))*1.;
const vec3 beerCol      = -HSV2RGB(vec3(0.15+0.5, 0.7, 2.)); 
const float rrefr_index = 1./refr_index;
   
const float poly_cospin   = cos((PI*${erd})/float(poly_type));
const float poly_scospin  = sqrt(0.75-poly_cospin*poly_cospin);
const vec3  poly_nc       = vec3(-0.5, -poly_cospin, poly_scospin);
const vec3  poly_pab      = vec3(0., 0., 1.);
const vec3  poly_pbc_     = vec3(poly_scospin, 0., 0.5);
const vec3  poly_pca_     = vec3(0., poly_scospin, poly_cospin);
const vec3  poly_p        = normalize((poly_U*poly_pab+poly_V*poly_pbc_+poly_W*poly_pca_));
const vec3  poly_pbc      = normalize(poly_pbc_);
const vec3  poly_pca      = normalize(poly_pca_);

mat3 g_rot;
vec2 g_gd;
  
mat3 rot_mat(vec3 d, vec3 z) {
  vec3  v = cross( z, d );
  float c = dot( z, d );
  float k = 1.0/(1.0+c);

  return mat3( v.x*v.x*k + c,     v.y*v.x*k - v.z,    v.z*v.x*k + v.y,
               v.x*v.y*k + v.z,   v.y*v.y*k + c,      v.z*v.y*k - v.x,
               v.x*v.z*k - v.y,   v.y*v.z*k + v.x,    v.z*v.z*k + c    );
}
vec3 aces_approx(vec3 v) {
  v = max(v, 0.0);
  v *= 1.6;
  float a = 2.51;
  float b = 0.03;
  float c = 2.43;
  float d = 0.59;
  float e = 0.14;
  return clamp((v*(a*v+b))/(v*(c*v+d)+e), 0.0, 1.0);
}

float sphere(vec3 p, float r) {
  return length(p) - r;
}
float box(vec2 p, vec2 b) {
  vec2 d = abs(p)-b;
  return length(max(d,0.0)) + min(max(d.x,d.y),0.0);
}
void poly_fold(inout vec3 pos) {
  vec3 p = pos;
  for(int x = 0; x < poly_type; ++x){
    p.xy  = abs(p.xy);
    p    -= 2.*min(0., dot(p,poly_nc)) * poly_nc;
  }
  
  pos = p;
}


float poly_plane(vec3 pos) {
  float d0 = dot(pos, poly_pab);
  float d1 = dot(pos, poly_pbc);
  float d2 = dot(pos, poly_pca);
  float d = d0;
  d = max(d, d1);
  d = max(d, d2);
  return d;
}

float poly_corner(vec3 pos) {
  float d = length(pos) - .0125;
  return d;
}

float dot2(vec3 p) {
  return dot(p, p);
}

float poly_edge(vec3 pos) {
  float dla = dot2(pos-min(0., pos.x)*vec3(1., ${Y1}, 0.));
  float dlb = dot2(pos-min(0., pos.y)*vec3(${Y2}, 1., ${Y3}));
  float dlc = dot2(pos-min(0., dot(pos, poly_nc))*poly_nc);
  return sqrt(min(min(dla, dlb), dlc))-2E-3;
}

vec3 shape(vec3 pos) {
  pos *= g_rot;
  pos /= poly_zoom;
  poly_fold(pos);
  pos -= poly_p;

  return vec3(poly_plane(pos), poly_edge(pos), poly_corner(pos))*poly_zoom;
}

vec3 render0(vec3 ro, vec3 rd) {
  vec3 col = vec3(0.0);
  
  float srd  = sign(rd.y);
  float tp   = -(ro.y-6.)/abs(rd.y);

  if (srd < 0.) {
    col += bottomBoxCol*exp(-0.5*(length((ro + tp*rd).xz)));
  }

  if (srd > 0.0) {
    vec3 pos  = ro + tp*rd;
    vec2 pp = pos.xz;
    float db = box(pp, vec2(5.0, 9.0))-3.0;
    
    col += topBoxCol*rd.y*rd.y*smoothstep(0.25, 0.0, db);
    col += 0.2*topBoxCol*exp(-0.5*max(db, 0.0));
    col += 0.05*sqrt(topBoxCol)*max(-db, 0.0);
  }

  col += sunCol/(1.001-dot(sunDir, rd));
  return col; 
}

float df2(vec3 p) {
  vec3 ds = shape(p);
  float d2 = ds.y-5E-3;
  float d0 = min(-ds.x, d2);
  float d1 = sphere(p, inner_sphere);
  g_gd = min(g_gd, vec2(d2, d1));
  float d = (min(d0, d1));
  return d;
}

float rayMarch2(vec3 ro, vec3 rd, float tinit) {
    float t = tinit;
#if defined(BACKSTEP2)
    vec2 dti = vec2(1e10, 0.0);
#endif
    int i;

    for(int x = 0; x < MAX_RAY_MARCHES2; ++x) {
        float d = df2(ro + rd * t);
#if defined(BACKSTEP2)
        if(d < dti.x) {
            dti = vec2(d, t);
        }
#endif  
        if(d > TOLERANCE2) {
            break;
        }
        t += d;
        i = x;
    }
#if defined(BACKSTEP2)
    if(i == MAX_RAY_MARCHES2) {
        t = dti.y;
    };
#endif  
    return t;
}

vec3 normal2(vec3 pos) {
  vec2  eps = vec2(NORM_OFF2,0.01);
  vec3 nor;
  nor.x = df2(pos+eps.xyy) - df2(pos-eps.xyy);
  nor.y = df2(pos+eps.yxy) - df2(pos-eps.yxy);
  nor.z = df2(pos+eps.yyx) - df2(pos-eps.yyx);
  return normalize(nor);
}


vec3 render2(vec3 ro, vec3 rd, float db) {
    vec3 agg = vec3(0.0);
    // изменяет яркость
    float ragg = ${CA};
    float tagg = 0.;

    for(int bounce = 0; bounce < MAX_BOUNCES2; ++bounce) {
        if(ragg < ${R3})
            break; 
        g_gd = vec2(1E3);
        // изменяет линзирование
        float t2 = rayMarch2(ro, rd, min(db + 1.05, 0.3)); 
        vec2 gd2 = g_gd;
        tagg += t2;

        vec3 p2 = ro + rd * t2;
        vec3 n2 = normal2(p2);
        vec3 r2 = reflect(rd, n2);
        vec3 rr2 = refract(rd, n2, rrefr_index);
        float fre2 = 1. + dot(n2, rd);

        vec3 beer = ragg * exp(0.2 * beerCol * tagg);
        agg += glowCol1 * beer * ((1. + tagg * tagg * 4E-2) * ${few} / max(gd2.x, 5E-4 + tagg * tagg * 2E-4 / ragg));
        vec3 ocol = 0.2 * beer * render0(p2, rr2);
        if(gd2.y <= TOLERANCE2) {
            ragg *= 1. - 0.9 * fre2;
        } else {
            agg += ocol;
            ragg *= 0.8;
        }

        ro = p2;
        rd = r2;
        db = gd2.x;
    }

    return agg;
}

float df3(vec3 p) {
  vec3 ds = shape(p);
  g_gd = min(g_gd, ds.yz);
  const float sw = 10.02;
  float d1 = min(ds.y, ds.z)-sw;
  float d0 = ds.x;
  d0 = min(d0, ds.y);
  d0 = min(d0, ds.z);
  return d0;
}

float rayMarch3(vec3 ro, vec3 rd, float tinit, out int iter) {
    float t = tinit;
    int i;
    for(int x = 0; x < MAX_RAY_MARCHES3; ++x) {
        float d = df3(ro + rd * t);
        if(d < TOLERANCE3 || t > MAX_RAY_LENGTH3) {
            break;
        }
        t += d;
        i = x;
    }
    iter = i;
    return t;
}

vec3 normal3(vec3 pos) {
  vec2  eps = vec2(NORM_OFF3,0.0);
  vec3 nor;
  nor.x = df3(pos+eps.xyy) - df3(pos-eps.xyy);
  nor.y = df3(pos+eps.yxy) - df3(pos-eps.yxy);
  nor.z = df3(pos+eps.yyx) - df3(pos-eps.yyx);
  return normalize(nor);
}

vec3 render3(vec3 ro, vec3 rd) {
  int iter;

  vec3 skyCol = render0(ro, rd);
  vec3 col  = skyCol;

  g_gd      = vec2(1E3);
  float t1  = rayMarch3(ro, rd, 0.1, iter);
  vec2 gd1  = g_gd;
  vec3 p1   = ro+t1*rd;
  vec3 n1   = normal3(p1);
  vec3 r1   = reflect(rd, n1);
  vec3 rr1  = refract(rd, n1, refr_index);
  float fre1= 1.+dot(rd, n1);
  fre1 *= fre1;

  float ifo = mix(0.5, 1., smoothstep(1.0, 0.9, float(iter)/float(MAX_RAY_MARCHES3)));

  if (t1 < MAX_RAY_LENGTH3) {
    col = render0(p1, r1)*(0.5+0.5*fre1)*ifo;
    vec3 icol = render2(p1, rr1, gd1.x); 
    if (gd1.x > TOLERANCE3 && gd1.y > TOLERANCE3 && rr1 != vec3(0.)) {
      col += icol*(1.-0.75*fre1)*ifo;
    }
  }

  col += (glowCol0+1.*fre1*(glowCol0))/max(gd1.x, 3E-4);
  return col;

}

vec3 effect(vec2 p, vec2 pp) {
  const float fov = 2.0;
  
  const vec3 up = vec3(0., 1., 0.);
  const vec3 la   = vec3(0.0);

  const vec3 ww = normalize(normalize(la-rayOrigin));
  const vec3 uu = normalize(cross(up, ww));
  const vec3 vv = cross(ww, uu);
  
  vec3 rd = normalize(-p.x*uu + p.y*vv + fov*ww);

  vec3 col = vec3(0.0);
  col = render3(rayOrigin, rd);
  
  col -= 2E-2*vec3(2.,5.,1.)*(length(p)+0.25);
  col = aces_approx(col);
  col = sqrt(col);
  return col;
}

void main() {
  vec2 q = gl_FragCoord.xy/RESOLUTION.xy;
  vec2 p = -1. + 2. * q;
  vec2 pp = p;
  p.x *= RESOLUTION.x/RESOLUTION.y;
  

float a = TIME * rotation_speed * 10.0;                                  
vec3 d = vec3(sin(a), cos(a), 0.0);
vec3 z = vec3(1.0, 1.0, -1.0);
mat3 rot = rot_mat(normalize(d), normalize(z));
g_rot = rot;


  vec3 col = effect(p, pp);
  
  gl_FragColor = vec4(col, 1.0);
}
`;

  // Создаем шейдеры
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
  const fragmentShader = createShader(
    gl,
    gl.FRAGMENT_SHADER,
    fragmentShaderSource,
  );

  if (!vertexShader || !fragmentShader) {
    console.error("Не удалось создать шейдеры");
    return;
  }

  // Создаем программу
  program = createProgram(gl, vertexShader, fragmentShader);

  if (!program) {
    console.error("Не удалось создать программу шейдеров");
    return;
  }

  // Получаем локации атрибутов и униформ
  const positionLocation = gl.getAttribLocation(program, "a_position");
  const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
  u_timeLocation = gl.getUniformLocation(program, "u_time");
  u_resolutionLocation = gl.getUniformLocation(program, "u_resolution");

  // Создаем буферы
  const positionBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  const positions = new Float32Array([
    -1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1,
  ]);
  gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

  const texCoordBuffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  const texCoords = new Float32Array([0, 0, 1, 0, 0, 1, 0, 1, 1, 0, 1, 1]);
  gl.bufferData(gl.ARRAY_BUFFER, texCoords, gl.STATIC_DRAW);

  // Устанавливаем атрибуты
  gl.useProgram(program);

  gl.enableVertexAttribArray(positionLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
  gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

  gl.enableVertexAttribArray(texCoordLocation);
  gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
  gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
};

const createShader = (
  gl: WebGLRenderingContext,
  type: number,
  source: string,
): WebGLShader | null => {
  const shader = gl.createShader(type);
  if (!shader) {
    console.error("Не удалось создать шейдер");
    return null;
  }
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  const success = gl.getShaderParameter(shader, gl.COMPILE_STATUS);
  if (!success) {
    console.error(gl.getShaderInfoLog(shader));
    gl.deleteShader(shader);
    return null;
  }
  return shader;
};

const createProgram = (
  gl: WebGLRenderingContext,
  vertexShader: WebGLShader,
  fragmentShader: WebGLShader,
): WebGLProgram | null => {
  const program = gl.createProgram();
  if (!program) {
    console.error("Не удалось создать программу");
    return null;
  }
  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);

  const success = gl.getProgramParameter(program, gl.LINK_STATUS);
  if (!success) {
    console.error(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  return program;
};

const render = () => {
  if (!gl || !program || !canvas.value) return;
  const canvasElement = canvas.value;
  const time = (performance.now() - startTime) / 1000.0;

  // Устанавливаем viewport
  gl.viewport(0, 0, canvasElement.width, canvasElement.height);

  // Очищаем
  gl.clearColor(0, 0, 0, 1);
  gl.clear(gl.COLOR_BUFFER_BIT);

  // Используем программу
  gl.useProgram(program);

  // Устанавливаем униформы
  gl.uniform1f(u_timeLocation, time);
  gl.uniform2f(u_resolutionLocation, canvasElement.width, canvasElement.height);

  // Рисуем
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  // Запрашиваем следующий кадр
  animationFrameId = requestAnimationFrame(render);
};

const onResize = () => {
  const width = canvas.value?.parentElement?.offsetWidth ?? 0;
  if (canvas.value) {
    canvas.value.width = width;
    canvas.value.height = width;
  }
};

function onInitTerminal() {
  logger.addReporter({
    log: (obj, ctx) => {
      if (obj.type === "error" || obj.type === "fail" || obj.type === "fatal") {
        logMessage(obj.args.join(" "), "error");
      }
    },
  });
}

onMounted(() => {
  onInitTerminal();
  initWebGL();
  startTime = performance.now();
  render();
  window.addEventListener("resize", onResize);

  app.initApp().then(async () => {
    const serverStore = usePoolStore();

    const servers = await serverStore.allServerAsync;

    if (servers.length === 0) {
      router.push({ path: "/create-or-join.pg" });
      return;
    }
    router.push({ path: "/master.pg" });
  });
});

onBeforeUnmount(() => {
  cancelAnimationFrame(animationFrameId);
  window.removeEventListener("resize", onResize);
});
</script>

<style scoped>
canvas {
  position: absolute;
  top: 50%;
  left: 50%;
  width: auto;
  height: 100%;
  aspect-ratio: 1 / 1;
  transform: translate(-50%, -50%);
}
</style>