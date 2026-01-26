<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="sm:max-w-[600px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-8 space-y-6"
    >
      <div
        class="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-primary/5 pointer-events-none rounded-2xl"
      ></div>
      
      <div class="relative text-center space-y-2">
        <h2 class="text-3xl font-extrabold text-foreground tracking-wide">
          {{ t("add_channel") }}
        </h2>
      </div>
      
      <div class="relative space-y-3">
        <InputWithError 
          v-model="channelName" 
          :error="addChannelError" 
          @clear-error="addChannelError = ''" 
          :placeholder="t('channel_name')"
        >
          <template #label>
            <Label
              for="channel-name"
              class="text-muted-foreground flex items-center gap-2"
            >
              <span class="i-lucide-plus-circle text-primary"></span>
              {{ t("name") }}
            </Label>
          </template>
        </InputWithError>
      </div>
      
      <div class="relative space-y-3">
        <Label class="text-sm font-medium text-muted-foreground">
          {{ t("channel_type") }}
        </Label>
        
        <div class="grid grid-cols-1 gap-3">
          <button
            v-for="type in channelTypes"
            :key="type.value"
            @click="channelType = type.value"
            type="button"
            class="relative p-4 rounded-xl border-2 transition-all duration-200 text-left group"
            :class="channelType === type.value 
              ? 'border-primary bg-primary/10 shadow-lg shadow-primary/20' 
              : 'border-border hover:border-primary/50 hover:bg-accent/50'"
          >
            <div class="flex items-center gap-4">
              <div 
                class="flex items-center justify-center w-12 h-12 rounded-xl transition-colors"
                :class="channelType === type.value 
                  ? 'bg-primary/20 text-primary' 
                  : 'bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary'"
              >
                <component :is="type.icon" class="w-6 h-6" />
              </div>
              
              <div class="flex-1">
                <div class="font-semibold text-foreground mb-1">
                  {{ type.label }}
                </div>
                <div class="text-sm text-muted-foreground">
                  {{ type.description }}
                </div>
              </div>
              
              <div 
                class="w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors"
                :class="channelType === type.value 
                  ? 'border-primary bg-primary' 
                  : 'border-muted-foreground/30'"
              >
                <div 
                  v-if="channelType === type.value" 
                  class="w-2 h-2 rounded-full bg-primary-foreground"
                />
              </div>
            </div>
          </button>
        </div>
      </div>
      
      <div class="relative pt-2">
        <Button
          @click="addChannel"
          :disabled="isLoading"
          class="w-full h-12 font-semibold rounded-xl transition-all text-base"
        >
          <span v-if="isLoading" class="animate-spin i-lucide-loader-2 mr-2"></span>
          <span v-else class="i-lucide-rocket mr-2"></span>
          {{ t("add_channel") }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent } from "@argon/ui/dialog";
import { useLocale } from "@/store/localeStore";
import InputWithError from "../shared/InputWithError.vue";
import { Button } from "@argon/ui/button";
import { computed, shallowRef, onUnmounted, nextTick, watch } from "vue";
import { logger } from "@argon/core";
import { useSpaceStore } from "@/store/serverStore";
import { ChannelType } from "@argon/glue";
import { Label } from "@argon/ui/label";
import { Hash, Megaphone, Mic } from "lucide-vue-next";

const { t } = useLocale();
const servers = useSpaceStore();

const open = defineModel<boolean>("open", { type: Boolean, default: false });
const channelType = shallowRef("Text");
const channelName = shallowRef("");
const addChannelError = shallowRef("")
const isLoading = shallowRef(false)

const selectedSpaceId = defineModel<string>("selectedSpace", {
  type: String,
  required: true,
});

const groupId = defineModel<string | null>("groupId", {
  type: String,
  default: null,
});

const channelTypes = computed(() => [
  {
    value: "Text",
    label: t("channel_type_text"),
    description: t("channel_type_text_desc") || "Send messages, share files, and chat with your team",
    icon: Hash,
  },
  {
    value: "Voice",
    label: t("channel_type_voice"),
    description: t("channel_type_voice_desc") || "Voice and video calls with screen sharing",
    icon: Mic,
  },
  {
    value: "Announcement",
    label: t("channel_type_announcement"),
    description: t("channel_type_announcement_desc") || "Important updates and news for everyone",
    icon: Megaphone,
  },
]);

const addChannel = async () => {
  if (!channelName.value.trim()) {
    logger.warn("Channel name cannot be empty");
    addChannelError.value = t('channel_name_required')
    return;
  }

  isLoading.value = true
  logger.info(`Creation channel: ${channelType.value}, ${channelName.value}`);

  try {
    if (channelType.value === "Text")
      await servers.addChannelToServer(
        selectedSpaceId.value,
        channelName.value,
        ChannelType.Text,
        groupId.value
      );
    else if (channelType.value === "Voice")
      await servers.addChannelToServer(
        selectedSpaceId.value,
        channelName.value,
        ChannelType.Voice,
        groupId.value
      );
    else if (channelType.value === "Announcement")
      await servers.addChannelToServer(
        selectedSpaceId.value,
        channelName.value,
        ChannelType.Announcement,
        groupId.value
      );

    channelName.value = ""
    addChannelError.value = ""
    channelType.value = "Text"
    
    await nextTick();
    open.value = false;
  } catch (error) {
    logger.error(`Failed to create channel: ${error}`);
    addChannelError.value = String(error);
  } finally {
    isLoading.value = false
  }
};

watch(open, (isOpen) => {
  if (!isOpen) {
    setTimeout(() => {
      document.body.style.pointerEvents = "";
    }, 200);
  }
});

onUnmounted(() => {
  channelName.value = "";
  addChannelError.value = "";
  channelType.value = "Text";
  isLoading.value = false;
  document.body.style.pointerEvents = "";
});
</script>
