import { ref, onMounted, onBeforeUnmount, type Ref } from "vue";

interface WebGLBackgroundOptions {
  fragmentShaderSource: string;
}

export function useWebGLBackground(canvas: Ref<HTMLCanvasElement | null>, options: WebGLBackgroundOptions) {
  let gl: WebGLRenderingContext | null = null;
  let program: WebGLProgram | null = null;
  let animationFrameId: number;
  let startTime: number;
  let u_timeLocation: WebGLUniformLocation | null = null;
  let u_resolutionLocation: WebGLUniformLocation | null = null;

  const vertexShaderSource = `
    attribute vec4 a_position;
    attribute vec2 a_texCoord;
    varying vec2 v_texCoord;

    void main() {
      gl_Position = a_position;
      v_texCoord = a_texCoord;
    }
  `;

  function createShader(
    gl: WebGLRenderingContext,
    type: number,
    source: string
  ): WebGLShader | null {
    const shader = gl.createShader(type);
    if (!shader) {
      console.error("Failed to create shader");
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
  }

  function createProgram(
    gl: WebGLRenderingContext,
    vertexShader: WebGLShader,
    fragmentShader: WebGLShader
  ): WebGLProgram | null {
    const program = gl.createProgram();
    if (!program) {
      console.error("Failed to create program");
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
  }

  function onResize() {
    const width = canvas.value?.parentElement?.offsetWidth ?? 0;
    if (canvas.value) {
      canvas.value.width = width;
      canvas.value.height = width;
    }
  }

  function initWebGL() {
    if (!canvas.value) return;
    const canvasElement = canvas.value;
    onResize();

    gl = canvasElement.getContext("webgl");

    if (!gl) {
      console.error("WebGL is not supported");
      return;
    }

    const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexShaderSource);
    const fragmentShader = createShader(
      gl,
      gl.FRAGMENT_SHADER,
      options.fragmentShaderSource
    );

    if (!vertexShader || !fragmentShader) {
      console.error("Failed to create shaders");
      return;
    }

    program = createProgram(gl, vertexShader, fragmentShader);

    if (!program) {
      console.error("Failed to create shader program");
      return;
    }

    const positionLocation = gl.getAttribLocation(program, "a_position");
    const texCoordLocation = gl.getAttribLocation(program, "a_texCoord");
    u_timeLocation = gl.getUniformLocation(program, "u_time");
    u_resolutionLocation = gl.getUniformLocation(program, "u_resolution");

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

    gl.useProgram(program);

    gl.enableVertexAttribArray(positionLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, positionBuffer);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, 0, 0);

    gl.enableVertexAttribArray(texCoordLocation);
    gl.bindBuffer(gl.ARRAY_BUFFER, texCoordBuffer);
    gl.vertexAttribPointer(texCoordLocation, 2, gl.FLOAT, false, 0, 0);
  }

  function render() {
    if (!gl || !program || !canvas.value) return;
    const canvasElement = canvas.value;
    const time = (performance.now() - startTime) / 1000.0;

    gl.viewport(0, 0, canvasElement.width, canvasElement.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.uniform1f(u_timeLocation, time);
    gl.uniform2f(u_resolutionLocation, canvasElement.width, canvasElement.height);

    gl.drawArrays(gl.TRIANGLES, 0, 6);

    animationFrameId = requestAnimationFrame(render);
  }

  function start() {
    initWebGL();
    startTime = performance.now();
    render();
    window.addEventListener("resize", onResize);
  }

  function stop() {
    cancelAnimationFrame(animationFrameId);
    window.removeEventListener("resize", onResize);
  }

  return {
    start,
    stop,
  };
}
