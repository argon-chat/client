<template>
  <div class="server-header-uploader relative group w-full h-32 rounded-lg overflow-hidden">
    <label class="cursor-pointer block w-full h-full">
      <input 
        type="file" 
        accept="image/jpeg, image/jpg, image/png, image/gif" 
        class="hidden" 
        @change="onHeaderChange" 
      />
      
      <!-- Header Image -->
      <img 
        v-if="headerFileId && loaded" 
        :src="blobSrc" 
        class="w-full h-full object-cover"
        alt="server header" 
      />
      
      <!-- Placeholder -->
      <div 
        v-else
        class="w-full h-full bg-gradient-to-r from-blue-500 to-purple-600 flex items-center justify-center"
      >
        <span class="text-white text-sm font-semibold opacity-70">
          <ImageIcon class="w-8 h-8" />
        </span>
      </div>
      
      <!-- Hover Overlay -->
      <div
        class="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
      >
        <span class="text-white text-sm font-semibold flex items-center gap-2">
          <CameraIcon class="w-5 h-5" />
          {{ t('change_banner') }}
        </span>
      </div>
    </label>
  </div>

  <ServerHeaderCropDialog 
    v-model:open="showCropDialog"
    v-model:image-src="cropImageSrc"
    @header-updated="handleHeaderUpdated"
  />

  <BuyPremium v-model:open="showPremiumDialog" />
</template>

<script setup lang="ts">
import { ref, watch, onMounted } from "vue";
import { CameraIcon, ImageIcon } from "lucide-vue-next";
import ServerHeaderCropDialog from "./ServerHeaderCropDialog.vue";
import BuyPremium from "../../modals/BuyPremium.vue";
import { useToast } from "@argon/ui/toast";
import { useMe } from "@/store/auth/meStore";
import { useApi } from "@/store/system/apiStore";
import { uploadFile } from "@/lib/uploadFile";
import { cdnUrl } from "@/store/system/fileStorage";
import { v7 } from "uuid";
import { useLocale } from "@/store/system/localeStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";

interface Props {
  headerFileId?: string | null;
  spaceId: string;
}

interface Emits {
  (e: "headerUpdated"): void;
}

const props = defineProps<Props>();
const emit = defineEmits<Emits>();

const { t } = useLocale();
const toast = useToast();
const me = useMe();
const api = useApi();
const featureFlags = useFeatureFlags();

const showCropDialog = ref(false);
const showPremiumDialog = ref(false);
const cropImageSrc = ref<string | null>(null);
const isLoadingHeader = ref(false);
const loaded = ref(false);
const blobSrc = ref("");

watch(
  () => props.headerFileId,
  async () => {
    if (!props.spaceId) return;
    if (!props.headerFileId) return;

    blobSrc.value = cdnUrl(props.headerFileId);
    loaded.value = true;
  },
);

onMounted(async () => {
  if (props.spaceId) {
    if (!props.headerFileId) {
      loaded.value = false;
      return;
    }

    blobSrc.value = cdnUrl(props.headerFileId);
    loaded.value = true;
  }
});

const onHeaderChange = async (event: Event) => {
  const input = event.target as HTMLInputElement;
  if (!input.files?.length) return;

  const file = input.files[0];
  console.log("Header file selected:", file.name, file.type, file.size);

  const isAnimated = file.type === "image/gif";

  if (isAnimated && !me.isPremium && featureFlags.ultimaActive) {
    showPremiumDialog.value = true;
    input.value = ""; 
    return;
  }

  if (isAnimated) {
    try {
      isLoadingHeader.value = true;

      const blobId = await uploadServerHeader(file);
      await api.serverInteraction.CompleteUploadSpaceProfileHeader(props.spaceId, blobId);

      toast.toast({
        title: t('header_updated'),
        description: t('header_updated_desc'),
      });

      emit("headerUpdated");
    } catch (e) {
      toast.toast({
        title: t('error'),
        description: t('header_upload_failed'),
        variant: "destructive",
      });
    } finally {
      isLoadingHeader.value = false;
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

const handleHeaderUpdated = async (croppedDataUrl: string) => {
  try {
    const blobId = await uploadServerHeader(croppedDataUrl);
    await api.serverInteraction.CompleteUploadSpaceProfileHeader(props.spaceId, blobId);

    toast.toast({
      title: t('header_updated'),
      description: t('header_updated_desc'),
    });

    emit("headerUpdated");
  } catch (e) {
    toast.toast({
      title: t('error'),
      description: t('header_upload_failed'),
      variant: "destructive",
    });
  }
};

async function uploadServerHeader(data: string | Blob | File): Promise<string> {
  const begin = await api.serverInteraction.BeginUploadSpaceProfileHeader(props.spaceId);
  const { blobId } = await uploadFile(begin, data, "SpaceProfileHeader");
  return blobId;
}
</script>

<style scoped>
.server-header-uploader {
  background-color: #1a1a2e;
}
</style>
