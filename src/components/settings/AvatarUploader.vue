<template>
  <div class="avatar relative group w-20 h-20">
    <label>
      <input 
        type="file" 
        accept="image/jpeg, image/jpg, image/png, image/gif, video/webm" 
        class="hidden" 
        @change="onAvatarChange" 
      />
      <ArgonAvatar 
        :fallback="fallback" 
        :file-id="avatarFileId ?? null"
        :user-id="userId" 
        alt="User Avatar"
        class="user-avatar w-20 h-20 rounded-full border border-gray-500" 
      />
      <div
        class="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <span class="text-white text-sm font-semibold">
          <CameraIcon />
        </span>
      </div>
    </label>
  </div>

  <AvatarCropDialog 
    v-model:open="showCropDialog"
    v-model:image-src="cropImageSrc"
    @avatar-updated="handleAvatarUpdated"
  />

  <BuyPremium v-model:open="showPremiumDialog" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { CameraIcon } from "lucide-vue-next";
import ArgonAvatar from "../ArgonAvatar.vue";
import AvatarCropDialog from "./AvatarCropDialog.vue";
import BuyPremium from "../modals/BuyPremium.vue";
import { useToast } from "@/components/ui/toast/use-toast";
import { useMe } from "@/store/meStore";
import { useApi } from "@/store/apiStore";
import { UploadFileError } from "@/lib/glue/argonChat";
import { v7 } from "uuid";

interface Props {
  fallback: string;
  avatarFileId?: string | null;
  userId: string;
}

interface Emits {
  (e: "avatarUpdated"): void;
}

defineProps<Props>();
const emit = defineEmits<Emits>();

const toast = useToast();
const me = useMe();
const api = useApi();

const showCropDialog = ref(false);
const showPremiumDialog = ref(false);
const cropImageSrc = ref<string | null>(null);
const isLoadingAvatar = ref(false);

const onAvatarChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;

  const file = input.files[0];
  console.log("File selected:", file.name, file.type, file.size);

  const isAnimated = file.type === "image/gif" || file.type === "video/webm";

  if (isAnimated && !me.isPremium) {
    showPremiumDialog.value = true;
    input.value = ""; 
    return;
  }

  if (isAnimated) {
    try {
      isLoadingAvatar.value = true;

      const blobId = await uploadUserAvatar(file);
      await api.userInteraction.CompleteUploadAvatar(blobId);

      toast.toast({
        title: "Avatar updated",
        description: "Your animated avatar has been successfully uploaded.",
      });

      emit("avatarUpdated");
    } catch (e) {
      toast.toast({
        title: "Error on upload avatar...",
        variant: "destructive",
        description: `${e}`,
      });
    } finally {
      isLoadingAvatar.value = false;
    }
    input.value = "";
    return;
  }

  // For static images, show crop dialog
  if (cropImageSrc.value) URL.revokeObjectURL(cropImageSrc.value);
  cropImageSrc.value = URL.createObjectURL(file);
  showCropDialog.value = true;
  input.value = "";
};

const handleAvatarUpdated = () => {
  emit("avatarUpdated");
};

async function uploadUserAvatar(data: string | Blob | File): Promise<string> {
  const begin = await api.userInteraction.BeginUploadAvatar();

  if (begin.isFailedUploadFile()) {
    throw new Error(UploadFileError[begin.error] ?? "BeginUploadAvatar failed");
  }
  if (!begin.isSuccessUploadFile()) {
    throw new Error("Unexpected upload state");
  }

  const blobId = begin.blobId;
  if (!blobId) throw new Error("No blobId returned from BeginUploadAvatar");

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
    case "video/webm": return "webm";
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
.avatar img {
  border-radius: 50%;
  border: 2px solid #4a5568;
}
</style>
