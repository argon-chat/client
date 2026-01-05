import { ref } from 'vue';

const STORAGE_KEY = 'argon_server_organization';

export interface ServerFolder {
    id: string;
    name: string;
    color?: string;
    collapsed?: boolean;
    serverIds: string[];
}

export interface ServerOrganization {
    pinnedServerIds: string[];
    folders: ServerFolder[];
}

const organization = ref<ServerOrganization>({
    pinnedServerIds: [],
    folders: []
});

// Load from localStorage
function loadOrganization() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            organization.value = JSON.parse(stored);
        }
    } catch (e) {
        console.error('Failed to load server organization:', e);
        organization.value = {
            pinnedServerIds: [],
            folders: []
        };
    }
}

// Load on module initialization
loadOrganization();

// Save to localStorage
function saveOrganization() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(organization.value));
    } catch (e) {
        console.error('Failed to save server organization:', e);
    }
}

// Toggle pin for a server
export function toggleServerPin(serverId: string) {
    const index = organization.value.pinnedServerIds.indexOf(serverId);
    if (index !== -1) {
        organization.value.pinnedServerIds.splice(index, 1);
    } else {
        organization.value.pinnedServerIds.push(serverId);
    }
    saveOrganization();
}

// Check if server is pinned
export function isServerPinned(serverId: string): boolean {
    return organization.value.pinnedServerIds.includes(serverId);
}

// Create new folder with servers
export function createFolderWithServers(serverIds: string[]): ServerFolder {
    const folder: ServerFolder = {
        id: `folder_${Date.now()}`,
        name: `Folder ${organization.value.folders.length + 1}`,
        color: `#${Math.floor(Math.random()*16777215).toString(16)}`,
        collapsed: false,
        serverIds: serverIds
    };
    
    // Remove servers from other folders
    organization.value.folders.forEach(f => {
        f.serverIds = f.serverIds.filter(id => !serverIds.includes(id));
    });
    
    organization.value.folders.push(folder);
    saveOrganization();
    return folder;
}

// Create new folder
export function createFolder(name: string, color?: string): ServerFolder {
    const folder: ServerFolder = {
        id: `folder_${Date.now()}`,
        name,
        color: color || '#6366f1',
        collapsed: false,
        serverIds: []
    };
    organization.value.folders.push(folder);
    saveOrganization();
    return folder;
}

// Delete folder
export function deleteFolder(folderId: string) {
    const index = organization.value.folders.findIndex(f => f.id === folderId);
    if (index !== -1) {
        organization.value.folders.splice(index, 1);
        saveOrganization();
    }
}

// Rename folder
export function renameFolder(folderId: string, newName: string) {
    const folder = organization.value.folders.find(f => f.id === folderId);
    if (folder) {
        folder.name = newName;
        saveOrganization();
    }
}

// Toggle folder collapse
export function toggleFolderCollapse(folderId: string) {
    const folder = organization.value.folders.find(f => f.id === folderId);
    if (folder) {
        folder.collapsed = !folder.collapsed;
        saveOrganization();
    }
}

// Add server to folder
export function addServerToFolder(folderId: string, serverId: string) {
    const folder = organization.value.folders.find(f => f.id === folderId);
    if (folder && !folder.serverIds.includes(serverId)) {
        // Remove from other folders first
        organization.value.folders.forEach(f => {
            const idx = f.serverIds.indexOf(serverId);
            if (idx !== -1) {
                f.serverIds.splice(idx, 1);
            }
        });
        folder.serverIds.push(serverId);
        saveOrganization();
    }
}

// Remove server from folder
export function removeServerFromFolder(serverId: string) {
    organization.value.folders.forEach((folder, folderIndex) => {
        const index = folder.serverIds.indexOf(serverId);
        if (index !== -1) {
            folder.serverIds.splice(index, 1);
            // Delete folder if only 1 server remains
            if (folder.serverIds.length <= 1) {
                organization.value.folders.splice(folderIndex, 1);
            }
        }
    });
    saveOrganization();
}

// Get folder for server
export function getServerFolder(serverId: string): ServerFolder | null {
    return organization.value.folders.find(f => f.serverIds.includes(serverId)) || null;
}

// Get organized servers
export function useServerOrganization() {
    return {
        organization,
        toggleServerPin,
        isServerPinned,
        createFolder,
        createFolderWithServers,
        deleteFolder,
        renameFolder,
        toggleFolderCollapse,
        addServerToFolder,
        removeServerFromFolder,
        getServerFolder
    };
}
