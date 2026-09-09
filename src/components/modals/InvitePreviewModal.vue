<template>
  <Dialog v-model:open="open">
    <DialogContent class="sm:max-w-[440px] p-0 overflow-hidden rounded-2xl border bg-card">
      <!-- Named for screen readers only: this dialog draws no heading of its own. -->
      <VisuallyHidden>
        <DialogTitle>{{ t("invite_preview_title") }}</DialogTitle>
      </VisuallyHidden>
      <!-- Loading -->
      <div v-if="loading" class="flex flex-col items-center justify-center gap-3 py-16">
        <Loader2 class="w-7 h-7 animate-spin text-muted-foreground" />
        <p class="text-sm text-muted-foreground">{{ t("loading_invite") }}</p>
      </div>

      <!-- Error -->
      <div v-else-if="errorMessage" class="flex flex-col items-center justify-center gap-4 px-8 py-14 text-center">
        <EmptyStateArt :name="errorBanned ? 'forbidden' : 'invite-invalid'" :size="144" />
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

          <h2 class="text-xl font-bold truncate mt-3">{{ preview.name }}</h2>

          <!-- Written out rather than left to the seal icons used elsewhere: this is the one screen
               where the reader has never seen the space before and decides from it alone. -->
          <div v-if="spaceTags.length" class="flex flex-wrap items-center gap-1.5 mt-2">
            <span v-for="tag in spaceTags" :key="tag.key" class="space-tag" :class="tag.class">
              <component :is="tag.icon" weight="fill" class="w-3.5 h-3.5" />
              {{ tag.label }}
            </span>
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

          <!-- A link minted for a room says so: the room, not the space, is where this drops you. -->
          <div v-if="preview.voiceChannelId" class="voice-target mt-4">
            <Volume2Icon class="w-4 h-4 shrink-0" />
            <div class="min-w-0">
              <div class="text-[11px] uppercase tracking-wider opacity-80">{{ t("voice_channel") }}</div>
              <div class="text-sm font-medium truncate">{{ preview.voiceChannelName }}</div>
            </div>
          </div>

          <div v-if="joinError" class="text-sm text-destructive mt-3">{{ joinError }}</div>

          <!-- Actions -->
          <div class="flex gap-2 mt-5">
            <Button variant="outline" class="flex-1" :disabled="joining" @click="open = false">
              {{ t("cancel") }}
            </Button>
            <Button class="flex-1" :disabled="joining" @click="doJoin">
              <Loader2 v-if="joining" class="w-4 h-4 mr-2 animate-spin" />
              <Volume2Icon v-else-if="preview.voiceChannelId" class="w-4 h-4 mr-2" />
              <LogInIcon v-else class="w-4 h-4 mr-2" />
              {{ preview.voiceChannelId ? t("invite_join_voice") : t("join_to_server") }}
            </Button>
          </div>
        </div>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch, type Component } from "vue";
import { Dialog, DialogContent, DialogTitle } from "@argon/ui/dialog";
import { VisuallyHidden } from "@argon/ui/visually-hidden";
import { Button } from "@argon/ui/button";
import { Loader2, UsersIcon, LogInIcon, Volume2Icon } from "lucide-vue-next";
import { useRouter } from "vue-router";
import { PhSealCheck, PhUsersThree } from "@phosphor-icons/vue";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useWindow } from "@/store/ui/windowStore";
import { useApi } from "@/store/system/apiStore";
import { useSpaceStore } from "@/store/data/serverStore";
import { usePoolStore } from "@/store/data/poolStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useUnifiedCall } from "@/store/media/unifiedCallStore";
import { logger } from "@argon/core";
import EmptyStateArt from "@/components/shared/EmptyStateArt.vue";
import { useLocale } from "@/store/system/localeStore";
import { cdnUrl } from "@/store/system/fileStorage";
import { AcceptInviteError } from "@argon/glue";
import type { InvitePreview } from "@argon/glue";

const { t } = useLocale();
const windows = useWindow();
const api = useApi();
const spaceStore = useSpaceStore();
const pool = usePoolStore();
const pex = usePexStore();
const voice = useUnifiedCall();
const router = useRouter();

const open = computed({
  get: () => windows.invitePreviewOpen,
  set: (v: boolean) => (windows.invitePreviewOpen = v),
});

const loading = ref(false);
const preview = ref<InvitePreview | null>(null);
const errorMessage = ref("");
const joining = ref(false);
const joinError = ref("");

const spaceTags = computed(() => {
  const p = preview.value;
  if (!p) return [];
  const tags: { key: string; label: string; class: string; icon: Component }[] = [];
  if (p.isOfficial)
    tags.push({ key: "official", label: t("space_badge_official"), class: "space-tag--official", icon: PhSealCheck });
  else if (p.isVerified)
    tags.push({ key: "verified", label: t("space_badge_verified"), class: "space-tag--verified", icon: PhSealCheck });
  if (p.isCommunity)
    tags.push({ key: "community", label: t("space_badge_community"), class: "space-tag--community", icon: PhUsersThree });
  return tags;
});

const bannerUrl = computed(() =>
  preview.value?.topBannerFileId ? cdnUrl(preview.value.topBannerFileId, preview.value.spaceId) : "",
);

/** Whether the refusal was "you personally may not", as opposed to a link that no longer works. */
const errorBanned = ref(false);

function errorFor(error: AcceptInviteError): string {
  switch (error) {
    case AcceptInviteError.EXPIRED:
      return t("invite_expired");
    case AcceptInviteError.LIMIT_REACHED:
      return t("invite_limit_reached");
    case AcceptInviteError.YOU_ARE_BANNED:
      errorBanned.value = true;
      return t("invite_banned");
    default:
      return t("invite_not_found");
  }
}

async function load(code: string) {
  loading.value = true;
  preview.value = null;
  errorMessage.value = "";
  errorBanned.value = false;
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
    const target = preview.value;
    const err = await spaceStore.joinToServer(windows.invitePreviewCode);
    if (err) {
      joinError.value = err;
      return;
    }
    open.value = false;

    // A room link is a link to the room, not to the space around it. Joining is only half of what
    // was asked for; the other half is being in the room, which the person who sent the link is
    // already sitting in. Already-a-member is the same path: JoinToSpace succeeds either way.
    if (target?.voiceChannelId) await enterVoiceRoom(target.spaceId, target.voiceChannelId);
  } finally {
    joining.value = false;
  }
}

/**
 * Opens the space on the room, then connects.
 *
 * The connect cannot simply be called: CallManager reads `pool.selectedServer` and the caller's
 * `Connect` entitlement, and refuses — silently, by design — when either is not there yet. Both
 * arrive asynchronously after the space is selected (the permission set is a liveQuery bound to the
 * selection), so this waits for them rather than firing into a window where the answer is always no.
 */
async function enterVoiceRoom(spaceId: string, channelId: string) {
  try {
    await router.push({ name: "SpaceChannel", params: { id: spaceId, channelId } });

    const ready = await until(() => pool.selectedServer === spaceId && pex.has("Connect"), 8000);
    if (!ready) {
      logger.warn("[invite] voice room join skipped: space or permissions never arrived");
      return;
    }

    if (voice.connectedVoiceChannelId === channelId) return;
    if (voice.isConnected) await voice.leave();

    await voice.joinVoiceChannel(channelId);
  } catch (e) {
    logger.error("[invite] failed to enter the invited voice room", e);
  }
}

/** Resolves true as soon as the condition holds, false if it never does inside `timeoutMs`. */
function until(condition: () => boolean, timeoutMs: number): Promise<boolean> {
  if (condition()) return Promise.resolve(true);

  return new Promise((resolve) => {
    const started = Date.now();
    const timer = window.setInterval(() => {
      if (condition()) {
        window.clearInterval(timer);
        resolve(true);
      } else if (Date.now() - started >= timeoutMs) {
        window.clearInterval(timer);
        resolve(false);
      }
    }, 100);
  });
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

.voice-target {
  display: flex;
  align-items: center;
  gap: 0.6rem;
  padding: 0.6rem 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--primary) / 0.25);
  background: hsl(var(--primary) / 0.08);
  color: hsl(var(--primary));
}

.invite-banner.is-empty {
  background: linear-gradient(135deg, hsl(var(--primary) / 0.35), hsl(var(--primary) / 0.1));
}

.space-tag {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.1rem 0.45rem;
  border-radius: 9999px;
  border: 1px solid currentColor;
  font-size: 0.7rem;
  font-weight: 600;
  line-height: 1.2;
}

.space-tag--official {
  color: #38bdf8;
  background: rgb(56 189 248 / 0.12);
}

.space-tag--verified {
  color: #fbbf24;
  background: rgb(251 191 36 / 0.12);
}

.space-tag--community {
  color: #34d399;
  background: rgb(52 211 153 / 0.12);
}

.online-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 9999px;
  background: #22c55e;
  box-shadow: 0 0 6px #22c55eaa;
}
</style>
