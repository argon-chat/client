<template>
  <li class="flex items-center mt-1 py-0.5 px-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-colors duration-150">
    <ArgonAvatar 
      :fallback="user.User.displayName" 
      :fileId="user.User.avatarFileId" 
      :userId="user.userId"
      :class="[
        'w-7 h-7 rounded-full mr-3 transition-all duration-300 ease-in-out flex-shrink-0',
        { 'ring-2 ring-lime-400/80 shadow-[0_0_20px_rgba(132,255,90,0.6)]': isSpeaking }
      ]"
    />
    <span class="text-sm truncate">{{ user.User.displayName }}</span>
    <div class="flex items-center gap-1 ml-auto flex-shrink-0">
      <MicOffIcon v-if="isMuted" class="w-4 h-4 text-destructive/70" />
      <HeadphoneOffIcon v-if="isHeadphoneMuted" class="w-4 h-4 text-destructive/70" />
      <ScreenShare v-if="user.isScreenShare" class="w-4 h-4 text-primary" />
      <RadiusIcon v-if="user.isRecording" class="w-4 h-4 text-destructive" />
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { MicOffIcon, HeadphoneOffIcon, ScreenShare, RadiusIcon } from 'lucide-vue-next';
import ArgonAvatar from './../ArgonAvatar.vue';
import { useUnifiedCall } from '@/store/media/unifiedCallStore';
import { useSystemStore } from '@/store/system/systemStore';
import { useMe } from '@/store/auth/meStore';
import type { Guid } from '@argon-chat/ion.webcore';
import type { IRealtimeChannelUser } from '@/store/realtime/realtimeStore';

const props = defineProps<{
  user: IRealtimeChannelUser;
}>();

const voice = useUnifiedCall();
const sys = useSystemStore();
const me = useMe();

const isSpeaking = computed(() => {
  // Explicitly track speaking.size to ensure Vue detects changes in the Set
  const _ = voice.speaking.size;
  return voice.speaking.has(props.user.userId);
});

const isMuted = computed(() => {
  const uid = props.user.userId;
  const myId = me.me?.userId;
  
  // Explicitly read these reactive values to ensure Vue tracks them
  const sysMicMuted = sys.microphoneMuted;
  
  // Check if this is the local user - use sys like in ChatPanel
  if (myId && uid === myId) {
    return sysMicMuted;
  }
  
  // Check remote participant
  const participant = voice.participants[uid];
  return participant?.muted ?? false;
});

const isHeadphoneMuted = computed(() => {
  const uid = props.user.userId;
  const myId = me.me?.userId;
  
  // Explicitly read these reactive values to ensure Vue tracks them
  const sysHeadMuted = sys.headphoneMuted;
  
  // Check if this is the local user - use sys like in ChatPanel
  if (myId && uid === myId) {
    return sysHeadMuted;
  }
  
  // Check remote participant
  const participant = voice.participants[uid];
  return participant?.mutedAll ?? false;
});
</script>
