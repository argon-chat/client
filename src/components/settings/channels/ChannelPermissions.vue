<template>
  <Dialog :open="open" @update:open="$emit('update:open', $event)">
    <DialogContent class="max-w-3xl max-h-[85vh] overflow-hidden flex flex-col">
      <DialogHeader>
        <DialogTitle>{{ t("channel_permissions") || "Channel Permissions" }} — #{{ channelName }}</DialogTitle>
        <DialogDescription>
          {{ t("channel_permissions_desc") || "Override role permissions for this channel." }}
        </DialogDescription>
      </DialogHeader>

      <div class="flex gap-4 flex-1 overflow-hidden min-h-0">
        <!-- Left: Role list -->
        <div class="w-1/3 border-r border-border pr-3 overflow-y-auto">
          <div class="text-xs font-semibold text-muted-foreground mb-2 uppercase">
            {{ t("roles") || "Roles" }}
          </div>
          <div class="space-y-1">
            <button
              v-for="arch in archetypes"
              :key="arch.id"
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
          <div v-if="selectedArchetypeId" class="space-y-3 pr-2">
            <div class="flex items-center justify-between mb-2">
              <div class="text-sm font-medium">
                {{ selectedArchetypeName }}
              </div>
              <Button
                v-if="hasOverwrite(selectedArchetypeId)"
                variant="ghost"
                size="sm"
                class="text-red-400 hover:text-red-300 text-xs"
                @click="resetOverwrite"
              >
                <Trash2Icon class="w-3.5 h-3.5 mr-1" />
                {{ t("reset") || "Reset" }}
              </Button>
            </div>

            <Card v-for="group in ChannelEntitlementGroups" :key="group.i18nKey">
              <CardContent class="p-3 space-y-1.5">
                <div class="font-semibold text-sm">{{ t(group.i18nKey + '.name') }}</div>
                <ul class="space-y-1">
                  <li
                    v-for="flag in group.flags"
                    :key="flag.value.toString()"
                    class="flex items-center justify-between text-sm py-1"
                  >
                    <div class="flex-1 mr-3">
                      <div class="font-medium text-xs">{{ t(flag.i18nKey + '.name') }}</div>
                    </div>
                    <div class="flex items-center gap-1">
                      <button
                        class="overwrite-btn"
                        :class="getOverwriteState(flag.value) === 'inherit' ? 'active-inherit' : ''"
                        @click="setOverwriteState(flag.value, 'inherit')"
                        :title="t('inherit') || 'Inherit'"
                      >
                        /
                      </button>
                      <button
                        class="overwrite-btn"
                        :class="getOverwriteState(flag.value) === 'allow' ? 'active-allow' : ''"
                        @click="setOverwriteState(flag.value, 'allow')"
                        :title="t('allow') || 'Allow'"
                      >
                        ✓
                      </button>
                      <button
                        class="overwrite-btn"
                        :class="getOverwriteState(flag.value) === 'deny' ? 'active-deny' : ''"
                        @click="setOverwriteState(flag.value, 'deny')"
                        :title="t('deny') || 'Deny'"
                      >
                        ✕
                      </button>
                    </div>
                  </li>
                </ul>
              </CardContent>
            </Card>

            <div class="flex justify-end pt-2 pb-1">
              <Button :disabled="saving" @click="saveOverwrite">
                {{ saving ? (t("saving") || "Saving...") : (t("save_changes") || "Save Changes") }}
              </Button>
            </div>
          </div>
          <div v-else class="flex items-center justify-center h-full text-muted-foreground text-sm p-8">
            {{ t("select_role_to_configure") || "Select a role to configure overwrites" }}
          </div>
        </ScrollArea>
      </div>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from "vue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@argon/ui/dialog";
import { Card, CardContent } from "@argon/ui/card";
import { ScrollArea } from "@argon/ui/scroll-area";
import { Button } from "@argon/ui/button";
import { Trash2Icon } from "lucide-vue-next";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { db } from "@/store/db/dexie";
import {
  ArgonEntitlementGroups,
  type ArgonEntitlementFlagDefinition,
} from "@/lib/rbac/ArgonEntitlement";
import { ArgonEntitlement, type Archetype, type ChannelEntitlementOverwrite } from "@argon/glue";
import type { Guid } from "@argon-chat/ion.webcore";

const props = defineProps<{
  open: boolean;
  spaceId: Guid;
  channelId: Guid;
  channelName: string;
}>();

const emit = defineEmits<{
  (e: "update:open", value: boolean): void;
}>();

const api = useApi();
const { t } = useLocale();
const { toast } = useToast();

const archetypes = ref<Archetype[]>([]);
const overwrites = ref<ChannelEntitlementOverwrite[]>([]);
const selectedArchetypeId = ref<Guid | null>(null);
const saving = ref(false);

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
}

function selectArchetype(id: Guid) {
  selectedArchetypeId.value = id;
  const existing = overwrites.value.find((o) => o.archetypeId === id);
  if (existing) {
    localAllow.value = BigInt(existing.allow);
    localDeny.value = BigInt(existing.deny);
  } else {
    localAllow.value = 0n;
    localDeny.value = 0n;
  }
}

async function saveOverwrite() {
  if (!selectedArchetypeId.value) return;
  saving.value = true;
  try {
    const result = await api.archetypeInteraction.UpsertArchetypeEntitlementForChannel(
      props.spaceId,
      props.channelId,
      selectedArchetypeId.value,
      localDeny.value as unknown as ArgonEntitlement,
      localAllow.value as unknown as ArgonEntitlement,
    );
    if (result) {
      // Update local overwrites list
      const idx = overwrites.value.findIndex((o) => o.archetypeId === selectedArchetypeId.value);
      if (idx >= 0) {
        overwrites.value[idx] = result;
      } else {
        overwrites.value.push(result);
      }
    }
    toast({ title: t("saved") || "Saved" });
  } catch (e) {
    logger.error("Failed to save channel overwrite", e);
    toast({ title: t("fail_save") || "Failed to save", variant: "destructive" });
  } finally {
    saving.value = false;
  }
}

async function resetOverwrite() {
  if (!selectedArchetypeId.value) return;
  const existing = overwrites.value.find((o) => o.archetypeId === selectedArchetypeId.value);
  if (!existing) return;

  saving.value = true;
  try {
    await api.archetypeInteraction.DeleteEntitlementForChannel(
      props.spaceId,
      props.channelId,
      existing.id,
    );
    overwrites.value = overwrites.value.filter((o) => o.archetypeId !== selectedArchetypeId.value);
    localAllow.value = 0n;
    localDeny.value = 0n;
    toast({ title: t("reset_success") || "Overwrite removed" });
  } catch (e) {
    logger.error("Failed to delete channel overwrite", e);
    toast({ title: t("fail_save") || "Failed to reset", variant: "destructive" });
  } finally {
    saving.value = false;
  }
}

async function loadData() {
  if (!props.open) return;
  try {
    // Load archetypes from local DB
    archetypes.value = await db.archetypes
      .where("spaceId")
      .equals(props.spaceId)
      .filter((a) => !a.isHidden)
      .toArray();

    // Load existing overwrites from API
    const result = await api.archetypeInteraction.GetChannelEntitlementOverwrites(
      props.spaceId,
      props.channelId,
    );
    overwrites.value = [...result];
  } catch (e) {
    logger.error("Failed to load channel permissions", e);
  }
}

watch(() => props.open, (isOpen) => {
  if (isOpen) {
    selectedArchetypeId.value = null;
    localAllow.value = 0n;
    localDeny.value = 0n;
    loadData();
  }
});
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
