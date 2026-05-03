<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-h-[95vh] !max-w-[1400px] w-[95vw]" :disableOutsidePointerEvents="true">
      <DialogHeader>
        <DialogTitle>{{ t("crop_image") }}</DialogTitle>
      </DialogHeader>
      <div class="cropper-container">
        <Cropper 
          v-if="imageSrc" 
          class="cropper" 
          :src="imageSrc" 
          :stencil-props="{ aspectRatio: 1 }" 
          @change="onChange" 
          image-restriction="stencil" 
          :stencil-component="CircleStencil"
        />
      </div>
      <DialogFooter>
        <Button @click="handleSave" :disabled="isLoading">
          {{ t("save_changes") }}
        </Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, watch } from "vue";
import { Cropper, CircleStencil } from "vue-advanced-cropper";
import { 
  Dialog, 
  DialogContent, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { useToast } from "@argon/ui/toast";
import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import { uploadFile } from "@/lib/uploadFile";
import { v7 } from "uuid";

interface Props {
  open: boolean;
  imageSrc: string | null;
}

interface Emits {
  (e: "update:open", value: boolean): void;
  (e: "update:imageSrc", value: string | null): void;
  (e: "avatarUpdated"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const { t } = useLocale();
const toast = useToast();
const api = useApi();

const isOpen = ref(props.open);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const isLoading = ref(false);

watch(() => props.open, (value) => {
  isOpen.value = value;
});

watch(isOpen, (value) => {
  emit("update:open", value);
});

const onChange = ({ canvas }: { canvas: HTMLCanvasElement }) => {
  canvasRef.value = canvas;
};

const handleSave = async () => {
  try {
    isLoading.value = true;
    const image = canvasRef.value?.toDataURL("image/jpeg", 0.95);
    if (!image) throw new Error("Failed to capture cropped image");

    const blobId = await uploadUserAvatar(image);
    await api.userInteraction.CompleteUploadAvatar(blobId);

    toast.toast({
      title: "Avatar updated",
      description: "Your avatar has been successfully uploaded.",
    });

    isOpen.value = false;
    emit("avatarUpdated");
  } catch (e) {
    toast.toast({
      title: "Error on upload avatar...",
      variant: "destructive",
      description: `${e}`,
    });
  } finally {
    isLoading.value = false;
  }
};

async function uploadUserAvatar(data: string | Blob | File): Promise<string> {
  const begin = await api.userInteraction.BeginUploadAvatar();
  const { blobId } = await uploadFile(begin, data, "Avatar");
  return blobId;
}
</script>

<style scoped>
.cropper-container {
  width: 100%;
  height: calc(95vh - 180px);
  max-height: calc(95vh - 180px);
  overflow: hidden;
  display: flex;
  justify-content: center;
  align-items: center;
}

.cropper {
  height: 100%;
  width: 100%;
  max-height: 100%;
  max-width: 100%;
  min-height: 400px;
  background: #dddddd00;
}
</style>
