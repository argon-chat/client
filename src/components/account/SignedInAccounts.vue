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
 * Rows are drawn from the registry, not from the network — no instance is contacted to show them,
 * and no account is entered without the user asking for it.
 */
import { ref } from "vue";
import { useAccounts, type AccountRecord } from "@/store/auth/accountsStore";
import { useLocale } from "@/store/system/localeStore";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { Badge } from "@argon/ui/badge";
import { AlertTriangleIcon, LogInIcon, ServerIcon, Trash2Icon } from "lucide-vue-next";

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
  <div class="signed-in-accounts">
    <p class="panel-title">{{ t("accounts_on_this_device") }}</p>

    <div class="flex flex-col gap-0.5 max-h-[164px] overflow-y-auto">
      <div
        v-for="a in accounts.accounts"
        :key="a.id"
        class="account-row"
        :class="{ 'is-enterable': canEnter(a) }"
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
          <div class="flex min-w-0 items-center gap-1.5">
            <span class="truncate text-sm font-medium text-white">{{ a.displayName }}</span>
            <Badge v-if="a.instanceKind !== 'official'" variant="secondary" class="instance-badge">
              <ServerIcon class="w-3 h-3 shrink-0" />
              <span class="truncate">{{ a.instanceManifest.branding.displayName }}</span>
            </Badge>
          </div>
          <span v-if="!canEnter(a)" class="row-note text-yellow-500">
            <AlertTriangleIcon class="w-3 h-3 shrink-0" />
            <span class="truncate">{{ t("account_needs_reauth") }}</span>
          </span>
          <span v-else class="row-note text-muted-foreground">
            <LogInIcon class="w-3 h-3 shrink-0" />
            <span class="truncate">{{ t("account_continue_hint") }}</span>
          </span>
        </div>

        <button
          type="button"
          class="row-remove icon-motion icon-motion--pop"
          :class="{ 'is-confirming': removingId === a.id }"
          :title="t('remove_account')"
          @click.stop="confirmRemove(a)"
        >
          <Trash2Icon class="w-4 h-4" />
        </button>
      </div>
    </div>

    <p v-if="removingId" class="px-2 pt-1.5 text-[11px] leading-snug text-muted-foreground">
      {{ t("remove_account_confirm") }}
    </p>
  </div>
</template>

<style scoped>
.signed-in-accounts {
  @apply w-full max-w-[400px] rounded-2xl border border-border/50 bg-card/80 p-2 backdrop-blur-xl shadow-2xl;
}

.panel-title {
  @apply px-2 pb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground;
}

.account-row {
  @apply flex items-center gap-2.5 rounded-lg px-2 py-1.5 transition-colors;
}
.account-row.is-enterable {
  @apply cursor-pointer;
}
.account-row.is-enterable:hover {
  @apply bg-primary/10;
}

/* Sits on the name's line and must not grow it — see the same badge in the in-app picker. */
.instance-badge {
  @apply min-w-0 max-w-[45%] shrink gap-1 px-1.5 py-0 h-[18px] text-[10px] font-medium leading-4;
}

.row-note {
  @apply mt-0.5 flex min-w-0 items-center gap-1 text-[11px] leading-4;
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
</style>
