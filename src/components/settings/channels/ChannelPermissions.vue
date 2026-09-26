<template>
  <div class="space-y-4">
    <div>
      <h3 class="text-lg font-semibold">{{ t("channel_permissions") }}</h3>
      <p class="text-sm text-muted-foreground">{{ t("channel_permissions_desc") }}</p>
    </div>

    <div class="flex gap-4 min-h-[420px]">
      <!-- Left: Role list -->
      <div class="w-1/3 border-r border-border pr-3 overflow-y-auto">
        <div class="text-xs font-semibold text-muted-foreground mb-2 uppercase">
          {{ t("roles") }}
        </div>
        <div class="space-y-1">
          <button
            v-for="arch in archetypes"
            :key="arch.id"
            data-testid="overwrite-role"
            class="w-full text-left px-3 py-2 rounded-md text-sm flex items-center gap-2 transition-colors"
            :class="selectedArchetypeId === arch.id ? 'bg-primary/15 text-foreground' : 'text-muted-foreground hover:bg-muted/50'"
            @click="selectArchetype(arch.id)"
          >
            <span class="w-2 h-2 rounded-full shrink-0" :style="{ background: formatColour(arch.colour) }"></span>
            <span class="truncate">{{ arch.name }}</span>
            <span v-if="hasOverwrite(arch.id)" class="ml-auto w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" title="Has overwrites"></span>
          </button>
        </div>
      </div>

      <!-- Right: Overwrite toggles -->
      <ScrollArea class="flex-1 overflow-y-auto">
        <TabTransition variant="rise">
          <div v-if="selectedArchetypeId" :key="selectedArchetypeId" class="space-y-3 pr-2">
            <div class="flex items-center justify-between mb-2">
              <div class="flex items-center gap-2 text-sm font-medium">
                {{ selectedArchetypeName }}
                <span v-if="saving" class="flex items-center gap-1 text-xs font-normal text-muted-foreground" data-testid="overwrite-saving">
                  <Loader2 class="w-3 h-3 animate-spin" />
                  {{ t("saving") }}
                </span>
              </div>
              <Button
                v-if="hasOverwrite(selectedArchetypeId) || localAllow !== 0n || localDeny !== 0n"
                variant="ghost"
                size="sm"
                class="text-red-400 hover:text-red-300 text-xs"
                data-testid="overwrite-reset"
                @click="resetOverwrite"
              >
                <Trash2Icon class="w-3.5 h-3.5 mr-1" />
                {{ t("reset") }}
              </Button>
            </div>

            <Card v-for="group in ChannelEntitlementGroups" :key="group.i18nKey">
              <CardContent class="p-3 space-y-1.5">
                <div class="font-semibold text-sm">{{ t(group.i18nKey + '.name') }}</div>
                <ul class="space-y-1">
                  <li
                    v-for="flag in group.flags"
                    :key="flag.value.toString()"
                    data-testid="overwrite-flag"
                    class="flex items-center justify-between text-sm py-1"
                  >
                    <div class="flex-1 mr-3">
                      <div class="font-medium text-xs">{{ t(flag.i18nKey + '.name') }}</div>
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        class="overwrite-btn"
                        :class="getOverwriteState(flag.value) === 'inherit' ? 'active-inherit' : ''"
                        data-testid="overwrite-inherit"
                        @click="setOverwriteState(flag.value, 'inherit')"
                        :title="t('inherit')"
                      >
                        /
                      </button>
                      <button
                        class="overwrite-btn"
                        :class="getOverwriteState(flag.value) === 'allow' ? 'active-allow' : ''"
                        data-testid="overwrite-allow"
                        @click="setOverwriteState(flag.value, 'allow')"
                        :title="t('allow')"
                      >
                        ✓
                      </button>
                      <button
                        class="overwrite-btn"
                        :class="getOverwriteState(flag.value) === 'deny' ? 'active-deny' : ''"
                        data-testid="overwrite-deny"
                        @click="setOverwriteState(flag.value, 'deny')"
                        :title="t('deny')"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                </ul>
              </CardContent>
            </Card>
          </div>
          <div v-else class="flex items-center justify-center h-full text-muted-foreground text-sm p-8">
            {{ t("select_role_to_configure") }}
          </div>
        </TabTransition>
      </ScrollArea>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The "Permissions" tab of the channel settings: per-role allow/deny overwrites for this channel.
 *
 * Saves as you click, there is no save button. Clicks close together go out as one save; switching
 * roles or closing the sheet sends what is waiting at once, so nothing is dropped on the way out.
 */
import { ref, computed, watch, onBeforeUnmount } from "vue";
import { Card, CardContent } from "@argon/ui/card";
import { ScrollArea } from "@argon/ui/scroll-area";
import TabTransition from "@/components/shared/TabTransition.vue";
import { Button } from "@argon/ui/button";
import { Loader2, Trash2Icon } from "lucide-vue-next";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { db } from "@/store/db/dexie";
import { ArgonEntitlementGroups } from "@/lib/rbac/ArgonEntitlement";
import { ArgonEntitlement, type Archetype, type ArgonChannel, type ChannelEntitlementOverwrite } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

const props = defineProps<{
  channel: ArgonChannel;
}>();

/** Each save re-evaluates the whole space's permissions, so a burst of clicks becomes one. */
const SAVE_DELAY_MS = 500;

const api = useApi();
const { t } = useLocale();
const { toast } = useToast();

const archetypes = ref<Archetype[]>([]);
const overwrites = ref<ChannelEntitlementOverwrite[]>([]);
const selectedArchetypeId = ref<Guid | null>(null);

// Local editing state for the currently selected archetype
const localAllow = ref<bigint>(0n);
const localDeny = ref<bigint>(0n);

// Channel-scoped permission groups (exclude management flags)
const ChannelEntitlementGroups = computed(() =>
  ArgonEntitlementGroups.filter(
    (g) => !g.i18nKey.includes("management")
  )
);

const selectedArchetypeName = computed(() => {
  if (!selectedArchetypeId.value) return "";
  return archetypes.value.find((a) => a.id === selectedArchetypeId.value)?.name ?? "";
});

function hasOverwrite(archetypeId: Guid): boolean {
  return overwrites.value.some((o) => o.archetypeId === archetypeId);
}

function formatColour(argb: number) {
  const r = (argb >> 16) & 0xff;
  const g = (argb >> 8) & 0xff;
  const b = argb & 0xff;
  return `rgb(${r}, ${g}, ${b})`;
}

function getOverwriteState(flagValue: any): "inherit" | "allow" | "deny" {
  const flag = BigInt(flagValue);
  if ((localDeny.value & flag) !== 0n) return "deny";
  if ((localAllow.value & flag) !== 0n) return "allow";
  return "inherit";
}

function setOverwriteState(flagValue: any, state: "inherit" | "allow" | "deny") {
  const flag = BigInt(flagValue);
  // Remove from both first
  localAllow.value = localAllow.value & ~flag;
  localDeny.value = localDeny.value & ~flag;

  if (state === "allow") {
    localAllow.value = localAllow.value | flag;
  } else if (state === "deny") {
    localDeny.value = localDeny.value | flag;
  }
  scheduleSave();
}

function showSaved(archetypeId: Guid) {
  const existing = overwrites.value.find((o) => o.archetypeId === archetypeId);
  localAllow.value = existing ? BigInt(existing.allow) : 0n;
  localDeny.value = existing ? BigInt(existing.deny) : 0n;
}

function selectArchetype(id: Guid) {
  void flushSave();
  selectedArchetypeId.value = id;
  showSaved(id);
}

// ── Saving ──

type PendingSave = { spaceId: Guid; channelId: Guid; archetypeId: Guid; allow: bigint; deny: bigint };

let pending: PendingSave | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;
// One save at a time, so a delete always sees the row an earlier save created.
let queue: Promise<void> = Promise.resolve();
const inFlight = ref(0);
const saving = computed(() => inFlight.value > 0);

function scheduleSave() {
  const archetypeId = selectedArchetypeId.value;
  if (!archetypeId) return;
  pending = {
    spaceId: props.channel.spaceId,
    channelId: props.channel.channelId,
    archetypeId,
    allow: localAllow.value,
    deny: localDeny.value,
  };
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flushSave(), SAVE_DELAY_MS);
}

function flushSave(): Promise<void> {
  if (timer) clearTimeout(timer);
  timer = null;
  const next = pending;
  pending = null;
  if (next) {
    inFlight.value++;
    queue = queue.then(async () => {
      try {
        await persist(next);
      } finally {
        inFlight.value--;
      }
    });
  }
  return queue;
}

async function persist(save: PendingSave) {
  const { spaceId, channelId, archetypeId, allow, deny } = save;
  let ok: boolean;
  try {
    const existing = overwrites.value.find((o) => o.archetypeId === archetypeId);
    // Everything back on inherit is no overwrite at all, not an empty row.
    if (allow === 0n && deny === 0n) {
      ok = !existing || (await api.archetypeInteraction.DeleteEntitlementForChannel(spaceId, channelId, existing.id));
      if (ok) overwrites.value = overwrites.value.filter((o) => o.archetypeId !== archetypeId);
    } else {
      const result = await api.archetypeInteraction.UpsertArchetypeEntitlementForChannel(
        spaceId,
        channelId,
        archetypeId,
        deny as unknown as ArgonEntitlement,
        allow as unknown as ArgonEntitlement,
      );
      ok = result !== null;
      if (result) overwrites.value = [...overwrites.value.filter((o) => o.archetypeId !== archetypeId), result];
    }
  } catch (e) {
    logger.error("Failed to save channel overwrite", e);
    ok = false;
  }

  if (ok) return;
  toast({ title: t("fail_save"), variant: "destructive" });
  // Back to what the server holds, unless newer clicks for this role are already waiting.
  if (selectedArchetypeId.value === archetypeId && pending?.archetypeId !== archetypeId) showSaved(archetypeId);
}

function resetOverwrite() {
  localAllow.value = 0n;
  localDeny.value = 0n;
  scheduleSave();
  void flushSave();
}

onBeforeUnmount(() => void flushSave());

async function loadData() {
  try {
    await queue;
    // Both before either is shown: a role picked before its overwrite arrived would look empty,
    // and the first click would save over it.
    const [spaceArchetypes, result] = await Promise.all([
      db.archetypes
        .where("spaceId")
        .equals(props.channel.spaceId)
        .filter((a) => !a.isHidden)
        .toArray(),
      api.archetypeInteraction.GetChannelEntitlementOverwrites(props.channel.spaceId, props.channel.channelId),
    ]);
    overwrites.value = [...result];
    archetypes.value = spaceArchetypes;
  } catch (e) {
    logger.error("Failed to load channel permissions", e);
  }
}

// The tab is keyed by channel in the drawer, but reload on the id anyway so the component is
// correct on its own.
watch(
  () => props.channel.channelId,
  () => {
    void flushSave();
    selectedArchetypeId.value = null;
    localAllow.value = 0n;
    localDeny.value = 0n;
    void loadData();
  },
  { immediate: true },
);
</script>

<style scoped>
.overwrite-btn {
  width: 28px;
  height: 24px;
  border-radius: 4px;
  border: 1px solid hsl(var(--border) / 0.4);
  background: transparent;
  color: hsl(var(--muted-foreground));
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: all 0.15s;
  display: inline-flex;
  align-items: center;
  justify-content: center;
}

.overwrite-btn:hover {
  border-color: hsl(var(--border));
}

.active-inherit {
  background: hsl(var(--muted));
  color: hsl(var(--foreground));
  border-color: hsl(var(--border));
}

.active-allow {
  background: hsl(142 71% 45% / 0.2);
  color: hsl(142 71% 45%);
  border-color: hsl(142 71% 45% / 0.5);
}

.active-deny {
  background: hsl(0 84% 60% / 0.2);
  color: hsl(0 84% 60%);
  border-color: hsl(0 84% 60% / 0.5);
}
</style>
