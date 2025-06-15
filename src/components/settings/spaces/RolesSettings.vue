<template>
  <div>
    <div class="flex items-center justify-between p-4 gap-2">
      <Button @click="addArchetype" variant="ghost" title="Add Role">
        <PlusCircleIcon />
      </Button>
      <Input v-model="search" type="text" placeholder="Search roles..." />

    </div>
    <div v-if="!isLoading">
      <div class="grid grid-cols-2 gap-4">
        <ScrollArea class="p-2 max-h-[calc(100vh-270px)]">
          <div class="space-y-2 p-4">
            <Card v-for="arch in filteredArchetypes" :key="arch.Id" @click="() => switchTo(arch.Id)"
              :class="selectedArchetypeId === arch.Id ? 'border-2 border-r-indigo-500' : ''" class="cursor-pointer">
              <CardContent class="flex gap-4 items-center p-4">
                <div class="flex items-center gap-2">
                  <div class="w-3 h-3 rounded-full shrink-0" :style="{ backgroundColor: formatColour(arch.Colour) }" />
                  <div class="flex-1 min-w-0 flex items-center gap-1 truncate">
                    <span class="font-semibold text-base truncate" :style="{ color: formatColour(arch.Colour) }">{{
                      arch.Name }}</span>
                    <span v-if="arch.IsLocked" class="text-muted">🔒</span>
                    <span class="text-muted text-sm truncate">— {{ arch.Description }}</span>
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>
        </ScrollArea>
        <ScrollArea class="p-2 max-h-[calc(100vh-270px)]">
          <div class="space-y-4" v-if="selectedArchetype">
            <Tabs v-model="activeTab" default-value="permissions" class="space-y-2">
              <TabsList class="w-full justify-center space-x-2 mb-2" style="background-color: unset !important;">
                <TabsTrigger :style="{ backgroundColor: activeTab == 'permissions' ? 'rgb(30 30 30)' : '' }"
                  class="w-[100%]" value="permissions">Permissions</TabsTrigger>
                <TabsTrigger :style="{ backgroundColor: activeTab == 'users' ? 'rgb(30 30 30)' : '' }" class="w-[100%]"
                  value="users">{{ t("users") }}</TabsTrigger>
              </TabsList>

              <TabsContent value="permissions" class="space-y-4">
                <Card>
                  <CardContent class="p-4 space-y-2">
                    <div class="space-y-1">
                      <label class="text-sm font-medium text-white">Name<span class="text-red-500 ml-1">*</span></label>
                      <Input v-model="selectedArchetype.Name" type="text"
                        :class="{ 'text-muted': isLockedArchetype(selectedArchetype, true) }"
                        :readonly="isLockedArchetype(selectedArchetype, true)" placeholder="Role name..." />
                    </div>
                    <div class="space-y-1">
                      <label class="text-sm font-medium text-white">Description<span
                          class="text-red-500 ml-1">*</span></label>
                      <Textarea v-model="selectedArchetype.Description"
                        :class="{ 'text-muted': isLockedArchetype(selectedArchetype, true) }"
                        placeholder="Type description here." :readonly="isLockedArchetype(selectedArchetype, true)" />
                    </div>

                    <ArchetypeColorPicker v-model="selectedArchetype.Colour"
                      :readonly="isLockedArchetype(selectedArchetype, true)" />
                    <br />
                    <div class="space-y-1 flex items-center justify-between">
                      <label class="text-sm font-medium text-white">Group members with this
                        role?</label>
                      <Switch :checked="selectedArchetype.IsGroup"
                        @update:checked="selectedArchetype.IsGroup = !selectedArchetype.IsGroup"
                        :disabled="isLockedArchetype(selectedArchetype, true)" />
                    </div>
                    <div class="space-y-1 flex items-center justify-between">
                      <label class="text-sm font-medium text-white">Allow <span class="text-blue-500">@mention</span>
                        allow this role to everyone
                        else?</label>
                      <Switch :checked="selectedArchetype.IsMentionable"
                        @update:checked="selectedArchetype.IsMentionable = !selectedArchetype.IsMentionable"
                        :disabled="selectedArchetype.IsLocked" />
                    </div>
                  </CardContent>
                </Card>

                <Card v-for="group in ArgonEntitlementGroups" :key="group.i18nKey">
                  <CardContent class="p-4 space-y-2">
                    <div class="font-semibold text-base">
                      {{ t(group.i18nKey + '.name') }}
                    </div>
                    <div class="text-muted text-sm">
                      {{ t(group.i18nKey + '.description') }}
                    </div>
                    <ul class="space-y-2 mt-2">
                      <li v-for="flag in group.flags" :key="flag.value.toString()"
                        class="flex items-center justify-between text-sm">
                        <div>
                          <div class="font-medium">{{ t(flag.i18nKey + '.name') }}</div>
                          <div class="text-muted text-xs">
                            {{ t(flag.i18nKey + '.description') }}
                          </div>
                        </div>
                        <Switch :disabled="selectedArchetype.IsLocked"
                          :checked="includesEntitlement(entitlementFlags, flag)"
                          @update:checked="toggleFlag(flag.value, $event)" />
                      </li>
                    </ul>
                  </CardContent>
                </Card>
              </TabsContent>

              <TabsContent value="users" class="space-y-2">
                <Card>
                  <CardContent class="p-4 space-y-4">
                    <div class="relative">
                      <Input ref="reference" v-model="userSearchQuery" type="text" @focusin="open" @focusout="close"
                        placeholder="Search users..." class="w-full" />

                    </div>
                    <div>
                      <h3 class="text-sm font-semibold">Users with this role</h3>
                      <div v-if="usersForRole.length > 0" class="space-y-2 mt-2">
                        <div v-for="user in usersForRole" :key="user.UserId"
                          class="flex items-center gap-2 p-2 rounded">
                          <UserInListSideElement :user="user" :enable-popup="false" :show-activity="false"
                            :pick-action="true" @pick-action="() => revokeArchetype(user.UserId)" />
                        </div>
                      </div>
                      <div v-else class="text-muted text-sm mt-2">
                        No users with this role
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </TabsContent>
            </Tabs>

          </div>
        </ScrollArea>
        <div v-if="isOpen && userSearchQuery.trim().length > 0" ref="floating" :style="floatingStyles"
          class="z-50 bg-popover border border-border rounded shadow-lg max-h-60 overflow-y-auto w-[300px]">
          <template v-if="addableSearchResults.length > 0">
            <div v-for="user in addableSearchResults" :key="user.UserId"
              class="flex items-center gap-2 p-2 hover:bg-muted cursor-pointer"
              @mousedown.prevent="assignArchetype(user.UserId)">
              <UserInListSideElement :user="user" :enable-popup="false" :show-activity="false" :pick-action="true" />
            </div>
          </template>
          <div v-else class="text-muted text-sm p-2">
            No users found
          </div>
        </div>
      </div>
    </div>
    <div v-else>
      Loading...
    </div>
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
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Switch } from "@/components/ui/switch";
import { usePoolStore } from "@/store/poolStore";
import { useLiveQuery } from "@/lib/useLiveQuery";
import {
  extractEntitlements,
  ArgonEntitlementGroups,
  type ArgonEntitlementFlag,
  type ArgonEntitlementFlagDefinition,
  extractEntitlementStrict,
} from "@/lib/rbac/ArgonEntitlement";
import { useLocale } from "@/store/localeStore";
import delay from "@/lib/delay";
import ArchetypeColorPicker from "./ArchetypeColorPicker.vue";
import Button from "@/components/ui/button/Button.vue";
import { PlusCircleIcon } from "lucide-vue-next";
import Input from "@/components/ui/input/Input.vue";
import { watchDebounced } from "@vueuse/core";
import { useApi } from "@/store/apiStore";
import { useToast } from "@/components/ui/toast";
import { logger } from "@/lib/logger";
import Textarea from "@/components/ui/textarea/Textarea.vue";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import type { RealtimeUser } from "@/store/db/dexie";
import type { Subscription } from "dexie";
import UserInListSideElement from "@/components/UserInListSideElement.vue";
import { useFloating, offset, autoUpdate } from '@floating-ui/vue'


const isOpen = ref(false)

const reference = ref<HTMLElement | null>(null)
const floating = ref<HTMLElement | null>(null)

const { floatingStyles, update } = useFloating(reference, floating, {
  middleware: [offset(4)],
  whileElementsMounted: autoUpdate,
})

function open() {
  isOpen.value = true
  update() // пересчитать позицию
}

function close() {
  setTimeout(() => {
    isOpen.value = false
  }, 150)
}


const pool = usePoolStore();
const selectedServer = computed(() => pool.selectedServer);
const { t } = useLocale();
const isLoading = ref(true);
const api = useApi();
const toast = useToast();
const debouncerHandle = ref(null as WatchStopHandle | null);
const archetypesGroup = ref(null as IArchetypeDtoGroup[] | null);
const activeTab = ref<"permissions" | "users">("permissions");
const search = ref("");
const userSearchQuery = ref("");
const searchResults = ref<RealtimeUser[]>([]);

const addableSearchResults = computed(() => {
  const existingIds = new Set(usersForRole.value.map((u) => u.UserId));
  return searchResults.value.filter((u) => !existingIds.has(u.UserId));
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
  return pool.db.archetypes.where("ServerId").equals(serverId).toArray();
});

const selectedArchetypeId = ref<string | null>(null);

const selectedArchetype = computed(() => {
  return archetypes.value?.find((a) => a.Id === selectedArchetypeId.value);
});

const revokeArchetype = (userId: Guid) => { };
const assignArchetype = (userId: Guid) => { };

const usersForRole = ref<RealtimeUser[]>([]);
let unsubscribeUsers: Subscription | null = null;

const entitlementFlags = computed(() => {
  if (!selectedArchetype.value) return [];
  return extractEntitlements(BigInt(selectedArchetype.value.Entitlement));
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
  () => selectedArchetype.value?.Id,
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
    (x) => x.Archetype.Id === archetypeId,
  )?.Members;

  if (!members) return [];

  return pool.getUsersByServerMemberIds(
    selectedServer.value ?? "",
    members,
  );
};

const isLockedArchetype = (arch: IArchetypeDto, includeEveryone = false) => {
  if (arch.IsLocked) return true;
  if (arch.IsHidden) return true;
  if (arch.Name === "owner") return true;
  if (includeEveryone && arch.Name === "everyone") return true;
  return false;
};

const stopTrackingDebouncer = () => {
  if (debouncerHandle.value) debouncerHandle.value();
  debouncerHandle.value = null;
};

const startTrackingDebouncer = () => {
  debouncerHandle.value = watchDebounced(
    () => [
      selectedArchetype.value?.Name,
      selectedArchetype.value?.Description,
      selectedArchetype.value?.Colour,
      selectedArchetype.value?.Entitlement,
      selectedArchetype.value?.IsGroup,
      selectedArchetype.value?.IsMentionable,
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
  if (!search.value.trim()) return archetypes.value;
  const q = search.value.toLowerCase();
  return archetypes.value?.filter(
    (a) =>
      a.Name.toLowerCase().includes(q) ||
      a.Description.toLowerCase().includes(q),
  );
});

async function addArchetype() {
  if (!selectedServer.value) return;
  await api.serverInteraction.CreateArchetypeAsync(
    selectedServer.value,
    "New Archetype",
  );
}

function updateArchetypeLocal() {
  logger.info("called update archetype", selectedArchetype.value);
  if (!selectedArchetype.value) return;
  try {
    const result = api.serverInteraction.UpdateArchetypeAsync(
      selectedArchetype.value.ServerId,
      selectedArchetype.value,
    );
    toast.toast({
      title: "📁 Saved!",
      duration: 1000,
    });
    // TODO
  } catch (e) {
    toast.toast({
      title: "Failed to save Role",
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
    selectedArchetype.value.Entitlement = (
      BigInt(selectedArchetype.value.Entitlement) | flag
    ).toString();
  } else if (!checked && idx !== -1) {
    selectedArchetype.value.Entitlement = (
      BigInt(selectedArchetype.value.Entitlement) & ~flag
    ).toString();
  }
  logger.info(
    "updated",
    extractEntitlements(BigInt(selectedArchetype.value.Entitlement)),
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
.text-muted {
  color: #6b7280;
}
</style>
