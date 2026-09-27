<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";
import { Button } from "@argon/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { useToast } from "@argon/ui/toast";
import {
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  ImageIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  SmilePlusIcon,
  Trash2Icon,
  WandSparklesIcon,
} from "lucide-vue-next";
import StickerView from "@/components/expressions/StickerView.vue";
import ExpressionUploadZone from "./expressions/ExpressionUploadZone.vue";
import ExpressionUploadCell from "./expressions/ExpressionUploadCell.vue";
import ExpressionPackDialog from "./expressions/ExpressionPackDialog.vue";
import ExpressionItemDialog from "./expressions/ExpressionItemDialog.vue";
import ExpressionWorkbenchDialog from "./expressions/ExpressionWorkbenchDialog.vue";
import { useExpressionUploads, type UploadRow } from "./expressions/useExpressionUploads";
import { useExpressionWorkbench } from "./expressions/useExpressionWorkbench";
import { toMedia, useExpressionsStore, type ExpressionItemPatch } from "@/store/data/expressionsStore";
import { usePoolStore } from "@/store/data/poolStore";
import { usePexStore } from "@/store/data/permissionStore";
import { useMe } from "@/store/auth/meStore";
import { useFeatureFlags } from "@/store/features/featureFlagsStore";
import { db } from "@/store/db/dexie";
import { useLiveQuery } from "@/composables/useLiveQuery";
import { useLocale } from "@/store/system/localeStore";
import { ExpressionRefusal } from "@/lib/refusals";
import { packItemLimit, quotaFor } from "@/lib/expressions/limits";
import { animationsEnabled } from "@/lib/expressions/settings";
import { packCover } from "@/components/expressions/picker/pickerModel";

/**
 * The space's custom emoji and sticker packs: create, rename, reorder and delete packs; upload into
 * them (checked locally first, shown in the pack's grid while they go up); edit and delete items;
 * see what is left of the quota. Create Expressions adds packs and items and changes one's own;
 * Manage Expressions changes anybody's and reorders. Behind the stickers-and-emoji feature flag.
 */
const props = defineProps<{
  /** Default: the space on screen. */
  spaceId?: string | null;
  /** Default: the space's own, from the local database. */
  boostLevel?: number | null;
}>();

const store = useExpressionsStore();
const pool = usePoolStore();
const pex = usePexStore();
const me = useMe();
const features = useFeatureFlags();
const { t } = useLocale();
const { toast } = useToast();

const enabled = computed(() => !!features.stickersAndEmojiActive);
const spaceId = computed(() => props.spaceId ?? pool.selectedServer ?? null);
const space = useLiveQuery(() => (props.boostLevel == null && spaceId.value ? db.servers.get(spaceId.value) : undefined));
const boostLevel = computed(() => props.boostLevel ?? space.value?.boostLevel ?? 0);

// ── who may do what (the server's rule: one's own with Create, anybody's with Manage) ──

const canManage = computed(() => pex.hasInSpace(spaceId.value, "ManageExpressions"));
const canCreate = computed(() => canManage.value || pex.hasInSpace(spaceId.value, "CreateExpressions"));
const myId = computed(() => me.me?.userId ?? null);
const owns = (creatorId: string | null | undefined) => !!creatorId && !!myId.value && creatorId === myId.value;
const canChangePack = (pack: ExpressionPack) => canManage.value || (canCreate.value && owns(pack.creatorId));
const canChangeItem = (item: ExpressionItem) => canManage.value || (canCreate.value && owns(item.creatorId));

watch(
  [spaceId, enabled],
  ([id, on]) => {
    if (id && on) void store.ensureLoaded(id);
  },
  { immediate: true },
);

// ── what is shown ──

const kind = ref<ExpressionKind>(ExpressionKind.Emoji);
const isEmoji = computed(() => kind.value === ExpressionKind.Emoji);
const cellSize = computed(() => (isEmoji.value ? 40 : 64));

const packs = computed<ExpressionPack[]>(() => (spaceId.value ? store.packs(spaceId.value, kind.value) : []));
const selectedPackId = ref<string | null>(null);
const selectedPack = computed(() => packs.value.find((p) => p.packId === selectedPackId.value) ?? null);
const selectedPackEditable = computed(() => !!selectedPack.value && canChangePack(selectedPack.value));

watch(
  packs,
  (list) => {
    if (!list.some((p) => p.packId === selectedPackId.value)) selectedPackId.value = list[0]?.packId ?? null;
  },
  { immediate: true },
);

const usage = computed(() => (spaceId.value ? store.quotaUsage(spaceId.value) : { emoji: 0, stickers: 0, packs: 0 }));
const quota = computed(() => quotaFor(boostLevel.value));
const meters = computed(() => [
  { id: "emoji", label: "expression_settings_quota_emoji", used: usage.value.emoji, limit: quota.value.emoji },
  { id: "stickers", label: "expression_settings_quota_stickers", used: usage.value.stickers, limit: quota.value.stickers },
  { id: "packs", label: "expression_settings_quota_packs", used: usage.value.packs, limit: quota.value.packs },
]);

const kindUsed = computed(() => (isEmoji.value ? usage.value.emoji : usage.value.stickers));
const kindLimit = computed(() => (isEmoji.value ? quota.value.emoji : quota.value.stickers));
const packLimit = computed(() => packItemLimit(kind.value));
const packsFull = computed(() => usage.value.packs >= quota.value.packs);

const takenNames = computed(
  () =>
    new Set(
      spaceId.value ? store.emojiPacks(spaceId.value).flatMap((p) => p.items.map((i) => i.name.toLowerCase())) : [],
    ),
);

function setKind(next: ExpressionKind) {
  if (next === kind.value) return;
  kind.value = next;
  selectedPackId.value = null;
}

// ── errors ──

async function attempt(run: () => Promise<unknown>): Promise<string | null> {
  try {
    await run();
    return null;
  } catch (e) {
    return e instanceof ExpressionRefusal ? e.key : "expression_error_unknown";
  }
}

async function attemptWithToast(run: () => Promise<unknown>) {
  const error = await attempt(run);
  if (error) toast({ title: t("expression_settings_action_failed"), description: t(error), variant: "destructive" });
}

// ── packs ──

const packDialog = ref<{ open: boolean; mode: "create" | "edit"; title: string; slug: string }>({
  open: false,
  mode: "create",
  title: "",
  slug: "",
});

function openCreatePack() {
  packDialog.value = { open: true, mode: "create", title: "", slug: "" };
}

function openEditPack() {
  const pack = selectedPack.value;
  if (pack && canChangePack(pack)) packDialog.value = { open: true, mode: "edit", title: pack.title, slug: pack.slug };
}

async function submitPack(title: string, slug: string): Promise<string | null> {
  const id = spaceId.value;
  if (!id) return "expression_error_unknown";
  if (packDialog.value.mode === "create") {
    return attempt(async () => {
      const pack = await store.createPack(id, kind.value, title, slug);
      selectedPackId.value = pack.packId;
    });
  }
  const pack = selectedPack.value;
  if (!pack) return "expression_error_not_found";
  const patch: { title?: string; slug?: string } = {};
  if (title !== pack.title) patch.title = title;
  if (slug !== pack.slug) patch.slug = slug;
  return Object.keys(patch).length ? attempt(() => store.updatePack(id, pack.packId, patch)) : null;
}

function movePack(index: number, delta: -1 | 1) {
  const id = spaceId.value;
  const ids = packs.value.map((p) => p.packId);
  const to = index + delta;
  if (!id || !canManage.value || to < 0 || to >= ids.length) return;
  [ids[index], ids[to]] = [ids[to], ids[index]];
  void attemptWithToast(() => store.reorderPacks(id, kind.value, ids));
}

const confirmDeletePack = ref(false);
const deletingPack = ref(false);

async function deletePack() {
  const id = spaceId.value;
  const pack = selectedPack.value;
  if (!id || !pack) return;
  deletingPack.value = true;
  try {
    await attemptWithToast(() => store.deletePack(id, pack.packId));
    confirmDeletePack.value = false;
  } finally {
    deletingPack.value = false;
  }
}

// ── uploads: each file is a cell at the end of its pack's grid until the item takes its place ──

const uploads = useExpressionUploads({ upload: (options) => store.uploadItem(options) });

const packRows = computed(() => uploads.rows.value.filter((r) => r.packId === selectedPackId.value));

const uploadBlocker = computed<string | null>(() => {
  const pack = selectedPack.value;
  if (!canCreate.value) return "expression_error_forbidden";
  if (!pack) return "expression_settings_select_pack";
  if (kindUsed.value >= kindLimit.value) return "expression_settings_upload_no_slots";
  if (pack.items.length >= packLimit.value) return "expression_settings_upload_pack_full";
  return null;
});

function onFiles(files: File[]) {
  const id = spaceId.value;
  const pack = selectedPack.value;
  if (!id || !pack || uploadBlocker.value) return;
  const packId = pack.packId;
  const uploadKind = kind.value;
  void uploads.enqueue(files, {
    spaceId: id,
    packId,
    kind: uploadKind,
    takenNames: () => takenNames.value,
    capacity: () => {
      const current = store.packs(id, uploadKind).find((p) => p.packId === packId);
      const used = uploadKind === ExpressionKind.Emoji ? store.quotaUsage(id).emoji : store.quotaUsage(id).stickers;
      const limit = uploadKind === ExpressionKind.Emoji ? quota.value.emoji : quota.value.stickers;
      return Math.min(limit - used, packItemLimit(uploadKind) - (current?.items.length ?? 0));
    },
  });
}

const uploadHint = computed(() => t(isEmoji.value ? "expression_settings_upload_hint_emoji" : "expression_settings_upload_hint_stickers"));

// ── the sticker workbench: "Edit" on a waiting still image, "Create from image" in the toolbar ──

const workbench = useExpressionWorkbench({
  uploads,
  currentKind: () => kind.value,
  onCreated: (file) => {
    if (uploadBlocker.value) {
      toast({ title: t("expression_settings_action_failed"), description: t(uploadBlocker.value), variant: "destructive" });
      return;
    }
    onFiles([file]);
  },
});

const IMAGE_ACCEPT = "image/png,image/webp,image/jpeg,image/gif,image/avif,image/bmp";
const imageInput = ref<HTMLInputElement | null>(null);

function onImagePicked() {
  const file = imageInput.value?.files?.[0];
  if (imageInput.value) imageInput.value.value = "";
  if (file && file.size > 0 && !uploadBlocker.value) workbench.create(file);
}

function onWorkbenchError() {
  toast({ title: t("expression_settings_action_failed"), description: t("expression_workbench_save_failed"), variant: "destructive" });
}

const canEditRow = (row: UploadRow) => workbench.available.value && row.editable && (row.status === "queued" || row.status === "pending");

// ── items ──

const editingItem = ref<ExpressionItem | null>(null);
const itemDialogOpen = ref(false);

function openItem(item: ExpressionItem) {
  if (!canChangeItem(item)) return;
  editingItem.value = item;
  itemDialogOpen.value = true;
}

// The dialog follows the item as the store updates it.
watch(
  () => selectedPack.value?.items,
  (items) => {
    const current = editingItem.value;
    if (!current || !items) return;
    const fresh = items.find((i) => i.itemId === current.itemId);
    if (fresh && fresh !== current) editingItem.value = fresh;
  },
);

const editingIsCover = computed(() => !!editingItem.value && selectedPack.value?.coverItemId === editingItem.value.itemId);

function saveItem(patch: ExpressionItemPatch) {
  const id = spaceId.value;
  const item = editingItem.value;
  if (!id || !item) return Promise.resolve("expression_error_unknown");
  return attempt(() => store.updateItem(id, item.itemId, patch));
}

function removeItem() {
  const id = spaceId.value;
  const item = editingItem.value;
  if (!id || !item) return Promise.resolve("expression_error_unknown");
  return attempt(() => store.deleteItem(id, item.itemId));
}

function setCover() {
  const id = spaceId.value;
  const item = editingItem.value;
  if (!id || !item) return Promise.resolve("expression_error_unknown");
  return attempt(() => store.updatePack(id, item.packId, { coverItemId: item.itemId }));
}

function moveItem(index: number, delta: -1 | 1) {
  const id = spaceId.value;
  const pack = selectedPack.value;
  if (!id || !pack || !canManage.value) return;
  const ids = pack.items.map((i) => i.itemId);
  const to = index + delta;
  if (to < 0 || to >= ids.length) return;
  [ids[index], ids[to]] = [ids[to], ids[index]];
  void attemptWithToast(() => store.reorderItems(id, pack.packId, ids));
}
</script>

<template>
  <div class="expressions-settings space-y-5">
    <div>
      <div class="flex items-center gap-2 mb-1">
        <SmilePlusIcon class="w-5 h-5" />
        <h3 class="text-lg font-semibold">{{ t("expression_settings_title") }}</h3>
      </div>
      <p class="text-sm text-muted-foreground">{{ t("expression_settings_description") }}</p>
    </div>

    <p v-if="!enabled" class="text-sm text-muted-foreground py-6" data-expressions-unavailable>
      {{ t("expression_settings_unavailable") }}
    </p>

    <template v-else>
      <div class="quota">
        <div v-for="m in meters" :key="m.id" class="quota__item" :data-quota="m.id">
          <div class="flex justify-between text-xs mb-1">
            <span class="text-muted-foreground">{{ t(m.label) }}</span>
            <span class="tabular-nums" :class="m.used >= m.limit ? 'text-destructive' : ''">{{ m.used }} / {{ m.limit }}</span>
          </div>
          <div class="quota__bar">
            <div
              class="quota__fill"
              :class="{ 'quota__fill--full': m.used >= m.limit }"
              :style="{ width: `${Math.min(100, (m.used / Math.max(1, m.limit)) * 100)}%` }"
            />
          </div>
        </div>
        <p class="quota__note text-xs text-muted-foreground">{{ t("expression_settings_quota_boost", { level: boostLevel }) }}</p>
      </div>

      <div class="flex gap-2 border-b border-border" role="tablist">
        <button
          type="button"
          role="tab"
          class="tab-btn"
          :class="{ 'tab-btn--active': isEmoji }"
          :aria-selected="isEmoji"
          data-kind="emoji"
          @click="setKind(ExpressionKind.Emoji)"
        >
          {{ t("expression_settings_tab_emoji") }}
        </button>
        <button
          type="button"
          role="tab"
          class="tab-btn"
          :class="{ 'tab-btn--active': !isEmoji }"
          :aria-selected="!isEmoji"
          data-kind="stickers"
          @click="setKind(ExpressionKind.Sticker)"
        >
          {{ t("expression_settings_tab_stickers") }}
        </button>
      </div>

      <p v-if="canCreate && !canManage" class="text-xs text-muted-foreground" data-create-only-hint>
        {{ t("expression_settings_create_only_hint") }}
      </p>

      <div class="layout">
        <aside class="space-y-2 min-w-0">
          <div class="flex items-center justify-between gap-2">
            <span class="section-label">{{ t("expression_settings_packs") }}</span>
            <Button v-if="canCreate" size="sm" variant="outline" :disabled="packsFull" data-new-pack @click="openCreatePack">
              <PlusIcon class="w-4 h-4 mr-1" />
              {{ t("expression_settings_new_pack") }}
            </Button>
          </div>
          <p v-if="!packs.length" class="text-sm text-muted-foreground py-4">{{ t("expression_settings_no_packs") }}</p>
          <ul v-else class="space-y-1">
            <li
              v-for="(pack, i) in packs"
              :key="pack.packId"
              class="pack-row"
              :class="{ 'pack-row--active': pack.packId === selectedPackId }"
            >
              <button type="button" class="pack-row__main" :data-pack-id="pack.packId" @click="selectedPackId = pack.packId">
                <span class="pack-row__cover">
                  <StickerView v-if="packCover(pack)" :media="toMedia(packCover(pack)!)" :size="28" :autoplay="false" group="settings" />
                </span>
                <span class="truncate flex-1 text-left">{{ pack.title }}</span>
                <span class="text-xs text-muted-foreground tabular-nums">{{ pack.items.length }}</span>
              </button>
              <div v-if="canManage" class="pack-row__actions">
                <button type="button" :disabled="i === 0" :aria-label="t('expression_settings_move_up')" @click="movePack(i, -1)">
                  <ChevronUpIcon class="w-4 h-4" />
                </button>
                <button
                  type="button"
                  :disabled="i === packs.length - 1"
                  :aria-label="t('expression_settings_move_down')"
                  @click="movePack(i, 1)"
                >
                  <ChevronDownIcon class="w-4 h-4" />
                </button>
              </div>
            </li>
          </ul>
        </aside>

        <section v-if="selectedPack" class="space-y-3 min-w-0">
          <header class="pack-toolbar">
            <div class="min-w-0 flex-1">
              <h4 class="font-semibold truncate">{{ selectedPack.title }}</h4>
              <p class="text-xs text-muted-foreground truncate">
                {{ selectedPack.slug }} · {{ selectedPack.items.length }} / {{ packLimit }}
              </p>
            </div>
            <div class="flex flex-wrap items-center gap-1">
              <Button
                v-if="canCreate && workbench.available.value"
                size="sm"
                variant="ghost"
                :disabled="!!uploadBlocker"
                data-create-from-image
                @click="imageInput?.click()"
              >
                <WandSparklesIcon class="w-4 h-4 mr-1" />
                {{ t("expression_workbench_create_from_image") }}
              </Button>
              <Button v-if="selectedPackEditable" size="sm" variant="ghost" data-edit-pack @click="openEditPack">
                <PencilIcon class="w-4 h-4 mr-1" />
                {{ t("expression_settings_edit") }}
              </Button>
              <Button
                v-if="selectedPackEditable"
                size="sm"
                variant="ghost"
                class="text-destructive"
                data-delete-pack
                @click="confirmDeletePack = true"
              >
                <Trash2Icon class="w-4 h-4 mr-1" />
                {{ t("expression_settings_delete") }}
              </Button>
            </div>
            <input ref="imageInput" type="file" class="hidden" :accept="IMAGE_ACCEPT" @change="onImagePicked" />
          </header>

          <ExpressionUploadZone
            :disabled="!!uploadBlocker"
            :disabled-reason="uploadBlocker ? t(uploadBlocker) : null"
            :hint="uploadHint"
            @files="onFiles"
          >
            <ul
              v-if="selectedPack.items.length || packRows.length"
              class="item-grid"
              :class="isEmoji ? 'item-grid--emoji' : 'item-grid--stickers'"
              data-item-grid
            >
              <li
                v-for="(item, i) in selectedPack.items"
                :key="item.itemId"
                class="item-tile"
                :data-item-id="item.itemId"
                :data-editable="canChangeItem(item) ? '' : undefined"
              >
                <component
                  :is="canChangeItem(item) ? 'button' : 'div'"
                  :type="canChangeItem(item) ? 'button' : undefined"
                  class="item-tile__main"
                  :class="{ 'item-tile__main--static': !canChangeItem(item) }"
                  :title="isEmoji ? `:${item.name}:` : item.name"
                  :aria-label="canChangeItem(item) ? item.name : undefined"
                  @click="openItem(item)"
                >
                  <span class="item-tile__media" :style="{ width: `${cellSize}px`, height: `${cellSize}px` }">
                    <StickerView :media="toMedia(item)" :size="cellSize" :autoplay="animationsEnabled" loop group="settings" />
                  </span>
                  <span class="item-tile__name">{{ isEmoji ? `:${item.name}:` : item.name }}</span>
                </component>
                <span
                  v-if="selectedPack.coverItemId === item.itemId"
                  class="item-tile__cover"
                  :title="t('expression_settings_item_is_cover')"
                  data-cover
                >
                  <ImageIcon class="w-3 h-3" aria-hidden="true" />
                </span>
                <div v-if="canManage" class="item-tile__move">
                  <button type="button" :disabled="i === 0" :aria-label="t('expression_settings_move_left')" @click="moveItem(i, -1)">
                    <ChevronLeftIcon class="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    :disabled="i === selectedPack.items.length - 1"
                    :aria-label="t('expression_settings_move_right')"
                    @click="moveItem(i, 1)"
                  >
                    <ChevronRightIcon class="w-3.5 h-3.5" />
                  </button>
                </div>
              </li>
              <ExpressionUploadCell
                v-for="row in packRows"
                :key="`upload-${row.id}`"
                :row="row"
                :size="cellSize"
                :can-edit="canEditRow(row)"
                @retry="uploads.retry(row.id)"
                @remove="uploads.remove(row.id)"
                @edit="workbench.edit(row.id)"
              />
            </ul>
            <p v-else class="text-sm text-muted-foreground py-6 text-center">
              {{ t("expression_settings_items_empty") }}
            </p>
          </ExpressionUploadZone>
        </section>
        <section v-else class="text-sm text-muted-foreground py-10 text-center">
          {{ t(packs.length ? "expression_settings_select_pack" : "expression_settings_no_packs_hint") }}
        </section>
      </div>

      <ExpressionPackDialog
        v-model:open="packDialog.open"
        :mode="packDialog.mode"
        :initial-title="packDialog.title"
        :initial-slug="packDialog.slug"
        :submit="submitPack"
      />

      <ExpressionWorkbenchDialog
        v-if="workbench.session.file"
        v-model:open="workbench.session.open"
        :file="workbench.session.file"
        :kind="workbench.session.kind"
        @done="workbench.done"
        @cancel="workbench.cancel"
        @error="onWorkbenchError"
      />

      <ExpressionItemDialog
        v-model:open="itemDialogOpen"
        :item="editingItem"
        :taken-names="takenNames"
        :is-cover="editingIsCover"
        :can-set-cover="selectedPackEditable"
        :save="saveItem"
        :remove="removeItem"
        :set-cover="setCover"
      />

      <Dialog v-model:open="confirmDeletePack">
        <DialogContent class="max-w-md grid-cols-[minmax(0,1fr)] overflow-x-hidden">
          <DialogHeader class="min-w-0 pr-6 text-left sm:text-left">
            <DialogTitle class="break-words">{{ t("expression_settings_delete_pack_title", { title: selectedPack?.title ?? "" }) }}</DialogTitle>
          </DialogHeader>
          <p class="text-sm text-muted-foreground">
            {{ t("expression_settings_delete_pack_body", { count: selectedPack?.items.length ?? 0 }) }}
          </p>
          <div class="flex flex-wrap justify-end gap-2">
            <Button variant="ghost" size="sm" @click="confirmDeletePack = false">{{ t("expression_settings_cancel") }}</Button>
            <Button variant="destructive" size="sm" :disabled="deletingPack" @click="deletePack">
              <LoaderIcon v-if="deletingPack" class="w-4 h-4 mr-1.5 animate-spin" />
              {{ t("expression_settings_delete") }}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </template>
  </div>
</template>

<style scoped>
.quota {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px 16px;
  padding: 12px 14px;
  border: 1px solid hsl(var(--border));
  border-radius: var(--radius);
  background: hsl(var(--card));
}

.quota__note {
  grid-column: 1 / -1;
}

.quota__bar {
  height: 6px;
  border-radius: 999px;
  background: hsl(var(--muted));
  overflow: hidden;
}

.quota__fill {
  height: 100%;
  border-radius: inherit;
  background: hsl(var(--primary));
  transition: width 0.2s ease;
}

.quota__fill--full {
  background: hsl(var(--destructive));
}

.tab-btn {
  padding: 0.5rem 0.75rem;
  font-size: 0.875rem;
  color: hsl(var(--muted-foreground));
  border-bottom: 2px solid transparent;
  margin-bottom: -1px;
  transition: color 0.15s ease, border-color 0.15s ease;
}

.tab-btn:hover {
  color: hsl(var(--foreground));
}

.tab-btn--active {
  color: hsl(var(--foreground));
  border-bottom-color: hsl(var(--primary));
}

.layout {
  display: grid;
  gap: 16px;
}

@media (min-width: 900px) {
  .layout {
    grid-template-columns: 15rem minmax(0, 1fr);
  }
}

.section-label {
  font-size: 0.75rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: hsl(var(--muted-foreground));
}

.pack-row {
  display: flex;
  align-items: center;
  gap: 2px;
  border-radius: calc(var(--radius) - 2px);
}

.pack-row--active {
  background: hsl(var(--accent));
}

.pack-row:not(.pack-row--active):hover {
  background: hsl(var(--accent) / 0.5);
}

.pack-row__main {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  font-size: 0.875rem;
}

.pack-row__cover {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  flex: none;
}

.pack-row__actions {
  display: flex;
  padding-right: 4px;
}

.pack-row__actions button,
.item-tile__move button {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  border-radius: calc(var(--radius) - 4px);
  color: hsl(var(--muted-foreground));
}

.pack-row__actions button {
  width: 24px;
  height: 24px;
}

.pack-row__actions button:hover:not(:disabled),
.item-tile__move button:hover:not(:disabled) {
  background: hsl(var(--background) / 0.6);
  color: hsl(var(--foreground));
}

.pack-row__actions button:disabled,
.item-tile__move button:disabled {
  opacity: 0.3;
}

.pack-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 4px 8px;
  min-width: 0;
}

.item-grid {
  display: grid;
  gap: 8px;
  min-width: 0;
}

.item-grid--emoji {
  grid-template-columns: repeat(auto-fill, minmax(76px, 1fr));
}

.item-grid--stickers {
  grid-template-columns: repeat(auto-fill, minmax(100px, 1fr));
}

.item-tile {
  position: relative;
  min-width: 0;
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.35);
}

.item-tile__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  height: 100%;
  padding: 10px 6px 8px;
  border-radius: inherit;
}

.item-tile__main:hover:not(.item-tile__main--static) {
  background: hsl(var(--accent) / 0.6);
}

.item-tile__main--static {
  cursor: default;
}

.item-tile__media {
  display: flex;
  align-items: center;
  justify-content: center;
  flex: none;
}

.item-tile__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
}

.item-tile__cover {
  position: absolute;
  top: 4px;
  left: 4px;
  display: inline-flex;
  color: hsl(var(--primary));
  pointer-events: none;
}

.item-tile__move {
  position: absolute;
  top: 2px;
  right: 2px;
  display: flex;
  opacity: 0;
  transition: opacity 0.12s ease;
}

.item-tile:hover .item-tile__move,
.item-tile:focus-within .item-tile__move {
  opacity: 1;
}

.item-tile__move button {
  width: 20px;
  height: 20px;
}
</style>
