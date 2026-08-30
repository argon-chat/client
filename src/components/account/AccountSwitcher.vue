<script setup lang="ts">
import { ref } from "vue";
import { useAccounts, type AccountRecord } from "@/store/auth/accountsStore";
import { cdnUrl } from "@/store/system/fileStorage";
import { useLocale } from "@/store/system/localeStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { Badge } from "@argon/ui/badge";
import { CheckIcon, PlusIcon, LogOutIcon, Trash2Icon, ServerIcon, AlertTriangleIcon } from "lucide-vue-next";

const { t } = useLocale();
const accounts = useAccounts();

const emit = defineEmits<{ (e: "add"): void }>();

const removingId = ref<string | null>(null);

function isOfficial(a: AccountRecord) {
  return a.instanceKind === "official";
}

/**
 * Only the active account's avatar can be asked for by file id: every avatar URL is built against
 * the instance we are currently pointed at, so doing that for the other rows both fails and sends a
 * foreign instance's file id to this one. They draw from the copy taken while they were active, or
 * fall back to initials.
 */
function avatarSrc(a: AccountRecord): string | null {
  if (a.avatarDataUrl) return a.avatarDataUrl;
  if (a.id === accounts.active?.id && a.avatarFileId) return cdnUrl(a.avatarFileId);
  return null;
}

function select(a: AccountRecord) {
  if (a.id === accounts.active?.id && !a.needsReauth) return;
  void accounts.switchTo(a.id); // reloads
}

function confirmRemove(a: AccountRecord) {
  if (removingId.value === a.id) {
    void accounts.removeAccount(a.id); // reloads if it was active
    removingId.value = null;
  } else {
    removingId.value = a.id;
  }
}
</script>

<template>
  <div class="account-switcher">
    <p class="px-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
      {{ t("accounts_title") }}
    </p>

    <div class="flex flex-col gap-0.5 max-h-[300px] overflow-y-auto">
      <div
        v-for="a in accounts.accounts"
        :key="a.id"
        class="account-row"
        :class="{ 'is-active': a.id === accounts.active?.id }"
        @click="select(a)"
      >
        <ArgonAvatar class="row-avatar" :fallback="a.displayName" :src="avatarSrc(a)" :file-id="null" :user-id="a.userId" />
        <div class="min-w-0 flex-1">
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-sm font-medium text-white">{{ a.displayName }}</span>
            <CheckIcon v-if="a.id === accounts.active?.id" class="w-3.5 h-3.5 shrink-0 text-primary" />
            <Badge v-if="!isOfficial(a)" variant="secondary" class="instance-badge">
              <ServerIcon class="w-3 h-3 shrink-0" />
              <span class="truncate">{{ a.instanceManifest.branding.displayName }}</span>
            </Badge>
          </div>
          <span v-if="a.needsReauth" class="mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-4 text-yellow-500">
            <AlertTriangleIcon class="w-3 h-3 shrink-0" />
            <span class="truncate">{{ t("account_needs_reauth") }}</span>
          </span>
        </div>

        <button
          class="row-remove"
          :class="{ 'is-confirming': removingId === a.id }"
          :title="t('remove_account')"
          @click.stop="confirmRemove(a)"
        >
          <Trash2Icon class="w-4 h-4" />
        </button>
      </div>
    </div>

    <p v-if="removingId" class="px-2 py-1.5 text-[11px] leading-snug text-muted-foreground">
      {{ t("remove_account_confirm") }}
    </p>

    <div class="mt-1 border-t border-border/50 pt-1 flex flex-col gap-0.5">
      <button class="menu-item" @click="emit('add')">
        <PlusIcon class="w-4 h-4" />
        {{ t("add_account") }}
      </button>
      <button class="menu-item text-destructive" @click="accounts.logoutActive()">
        <LogOutIcon class="w-4 h-4" />
        {{ t("log_out") }}
      </button>
    </div>
  </div>
</template>

<style scoped>
.account-switcher {
  @apply w-[280px] p-1.5;
}

.account-row {
  @apply flex items-center gap-2.5 rounded-lg px-2 py-1.5 cursor-pointer transition-colors;
}
.account-row:hover {
  @apply bg-primary/10;
}
.account-row.is-active {
  @apply bg-primary/5;
}

/* Sits on the name's line, so it must not grow the line: `py-0` on the shared Badge leaves the
   height to whatever line-height the row passes down, which is stated here instead. It also gives
   up width before the name does — `min-w-0` plus a share of the row — and the line box is 16px
   against 10px text because truncation is `overflow: hidden`, which crops the descenders of
   "Argon (dev)" the moment the box is no taller than the glyphs. */
.instance-badge {
  @apply min-w-0 max-w-[45%] shrink gap-1 px-1.5 py-0 h-[18px] text-[10px] font-medium leading-4;
}

.row-avatar {
  @apply w-9 h-9 rounded-full shrink-0;
}

.row-remove {
  @apply shrink-0 p-1.5 rounded-md text-muted-foreground opacity-0 transition-all hover:text-destructive;
}
.account-row:hover .row-remove {
  @apply opacity-100;
}
.row-remove.is-confirming {
  @apply opacity-100 text-destructive bg-destructive/10;
}

.menu-item {
  @apply flex items-center gap-2.5 rounded-lg px-2 py-1.5 text-sm text-foreground transition-colors hover:bg-primary/10;
}
.menu-item.text-destructive:hover {
  @apply bg-destructive/10;
}
</style>
