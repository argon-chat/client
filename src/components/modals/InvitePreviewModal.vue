<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[440px] p-0 overflow-hidden rounded-2xl border bg-card">
      <!-- Loading -->
      <div v-if="loading" class="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 class="w-7 h-7 animate-spin text-muted-foreground" />
        <p class="text-sm text-muted-foreground">{{ t("loading_invite") }}</p>
      </div>

      <!-- Error -->
      <div v-else-if="errorMessage" class="flex flex-col items-center justify-center gap-4 px-8 py-14 text-center">
        <div class="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <LinkIcon class="w-6 h-6 text-destructive" />
        </div>
        <div>
          <h3 class="font-semibold">{{ t("invite_invalid") }}</h3>
          <p class="text-sm text-muted-foreground mt-1">{{ errorMessage }}</p>
        </div>
        <Button variant="outline" @click="open = false">{{ t("close") }}</Button>
      </div>

      <!-- Preview -->
      <div v-else-if="preview">
        <!-- Header banner -->
        <div
          class="invite-banner"
          :style="bannerUrl ? { backgroundImage: `url(${bannerUrl})` } : {}"
          :class="{ 'is-empty': !bannerUrl }"
        />

        <div class="px-6 pb-6 -mt-10">
          <div class="flex items-end gap-3">
            <div class="rounded-2xl ring-4 ring-card">
              <ArgonAvatar
                :file-id="preview.avatarFileId"
                :space-id="preview.spaceId"
                :fallback="(preview.name || '?').substring(0, 2).toUpperCase()"
                :overrided-size="64"
                class="rounded-2xl w-16 h-16"
              />
            </div>
          </div>

          <div class="mt-3 flex items-center gap-1.5">
            <h2 class="text-xl font-bold truncate">{{ preview.name }}</h2>
            <PhSealCheck v-if="preview.isOfficial" weight="fill" class="w-5 h-5 text-sky-400 shrink-0" />
            <PhSealCheck v-else-if="preview.isVerified" weight="fill" class="w-5 h-5 text-yellow-400 shrink-0" />
          </div>

          <p v-if="preview.description" class="text-sm text-muted-foreground mt-1 line-clamp-3">
            {{ preview.description }}
          </p>

          <!-- Counts -->
          <div class="flex items-center gap-4 mt-3 text-sm text-muted-foreground">
            <span class="inline-flex items-center gap-1.5">
              <span class="online-dot" />
              {{ preview.onlineCount }} {{ t("online") }}
            </span>
            <span class="inline-flex items-center gap-1.5">
              <UsersIcon class="w-3.5 h-3.5" />
              {{ preview.memberCount }} {{ t("members") }}
            </span>
          </div>

          <div v-if="joinError" class="text-sm text-destructive mt-3">{{ joinError }}</div>

          <!-- Actions -->
          <div class="flex gap-2 mt-5">
            <Button variant="outline" class="flex-1" :disabled="joining" @click="open = false">
              {{ t("cancel") }}
            </Button>
            <Button class="flex-1" :disabled="joining" @click="doJoin">
              <Loader2 v-if="joining" class="w-4 h-4 mr-2 animate-spin" />
              <LogInIcon v-else class="w-4 h-4 mr-2" />
              {{ t("join_to_server") }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import { Dialog, DialogContent } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { Loader2, UsersIcon, LogInIcon, LinkIcon } from "lucide-vue-next";
import { PhSealCheck } from "@phosphor-icons/vue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useWindow } from "@/store/ui/windowStore";
import { useApi } from "@/store/system/apiStore";
import { useSpaceStore } from "@/store/data/serverStore";
import { useLocale } from "@/store/system/localeStore";
import { cdnUrl } from "@/store/system/fileStorage";
import { AcceptInviteError } from "@argon/glue";
import type { InvitePreview } from "@argon/glue";

const { t } = useLocale();
const windows = useWindow();
const api = useApi();
const spaceStore = useSpaceStore();

const open = computed({
  get: () => windows.invitePreviewOpen,
  set: (v: boolean) => (windows.invitePreviewOpen = v),
});

const loading = ref(false);
const preview = ref<InvitePreview | null>(null);
const errorMessage = ref("");
const joining = ref(false);
const joinError = ref("");

const bannerUrl = computed(() =>
  preview.value?.topBannerFileId ? cdnUrl(preview.value.topBannerFileId, preview.value.spaceId) : "",
);

function errorFor(error: AcceptInviteError): string {
  switch (error) {
    case AcceptInviteError.EXPIRED:
      return t("invite_expired");
    case AcceptInviteError.LIMIT_REACHED:
      return t("invite_limit_reached");
    case AcceptInviteError.YOU_ARE_BANNED:
      return t("invite_banned");
    default:
      return t("invite_not_found");
  }
}

async function load(code: string) {
  loading.value = true;
  preview.value = null;
  errorMessage.value = "";
  joinError.value = "";
  try {
    const result = await api.userInteraction.PreviewInvite({ inviteCode: code });
    if (result.isSuccessPreview()) {
      preview.value = result.preview;
    } else if (result.isFailedPreview()) {
      errorMessage.value = errorFor(result.error);
    }
  } catch (e) {
    errorMessage.value = String(e);
  } finally {
    loading.value = false;
  }
}

async function doJoin() {
  joining.value = true;
  joinError.value = "";
  try {
    const err = await spaceStore.joinToServer(windows.invitePreviewCode);
    if (err) {
      joinError.value = err;
      return;
    }
    open.value = false;
  } finally {
    joining.value = false;
  }
}

// Load the preview whenever the modal opens with a code.
watch(
  () => windows.invitePreviewOpen,
  (isOpen) => {
    if (isOpen && windows.invitePreviewCode) load(windows.invitePreviewCode);
    if (!isOpen) {
      preview.value = null;
      errorMessage.value = "";
      joinError.value = "";
    }
  },
);
</script>

<style scoped>
.invite-banner {
  height: 110px;
  background-size: cover;
  background-position: center;
}

.invite-banner.is-empty {
  background: linear-gradient(135deg, hsl(var(--primary) / 0.35), hsl(var(--primary) / 0.1));
}

.online-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 9999px;
  background: #22c55e;
  box-shadow: 0 0 6px #22c55eaa;
}
</style>
