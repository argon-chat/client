<template>
    <div class="friend-list">
        <ScrollArea v-if="items.length > 0" class="flex-1 min-h-0">
            <TransitionGroup name="row" tag="div" class="friend-list-rows" appear>
                <div
                    v-for="(entry, index) in entries"
                    :key="entry.key"
                    class="friend-list-slot"
                    :style="{ '--row-index': Math.min(index, 14) }"
                >
                    <div v-if="entry.header" class="friend-list-section">
                        <span>{{ t(SECTION_LABELS[entry.header]) }}</span>
                        <span class="friend-list-section-count">{{ entry.count }}</span>

                        <button
                            v-if="entry.capped"
                            type="button"
                            class="friend-list-section-toggle"
                            @click="toggleSection(entry.header)"
                        >
                            {{ expanded.has(entry.header) ? t("show_less") : t("show_all") }}
                        </button>
                    </div>

                    <FriendListItem
                        v-else
                        :item="entry.item!"
                        :disabled="loading"
                        @accept="$emit('accept', $event)"
                        @decline="$emit('decline', $event)"
                        @cancel="$emit('cancel', $event)"
                        @unfriend="$emit('unfriend', $event)"
                    />
                </div>
            </TransitionGroup>
        </ScrollArea>

        <div v-else key="empty" class="friend-list-empty">
            <EmptyStateArt :name="art" :size="156" />
            <p class="text-sm font-medium">{{ t("empty_section") }}</p>
            <p class="text-xs text-muted-foreground">{{ t("no_items_found") }}</p>

            <Button v-if="canAdd" size="sm" class="mt-3" @click="$emit('add')">
                <IconUserPlus class="w-4 h-4 mr-1.5" />
                {{ t("add_friend") }}
            </Button>
        </div>
    </div>
</template>

<script setup lang="ts">
import { computed, ref } from "vue";
import { ScrollArea } from "@argon/ui/scroll-area";
import { Button } from "@argon/ui/button";
import { IconUserPlus } from "@tabler/icons-vue";
import FriendListItem from "./FriendListItem.vue";
import type { FriendListItemVm } from "./FriendListItem.vue";
import EmptyStateArt, { type EmptyStateArtName } from "@/components/shared/EmptyStateArt.vue";
import { useLocale } from "@/store/system/localeStore";

const { t } = useLocale();

const props = withDefaults(
    defineProps<{
        items: FriendListItemVm[];
        loading?: boolean;
        /** Which empty-state artwork fits the active filter. */
        art?: EmptyStateArtName;
        /** Offer "add a friend" from the empty state — only where it would actually help. */
        canAdd?: boolean;
    }>(),
    { art: "no-friends-sad" },
);

const emit = defineEmits(["accept", "decline", "cancel", "unfriend", "add"]);

type Kind = FriendListItemVm["kind"];

type Entry = {
    key: string;
    /** Set on a section heading; rows carry an item instead. */
    header?: Kind;
    count?: number;
    /** The heading owns a show-all toggle because the section is longer than the preview. */
    capped?: boolean;
    item?: FriendListItemVm;
};

const SECTION_ORDER: Kind[] = ["incoming", "outgoing", "friend", "blocked"];

const SECTION_LABELS: Record<Kind, string> = {
    incoming: "incoming_requests",
    outgoing: "outgoing_requests",
    friend: "friends_list",
    blocked: "blocked_users",
};

/**
 * Friends are what the screen is for, so that section is never trimmed. The ones around it are:
 * somebody with two hundred pending requests would otherwise have to scroll past all of them to
 * reach a single friend.
 */
const PREVIEW_LIMIT = 5;
const isCappable = (kind: Kind) => kind !== "friend";

const expanded = ref(new Set<Kind>());

function toggleSection(kind: Kind) {
    const next = new Set(expanded.value);
    if (!next.delete(kind)) next.add(kind);
    expanded.value = next;
}

/**
 * Everything lives in one list, in the order it needs attention. Headings only appear once there is
 * more than one section to tell apart — a "FRIENDS" strip above a list of friends, on a page titled
 * Friends, is a label for nobody. The show-all toggle lives in the heading rather than at the foot
 * of the section, so collapsing two hundred rows does not mean scrolling to the end of them first.
 *
 * Headings and rows share one flat array so the list stays a single TransitionGroup, which is what
 * keeps the stagger and the move animation working across a section boundary.
 */
const entries = computed<Entry[]>(() => {
    const sections = SECTION_ORDER
        .map((kind) => ({ kind, items: props.items.filter((i) => i.kind === kind) }))
        .filter((section) => section.items.length > 0);

    const withHeadings = sections.length > 1;
    const out: Entry[] = [];

    for (const { kind, items } of sections) {
        const capped = isCappable(kind) && items.length > PREVIEW_LIMIT;
        const shown = capped && !expanded.value.has(kind) ? items.slice(0, PREVIEW_LIMIT) : items;

        if (withHeadings) {
            out.push({ key: `section:${kind}`, header: kind, count: items.length, capped });
        }
        for (const item of shown) out.push({ key: `row:${item.userId}`, item });
    }

    return out;
});

</script>

<style scoped>
/* One panel, not a card wrapped around a bordered scroll area — the nested pair of containers is
   what made this block look unfinished, and on the dark theme the outer half-transparent card was
   invisible anyway. */
.friend-list {
    display: flex;
    flex-direction: column;
    flex: 1;
    min-height: 0;
    overflow: hidden;
    border-radius: var(--radius);
    border: 1px solid hsl(var(--border) / 0.6);
    background: hsl(var(--card));
}

.friend-list-rows {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 2px;
    padding: 6px;
}

/* The row component has several root nodes (popover, plain row, report dialog), so it cannot carry
   fall-through attributes — the per-row stagger index lives on this wrapper instead. */
.friend-list-slot {
    min-width: 0;
}

.friend-list-section {
    display: flex;
    align-items: center;
    gap: 0.375rem;
    padding: 0.75rem 0.625rem 0.25rem;
    font-size: 0.6875rem;
    font-weight: 600;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: hsl(var(--muted-foreground));
}

.friend-list-section-count {
    color: hsl(var(--muted-foreground) / 0.7);
}

.friend-list-section-toggle {
    margin-left: auto;
    padding: 0;
    border: none;
    background: transparent;
    cursor: pointer;
    font: inherit;
    letter-spacing: inherit;
    text-transform: inherit;
    color: hsl(var(--primary));
}

.friend-list-section-toggle:hover {
    text-decoration: underline;
}

.row-enter-active {
    transition: opacity 0.3s ease, transform 0.3s cubic-bezier(0.2, 0.8, 0.3, 1);
    transition-delay: calc(var(--row-index, 0) * 30ms);
}

.row-enter-from {
    opacity: 0;
    transform: translateY(10px);
}

/* Taken out of the flow so the rows below slide up into the gap instead of snapping. */
.row-leave-active {
    position: absolute;
    left: 6px;
    right: 6px;
    transition: opacity 0.18s ease, transform 0.18s ease;
}

.row-leave-to {
    opacity: 0;
    transform: translateX(-12px);
}

.row-move {
    transition: transform 0.28s cubic-bezier(0.2, 0.8, 0.3, 1);
}

.friend-list-empty {
    display: flex;
    flex: 1;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    gap: 2px;
    padding: 1.5rem;
    text-align: center;
}
</style>
