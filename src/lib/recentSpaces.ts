import { ref, watch } from 'vue';
import type { ArgonSpaceBase } from '@argon/glue';

const STORAGE_KEY = 'argon_recent_spaces';
const VIEW_MODE_KEY = 'argon_recent_spaces_view';
const MAX_RECENT = 5;

interface RecentSpace {
    spaceId: string;
    name: string;
    avatarFieldId: string | null;
    lastVisited: number;
    isPinned?: boolean;
}

const recentSpaces = ref<RecentSpace[]>([]);

// Load from localStorage
function loadRecentSpaces() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            recentSpaces.value = JSON.parse(stored);
        }
    } catch (e) {
        console.error('Failed to load recent spaces:', e);
        recentSpaces.value = [];
    }
}

// Save to localStorage
function saveRecentSpaces() {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(recentSpaces.value));
    } catch (e) {
        console.error('Failed to save recent spaces:', e);
    }
}

// Add or update recent space
export function addRecentSpace(space: ArgonSpaceBase) {
    const existingIndex = recentSpaces.value.findIndex(s => s.spaceId === space.spaceId);
    const existingSpace = existingIndex !== -1 ? recentSpaces.value[existingIndex] : null;
    
    const recentSpace: RecentSpace = {
        spaceId: space.spaceId,
        name: space.name,
        avatarFieldId: space.avatarFieldId,
        lastVisited: Date.now(),
        isPinned: existingSpace?.isPinned || false
    };
    
    if (existingIndex !== -1) {
        // Update existing entry
        recentSpaces.value.splice(existingIndex, 1);
    }
    
    // Add to beginning
    recentSpaces.value.unshift(recentSpace);
    
    // Keep only MAX_RECENT items (but don't remove pinned)
    const unpinned = recentSpaces.value.filter(s => !s.isPinned);
    const pinned = recentSpaces.value.filter(s => s.isPinned);
    
    if (unpinned.length > MAX_RECENT) {
        recentSpaces.value = [...pinned, ...unpinned.slice(0, MAX_RECENT)];
    }
    
    saveRecentSpaces();
}

// Get recent spaces
export function useRecentSpaces() {
    if (recentSpaces.value.length === 0) {
        loadRecentSpaces();
    }
    
    return {
        recentSpaces,
        addRecentSpace,
        togglePin
    };
}

// Toggle pin for a space
export function togglePin(spaceId: string) {
    const space = recentSpaces.value.find(s => s.spaceId === spaceId);
    if (space) {
        space.isPinned = !space.isPinned;
        saveRecentSpaces();
    }
}

// View mode management
export function getViewMode(): 'list' | 'grid' {
    try {
        const stored = localStorage.getItem(VIEW_MODE_KEY);
        return stored === 'grid' ? 'grid' : 'list';
    } catch (e) {
        return 'list';
    }
}

export function setViewMode(mode: 'list' | 'grid') {
    try {
        localStorage.setItem(VIEW_MODE_KEY, mode);
    } catch (e) {
        console.error('Failed to save view mode:', e);
    }
}
