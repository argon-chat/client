<template>
  <div class="bots-settings">
    <div class="flex items-center gap-2 mb-1">
      <BotIcon class="w-5 h-5" />
      <h3 class="text-lg font-semibold">{{ t("bots_manage") }}</h3>
    </div>
    <p class="text-sm text-muted-foreground mb-4">{{ t("bots_manage_description") }}</p>

    <!-- Tabs -->
    <div class="flex gap-2 border-b border-border mb-4">
      <button
        @click="activeTab = 'search'"
        class="tab-btn"
        :class="activeTab === 'search' ? 'tab-btn--active' : ''"
      >
        {{ t("bots_search") }}
      </button>
      <button
        @click="activeTab = 'installed'"
        class="tab-btn"
        :class="activeTab === 'installed' ? 'tab-btn--active' : ''"
      >
        {{ t("bots_installed") }}
        <span
          v-if="installedBots.length > 0"
          class="ml-1.5 px-1.5 py-0.5 text-xs rounded-full bg-primary/15 text-primary"
        >
          {{ installedBots.length }}
        </span>
      </button>
    </div>

    <!-- Search Tab -->
    <div v-if="activeTab === 'search'" class="space-y-4">
      <div class="flex gap-2">
        <Input
          v-model="searchQuery"
          :placeholder="t('bots_search_placeholder')"
          class="flex-1"
          @keydown.enter="doSearch"
        />
        <Button @click="doSearch" :disabled="isSearching" variant="outline" size="icon">
          <SearchIcon v-if="!isSearching" class="w-4 h-4" />
          <LoaderIcon v-else class="w-4 h-4 animate-spin" />
        </Button>
      </div>

      <div v-if="searchError" class="text-sm text-destructive">{{ searchError }}</div>

      <div class="space-y-2">
        <div
          v-if="searchResults.length === 0 && hasSearched && !isSearching"
          class="text-center text-muted-foreground py-8 text-sm"
        >
          {{ t("bots_no_results") }}
        </div>

        <div
          v-for="bot in searchResults"
          :key="bot.appId"
          class="bot-row"
        >
          <ArgonAvatar :file-id="bot.avatarFileId" :fallback="bot.name?.[0] ?? '?'" :overrided-size="40" />
          <div class="flex-1 min-w-0">
            <div class="flex items-center gap-1.5">
              <span class="font-semibold text-foreground truncate">{{ bot.name }}</span>
              <BadgeCheckIcon v-if="bot.isVerified" class="w-4 h-4 text-primary shrink-0" />
            </div>
            <div class="text-sm text-muted-foreground truncate">@{{ bot.username }}</div>
            <div v-if="bot.description" class="text-xs text-muted-foreground/70 truncate mt-0.5">
              {{ bot.description }}
            </div>
          </div>
          <Button size="sm" @click="installBot(bot.appId)" :disabled="installingBotId === bot.appId">
            <LoaderIcon v-if="installingBotId === bot.appId" class="w-3.5 h-3.5 animate-spin mr-1.5" />
            <DownloadIcon v-else class="w-3.5 h-3.5 mr-1.5" />
            {{ t("bots_install") }}
          </Button>
        </div>
      </div>

      <div v-if="installMessage" class="text-sm" :class="installMessageIsError ? 'text-destructive' : 'text-emerald-500'">
        {{ installMessage }}
      </div>
    </div>

    <!-- Installed Tab -->
    <div v-if="activeTab === 'installed'" class="space-y-4">
      <div v-if="isLoadingInstalled" class="flex justify-center py-8">
        <LoaderIcon class="w-6 h-6 animate-spin text-muted-foreground" />
      </div>

      <div v-else-if="installedBots.length === 0" class="text-center text-muted-foreground py-8 text-sm">
        {{ t("bots_none_installed") }}
      </div>

      <div v-else class="space-y-2">
        <div
          v-for="bot in installedBots"
          :key="bot.appId"
          class="flex flex-col gap-2 p-3 rounded-xl border transition-colors"
          :class="bot.pendingApproval ? 'border-yellow-500/50 bg-yellow-500/5' : 'border-border hover:bg-accent/40'"
        >
          <div class="flex items-center gap-3">
            <ArgonAvatar :file-id="bot.avatarFileId" :fallback="bot.name?.[0] ?? '?'" :overrided-size="40" />
            <div class="flex-1 min-w-0">
              <div class="flex items-center gap-1.5">
                <span class="font-semibold text-foreground truncate">{{ bot.name }}</span>
                <BadgeCheckIcon v-if="bot.isVerified" class="w-4 h-4 text-primary shrink-0" />
              </div>
              <div class="text-sm text-muted-foreground truncate">@{{ bot.username }}</div>
            </div>
            <div class="flex items-center gap-2">
              <Button
                v-if="bot.pendingApproval"
                size="sm"
                variant="outline"
                class="border-yellow-500/50 text-yellow-600 hover:bg-yellow-500/10"
                @click="approveBotEntitlements(bot.appId)"
                :disabled="approvingBotId === bot.appId"
              >
                <LoaderIcon v-if="approvingBotId === bot.appId" class="w-3.5 h-3.5 animate-spin mr-1.5" />
                <ShieldAlertIcon v-else class="w-3.5 h-3.5 mr-1.5" />
                {{ t("bots_approve") }}
              </Button>
              <Button
                size="sm"
                variant="destructive"
                @click="uninstallBot(bot.appId)"
                :disabled="uninstallingBotId === bot.appId"
              >
                <LoaderIcon v-if="uninstallingBotId === bot.appId" class="w-3.5 h-3.5 animate-spin mr-1.5" />
                <Trash2Icon v-else class="w-3.5 h-3.5 mr-1.5" />
                {{ t("bots_uninstall") }}
              </Button>
            </div>
          </div>

          <!-- Pending approval banner -->
          <div v-if="bot.pendingApproval" class="flex flex-col gap-1.5 px-2 py-2 rounded-lg bg-yellow-500/10">
            <div class="flex items-center gap-1.5 text-sm font-medium text-yellow-600">
              <ShieldAlertIcon class="w-4 h-4 shrink-0" />
              {{ t("bots_pending_approval") }}
            </div>
            <div v-if="getMissingEntitlements(bot).length > 0" class="flex flex-wrap gap-1">
              <span
                v-for="flag in getMissingEntitlements(bot)"
                :key="flag"
                class="inline-flex items-center px-2 py-0.5 text-xs font-medium rounded-full bg-yellow-500/15 text-yellow-700"
              >
                {{ t(`permissions.flags.${flag}`) }}
              </span>
            </div>
          </div>
        </div>
      </div>

      <div v-if="approveMessage" class="text-sm" :class="approveMessageIsError ? 'text-destructive' : 'text-emerald-500'">
        {{ approveMessage }}
      </div>
      <div v-if="uninstallMessage" class="text-sm" :class="uninstallMessageIsError ? 'text-destructive' : 'text-emerald-500'">
        {{ uninstallMessage }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { shallowRef, ref, computed, onMounted } from "vue";
import { Button } from "@argon/ui/button";
import { Input } from "@argon/ui/input";
import {
  SearchIcon,
  Loader2 as LoaderIcon,
  DownloadIcon,
  Trash2Icon,
  BadgeCheckIcon,
  ShieldAlertIcon,
  BotIcon,
} from "lucide-vue-next";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import { usePoolStore } from "@/store/data/poolStore";
import type { BotSearchResult, InstalledBotInfo } from "@argon/glue";
import { InstallBotError, UninstallBotError, ApproveBotEntitlementsError } from "@argon/glue";
import { extractEntitlements } from "@/lib/rbac/ArgonEntitlement";

const { t } = useLocale();
const api = useApi();
const pool = usePoolStore();

const spaceId = computed(() => pool.selectedServer);

const activeTab = shallowRef<"search" | "installed">("search");

// Search state
const searchQuery = shallowRef("");
const searchResults = ref<BotSearchResult[]>([]);
const isSearching = shallowRef(false);
const hasSearched = shallowRef(false);
const searchError = shallowRef("");

// Install state
const installingBotId = shallowRef<string | null>(null);
const installMessage = shallowRef("");
const installMessageIsError = shallowRef(false);

// Installed bots state
const installedBots = ref<InstalledBotInfo[]>([]);
const isLoadingInstalled = shallowRef(false);

// Uninstall state
const uninstallingBotId = shallowRef<string | null>(null);
const uninstallMessage = shallowRef("");
const uninstallMessageIsError = shallowRef(false);

// Approve state
const approvingBotId = shallowRef<string | null>(null);
const approveMessage = shallowRef("");
const approveMessageIsError = shallowRef(false);

const installErrorMap: Record<number, string> = {
  [InstallBotError.NOT_FOUND]: "bots_error_not_found",
  [InstallBotError.ALREADY_INSTALLED]: "bots_error_already_installed",
  [InstallBotError.INSUFFICIENT_PERMISSIONS]: "bots_error_insufficient_permissions",
  [InstallBotError.BOT_SPACE_LIMIT]: "bots_error_space_limit",
  [InstallBotError.BOT_RESTRICTED]: "bots_error_restricted",
};

const uninstallErrorMap: Record<number, string> = {
  [UninstallBotError.NOT_FOUND]: "bots_error_not_found",
  [UninstallBotError.NOT_INSTALLED]: "bots_error_not_installed",
  [UninstallBotError.INSUFFICIENT_PERMISSIONS]: "bots_error_insufficient_permissions",
};

const approveErrorMap: Record<number, string> = {
  [ApproveBotEntitlementsError.NOT_FOUND]: "bots_error_not_found",
  [ApproveBotEntitlementsError.NOT_INSTALLED]: "bots_error_not_installed",
  [ApproveBotEntitlementsError.INSUFFICIENT_PERMISSIONS]: "bots_error_insufficient_permissions",
  [ApproveBotEntitlementsError.ALREADY_UP_TO_DATE]: "bots_approve_already_up_to_date",
};

function getMissingEntitlements(bot: InstalledBotInfo): string[] {
  const missing = BigInt(bot.requiredEntitlements) & ~BigInt(bot.grantedEntitlements);
  return extractEntitlements(missing);
}

onMounted(() => loadInstalledBots());

async function doSearch() {
  const query = searchQuery.value.trim();
  if (!query || !spaceId.value) return;

  searchError.value = "";
  installMessage.value = "";
  isSearching.value = true;
  hasSearched.value = true;

  try {
    const results = await api.botManagementInteraction.SearchBots(spaceId.value, query);
    searchResults.value = [...results];
  } catch (e) {
    searchError.value = String(e);
  } finally {
    isSearching.value = false;
  }
}

async function installBot(botAppId: string) {
  if (!spaceId.value) return;
  installingBotId.value = botAppId;
  installMessage.value = "";

  try {
    const result = await api.botManagementInteraction.InstallBot(spaceId.value, botAppId);

    if (result.isSuccessInstallBot()) {
      installMessage.value = t("bots_install_success");
      installMessageIsError.value = false;
      installedBots.value.push(result.bot);
    } else if (result.isFailedInstallBot()) {
      const key = installErrorMap[result.error] ?? "bots_error_unknown";
      installMessage.value = t(key);
      installMessageIsError.value = true;
    }
  } catch (e) {
    installMessage.value = String(e);
    installMessageIsError.value = true;
  } finally {
    installingBotId.value = null;
  }
}

async function loadInstalledBots() {
  if (!spaceId.value) return;
  isLoadingInstalled.value = true;
  try {
    const bots = await api.botManagementInteraction.GetInstalledBots(spaceId.value);
    installedBots.value = [...bots];
  } catch {
    // silently fail, list stays empty
  } finally {
    isLoadingInstalled.value = false;
  }
}

async function uninstallBot(botAppId: string) {
  if (!spaceId.value) return;
  uninstallingBotId.value = botAppId;
  uninstallMessage.value = "";

  try {
    const result = await api.botManagementInteraction.UninstallBot(spaceId.value, botAppId);

    if (result.isSuccessUninstallBot()) {
      uninstallMessage.value = t("bots_uninstall_success");
      uninstallMessageIsError.value = false;
      installedBots.value = installedBots.value.filter((b) => b.appId !== botAppId);
    }
    if (result.isFailedUninstallBot()) {
      const key = uninstallErrorMap[result.error] ?? "bots_error_unknown";
      uninstallMessage.value = t(key);
      uninstallMessageIsError.value = true;
    }
  } catch (e) {
    uninstallMessage.value = String(e);
    uninstallMessageIsError.value = true;
  } finally {
    uninstallingBotId.value = null;
  }
}

async function approveBotEntitlements(botAppId: string) {
  if (!spaceId.value) return;
  approvingBotId.value = botAppId;
  approveMessage.value = "";

  try {
    const result = await api.botManagementInteraction.ApproveBotEntitlements(spaceId.value, botAppId);

    if (result.isSuccessApproval()) {
      approveMessage.value = t("bots_approve_success");
      approveMessageIsError.value = false;
      const bot = installedBots.value.find((b) => b.appId === botAppId);
      if (bot) {
        bot.grantedEntitlements = bot.requiredEntitlements;
        bot.pendingApproval = false;
      }
    }
    if (result.isFailedApproval()) {
      const key = approveErrorMap[result.error] ?? "bots_error_unknown";
      approveMessage.value = t(key);
      approveMessageIsError.value = true;
    }
  } catch (e) {
    approveMessage.value = String(e);
    approveMessageIsError.value = true;
  } finally {
    approvingBotId.value = null;
  }
}
</script>

<style scoped>
.bots-settings {
  max-width: 900px;
  margin: 0 auto;
}

.tab-btn {
  padding: 0.5rem 1rem;
  font-size: 0.875rem;
  font-weight: 500;
  border-radius: 0.5rem 0.5rem 0 0;
  color: hsl(var(--muted-foreground));
  background: transparent;
  border: none;
  border-bottom: 2px solid transparent;
  cursor: pointer;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.tab-btn:hover {
  color: hsl(var(--foreground));
}

.tab-btn--active {
  color: hsl(var(--primary));
  border-bottom-color: hsl(var(--primary));
}

.bot-row {
  display: flex;
  align-items: center;
  gap: 0.75rem;
  padding: 0.75rem;
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border));
  transition: background 0.15s ease;
}

.bot-row:hover {
  background: hsl(var(--accent) / 0.4);
}
</style>
