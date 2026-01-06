<template>
  <canvas 
    ref="canvasRef" 
    class="absolute inset-0 w-full h-full pointer-events-none"
    :style="{ opacity: isReady ? 1 : 0 }"
  />
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch } from 'vue'
import { webGPUShaderCache } from '@/lib/WebGPUShaderCache'
import { itemGrantEffectShader } from '@/lib/shaders/itemGrantEffect.wgsl'

const CACHE_KEY = 'itemGrantEffect_v1'
const VERTEX_BUFFER_KEY = 'itemGrantEffect_vertices'

// Register shader once at module load time
webGPUShaderCache.registerShader(CACHE_KEY, itemGrantEffectShader)

const props = withDefaults(defineProps<{
  rarity?: string
  active?: boolean
}>(), {
  rarity: 'common',
  active: true
})

const canvasRef = ref<HTMLCanvasElement>()
const isReady = ref(false)

let device: GPUDevice | null = null
let context: GPUCanvasContext | null = null
let pipeline: GPURenderPipeline | null = null
let animationId: number | null = null
let startTime = 0
let uniformBuffer: GPUBuffer | null = null
let bindGroup: GPUBindGroup | null = null
let vertexBuffer: GPUBuffer | null = null

function createPipeline(device: GPUDevice, shaderModule: GPUShaderModule, format: GPUTextureFormat): GPURenderPipeline {
  return device.createRenderPipeline({
    label: 'Item Grant Effect Pipeline',
    layout: 'auto',
    vertex: {
      module: shaderModule,
      entryPoint: 'vertexMain',
      buffers: [{
        arrayStride: 8, // 2 floats * 4 bytes
        attributes: [{
          shaderLocation: 0,
          offset: 0,
          format: 'float32x2',
        }],
      }],
    },
    fragment: {
      module: shaderModule,
      entryPoint: 'fragmentMain',
      targets: [{
        format,
        blend: {
          color: {
            srcFactor: 'src-alpha',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
          alpha: {
            srcFactor: 'one',
            dstFactor: 'one-minus-src-alpha',
            operation: 'add',
          },
        },
      }],
    },
    primitive: {
      topology: 'triangle-strip',
    },
  })
}

function getRarityColor(rarity: string): [number, number, number] {
  const colors: Record<string, [number, number, number]> = {
    common: [0.7, 0.7, 0.7],
    rare: [0.3, 0.6, 1.0],
    epic: [0.6, 0.3, 1.0],
    legendary: [1.0, 0.7, 0.2],
    relic: [1.0, 0.4, 0.8],
    ancient: [1.0, 0.3, 0.7],
  }
  return colors[rarity] || colors.common
}

function getRarityIntensity(rarity: string): number {
  const intensities: Record<string, number> = {
    common: 0.3,    // only glow + particles
    rare: 0.6,      // + rings
    epic: 0.9,      // + spiral
    legendary: 1.2, // + rays + lightning
    relic: 1.5,     // + wisps
    ancient: 1.3,
  }
  return intensities[rarity] || 0.3
}

function render(time: number) {
  // Early exit if component is unmounted or inactive
  if (!device || !context || !pipeline || !canvasRef.value || !props.active || !uniformBuffer || !vertexBuffer || !bindGroup) {
    animationId = null
    return
  }
  
  const canvas = canvasRef.value
  const currentTime = (time - startTime) / 1000
  
  // Update uniform buffer
  const color = getRarityColor(props.rarity)
  const intensity = getRarityIntensity(props.rarity)
  
  const uniformData = new Float32Array([
    currentTime,
    0, // padding
    canvas.width,
    canvas.height,
    color[0],
    color[1],
    color[2],
    intensity,
  ])
  
  device.queue.writeBuffer(uniformBuffer, 0, uniformData)
  
  // Render
  try {
    const textureView = context.getCurrentTexture().createView()
    
    const commandEncoder = device.createCommandEncoder()
    const renderPass = commandEncoder.beginRenderPass({
      colorAttachments: [{
        view: textureView,
        clearValue: { r: 0, g: 0, b: 0, a: 0 },
        loadOp: 'clear',
        storeOp: 'store',
      }],
    })
    
    renderPass.setPipeline(pipeline)
    renderPass.setBindGroup(0, bindGroup)
    renderPass.setVertexBuffer(0, vertexBuffer)
    renderPass.draw(4, 1, 0, 0)
    renderPass.end()
    
    device.queue.submit([commandEncoder.finish()])
    
    // Continue animation only if still mounted and active
    if (props.active && canvasRef.value) {
      animationId = requestAnimationFrame(render)
    } else {
      animationId = null
    }
  } catch (error) {
    console.error('WebGPU render error:', error)
    animationId = null
  }
}

async function initWebGPU() {
  if (!canvasRef.value) return
  
  const canvas = canvasRef.value
  canvas.width = canvas.offsetWidth * window.devicePixelRatio
  canvas.height = canvas.offsetHeight * window.devicePixelRatio
  
  // Check for WebGPU support
  if (!navigator.gpu) {
    console.error('WebGPU not supported')
    return
  }
  
  try {
    // Get shared device from cache manager
    const { device: sharedDevice } = await webGPUShaderCache.getOrCreateDevice()
    device = sharedDevice
    
    // Configure canvas context
    context = canvas.getContext('webgpu')
    if (!context) {
      console.error('Could not get WebGPU context')
      return
    }
    
    const format = navigator.gpu.getPreferredCanvasFormat()
    context.configure({
      device,
      format,
      alphaMode: 'premultiplied',
    })
    
    // Create pipeline from cache using global cache manager
    pipeline = await webGPUShaderCache.getOrCreatePipeline(
      CACHE_KEY,
      device,
      format,
      createPipeline
    )
    
    // Create vertex buffer from cache
    const vertices = new Float32Array([
      -1, -1,
       1, -1,
      -1,  1,
       1,  1,
    ])
    vertexBuffer = webGPUShaderCache.getOrCreateVertexBuffer(VERTEX_BUFFER_KEY, device, vertices)
    
    // Create uniform buffer (aligned to 16 bytes)
    uniformBuffer = device.createBuffer({
      label: 'Uniform Buffer',
      size: 32, // 8 floats * 4 bytes = 32 bytes
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    })
    
    // Create bind group
    bindGroup = device.createBindGroup({
      label: 'Bind Group',
      layout: pipeline.getBindGroupLayout(0),
      entries: [{
        binding: 0,
        resource: { buffer: uniformBuffer },
      }],
    })
    
    startTime = performance.now()
    isReady.value = true
    animationId = requestAnimationFrame(render)
  } catch (error) {
    console.error('WebGPU initialization failed:', error)
  }
}

function cleanup() {
  // Cancel animation frame first to stop render loop
  if (animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
  
  // Destroy instance-specific resources
  if (uniformBuffer) {
    uniformBuffer.destroy()
    uniformBuffer = null
  }
  
  // Unconfigure context to release canvas
  if (context) {
    context.unconfigure()
    context = null
  }
  
  // Release vertex buffer through cache manager
  if (vertexBuffer) {
    webGPUShaderCache.releaseVertexBuffer(VERTEX_BUFFER_KEY)
    vertexBuffer = null
  }
  
  // Clear local references (device and pipeline stay in global cache)
  device = null
  pipeline = null
  bindGroup = null
}

onMounted(() => {
  initWebGPU()
})

onUnmounted(() => {
  cleanup()
})

watch(() => props.active, (active) => {
  if (active && !animationId) {
    startTime = performance.now()
    animationId = requestAnimationFrame(render)
  } else if (!active && animationId) {
    cancelAnimationFrame(animationId)
    animationId = null
  }
})

watch(() => props.rarity, () => {
  // Reset time on rarity change for fresh effect
  startTime = performance.now()
})
</script>
