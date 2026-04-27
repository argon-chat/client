<template>
  <div v-if="!isLoading" class="grid grid-cols-[minmax(280px,1fr)_2fr]">
    <!-- Left: Bot role list -->
    <div class="border-r border-border flex flex-col max-h-[calc(100vh-220px)]">
      <div class="flex items-center gap-2 p-3 border-b border-border">
        <Input v-model="search" type="text" :placeholder="t('search_users')" class="flex-1 h-8 text-sm" />
      </div>
      <ScrollArea class="flex-1">
        <div class="p-2 space-y-1">
          <div v-if="!filteredBotArchetypes?.length" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
            <BotIcon class="w-8 h-8 mb-2 opacity-40" />
            <p class="text-sm">{{ t("no_bot_roles") }}</p>
            <p class="text-xs mt-1 opacity-60">{{ t("no_bot_roles_hint") }}</p>
          </div>
          <button v-for="arch in filteredBotArchetypes" :key="arch.id"
            @click="selectedBotId = arch.id"
            class="bot-list-item w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150"
            :class="selectedBotId === arch.id
              ? 'bg-accent/80 shadow-sm'
              : 'hover:bg-accent/30'"
          >
            <div class="flex items-center gap-3">
              <div class="w-8 h-8 rounded-lg bg-accent/50 flex items-center justify-center shrink-0">
                <BotIcon class="w-4 h-4 text-muted-foreground" />
              </div>
              <div class="flex-1 min-w-0">
                <div class="flex items-center gap-1.5">
                  <span class="font-medium text-sm truncate" :style="{ color: formatColour(arch.colour) }">
                    {{ arch.name }}
                  </span>
                  <Badge variant="secondary" class="text-[10px] px-1.5 shrink-0">Bot</Badge>
                </div>
                <div class="flex items-center gap-2 mt-0.5">
                  <span class="text-xs text-muted-foreground truncate">{{ getBotUsername(arch) || arch.description || '—' }}</span>
                </div>
              </div>
              <LockIcon class="w-3.5 h-3.5 text-muted-foreground/50 shrink-0" />
            </div>
          </button>
        </div>
      </ScrollArea>
    </div>

    <!-- Right: Bot role detail (read-only) -->
    <ScrollArea class="max-h-[calc(100vh-220px)]">
      <div v-if="selectedBot" class="p-5 space-y-5">
        <!-- Bot info header -->
        <section>
          <Card class="overflow-hidden">
            <div class="h-1.5" :style="{ backgroundColor: formatColour(selectedBot.colour) }" />
            <CardContent class="p-4">
              <div class="flex items-center gap-4">
                <div class="w-12 h-12 rounded-xl bg-accent/50 flex items-center justify-center shrink-0">
                  <BotIcon class="w-6 h-6 text-muted-foreground" />
                </div>
                <div class="flex-1 min-w-0">
                  <div class="flex items-center gap-2">
                    <h2 class="text-lg font-semibold truncate" :style="{ color: formatColour(selectedBot.colour) }">
                      {{ selectedBot.name }}
                    </h2>
                    <Badge variant="outline" class="text-[10px] px-1.5">
                      <LockIcon class="w-3 h-3 mr-0.5" /> {{ t("locked") }}
                    </Badge>
                    <Badge v-if="matchedBotInfo?.isVerified" variant="secondary" class="text-[10px] px-1.5">
                      <CheckCircleIcon class="w-3 h-3 mr-0.5" /> {{ t("verified") }}
                    </Badge>
                  </div>
                  <p class="text-sm text-muted-foreground mt-0.5">{{ selectedBot.description || '—' }}</p>
                  <p v-if="matchedBotInfo" class="text-xs text-muted-foreground/60 mt-1">
                    @{{ matchedBotInfo.username }}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        <!-- Bot entitlements info -->
        <section v-if="matchedBotInfo">
          <div class="flex items-center gap-2 mb-3">
            <h3 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
              {{ t("bot_entitlements") }}
            </h3>
          </div>
          <Card>
            <CardContent class="p-4 space-y-3">
              <div class="flex items-center justify-between">
                <span class="text-sm">{{ t("granted_entitlements") }}</span>
                <Badge :variant="matchedBotInfo.pendingApproval ? 'destructive' : 'secondary'" class="text-[10px]">
                  {{ matchedBotInfo.pendingApproval ? t("pending_approval") : t("approved") }}
                </Badge>
              </div>
            </CardContent>
          </Card>
        </section>

        <!-- Permissions (read-only) -->
        <section>
          <h3 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
            {{ t("permissions_name") }}
          </h3>
          <Accordion type="multiple" class="space-y-2" :default-value="ArgonEntitlementGroups.map(g => g.i18nKey)">
            <AccordionItem v-for="group in ArgonEntitlementGroups" :key="group.i18nKey" :value="group.i18nKey"
              class="border rounded-lg overflow-hidden bg-card">
              <AccordionTrigger class="px-4 py-3 hover:no-underline hover:bg-accent/30">
                <div class="flex items-center gap-2">
                  <span class="font-medium text-sm">{{ t(group.i18nKey + '.name') }}</span>
                  <Badge variant="secondary" class="text-[10px] px-1.5">
                    {{ countEnabledFlags(group) }}/{{ group.flags.length }}
                  </Badge>
                </div>
              </AccordionTrigger>
              <AccordionContent class="px-4 pb-3">
                <p class="text-xs text-muted-foreground mb-3">{{ t(group.i18nKey + '.description') }}</p>
                <ul class="space-y-3">
                  <li v-for="flag in group.flags" :key="flag.value.toString()"
                    class="flex items-center justify-between gap-4">
                    <div class="min-w-0">
                      <div class="text-sm font-medium">{{ t(flag.i18nKey + '.name') }}</div>
                      <div class="text-xs text-muted-foreground">{{ t(flag.i18nKey + '.description') }}</div>
                    </div>
                    <Switch class="shrink-0" disabled
                      :checked="botIncludesEntitlement(flag)" />
                  </li>
                </ul>
              </AccordionContent>
            </AccordionItem>
          </Accordion>
        </section>
      </div>

      <!-- Empty state -->
      <div v-else class="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
        <BotIcon class="w-12 h-12 mb-3 opacity-30" />
        <p class="text-sm font-medium">{{ t("select_bot_role") }}</p>
        <p class="text-xs mt-1 opacity-60">{{ t("select_bot_role_hint") }}</p>
      </div>
    </ScrollArea>
  </div>

  <!-- Loading state -->
  <div v-else class="p-6 space-y-4">
    <div class="grid grid-cols-[minmax(280px,1fr)_2fr] gap-4">
      <div class="space-y-2">
        <Skeleton class="h-9 w-full rounded-lg" />
        <Skeleton v-for="i in 3" :key="i" class="h-14 w-full rounded-lg" />
      </div>
      <div class="space-y-3">
        <Skeleton class="h-20 w-full rounded-lg" />
        <Skeleton class="h-32 w-full rounded-lg" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { Card, CardContent } from "@argon/ui/card";
import { ScrollArea } from "@argon/ui/scroll-area";
import { Switch } from "@argon/ui/switch";
import { usePoolStore } from "@/store/data/poolStore";
import { useLiveQuery } from "@/composables/useLiveQuery";
import {
  extractEntitlements,
  ArgonEntitlementGroups,
  type ArgonEntitlementFlag,
  type ArgonEntitlementFlagDefinition,
  type ArgonEntitlementGroup,
} from "@/lib/rbac/ArgonEntitlement";
import { useLocale } from "@/store/system/localeStore";
import { delay } from "@argon/core";
import { BotIcon, LockIcon, CheckCircleIcon } from "lucide-vue-next";
import { Input } from "@argon/ui/input";
import { useApi } from "@/store/system/apiStore";
import { Badge } from "@argon/ui/badge";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@argon/ui/accordion";
import { Skeleton } from "@argon/ui/skeleton";
import { Archetype, type InstalledBotInfo } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";

const pool = usePoolStore();
const api = useApi();
const { t } = useLocale();
const selectedServer = computed(() => pool.selectedServer);
const isLoading = ref(true);
const search = ref("");
const selectedBotId = ref<string | null>(null);
const installedBots = ref<InstalledBotInfo[]>([]);

const archetypes = useLiveQuery(() => {
  const serverId = selectedServer.value;
  if (!serverId) return [];
  return pool.db.archetypes.where("spaceId").equals(serverId).toArray();
});

const botArchetypes = computed(() =>
  archetypes.value?.filter((a) => a.isHidden && a.isLocked),
);

const filteredBotArchetypes = computed(() => {
  if (!search.value.trim()) return botArchetypes.value;
  const q = search.value.toLowerCase();
  return botArchetypes.value?.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q),
  );
});

const selectedBot = computed(() =>
  botArchetypes.value?.find((a) => a.id === selectedBotId.value),
);

const matchedBotInfo = computed(() => {
  if (!selectedBot.value || !installedBots.value.length) return null;
  const name = selectedBot.value.name.toLowerCase();
  return installedBots.value.find(
    (b) => b.name.toLowerCase() === name || b.username.toLowerCase() === name,
  ) ?? null;
});

const getBotUsername = (arch: Archetype): string | null => {
  const bot = installedBots.value.find(
    (b) => b.name.toLowerCase() === arch.name.toLowerCase() || b.username.toLowerCase() === arch.name.toLowerCase(),
  );
  return bot ? `@${bot.username}` : null;
};

const botEntitlementFlags = computed(() => {
  if (!selectedBot.value) return [];
  return extractEntitlements(BigInt(selectedBot.value.entitlement));
});

const botIncludesEntitlement = (flag: ArgonEntitlementFlagDefinition) => {
  return extractEntitlements(flag.value).some((q) => botEntitlementFlags.value.includes(q));
};

const countEnabledFlags = (group: ArgonEntitlementGroup): number => {
  return group.flags.filter((flag) => botIncludesEntitlement(flag)).length;
};

const formatColour = (argb: number) => {
  const a = ((argb >> 24) & 0xff) / 255;
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
};

onMounted(async () => {
  while (!selectedServer.value) {
    await delay(500);
  }
  try {
    const bots = await api.botManagementInteraction.GetInstalledBots(selectedServer.value);
    installedBots.value = [...bots];
  } catch {
    installedBots.value = [];
  }
  isLoading.value = false;
});
</script>

<style scoped>
.bot-list-item {
  border: 1px solid transparent;
}
.bot-list-item:hover {
  border-color: hsl(var(--border));
}
</style>
