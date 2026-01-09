<template>
  <li class="flex items-center mt-1 text-gray-400 hover:text-white">
    <ArgonAvatar 
      :fallback="user.User.displayName" 
      :fileId="user.User.avatarFileId" 
      :userId="user.userId"
      :class="[
        'w-7 h-7 rounded-full mr-3 transition-all duration-300 ease-in-out',
        { 'ring-2 ring-lime-400/80 shadow-[0_0_20px_rgba(132,255,90,0.6)]': isSpeaking }
      ]"
    />
    <span>{{ user.User.displayName }}</span>
    <div class="flex items-center gap-1" style="margin-left: auto;">
      <MicOffIcon v-if="isMuted" width="16" height="16" />
      <HeadphoneOffIcon v-if="isHeadphoneMuted" width="16" height="16" />
      <ScreenShare v-if="user.isScreenShare" width="16" height="16" />
      <RadiusIcon v-if="user.isRecording" width="16" height="16" style="color: red;" />
    </div>
  </li>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import { MicOffIcon, HeadphoneOffIcon, ScreenShare, RadiusIcon } from 'lucide-vue-next';
import ArgonAvatar from './../ArgonAvatar.vue';
import { useUnifiedCall } from '@/store/unifiedCallStore';
import { useSystemStore } from '@/store/systemStore';
import { useMe } from '@/store/meStore';
import type { Guid } from '@argon-chat/ion.webcore';
import type { IRealtimeChannelUser } from '@/store/realtimeStore';

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
