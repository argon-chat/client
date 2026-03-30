// Barrel exports for all stores — organized by domain

// Auth
export { useAuthStore } from './auth/authStore';
export { useMe } from './auth/meStore';

// Data
export { useUserStore } from './data/userStore';
export { useChannelStore } from './data/channelStore';
export { useMessageStore } from './data/messageStore';
export { usePoolStore } from './data/poolStore';
export { useArchetypeStore } from './data/archetypeStore';
export { useSpaceStore } from './data/serverStore';
export { usePexStore } from './data/permissionStore';

// Realtime
export { useBus } from './realtime/busStore';
export { useRealtimeStore } from './realtime/realtimeStore';
export { useEventStore } from './realtime/eventStore';

// Media
export { useCallManager } from './media/callManagerStore';
export { useUnifiedCall } from './media/unifiedCallStore';
export { useTone } from './media/toneStore';
export { useUserVolumeStore } from './media/userVolumeStore';
export { usePredictor } from './media/predictorStore';

// UI
export { useWindow } from './ui/windowStore';
export { useIdleStore } from './ui/idleStore';
export { useHotkeys } from './ui/hotKeyStore';
export { useConfigStore } from './ui/configStore';
export { usePreference } from './ui/preferenceStore';

// Features
export { usePlayFrameActivity } from './features/playframeStore';
export { useFeatureFlags } from './features/featureFlagsStore';
export { useActivity } from './features/activityStore';

// System
export { useAppState } from './system/appState';
export { useConfig } from './system/remoteConfig';
export { useFileStorage } from './system/fileStorage';
export { useLocale } from './system/localeStore';
export { useSystemStore } from './system/systemStore';
export { useApi } from './system/apiStore';

// Chat
export { useRecentChatsStore } from './chat/useRecentChatsStore';
export { useUserColors } from './chat/userColors';

// DB
export { db } from './db/dexie';
