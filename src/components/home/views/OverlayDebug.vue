<template>
    <div class="overlay-debug-view flex flex-col h-full bg-background">
        <!-- Header -->
        <div class="flex items-center justify-between p-4 border-b border-border">
            <h2 class="text-xl font-semibold text-foreground">Overlay Debug</h2>
            <div class="flex items-center gap-3">
                <span class="text-sm text-muted-foreground">
                    WebGPU: {{ gpuStatus }}
                </span>
                <button 
                    @click="toggleOverlay"
                    class="px-3 py-1.5 rounded-md text-sm font-medium transition-colors"
                    :class="isRunning ? 'bg-red-500/20 text-red-400 hover:bg-red-500/30' : 'bg-green-500/20 text-green-400 hover:bg-green-500/30'"
                >
                    {{ isRunning ? 'Stop' : 'Start' }}
                </button>
            </div>
        </div>

        <!-- Main content -->
        <div class="flex flex-1 overflow-hidden">
            <!-- Canvas container -->
            <div class="flex-1 relative bg-zinc-900/50 overflow-hidden" ref="canvasContainer">
                <canvas 
                    ref="overlayCanvas" 
                    class="absolute inset-0"
                    :style="{ width: '100%', height: '100%' }"
                />
                
                <!-- Overlay info when not running -->
                <div 
                    v-if="!isRunning" 
                    class="absolute inset-0 flex items-center justify-center bg-black/50"
                >
                    <div class="text-center text-muted-foreground">
                        <p class="text-lg mb-2">WebGPU Overlay Canvas</p>
                        <p class="text-sm">Click "Start" to begin rendering</p>
                    </div>
                </div>
            </div>

            <!-- Side panel -->
            <div class="w-80 border-l border-border flex flex-col">
                <!-- Voice channel info -->
                <div class="p-4 border-b border-border">
                    <h3 class="text-sm font-medium text-foreground mb-2">Voice Channel</h3>
                    <div v-if="currentChannel" class="text-sm">
                        <p class="text-foreground">{{ currentChannel.name }}</p>
                        <p class="text-muted-foreground">{{ voiceMembers.length }} members</p>
                    </div>
                    <div v-else class="text-sm text-muted-foreground">
                        Not connected to voice
                    </div>
                </div>

                <!-- Members list -->
                <div class="flex-1 overflow-y-auto p-4">
                    <h3 class="text-sm font-medium text-foreground mb-3">Members</h3>
                    <div class="space-y-2">
                        <div 
                            v-for="member in voiceMembers" 
                            :key="member.userId"
                            class="flex items-center gap-3 p-2 rounded-lg bg-card/50"
                            :class="{ 'ring-2 ring-lime-400/50': member.isSpeaking }"
                        >
                            <div 
                                class="w-8 h-8 rounded-full flex items-center justify-center text-white text-sm font-medium"
                                :style="{ backgroundColor: member.avatarColor }"
                            >
                                {{ member.displayName.charAt(0).toUpperCase() }}
                            </div>
                            <div class="flex-1 min-w-0">
                                <p class="text-sm text-foreground truncate">{{ member.displayName }}</p>
                                <div class="flex gap-1 text-xs text-muted-foreground">
                                    <span v-if="member.isSpeaking" class="text-lime-400">Speaking</span>
                                    <span v-if="member.isMuted" class="text-red-400">Muted</span>
                                    <span v-if="member.isDeafened" class="text-red-400">Deafened</span>
                                </div>
                            </div>
                        </div>
                        
                        <div v-if="voiceMembers.length === 0" class="text-sm text-muted-foreground text-center py-4">
                            No members in voice
                        </div>
                    </div>
                </div>

                <!-- Debug controls -->
                <div class="p-4 border-t border-border space-y-3">
                    <h3 class="text-sm font-medium text-foreground">Debug Controls</h3>
                    
                    <!-- Canvas Size Mode -->
                    <div class="space-y-1">
                        <label class="text-xs text-muted-foreground">Canvas Size</label>
                        <select 
                            v-model="canvasSizeMode" 
                            @change="updateCanvasSize"
                            :disabled="isRunning"
                            class="w-full px-2 py-1.5 rounded-md text-xs bg-zinc-800 border border-zinc-600 text-foreground disabled:opacity-50"
                        >
                            <option value="container">Container (debug)</option>
                            <option value="screen">Screen ({{ screenSize }})</option>
                            <option value="window">Window ({{ windowSize }})</option>
                            <option value="1920x1080">1920×1080 (Full HD)</option>
                            <option value="2560x1440">2560×1440 (2K)</option>
                            <option value="3840x2160">3840×2160 (4K)</option>
                            <option value="custom">Custom...</option>
                        </select>
                        
                        <div v-if="canvasSizeMode === 'custom'" class="flex gap-2 mt-1">
                            <input 
                                v-model.number="customWidth" 
                                type="number" 
                                placeholder="Width"
                                class="flex-1 px-2 py-1 rounded-md text-xs bg-zinc-800 border border-zinc-600 text-foreground"
                            />
                            <span class="text-muted-foreground">×</span>
                            <input 
                                v-model.number="customHeight" 
                                type="number" 
                                placeholder="Height"
                                class="flex-1 px-2 py-1 rounded-md text-xs bg-zinc-800 border border-zinc-600 text-foreground"
                            />
                        </div>
                        
                        <p class="text-xs text-muted-foreground">
                            Current: {{ currentCanvasSize }}
                        </p>
                    </div>
                    
                    <!-- GPU Diagnostics -->
                    <div v-if="isRunning && diagnostics" class="space-y-2 p-2 bg-zinc-800/50 rounded-md">
                        <div class="flex justify-between items-center">
                            <h4 class="text-xs font-medium text-muted-foreground">Performance</h4>
                            <span class="text-xs font-mono" :class="diagnostics.fps >= 55 ? 'text-green-400' : diagnostics.fps >= 30 ? 'text-yellow-400' : 'text-red-400'">
                                {{ diagnostics.fps }} FPS
                            </span>
                        </div>
                        
                        <!-- Frame Time Graph -->
                        <div class="h-12 bg-zinc-900 rounded relative overflow-hidden">
                            <svg class="w-full h-full" preserveAspectRatio="none">
                                <polyline
                                    :points="frameTimeGraphPoints"
                                    fill="none"
                                    stroke="rgb(74, 222, 128)"
                                    stroke-width="1.5"
                                />
                            </svg>
                            <div class="absolute top-0.5 left-1 text-[10px] text-muted-foreground">
                                {{ diagnostics.frameTime.toFixed(2) }}ms
                            </div>
                        </div>
                        
                        <div class="grid grid-cols-2 gap-x-3 gap-y-1 text-[10px]">
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">CPU:</span>
                                <span class="text-foreground font-mono">{{ diagnostics.cpuTime.toFixed(2) }}ms</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">GPU:</span>
                                <span class="text-foreground font-mono">{{ diagnostics.gpuTime ? diagnostics.gpuTime.toFixed(2) + 'ms' : 'N/A' }}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">Draw calls:</span>
                                <span class="text-foreground font-mono">{{ diagnostics.drawCalls }}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">Vertices:</span>
                                <span class="text-foreground font-mono">{{ diagnostics.vertexCount }}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">Triangles:</span>
                                <span class="text-foreground font-mono">{{ diagnostics.triangleCount }}</span>
                            </div>
                            <div class="flex justify-between">
                                <span class="text-muted-foreground">Sprites:</span>
                                <span class="text-foreground font-mono">{{ diagnostics.spriteCount }}</span>
                            </div>
                        </div>
                        
                        <div class="pt-1 border-t border-zinc-700">
                            <div class="flex justify-between items-center text-[10px]">
                                <span class="text-muted-foreground">VRAM Usage:</span>
                                <span class="text-foreground font-mono">{{ formatBytes(diagnostics.vramUsage.total) }}</span>
                            </div>
                            <div class="flex gap-2 text-[10px] text-muted-foreground mt-0.5">
                                <span>Buffers: {{ formatBytes(diagnostics.vramUsage.buffers) }}</span>
                                <span>Textures: {{ formatBytes(diagnostics.vramUsage.textures) }}</span>
                            </div>
                        </div>
                        
                        <div class="pt-1 border-t border-zinc-700">
                            <div class="grid grid-cols-2 gap-x-3 gap-y-0.5 text-[10px]">
                                <div class="flex justify-between">
                                    <span class="text-muted-foreground">Widgets:</span>
                                    <span class="text-foreground font-mono">{{ diagnostics.visibleWidgetCount }}/{{ diagnostics.widgetCount }}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-muted-foreground">Textures:</span>
                                    <span class="text-foreground font-mono">{{ diagnostics.textureCount }}</span>
                                </div>
                                <div class="flex justify-between">
                                    <span class="text-muted-foreground">Pipelines:</span>
                                    <span class="text-foreground font-mono">{{ diagnostics.pipelineCount }}</span>
                                </div>
                            </div>
                        </div>
                        
                        <!-- GPU Info (collapsed) -->
                        <details class="text-[10px]">
                            <summary class="text-muted-foreground cursor-pointer hover:text-foreground">GPU Info</summary>
                            <div v-if="diagnostics.gpuInfo" class="mt-1 p-1 bg-zinc-900 rounded space-y-0.5">
                                <p><span class="text-muted-foreground">Vendor:</span> {{ diagnostics.gpuInfo.vendor }}</p>
                                <p><span class="text-muted-foreground">Device:</span> {{ diagnostics.gpuInfo.device }}</p>
                                <p><span class="text-muted-foreground">Arch:</span> {{ diagnostics.gpuInfo.architecture }}</p>
                                <p class="truncate"><span class="text-muted-foreground">Desc:</span> {{ diagnostics.gpuInfo.description }}</p>
                                <details class="mt-1">
                                    <summary class="text-muted-foreground cursor-pointer">Features ({{ diagnostics.gpuInfo.features.length }})</summary>
                                    <div class="max-h-20 overflow-y-auto mt-0.5">
                                        <p v-for="f in diagnostics.gpuInfo.features" :key="f" class="text-[9px]">{{ f }}</p>
                                    </div>
                                </details>
                            </div>
                        </details>
                        
                        <!-- Dirty Capture Stats (collapsed) -->
                        <details v-if="diagnostics.dirtyCapture.captureCount > 0" class="text-[10px]">
                            <summary class="text-muted-foreground cursor-pointer hover:text-foreground">
                                Dirty Capture 
                                <span class="text-amber-400">({{ diagnostics.dirtyCapture.avgCaptureTime.toFixed(2) }}ms avg)</span>
                            </summary>
                            <div class="mt-1 p-1 bg-zinc-900 rounded space-y-1">
                                <!-- Grid info -->
                                <div class="flex justify-between">
                                    <span class="text-muted-foreground">Grid:</span>
                                    <span class="font-mono">{{ diagnostics.dirtyCapture.tilesX }}×{{ diagnostics.dirtyCapture.tilesY }} ({{ diagnostics.dirtyCapture.totalTiles }} tiles @ {{ diagnostics.dirtyCapture.tileSize }}px)</span>
                                </div>
                                
                                <!-- Memory -->
                                <div class="flex justify-between">
                                    <span class="text-muted-foreground">Frame buffer:</span>
                                    <span class="font-mono text-yellow-400">{{ formatBytes(diagnostics.dirtyCapture.previousFrameMemory) }}</span>
                                </div>
                                
                                <!-- Timing breakdown -->
                                <div class="pt-1 border-t border-zinc-800">
                                    <p class="text-muted-foreground mb-0.5">Last capture timing:</p>
                                    <div class="grid grid-cols-2 gap-x-2">
                                        <div class="flex justify-between">
                                            <span class="text-muted-foreground">Total:</span>
                                            <span class="font-mono">{{ diagnostics.dirtyCapture.lastCaptureTime.toFixed(2) }}ms</span>
                                        </div>
                                        <div class="flex justify-between">
                                            <span class="text-muted-foreground">Compare:</span>
                                            <span class="font-mono">{{ diagnostics.dirtyCapture.lastCompareTime.toFixed(2) }}ms</span>
                                        </div>
                                        <div class="flex justify-between">
                                            <span class="text-muted-foreground">Extract:</span>
                                            <span class="font-mono">{{ diagnostics.dirtyCapture.lastExtractTime.toFixed(2) }}ms</span>
                                        </div>
                                        <div class="flex justify-between">
                                            <span class="text-muted-foreground">Dirty:</span>
                                            <span class="font-mono" :class="diagnostics.dirtyCapture.lastDirtyPercent < 20 ? 'text-green-400' : 'text-yellow-400'">{{ diagnostics.dirtyCapture.lastDirtyPercent.toFixed(1) }}%</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Averages -->
                                <div class="pt-1 border-t border-zinc-800">
                                    <p class="text-muted-foreground mb-0.5">Averages ({{ diagnostics.dirtyCapture.captureCount }} captures):</p>
                                    <div class="grid grid-cols-2 gap-x-2">
                                        <div class="flex justify-between">
                                            <span class="text-muted-foreground">Time:</span>
                                            <span class="font-mono text-green-400">{{ diagnostics.dirtyCapture.avgCaptureTime.toFixed(2) }}ms</span>
                                        </div>
                                        <div class="flex justify-between">
                                            <span class="text-muted-foreground">Dirty:</span>
                                            <span class="font-mono">{{ diagnostics.dirtyCapture.avgDirtyPercent.toFixed(1) }}%</span>
                                        </div>
                                        <div class="flex justify-between col-span-2">
                                            <span class="text-muted-foreground">Data/capture:</span>
                                            <span class="font-mono text-green-400">{{ formatBytes(diagnostics.dirtyCapture.avgBytesPerCapture) }}</span>
                                        </div>
                                    </div>
                                </div>
                                
                                <!-- Transparency optimization -->
                                <div v-if="diagnostics.dirtyCapture.totalTransparentSkipped > 0" class="pt-1 border-t border-zinc-800">
                                    <p class="text-muted-foreground mb-0.5">Transparency skip:</p>
                                    <div class="grid grid-cols-2 gap-x-2">
                                        <div class="flex justify-between">
                                            <span class="text-muted-foreground">Last:</span>
                                            <span class="font-mono text-cyan-400">{{ diagnostics.dirtyCapture.lastTransparentSkipped }} tiles</span>
                                        </div>
                                        <div class="flex justify-between">
                                            <span class="text-muted-foreground">Saved:</span>
                                            <span class="font-mono text-cyan-400">{{ formatBytes(diagnostics.dirtyCapture.lastTransparentSaved) }}</span>
                                        </div>
                                        <div class="flex justify-between col-span-2">
                                            <span class="text-muted-foreground">Total saved:</span>
                                            <span class="font-mono text-cyan-400">{{ formatBytes(diagnostics.dirtyCapture.totalTransparentSaved) }}</span>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </details>
                    </div>
                    
                    <div class="flex gap-2">
                        <button 
                            @click="addTestMember"
                            class="flex-1 px-3 py-1.5 rounded-md text-xs bg-zinc-700 hover:bg-zinc-600 text-foreground"
                        >
                            Add Test Member
                        </button>
                        <button 
                            @click="toggleTestSpeaking"
                            class="flex-1 px-3 py-1.5 rounded-md text-xs bg-zinc-700 hover:bg-zinc-600 text-foreground"
                        >
                            Toggle Speaking
                        </button>
                    </div>
                    
                    <button 
                        @click="clearTestMembers"
                        class="w-full px-3 py-1.5 rounded-md text-xs bg-zinc-700 hover:bg-zinc-600 text-foreground"
                    >
                        Clear Test Members
                    </button>
                    
                    <!-- Frame Capture -->
                    <div class="pt-3 border-t border-border mt-3">
                        <h4 class="text-xs font-medium text-muted-foreground mb-2">Frame Capture</h4>
                        
                        <div class="space-y-2">
                            <!-- Capture mode toggle -->
                            <div class="flex gap-1 p-0.5 bg-zinc-800 rounded-md">
                                <button 
                                    @click="captureMode = 'full'"
                                    :class="[
                                        'flex-1 px-2 py-1 rounded text-xs transition-colors',
                                        captureMode === 'full' 
                                            ? 'bg-zinc-600 text-white' 
                                            : 'text-muted-foreground hover:text-foreground'
                                    ]"
                                >
                                    Full
                                </button>
                                <button 
                                    @click="captureMode = 'fragment'"
                                    :class="[
                                        'flex-1 px-2 py-1 rounded text-xs transition-colors',
                                        captureMode === 'fragment' 
                                            ? 'bg-zinc-600 text-white' 
                                            : 'text-muted-foreground hover:text-foreground'
                                    ]"
                                >
                                    Fragment
                                </button>
                                <button 
                                    @click="captureMode = 'dirty'"
                                    :class="[
                                        'flex-1 px-2 py-1 rounded text-xs transition-colors',
                                        captureMode === 'dirty' 
                                            ? 'bg-zinc-600 text-white' 
                                            : 'text-muted-foreground hover:text-foreground'
                                    ]"
                                >
                                    Dirty
                                </button>
                            </div>
                            
                            <div v-if="captureMode === 'full'" class="flex gap-2">
                                <select 
                                    v-model="captureFormat" 
                                    class="flex-1 px-2 py-1 rounded-md text-xs bg-zinc-800 border border-zinc-600 text-foreground"
                                >
                                    <option value="raw">Raw RGBA</option>
                                    <option value="image/png">PNG</option>
                                    <option value="image/jpeg">JPEG</option>
                                    <option value="image/webp">WebP</option>
                                </select>
                                <button 
                                    @click="captureFrame"
                                    :disabled="!isRunning"
                                    class="px-3 py-1 rounded-md text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                                >
                                    Capture
                                </button>
                            </div>
                            
                            <div v-else-if="captureMode === 'fragment'" class="space-y-2">
                                <button 
                                    @click="captureFragments"
                                    :disabled="!isRunning"
                                    class="w-full px-3 py-1.5 rounded-md text-xs bg-blue-600 hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                                >
                                    Capture Fragments
                                </button>
                                <button 
                                    @click="captureCombined"
                                    :disabled="!isRunning"
                                    class="w-full px-3 py-1.5 rounded-md text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                                >
                                    Capture Combined Region
                                </button>
                            </div>
                            
                            <!-- Dirty Tiles Mode -->
                            <div v-else-if="captureMode === 'dirty'" class="space-y-2">
                                <!-- Tile size selector -->
                                <div class="flex items-center gap-2">
                                    <label class="text-[10px] text-muted-foreground">Tile:</label>
                                    <select 
                                        v-model.number="dirtyTileSize" 
                                        @change="updateDirtyTileSize"
                                        class="flex-1 px-2 py-1 rounded-md text-xs bg-zinc-800 border border-zinc-600 text-foreground"
                                    >
                                        <option :value="16">16×16</option>
                                        <option :value="32">32×32</option>
                                        <option :value="64">64×64</option>
                                        <option :value="128">128×128</option>
                                    </select>
                                </div>
                                
                                <button 
                                    @click="captureDirtyTiles"
                                    :disabled="!isRunning"
                                    class="w-full px-3 py-1.5 rounded-md text-xs bg-amber-600 hover:bg-amber-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                                >
                                    Capture Dirty Tiles
                                </button>
                                
                                <button 
                                    @click="toggleDirtyStream"
                                    :disabled="!isRunning"
                                    :class="[
                                        'w-full px-3 py-1.5 rounded-md text-xs transition-colors disabled:opacity-50 disabled:cursor-not-allowed text-white',
                                        isDirtyStreaming 
                                            ? 'bg-red-600 hover:bg-red-500' 
                                            : 'bg-green-600 hover:bg-green-500'
                                    ]"
                                >
                                    {{ isDirtyStreaming ? 'Stop Stream' : 'Start Stream (30 FPS)' }}
                                </button>
                                
                                <!-- Dirty stats -->
                                <div v-if="dirtyStats" class="p-2 bg-zinc-900/50 rounded text-[10px] space-y-1">
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">Grid:</span>
                                        <span class="font-mono">{{ dirtyStats.tilesX }}×{{ dirtyStats.tilesY }} ({{ dirtyStats.totalTiles }} tiles)</span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">Dirty:</span>
                                        <span class="font-mono" :class="dirtyStats.dirtyPercent < 20 ? 'text-green-400' : dirtyStats.dirtyPercent < 50 ? 'text-yellow-400' : 'text-red-400'">
                                            {{ dirtyStats.dirtyCount }}/{{ dirtyStats.totalTiles }} ({{ dirtyStats.dirtyPercent.toFixed(1) }}%)
                                        </span>
                                    </div>
                                    <div class="flex justify-between">
                                        <span class="text-muted-foreground">Data:</span>
                                        <span class="font-mono text-green-400">{{ formatBytes(dirtyStats.totalBytes) }}</span>
                                    </div>
                                    <div v-if="dirtyStats.transparentSkipped" class="flex justify-between">
                                        <span class="text-muted-foreground">Transparent skipped:</span>
                                        <span class="font-mono text-cyan-400">{{ dirtyStats.transparentSkipped }} ({{ formatBytes(dirtyStats.transparentSaved) }})</span>
                                    </div>
                                    <div v-if="dirtyStats.fullRefresh" class="text-yellow-400">
                                        Full refresh (first frame)
                                    </div>
                                </div>
                            </div>
                            
                            <div v-if="lastCapture" class="text-xs text-muted-foreground space-y-1">
                                <p>Size: {{ lastCapture.width }}x{{ lastCapture.height }}</p>
                                <p>Bytes: {{ formatBytes(lastCapture.bytes) }}</p>
                                <p>Time: {{ lastCapture.captureTime.toFixed(2) }}ms</p>
                                <p v-if="lastCapture.regions" class="text-green-400">
                                    Regions: {{ lastCapture.regions }} 
                                    <span class="text-muted-foreground">(vs full: {{ formatBytes(lastCapture.fullFrameBytes ?? 0) }})</span>
                                </p>
                                <p v-if="lastCapture.savings" class="text-green-400 font-medium">
                                    Savings: {{ lastCapture.savings }}%
                                </p>
                            </div>
                            
                            <!-- Preview thumbnail -->
                            <div v-if="capturePreview" class="mt-2">
                                <img 
                                    :src="capturePreview" 
                                    class="w-full rounded border border-zinc-600"
                                    alt="Capture preview"
                                />
                            </div>
                            
                            <button 
                                v-if="capturePreview"
                                @click="downloadCapture"
                                class="w-full px-3 py-1.5 rounded-md text-xs bg-green-600 hover:bg-green-500 text-white"
                            >
                                Download
                            </button>
                        </div>
                    </div>
                    
                    <!-- Native Overlay Bridge -->
                    <div class="pt-3 border-t border-border mt-3">
                        <h4 class="text-xs font-medium text-muted-foreground mb-2 flex items-center gap-2">
                            Native Overlay
                            <span 
                                class="w-2 h-2 rounded-full"
                                :class="isNativeAvailable ? 'bg-green-500' : 'bg-red-500'"
                            />
                        </h4>
                        
                        <div v-if="!isNativeAvailable" class="text-[10px] text-muted-foreground p-2 bg-zinc-800/50 rounded">
                            Native host not detected. Run in Argon desktop app.
                        </div>
                        
                        <div v-else class="space-y-2">
                            <!-- Error display -->
                            <div v-if="nativeBridgeError" class="text-[10px] text-red-400 p-1 bg-red-900/30 rounded">
                                {{ nativeBridgeError }}
                            </div>
                            
                            <!-- Status -->
                            <div class="flex items-center justify-between text-[10px]">
                                <span class="text-muted-foreground">Status:</span>
                                <span 
                                    class="px-1.5 py-0.5 rounded text-[9px] font-mono"
                                    :class="nativeBridgeActive ? 'bg-green-700 text-green-200' : 'bg-zinc-700 text-zinc-300'"
                                >
                                    {{ nativeBridgeActive ? 'streaming' : 'idle' }}
                                </span>
                            </div>
                            
                            <!-- Control button -->
                            <button 
                                v-if="!nativeBridgeActive"
                                @click="startNativeBridge"
                                :disabled="!isRunning"
                                class="w-full px-3 py-1.5 rounded-md text-xs bg-purple-600 hover:bg-purple-500 disabled:opacity-50 disabled:cursor-not-allowed text-white"
                            >
                                Start Native Stream
                            </button>
                            <button 
                                v-else
                                @click="stopNativeBridge"
                                class="w-full px-3 py-1.5 rounded-md text-xs bg-red-600 hover:bg-red-500 text-white"
                            >
                                Stop Native Stream
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted, watch } from 'vue'
import { useUnifiedCall } from '@/store/unifiedCallStore'
import { useRealtimeStore, type IRealtimeChannelUser } from '@/store/realtimeStore'
import { useUserColors } from '@/store/userColors'
import { useSystemStore } from '@/store/systemStore'
import { useMe } from '@/store/meStore'
import { OverlayRenderer, VoiceMembersWidget, type VoiceMember, type CanvasSizeMode, type OverlayDiagnostics } from '@/lib/overlay'
import { native, argon } from '@argon/glue'

// Stores
const voice = useUnifiedCall()
const realtimeStore = useRealtimeStore()
const userColors = useUserColors()
const sys = useSystemStore()
const me = useMe()

// Native overlay bridge state
const isNativeAvailable = computed(() => argon.isArgonHost)
const nativeBridgeActive = ref(false)
const nativeBridgeError = ref<string | null>(null)
let stopNativeCapture: (() => void) | null = null

// Refs
const canvasContainer = ref<HTMLDivElement | null>(null)
const overlayCanvas = ref<HTMLCanvasElement | null>(null)

// State
const isRunning = ref(false)
const gpuStatus = ref<'checking' | 'supported' | 'not-supported'>('checking')

// Diagnostics
const diagnostics = ref<OverlayDiagnostics | null>(null)
let diagnosticsInterval: ReturnType<typeof setInterval> | null = null

// Canvas size mode
const canvasSizeMode = ref<string>('container')
const customWidth = ref(1920)
const customHeight = ref(1080)
const actualCanvasSize = ref({ width: 0, height: 0 })

const screenSize = computed(() => `${screen.width}×${screen.height}`)
const windowSize = computed(() => `${window.innerWidth}×${window.innerHeight}`)
const currentCanvasSize = computed(() => {
    if (actualCanvasSize.value.width === 0) return '—'
    return `${actualCanvasSize.value.width}×${actualCanvasSize.value.height}`
})

// Frame time graph points for SVG polyline
const frameTimeGraphPoints = computed(() => {
    if (!diagnostics.value?.frameTimeHistory.length) return ''
    
    const history = diagnostics.value.frameTimeHistory
    const width = 200 // SVG viewBox width approximation
    const height = 48  // SVG viewBox height
    const maxTime = Math.max(33.33, ...history) // Cap at ~30fps minimum
    
    return history.map((time, i) => {
        const x = (i / (history.length - 1 || 1)) * width
        const y = height - (time / maxTime) * height
        return `${x},${y}`
    }).join(' ')
})

function getSizeMode(): CanvasSizeMode {
    switch (canvasSizeMode.value) {
        case 'screen':
            return { type: 'screen' }
        case 'window':
            return { type: 'window' }
        case '1920x1080':
            return { type: 'fixed', width: 1920, height: 1080 }
        case '2560x1440':
            return { type: 'fixed', width: 2560, height: 1440 }
        case '3840x2160':
            return { type: 'fixed', width: 3840, height: 2160 }
        case 'custom':
            return { type: 'fixed', width: customWidth.value, height: customHeight.value }
        default:
            return { type: 'container' }
    }
}

function updateCanvasSize() {
    if (renderer && isRunning.value) {
        renderer.setSizeMode(getSizeMode())
        // Update actual size after a small delay for canvas to update
        setTimeout(updateActualCanvasSize, 50)
    }
}

// Renderer instance
let renderer: OverlayRenderer | null = null
let voiceMembersWidget: VoiceMembersWidget | null = null

// Test members for debugging
const testMembers = ref<VoiceMember[]>([])
let testMemberCounter = 0

// Current voice channel
const currentChannel = computed(() => {
    const channelId = voice.connectedVoiceChannelId
    if (!channelId) return null
    
    const realtimeChannel = realtimeStore.realtimeChannels.get(channelId)
    return realtimeChannel?.Channel ?? null
})

// Voice members from realtime store + test members
const voiceMembers = computed<VoiceMember[]>(() => {
    const members: VoiceMember[] = []
    
    // Real members from voice channel
    const channelId = voice.connectedVoiceChannelId
    if (channelId) {
        const realtimeChannel = realtimeStore.realtimeChannels.get(channelId)
        if (realtimeChannel) {
            for (const [userId, user] of realtimeChannel.Users) {
                const isSpeaking = voice.speaking.has(userId)
                const isMe = userId === me.me?.userId
                
                // Get mute state
                let isMuted = false
                let isDeafened = false
                
                if (isMe) {
                    isMuted = sys.microphoneMuted
                    isDeafened = sys.headphoneMuted
                } else {
                    const participant = voice.participants[userId]
                    isMuted = participant?.muted ?? false
                    isDeafened = participant?.mutedAll ?? false
                }
                
                members.push({
                    userId,
                    displayName: user.User?.displayName ?? 'Unknown',
                    avatarUrl: user.User?.avatarFileId ?? null,
                    avatarColor: userColors.getColorByUserId(userId),
                    isSpeaking,
                    isMuted,
                    isDeafened,
                })
            }
        }
    }
    
    // Add test members
    members.push(...testMembers.value)
    
    return members
})

// Check WebGPU support
let resizeObserver: ResizeObserver | null = null

onMounted(async () => {
    if (navigator.gpu) {
        const adapter = await navigator.gpu.requestAdapter()
        gpuStatus.value = adapter ? 'supported' : 'not-supported'
    } else {
        gpuStatus.value = 'not-supported'
    }
    
    // Handle resize
    resizeObserver = new ResizeObserver(handleResize)
    if (canvasContainer.value) {
        resizeObserver.observe(canvasContainer.value)
    }
})

onUnmounted(() => {
    resizeObserver?.disconnect()
    stopOverlay()
})

// Update widget when members or speaking state changes
watch(voiceMembers, (members) => {
    if (voiceMembersWidget) {
        voiceMembersWidget.setMembers(members)
    }
}, { deep: true, immediate: true })

// Watch speaking changes - need to watch the Set reactively
watch(
    () => {
        // Force reactivity by reading speaking set
        const speakingSet = voice.speaking
        const size = speakingSet.size
        // Create array of speaking user ids to track changes
        return Array.from(speakingSet).sort().join(',')
    },
    () => {
        if (voiceMembersWidget) {
            // Update each member's speaking state
            for (const member of voiceMembers.value) {
                const isSpeaking = voice.speaking.has(member.userId)
                voiceMembersWidget.setSpeaking(member.userId, isSpeaking)
            }
        }
    },
    { immediate: true }
)

// Also watch test members for speaking toggle
watch(testMembers, () => {
    if (voiceMembersWidget) {
        voiceMembersWidget.setMembers(voiceMembers.value)
    }
}, { deep: true })

function handleResize() {
    if (!canvasContainer.value || !overlayCanvas.value || !renderer) return
    
    // Only resize if in container mode
    const sizeMode = renderer.getSizeMode()
    if (sizeMode.type !== 'container') return
    
    const rect = canvasContainer.value.getBoundingClientRect()
    const dpr = window.devicePixelRatio || 1
    
    overlayCanvas.value.width = rect.width * dpr
    overlayCanvas.value.height = rect.height * dpr
    
    actualCanvasSize.value = { width: overlayCanvas.value.width, height: overlayCanvas.value.height }
    renderer.resize(rect.width * dpr, rect.height * dpr)
}

function updateActualCanvasSize() {
    if (overlayCanvas.value) {
        actualCanvasSize.value = { 
            width: overlayCanvas.value.width, 
            height: overlayCanvas.value.height 
        }
    }
}

async function startOverlay() {
    if (!overlayCanvas.value || !canvasContainer.value) return
    
    // Create renderer with size mode
    const sizeMode = getSizeMode()
    renderer = new OverlayRenderer(overlayCanvas.value, sizeMode)
    
    // Initialize canvas size based on mode
    if (sizeMode.type === 'container') {
        const rect = canvasContainer.value.getBoundingClientRect()
        const dpr = window.devicePixelRatio || 1
        overlayCanvas.value.width = rect.width * dpr
        overlayCanvas.value.height = rect.height * dpr
    }
    
    const initialized = await renderer.initialize()
    
    if (!initialized) {
        console.error('[OverlayDebug] Failed to initialize renderer')
        return
    }
    
    // Update actual canvas size after initialization
    updateActualCanvasSize()
    
    // Create voice members widget
    voiceMembersWidget = new VoiceMembersWidget('voice-members', { x: 20, y: 20 })
    
    // Initialize widget GPU resources
    const device = renderer.getDevice()
    const format = renderer.getFormat()
    const uniformLayout = renderer.getUniformBindGroupLayout()
    
    if (device && uniformLayout) {
        voiceMembersWidget.initGPU(device, format, uniformLayout)
        voiceMembersWidget.setMembers(voiceMembers.value)
        renderer.addWidget(voiceMembersWidget)
    }
    
    // Start render loop
    renderer.start()
    isRunning.value = true
    
    // Start diagnostics polling
    startDiagnostics()
}

function stopOverlay() {
    // Stop diagnostics
    stopDiagnostics()
    
    if (renderer) {
        renderer.stop()
        renderer.dispose()
        renderer = null
    }
    voiceMembersWidget = null
    isRunning.value = false
    diagnostics.value = null
}

function startDiagnostics() {
    // Poll diagnostics every 100ms (10Hz)
    diagnosticsInterval = setInterval(() => {
        if (renderer) {
            diagnostics.value = renderer.getDiagnostics()
        }
    }, 100)
}

function stopDiagnostics() {
    if (diagnosticsInterval) {
        clearInterval(diagnosticsInterval)
        diagnosticsInterval = null
    }
}

function toggleOverlay() {
    if (isRunning.value) {
        stopOverlay()
    } else {
        startOverlay()
    }
}

// Debug helpers
function addTestMember() {
    testMemberCounter++
    const testNames = ['Alice', 'Bob', 'Charlie', 'Diana', 'Eve', 'Frank', 'Grace', 'Henry']
    const name = testNames[testMemberCounter % testNames.length] + ` #${testMemberCounter}`
    const userId = `test-${testMemberCounter}-${Date.now()}`
    
    testMembers.value.push({
        userId,
        displayName: name,
        avatarUrl: null,
        avatarColor: userColors.getColorByUserId(userId),
        isSpeaking: false,
        isMuted: Math.random() > 0.7,
        isDeafened: Math.random() > 0.9,
    })
}

function toggleTestSpeaking() {
    if (testMembers.value.length === 0) return
    
    // Toggle speaking for a random test member
    const randomIndex = Math.floor(Math.random() * testMembers.value.length)
    testMembers.value[randomIndex].isSpeaking = !testMembers.value[randomIndex].isSpeaking
}

function clearTestMembers() {
    testMembers.value = []
    testMemberCounter = 0
}

// ==================== Frame Capture ====================

const captureMode = ref<'full' | 'fragment' | 'dirty'>('dirty')
const captureFormat = ref<'raw' | 'image/png' | 'image/jpeg' | 'image/webp'>('image/png')
const capturePreview = ref<string | null>(null)
const lastCapture = ref<{
    width: number
    height: number
    bytes: number
    captureTime: number
    blob?: Blob
    regions?: number
    fullFrameBytes?: number
    savings?: number
} | null>(null)

// Dirty tile capture state
const dirtyTileSize = ref(32)
const isDirtyStreaming = ref(false)
const dirtyStats = ref<{
    tilesX: number
    tilesY: number
    totalTiles: number
    dirtyCount: number
    dirtyPercent: number
    totalBytes: number
    fullRefresh: boolean
    transparentSkipped: number
    transparentSaved: number
} | null>(null)
let stopDirtyStream: (() => void) | null = null

function formatBytes(bytes: number): string {
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

async function captureFrame() {
    if (!renderer) return
    
    const startTime = performance.now()
    
    try {
        if (captureFormat.value === 'raw') {
            // Raw RGBA capture
            const { data, width, height } = await renderer.captureRawFrame()
            const captureTime = performance.now() - startTime
            
            lastCapture.value = {
                width,
                height,
                bytes: data.byteLength,
                captureTime
            }
            
            // Create preview from raw data
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = width
            tempCanvas.height = height
            const ctx = tempCanvas.getContext('2d')!
            const imageData = new ImageData(new Uint8ClampedArray(data), width, height)
            ctx.putImageData(imageData, 0, 0)
            capturePreview.value = tempCanvas.toDataURL('image/png')
            
        } else {
            // Blob capture (PNG/JPEG/WebP)
            const blob = await renderer.captureBlob(captureFormat.value as any, 0.92)
            const captureTime = performance.now() - startTime
            
            const { width, height } = renderer.getFrameInfo()
            
            lastCapture.value = {
                width,
                height,
                bytes: blob.size,
                captureTime,
                blob
            }
            
            // Create preview URL
            if (capturePreview.value) {
                URL.revokeObjectURL(capturePreview.value)
            }
            capturePreview.value = URL.createObjectURL(blob)
        }
        
        console.log('[OverlayDebug] Frame captured:', lastCapture.value)
        
    } catch (error) {
        console.error('[OverlayDebug] Capture failed:', error)
    }
}

function downloadCapture() {
    if (!lastCapture.value || !capturePreview.value) return
    
    const link = document.createElement('a')
    link.href = capturePreview.value
    
    const ext = captureFormat.value === 'raw' ? 'png' : 
                captureFormat.value === 'image/png' ? 'png' :
                captureFormat.value === 'image/jpeg' ? 'jpg' : 'webp'
    
    link.download = `overlay-capture-${Date.now()}.${ext}`
    link.click()
}

// ==================== Fragment Capture ====================

async function captureFragments() {
    if (!renderer) return
    
    const startTime = performance.now()
    
    try {
        const capture = await renderer.captureFragments()
        const captureTime = performance.now() - startTime
        
        const fullFrameBytes = capture.screenWidth * capture.screenHeight * 4
        const savings = Math.round((1 - capture.totalBytes / fullFrameBytes) * 100)
        
        // Debug: check if data has non-zero values
        for (const region of capture.regions) {
            let nonZeroCount = 0
            for (let i = 0; i < Math.min(region.data.length, 1000); i++) {
                if (region.data[i] !== 0) nonZeroCount++
            }
            console.log(`[Debug] Region ${region.widgetId}: ${region.width}x${region.height}, non-zero pixels in first 1000: ${nonZeroCount}`)
        }
        
        // Combine regions for preview
        const bounds = renderer.getVisibleBounds()
        if (bounds) {
            const tempCanvas = document.createElement('canvas')
            tempCanvas.width = bounds.width
            tempCanvas.height = bounds.height
            const ctx = tempCanvas.getContext('2d')!
            
            // Draw each region
            for (const region of capture.regions) {
                // Copy data to ensure we have our own buffer
                const dataCopy = new Uint8ClampedArray(region.data.length)
                dataCopy.set(region.data)
                
                const imageData = new ImageData(
                    dataCopy,
                    region.width,
                    region.height
                )
                // Offset by bounds origin
                ctx.putImageData(imageData, region.x - bounds.x, region.y - bounds.y)
            }
            
            if (capturePreview.value?.startsWith('blob:')) {
                URL.revokeObjectURL(capturePreview.value)
            }
            capturePreview.value = tempCanvas.toDataURL('image/png')
        }
        
        lastCapture.value = {
            width: capture.screenWidth,
            height: capture.screenHeight,
            bytes: capture.totalBytes,
            captureTime,
            regions: capture.regions.length,
            fullFrameBytes,
            savings
        }
        
        console.log('[OverlayDebug] Fragments captured:', {
            regions: capture.regions.length,
            totalBytes: formatBytes(capture.totalBytes),
            fullFrameWouldBe: formatBytes(fullFrameBytes),
            savings: `${savings}%`,
            time: `${captureTime.toFixed(2)}ms`
        })
        
    } catch (error) {
        console.error('[OverlayDebug] Fragment capture failed:', error)
    }
}

async function captureCombined() {
    if (!renderer) return
    
    const startTime = performance.now()
    
    try {
        const region = await renderer.captureCombinedRegion()
        if (!region) {
            console.warn('[OverlayDebug] No visible widgets to capture')
            return
        }
        
        const captureTime = performance.now() - startTime
        const fullFrameBytes = renderer.getFrameInfo().totalBytes
        const savings = Math.round((1 - region.data.length / fullFrameBytes) * 100)
        
        // Create preview
        const tempCanvas = document.createElement('canvas')
        tempCanvas.width = region.width
        tempCanvas.height = region.height
        const ctx = tempCanvas.getContext('2d')!
        const imageData = new ImageData(
            new Uint8ClampedArray(region.data),
            region.width,
            region.height
        )
        ctx.putImageData(imageData, 0, 0)
        
        if (capturePreview.value?.startsWith('blob:')) {
            URL.revokeObjectURL(capturePreview.value)
        }
        capturePreview.value = tempCanvas.toDataURL('image/png')
        
        lastCapture.value = {
            width: region.width,
            height: region.height,
            bytes: region.data.length,
            captureTime,
            regions: 1,
            fullFrameBytes,
            savings
        }
        
        console.log('[OverlayDebug] Combined region captured:', {
            position: `${region.x}, ${region.y}`,
            size: `${region.width}x${region.height}`,
            bytes: formatBytes(region.data.length),
            fullFrameWouldBe: formatBytes(fullFrameBytes),
            savings: `${savings}%`,
            time: `${captureTime.toFixed(2)}ms`
        })
        
    } catch (error) {
        console.error('[OverlayDebug] Combined capture failed:', error)
    }
}

// ==================== Dirty Tile Capture ====================

function updateDirtyTileSize() {
    if (renderer) {
        renderer.setDirtyTileSize(dirtyTileSize.value)
    }
}

function captureDirtyTiles() {
    if (!renderer) return
    
    const startTime = performance.now()
    
    try {
        const capture = renderer.captureDirtyTiles()
        const captureTime = performance.now() - startTime
        
        dirtyStats.value = {
            tilesX: capture.tilesX,
            tilesY: capture.tilesY,
            totalTiles: capture.totalTiles,
            dirtyCount: capture.dirtyCount,
            dirtyPercent: capture.dirtyPercent,
            totalBytes: capture.totalBytes,
            fullRefresh: capture.fullRefresh,
            transparentSkipped: capture.transparentSkipped,
            transparentSaved: capture.transparentSaved
        }
        
        // Create preview showing dirty tiles
        createDirtyPreview(capture)
        
        const fullFrameBytes = capture.screenWidth * capture.screenHeight * 4
        const savings = fullFrameBytes > 0 ? Math.round((1 - capture.totalBytes / fullFrameBytes) * 100) : 0
        
        lastCapture.value = {
            width: capture.screenWidth,
            height: capture.screenHeight,
            bytes: capture.totalBytes,
            captureTime,
            regions: capture.dirtyCount,
            fullFrameBytes,
            savings
        }
        
        console.log('[OverlayDebug] Dirty capture:', {
            tiles: `${capture.dirtyCount}/${capture.totalTiles}`,
            percent: `${capture.dirtyPercent.toFixed(1)}%`,
            bytes: formatBytes(capture.totalBytes),
            transparentSkipped: capture.transparentSkipped,
            transparentSaved: formatBytes(capture.transparentSaved),
            fullWouldBe: formatBytes(fullFrameBytes),
            savings: `${savings}%`,
            time: `${captureTime.toFixed(2)}ms`
        })
        
    } catch (error) {
        console.error('[OverlayDebug] Dirty capture failed:', error)
    }
}

function createDirtyPreview(capture: import('@/lib/overlay').DirtyCapture) {
    // Create a preview that highlights dirty tiles
    const tempCanvas = document.createElement('canvas')
    tempCanvas.width = capture.screenWidth
    tempCanvas.height = capture.screenHeight
    const ctx = tempCanvas.getContext('2d')!
    
    // Clear with dark background
    ctx.fillStyle = '#1a1a1a'
    ctx.fillRect(0, 0, capture.screenWidth, capture.screenHeight)
    
    // Draw each dirty tile
    for (const tile of capture.dirtyTiles) {
        const imageData = new ImageData(
            new Uint8ClampedArray(tile.data),
            tile.width,
            tile.height
        )
        ctx.putImageData(imageData, tile.x, tile.y)
        
        // Draw red border around dirty tiles for visibility
        ctx.strokeStyle = 'rgba(255, 0, 0, 0.5)'
        ctx.lineWidth = 1
        ctx.strokeRect(tile.x + 0.5, tile.y + 0.5, tile.width - 1, tile.height - 1)
    }
    
    // Draw grid overlay
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.1)'
    ctx.lineWidth = 0.5
    for (let x = 0; x < capture.screenWidth; x += capture.tileSize) {
        ctx.beginPath()
        ctx.moveTo(x, 0)
        ctx.lineTo(x, capture.screenHeight)
        ctx.stroke()
    }
    for (let y = 0; y < capture.screenHeight; y += capture.tileSize) {
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(capture.screenWidth, y)
        ctx.stroke()
    }
    
    if (capturePreview.value?.startsWith('blob:')) {
        URL.revokeObjectURL(capturePreview.value)
    }
    capturePreview.value = tempCanvas.toDataURL('image/png')
}

function toggleDirtyStream() {
    if (isDirtyStreaming.value) {
        // Stop streaming
        if (stopDirtyStream) {
            stopDirtyStream()
            stopDirtyStream = null
        }
        isDirtyStreaming.value = false
    } else {
        // Start streaming
        if (!renderer) return
        
        isDirtyStreaming.value = true
        let frameCount = 0
        let totalBytes = 0
        const startTime = performance.now()
        
        stopDirtyStream = renderer.startDirtyCapture((capture) => {
            frameCount++
            totalBytes += capture.totalBytes
            
            // Update stats
            dirtyStats.value = {
                tilesX: capture.tilesX,
                tilesY: capture.tilesY,
                totalTiles: capture.totalTiles,
                dirtyCount: capture.dirtyCount,
                dirtyPercent: capture.dirtyPercent,
                totalBytes: capture.totalBytes,
                fullRefresh: capture.fullRefresh,
                transparentSkipped: capture.transparentSkipped,
                transparentSaved: capture.transparentSaved
            }
            
            // Update preview every 10 frames to avoid overhead
            if (frameCount % 10 === 0) {
                createDirtyPreview(capture)
                
                const elapsed = (performance.now() - startTime) / 1000
                const avgBytesPerSec = totalBytes / elapsed
                console.log(`[DirtyStream] ${frameCount} frames, avg ${formatBytes(avgBytesPerSec)}/s, ${capture.dirtyCount} dirty, ${capture.transparentSkipped} transparent skipped`)
            }
        }, 30, true)
    }
}

// ==================== Native Overlay Bridge ====================

function uint8ToBase64(data: Uint8Array): string {
    let binary = ''
    const len = data.length
    for (let i = 0; i < len; i++) {
        binary += String.fromCharCode(data[i])
    }
    return btoa(binary)
}

async function startNativeBridge() {
    if (!renderer || !isNativeAvailable.value) return
    
    try {
        nativeBridgeError.value = null
        
        // Initialize native overlay controller
        const config = renderer.getInitConfig()
        await native.overlayController.init(config)
        console.log('[NativeBridge] Initialized:', config)
        
        // Start capture loop
        stopNativeCapture = renderer.startDirtyCapture(async (capture) => {
            try {
                // Convert tiles to bridge format
                // Tiles with empty data (length=0) are clear commands for transparent regions
                const bridgeTiles = capture.dirtyTiles.map(tile => ({
                    tx: tile.tileX,
                    ty: tile.tileY,
                    x: tile.x,
                    y: tile.y,
                    w: tile.width,
                    h: tile.height,
                    data: uint8ToBase64(tile.data)
                }))
                
                const clearTiles = bridgeTiles.filter(t => t.data === '').length
                const contentTiles = bridgeTiles.length - clearTiles
                
                if (capture.fullRefresh) {
                    // Full frame
                    await native.overlayController.sendFullFrame({
                        timestamp: Math.floor(capture.timestamp),
                        width: capture.screenWidth,
                        height: capture.screenHeight,
                        tiles: bridgeTiles
                    })
                    console.log('[NativeBridge] Sent full frame:', contentTiles, 'content +', clearTiles, 'clear tiles')
                } else if (bridgeTiles.length > 0) {
                    // Delta update
                    await native.overlayController.sendDelta({
                        timestamp: Math.floor(capture.timestamp),
                        tiles: bridgeTiles,
                        skippedTransparent: capture.transparentSkipped
                    })
                    console.log('[NativeBridge] Sent delta:', contentTiles, 'content +', clearTiles, 'clear tiles')
                }
            } catch (e) {
                console.error('[NativeBridge] Send error:', e)
            }
        }, 30, false) // Don't skip unchanged - first frame needs fullRefresh
        
        nativeBridgeActive.value = true
        console.log('[NativeBridge] Streaming started')
        
    } catch (e) {
        nativeBridgeError.value = e instanceof Error ? e.message : String(e)
        console.error('[NativeBridge] Start error:', e)
    }
}

async function stopNativeBridge() {
    if (stopNativeCapture) {
        stopNativeCapture()
        stopNativeCapture = null
    }
    
    if (nativeBridgeActive.value) {
        try {
            await native.overlayController.clear()
            await native.overlayController.dispose()
        } catch (e) {
            console.error('[NativeBridge] Stop error:', e)
        }
    }
    
    nativeBridgeActive.value = false
    console.log('[NativeBridge] Stopped')
}

// Cleanup preview URL on unmount
onUnmounted(() => {
    // Stop native bridge if active
    stopNativeBridge()
    
    // Stop dirty streaming if active
    if (stopDirtyStream) {
        stopDirtyStream()
        stopDirtyStream = null
    }
    
    if (capturePreview.value && capturePreview.value.startsWith('blob:')) {
        URL.revokeObjectURL(capturePreview.value)
    }
})
</script>

<style scoped>
.overlay-debug-view {
    background: linear-gradient(135deg, hsl(var(--background)) 0%, hsl(240 10% 8%) 100%);
}
</style>