<template>
  <div class="profile-settings text-white rounded-lg space-y-6" v-if="me.me">
    <h2 class="text-2xl font-bold">{{ t("profile_settings") }}</h2>
    <div class="avatar-username flex items-center space-x-4">
      <div class="avatar relative group w-20 h-20">
        <label>
          <input type="file" accept="image/jpeg, image/jpg, image/png" class="hidden" @change="onAvatarChange" />
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
        <label class="block font-semibold mb-1">{{ t("phone_number") }}</label>
        <Input type="tel" class="input-field" placeholder="Enter phone number" />
      </div>

      <div class="otp-settings" v-if="false">
        <label class="block font-semibold mb-1">{{ t("otp_title") }}</label>
        <button @click="toggleOTP" class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
          {{ t('disable_otp')}}
        </button>
      </div>
      <div class="delete-account">
        <label class="block font-semibold mb-1">{{ t("delete_account") }}</label>
        <button @click="deleteAccount" class="button bg-red-500 text-white rounded px-4 py-2 hover:bg-red-600">
          {{ t("delete_account") }}
        </button>
      </div>
      <Dialog v-model:open="isFileSelected">
        <DialogContent class="max-h-[850px] max-w-[750px]" :disableOutsidePointerEvents="true">
          <DialogHeader>
            <DialogTitle>{{t("crop_image")  }}</DialogTitle>
          </DialogHeader>
          <Cropper v-if="img" class="cropper" :src="img" :stencil-props="{
            aspectRatio: 1
          }" @change="change" image-restriction="stencil" :stencil-component="CircleStencil"></Cropper>
          <DialogFooter>

            <Button @click="saveChanges" :disabled="isLoadingAvatar">{{t("save_changes")}}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  </div>
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
const { t } = useLocale();
const me = useMe();
const toast = useToast();
const isFileSelected = ref(false);
const img = ref(null as string | null);
const canvasRef = ref(null as null | HTMLCanvasElement);
const isLoadingAvatar = ref(false);

const api = useApi();
const toggleOTP = () => {
  //user.value.otpEnabled = !user.value.otpEnabled;
  //alert(`OTP has been ${user.value.otpEnabled ? 'enabled' : 'disabled'}.`);
};

const change = ({ canvas }: { canvas: HTMLCanvasElement }) => {
  canvasRef.value = canvas;
};

const onAvatarChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (input.files?.[0]) {
    const file = input.files[0];
    console.log("File selected: ", file.name, file.size);

    if (img.value) {
      URL.revokeObjectURL(img.value);
    }
    isFileSelected.value = true;
    img.value = URL.createObjectURL(file);
  }
};

const saveChanges = async () => {
  try {
    isLoadingAvatar.value = true;

    const image = canvasRef.value?.toDataURL("image/jpeg", 1) ?? "";

    await uploadUserAvatar(image, `${v7()}.jpg`);

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

async function uploadUserAvatar(dataUrl: string, name: string): Promise<void> {
  const formData = new FormData();
  const cfg = useConfig();
  const auth = useAuthStore();
  const blob = dataURLtoBlob(dataUrl);
  const file = new File([blob], name, { type: blob.type });

  formData.append("file", file);

  const response = await fetch(`${cfg.apiEndpoint}/files/user/@me/avatar`, {
    method: "POST",
    body: formData,
    headers: {
      Authorization: `Bearer ${auth.token}`,
      "X-Host-Name": v7(),
    },
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Error in upload avatar ${response.status} — ${error}`);
  }

  console.log("Avatar success load");
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

const deleteAccount = () => {
  toast.toast({
    title: "Охуел?",
    variant: "destructive",
    description: "Обойдешься, мы не соблюдаем GRPD чисто по приколу",
  });
};

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
