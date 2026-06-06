<script setup lang="ts">
import { useAppState } from "@/store/system/appState";

const appState = useAppState();

function reloadPage() {
  location.reload();
}
</script>

<template>
  <div v-if="appState.isInitializing" class="loading-overlay">
    <Transition name="fade" mode="out-in">
      <!-- Loading: bouncing Argon logo (no progress UI) -->
      <div v-if="!appState.hasInitError" key="loading" class="loader">
        <div class="bouncer">
          <svg class="logo" viewBox="0 0 128 128" xmlns="http://www.w3.org/2000/svg">
            <path fill="currentColor" d="M114.54,88.82c5.35-2.75,9.96-6.72,13.46-11.53c-4.67-3.14-9.86-5.56-15.4-7.09c0.01-24.5-6.29-48.6-18.25-69.73c-7.96,8.45-14.3,18.49-18.62,29.31c-7.66-1.22-15.65-1.06-23.27,0.31C48.13,19.15,41.74,9.02,33.71,0.47C21.76,21.62,15.45,45.7,15.46,70.2c-5.54,1.53-10.73,3.95-15.4,7.09c3.49,4.82,8.1,8.78,13.46,11.53c-3.64,2.85-6.74,6.37-9.14,10.33c5.87,4.32,12.67,7.48,20.05,9.09c19.68,25.4,59.51,25.41,79.2,0c7.38-1.61,14.18-4.78,20.05-9.09C121.28,95.19,118.18,91.68,114.54,88.82z M23.7,68.22c0,0,4.13-2.07,12.4-2.07c8.27,0,19.64,11.37,19.64,11.37s-8.27,6.2-19.64,9.3C32.11,87.91,26.8,77.52,23.7,68.22z M64,98.19c-5.71,0-10.33-4.13-10.33-12.4c1.04-0.35,2.16-0.62,3.3-0.85l3,6.02l1.21-6.61c1.9-0.14,3.84-0.14,5.75,0.01l1.22,6.65l3.01-6.05c1.1,0.23,2.17,0.49,3.18,0.82C74.33,94.05,69.71,98.19,64,98.19z M92.99,86.03c-11.37-3.1-19.63-9.3-19.63-9.3s11.37-11.37,19.63-11.37s12.4,2.07,12.4,2.07C102.29,76.73,96.98,87.12,92.99,86.03z" />
          </svg>
        </div>
        <div class="shadow"></div>
      </div>

      <!-- Error: keep the failure + retry affordance -->
      <div v-else key="error" class="loader loader-error">
        <div class="error-icon">⚠</div>
        <h2 class="error-title">Initialization Failed</h2>
        <p class="error-message">{{ appState.initError }}</p>
        <button @click="reloadPage" class="retry-button">Retry</button>
      </div>
    </Transition>
  </div>
</template>

<style scoped>
.loading-overlay {
  position: fixed;
  top: 0;
  left: 0;
  width: 100vw;
  height: 100vh;
  background: #09090b;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 9999;
  overflow: hidden;
}

.loader {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 14px;
}

/* Bouncing logo */
.bouncer {
  animation: logo-bounce 0.6s ease-in-out infinite;
}

.logo {
  display: block;
  width: 76px;
  height: 76px;
  color: #3b82f6;
}

.shadow {
  width: 56px;
  height: 9px;
  border-radius: 50%;
  background: radial-gradient(ellipse at center, rgba(59, 130, 246, 0.35), transparent 70%);
  animation: shadow-pulse 0.6s ease-in-out infinite;
}

@keyframes logo-bounce {
  0%, 100% { transform: translateY(0); }
  50% { transform: translateY(-20px); }
}

@keyframes shadow-pulse {
  0%, 100% { transform: scaleX(1); opacity: 0.5; }
  50% { transform: scaleX(0.7); opacity: 0.25; }
}

/* Error state */
.loader-error {
  gap: 1rem;
  max-width: 400px;
  padding: 2rem;
  text-align: center;
}

.error-icon {
  font-size: 4rem;
  color: #ef4444;
  animation: error-shake 0.5s ease-in-out, error-pulse 2s ease-in-out infinite;
  display: inline-block;
}

@keyframes error-shake {
  0%, 100% { transform: translateX(0) rotate(0deg); }
  25% { transform: translateX(-10px) rotate(-5deg); }
  75% { transform: translateX(10px) rotate(5deg); }
}

@keyframes error-pulse {
  0%, 100% { transform: scale(1); opacity: 1; }
  50% { transform: scale(1.05); opacity: 0.9; }
}

.error-title {
  font-size: 1.5rem;
  font-weight: 600;
  color: #ef4444;
  margin: 0;
  animation: title-glow 1.5s ease-in-out;
}

@keyframes title-glow {
  0% { text-shadow: 0 0 0 transparent; }
  50% { text-shadow: 0 0 20px rgba(239, 68, 68, 0.5); }
  100% { text-shadow: 0 0 0 transparent; }
}

.error-message {
  font-size: 0.875rem;
  color: #fca5a5;
  margin: 0;
  text-align: center;
  max-width: 400px;
  line-height: 1.5;
}

.retry-button {
  margin-top: 1rem;
  padding: 0.75rem 2rem;
  background: #6366f1;
  color: white;
  border: none;
  border-radius: 0.375rem;
  font-size: 0.875rem;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.2s ease;
  display: flex;
  align-items: center;
  gap: 0.5rem;
  box-shadow: 0 4px 12px rgba(99, 102, 241, 0.3);
}

.retry-button:hover {
  background: #818cf8;
  transform: translateY(-2px);
  box-shadow: 0 6px 16px rgba(99, 102, 241, 0.4);
}

.retry-button:active {
  background: #4f46e5;
  transform: translateY(0);
}

/* Fade between loading and error */
.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.3s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
</style>
