<script setup lang="ts">
import { ref, computed, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { usePoolStore } from '@/store/poolStore';
import { useLocale } from '@/store/localeStore';
import { useVersionChecker } from '@/lib/useVersionChecker';
import { useNotifications } from '@/composables/useNotifications';
import IconSw from "@argon/assets/icons/icon_cat.svg";
import { IconArrowBigDownFilled, IconHome, IconMessageReport } from '@tabler/icons-vue';
import { NBadge } from 'naive-ui';

const { t } = useLocale();
const route = useRoute();
const router = useRouter();
const pool = usePoolStore();
const isMaximized = ref(false);
const isMac = computed(() => !navigator.userAgent.includes('Mac'));
const { needsUpdate, doUpdate } = useVersionChecker();
const { totalNotifications } = useNotifications();

// Current context breadcrumb
const currentServerName = ref<string | null>(null);
const isHome = computed(() => route.path.includes('/home'));

watch(
  () => pool.selectedServer,
  async (id) => {
    if (!id) { currentServerName.value = null; return; }
    const server = await pool.getServer(id);
    currentServerName.value = server?.name ?? null;
  },
  { immediate: true }
);

const emit = defineEmits<{
  (e: 'home'): void
  (e: 'feedback'): void
}>();

function goHome() {
  pool.selectedServer = null;
  router.push({ name: 'HomeShellView' });
  emit('home');
}

const windowMinimize = () => {
  (window as any).windowManagement?.minimize?.();
};
const windowMaximize = async () => {
  (window as any).windowManagement?.maximize?.();
  isMaximized.value = await (window as any).windowManagement.isMaximized();
};
const windowClose = () => {
  (window as any).windowManagement?.close?.();
};
</script>

<template>
  <div class="app-titlebar" :class="{ 'app-titlebar--mac': isMac }">
    <!-- Mac: traffic lights on the left -->
    <div v-if="isMac" class="titlebar-controls titlebar-controls--mac">
      <button class="mac-btn mac-close" @click="windowClose" title="Close">
        <svg width="6" height="6" viewBox="0 0 6 6">
          <line x1="0" y1="0" x2="6" y2="6" stroke="currentColor" stroke-width="1.2" />
          <line x1="6" y1="0" x2="0" y2="6" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
      <button class="mac-btn mac-minimize" @click="windowMinimize" title="Minimize">
        <svg width="8" height="1" viewBox="0 0 8 1">
          <rect width="8" height="1" fill="currentColor" />
        </svg>
      </button>
      <button class="mac-btn mac-maximize" @click="windowMaximize" :title="isMaximized ? 'Restore' : 'Maximize'">
        <svg width="6" height="6" viewBox="0 0 6 6">
          <polygon v-if="!isMaximized" points="0,3 3,0 6,3 3,6" fill="currentColor" />
          <rect v-else x="0.5" y="0.5" width="5" height="5" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
    </div>

    <!-- App icon (home) + breadcrumb -->
    <button class="titlebar-brand" @click="goHome" :title="t('dashboard')">
      <IconSw class="brand-icon" :class="{ 'brand-icon--active': isHome }" />
      <span v-if="totalNotifications > 0" class="brand-badge"></span>
    </button>

    <div class="titlebar-separator"></div>

    <Transition name="breadcrumb-fade" mode="out-in">
      <span v-if="isHome" key="home" class="breadcrumb">
        <IconHome class="breadcrumb-icon" />
        {{ t("dashboard") }}
      </span>
      <span v-else-if="currentServerName" :key="currentServerName" class="breadcrumb">
        {{ currentServerName }}
      </span>
    </Transition>

    <div class="titlebar-drag-region"></div>

    <!-- Right actions -->
    <div class="titlebar-actions">
      <Transition name="update-pop">
        <button v-if="needsUpdate" class="update-btn" @click="doUpdate" :title="t('update_is_ready')">
          <IconArrowBigDownFilled class="w-3.5 h-3.5" />
          <span class="update-label">{{ t("update_is_ready") }}</span>
        </button>
      </Transition>

      <button class="action-btn" @click="emit('feedback')" :title="t('send_feedback')">
        <IconMessageReport class="w-4 h-4" />
      </button>
    </div>

    <!-- Windows: controls on the right -->
    <div v-if="!isMac" class="titlebar-controls titlebar-controls--win">
      <button class="win-btn" @click="windowMinimize" title="Minimize">
        <svg width="10" height="1" viewBox="0 0 10 1">
          <rect width="10" height="1" fill="currentColor" />
        </svg>
      </button>
      <button class="win-btn" @click="windowMaximize" :title="isMaximized ? 'Restore' : 'Maximize'">
        <svg v-if="!isMaximized" width="10" height="10" viewBox="0 0 10 10">
          <rect x="0" y="0" width="10" height="10" fill="none" stroke="currentColor" stroke-width="1" />
        </svg>
        <svg v-else width="10" height="10" viewBox="0 0 10 10">
          <rect x="2" y="0" width="8" height="8" fill="none" stroke="currentColor" stroke-width="1" />
          <rect x="0" y="2" width="8" height="8" fill="hsl(var(--card))" stroke="currentColor" stroke-width="1" />
        </svg>
      </button>
      <button class="win-btn win-close" @click="windowClose" title="Close">
        <svg width="10" height="10" viewBox="0 0 10 10">
          <line x1="0" y1="0" x2="10" y2="10" stroke="currentColor" stroke-width="1.2" />
          <line x1="10" y1="0" x2="0" y2="10" stroke="currentColor" stroke-width="1.2" />
        </svg>
      </button>
    </div>
  </div>
</template>

<style scoped>
.app-titlebar {
  display: flex;
  align-items: center;
  height: 38px;
  min-height: 38px;
  background-color: hsl(var(--card));
  border: 1px solid hsl(var(--border) / 0.5);
  border-top: none;
  border-radius: 0 0 15px 15px;
  -webkit-app-region: drag;
  user-select: none;
  padding: 0 4px;
}

/* ---- Brand / Breadcrumb ---- */
.titlebar-brand {
  display: flex;
  align-items: center;
  position: relative;
  padding: 4px 10px;
  margin: 3px 0 3px 4px;
  border: none;
  background: transparent;
  border-radius: 10px;
  cursor: pointer;
  -webkit-app-region: no-drag;
  transition: background 0.15s ease;
}

.titlebar-brand:hover {
  background: hsl(var(--accent));
}

.titlebar-brand:active {
  background: hsl(var(--accent) / 0.5);
}

.brand-icon {
  width: 22px;
  height: 22px;
  fill: hsl(var(--muted-foreground));
  flex-shrink: 0;
  transition: fill 0.2s ease, transform 0.2s ease;
}

.brand-icon--active {
  fill: hsl(var(--primary));
}

.titlebar-brand:hover .brand-icon {
  fill: hsl(var(--primary));
  transform: scale(1.1);
}

.brand-badge {
  position: absolute;
  top: 2px;
  right: 4px;
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: #ef4444;
  border: 2px solid hsl(var(--card));
}

.titlebar-separator {
  width: 1px;
  height: 18px;
  background: hsl(var(--border));
  margin: 0 6px;
  flex-shrink: 0;
}

.breadcrumb {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 0.8rem;
  font-weight: 500;
  color: hsl(var(--muted-foreground));
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  max-width: 200px;
  -webkit-app-region: no-drag;
}

.breadcrumb-icon {
  width: 14px;
  height: 14px;
  flex-shrink: 0;
}

.breadcrumb-fade-enter-active,
.breadcrumb-fade-leave-active {
  transition: opacity 0.2s ease, transform 0.15s ease;
}
.breadcrumb-fade-enter-from {
  opacity: 0;
  transform: translateY(4px);
}
.breadcrumb-fade-leave-to {
  opacity: 0;
  transform: translateY(-4px);
}

.titlebar-drag-region {
  flex: 1;
  height: 100%;
  -webkit-app-region: drag;
}

/* ---- Right actions ---- */
.titlebar-actions {
  display: flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  -webkit-app-region: no-drag;
}

.action-btn {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 28px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  border-radius: 8px;
  cursor: pointer;
  transition: background 0.15s ease, color 0.15s ease;
  -webkit-app-region: no-drag;
}

.action-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.action-btn:active {
  background: hsl(var(--accent) / 0.5);
}

.update-btn {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 4px 12px;
  border: none;
  border-radius: 10px;
  background: #48bf32;
  color: white;
  font-size: 0.75rem;
  font-weight: 600;
  cursor: pointer;
  transition: background 0.15s ease, transform 0.15s ease;
  -webkit-app-region: no-drag;
}

.update-btn:hover {
  background: #3da829;
  transform: scale(1.03);
}

.update-btn:active {
  background: #349023;
  transform: scale(0.97);
}

.update-label {
  white-space: nowrap;
}

.update-pop-enter-active {
  transition: opacity 0.3s ease, transform 0.3s ease;
}
.update-pop-leave-active {
  transition: opacity 0.2s ease, transform 0.2s ease;
}
.update-pop-enter-from {
  opacity: 0;
  transform: scale(0.8) translateY(4px);
}
.update-pop-leave-to {
  opacity: 0;
  transform: scale(0.8);
}

/* ---- Windows controls ---- */
.titlebar-controls--win {
  display: flex;
  height: 100%;
  -webkit-app-region: no-drag;
}

.win-btn {
  width: 40px;
  height: 100%;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background-color 0.15s ease, color 0.15s ease;
  -webkit-app-region: no-drag;
  border-radius: 12px;
}

.win-btn:hover {
  background: hsl(var(--accent));
  color: hsl(var(--accent-foreground));
}

.win-btn:active {
  background: hsl(var(--accent) / 0.5);
}

.win-close:hover {
  background: #e81123;
  color: #ffffff;
}

.win-close:active {
  background: #bf0f1d;
}

/* ---- Mac controls ---- */
.app-titlebar--mac {
  flex-direction: row;
}

.titlebar-controls--mac {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  -webkit-app-region: no-drag;
}

.mac-btn {
  width: 12px;
  height: 12px;
  border-radius: 50%;
  border: none;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  color: transparent;
  transition: color 0.1s ease;
  -webkit-app-region: no-drag;
}

.mac-close {
  background: #ff5f57;
}

.mac-minimize {
  background: #febc2e;
}

.mac-maximize {
  background: #28c840;
}

.titlebar-controls--mac:hover .mac-btn {
  color: rgba(0, 0, 0, 0.6);
}

.mac-btn:active {
  filter: brightness(0.8);
}
</style>
