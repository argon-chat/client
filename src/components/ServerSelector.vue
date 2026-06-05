<template>
  <TooltipProvider :delay-duration="300">
    <div class="server-list-container flex flex-col py-2 w-[50px] min-w-[50px] max-w-[50px] shrink-0">
      <!-- Scrollable rail -->
      <div
        class="rail-scroll flex-1 w-full flex flex-col gap-2"
        @dragover.prevent="onDragOverUncategorized"
        @drop="onDropToUncategorized"
      >
        <!-- Pinned -->
        <template v-if="pinnedServers.length > 0">
          <ServerRailIcon
            v-for="server in pinnedServers"
            :key="server.spaceId"
            :server="server"
            :active="isSelected(server.spaceId)"
            :pinned="true"
            @select="select(server.spaceId)"
            @dragstart="onDragStart($event, server.spaceId)"
            @dragover="onDragOver($event, server.spaceId)"
            @drop="onDrop($event, server.spaceId)"
            @dragend="onDragEnd"
            @contextmenu="openContextMenu($event, server.spaceId)"
          />
          <Separator class="rail-sep" />
        </template>

        <!-- Folders -->
        <Tooltip v-for="folder in org.folders" :key="folder.id">
          <TooltipTrigger as-child>
            <div class="rail-slot group">
              <button
                class="rail-icon-btn rail-folder"
                @click="toggleFolderPopup(folder.id, $event)"
                @dragover.prevent="onDragOverFolder($event, folder.id)"
                @drop="onDropToFolder($event, folder.id)"
              >
                <div class="folder-grid">
                  <ArgonAvatar
                    v-for="srv in getFolderServers(folder).slice(0, 4)"
                    :key="srv.spaceId"
                    :class="['folder-mini', getFolderServers(folder).length === 1 ? 'w-6 h-6' : 'w-3 h-3']"
                    :file-id="srv.avatarFieldId"
                    :space-id="srv.spaceId"
                    :fallback="initials(srv.name)"
                  />
                </div>
                <span v-if="folderTotalMentions(folder) > 0" class="rail-badge">{{ folderTotalMentions(folder) }}</span>
                <span v-else-if="folderHasUnread(folder)" class="rail-dot" />
              </button>
            </div>
          </TooltipTrigger>
          <TooltipContent side="right" :side-offset="12" class="font-medium">{{ folder.name }}</TooltipContent>
        </Tooltip>

        <!-- Uncategorized -->
        <ServerRailIcon
          v-for="server in uncategorizedServers"
          :key="server.spaceId"
          :server="server"
          :active="isSelected(server.spaceId)"
          @select="select(server.spaceId)"
          @dragstart="onDragStart($event, server.spaceId)"
          @dragover="onDragOver($event, server.spaceId)"
          @drop="onDrop($event, server.spaceId)"
          @dragend="onDragEnd"
          @contextmenu="openContextMenu($event, server.spaceId)"
        />
      </div>

      <Separator class="rail-sep" />

      <!-- Add -->
      <Tooltip>
        <TooltipTrigger as-child>
          <div class="rail-slot">
            <button class="rail-icon-btn rail-add" @click="createSpaceOpened = true">
              <Plus class="w-4 h-4" />
            </button>
          </div>
        </TooltipTrigger>
        <TooltipContent side="right" :side-offset="12" class="font-medium">Add a space</TooltipContent>
      </Tooltip>
    </div>

    <CreateOrJoinSpace v-model:open="createSpaceOpened" />
    <CreateSpaceDetailed v-model:open="openDetailed" />

    <!-- Folder Popup -->
    <Transition name="rail-pop">
      <div
        v-if="folderPopup.show"
        class="rail-popover"
        :style="{ top: folderPopup.y + 'px', left: folderPopup.x + 'px' }"
        @click.stop
      >
        <div class="rail-popover-grid">
          <ServerRailIcon
            v-for="server in folderServers"
            :key="server.spaceId"
            :server="server"
            :active="isSelected(server.spaceId)"
            @select="select(server.spaceId); folderPopup.show = false"
            @dragstart="onDragStart($event, server.spaceId, folderPopup.folderId!)"
            @dragend="onDragEnd"
            @contextmenu="openContextMenu($event, server.spaceId)"
          />
        </div>
      </div>
    </Transition>

    <!-- Context Menu -->
    <Transition name="rail-pop">
      <div
        v-if="contextMenu.show"
        class="rail-ctx"
        :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
        @click="contextMenu.show = false"
      >
        <button class="rail-ctx-item" @click="togglePin(contextMenu.serverId!)">
          <IconPinFilled v-if="isServerPinned(contextMenu.serverId!)" class="w-4 h-4" />
          <IconPin v-else class="w-4 h-4" />
          {{ isServerPinned(contextMenu.serverId!) ? t('unpin') : t('pin') }}
        </button>

        <template v-if="org.folders.length > 0">
          <div class="rail-ctx-sep" />
          <button
            v-for="folder in org.folders"
            :key="folder.id"
            class="rail-ctx-item"
            @click="addToFolder(folder.id, contextMenu.serverId!)"
          >
            <div class="w-3 h-3 rounded-full shrink-0" :style="{ backgroundColor: folder.color }" />
            {{ folder.name }}
          </button>
        </template>

        <div class="rail-ctx-sep" />
        <button class="rail-ctx-item rail-ctx-item--danger" @click="reportSpaceId = contextMenu.serverId!; reportDialogOpen = true">
          <Flag class="w-4 h-4" />
          {{ t('report_space') }}
        </button>
      </div>
    </Transition>

    <ReportDialog
      v-model:open="reportDialogOpen"
      :target-kind="ReportTargetKind.SPACE"
      :target-id="reportSpaceId"
    />
  </TooltipProvider>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue"
import { Separator } from "@argon/ui/separator"
import { Tooltip, TooltipProvider, TooltipTrigger, TooltipContent } from "@argon/ui/tooltip"
import ArgonAvatar from "./ArgonAvatar.vue"
import ServerRailIcon from "./ServerRailIcon.vue"
import { Plus, Flag } from "lucide-vue-next"
import { IconPin, IconPinFilled } from '@tabler/icons-vue'
import { ArgonSpaceBase, ReportTargetKind } from "@argon/glue"
import { Guid } from "@argon-chat/ion.webcore"
import { useLocale } from "@/store/system/localeStore"
import { addRecentSpace } from "@/lib/recentSpaces"
import { useServerOrganization } from "@/lib/serverOrganization"
import CreateOrJoinSpace from "./modals/CreateOrJoinSpace.vue"
import CreateSpaceDetailed from "./modals/CreateSpaceDetailed.vue"
import ReportDialog from "./modals/ReportDialog.vue"
import { useNotificationStore } from "@/store/data/notificationStore"

const { t } = useLocale();
const ntf = useNotificationStore();

const createSpaceOpened = ref(false);
const openDetailed = ref(false);
const reportDialogOpen = ref(false);
const reportSpaceId = ref<Guid>("");

const {
    organization: org,
    toggleServerPin,
    isServerPinned,
    addServerToFolder,
    removeServerFromFolder,
    getServerFolder,
    createFolderWithServers
} = useServerOrganization();

const props = defineProps<{
    spaces: ArgonSpaceBase[]
}>()

const model = defineModel<string | null>('selectedSpace', {
    type: String, required: false
})

const emit = defineEmits<{
    (e: 'select', id: Guid): void
    (e: 'home'): void
}>()

const contextMenu = ref({
    show: false,
    x: 0,
    y: 0,
    serverId: null as string | null
});

const folderPopup = ref({
    show: false,
    x: 0,
    y: 0,
    folderId: null as string | null
});

const dragState = ref({
    draggingServerId: null as string | null,
    sourceFolder: null as string | null
});

// Pinned but NOT inside a folder (a server in a folder renders only in the folder).
const pinnedServers = computed(() =>
    props.spaces.filter(s => isServerPinned(s.spaceId) && !getServerFolder(s.spaceId))
);

const uncategorizedServers = computed(() =>
    props.spaces.filter(s => !isServerPinned(s.spaceId) && !getServerFolder(s.spaceId))
);

const getFolderServers = (folder: any) => props.spaces.filter(s => folder.serverIds.includes(s.spaceId));

const folderTotalMentions = (folder: any) =>
    getFolderServers(folder).reduce((sum, s) => {
        if (ntf.isTargetMuted(s.spaceId)) return sum;
        return sum + (ntf.getSpaceBadge(s.spaceId)?.totalMentions ?? 0);
    }, 0);

const folderHasUnread = (folder: any) =>
    getFolderServers(folder).some(s => {
        if (ntf.isTargetMuted(s.spaceId)) return false;
        return (ntf.getSpaceBadge(s.spaceId)?.unreadChannelCount ?? 0) > 0;
    });

const folderServers = computed(() => {
    if (!folderPopup.value.folderId) return [];
    const folder = org.value.folders.find(f => f.id === folderPopup.value.folderId);
    return folder ? getFolderServers(folder) : [];
});

const isSelected = (id: string) => model.value === id;

const select = (id: string) => {
    const space = props.spaces.find(s => s.spaceId === id);
    if (space) addRecentSpace(space);
    emit("select", id);
};

const initials = (name: string) =>
    name.trim().split(/\s+/).map(w => w[0]?.toUpperCase() ?? '').slice(0, 2).join('');

function openContextMenu(event: MouseEvent, serverId: string) {
    contextMenu.value = { show: true, x: event.clientX, y: event.clientY, serverId };
}

function togglePin(serverId: string) {
    toggleServerPin(serverId);
    contextMenu.value.show = false;
}

function addToFolder(folderId: string, serverId: string) {
    addServerToFolder(folderId, serverId);
    contextMenu.value.show = false;
}

// ── Drag and drop ──────────────────────────────────────────────────
function onDragStart(event: DragEvent, serverId: string, folderId?: string) {
    dragState.value.draggingServerId = serverId;
    dragState.value.sourceFolder = folderId || null;
    if (event.dataTransfer) {
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', serverId);
    }
}

function onDragOver(event: DragEvent, targetServerId: string) {
    if (dragState.value.draggingServerId && dragState.value.draggingServerId !== targetServerId) {
        event.dataTransfer!.dropEffect = 'move';
    }
}

function onDrop(_event: DragEvent, targetServerId: string, targetFolder?: string) {
    const draggedServerId = dragState.value.draggingServerId;
    if (!draggedServerId || draggedServerId === targetServerId) return;

    // Dropping a server onto another → one folder with both (atomic, dedups).
    if (!targetFolder) {
        createFolderWithServers([draggedServerId, targetServerId]);
    }
}

function onDragOverFolder(event: DragEvent, _folderId: string) {
    if (dragState.value.draggingServerId) event.dataTransfer!.dropEffect = 'move';
}

function onDropToFolder(event: DragEvent, folderId: string) {
    event.preventDefault();
    const draggedServerId = dragState.value.draggingServerId;
    if (!draggedServerId) return;
    if (dragState.value.sourceFolder) removeServerFromFolder(draggedServerId);
    addServerToFolder(folderId, draggedServerId);
}

function onDragEnd() {
    dragState.value.draggingServerId = null;
    dragState.value.sourceFolder = null;
}

function onDragOverUncategorized(event: DragEvent) {
    if (dragState.value.draggingServerId && dragState.value.sourceFolder) {
        event.preventDefault();
        event.dataTransfer!.dropEffect = 'move';
    }
}

function onDropToUncategorized(event: DragEvent) {
    event.preventDefault();
    const draggedServerId = dragState.value.draggingServerId;
    if (!draggedServerId || !dragState.value.sourceFolder) return;
    removeServerFromFolder(draggedServerId);
}

// ── Popups ─────────────────────────────────────────────────────────
function toggleFolderPopup(folderId: string, event: MouseEvent) {
    event.stopPropagation();
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    folderPopup.value = {
        show: !folderPopup.value.show || folderPopup.value.folderId !== folderId,
        x: rect.right + 10,
        y: rect.top,
        folderId
    };
}

function closeAll() {
    contextMenu.value.show = false;
    folderPopup.value.show = false;
}

onMounted(() => document.addEventListener('click', closeAll));
onUnmounted(() => document.removeEventListener('click', closeAll));
</script>

<style lang="css" scoped>
.server-list-container {
    background-color: hsl(var(--card));
    border: 1px solid hsl(var(--border) / 0.5);
    border-radius: var(--radius);
}

/* Rail scroll — hidden scrollbar (no jitter, no eaten pixels). */
.rail-scroll {
    overflow-y: auto;
    overflow-x: visible;
    scrollbar-width: none;
    -ms-overflow-style: none;
}
.rail-scroll::-webkit-scrollbar {
    width: 0;
    height: 0;
    display: none;
}

.rail-sep {
    width: 24px;
    margin: 2px auto;
    background: hsl(var(--border) / 0.6);
}

/* ── Slot + indicator (shared with ServerRailIcon visuals) ── */
.rail-slot {
    position: relative;
    display: flex;
    justify-content: center;
    width: 100%;
}

.rail-indicator {
    position: absolute;
    left: 0;
    top: 50%;
    width: 4px;
    height: 0;
    border-radius: 0 4px 4px 0;
    background: hsl(var(--foreground));
    transform: translateY(-50%);
    opacity: 0;
    transition: height 0.18s ease, opacity 0.18s ease;
}
.rail-slot:hover .rail-indicator { height: 12px; opacity: 0.6; }
.rail-slot.is-active .rail-indicator { height: 20px; opacity: 1; }

/* ── Generic rail icon button (home / folder / add) ── */
.rail-icon-btn {
    position: relative;
    width: 40px;
    height: 40px;
    display: flex;
    align-items: center;
    justify-content: center;
    border: none;
    border-radius: 50%;
    background: hsl(var(--muted) / 0.6);
    color: hsl(var(--foreground));
    cursor: pointer;
    transition: border-radius 0.18s ease, background 0.18s ease, color 0.18s ease;
}
.rail-slot:hover .rail-icon-btn,
.rail-icon-btn.is-active {
    border-radius: var(--radius);
}
.rail-home:hover { background: hsl(var(--primary) / 0.85); color: #fff; }
.rail-home.is-active { background: hsl(var(--primary)); color: #fff; }
.rail-folder:hover { background: hsl(var(--accent)); }
.rail-add { color: #22c55e; }
.rail-add:hover { background: #22c55e; color: #fff; }

/* ── Folder mini preview (1–4 avatars, centered & wrapping) ── */
.folder-grid {
    display: flex;
    flex-wrap: wrap;
    align-content: center;
    justify-content: center;
    gap: 2px;
    width: 28px;
    height: 28px;
}
.folder-mini {
    flex: 0 0 auto;
    border-radius: 4px;
    overflow: hidden;
}

/* ── Badges (folder button) ── */
.rail-badge {
    position: absolute;
    bottom: -2px;
    right: -2px;
    min-width: 16px;
    height: 16px;
    padding: 0 3px;
    display: flex;
    align-items: center;
    justify-content: center;
    border-radius: 8px;
    background: hsl(var(--destructive));
    color: hsl(var(--destructive-foreground));
    font-size: 9px;
    font-weight: 700;
    border: 2px solid hsl(var(--card));
}
.rail-dot {
    position: absolute;
    bottom: 0;
    right: 0;
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background: #fff;
    border: 2px solid hsl(var(--card));
}

/* ── Folder popover ── */
.rail-popover {
    position: fixed;
    z-index: 50;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: var(--radius);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    padding: 8px;
}
.rail-popover-grid {
    display: grid;
    grid-template-columns: repeat(2, 40px);
    gap: 8px;
}

/* ── Context menu ── */
.rail-ctx {
    position: fixed;
    z-index: 50;
    min-width: 160px;
    background: hsl(var(--card));
    border: 1px solid hsl(var(--border));
    border-radius: calc(var(--radius) - 2px);
    box-shadow: 0 10px 30px rgba(0, 0, 0, 0.35);
    padding: 4px;
}
.rail-ctx-item {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 7px 10px;
    border: none;
    background: transparent;
    color: hsl(var(--foreground));
    font-size: 13px;
    border-radius: 7px;
    cursor: pointer;
    transition: background 0.12s ease;
    text-align: left;
}
.rail-ctx-item:hover { background: hsl(var(--accent)); }
.rail-ctx-item--danger { color: hsl(var(--destructive)); }
.rail-ctx-item--danger:hover { background: hsl(var(--destructive) / 0.12); }
.rail-ctx-sep {
    height: 1px;
    margin: 4px 6px;
    background: hsl(var(--border));
}

/* Popover/menu transition */
.rail-pop-enter-active {
    transition: opacity 0.15s ease, transform 0.15s cubic-bezier(0.16, 1, 0.3, 1);
}
.rail-pop-leave-active {
    transition: opacity 0.1s ease, transform 0.1s ease;
}
.rail-pop-enter-from,
.rail-pop-leave-to {
    opacity: 0;
    transform: scale(0.95) translateX(-4px);
}
</style>
