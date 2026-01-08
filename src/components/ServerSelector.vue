<template>
    <div
        class="server-list-container flex flex-col items-center py-3 justify-between rounded-xl space-y-3 w-55 min-w-[60px] max-w-[60px] shrink-0">
        <Button variant="ghost" size="icon" class="relative w-12 h-12 rounded-full hover:rounded-2xl transition-all duration-200"
            @click="emit('home')">
            <IconSw class="w-8 h-8 fill-blue-500" />
            <span v-if="totalNotifications > 0" class="absolute top-0 right-0 w-3 h-3 bg-red-500 rounded-full border-2 border-card"></span>
        </Button>

        <Separator class="my-3" />

        <div class="flex-1 w-full overflow-y-auto flex flex-col gap-2 px-2"
            @dragover.prevent="onDragOverUncategorized"
            @drop="onDropToUncategorized">
            <!-- Pinned Servers -->
            <div v-if="pinnedServers.length > 0" class="space-y-2">
                <div v-for="server in pinnedServers" :key="server.spaceId" class="relative group">
                    <Button :variant="'secondary'" size="icon"
                        :aria-current="isSelected(server.spaceId)" 
                        class="relative w-12 h-12 transition-all duration-200 hover:rounded-2xl mx-auto" 
                        :class="[isSelected(server.spaceId) ? 'rounded-2xl' : 'rounded-full']" 
                        draggable="true"
                        @dragstart="onDragStart($event, server.spaceId)"
                        @dragover.prevent="onDragOver($event, server.spaceId)"
                        @drop="onDrop($event, server.spaceId)"
                        @dragend="onDragEnd"
                        @click="select(server.spaceId)"
                        @contextmenu.prevent="openContextMenu($event, server.spaceId)">
                        <ArgonAvatar 
                            class="w-full h-full"
                            :file-id="server.avatarFieldId"
                            :space-id="server.spaceId"
                            :fallback="initials(server.name)"
                        />
                        <span class="absolute -left-3 w-1 h-6 rounded-full transition-all duration-400"
                            :class="isSelected(server.spaceId) ? 'bg-blue-500' : 'bg-blue-500/0'" />
                        <IconPinFilled class="absolute -top-1 -right-1 w-3 h-3 text-primary" />
                    </Button>
                </div>
                <Separator class="my-2" />
            </div>

            <!-- Folders -->
            <div v-for="folder in org.folders" :key="folder.id" class="relative">
                <Button variant="secondary" size="icon"
                    class="relative w-12 h-12 transition-all duration-200 hover:rounded-2xl mx-auto rounded-full" 
                    @click="toggleFolderPopup(folder.id, $event)"
                    @dragover.prevent="onDragOverFolder($event, folder.id)"
                    @drop="onDropToFolder($event, folder.id)">
                    <!-- 2x2 Grid of server icons -->
                    <div class="grid grid-cols-2 gap-0.5 w-8 h-8">
                        <div v-for="(server, idx) in getFolderServers(folder).slice(0, 4)" 
                            :key="server.spaceId" 
                            class="overflow-hidden rounded-sm">
                            <ArgonAvatar 
                                :class="getFolderServers(folder).length === 1 ? 'w-8 h-8' : 'w-3.5 h-3.5'"
                                :file-id="server.avatarFieldId"
                                :space-id="server.spaceId"
                                :fallback="initials(server.name)"
                            />
                        </div>
                    </div>
                </Button>
            </div>

            <!-- Uncategorized Servers -->
            <div class="space-y-2">
                <div v-for="server in uncategorizedServers" :key="server.spaceId" class="relative">
                    <Button :variant="'secondary'" size="icon"
                        :aria-current="isSelected(server.spaceId)" 
                        class="relative w-12 h-12 transition-all duration-200 hover:rounded-2xl mx-auto" 
                        :class="[isSelected(server.spaceId) ? 'rounded-2xl' : 'rounded-full']"
                        draggable="true"
                        @dragstart="onDragStart($event, server.spaceId)"
                        @dragover.prevent="onDragOver($event, server.spaceId)"
                        @drop="onDrop($event, server.spaceId)"
                        @dragend="onDragEnd"
                        @click="select(server.spaceId)"
                        @contextmenu.prevent="openContextMenu($event, server.spaceId)">
                        <ArgonAvatar 
                            class="w-full h-full"
                            :file-id="server.avatarFieldId"
                            :space-id="server.spaceId"
                            :fallback="initials(server.name)"
                        />
                        <span class="absolute -left-3 w-1 h-6 rounded-full transition-all duration-400"
                            :class="isSelected(server.spaceId) ? 'bg-blue-500' : 'bg-blue-500/0'" />
                    </Button>
                </div>
            </div>
        </div>

        <Separator class="my-2" />
        
        <Button variant="ghost" size="icon" class="w-12 h-12 rounded-full hover:rounded-2xl transition-all duration-200"
            @click="createSpaceOpened = true">
            <Plus class="w-4 h-4" />
        </Button>

        <TooltipProvider v-if="needsUpdate">
            <Tooltip>
                <TooltipTrigger>
                    <Button variant="default" style="background-color: #48bf32; color: white;" size="icon"
                        class="w-12 h-12 rounded-full hover:rounded-2xl transition-all duration-200" @click="doUpdate">
                        <ArrowBigDown class="w-4 h-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{{t("update_is_ready")}}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>

        <TooltipProvider>
            <Tooltip>
                <TooltipTrigger>
                    <Button variant="outline" size="icon"
                        class="w-12 h-12 rounded-full hover:rounded-2xl transition-all duration-200"
                        @click="feedbackOpened = true">
                        <PaintbrushIcon class="w-4 h-4" />
                    </Button>
                </TooltipTrigger>
                <TooltipContent>
                    <p>{{ t("send_feedback") }}</p>
                </TooltipContent>
            </Tooltip>
        </TooltipProvider>
    </div>

    <CreateOrJoinSpace v-model:open="createSpaceOpened" />
    <SendUserFeedback v-model:open="feedbackOpened" />
    <CreateSpaceDetailed v-model:open="openDetailed"/>

    <!-- Folder Popup -->
    <div v-if="folderPopup.show" 
        class="fixed z-50 bg-card border border-border rounded-lg shadow-lg p-2"
        :style="{ top: folderPopup.y + 'px', left: folderPopup.x + 'px' }"
        @click.stop>
        <div class="grid grid-cols-2 gap-2 w-[120px]">
            <Button v-for="server in folderServers" 
                :key="server.spaceId"
                :variant="'secondary'" size="icon"
                :aria-current="isSelected(server.spaceId)" 
                class="relative w-12 h-12 transition-all duration-200 hover:rounded-2xl" 
                :class="[isSelected(server.spaceId) ? 'rounded-2xl' : 'rounded-full']"
                draggable="true"
                @dragstart="onDragStart($event, server.spaceId, folderPopup.folderId!)"
                @dragend="onDragEnd"
                @click="select(server.spaceId); folderPopup.show = false"
                @contextmenu.prevent="openContextMenu($event, server.spaceId)">
                <ArgonAvatar 
                    class="w-full h-full"
                    :file-id="server.avatarFieldId"
                    :space-id="server.spaceId"
                    :fallback="initials(server.name)"
                />
            </Button>
        </div>
    </div>

    <!-- Context Menu -->
    <div v-if="contextMenu.show" 
        class="fixed z-50 bg-card border border-border rounded-lg shadow-lg py-1 min-w-[150px]"
        :style="{ top: contextMenu.y + 'px', left: contextMenu.x + 'px' }"
        @click="contextMenu.show = false">
        <button class="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
            @click="togglePin(contextMenu.serverId!)">
            <IconPinFilled v-if="isServerPinned(contextMenu.serverId!)" class="w-4 h-4" />
            <IconPin v-else class="w-4 h-4" />
            {{ isServerPinned(contextMenu.serverId!) ? t('unpin') : t('pin') }}
        </button>
        <div v-if="org.folders.length > 0" class="border-t border-border my-1"></div>
        <button v-for="folder in org.folders" :key="folder.id"
            class="w-full px-3 py-2 text-left text-sm hover:bg-accent flex items-center gap-2"
            @click="addToFolder(folder.id, contextMenu.serverId!)">
            <div class="w-3 h-3 rounded-full shrink-0" :style="{ backgroundColor: folder.color }"></div>
            {{ folder.name }}
        </button>
    </div>
</template>

<script setup lang="ts">
import { computed, ref, onMounted, onUnmounted } from "vue"
import { Button } from "@/components/ui/button"
import { Separator } from "@/components/ui/separator"
import ArgonAvatar from "./ArgonAvatar.vue"
import { Plus, ArrowBigDown, PaintbrushIcon } from "lucide-vue-next"
import { IconChevronRight, IconDots, IconPin, IconPinFilled, IconFolderPlus } from '@tabler/icons-vue'
import IconSw from "@/assets/icons/icon_cat.svg"
import { ArgonSpaceBase } from "@/lib/glue/argonChat"
import { Guid } from "@argon-chat/ion.webcore"
import { useLocale } from "@/store/localeStore"
import { addRecentSpace } from "@/lib/recentSpaces"
import { useServerOrganization } from "@/lib/serverOrganization"
import CreateOrJoinSpace from "./modals/CreateOrJoinSpace.vue"
import TooltipProvider from "./ui/tooltip/TooltipProvider.vue"
import Tooltip from "./ui/tooltip/Tooltip.vue"
import TooltipTrigger from "./ui/tooltip/TooltipTrigger.vue"
import TooltipContent from "./ui/tooltip/TooltipContent.vue"
import { useVersionChecker } from "@/lib/useVersionChecker"
import SendUserFeedback from "./modals/SendUserFeedback.vue"
import CreateSpaceDetailed from "./modals/CreateSpaceDetailed.vue"
import { useNotifications } from "@/composables/useNotifications"

const { t } = useLocale();
const { totalNotifications, initialize, cleanup } = useNotifications();

const createSpaceOpened = ref(false);
const feedbackOpened = ref(false);
const openDetailed = ref(false);

const { needsUpdate, doUpdate } = useVersionChecker();

const { 
    organization: org, 
    toggleServerPin, 
    isServerPinned,
    toggleFolderCollapse,
    addServerToFolder,
    removeServerFromFolder,
    getServerFolder,
    createFolder
} = useServerOrganization();

const props = defineProps<{
    spaces: ArgonSpaceBase[]
}>()

const model = defineModel<string | null>('selectedSpace', {
    type: String, required: false
})

const emit = defineEmits<{
    (e: 'home'): void
    (e: 'select', id: Guid): void
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
// Pinned servers
const pinnedServers = computed(() => {
    return props.spaces.filter(s => isServerPinned(s.spaceId));
});

// Uncategorized servers (not pinned, not in folders)
const uncategorizedServers = computed(() => {
    return props.spaces.filter(s => {
        return !isServerPinned(s.spaceId) && !getServerFolder(s.spaceId);
    });
});

// Get servers in folder
const getFolderServers = (folder: any) => {
    return props.spaces.filter(s => folder.serverIds.includes(s.spaceId));
};

// Servers for current folder popup
const folderServers = computed(() => {
    if (!folderPopup.value.folderId) return [];
    const folder = org.value.folders.find(f => f.id === folderPopup.value.folderId);
    return folder ? getFolderServers(folder) : [];
});

const isSelected = (id: string) => model.value === id;

const select = (id: string) => {
    const space = props.spaces.find(s => s.spaceId === id);
    if (space) {
        addRecentSpace(space);
    }
    emit("select", id);
};

const initials = (name: string) =>
    name
        .trim()
        .split(/\s+/)
        .map(w => w[0]?.toUpperCase() ?? '')
        .slice(0, 2)
        .join('');

function openContextMenu(event: MouseEvent, serverId: string) {
    contextMenu.value = {
        show: true,
        x: event.clientX,
        y: event.clientY,
        serverId
    };
}

function openFolderMenu(event: MouseEvent, folderId: string) {
    // TODO: implement folder menu
    event.stopPropagation();
}

function togglePin(serverId: string) {
    toggleServerPin(serverId);
    contextMenu.value.show = false;
}

function addToFolder(folderId: string, serverId: string) {
    addServerToFolder(folderId, serverId);
    contextMenu.value.show = false;
}

// Drag and drop handlers
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

function onDrop(event: DragEvent, targetServerId: string, targetFolder?: string) {
    event.preventDefault();
    const draggedServerId = dragState.value.draggingServerId;
    
    if (!draggedServerId || draggedServerId === targetServerId) {
        return;
    }
    
    // If dropped on another server, create new folder with both servers
    if (!targetFolder) {
        const folder = createFolder(`Group ${org.value.folders.length + 1}`);
        addServerToFolder(folder.id, draggedServerId);
        addServerToFolder(folder.id, targetServerId);
    }
}

function onDragOverFolder(event: DragEvent, folderId: string) {
    if (dragState.value.draggingServerId) {
        event.dataTransfer!.dropEffect = 'move';
    }
}

function onDropToFolder(event: DragEvent, folderId: string) {
    event.preventDefault();
    const draggedServerId = dragState.value.draggingServerId;
    
    if (!draggedServerId) return;
    
    // Remove from source folder if exists
    if (dragState.value.sourceFolder) {
        removeServerFromFolder(draggedServerId);
    }
    
    // Add to target folder
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
    
    // Remove from folder (will auto-delete folder if only 1 server left)
    removeServerFromFolder(draggedServerId);
}

function closeContextMenu() {
    contextMenu.value.show = false;
}

function toggleFolderPopup(folderId: string, event: MouseEvent) {
    event.stopPropagation();
    const button = event.currentTarget as HTMLElement;
    const rect = button.getBoundingClientRect();
    
    folderPopup.value = {
        show: !folderPopup.value.show || folderPopup.value.folderId !== folderId,
        x: rect.right + 10,
        y: rect.top,
        folderId
    };
}

function closeFolderPopup() {
    folderPopup.value.show = false;
}

function closeAll() {
    closeContextMenu();
    closeFolderPopup();
}

onMounted(() => {
    document.addEventListener('click', closeAll);
    initialize();
});

onUnmounted(() => {
    document.removeEventListener('click', closeAll);
    cleanup();
});
</script>
<style lang="css" scoped>
.server-list-container {
    background-color: hsl(var(--card));
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style>