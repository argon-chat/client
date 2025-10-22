<template>
  <div class="profile-settings text-white rounded-lg space-y-6" v-if="me.me">
    <h2 class="text-2xl font-bold">{{ t("profile_settings") }}</h2>
    <div class="avatar-username flex items-center space-x-4">
      <div class="avatar relative group w-20 h-20">
        <label>
          <input type="file" accept="image/jpeg, image/jpg, image/png, image/gif, video/webm" class="hidden" @change="onAvatarChange" />
          <ArgonAvatar :fallback="me.me.displayName" :file-id="me.me?.avatarFileId"
            :user-id="me.me.userId" alt="User Avatar"
            class="user-avatar w-20 h-20 rounded-full border border-gray-500" />
          <div
            class="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
            <span class="text-white text-sm font-semibold">
              <CameraIcon />
            </span>
          </div>
        </label>
      </div>
      <div>
        <label class="block font-semibold mb-1">{{ t("username") }}</label>
        <Input readonly disabled v-model="me.me.username" type="text" class="input-field"
          placeholder="Enter username" />
      </div>
    </div>
    <div>
      <label class="block font-semibold mb-1">{{ t("display_name") }}</label>
      <Input readonly disabled v-model="me.me.displayName" type="text" class="input-field"
        placeholder="Enter display name" />
    </div>
    <div>
      <div v-if="false">
        <label class="block font-semibold mb-1">{{ t("password") }}</label>
        <Input type="password" class="input-field" placeholder="Enter new password" />
      </div>
      <div v-if="false">
        <label class="block font-semibold mb-1">{{ t("Phone Number") }}</label>
        <Input type="tel" class="input-field" placeholder="Enter phone number" />
      </div>

      <div class="otp-settings" v-if="false">
        <label class="block font-semibold mb-1">{{ t("otp_title") }}</label>
        <button @click="toggleOTP" class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
          {{ 'Disable OTP' }}
        </button>
      </div>
      <Dialog v-model:open="isFileSelected">
        <DialogContent class="max-h-[850px] max-w-[750px]" :disableOutsidePointerEvents="true">
          <DialogHeader>
            <DialogTitle>Crop image</DialogTitle>
          </DialogHeader>
          <Cropper v-if="img" class="cropper" :src="img" :stencil-props="{
            aspectRatio: 1
          }" @change="change" image-restriction="stencil" :stencil-component="CircleStencil"></Cropper>
          <DialogFooter>

            <Button @click="saveChanges" :disabled="isLoadingAvatar">Save changes</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </div>

  <BuyPremium v-model:open="requiredPremium"/>
</template>

<script setup lang="ts">
import { Cropper, CircleStencil } from "vue-advanced-cropper";
import { Input } from "@/components/ui/input";
import ArgonAvatar from "../ArgonAvatar.vue";
import { useMe } from "@/store/meStore";
import { useToast } from "@/components/ui/toast/use-toast";
import { useLocale } from "@/store/localeStore";
import { CameraIcon } from "lucide-vue-next";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { onUnmounted, ref } from "vue";
import { useConfig } from "@/store/remoteConfig";
import { useAuthStore } from "@/store/authStore";
import { v7 } from "uuid";
import { useApi } from "@/store/apiStore";
import { UploadFileError } from "@/lib/glue/argonChat";
import BuyPremium from "../modals/BuyPremium.vue";
const { t } = useLocale();
const me = useMe();
const toast = useToast();
const isFileSelected = ref(false);
const img = ref(null as string | null);
const canvasRef = ref(null as null | HTMLCanvasElement);
const isLoadingAvatar = ref(false);

const api = useApi();

const requiredPremium = ref(false);

const toggleOTP = () => {
};

const change = ({ canvas }: { canvas: HTMLCanvasElement }) => {
  canvasRef.value = canvas;
};

const onAvatarChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;

  const file = input.files[0];
  console.log("File selected:", file.name, file.type, file.size);

  const isAnimated = file.type === "image/gif" || file.type === "video/webm";

  if (isAnimated && !me.isPremium) {
    requiredPremium.value = true;
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
    } catch (e) {
      toast.toast({
        title: "Error on upload avatar...",
        variant: "destructive",
        description: `${e}`,
      });
    } finally {
      isLoadingAvatar.value = false;
    }
    return;
  }

  if (img.value) URL.revokeObjectURL(img.value);
  img.value = URL.createObjectURL(file);
  isFileSelected.value = true;
};
const saveChanges = async () => {
  try {
    isLoadingAvatar.value = true;
    const image = canvasRef.value?.toDataURL("image/jpeg", 0.95);
    if (!image) throw new Error("Failed to capture cropped image");

    const blobId = await uploadUserAvatar(image);
    await api.userInteraction.CompleteUploadAvatar(blobId);

    toast.toast({
      title: "Avatar updated",
      description: "Your avatar has been successfully uploaded.",
    });

    isFileSelected.value = false;
  } catch (e) {
    toast.toast({
      title: "Error on upload avatar...",
      variant: "destructive",
      description: `${e}`,
    });
  } finally {
    isLoadingAvatar.value = false;
  }
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
      "X-Api-Token": "c716665c8a387ca96083a1e3b7d6498b23bb5d1abbfa890dd3db9f63af5f2fc8"
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

onUnmounted(() => {
  isFileSelected.value = false;
});
</script>

<style scoped>
.profile-settings {
  max-width: 600px;
  margin: 0 auto;
}

.button {
  padding: 10px 16px;
  font-size: 1rem;
  font-weight: 500;
}

.cropper {
  height: 700px;
  width: 700px;
  background: #dddddd00;
}

.vue-advanced-cropper__foreground {
  background: transparent !important;
}

.avatar img {
  border-radius: 50%;
  border: 2px solid #4a5568;
}
</style>
