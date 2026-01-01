<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="sm:max-w-[520px] rounded-2xl border border-white/10 bg-gradient-to-br from-black/60 via-zinc-900/70 to-black/60 backdrop-blur-2xl p-8 space-y-8"
    >
      <div
        class="absolute inset-0 bg-gradient-to-t from-blue-500/5 via-transparent to-purple-500/5 pointer-events-none"
      ></div>
      <div class="relative text-center space-y-2">
        <h2 class="text-3xl font-extrabold text-white tracking-wide">
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
              class="text-gray-300 flex items-center gap-2"
            >
              <span class="i-lucide-plus-circle text-blue-400"></span>
              {{ t("name") }}
            </Label>
          </template>
        </InputWithError>
      </div>
      <div class="relative space-y-3">
        <Label class="text-right">
          {{ t("channel_type") }}
        </Label>
        <RadioGroup
          id="channel-type"
          v-model="channelType"
          :orientation="'vertical'"
        >
          <div class="flex items-center space-x-2">
            <RadioGroupItem id="r1" value="Text" />
            <Label for="r1"> {{ t("channel_type_text") }} </Label>
          </div>
          <div class="flex items-center space-x-2">
            <RadioGroupItem id="r2" value="Voice" />
            <Label for="r2"> {{ t("channel_type_voice") }} </Label>
          </div>
          <div class="flex items-center space-x-2">
            <RadioGroupItem id="r3" value="Announcement" />
            <Label for="r3"> {{ t("channel_type_announcement") }} </Label>
          </div>
        </RadioGroup>
      </div>
      <div class="relative space-y-3">
        <Button
          @click="addChannel"
          :disabled="isLoading"
          class="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all"
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
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useLocale } from "@/store/localeStore";
import InputWithError from "../shared/InputWithError.vue";
import { Button } from "@/components/ui/button";
import { ref } from "vue";
import { logger } from "@/lib/logger";
import { useSpaceStore } from "@/store/serverStore";
import { ChannelType } from "@/lib/glue/argonChat";
import { Label } from "@/components/ui/label";

const { t } = useLocale();
const servers = useSpaceStore();

const open = defineModel<boolean>("open", { type: Boolean, default: false });
const channelType = ref("Text");
const channelName = ref("");
const addChannelError = ref("")
const isLoading = ref(false)

const selectedSpaceId = defineModel<string>("selectedSpace", {
  type: String,
  required: true,
});

const groupId = defineModel<string | null>("groupId", {
  type: String,
  default: null,
});

const emit = defineEmits<{
  (e: "close"): void;
}>();

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
    
    // Сначала закрываем диалог, чтобы убрать overlay
    open.value = false;
    
    // Затем эмитим событие закрытия через небольшую задержку
    setTimeout(() => {
      emit("close");
    }, 50);
  } catch (error) {
    logger.error(`Failed to create channel: ${error}`);
  } finally {
    isLoading.value = false
  }
};
</script>
