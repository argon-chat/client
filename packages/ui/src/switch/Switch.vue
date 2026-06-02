<script setup lang="ts">
import { cn } from "@argon/core";
import { SwitchRoot, SwitchThumb } from "reka-ui";
import { computed, type HTMLAttributes } from "vue";

/**
 * reka-ui's SwitchRoot uses `modelValue` / `update:modelValue` (v-model).
 * The app historically binds `v-model:checked`, so this wrapper accepts BOTH
 * `checked` (legacy) and `modelValue`, and emits BOTH update events — so every
 * existing call site keeps working without changes.
 */
const props = defineProps<{
  class?: HTMLAttributes["class"];
  /** Native reka binding (v-model). */
  modelValue?: boolean;
  /** Legacy binding used across the app (v-model:checked). */
  checked?: boolean;
  defaultValue?: boolean;
  disabled?: boolean;
  id?: string;
  name?: string;
  required?: boolean;
  value?: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [value: boolean];
  "update:checked": [value: boolean];
}>();

const isControlled = computed(
  () => props.checked !== undefined || props.modelValue !== undefined,
);

// `checked` wins (app convention), then `modelValue`, then `defaultValue`.
const currentValue = computed<boolean>(
  () => props.checked ?? props.modelValue ?? props.defaultValue ?? false,
);

function onUpdate(value: boolean) {
  // Mirror to both bindings so v-model and v-model:checked both stay in sync.
  emit("update:modelValue", value);
  emit("update:checked", value);
}

// Dev guard: an *interactive* switch with no binding is a silent no-op — warn.
// (Disabled placeholders intentionally have no binding, so skip those.)
if (
  import.meta.env?.DEV &&
  !isControlled.value &&
  props.defaultValue === undefined &&
  !props.disabled
) {
  console.warn(
    "[ui/Switch] rendered without v-model / v-model:checked / :default-value — " +
      "toggling it won't be reflected anywhere.",
  );
}
</script>

<template>
  <SwitchRoot
    :model-value="isControlled ? currentValue : undefined"
    :default-value="!isControlled ? (defaultValue ?? false) : undefined"
    :disabled="disabled"
    :id="id"
    :name="name"
    :required="required"
    :value="value"
    @update:model-value="onUpdate"
    :class="cn(
      'peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:bg-primary data-[state=unchecked]:bg-input',
      props.class,
    )"
  >
    <SwitchThumb
      :class="cn('pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5')"
    >
      <slot name="thumb" />
    </SwitchThumb>
  </SwitchRoot>
</template>
