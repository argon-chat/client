<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { ExpressionKind, type ExpressionItem, type ExpressionPack } from "@argon/glue";
import { Button } from "@argon/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { useToast } from "@argon/ui/toast";
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ChevronUpIcon,
  LoaderIcon,
  PencilIcon,
  PlusIcon,
  SmilePlusIcon,
  Trash2Icon,
  TriangleAlertIcon,
  WandSparklesIcon,
  XIcon,
} from "lucide-vue-next";
import StickerView from "@/components/expressions/StickerView.vue";
import ExpressionUploadZone from "./expressions/ExpressionUploadZone.vue";
import ExpressionPackDialog from "./expressions/ExpressionPackDialog.vue";
import ExpressionItemDialog from "./expressions/ExpressionItemDialog.vue";
import ExpressionWorkbenchDialog from "./expressions/ExpressionWorkbenchDialog.vue";
import { useExpressionUploads } from "./expressions/useExpressionUploads";
import { useExpressionWorkbench } from "./expressions/useExpressionWorkbench";
import { toMedia, useExpressionsStore, type ExpressionItemPatch } from "@/store/data/expressionsStore";
import { usePoolStore } from "@/store/data/poolStore";
import { usePexStore } from "@/store/data/permissionStore";
import { db } from "@/store/db/dexie";
import { useLiveQuery } from "@/composables/useLiveQuery";
import { useLocale } from "@/store/system/localeStore";
import { ExpressionRefusal } from "@/lib/refusals";
import { extractEmoji, packItemLimit, quotaFor } from "@/lib/expressions/limits";
import { packCover } from "@/components/expressions/picker/pickerModel";

/**
 * The space's custom emoji and sticker packs: create, rename, reorder and delete packs; upload into
 * them (checked locally first); edit, reorder and delete items; see what is left of the quota.
 * Adding needs Create Expressions; changing or removing anything needs Manage Expressions.
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
const { t } = useLocale();
const { toast } = useToast();

const spaceId = computed(() => props.spaceId ?? pool.selectedServer ?? null);
const space = useLiveQuery(() => (props.boostLevel == null && spaceId.value ? db.servers.get(spaceId.value) : undefined));
const boostLevel = computed(() => props.boostLevel ?? space.value?.boostLevel ?? 0);

const canManage = computed(() => pex.hasInSpace(spaceId.value, "ManageExpressions"));
const canCreate = computed(() => canManage.value || pex.hasInSpace(spaceId.value, "CreateExpressions"));

watch(
  spaceId,
  (id) => {
    if (id) void store.ensureLoaded(id);
  },
  { immediate: true },
);

// ── what is shown ──

const kind = ref<ExpressionKind>(ExpressionKind.Emoji);
const isEmoji = computed(() => kind.value === ExpressionKind.Emoji);

const packs = computed<ExpressionPack[]>(() => (spaceId.value ? store.packs(spaceId.value, kind.value) : []));
const selectedPackId = ref<string | null>(null);
const selectedPack = computed(() => packs.value.find((p) => p.packId === selectedPackId.value) ?? null);

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
  if (pack) packDialog.value = { open: true, mode: "edit", title: pack.title, slug: pack.slug };
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
  if (!id || to < 0 || to >= ids.length) return;
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

// ── uploads ──

const uploads = useExpressionUploads({ upload: (options) => store.uploadItem(options) });

const defaultEmoji = ref<string[]>(["🙂"]);
const defaultEmojiText = computed(() => defaultEmoji.value.join(""));

function onDefaultEmoji(e: Event) {
  const input = e.target as HTMLInputElement;
  defaultEmoji.value = extractEmoji(input.value).slice(0, 20);
  input.value = defaultEmoji.value.join("");
}

const uploadBlocker = computed<string | null>(() => {
  const pack = selectedPack.value;
  if (!pack) return "expression_settings_select_pack";
  if (kindUsed.value >= kindLimit.value) return "expression_settings_upload_no_slots";
  if (pack.items.length >= packLimit.value) return "expression_settings_upload_pack_full";
  if (!defaultEmoji.value.length) return "expression_settings_emoji_required";
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
    emoji: [...defaultEmoji.value],
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

// ── the sticker workbench: "Edit" on a waiting still image, "Create from image" ──

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

function onWorkbenchError() {
  toast({ title: t("expression_settings_action_failed"), description: t("expression_workbench_save_failed"), variant: "destructive" });
}

const canEditRow = (row: { editable: boolean; status: string }) =>
  workbench.available.value && row.editable && (row.status === "queued" || row.status === "pending");

function statusText(status: string): string {
  switch (status) {
    case "pending":
      return t("expression_workbench_pending");
    case "queued":
      return t("expression_settings_upload_queued");
    case "checking":
      return t("expression_settings_upload_checking");
    case "uploading":
      return t("expression_settings_upload_uploading");
    case "done":
      return t("expression_settings_upload_done");
    default:
      return "";
  }
}

// ── items ──

const editingItem = ref<ExpressionItem | null>(null);
const itemDialogOpen = ref(false);

function openItem(item: ExpressionItem) {
  if (!canManage.value) return;
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
  if (!id || !pack) return;
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

    <p v-if="canCreate && !canManage" class="text-xs text-muted-foreground">{{ t("expression_settings_create_only_hint") }}</p>

    <div class="layout">
      <aside class="space-y-2">
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

      <section v-if="selectedPack" class="space-y-4 min-w-0">
        <header class="flex items-center gap-2">
          <div class="min-w-0 flex-1">
            <h4 class="font-semibold truncate">{{ selectedPack.title }}</h4>
            <p class="text-xs text-muted-foreground truncate">
              {{ selectedPack.slug }} · {{ selectedPack.items.length }} / {{ packLimit }}
            </p>
          </div>
          <Button v-if="canManage" size="sm" variant="ghost" @click="openEditPack">
            <PencilIcon class="w-4 h-4 mr-1" />
            {{ t("expression_settings_edit") }}
          </Button>
          <Button v-if="canManage" size="sm" variant="ghost" class="text-destructive" @click="confirmDeletePack = true">
            <Trash2Icon class="w-4 h-4 mr-1" />
            {{ t("expression_settings_delete") }}
          </Button>
        </header>

        <div v-if="canCreate" class="space-y-2">
          <ExpressionUploadZone
            :disabled="!!uploadBlocker"
            :disabled-reason="uploadBlocker ? t(uploadBlocker) : null"
            :hint="uploadHint"
            :can-create="workbench.available.value"
            @files="onFiles"
            @create="workbench.create"
          />
          <label class="flex items-center gap-2 text-xs text-muted-foreground">
            <span>{{ t("expression_settings_upload_default_emoji") }}</span>
            <input
              class="default-emoji"
              :value="defaultEmojiText"
              autocomplete="off"
              data-default-emoji
              @change="onDefaultEmoji"
            />
          </label>
          <ul v-if="uploads.rows.value.length" class="upload-rows" data-upload-rows>
            <li v-for="row in uploads.rows.value" :key="row.id" class="upload-row" :data-status="row.status">
              <LoaderIcon
                v-if="row.status === 'checking' || row.status === 'uploading' || row.status === 'queued'"
                class="w-4 h-4 animate-spin text-muted-foreground shrink-0"
              />
              <CheckIcon v-else-if="row.status === 'done'" class="w-4 h-4 text-primary shrink-0" />
              <PencilIcon v-else-if="row.status === 'pending' && !row.error" class="w-4 h-4 text-muted-foreground shrink-0" />
              <TriangleAlertIcon v-else class="w-4 h-4 text-destructive shrink-0" />
              <div class="min-w-0 flex-1">
                <div class="truncate text-sm">{{ row.fileName }}</div>
                <div v-if="(row.status === 'failed' || row.status === 'pending') && row.error" class="text-xs text-destructive">
                  {{ t(row.error.key, row.error.params ?? {}) }}
                </div>
                <div v-else class="text-xs text-muted-foreground">{{ statusText(row.status) }}</div>
                <div v-if="row.status === 'uploading'" class="upload-row__bar">
                  <div class="upload-row__fill" :style="{ width: `${Math.round(row.progress * 100)}%` }" />
                </div>
              </div>
              <div v-if="canEditRow(row) || row.status === 'pending'" class="upload-row__actions">
                <button
                  v-if="canEditRow(row)"
                  type="button"
                  class="upload-row__action"
                  data-edit-upload
                  @click="workbench.edit(row.id)"
                >
                  <WandSparklesIcon class="w-3.5 h-3.5" aria-hidden="true" />
                  {{ t("expression_workbench_edit") }}
                </button>
                <button
                  v-if="row.status === 'pending'"
                  type="button"
                  class="upload-row__action upload-row__action--icon"
                  :aria-label="t('expression_workbench_discard')"
                  data-discard-upload
                  @click="uploads.remove(row.id)"
                >
                  <XIcon class="w-3.5 h-3.5" />
                </button>
              </div>
            </li>
            <li v-if="!uploads.busy.value" class="flex justify-end">
              <button type="button" class="text-xs text-muted-foreground hover:text-foreground" @click="uploads.clearFinished()">
                {{ t("expression_settings_upload_clear") }}
              </button>
            </li>
          </ul>
        </div>

        <p v-if="!selectedPack.items.length" class="text-sm text-muted-foreground py-6 text-center">
          {{ t("expression_settings_items_empty") }}
        </p>
        <ul v-else class="item-grid" :class="isEmoji ? 'item-grid--emoji' : 'item-grid--stickers'">
          <li v-for="(item, i) in selectedPack.items" :key="item.itemId" class="item-tile" :data-item-id="item.itemId">
            <button
              type="button"
              class="item-tile__main"
              :class="{ 'item-tile__main--static': !canManage }"
              :title="item.name"
              :aria-label="item.name"
              @click="openItem(item)"
            >
              <StickerView :media="toMedia(item)" :size="isEmoji ? 48 : 72" :autoplay="false" group="settings" />
              <span class="item-tile__name">{{ isEmoji ? `:${item.name}:` : item.name }}</span>
            </button>
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
        </ul>
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
      :save="saveItem"
      :remove="removeItem"
      :set-cover="setCover"
    />

    <Dialog v-model:open="confirmDeletePack">
      <DialogContent class="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{{ t("expression_settings_delete_pack_title", { title: selectedPack?.title ?? "" }) }}</DialogTitle>
        </DialogHeader>
        <p class="text-sm text-muted-foreground">
          {{ t("expression_settings_delete_pack_body", { count: selectedPack?.items.length ?? 0 }) }}
        </p>
        <DialogFooter>
          <Button variant="ghost" @click="confirmDeletePack = false">{{ t("expression_settings_cancel") }}</Button>
          <Button variant="destructive" :disabled="deletingPack" @click="deletePack">
            <LoaderIcon v-if="deletingPack" class="w-4 h-4 mr-1.5 animate-spin" />
            {{ t("expression_settings_delete") }}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
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

.default-emoji {
  width: 8rem;
  height: 28px;
  padding: 0 8px;
  font-size: 1rem;
  border: 1px solid hsl(var(--input));
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--background));
  color: hsl(var(--foreground));
}

.upload-rows {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.upload-row {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 6px 8px;
  border-radius: calc(var(--radius) - 2px);
  background: hsl(var(--muted) / 0.4);
}

.upload-row__actions {
  display: flex;
  align-items: center;
  gap: 4px;
  flex: none;
}

.upload-row__action {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  height: 24px;
  padding: 0 8px;
  font-size: 0.75rem;
  font-weight: 500;
  border-radius: calc(var(--radius) - 4px);
  color: hsl(var(--foreground));
  background: hsl(var(--background) / 0.7);
  border: 1px solid hsl(var(--border));
}

.upload-row__action:hover {
  background: hsl(var(--accent));
}

.upload-row__action--icon {
  width: 24px;
  padding: 0;
  justify-content: center;
  color: hsl(var(--muted-foreground));
}

.upload-row__bar {
  height: 3px;
  margin-top: 4px;
  border-radius: 999px;
  background: hsl(var(--muted));
  overflow: hidden;
}

.upload-row__fill {
  height: 100%;
  background: hsl(var(--primary));
  transition: width 0.15s linear;
}

.item-grid {
  display: grid;
  gap: 8px;
}

.item-grid--emoji {
  grid-template-columns: repeat(auto-fill, minmax(88px, 1fr));
}

.item-grid--stickers {
  grid-template-columns: repeat(auto-fill, minmax(112px, 1fr));
}

.item-tile {
  position: relative;
  border-radius: var(--radius);
  background: hsl(var(--muted) / 0.35);
}

.item-tile__main {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 6px;
  width: 100%;
  padding: 10px 6px 8px;
  border-radius: inherit;
}

.item-tile__main:hover:not(.item-tile__main--static) {
  background: hsl(var(--accent) / 0.6);
}

.item-tile__main--static {
  cursor: default;
}

.item-tile__name {
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: hsl(var(--muted-foreground));
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
