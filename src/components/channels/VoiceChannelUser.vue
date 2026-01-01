<template>
  <li class="flex items-center mt-1 text-gray-400 hover:text-white">
    <ArgonAvatar 
      :fallback="user.User.displayName" 
      :fileId="user.User.avatarFileId" 
      :userId="user.userId"
      :style="(user.isSpeaking ? 'outline: solid #45d110 2px; outline-offset: 2px; border-radius: 500px;' : '')"
      class="w-7 h-7 rounded-full mr-3 transition" 
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

const props = defineProps<{
  user: any;
}>();

const voice = useUnifiedCall();
const sys = useSystemStore();
const me = useMe();

const localUserId = computed<Guid | null>(() => {
  const r = voice.room;
  return r?.localParticipant?.identity ?? null;
});

const isMuted = computed(() => {
  const localId = localUserId.value;
  const uid = props.user.userId;
  if (localId && uid === localId) return sys.microphoneMuted;
  const participant = voice.participants.get(uid);
  return participant?.muted ?? false;
});

const isHeadphoneMuted = computed(() => {
  const localId = localUserId.value;
  const uid = props.user.userId;
  if (localId && uid === localId) return sys.headphoneMuted;
  const participant = voice.participants.get(uid);
  return participant?.mutedAll ?? false;
});
</script>
