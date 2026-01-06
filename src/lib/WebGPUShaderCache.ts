/**
 * Global WebGPU shader and pipeline cache manager
 * Reuses compiled shaders between component instances
 */

interface ShaderCacheEntry {
  shaderModule: GPUShaderModule
  pipeline: GPURenderPipeline
  device: GPUDevice
  timestamp: number
}

interface VertexBufferCacheEntry {
  buffer: GPUBuffer
  device: GPUDevice
  refCount: number
}

class WebGPUShaderCacheManager {
  private shaderCache = new Map<string, ShaderCacheEntry>()
  private vertexBufferCache = new Map<string, VertexBufferCacheEntry>()
  private cachedDevice: GPUDevice | null = null
  private cachedAdapter: GPUAdapter | null = null
  private registeredShaders = new Map<string, string>()

  /**
   * Register shader source code with a key (call once at app startup)
   */
  registerShader(key: string, shaderSource: string): void {
    this.registeredShaders.set(key, shaderSource)
    console.log(`[WebGPUCache] Registered shader: ${key}`)
  }

  /**
   * Get or create shared GPUDevice (singleton)
   */
  async getOrCreateDevice(): Promise<{ device: GPUDevice; adapter: GPUAdapter }> {
    if (this.cachedDevice && this.cachedAdapter) {
      return { device: this.cachedDevice, adapter: this.cachedAdapter }
    }

    if (!navigator.gpu) {
      throw new Error('WebGPU not supported')
    }

    const adapter = await navigator.gpu.requestAdapter({
      powerPreference: 'high-performance',
    })

    if (!adapter) {
      throw new Error('No WebGPU adapter found')
    }

    const device = await adapter.requestDevice()

    this.cachedDevice = device
    this.cachedAdapter = adapter

    console.log('[WebGPUCache] Created shared GPUDevice')

    return { device, adapter }
  }

  /**
   * Get or create pipeline with caching
   */
  async getOrCreatePipeline(
    key: string,
    device: GPUDevice,
    format: GPUTextureFormat,
    createPipelineFn: (device: GPUDevice, shaderModule: GPUShaderModule, format: GPUTextureFormat) => GPURenderPipeline
  ): Promise<GPURenderPipeline> {
    const cached = this.shaderCache.get(key)
    
    // Check if cached pipeline exists and belongs to the same device
    if (cached && cached.pipeline && cached.device === device) {
      console.log(`[WebGPUCache] Using cached pipeline: ${key}`)
      return cached.pipeline
    }

    // If device changed, clear old cache
    if (cached && cached.device !== device) {
      console.log(`[WebGPUCache] Device changed, invalidating cache: ${key}`)
      this.shaderCache.delete(key)
    }

    // Get registered shader source
    const shaderSource = this.registeredShaders.get(key)
    if (!shaderSource) {
      throw new Error(`[WebGPUCache] Shader not registered: ${key}. Call registerShader() first.`)
    }

    console.log(`[WebGPUCache] Compiling shader and creating pipeline: ${key}`)
    
    const shaderModule = device.createShaderModule({
      label: `${key} Shader`,
      code: shaderSource,
    })

    const pipeline = createPipelineFn(device, shaderModule, format)

    this.shaderCache.set(key, {
      shaderModule,
      pipeline,
      device,
      timestamp: Date.now(),
    })

    return pipeline
  }

  /**
   * Get or create vertex buffer with caching
   */
  getOrCreateVertexBuffer(
    key: string,
    device: GPUDevice,
    vertices: Float32Array
  ): GPUBuffer {
    const cached = this.vertexBufferCache.get(key)
    
    // Check if cached buffer exists and belongs to the same device
    if (cached && cached.device === device) {
      cached.refCount++
      console.log(`[WebGPUCache] Reusing vertex buffer: ${key} (refs: ${cached.refCount})`)
      return cached.buffer
    }

    // If device changed, destroy old buffer and create new one
    if (cached && cached.device !== device) {
      console.log(`[WebGPUCache] Device changed, recreating vertex buffer: ${key}`)
      cached.buffer.destroy()
      this.vertexBufferCache.delete(key)
    }

    console.log(`[WebGPUCache] Creating new vertex buffer: ${key}`)
    
    const buffer = device.createBuffer({
      label: `${key} Vertex Buffer`,
      size: vertices.byteLength,
      usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
    })

    device.queue.writeBuffer(buffer, 0, vertices.buffer, vertices.byteOffset, vertices.byteLength)

    this.vertexBufferCache.set(key, {
      buffer,
      device,
      refCount: 1,
    })

    return buffer
  }

  /**
   * Release vertex buffer (decrease reference count)
   */
  releaseVertexBuffer(key: string): void {
    const cached = this.vertexBufferCache.get(key)
    
    if (!cached) return

    cached.refCount--
    console.log(`[WebGPUCache] Released vertex buffer: ${key} (refs: ${cached.refCount})`)

    if (cached.refCount <= 0) {
      console.log(`[WebGPUCache] Destroying vertex buffer: ${key}`)
      cached.buffer.destroy()
      this.vertexBufferCache.delete(key)
    }
  }

  /**
   * Clear old caches (older than specified time)
   */
  clearOldCaches(maxAgeMs: number = 5 * 60 * 1000): void {
    const now = Date.now()
    let cleared = 0

    for (const [key, entry] of this.shaderCache.entries()) {
      if (now - entry.timestamp > maxAgeMs) {
        console.log(`[WebGPUCache] Clearing old shader cache: ${key}`)
        this.shaderCache.delete(key)
        cleared++
      }
    }

    if (cleared > 0) {
      console.log(`[WebGPUCache] Cleared ${cleared} old shader cache entries`)
    }
  }

  /**
   * Get cache statistics
   */
  getStats() {
    return {
      shaderCacheSize: this.shaderCache.size,
      vertexBufferCacheSize: this.vertexBufferCache.size,
      vertexBufferRefs: Array.from(this.vertexBufferCache.entries()).map(([key, entry]) => ({
        key,
        refCount: entry.refCount,
      })),
    }
  }

  /**
   * Full cache cleanup (for debugging)
   */
  clearAll(): void {
    console.log('[WebGPUCache] Clearing all caches')
    
    // Destroy all vertex buffers
    for (const [key, entry] of this.vertexBufferCache.entries()) {
      entry.buffer.destroy()
    }
    
    this.shaderCache.clear()
    this.vertexBufferCache.clear()
  }
}

// Global singleton
export const webGPUShaderCache = new WebGPUShaderCacheManager()

// Export for TypeScript typing
export type { ShaderCacheEntry }
