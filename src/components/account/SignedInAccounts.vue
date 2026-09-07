<script setup lang="ts">
/**
 * The sign-in screen's way back to the accounts already on this device.
 *
 * Landing here almost never means every account is signed out — usually exactly one is, because the
 * server refused it: the session was revoked, or the account was deleted outright. The picker that
 * would step over to the others lives inside the app, which is the one place that cannot be reached
 * from a sign-in screen, so a single refused account used to take the whole device with it: nothing
 * said the others were still there, and the only way back in was to type a password for one of them.
 *
 * Stands beside the form, not under it: it is an alternative to filling the form in, and reads as
 * one when the two sit side by side. Rows come from the registry — no instance is contacted to show
 * them, and no account is entered without the user asking for it.
 */
import { ref } from "vue";
import { useAccounts, type AccountRecord } from "@/store/auth/accountsStore";
import { useLocale } from "@/store/system/localeStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { AlertTriangleIcon, ServerIcon, XIcon } from "lucide-vue-next";

const { t } = useLocale();
const accounts = useAccounts();

const removingId = ref<string | null>(null);

/**
 * An account can be entered straight from here when it still holds a session of its own. The one
 * that is active is the one that just landed us on this screen, so it takes the form, not a click.
 */
function canEnter(a: AccountRecord): boolean {
  return a.id !== accounts.active?.id && !a.needsReauth;
}

/**
 * Avatars come from the copy taken while the account was the active one, never from a file id: an
 * id only means something on the instance that issued it, and there is no signed-in instance to ask
 * on this screen anyway. Without a copy the row falls back to initials.
 */
function avatarSrc(a: AccountRecord): string | null {
  return a.avatarDataUrl ?? null;
}

function select(a: AccountRecord) {
  if (!canEnter(a)) return;
  void accounts.switchTo(a.id);
}

function confirmRemove(a: AccountRecord) {
  if (removingId.value === a.id) {
    void accounts.removeAccount(a.id); // moves into the next account, or reloads into a clean sign-in
    removingId.value = null;
  } else {
    removingId.value = a.id;
  }
}
</script>

<template>
  <aside class="accounts-panel">
    <div class="px-1 pb-2">
      <p class="panel-title">{{ t("accounts_on_this_device") }}</p>
      <p class="panel-subtitle">{{ t("account_continue_hint") }}</p>
    </div>

    <div class="flex flex-col gap-0.5">
      <div
        v-for="a in accounts.accounts"
        :key="a.id"
        class="account-row"
        :class="{ 'is-enterable': canEnter(a), 'is-confirming': removingId === a.id }"
        @click="select(a)"
      >
        <ArgonAvatar
          class="row-avatar"
          :fallback="a.displayName"
          :src="avatarSrc(a)"
          :file-id="null"
          :user-id="a.userId"
        />

        <div class="min-w-0 flex-1">
          <span class="row-name">{{ a.displayName }}</span>
          <!-- The instance is part of who this is: the same person can be two accounts on two of them. -->
          <span v-if="a.instanceKind !== 'official'" class="row-note text-muted-foreground">
            <ServerIcon class="w-3 h-3 shrink-0" />
            <span class="truncate">{{ a.instanceManifest.branding.displayName }}</span>
          </span>
          <span v-if="!canEnter(a)" class="row-note text-yellow-500">
            <AlertTriangleIcon class="w-3 h-3 shrink-0" />
            <span class="truncate">{{ t("account_needs_reauth") }}</span>
          </span>
        </div>

        <button
          type="button"
          class="row-remove"
          :title="t('remove_account')"
          @click.stop="confirmRemove(a)"
        >
          <XIcon class="w-3.5 h-3.5" />
        </button>
      </div>
    </div>

    <p v-if="removingId" class="panel-hint">{{ t("remove_account_confirm") }}</p>
  </aside>
</template>

<style scoped>
.accounts-panel {
  @apply w-[268px] shrink-0 rounded-2xl border border-border/50 bg-card/80 p-2.5
         backdrop-blur-xl shadow-2xl;
}

.panel-title {
  @apply text-xs font-semibold uppercase tracking-wide text-muted-foreground;
}

.panel-subtitle {
  @apply mt-0.5 text-[11px] leading-snug text-muted-foreground/70;
}

.panel-hint {
  @apply px-1 pt-2 text-[11px] leading-snug text-muted-foreground;
}

.account-row {
  @apply relative flex items-center gap-2.5 rounded-xl px-2 py-1.5 transition-colors;
}
.account-row.is-enterable {
  @apply cursor-pointer;
}
.account-row.is-enterable:hover {
  @apply bg-primary/10;
}
/* The refused one is still listed — it is why this screen is here — but it is not a way in. */
.account-row:not(.is-enterable) {
  @apply opacity-70;
}
.account-row.is-confirming {
  @apply bg-destructive/10 opacity-100;
}

.row-avatar {
  @apply w-9 h-9 rounded-full shrink-0;
}

.row-name {
  @apply block truncate text-sm font-medium text-foreground;
}

.row-note {
  @apply mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-4;
}

/* Kept out of the way until the row is pointed at — a column of crosses would read as "close
   these" — but its space is held, so nothing shifts under the cursor. Same as the in-app picker. */
.row-remove {
  @apply shrink-0 rounded-lg p-1.5 text-muted-foreground opacity-0 transition-all hover:text-destructive;
}
.account-row:hover .row-remove,
.account-row.is-confirming .row-remove {
  @apply opacity-100;
}
.account-row.is-confirming .row-remove {
  @apply text-destructive;
}
</style>
