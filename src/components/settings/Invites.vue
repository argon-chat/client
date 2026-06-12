<template>
  <div class="invites-settings space-y-6">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <LinkIcon class="w-5 h-5" />
        <h2 class="text-lg font-semibold">{{ t("invite_codes") }}</h2>
      </div>
      <p class="text-sm text-muted-foreground">{{ t("invites_description") }}</p>
    </div>

    <!-- Create invite -->
    <div class="setting-card space-y-4">
      <h3 class="font-medium">{{ t("create_invite") }}</h3>
      <div class="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">{{ t("invite_expires_after") }}</label>
          <select v-model.number="newExpireMinutes" class="inv-select" :disabled="!canManage">
            <option v-for="o in expiryOptions" :key="o.minutes" :value="o.minutes">{{ o.label }}</option>
          </select>
        </div>
        <div class="space-y-1.5">
          <label class="text-xs text-muted-foreground">{{ t("invite_max_uses") }}</label>
          <select v-model.number="newMaxUses" class="inv-select" :disabled="!canManage">
            <option v-for="o in maxUsesOptions" :key="o.value" :value="o.value">{{ o.label }}</option>
          </select>
        </div>
        <Button @click="createInvite" :disabled="creating || !canManage">
          <Loader2 v-if="creating" class="w-4 h-4 mr-2 animate-spin" />
          <PlusIcon v-else class="w-4 h-4 mr-2" />
          {{ t("add_invite") }}
        </Button>
      </div>
    </div>

    <!-- Existing invites -->
    <div class="space-y-2">
      <div class="spinner-container" v-if="loading">
        <AtomSpinner class="text-center" />
      </div>

      <p v-else-if="invites.length === 0" class="text-sm text-muted-foreground text-center py-8">
        {{ t("no_any_invite_codes_created") }}
      </p>

      <div v-else v-for="invite in invites" :key="invite.code.inviteCode" class="invite-row">
        <div class="flex-1 min-w-0">
          <div class="font-mono text-sm truncate">{{ inviteUrl(invite) }}</div>
          <div class="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs text-muted-foreground">
            <span class="inline-flex items-center gap-1">
              <UsersIcon class="w-3.5 h-3.5" />
              {{ usesLabel(invite) }}
            </span>
            <span class="inline-flex items-center gap-1">
              <ClockIcon class="w-3.5 h-3.5" />
              {{ expiryLabel(invite) }}
            </span>
          </div>
        </div>
        <div class="flex items-center gap-1 shrink-0">
          <Button @click="copyInvite(invite)" variant="ghost" size="icon" :title="t('copy')">
            <CopyIcon class="w-4 h-4" />
          </Button>
          <Button
            @click="revokeInvite(invite)"
            variant="ghost"
            size="icon"
            class="text-red-500 hover:text-red-400"
            :disabled="!canManage || revokingCode === invite.code.inviteCode"
            :title="t('remove')"
          >
            <Loader2 v-if="revokingCode === invite.code.inviteCode" class="w-4 h-4 animate-spin" />
            <Trash2Icon v-else class="w-4 h-4" />
          </Button>
        </div>
      </div>
    </div>

    <!-- Invite splash image (verified / official only) -->
    <div v-if="canUploadInviteImage" class="setting-card space-y-3">
      <div class="flex items-center gap-2">
        <ImageIcon class="w-5 h-5" />
        <h3 class="font-medium">{{ t("invite_splash_image") }}</h3>
      </div>
      <p class="text-sm text-muted-foreground">{{ t("invite_splash_image_desc") }}</p>

      <div
        class="invite-splash-preview"
        :style="inviteImageUrl ? { backgroundImage: `url(${inviteImageUrl})` } : {}"
        :class="{ 'is-empty': !inviteImageUrl }"
      >
        <span v-if="!inviteImageUrl" class="text-sm text-muted-foreground">{{ t("no_image_uploaded") }}</span>
      </div>

      <div class="flex items-center gap-2">
        <input ref="inviteImageInput" type="file" accept="image/*" class="hidden" @change="onInviteImageSelected" />
        <Button variant="outline" size="sm" :disabled="uploadingInviteImage" @click="inviteImageInput?.click()">
          <Loader2 v-if="uploadingInviteImage" class="w-4 h-4 mr-2 animate-spin" />
          <UploadIcon v-else class="w-4 h-4 mr-2" />
          {{ inviteImageUrl ? t("replace_image") : t("upload_image") }}
        </Button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref, computed } from "vue";
import { Button } from "@argon/ui/button";
//@ts-ignore
import { AtomSpinner } from "epic-spinners";
import {
  LinkIcon,
  PlusIcon,
  CopyIcon,
  Trash2Icon,
  UsersIcon,
  ClockIcon,
  ImageIcon,
  UploadIcon,
  Loader2,
} from "lucide-vue-next";
import { useSpaceStore } from "@/store/data/serverStore";
import { useLocale } from "@/store/system/localeStore";
import { usePexStore } from "@/store/data/permissionStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useApi } from "@/store/system/apiStore";
import { useToast } from "@argon/ui/toast";
import { uploadFile } from "@/lib/uploadFile";
import { cdnUrl } from "@/store/system/fileStorage";
import { useLiveQuery } from "@/composables/useLiveQuery";
import { db } from "@/store/db/dexie";
import type { InviteCodeEntity } from "@argon/glue";
import type { DateTimeOffset } from "@argon-chat/ion.webcore";

const { t } = useLocale();
const servers = useSpaceStore();
const pex = usePexStore();
const pool = usePoolStore();
const api = useApi();
const { toast } = useToast();

const loading = ref(true);
const invites = ref<InviteCodeEntity[]>([]);
const inviteDomain = ref("https://argon.gl/i");

const canManage = computed(() => pex.has("ManageServer"));
const spaceId = computed(() => pool.selectedServer);
const currentSpace = useLiveQuery(() => db.servers.where("spaceId").equals(spaceId.value ?? "").first());

// ── Create form ──────────────────────────────────────────
const expiryOptions = [
  { label: t("invite_30_minutes"), minutes: 30 },
  { label: t("invite_1_hour"), minutes: 60 },
  { label: t("invite_6_hours"), minutes: 360 },
  { label: t("invite_12_hours"), minutes: 720 },
  { label: t("invite_1_day"), minutes: 1440 },
  { label: t("invite_7_days"), minutes: 10080 },
  { label: t("invite_never"), minutes: 0 },
];
const maxUsesOptions = [
  { label: t("invite_no_limit"), value: 0 },
  { label: "1", value: 1 },
  { label: "5", value: 5 },
  { label: "10", value: 10 },
  { label: "25", value: 25 },
  { label: "50", value: 50 },
  { label: "100", value: 100 },
];

const newExpireMinutes = ref(10080); // 7 days
const newMaxUses = ref(0); // unlimited
const creating = ref(false);
const revokingCode = ref<string | null>(null);

onMounted(refreshInvites);

async function refreshInvites() {
  loading.value = true;
  try {
    const res = await servers.getServerInvites();
    invites.value = res ? [...res.invites] : [];
    if (res?.domain) inviteDomain.value = res.domain;
  } finally {
    loading.value = false;
  }
}

async function createInvite() {
  creating.value = true;
  try {
    await servers.addInvite(newExpireMinutes.value, newMaxUses.value);
    await refreshInvites();
  } finally {
    creating.value = false;
  }
}

async function revokeInvite(invite: InviteCodeEntity) {
  revokingCode.value = invite.code.inviteCode;
  try {
    await servers.revokeInvite(invite.code);
    invites.value = invites.value.filter((i) => i.code.inviteCode !== invite.code.inviteCode);
  } finally {
    revokingCode.value = null;
  }
}

// ── Display helpers ───────────────────────────────────────
function inviteUrl(invite: InviteCodeEntity): string {
  return `${inviteDomain.value.replace(/\/+$/, "")}/${invite.code.inviteCode}`;
}

function usesLabel(invite: InviteCodeEntity): string {
  const used = Number(invite.used);
  return invite.maxUses > 0 ? `${used} / ${invite.maxUses}` : `${used} / ∞`;
}

// Server models "never" as a far-future timestamp; treat anything >50y out as never.
function isNever(dto: DateTimeOffset | null | undefined): boolean {
  if (!dto?.date) return true;
  const fiftyYears = 50 * 365 * 24 * 60 * 60 * 1000;
  return new Date(dto.date).getTime() - Date.now() > fiftyYears;
}

function expiryLabel(invite: InviteCodeEntity): string {
  if (isNever(invite.expireTime)) return t("invite_never");
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(invite.expireTime.date));
}

function copyInvite(invite: InviteCodeEntity) {
  navigator.clipboard.writeText(inviteUrl(invite));
  toast({ title: t("copied") });
}

// ── Invite splash image (task 7) ──────────────────────────
const canUploadInviteImage = computed(() => !!currentSpace.value && (currentSpace.value.isVerified || currentSpace.value.isOfficial));
const inviteImageUrl = computed(() => {
  const id = currentSpace.value?.inviteImageFileId;
  return id ? cdnUrl(id) : "";
});

const inviteImageInput = ref<HTMLInputElement | null>(null);
const uploadingInviteImage = ref(false);

async function onInviteImageSelected(event: Event) {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = "";
  if (!file || !spaceId.value) return;

  uploadingInviteImage.value = true;
  try {
    const begin = await api.serverInteraction.BeginUploadInviteImage(spaceId.value);
    const { blobId } = await uploadFile(begin, file, "SpaceInviteImage");
    await api.serverInteraction.CompleteUploadInviteImage(spaceId.value, blobId);
    await pool.loadServerDetails?.();
    toast({ title: t("invite_splash_image_updated") });
  } catch (e) {
    toast({ title: t("error"), description: String(e), variant: "destructive" });
  } finally {
    uploadingInviteImage.value = false;
  }
}
</script>

<style scoped>
.invites-settings {
  max-width: 900px;
  margin: 0 auto;
}

.setting-card {
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card));
  padding: 1.25rem;
}

.inv-select {
  width: 100%;
  border-radius: 0.5rem;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  padding: 0.5rem 0.625rem;
  font-size: 0.875rem;
  color: inherit;
}

.inv-select:focus {
  outline: none;
  border-color: hsl(var(--primary) / 0.6);
}

.invite-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem 1rem;
  border-radius: 0.625rem;
  border: 1px solid hsl(var(--border) / 0.6);
  background: hsl(var(--muted) / 0.25);
}

.invite-splash-preview {
  width: 100%;
  aspect-ratio: 16 / 9;
  border-radius: 0.625rem;
  border: 1px dashed hsl(var(--border));
  background-size: cover;
  background-position: center;
  display: flex;
  align-items: center;
  justify-content: center;
}

.invite-splash-preview.is-empty {
  background: hsl(var(--muted) / 0.3);
}

.spinner-container {
  display: flex;
  justify-content: center;
  align-items: center;
  padding: 2rem 0;
}

.hidden {
  display: none;
}
</style>
