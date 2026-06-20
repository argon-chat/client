<script setup lang="ts">
import { ref } from "vue";
import { useAccounts, type AccountRecord } from "@/store/auth/accountsStore";
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
        <ArgonAvatar class="row-avatar" :fallback="a.displayName" :file-id="a.avatarFileId" :user-id="a.userId" />
        <div class="min-w-0 flex-1">
          <div class="flex items-center gap-1.5">
            <span class="truncate text-sm font-medium text-white">{{ a.displayName }}</span>
            <CheckIcon v-if="a.id === accounts.active?.id" class="w-3.5 h-3.5 shrink-0 text-primary" />
          </div>
          <div class="flex items-center gap-1 mt-0.5">
            <Badge v-if="!isOfficial(a)" variant="secondary" class="gap-1 px-1.5 py-0 text-[10px]">
              <ServerIcon class="w-2.5 h-2.5" />
              {{ a.instanceManifest.branding.displayName }}
            </Badge>
            <span v-if="a.needsReauth" class="flex items-center gap-1 text-[11px] text-yellow-500">
              <AlertTriangleIcon class="w-3 h-3" />
              {{ t("account_needs_reauth") }}
            </span>
          </div>
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
