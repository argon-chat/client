<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { Input } from "@argon/ui/input";
import { Label } from "@argon/ui/label";
import { LoaderIcon } from "lucide-vue-next";
import { packSlugError, packTitleError, slugify } from "@/lib/expressions/limits";
import { useLocale } from "@/store/system/localeStore";

/**
 * Create or rename a pack. The short name follows the title until it is edited by hand.
 * `submit` resolves to an i18n error key to show, or null when it went through.
 */
const props = defineProps<{
  open: boolean;
  mode: "create" | "edit";
  initialTitle?: string;
  initialSlug?: string;
  submit: (title: string, slug: string) => Promise<string | null>;
}>();

const emit = defineEmits<{ "update:open": [open: boolean] }>();

const { t } = useLocale();

const title = ref("");
const slug = ref("");
const slugTouched = ref(false);
const busy = ref(false);
const serverError = ref<string | null>(null);

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    title.value = props.initialTitle ?? "";
    slug.value = props.initialSlug ?? "";
    slugTouched.value = props.mode === "edit";
    serverError.value = null;
  },
  { immediate: true },
);

watch(title, (value) => {
  if (!slugTouched.value) slug.value = slugify(value);
});

function onSlugInput(value: string | number) {
  slugTouched.value = true;
  slug.value = String(value).toLowerCase();
}

const titleError = computed(() => (title.value.length ? packTitleError(title.value) : null));
const slugError = computed(() => (slug.value.length ? packSlugError(slug.value) : null));
const valid = computed(() => !!title.value && !!slug.value && !titleError.value && !slugError.value);

async function onSubmit() {
  if (!valid.value || busy.value) return;
  busy.value = true;
  serverError.value = null;
  try {
    const error = await props.submit(title.value, slug.value);
    if (error) serverError.value = error;
    else emit("update:open", false);
  } finally {
    busy.value = false;
  }
}
</script>

<template>
  <Dialog :open="open" @update:open="emit('update:open', $event)">
    <DialogContent class="sm:max-w-md">
      <DialogHeader>
        <DialogTitle>
          {{ t(mode === "create" ? "expression_settings_pack_create_title" : "expression_settings_pack_edit_title") }}
        </DialogTitle>
      </DialogHeader>
      <form class="space-y-4" @submit.prevent="onSubmit">
        <div class="space-y-1.5">
          <Label for="expression-pack-title">{{ t("expression_settings_pack_title_label") }}</Label>
          <Input id="expression-pack-title" v-model="title" maxlength="64" autocomplete="off" />
          <p v-if="titleError" class="text-xs text-destructive">{{ t(titleError) }}</p>
        </div>
        <div class="space-y-1.5">
          <Label for="expression-pack-slug">{{ t("expression_settings_pack_slug_label") }}</Label>
          <Input
            id="expression-pack-slug"
            :model-value="slug"
            maxlength="64"
            autocomplete="off"
            spellcheck="false"
            @update:model-value="onSlugInput"
          />
          <p class="text-xs" :class="slugError ? 'text-destructive' : 'text-muted-foreground'">
            {{ t(slugError ?? "expression_settings_pack_slug_hint") }}
          </p>
        </div>
        <p v-if="serverError" class="text-sm text-destructive">{{ t(serverError) }}</p>
        <DialogFooter>
          <Button type="button" variant="ghost" @click="emit('update:open', false)">{{ t("expression_settings_cancel") }}</Button>
          <Button type="submit" :disabled="!valid || busy">
            <LoaderIcon v-if="busy" class="w-4 h-4 mr-1.5 animate-spin" />
            {{ t(mode === "create" ? "expression_settings_create" : "expression_settings_save") }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>
