<template>
  <!-- A disabled item takes no pointer events, so the reason sits on a wrapper that does. -->
  <div v-if="gate === 'denied'" class="gated-menu-item" :title="reason ?? t('permission_denied_in_channel')">
    <ContextMenuItem v-bind="inertAttrs" :inset="inset" disabled data-gate="denied">
      <slot />
      <LockIcon class="gated-menu-item__lock" aria-hidden="true" />
    </ContextMenuItem>
  </div>
  <ContextMenuItem v-else-if="gate === 'allowed'" v-bind="$attrs" :inset="inset" :disabled="disabled" data-gate="allowed">
    <slot />
  </ContextMenuItem>
</template>

<script setup lang="ts">
/**
 * A context-menu item behind a permission: usable, shown disabled with the reason on hover, or not
 * shown at all (see PermissionGate).
 */
import { computed, useAttrs } from "vue";
import { LockIcon } from "lucide-vue-next";
import { ContextMenuItem } from "@argon/ui/context-menu";
import { useLocale } from "@/store/system/localeStore";
import type { PermissionGate } from "@/store/data/permissionStore";

defineOptions({ inheritAttrs: false });

defineProps<{
  gate: PermissionGate;
  /** Disabled for a reason other than permissions (e.g. already in progress). */
  disabled?: boolean;
  inset?: boolean;
  /** Why it is disabled; defaults to "not allowed in this channel". */
  reason?: string;
}>();

const { t } = useLocale();

// A denied item gets no listeners at all: disabled styling alone must not be what stops a click.
const attrs = useAttrs();
const inertAttrs = computed(() =>
  Object.fromEntries(Object.entries(attrs).filter(([key]) => !/^on[A-Z]/.test(key))),
);
</script>

<style scoped>
.gated-menu-item {
  cursor: not-allowed;
}

.gated-menu-item__lock {
  width: 0.875rem;
  height: 0.875rem;
  margin-left: auto;
  padding-left: 0.25rem;
  flex-shrink: 0;
  opacity: 0.8;
}
</style>
