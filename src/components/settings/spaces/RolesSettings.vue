<template>
  <div class="flex flex-col h-full">
    <!-- Top-level tabs: Roles vs Bot Roles -->
    <Tabs v-model="topTab" class="flex flex-col h-full">
      <div class="flex items-center justify-between px-4 pt-3 pb-2">
        <TabsList class="bg-transparent gap-1">
          <TabsTrigger value="roles" :class="topTab === 'roles' ? 'bg-accent' : ''">
            <ShieldIcon class="w-4 h-4 mr-1.5 shrink-0" />{{ t("roles") }}
            <Badge v-if="regularArchetypes?.length" variant="secondary" class="ml-1.5 text-[10px] px-1.5">
              {{ regularArchetypes.length }}
            </Badge>
          </TabsTrigger>
          <TabsTrigger value="bots" :class="topTab === 'bots' ? 'bg-accent' : ''">
            <BotIcon class="w-4 h-4 mr-1.5 shrink-0" />{{ t("bot_roles") }}
            <Badge v-if="botArchetypes?.length" variant="secondary" class="ml-1.5 text-[10px] px-1.5">
              {{ botArchetypes.length }}
            </Badge>
          </TabsTrigger>
        </TabsList>
      </div>

      <!-- ==================== ROLES TAB ==================== -->
      <TabsContent value="roles" class="flex-1 mt-0">
        <div v-if="!isLoading" class="grid grid-cols-[minmax(280px,1fr)_2fr]">
          <!-- Left: Role list -->
          <div class="border-r border-border flex flex-col max-h-[calc(100vh-220px)]">
            <div class="flex items-center gap-2 p-3 border-b border-border">
              <Input v-model="search" type="text" :placeholder="t('search_users')" class="flex-1 h-8 text-sm" />
              <Button @click="addArchetype" variant="ghost" size="sm" :title="t('add_role')"
                :disabled="!pex.has('ManageArchetype')" class="shrink-0 h-8 w-8 p-0">
                <PlusCircleIcon class="w-4 h-4" />
              </Button>
            </div>
            <ScrollArea class="flex-1">
              <div class="p-2 space-y-1">
                <div v-if="!filteredArchetypes?.length" class="flex flex-col items-center justify-center py-12 text-muted-foreground">
                  <ShieldIcon class="w-8 h-8 mb-2 opacity-40" />
                  <p class="text-sm">{{ t("no_roles") }}</p>
                </div>
                <button v-for="arch in filteredArchetypes" :key="arch.id"
                  @click="switchTo(arch.id)"
                  class="role-list-item w-full text-left rounded-lg px-3 py-2.5 transition-all duration-150"
                  :class="selectedArchetypeId === arch.id
                    ? 'bg-accent/80 shadow-sm'
                    : 'hover:bg-accent/30'"
                >
                  <div class="flex items-center gap-3">
                    <div class="w-1 h-8 rounded-full shrink-0 transition-colors"
                      :style="{ backgroundColor: formatColour(arch.colour) }" />
                    <div class="flex-1 min-w-0">
                      <div class="flex items-center gap-1.5">
                        <span class="font-medium text-sm truncate" :style="{ color: formatColour(arch.colour) }">
                          {{ arch.name }}
                        </span>
                        <Badge v-if="arch.isDefault" variant="outline" class="text-[10px] px-1 py-0">
                          🌐
                        </Badge>
                        <Badge v-else-if="arch.isLocked" variant="outline" class="text-[10px] px-1 py-0">
                          🔒
                        </Badge>
                      </div>
                      <div class="flex items-center gap-2 mt-0.5">
                        <span class="text-xs text-muted-foreground truncate">{{ arch.description || '—' }}</span>
                        <span class="text-[10px] text-muted-foreground/60 shrink-0">
                          {{ getMemberCount(arch.id) }} {{ t("users") }}
                        </span>
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </ScrollArea>
          </div>

          <!-- Right: Role detail -->
          <ScrollArea class="max-h-[calc(100vh-220px)]">
            <div v-if="selectedArchetype" class="p-5 space-y-5">
              <!-- General section -->
              <section>
                <h3 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {{ t("general") }}
                </h3>
                <Card>
                  <CardContent class="p-4 space-y-4">
                    <div class="space-y-1.5">
                      <label class="text-sm font-medium text-white">{{ t("name") }}<span class="text-red-500 ml-1">*</span></label>
                      <Input v-model="selectedArchetype.name" type="text"
                        :class="{ 'opacity-60': isLockedArchetype(selectedArchetype, true) }"
                        :readonly="isLockedArchetype(selectedArchetype, true)" placeholder="Role name..." />
                    </div>
                    <div class="space-y-1.5">
                      <label class="text-sm font-medium text-white">{{ t("description") }}<span class="text-red-500 ml-1">*</span></label>
                      <Textarea v-model="selectedArchetype.description"
                        :class="{ 'opacity-60': isLockedArchetype(selectedArchetype, true) }"
                        placeholder="Type description here." :readonly="isLockedArchetype(selectedArchetype, true)" />
                    </div>

                    <Separator />

                    <ArchetypeColorPicker v-model="selectedArchetype.colour"
                      :readonly="isLockedArchetype(selectedArchetype, true)" />

                    <Separator />

                    <div class="flex items-center justify-between py-1">
                      <div>
                        <label class="text-sm font-medium text-white">{{ t("group_members_with_this_role") }}</label>
                      </div>
                      <Switch :checked="selectedArchetype.isGroup"
                        @update:checked="selectedArchetype.isGroup = !selectedArchetype.isGroup"
                        :disabled="isLockedArchetype(selectedArchetype, true)" />
                    </div>
                    <div class="flex items-center justify-between py-1">
                      <div>
                        <label class="text-sm font-medium text-white" v-html="t('mention_hard.allow_mention_role', {
                          mention: `<span class='text-blue-500'>${t('mention_hard.mention')}</span>`
                        })" />
                      </div>
                      <Switch :checked="selectedArchetype.isMentionable"
                        @update:checked="selectedArchetype.isMentionable = !selectedArchetype.isMentionable"
                        :disabled="selectedArchetype.isLocked" />
                    </div>
                  </CardContent>
                </Card>
              </section>

              <!-- Permissions section -->
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
                          <Switch class="shrink-0" :disabled="selectedArchetype.isLocked"
                            :checked="includesEntitlement(entitlementFlags, flag)"
                            @update:checked="toggleFlag(flag.value, $event)" />
                        </li>
                      </ul>
                    </AccordionContent>
                  </AccordionItem>
                </Accordion>
              </section>

              <!-- Members section -->
              <section>
                <h3 class="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">
                  {{ t("users") }}
                </h3>
                <Card>
                  <CardContent class="p-4 space-y-4">
                    <div class="relative">
                      <Input :disabled="selectedArchetype.isLocked || selectedArchetype.isDefault" ref="reference"
                        v-model="userSearchQuery" type="text" @focusin="open" @focusout="close"
                        :placeholder="t('search_users')" class="w-full h-9" />
                    </div>
                    <div>
                      <div class="flex items-center gap-2 mb-2">
                        <h4 class="text-sm font-medium">{{ t("users_with_this_role") }}</h4>
                        <Badge variant="secondary" class="text-[10px] px-1.5">{{ usersForRole.length }}</Badge>
                      </div>
                      <div v-if="usersForRole.length > 0" class="space-y-1">
                        <div v-for="user in usersForRole" :key="user.userId"
                          class="flex items-center gap-2 p-2 rounded-lg hover:bg-accent/30 transition-colors">
                          <button
                            class="text-red-500 hover:text-red-400 transition-colors disabled:text-muted-foreground disabled:cursor-not-allowed shrink-0"
                            :disabled="selectedArchetype.isLocked || selectedArchetype.isDefault"
                            @click="revokeArchetype(user.userId)">
                            <BanIcon class="w-4 h-4" />
                          </button>
                          <UserInListSideElement :user="user" :enable-popup="false" :show-activity="false" />
                        </div>
                      </div>
                      <div v-else class="text-muted-foreground text-sm py-4 text-center">
                        {{ t("no_users_with_this_role") }}
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </section>

              <!-- Danger Zone -->
              <section v-if="!isLockedArchetype(selectedArchetype) && !selectedArchetype.isDefault">
                <Card class="border-red-500/20">
                  <CardContent class="p-4 space-y-3">
                    <div class="flex items-center gap-2">
                      <AlertTriangleIcon class="w-4 h-4 text-red-400" />
                      <h3 class="font-semibold text-sm text-red-400">{{ t("danger_zone") }}</h3>
                    </div>
                    <p class="text-muted-foreground text-xs">{{ t("delete_role_warning") }}</p>
                    <Button variant="destructive" size="sm" @click="confirmDeleteArchetype" :disabled="deletingArchetype">
                      <Trash2Icon class="w-3.5 h-3.5 mr-1.5" />
                      {{ t("delete_role") }}
                    </Button>
                  </CardContent>
                </Card>
              </section>
            </div>

            <!-- Empty state -->
            <div v-else class="flex flex-col items-center justify-center h-full text-muted-foreground p-8">
              <ShieldIcon class="w-12 h-12 mb-3 opacity-30" />
              <p class="text-sm font-medium">{{ t("select_role") }}</p>
              <p class="text-xs mt-1 opacity-60">{{ t("select_role_hint") }}</p>
            </div>
          </ScrollArea>

          <!-- User search floating dropdown -->
          <div v-if="isOpen && userSearchQuery.trim().length > 0" ref="floating" :style="floatingStyles"
            class="z-50 bg-popover border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto w-[300px]">
            <template v-if="addableSearchResults.length > 0">
              <div v-for="user in addableSearchResults" :key="user.userId"
                class="flex items-center gap-2 p-2 hover:bg-accent/50 cursor-pointer transition-colors"
                @mousedown.prevent="assignArchetype(user.userId)">
                <UserInListSideElement :user="user" :enable-popup="false" :show-activity="false" />
              </div>
            </template>
            <div v-else class="text-muted-foreground text-sm p-3 text-center">
              {{ t("no_users_found") }}
            </div>
          </div>
        </div>

        <!-- Loading state -->
        <div v-else class="p-6 space-y-4">
          <div class="grid grid-cols-[minmax(280px,1fr)_2fr] gap-4">
            <div class="space-y-2">
              <Skeleton class="h-9 w-full rounded-lg" />
              <Skeleton v-for="i in 5" :key="i" class="h-14 w-full rounded-lg" />
            </div>
            <div class="space-y-3">
              <Skeleton class="h-8 w-48 rounded-lg" />
              <Skeleton class="h-40 w-full rounded-lg" />
              <Skeleton class="h-32 w-full rounded-lg" />
            </div>
          </div>
        </div>
      </TabsContent>

      <!-- ==================== BOT ROLES TAB ==================== -->
      <TabsContent value="bots" class="flex-1 overflow-hidden mt-0">
        <BotRolesTab />
      </TabsContent>
    </Tabs>
  </div>
</template>

<script setup lang="ts">
import {
  computed,
  nextTick,
  onMounted,
  onUnmounted,
  ref,
  watch,
  type WatchStopHandle,
} from "vue";
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
  extractEntitlementStrict,
} from "@/lib/rbac/ArgonEntitlement";
import { useLocale } from "@/store/system/localeStore";
import { delay } from "@argon/core";
import ArchetypeColorPicker from "./ArchetypeColorPicker.vue";
import BotRolesTab from "./BotRolesTab.vue";
import { Button } from "@argon/ui/button";
import { PlusCircleIcon, BanIcon, Trash2Icon, ShieldIcon, BotIcon, AlertTriangleIcon } from "lucide-vue-next";
import { Input } from "@argon/ui/input";
import { watchDebounced } from "@vueuse/core";
import { useApi } from "@/store/system/apiStore";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { Textarea } from "@argon/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@argon/ui/tabs";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@argon/ui/accordion";
import { Badge } from "@argon/ui/badge";
import { Separator } from "@argon/ui/separator";
import { Skeleton } from "@argon/ui/skeleton";
import type { RealtimeUser } from "@/store/db/dexie";
import type { Subscription } from "dexie";
import { usePexStore } from "@/store/data/permissionStore";
import UserInListSideElement from "@/components/UserInListSideElement.vue";
import { useFloating, offset, autoUpdate } from '@floating-ui/vue'
import { Archetype, ArchetypeGroup, ArgonEntitlement } from "@argon/glue";
import { Guid } from "@argon-chat/ion.webcore";

const topTab = ref<"roles" | "bots">("roles");


const isOpen = ref(false)

const reference = ref<HTMLElement | null>(null)
const floating = ref<HTMLElement | null>(null)

const { floatingStyles, update } = useFloating(reference, floating, {
  middleware: [offset(4)],
  whileElementsMounted: autoUpdate,
})

function open() {
  isOpen.value = true
  update()
}

function close() {
  setTimeout(() => {
    isOpen.value = false
  }, 150)
}


const pool = usePoolStore();
const pex = usePexStore();
const selectedServer = computed(() => pool.selectedServer);
const { t } = useLocale();
const isLoading = ref(true);
const api = useApi();
const toast = useToast();
const debouncerHandle = ref(null as WatchStopHandle | null);
const archetypesGroup = ref(null as ArchetypeGroup[] | null);
const search = ref("");
const userSearchQuery = ref("");
const searchResults = ref<RealtimeUser[]>([]);

const addableSearchResults = computed(() => {
  const existingIds = new Set(usersForRole.value.map((u) => u.userId));
  return searchResults.value.filter((u) => !existingIds.has(u.userId));
});

watchDebounced(
  userSearchQuery,
  async (query) => {
    if (!query.trim()) {
      searchResults.value = [];
      return;
    }

    try {
      searchResults.value = await pool.searchUser(query.trim());
    } catch (e) {
      console.warn("User search failed", e);
      searchResults.value = [];
    }
  },
  { debounce: 300, immediate: false },
);

const archetypes = useLiveQuery(() => {
  const serverId = selectedServer.value;
  if (!serverId) return [];
  return pool.db.archetypes.where("spaceId").equals(serverId).toArray();
});

const isBotArchetype = (arch: Archetype) => arch.isHidden && arch.isLocked;

const regularArchetypes = computed(() =>
  archetypes.value?.filter((a) => !isBotArchetype(a) && a.name !== "owner"),
);

const botArchetypes = computed(() =>
  archetypes.value?.filter((a) => isBotArchetype(a)),
);

const getMemberCount = (archetypeId: Guid): number => {
  if (!archetypesGroup.value) return 0;
  const group = archetypesGroup.value.find((x) => x.archetype.id === archetypeId);
  return group?.members?.length ?? 0;
};

const countEnabledFlags = (group: ArgonEntitlementGroup): number => {
  if (!selectedArchetype.value) return 0;
  return group.flags.filter((flag) => includesEntitlement(entitlementFlags.value, flag)).length;
};

const selectedArchetypeId = ref<string | null>(null);

const selectedArchetype = computed(() => {
  return archetypes.value?.find((a) => a.id === selectedArchetypeId.value);
});

const revokeArchetype = async (userId: Guid) => {
  await grantOrRevoke(userId, false);
};
const assignArchetype = async (userId: Guid) => {
  await grantOrRevoke(userId, true);
};

const grantOrRevoke = async (userId: Guid, isGrain: boolean) => {
  logger.warn("called assign to archetype for user", userId);
  if (!selectedArchetype.value) return;
  const userIds = await pool.getMemberIdsByUserIds(selectedArchetype.value.spaceId, [userId]);

  if (!userIds || userIds.length == 0) return;

  api.archetypeInteraction.SetArchetypeToMember(selectedArchetype.value.spaceId, userIds.at(0)!, selectedArchetype.value.id, isGrain);
}

const usersForRole = ref<RealtimeUser[]>([]);
let unsubscribeUsers: Subscription | null = null;

const entitlementFlags = computed(() => {
  if (!selectedArchetype.value) return [];
  return extractEntitlements(BigInt(selectedArchetype.value.entitlement));
});
const includesEntitlement = (
  val: ArgonEntitlementFlag[],
  flag: ArgonEntitlementFlagDefinition,
) => {
  return extractEntitlements(flag.value).some((q) => val.includes(q));
};

onMounted(async () => {
  while (!selectedServer.value) {
    await delay(500);
  }
  archetypesGroup.value = await pool.getDetailedArchetypesAndRefreshDb(
    selectedServer.value,
  );

  isLoading.value = false;

  setTimeout(() => {
    startTrackingDebouncer();
  }, 200);
});

watch(
  () => selectedArchetype.value?.id,
  (newId) => {
    if (unsubscribeUsers) {
      unsubscribeUsers.unsubscribe();
      unsubscribeUsers = null;
    }

    if (!newId) {
      usersForRole.value = [];
      return;
    }

    const obs = getUsersForArchetypeGroup(newId);
    if (Array.isArray(obs)) {
      usersForRole.value = obs;
    } else {
      unsubscribeUsers = obs.subscribe((val) => {
        usersForRole.value = val;
      });
    }
  },
  { immediate: true },
);

onUnmounted(() => {
  if (unsubscribeUsers) {
    unsubscribeUsers.unsubscribe();
    unsubscribeUsers = null;
  }
});

const getUsersForArchetypeGroup = (archetypeId: Guid) => {
  if (!archetypesGroup.value) return [];
  const members = archetypesGroup.value.find(
    (x) => x.archetype.id === archetypeId,
  )?.members;

  if (!members) return [];

  return pool.getUsersByServerMemberIds(
    selectedServer.value ?? "",
    members,
  );
};

const isLockedArchetype = (arch: Archetype, includeEveryone = false) => {
  if (arch.isLocked) return true;
  if (arch.isHidden) return true;
  if (arch.name === "owner") return true;
  if (includeEveryone && arch.name === "everyone") return true;
  return false;
};

const stopTrackingDebouncer = () => {
  if (debouncerHandle.value) debouncerHandle.value();
  debouncerHandle.value = null;
};

const startTrackingDebouncer = () => {
  debouncerHandle.value = watchDebounced(
    () => [
      selectedArchetype.value?.name,
      selectedArchetype.value?.description,
      selectedArchetype.value?.colour,
      selectedArchetype.value?.entitlement,
      selectedArchetype.value?.isGroup,
      selectedArchetype.value?.isMentionable,
    ],
    async () => await updateArchetypeLocal(),
    { debounce: 1300, immediate: false },
  );
};

const switchTo = (id: Guid) => {
  stopTrackingDebouncer();
  selectedArchetypeId.value = id;
  startTrackingDebouncer();
};

const filteredArchetypes = computed(() => {
  if (!search.value.trim()) return regularArchetypes.value;
  const q = search.value.toLowerCase();
  return regularArchetypes.value?.filter(
    (a) =>
      a.name.toLowerCase().includes(q) ||
      a.description.toLowerCase().includes(q),
  );
});

async function addArchetype() {
  if (!selectedServer.value) return;
  if (!pex.has('ManageArchetype')) return;
  await api.archetypeInteraction.CreateArchetype(
    selectedServer.value,
    "New Archetype",
  );
}

const deletingArchetype = ref(false);

async function confirmDeleteArchetype() {
  if (!selectedArchetype.value || !selectedServer.value) return;
  if (isLockedArchetype(selectedArchetype.value)) return;
  if (selectedArchetype.value.isDefault) return;

  const name = selectedArchetype.value.name;
  if (!window.confirm(`Are you sure you want to delete the role "${name}"? This will remove it from all members.`)) return;

  deletingArchetype.value = true;
  try {
    // TODO: call DeleteArchetype API when backend supports it
    toast.toast({
      title: t("fail_save"),
      variant: "destructive",
    });
  } finally {
    deletingArchetype.value = false;
  }
}

function updateArchetypeLocal() {
  logger.info("called update archetype", selectedArchetype.value);
  if (!selectedArchetype.value) return;
  if (isLockedArchetype(selectedArchetype.value)) return;
  try {
    const result = api.archetypeInteraction.UpdateArchetype(
      selectedArchetype.value.spaceId,
      selectedArchetype.value,
    );
    toast.toast({
      title: t("saved"),
      duration: 1000,
    });
    // TODO
  } catch (e) {
    toast.toast({
      title: t("fail_save"),
      variant: "destructive",
    });
  }
}

function toggleFlag(flag: bigint, checked: boolean) {
  if (!selectedArchetype.value) return;
  logger.info("toggle rule", flag, checked, extractEntitlements(flag));
  const idx = entitlementFlags.value.findIndex(
    (f) => f === extractEntitlementStrict(flag),
  );
  if (checked && idx === -1) {
    selectedArchetype.value.entitlement = (BigInt(selectedArchetype.value.entitlement) | flag) as any;
  } else if (!checked && idx !== -1) {
    selectedArchetype.value.entitlement = (
      BigInt(selectedArchetype.value.entitlement) & ~flag
    ) as any;
  }
  logger.info(
    "updated",
    extractEntitlements(BigInt(selectedArchetype.value.entitlement)),
  );
}
const formatColour = (argb: number) => {
  const a = ((argb >> 24) & 0xff) / 255;
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
};
</script>

<style scoped>
.role-list-item {
  border: 1px solid transparent;
}
.role-list-item:hover {
  border-color: hsl(var(--border));
}
</style>
