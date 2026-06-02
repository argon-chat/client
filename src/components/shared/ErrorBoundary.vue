<script setup lang="ts">
import { ref, onErrorCaptured } from "vue";
import { logger } from "@argon/core";

const hasError = ref(false);
const message = ref("");

onErrorCaptured((err) => {
  hasError.value = true;
  message.value = err instanceof Error ? err.message : String(err);
  logger.error("[error-boundary] captured render error:", err);
  return false; // stop propagation past the boundary
});

function reload() {
  location.reload();
}

function dismiss() {
  hasError.value = false;
  message.value = "";
}
</script>

<template>
  <slot v-if="!hasError" />

  <div v-else class="error-boundary">
    <div class="eb-card">
      <div class="eb-icon">⚠</div>
      <h2 class="eb-title">Something went wrong</h2>
      <p v-if="message" class="eb-msg">{{ message }}</p>
      <div class="eb-actions">
        <button class="eb-btn eb-btn-primary" @click="reload">Reload app</button>
        <button class="eb-btn" @click="dismiss">Dismiss</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.error-boundary {
  position: fixed;
  inset: 0;
  z-index: 9998;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(0, 0, 0, 0.9);
  backdrop-filter: blur(8px);
}

.eb-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 1rem;
  max-width: 420px;
  padding: 2rem;
  text-align: center;
}

.eb-icon {
  font-size: 3rem;
  color: #ef4444;
}

.eb-title {
  font-size: 1.25rem;
  font-weight: 600;
  color: #fafafa;
  margin: 0;
}

.eb-msg {
  font-size: 0.85rem;
  color: #a1a1aa;
  margin: 0;
  line-height: 1.5;
  word-break: break-word;
}

.eb-actions {
  display: flex;
  gap: 0.75rem;
  margin-top: 0.5rem;
}

.eb-btn {
  padding: 0.5rem 1.25rem;
  border: 1px solid hsl(var(--border, 0 0% 30%));
  border-radius: 0.5rem;
  background: transparent;
  color: #e4e4e7;
  font-size: 0.85rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.05s ease;
}

.eb-btn:hover {
  background: rgba(255, 255, 255, 0.08);
}

.eb-btn:active {
  transform: translateY(1px);
}

.eb-btn-primary {
  background: #6366f1;
  border-color: #6366f1;
  color: #fff;
}

.eb-btn-primary:hover {
  background: #818cf8;
}
</style>
