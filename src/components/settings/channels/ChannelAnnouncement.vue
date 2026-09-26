<template>
  <div class="space-y-6">
    <!-- Publishers -->
    <div class="setting-card space-y-4" data-testid="announcement-publishers">
      <div class="flex items-start gap-2 min-w-0">
        <MegaphoneIcon class="w-5 h-5 mt-0.5 shrink-0" />
        <div class="min-w-0">
          <h3 class="text-lg font-semibold leading-tight">{{ t("announcement_publishers") }}</h3>
          <p class="text-xs text-muted-foreground mt-1">{{ t("announcement_publishers_desc") }}</p>
        </div>
      </div>

      <div class="flex flex-wrap gap-2">
        <span
          v-for="role in publishers"
          :key="role.id"
          class="role-chip role-chip--on"
          :data-publisher="role.id"
        >
          <span class="role-dot" :style="{ backgroundColor: roleColour(role) }" />
          {{ role.name }}
          <button
            v-if="canEditPublishers"
            type="button"
            class="role-chip__remove"
            :title="t('announcement_publisher_remove')"
            :disabled="busyRole !== null"
            :data-remove-publisher="role.id"
            @click="setPublisher(role, false)"
          >
            <Loader2 v-if="busyRole === role.id" class="w-3 h-3 animate-spin" />
            <XIcon v-else class="w-3 h-3" />
          </button>
        </span>
        <p v-if="loaded && publishers.length === 0" class="text-xs text-muted-foreground" data-testid="announcement-no-publishers">
          {{ t("announcement_publishers_none") }}
        </p>
      </div>

      <div v-if="canEditPublishers && candidates.length" class="space-y-2">
        <p class="text-xs font-medium text-muted-foreground">{{ t("announcement_publisher_add") }}</p>
        <div class="flex flex-wrap gap-2">
          <button
            v-for="role in candidates"
            :key="role.id"
            type="button"
            class="role-chip role-chip--add"
            :disabled="busyRole !== null"
            :data-add-publisher="role.id"
            @click="setPublisher(role, true)"
          >
            <Loader2 v-if="busyRole === role.id" class="w-3 h-3 animate-spin" />
            <PlusIcon v-else class="w-3 h-3" />
            {{ role.name }}
          </button>
        </div>
      </div>
      <p v-else-if="!canEditPublishers" class="text-xs text-muted-foreground">{{ t("announcement_publishers_need_roles") }}</p>
    </div>

    <!-- Reactions -->
    <div class="setting-card">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <Label>{{ t("announcement_reactions") }}</Label>
          <p class="text-xs text-muted-foreground mt-1">{{ t("announcement_reactions_desc") }}</p>
        </div>
        <Switch
          data-testid="announcement-reactions"
          :checked="form.reactions"
          :disabled="saving || !canManageChannels"
          @update:checked="(v: boolean) => update({ reactions: v })"
        />
      </div>
    </div>

    <!-- Post as space -->
    <div class="setting-card space-y-5">
      <div class="flex items-start justify-between gap-4">
        <div class="min-w-0">
          <Label>{{ t("announcement_post_as_space") }}</Label>
          <p class="text-xs text-muted-foreground mt-1">{{ t("announcement_post_as_space_desc") }}</p>
        </div>
        <Switch
          data-testid="announcement-post-as-space"
          :checked="form.postAsSpace"
          :disabled="saving || !canManageChannels"
          @update:checked="(v: boolean) => update({ postAsSpace: v })"
        />
      </div>
      <div class="flex items-start justify-between gap-4" :class="{ 'opacity-60': !form.postAsSpace }">
        <div class="min-w-0">
          <Label>{{ t("announcement_show_author") }}</Label>
          <p class="text-xs text-muted-foreground mt-1">{{ t("announcement_show_author_desc") }}</p>
        </div>
        <Switch
          data-testid="announcement-show-author"
          :checked="form.showAuthor"
          :disabled="saving || !canManageChannels || !form.postAsSpace"
          @update:checked="(v: boolean) => update({ showAuthor: v })"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
/**
 * The "Announcement" tab of the channel settings: who may post (roles with an Allow SendMessages
 * overwrite on the channel, written the way the permissions tab writes them), whether readers may
 * react, and whether posts appear under the space's name.
 *
 * The switches save at once, all three values together, as SetAnnouncementSettings takes them; the
 * change comes back to every client as ChannelModifiedV2.
 */
import { computed, reactive, ref, watch } from "vue";
import { Label } from "@argon/ui/label";
import { Switch } from "@argon/ui/switch";
import { useToast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import { Loader2, MegaphoneIcon, PlusIcon, XIcon } from "lucide-vue-next";
import {
  UpdateChannelError,
  type AnnouncementSettings,
  type Archetype,
  type ArgonChannel,
  type ArgonEntitlement,
  type ChannelEntitlementOverwrite,
} from "@argon/glue";
import { db } from "@/store/db/dexie";
import { useApi } from "@/store/system/apiStore";
import { useLocale } from "@/store/system/localeStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useChannelStore } from "@/store/data/channelStore";
import { announcementSettingsOf, publisherRoleIds, publishingChange } from "@/lib/chat/announcement";

const props = defineProps<{ channel: ArgonChannel }>();

const api = useApi();
const { t } = useLocale();
const { toast } = useToast();
const pex = usePexStore();
const channelStore = useChannelStore();

const canManageChannels = computed(() => pex.hasIn(props.channel.channelId, "ManageChannels", props.channel.spaceId));
// Overwrites are edited space-wide on the server: ManageChannels and ManageArchetype both.
const canEditPublishers = computed(
  () => pex.hasInSpace(props.channel.spaceId, "ManageChannels") && pex.hasInSpace(props.channel.spaceId, "ManageArchetype"),
);

// ── Settings ──

const stored = computed(() => announcementSettingsOf(props.channel.announcement));
const form = reactive<AnnouncementSettings>({ ...stored.value });
const saving = ref(false);

// A change from elsewhere shows up here, unless a save of ours is in flight.
watch(stored, (next) => {
  if (!saving.value) Object.assign(form, next);
}, { deep: true });

async function update(change: Partial<AnnouncementSettings>) {
  if (saving.value) return;
  Object.assign(form, change);
  saving.value = true;
  try {
    const result = await api.channelInteraction.SetAnnouncementSettings(
      props.channel.spaceId,
      props.channel.channelId,
      form.reactions,
      form.postAsSpace,
      form.showAuthor,
    );
    if (result.isSuccessUpdateChannel()) {
      await channelStore.trackChannel(result.channel);
      Object.assign(form, announcementSettingsOf(result.channel.announcement));
    } else {
      const error = result.isFailedUpdateChannel() ? result.error : UpdateChannelError.NONE;
      Object.assign(form, stored.value);
      toast({ title: t("announcement_settings_failed"), description: errorText(error), variant: "destructive" });
    }
  } catch (e) {
    logger.error("[ChannelAnnouncement] save failed", e);
    Object.assign(form, stored.value);
    toast({ title: t("announcement_settings_failed"), variant: "destructive" });
  } finally {
    saving.value = false;
  }
}

function errorText(error: UpdateChannelError): string | undefined {
  switch (error) {
    case UpdateChannelError.INSUFFICIENT_PERMISSIONS:
      return t("channel_error_no_permission");
    case UpdateChannelError.NOT_AN_ANNOUNCEMENT_CHANNEL:
      return t("announcement_error_not_announcement");
    default:
      return undefined;
  }
}

// ── Publishers ──

const roles = ref<Archetype[]>([]);
const overwrites = ref<ChannelEntitlementOverwrite[]>([]);
const loaded = ref(false);
const busyRole = ref<string | null>(null);

const publisherIds = computed(() => publisherRoleIds(overwrites.value));
const publishers = computed(() => roles.value.filter((r) => publisherIds.value.has(r.id)));
const candidates = computed(() => roles.value.filter((r) => !publisherIds.value.has(r.id)));

function roleColour(role: Archetype): string {
  const argb = role.colour;
  return `rgb(${(argb >> 16) & 0xff}, ${(argb >> 8) & 0xff}, ${argb & 0xff})`;
}

async function load() {
  loaded.value = false;
  try {
    roles.value = await db.archetypes
      .where("spaceId")
      .equals(props.channel.spaceId)
      .filter((a) => !a.isHidden && !a.isDefault)
      .toArray();
    overwrites.value = [...(await api.archetypeInteraction.GetChannelEntitlementOverwrites(props.channel.spaceId, props.channel.channelId))];
  } catch (e) {
    logger.error("[ChannelAnnouncement] load failed", e);
  } finally {
    loaded.value = true;
  }
}

async function setPublisher(role: Archetype, on: boolean) {
  if (busyRole.value) return;
  const existing = overwrites.value.find((o) => o.archetypeId === role.id);
  const change = publishingChange(existing, on);
  busyRole.value = role.id;
  try {
    if (change.remove && existing) {
      const ok = await api.archetypeInteraction.DeleteEntitlementForChannel(props.channel.spaceId, props.channel.channelId, existing.id);
      if (!ok) throw new Error("refused");
      overwrites.value = overwrites.value.filter((o) => o.id !== existing.id);
    } else {
      const saved = await api.archetypeInteraction.UpsertArchetypeEntitlementForChannel(
        props.channel.spaceId,
        props.channel.channelId,
        role.id,
        change.deny as unknown as ArgonEntitlement,
        change.allow as unknown as ArgonEntitlement,
      );
      if (!saved) throw new Error("refused");
      overwrites.value = [...overwrites.value.filter((o) => o.archetypeId !== role.id), saved];
    }
  } catch (e) {
    logger.error("[ChannelAnnouncement] publisher change failed", e);
    toast({ title: t("announcement_publisher_failed"), variant: "destructive" });
  } finally {
    busyRole.value = null;
  }
}

watch(() => props.channel.channelId, () => void load(), { immediate: true });
</script>

<style scoped>
.setting-card {
  border-radius: 0.75rem;
  border: 1px solid hsl(var(--border) / 0.5);
  background-color: hsl(var(--card) / var(--card-alpha));
  padding: 1.5rem;
  overflow: hidden;
}

.role-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 9999px;
  border: 1px solid hsl(var(--border));
  font-size: 0.8rem;
  line-height: 1.2;
}

.role-chip--on {
  border-color: hsl(var(--primary) / 0.5);
  background: hsl(var(--primary) / 0.08);
}

.role-chip--add {
  color: hsl(var(--muted-foreground));
  background: transparent;
  cursor: pointer;
  transition: border-color 0.15s ease, color 0.15s ease;
}

.role-chip--add:hover:not(:disabled) {
  border-color: hsl(var(--primary) / 0.5);
  color: hsl(var(--foreground));
}

.role-chip:disabled {
  opacity: 0.6;
  cursor: default;
}

.role-dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  flex-shrink: 0;
}

.role-chip__remove {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 16px;
  height: 16px;
  margin-right: -4px;
  border-radius: 9999px;
  border: none;
  background: transparent;
  color: hsl(var(--muted-foreground));
  cursor: pointer;
}

.role-chip__remove:hover:not(:disabled) {
  background: hsl(var(--foreground) / 0.1);
  color: hsl(var(--foreground));
}
</style>
