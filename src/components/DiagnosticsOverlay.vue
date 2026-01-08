<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue';
import { useUserStore } from '@/store/userStore';
import { useChannelStore } from '@/store/channelStore';
import { db } from '@/store/db/dexie';

const userStore = useUserStore();
const channelStore = useChannelStore();

const fps = ref(0);
const memoryUsage = ref({ used: 0, total: 0 });
const dbStats = ref({ tables: 0, records: 0 });
const lastUpdateTime = ref(0);

let frameCount = 0;
let lastTime = performance.now();
let animationFrameId: number;
let statsInterval: ReturnType<typeof setInterval>;

// FPS calculation
const updateFPS = () => {
  frameCount++;
  const currentTime = performance.now();
  const deltaTime = currentTime - lastTime;

  if (deltaTime >= 1000) {
    fps.value = Math.round((frameCount * 1000) / deltaTime);
    frameCount = 0;
    lastTime = currentTime;
  }

  animationFrameId = requestAnimationFrame(updateFPS);
};

// Memory usage (если доступно)
const updateMemoryUsage = () => {
  if ('memory' in performance && (performance as any).memory) {
    const mem = (performance as any).memory;
    memoryUsage.value = {
      used: Math.round(mem.usedJSHeapSize / 1024 / 1024),
      total: Math.round(mem.totalJSHeapSize / 1024 / 1024),
    };
  }
};

// IndexedDB stats
const updateDBStats = async () => {
  try {
    const tables = db.tables.length;
    let totalRecords = 0;
    
    for (const table of db.tables) {
      const count = await table.count();
      totalRecords += count;
    }
    
    dbStats.value = { tables, records: totalRecords };
  } catch (err) {
    console.error('Failed to get DB stats:', err);
  }
};

// Update stats every 500ms for smooth updates
const updateStats = async () => {
  updateMemoryUsage();
  lastUpdateTime.value = performance.now();
};

const fullUpdate = async () => {
  await updateDBStats();
};

const userDiagnostics = computed(() => userStore.getDiagnostics());
const channelDiagnostics = computed(() => channelStore.getDiagnostics());

const allSlowQueries = computed(() => {
  const combined = [
    ...userDiagnostics.value.slowQueries.map(q => ({ ...q, store: 'User' })),
    ...channelDiagnostics.value.slowQueries.map(q => ({ ...q, store: 'Channel' }))
  ];
  return combined.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
});

onMounted(() => {
  updateFPS();
  updateStats();
  updateDBStats();
  statsInterval = setInterval(updateStats, 500);
  setInterval(fullUpdate, 2000);
});

onUnmounted(() => {
  if (animationFrameId) {
    cancelAnimationFrame(animationFrameId);
  }
  if (statsInterval) {
    clearInterval(statsInterval);
  }
});

const formatBytes = (bytes: number) => {
  return `${bytes}MB`;
};

const formatTime = (ms: number) => {
  return `${ms.toFixed(1)}ms`;
};

const getSeverityClass = (duration: number) => {
  if (duration > 5000) return 'severity-critical';
  if (duration > 1000) return 'severity-high';
  if (duration > 500) return 'severity-medium';
  return '';
};
</script>

<template>
  <div class="diagnostics-overlay">
    <div class="diag-section">
      <div class="diag-title">⚡ PERFORMANCE</div>
      <div class="diag-line">FPS: <span class="diag-value">{{ fps }}</span></div>
      <div class="diag-line" v-if="memoryUsage.total > 0">
        Memory: <span class="diag-value">{{ formatBytes(memoryUsage.used) }} / {{ formatBytes(memoryUsage.total) }}</span>
      </div>
    </div>

    <div class="diag-section">
      <div class="diag-title">💾 IndexedDB</div>
      <div class="diag-line">Tables: <span class="diag-value">{{ dbStats.tables }}</span></div>
      <div class="diag-line">Records: <span class="diag-value">{{ dbStats.records }}</span></div>
      <div class="diag-line">Queries: <span class="diag-value">{{ userDiagnostics.totalQueriesExecuted + channelDiagnostics.totalQueriesExecuted }}</span></div>
    </div>

    <div class="diag-section">
      <div class="diag-title">👥 USER STORE</div>
      <div class="diag-line">
        Calls/sec: 
        <span class="diag-value" :class="{ 'diag-warn': userDiagnostics.callsPerSecond > 50 }">
          {{ userDiagnostics.callsPerSecond }}
        </span>
      </div>
      <div class="diag-line">
        Cache Hit Rate: <span class="diag-value">{{ userDiagnostics.cacheHitRate }}</span>
      </div>
      <div class="diag-line">
        Cache Size: <span class="diag-value">{{ userDiagnostics.cacheSize }}</span>
      </div>
      <div class="diag-line" v-if="userDiagnostics.pendingRequests > 0">
        Pending: <span class="diag-warn">{{ userDiagnostics.pendingRequests }}</span>
      </div>
      <div class="diag-line">
        Active Subs: 
        <span class="diag-value" :class="{ 'diag-warn': userDiagnostics.activeSubscriptions > 50 }">
          {{ userDiagnostics.activeSubscriptions }}
        </span>
      </div>
      <div class="diag-line">
        Total Created: <span class="diag-value">{{ userDiagnostics.totalSubscriptionsCreated }}</span>
      </div>
      <div class="diag-line">
        Critical (>1s): <span class="diag-value" :class="{ 'diag-warn': userDiagnostics.criticalQueries > 0 }">
          {{ userDiagnostics.criticalQueries }}
        </span>
      </div>
      <div class="diag-line" v-if="userDiagnostics.deduplicatedRequests > 0">
        Deduped: <span class="diag-value">{{ userDiagnostics.deduplicatedRequests }}</span>
      </div>
      <div class="diag-line" v-if="userDiagnostics.errorCount > 0">
        Errors: <span class="diag-warn">{{ userDiagnostics.errorCount }}</span>
      </div>
    </div>

    <div class="diag-section">
      <div class="diag-title">📺 CHANNEL STORE</div>
      <div class="diag-line">
        Active Subs: 
        <span class="diag-value" :class="{ 'diag-warn': channelDiagnostics.activeSubscriptions > 20 }">
          {{ channelDiagnostics.activeSubscriptions }}
        </span>
      </div>
      <div class="diag-line">
        Critical (>1s): <span class="diag-value" :class="{ 'diag-warn': channelDiagnostics.criticalQueries > 0 }">
          {{ channelDiagnostics.criticalQueries }}
        </span>
      </div>
      <div class="diag-line" v-if="channelDiagnostics.errorCount > 0">
        Errors: <span class="diag-warn">{{ channelDiagnostics.errorCount }}</span>
      </div>
    </div>

    <div class="diag-section slow-queries" v-if="allSlowQueries.length > 0">
      <div class="diag-title">🐌 SLOW QUERIES (last 20, >100ms)</div>
      <div class="query-list">
        <div class="diag-line small" v-for="(query, idx) in allSlowQueries" :key="idx" :class="getSeverityClass(query.duration)">
          <span class="query-store" :class="`store-${query.store.toLowerCase()}`">{{ query.store[0] }}</span>
          <span class="query-duration">{{ formatTime(query.duration) }}</span>
          <span class="query-op">{{ query.operation.substring(0, 45) }}</span>
        </div>
      </div>
    </div>

    <div class="diag-footer">
      Alt+Shift+7 to toggle
    </div>
  </div>
</template>

<style scoped>
.diagnostics-overlay {
  position: fixed;
  top: 10px;
  right: 10px;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(4px);
  border: 2px solid #a855f7;
  border-radius: 6px;
  padding: 14px;
  font-family: 'Courier New', monospace;
  font-size: 11px;
  color: #d8b4fe;
  z-index: 99999;
  pointer-events: none;
  user-select: none;
  min-width: 320px;
  max-width: 450px;
  max-height: 90vh;
  overflow-y: auto;
  box-shadow: 0 0 30px rgba(168, 85, 247, 0.5), inset 0 0 20px rgba(168, 85, 247, 0.1);
}

.diagnostics-overlay::-webkit-scrollbar {
  width: 6px;
}

.diagnostics-overlay::-webkit-scrollbar-track {
  background: rgba(168, 85, 247, 0.1);
}

.diagnostics-overlay::-webkit-scrollbar-thumb {
  background: #a855f7;
  border-radius: 3px;
}

.diag-section {
  margin-bottom: 12px;
  padding-bottom: 8px;
  border-bottom: 1px solid rgba(168, 85, 247, 0.2);
}

.diag-section:last-of-type {
  border-bottom: none;
}

.diag-title {
  font-size: 10px;
  font-weight: bold;
  color: #a855f7;
  margin-bottom: 6px;
  letter-spacing: 0.5px;
  text-shadow: 0 0 8px rgba(168, 85, 247, 0.6);
}

.diag-line {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 4px;
  color: #e9d5ff;
  line-height: 1.4;
}

.diag-line.small {
  font-size: 9px;
  flex-direction: column;
  align-items: flex-start;
  gap: 2px;
}

.diag-value {
  font-weight: bold;
  color: #c084fc;
  text-shadow: 0 0 4px rgba(192, 132, 252, 0.4);

.slow-queries {
  max-height: 300px;
}

.query-list {
  display: flex;
  flex-direction: column;
  gap: 3px;
}

.diag-line.small {
  font-size: 9px;
  flex-direction: row;
  align-items: center;
  gap: 8px;
  padding: 3px 6px;
  border-radius: 3px;
  background: rgba(168, 85, 247, 0.05);
}

.query-store {
  font-weight: bold;
  font-size: 10px;
  width: 18px;
  height: 18px;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 3px;
  background: rgba(99, 102, 241, 0.3);
  flex-shrink: 0;
}

.query-store.store-user {
  background: rgba(168, 85, 247, 0.3);
  color: #c084fc;
}

.query-store.store-channel {
  background: rgba(34, 197, 94, 0.3);
  color: #4ade80;
}

.query-duration {
  font-weight: bold;
  min-width: 70px;
  text-align: right;
}

.query-op {
  flex: 1;
  opacity: 0.8;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.severity-medium {
  background: rgba(251, 191, 36, 0.1) !important;
  border-left: 2px solid #fbbf24;
}

.severity-high {
  background: rgba(249, 115, 22, 0.1) !important;
  border-left: 2px solid #f97316;
}

.severity-high .query-duration {
  color: #fb923c !important;
}

.severity-critical {
  background: rgba(239, 68, 68, 0.15) !important;
  border-left: 2px solid #ef4444;
  animation: critical-pulse 2s ease-in-out infinite;
}

.severity-critical .query-duration {
  color: #f87171 !important;
  text-shadow: 0 0 8px rgba(248, 113, 113, 0.6);
}

@keyframes critical-pulse {
  0%, 100% { 
    box-shadow: 0 0 0 rgba(239, 68, 68, 0);
  }
  50% { 
    box-shadow: 0 0 10px rgba(239, 68, 68, 0.4);
  }
}
}

.diag-warn {
  color: #fbbf24 !important;
  text-shadow: 0 0 6px rgba(251, 191, 36, 0.5) !important;
}

.diag-footer {
  margin-top: 8px;
  padding-top: 8px;
  border-top: 1px solid rgba(168, 85, 247, 0.2);
  text-align: center;
  font-size: 9px;
  color: #a78bfa;
  opacity: 0.6;
}
</style>
