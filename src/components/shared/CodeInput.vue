<script setup lang="ts">
import { ref, watch } from "vue";
import { PinInput, PinInputGroup, PinInputInput, PinInputSeparator } from "@argon/ui/pin-input";

/** A one-time code, typed box by box or pasted whole; `complete` fires once every box is filled. */
const props = withDefaults(defineProps<{ modelValue?: string; length?: number; disabled?: boolean }>(), {
  modelValue: "",
  length: 6,
  disabled: false,
});

const emit = defineEmits<{
  "update:modelValue": [value: string];
  complete: [code: string];
}>();

const cells = ref<string[]>([]);

watch(
  () => props.modelValue,
  (value) => {
    if (value !== cells.value.join("")) cells.value = value.slice(0, props.length).split("");
  },
  { immediate: true },
);

function onUpdate(value: string[]) {
  cells.value = value;
  emit("update:modelValue", value.join(""));
}
</script>

<template>
  <PinInput
    :model-value="cells"
    placeholder="○"
    otp
    :disabled="disabled"
    class="justify-center"
    data-testid="code-input"
    @update:model-value="onUpdate"
    @complete="(value: string[]) => emit('complete', value.join(''))"
  >
    <PinInputGroup class="gap-2">
      <template v-for="(_, index) in length" :key="index">
        <PinInputInput
          :index="index"
          inputmode="numeric"
          class="h-12 w-10 rounded-lg border bg-background/50 text-lg font-semibold first:rounded-l-lg last:rounded-r-lg focus:border-primary focus:ring-primary/30"
        />
        <PinInputSeparator v-if="length % 2 === 0 && index === length / 2 - 1" class="text-muted-foreground">-</PinInputSeparator>
      </template>
    </PinInputGroup>
  </PinInput>
</template>
