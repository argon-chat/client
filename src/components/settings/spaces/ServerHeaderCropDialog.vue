<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-h-[95vh] !max-w-[1400px] w-[95vw]" :disableOutsidePointerEvents="true">
      <DialogHeader>
        <DialogTitle>{{ t("crop_server_header") }}</DialogTitle>
      </DialogHeader>
      <div class="cropper-container">
        <Cropper 
          v-if="imageSrc" 
          class="cropper" 
          :src="imageSrc" 
          :stencil-props="{ aspectRatio: 16/9 }" 
          @change="onChange" 
          image-restriction="stencil" 
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
import { Cropper } from "vue-advanced-cropper";
import { 
  Dialog, 
  DialogContent, 
  DialogFooter, 
  DialogHeader, 
  DialogTitle 
} from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { useLocale } from "@/store/localeStore";

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

    if (!canvasRef.value) {
      console.error("No canvas available");
      return;
    }

    const croppedDataUrl = canvasRef.value.toDataURL("image/jpeg", 0.9);

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
@import "vue-advanced-cropper/dist/style.css";

.cropper-container {
  min-height: 400px;
  max-height: 600px;
  position: relative;
}

.cropper {
  height: 100%;
  background: #181818;
}
</style>
