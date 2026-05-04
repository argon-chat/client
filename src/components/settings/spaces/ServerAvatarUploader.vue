<template>
  <div class="avatar relative group w-20 h-20">
    <label>
      <input 
        type="file" 
        accept="image/jpeg, image/jpg, image/png, image/gif" 
        class="hidden" 
        @change="onAvatarChange" 
      />
      <!-- Show local preview while uploading -->
      <img
        v-if="localPreview"
        :src="localPreview"
        alt="Server Avatar"
        class="w-20 h-20 rounded-full border border-gray-500 object-cover"
      />
      <ArgonAvatar 
        v-else
        :fallback="fallback" 
        :file-id="avatarFileId ?? null"
        :space-id="spaceId" 
        alt="Server Avatar"
        class="server-avatar w-20 h-20 rounded-full border border-gray-500" 
      />
      <!-- Upload progress overlay with circular spinner -->
      <div
        v-if="localPreview && !uploadFailed"
        class="absolute inset-0 bg-black/40 rounded-full flex items-center justify-center"
      >
        <Loader2 class="w-6 h-6 text-white animate-spin" />
      </div>
      <!-- Upload failed overlay with red X -->
      <div
        v-else-if="localPreview && uploadFailed"
        class="absolute inset-0 bg-red-500/60 rounded-full flex items-center justify-center animate-in fade-in duration-200"
      >
        <X class="w-8 h-8 text-white" :stroke-width="3" />
      </div>
      <!-- Hover overlay -->
      <div
        v-else
        class="absolute inset-0 bg-black bg-opacity-50 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
        <span class="text-white text-sm font-semibold">
          <CameraIcon />
        </span>
      </div>
    </label>
  </div>

  <ServerAvatarCropDialog 
    v-model:open="showCropDialog"
    v-model:image-src="cropImageSrc"
    :space-id="spaceId"
    @avatar-updated="emit('avatarUpdated')"
    @upload-start="onUploadStart"
    @upload-end="onUploadEnd"
  />

  <BuyPremium v-model:open="showPremiumDialog" />
</template>

<script setup lang="ts">
import { ref } from "vue";
import { CameraIcon, Loader2, X } from "lucide-vue-next";
import ArgonAvatar from "../../ArgonAvatar.vue";
import ServerAvatarCropDialog from "./ServerAvatarCropDialog.vue";
import BuyPremium from "../../modals/BuyPremium.vue";
import { useToast } from "@argon/ui/toast";
import { useMe } from "@/store/auth/meStore";
import { useApi } from "@/store/system/apiStore";
import { useAvatarUpload } from "@/composables/useAvatarUpload";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";

interface Props {
  fallback: string;
  avatarFileId?: string | null;
  spaceId: string;
}

interface Emits {
  (e: "avatarUpdated"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const toast = useToast();
const me = useMe();
const api = useApi();
const featureFlags = useFeatureFlags();
const uploadState = useAvatarUpload();

const showCropDialog = ref(false);
const showPremiumDialog = ref(false);
const cropImageSrc = ref<string | null>(null);
const localPreview = ref<string | null>(null);
const uploadFailed = ref(false);

function onUploadStart(previewUrl: string) {
  uploadFailed.value = false;
  localPreview.value = previewUrl;
}

function onUploadEnd(success: boolean) {
  if (success) {
    localPreview.value = null;
  } else {
    uploadFailed.value = true;
    setTimeout(() => {
      uploadFailed.value = false;
      localPreview.value = null;
    }, 1500);
  }
}

const onAvatarChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;

  const file = input.files[0];

  const isAnimated = file.type === "image/gif";

  if (isAnimated && !me.isPremium && featureFlags.ultimaActive) {
    showPremiumDialog.value = true;
    input.value = ""; 
    return;
  }

  if (isAnimated) {
    const success = await uploadState.upload(
      () => api.serverInteraction.BeginUploadSpaceAvatar(props.spaceId),
      (blobId) => api.serverInteraction.CompleteUploadSpaceAvatar(props.spaceId, blobId),
      file,
    );

    if (success) {
      toast.toast({ title: "Server avatar updated" });
      emit("avatarUpdated");
    } else {
      toast.toast({
        title: "Error on upload avatar...",
        variant: "destructive",
        description: uploadState.errorMessage.value ?? undefined,
      });
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
</script>

<style scoped>
.avatar img {
  border-radius: 50%;
  border: 2px solid #4a5568;
}
</style>
