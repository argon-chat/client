<template>
  <Dialog v-model:open="open">
    <DialogContent
      class="sm:max-w-[520px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-8 space-y-8"
    >
      <div
        class="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-primary/5 pointer-events-none"
      ></div>
      <div class="relative text-center space-y-2">
        <h2 class="text-3xl font-extrabold text-foreground tracking-wide">
          {{ t("add_category_channels") }}
        </h2>
      </div>
      <div class="relative space-y-3">
        <InputWithError 
          v-model="groupName" 
          :error="addGroupError" 
          @clear-error="addGroupError = ''" 
          :placeholder="t('category_name')"
        >
          <template #label>
            <Label
              for="group-name"
              class="text-muted-foreground flex items-center gap-2"
            >
              <span class="i-lucide-folder-plus text-primary"></span>
              {{ t("name") }}
            </Label>
          </template>
        </InputWithError>
      </div>
      <div class="relative space-y-3">
        <Label for="group-desc" class="text-muted-foreground">
          {{ t("description") }}
        </Label>
        <Input 
          id="group-desc"
          v-model="groupDescription" 
          :placeholder="t('group_description_optional')"
        />
      </div>
      <div class="relative space-y-3">
        <Button
          @click="addGroup"
          :disabled="isLoading"
          class="w-full font-semibold rounded-xl transition-all"
        >
          <span v-if="isLoading" class="animate-spin i-lucide-loader-2 mr-2"></span>
          <span v-else class="i-lucide-folder-plus mr-2"></span>
          {{ t("create_category") }}
        </Button>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { useLocale } from "@/store/localeStore";
import InputWithError from "../shared/InputWithError.vue";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ref } from "vue";
import { logger } from "@/lib/logger";
import { Label } from "@/components/ui/label";
import { useApi } from "@/store/apiStore";
import { v7 } from "uuid";

const { t } = useLocale();
const api = useApi();

const open = defineModel<boolean>("open", { type: Boolean, default: false });
const groupName = ref("");
const groupDescription = ref("");
const addGroupError = ref("");
const isLoading = ref(false);

const selectedSpaceId = defineModel<string>("selectedSpace", {
  type: String,
  required: true,
});

const emit = defineEmits<{
  (e: "close"): void;
}>();

const addGroup = async () => {
  if (!groupName.value.trim()) {
    logger.warn("Group name cannot be empty");
    addGroupError.value = t('group_name_required');
    return;
  }

  isLoading.value = true;
  logger.info(`Creating channel group: ${groupName.value}`);

  try {
    const groupId = v7();
    await api.channelInteraction.CreateChannelGroup(
      selectedSpaceId.value,
      groupId,
      groupName.value,
      groupDescription.value || null
    );

    groupName.value = "";
    groupDescription.value = "";
    addGroupError.value = "";
    emit("close");
  } catch (error) {
    logger.error(`Failed to create channel group: ${error}`);
    addGroupError.value = t('failed_to_create_group');
  } finally {
    isLoading.value = false;
  }
};
</script>
