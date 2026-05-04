<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="avatar-crop-dialog avatar-crop-dialog--wide" :disableOutsidePointerEvents="true">
      <div class="avatar-crop-dialog__cropper avatar-crop-dialog__cropper--wide">
        <AvatarCropper
          v-if="imageSrc"
          ref="cropperRef"
          :src="imageSrc"
          :aspect-ratio="16 / 9"
          :padding="20"
        />
      </div>

      <div class="avatar-crop-dialog__bottom">
        <div class="avatar-crop-dialog__actions">
          <Button variant="ghost" @click="isOpen = false">
            {{ t("cancel") }}
          </Button>
          <Button @click="handleSave" :disabled="isLoading">
            {{ t("save_changes") }}
          </Button>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import {
  Dialog,
  DialogContent,
} from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { useLocale } from "@/store/system/localeStore";
import AvatarCropper from "@/components/common/AvatarCropper.vue";

interface Props {
  open: boolean;
  imageSrc: string | null;
}

interface Emits {
  (e: "update:open", value: boolean): void;
  (e: "update:imageSrc", value: string | null): void;
  (e: "headerUpdated", croppedDataUrl: string): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const { t } = useLocale();

const isOpen = ref(props.open);
const cropperRef = ref<InstanceType<typeof AvatarCropper> | null>(null);
const isLoading = ref(false);

watch(() => props.open, (value) => {
  isOpen.value = value;
});

watch(isOpen, (value) => {
  emit("update:open", value);
});

const handleSave = async () => {
  if (!cropperRef.value) return;

  try {
    isLoading.value = true;
    const croppedDataUrl = await cropperRef.value.getCroppedDataURL(1280, 0.9);
    emit("headerUpdated", croppedDataUrl);
    isOpen.value = false;
    emit("update:imageSrc", null);
  } catch (e) {
    console.error("Error saving cropped header:", e);
  } finally {
    isLoading.value = false;
  }
};
</script>

<style scoped>
.avatar-crop-dialog {
  max-width: 400px;
  width: 95vw;
  padding: 0;
  gap: 0;
  overflow: hidden;
  border-radius: 12px;
  background: #1a1a1a;
  border: none;
}

.avatar-crop-dialog--wide {
  max-width: 580px;
}

.avatar-crop-dialog__cropper {
  width: 100%;
  aspect-ratio: 1;
}

.avatar-crop-dialog__cropper--wide {
  aspect-ratio: 16 / 10;
}

.avatar-crop-dialog__bottom {
  padding: 8px 12px;
  background: #1a1a1a;
}

.avatar-crop-dialog__actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
