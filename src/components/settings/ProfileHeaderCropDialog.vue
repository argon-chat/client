<template>
  <Dialog v-model:open="isOpen">
    <DialogContent class="max-h-[95vh] !max-w-[1400px] w-[95vw]" :disableOutsidePointerEvents="true">
      <DialogHeader>
        <DialogTitle>{{ t("crop_banner") }}</DialogTitle>
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
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useToast } from "@/components/ui/toast/use-toast";
import { useLocale } from "@/store/localeStore";
import { useApi } from "@/store/apiStore";
import { UploadFileError } from "@/lib/glue/argonChat";
import { v7 } from "uuid";

interface Props {
  open: boolean;
  imageSrc: string | null;
}

interface Emits {
  (e: "update:open", value: boolean): void;
  (e: "update:imageSrc", value: string | null): void;
  (e: "headerUpdated"): void;
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

    const blobId = await uploadProfileHeader(image);
    await api.userInteraction.CompleteUploadProfileHeader(blobId);

    toast.toast({
      title: t("header_updated"),
      description: t("header_updated_desc"),
    });

    isOpen.value = false;
    emit("headerUpdated");
  } catch (e) {
    toast.toast({
      title: t("error_upload_header"),
      variant: "destructive",
      description: `${e}`,
    });
  } finally {
    isLoading.value = false;
  }
};

async function uploadProfileHeader(data: string | Blob | File): Promise<string> {
  const begin = await api.userInteraction.BeginUploadProfileHeader();

  if (begin.isFailedUploadFile()) {
    throw new Error(UploadFileError[begin.error] ?? "BeginUploadProfileHeader failed");
  }
  if (!begin.isSuccessUploadFile()) {
    throw new Error("Unexpected upload state");
  }

  const blobId = begin.blobId;
  if (!blobId) throw new Error("No blobId returned from BeginUploadProfileHeader");

  let file: File;

  if (typeof data === "string") {
    const blob = dataURLtoBlob(data);
    file = new File([blob], `${v7()}.jpg`, { type: blob.type });
  } else if (data instanceof Blob) {
    file = new File([data], `${v7()}.${getFileExtension(data.type)}`, { type: data.type });
  } else {
    file = data;
  }

  const formData = new FormData();
  formData.append("file", file);

  const response = await fetch(`https://koko.argon.gl/api/v1/upload/${blobId}`, {
    method: "PATCH",
    body: formData,
    headers: {
      "X-Api-Token": "f2f3be8c3ddf5017c019248fef849bc240e7b4a25ecb662251d8a4ca7ac6fe58"
    }
  });

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Upload failed (${response.status}): ${errText}`);
  }

  return blobId;
}

function getFileExtension(mime: string): string {
  switch (mime) {
    case "image/png": return "png";
    case "image/jpeg": return "jpg";
    case "image/gif": return "gif";
    default: return "bin";
  }
}

function dataURLtoBlob(dataUrl: string): Blob {
  const arr = dataUrl.split(",");
  const mimeMatch = arr[0].match(/:(.*?);/);
  if (!mimeMatch) throw new Error("Cant detect MIME-type");

  const mime = mimeMatch[1];
  const bstr = atob(arr[1]);
  const n = bstr.length;
  const u8arr = new Uint8Array(n);

  for (let i = 0; i < n; i++) {
    u8arr[i] = bstr.charCodeAt(i);
  }

  return new Blob([u8arr], { type: mime });
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
