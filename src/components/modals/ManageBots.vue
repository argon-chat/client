<template>
  <Dialog v-model:open="open">
    <template #default="{ close }">
      <DialogContent
        class="sm:max-w-[640px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-8 space-y-6 max-h-[80vh] flex flex-col"
      >
        <div
          class="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-primary/5 pointer-events-none rounded-2xl"
        ></div>

        <div class="relative text-center space-y-2">
          <h2 class="text-3xl font-extrabold text-foreground tracking-wide">
            {{ t("bots_manage") }}
          </h2>
          <p class="text-muted-foreground text-sm">
            {{ t("bots_manage_description") }}
          </p>
        </div>

        <!-- Tabs -->
        <div class="relative flex gap-2 border-b border-border pb-1">
          <button
            @click="activeTab = 'search'"
            class="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
            :class="activeTab === 'search'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'"
          >
            {{ t("bots_search") }}
          </button>
          <button
            @click="activeTab = 'installed'"
            class="px-4 py-2 text-sm font-medium rounded-t-lg transition-colors"
            :class="activeTab === 'installed'
              ? 'text-primary border-b-2 border-primary'
              : 'text-muted-foreground hover:text-foreground'"
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
        <div v-if="activeTab === 'search'" class="relative space-y-4 flex-1 overflow-hidden flex flex-col">
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

          <div v-if="searchError" class="text-sm text-destructive">
            {{ searchError }}
          </div>

          <div class="flex-1 overflow-y-auto space-y-2 pr-1">
            <div v-if="searchResults.length === 0 && hasSearched && !isSearching"
              class="text-center text-muted-foreground py-8 text-sm">
              {{ t("bots_no_results") }}
            </div>

            <div
              v-for="bot in searchResults"
              :key="bot.appId"
              class="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-accent/50 transition-colors"
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
              <Button
                size="sm"
                @click="installBot(bot.appId)"
                :disabled="installingBotId === bot.appId"
              >
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
        <div v-if="activeTab === 'installed'" class="relative space-y-4 flex-1 overflow-hidden flex flex-col">
          <div v-if="isLoadingInstalled" class="flex justify-center py-8">
            <LoaderIcon class="w-6 h-6 animate-spin text-muted-foreground" />
          </div>

          <div v-else-if="installedBots.length === 0"
            class="text-center text-muted-foreground py-8 text-sm">
            {{ t("bots_none_installed") }}
          </div>

          <div v-else class="flex-1 overflow-y-auto space-y-2 pr-1">
            <div
              v-for="bot in installedBots"
              :key="bot.appId"
              class="flex items-center gap-3 p-3 rounded-xl border border-border hover:bg-accent/50 transition-colors"
            >
              <ArgonAvatar :file-id="bot.avatarFileId" :fallback="bot.name?.[0] ?? '?'" :overrided-size="40" />
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="font-semibold text-foreground truncate">{{ bot.name }}</span>
                  <BadgeCheckIcon v-if="bot.isVerified" class="w-4 h-4 text-primary shrink-0" />
                </div>
                <div class="text-sm text-muted-foreground truncate">@{{ bot.username }}</div>
              </div>
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

          <div v-if="uninstallMessage" class="text-sm" :class="uninstallMessageIsError ? 'text-destructive' : 'text-emerald-500'">
            {{ uninstallMessage }}
          </div>
        </div>

        <DialogFooter class="relative flex justify-center pt-2">
          <Button variant="ghost" @click="close()">
            {{ t("close") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </template>
  </Dialog>
</template>

<script setup lang="ts">
import { shallowRef, ref, watch } from "vue";
import { Dialog, DialogContent, DialogFooter } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { Input } from "@argon/ui/input";
import {
  SearchIcon,
  Loader2 as LoaderIcon,
  DownloadIcon,
  Trash2Icon,
  BadgeCheckIcon,
} from "lucide-vue-next";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import { useLocale } from "@/store/system/localeStore";
import { useApi } from "@/store/system/apiStore";
import type { BotSearchResult, InstalledBotInfo } from "@argon/glue";
import { InstallBotError, UninstallBotError } from "@argon/glue";

const { t } = useLocale();
const api = useApi();

const open = defineModel<boolean>("open", { type: Boolean, default: false });
const selectedSpaceId = defineModel<string>("selectedSpace", {
  type: String,
  required: true,
});

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

// Reset state when modal opens
watch(open, (isOpen) => {
  if (isOpen) {
    activeTab.value = "search";
    searchQuery.value = "";
    searchResults.value = [];
    hasSearched.value = false;
    searchError.value = "";
    installMessage.value = "";
    uninstallMessage.value = "";
    loadInstalledBots();
  }
});

// Load installed bots when switching to installed tab
watch(activeTab, (tab) => {
  if (tab === "installed") {
    loadInstalledBots();
  }
});

async function doSearch() {
  const query = searchQuery.value.trim();
  if (!query) return;

  searchError.value = "";
  installMessage.value = "";
  isSearching.value = true;
  hasSearched.value = true;

  try {
    const results = await api.botManagementInteraction.SearchBots(
      selectedSpaceId.value!,
      query
    );
    searchResults.value = [...results];
  } catch (e) {
    searchError.value = String(e);
  } finally {
    isSearching.value = false;
  }
}

async function installBot(botAppId: string) {
  installingBotId.value = botAppId;
  installMessage.value = "";

  try {
    const result = await api.botManagementInteraction.InstallBot(
      selectedSpaceId.value!,
      botAppId
    );

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
  isLoadingInstalled.value = true;
  try {
    const bots = await api.botManagementInteraction.GetInstalledBots(
      selectedSpaceId.value!
    );
    installedBots.value = [...bots];
  } catch {
    // silently fail, list stays empty
  } finally {
    isLoadingInstalled.value = false;
  }
}

async function uninstallBot(botAppId: string) {
  uninstallingBotId.value = botAppId;
  uninstallMessage.value = "";

  try {
    const result = await api.botManagementInteraction.UninstallBot(
      selectedSpaceId.value!,
      botAppId
    );

    if (result.isSuccessUninstallBot()) {
      uninstallMessage.value = t("bots_uninstall_success");
      uninstallMessageIsError.value = false;
      installedBots.value = installedBots.value.filter((b) => b.appId !== botAppId);
    } if (result.isFailedUninstallBot()) {
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
</script>
