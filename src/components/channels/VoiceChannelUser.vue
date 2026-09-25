<template>
  <div
    class="flex items-center py-0.5 px-1 rounded-md text-muted-foreground hover:text-foreground hover:bg-foreground/[0.04] transition-all duration-150"
    :class="{ 'opacity-55': connecting }"
  >
    <ArgonAvatar
      :fallback="user.User.displayName"
      :fileId="user.User.avatarFileId"
      :userId="user.userId"
      :class="[
        'w-7 h-7 rounded-full mr-3 transition-all duration-300 ease-in-out flex-shrink-0',
        { 'ring-2 ring-lime-400/80 shadow-[0_0_20px_rgba(132,255,90,0.6)]': isSpeaking }
      ]"
    />
    <span class="text-sm truncate" :title="user.User.displayName">{{ user.User.displayName }}</span>
    <div class="flex items-center gap-1 ml-auto flex-shrink-0">
      <span v-if="connecting" class="flex items-center" :title="t('connecting')">
        <Loader2Icon class="w-3.5 h-3.5 animate-spin text-muted-foreground" />
      </span>
      <template v-else>
        <span
          v-if="indicators.micOff"
          data-indicator="mic"
          :data-by-server="indicators.micByServer || undefined"
          :class="['voice-flag', indicators.micByServer ? 'voice-flag--server' : 'voice-flag--self']"
          :title="indicators.micByServer ? t('voice_member_server_muted') : t('muted')"
        >
          <MicOffIcon class="w-4 h-4" />
          <ShieldIcon v-if="indicators.micByServer" class="voice-flag__badge" />
        </span>
        <span
          v-if="indicators.headphonesOff"
          data-indicator="headphones"
          :data-by-server="indicators.headphonesByServer || undefined"
          :class="['voice-flag', indicators.headphonesByServer ? 'voice-flag--server' : 'voice-flag--self']"
          :title="indicators.headphonesByServer ? t('voice_member_server_deafened') : t('deafened')"
        >
          <HeadphoneOffIcon class="w-4 h-4" />
          <ShieldIcon v-if="indicators.headphonesByServer" class="voice-flag__badge" />
        </span>
        <span v-if="indicators.streaming" data-indicator="streaming" class="voice-flag" :title="t('voice_member_streaming')">
          <ScreenShare class="w-4 h-4 text-primary" />
        </span>
        <RadiusIcon v-if="user.isRecording" class="w-4 h-4 text-destructive" />
      </template>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue';
import {
  MicOffIcon, HeadphoneOffIcon, ScreenShare, RadiusIcon, Loader2 as Loader2Icon, ShieldIcon,
} from 'lucide-vue-next';
import ArgonAvatar from './../ArgonAvatar.vue';
import { useUnifiedCall } from '@/store/media/unifiedCallStore';
import { useLocale } from '@/store/system/localeStore';
import { useVoiceIndicators } from '@/composables/useVoiceIndicators';
import type { IRealtimeChannelUser } from '@/store/realtime/realtimeStore';

const props = defineProps<{
  user: IRealtimeChannelUser;
  /** The voice channel this row belongs to; decides whether live room state applies. */
  channelId?: string | null;
  connecting?: boolean;
}>();

const voice = useUnifiedCall();
const { t } = useLocale();
const { indicatorsFor } = useVoiceIndicators();

const isSpeaking = computed(() => {
  // Explicitly track speaking.size to ensure Vue detects changes in the Set
  const _ = voice.speaking.size;
  return voice.speaking.has(props.user.userId);
});

const indicators = computed(() => indicatorsFor(props.user.userId, props.channelId, props.user.state));
</script>

<style scoped>
.voice-flag {
  position: relative;
  display: inline-flex;
  align-items: center;
}

.voice-flag--self {
  color: hsl(var(--destructive) / 0.7);
}

/* A moderator's restriction: full-strength red and a shield, so it never reads as a self-mute. */
.voice-flag--server {
  color: hsl(0 84% 55%);
}

.voice-flag__badge {
  position: absolute;
  right: -3px;
  bottom: -3px;
  width: 9px;
  height: 9px;
  color: hsl(0 84% 55%);
  fill: hsl(var(--background));
  stroke-width: 3;
}
</style>
