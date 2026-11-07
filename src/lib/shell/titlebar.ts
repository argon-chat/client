import { ref } from "vue";
/** The layout debugger may override the normal desktop/web titlebar decision. */
export const titlebarOverride = ref<boolean | null>(null);
