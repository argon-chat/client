import { createSharedComposable, useMediaQuery } from "@vueuse/core";
import { computed, ref, watch } from "vue";
import { splitFeatureEnabled, splitOpen } from "@/composables/useSplitView";

/**
 * The window width from which a space's member list shows beside the chat. Below it the chat
 * needs the room: the list is hidden, and the header's toggle opens it over the chat's edge.
 */
export const MEMBER_LIST_INLINE_QUERY = "(min-width: 1000px)";

/** The user's toggle, for this session (module state, so leaving the space keeps it): null follows the width. */
const choice = ref<boolean | null>(null);

/**
 * Whether the member list shows, shared by the space view (which renders it) and the chat
 * header (whose button toggles it).
 *
 * The default follows the window width. The toggle is the user's choice for this session. It
 * lasts until the window crosses the breakpoint, which brings the default for the new width back.
 * Nothing is persisted.
 */
export const useMemberList = createSharedComposable(() => {
    const inline = useMediaQuery(MEMBER_LIST_INLINE_QUERY);
    watch(inline, () => {
        choice.value = null;
    });

    const visible = computed(() => choice.value ?? inline.value);
    /** Shown over the chat rather than beside it: the window is narrower than the breakpoint. */
    const overlay = computed(() => !inline.value);
    /** The space view shows no member list beside a split chat, so there is nothing to toggle. */
    const available = computed(() => !(splitFeatureEnabled.value && splitOpen.value));

    function toggle() {
        choice.value = !visible.value;
    }

    return { visible, overlay, available, toggle };
});
