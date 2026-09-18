<script setup lang="ts">
import { Input } from "@argon/ui/input";
import { useLocale } from "@/store/system/localeStore";
import type { NoteContent } from "@/cosmetics/kinds/widget-note";

const props = defineProps<{ content: NoteContent }>();
const emit = defineEmits<{ "update:content": [value: NoteContent] }>();

const { t } = useLocale();

function set(field: keyof NoteContent, value: string): void {
  emit("update:content", { ...props.content, [field]: value });
}
</script>

<template>
  <div class="note-editor">
    <Input
      :model-value="content.heading ?? ''"
      :placeholder="t('cosmetic_widget_note_heading')"
      :maxlength="48"
      class="h-8 text-xs"
      @update:model-value="set('heading', String($event))"
    />
    <textarea
      :value="content.body ?? ''"
      :placeholder="t('cosmetic_widget_note_body')"
      :maxlength="280"
      rows="2"
      class="note-body-input"
      @input="set('body', ($event.target as HTMLTextAreaElement).value)"
    />
  </div>
</template>

<style scoped>
.note-editor {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

/* Takes the height its card was given, rather than three rows and then emptiness. */
.note-editor > textarea {
  flex: 1;
  min-height: 0;
}

.note-body-input {
  width: 100%;
  padding: 6px 9px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  font-size: 0.75rem;
  line-height: 1.35;
  resize: none;
}
</style>
