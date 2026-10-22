<template>
  <ContextMenu>
    <ContextMenuTrigger as="div" class="w-full">
      <slot />
    </ContextMenuTrigger>
    <ContextMenuContent class="w-60">
      <ContextMenuItem v-if="canManage" @select="manageSpace">
        <Settings class="w-4 h-4 mr-2" />{{ t('manage_space') }}
      </ContextMenuItem>
      <template v-if="canManageChannels">
        <ContextMenuItem @select="addChannelOpened = true">
          <Plus class="w-4 h-4 mr-2" />{{ t('add_channel') }}
        </ContextMenuItem>
        <ContextMenuItem @select="addGroupOpened = true">
          <FolderPlus class="w-4 h-4 mr-2" />{{ t('add_category_channels') }}
        </ContextMenuItem>
      </template>
      <ContextMenuSeparator v-if="canManage || canManageChannels" />
      <ContextMenuItem @select="toggleServerPin(spaceId)">
        <PinOff v-if="isServerPinned(spaceId)" class="w-4 h-4 mr-2" />
        <Pin v-else class="w-4 h-4 mr-2" />
        {{ isServerPinned(spaceId) ? t('unpin') : t('pin') }}
      </ContextMenuItem>
      <ContextMenuSub v-if="org.folders.length">
        <ContextMenuSubTrigger><Folder class="w-4 h-4 mr-2" />{{ t('move_to_folder') }}</ContextMenuSubTrigger>
        <ContextMenuSubContent class="w-56">
          <ContextMenuItem v-for="folder in org.folders" :key="folder.id" @select="addServerToFolder(folder.id, spaceId)">
            <span class="truncate">{{ folder.name }}</span>
          </ContextMenuItem>
        </ContextMenuSubContent>
      </ContextMenuSub>
      <ContextMenuItem v-if="getServerFolder(spaceId)" @select="removeServerFromFolder(spaceId)">
        <FolderMinus class="w-4 h-4 mr-2" />{{ t('remove_from_folder') }}
      </ContextMenuItem>
      <ContextMenuItem @select="toggleMute">
        <Bell v-if="ntf.isTargetMuted(spaceId)" class="w-4 h-4 mr-2" />
        <BellOff v-else class="w-4 h-4 mr-2" />
        {{ ntf.isTargetMuted(spaceId) ? t('unmute_space') : t('mute_space') }}
      </ContextMenuItem>
      <ContextMenuSeparator />
      <ContextMenuItem @select="copyId"><Copy class="w-4 h-4 mr-2" />{{ t('copy_space_id') }}</ContextMenuItem>
      <ContextMenuItem class="text-destructive focus:text-destructive" @select="reportOpened = true">
        <Flag class="w-4 h-4 mr-2" />{{ t('report_space') }}
      </ContextMenuItem>
    </ContextMenuContent>
  </ContextMenu>
  <AddChannel v-if="addChannelOpened" v-model:open="addChannelOpened" v-model:group-id="noGroup" :selected-space="spaceId" />
  <AddChannelGroup v-if="addGroupOpened" v-model:open="addGroupOpened" :selected-space="spaceId" />
  <ReportDialog v-if="reportOpened" v-model:open="reportOpened" :target-kind="ReportTargetKind.SPACE" :target-id="spaceId" />
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { Settings, Plus, FolderPlus, FolderMinus, Folder, Pin, PinOff, Bell, BellOff, Copy, Flag } from 'lucide-vue-next';
import { ContextMenu, ContextMenuTrigger, ContextMenuContent, ContextMenuItem, ContextMenuSeparator, ContextMenuSub, ContextMenuSubTrigger, ContextMenuSubContent } from '@argon/ui/context-menu';
import { MuteLevelType, MuteTargetKind, ReportTargetKind } from '@argon/glue';
import { logger } from '@argon/core';
import { useToast } from '@argon/ui/toast';
import { usePexStore } from '@/store/data/permissionStore';
import { usePoolStore } from '@/store/data/poolStore';
import { useNotificationStore } from '@/store/data/notificationStore';
import { useWindow } from '@/store/ui/windowStore';
import { useLocale } from '@/store/system/localeStore';
import { useServerOrganization } from '@/lib/serverOrganization';
import AddChannel from './modals/AddChannel.vue';
import AddChannelGroup from './modals/AddChannelGroup.vue';
import ReportDialog from './modals/ReportDialog.vue';

const props = defineProps<{ spaceId: string }>();
const router = useRouter();
const pex = usePexStore();
const pool = usePoolStore();
const ntf = useNotificationStore();
const windows = useWindow();
const { t } = useLocale();
const { toast } = useToast();
const { organization: org, toggleServerPin, isServerPinned, addServerToFolder, removeServerFromFolder, getServerFolder } = useServerOrganization();
const permissionsReady = computed(() => pex.ready(props.spaceId) || pool.selectedServer === props.spaceId);
const canManage = computed(() => permissionsReady.value && (['ManageServer', 'ManageArchetype', 'ManageBots', 'CreateExpressions', 'ManageExpressions'] as const)
  .some((flag) => pex.hasInSpace(props.spaceId, flag)));
const canManageChannels = computed(() => permissionsReady.value && pex.hasInSpace(props.spaceId, 'ManageChannels'));
const addChannelOpened = ref(false);
const addGroupOpened = ref(false);
const reportOpened = ref(false);
const noGroup = ref<string | null>(null);

async function manageSpace() {
  if (!canManage.value) return;
  await router.push({ name: 'SpaceShellView', params: { id: props.spaceId } });
  windows.openServerSettings();
}

async function toggleMute() {
  if (ntf.isTargetMuted(props.spaceId)) await ntf.unmuteTarget(props.spaceId);
  else await ntf.muteTarget(props.spaceId, MuteTargetKind.Space, MuteLevelType.All, true, null);
}

async function copyId() {
  try {
    await navigator.clipboard.writeText(props.spaceId);
  } catch (error) {
    logger.warn('Failed to copy space ID', error);
    toast({ title: t('error'), description: t('unexpected_error'), variant: 'destructive' });
  }
}
</script>
