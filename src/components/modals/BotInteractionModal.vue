<template>
  <Dialog :open="!!botInteraction.activeModal" @update:open="onOpenChange">
    <DialogContent class="sm:max-w-[520px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-6">
      <DialogHeader>
        <DialogTitle>{{ modal?.title }}</DialogTitle>
      </DialogHeader>

      <form @submit.prevent="handleSubmit" class="space-y-4 py-2">
        <template v-for="comp in (modal?.components ?? [])" :key="comp.customId">
          <!-- TextInput -->
          <div v-if="comp.type === IonModalComponentType.TextInput" class="space-y-1.5">
            <Label>
              {{ comp.label }}
              <span v-if="comp.required" class="text-destructive">*</span>
            </Label>
            <p v-if="comp.description" class="text-xs text-muted-foreground">{{ comp.description }}</p>
            <Textarea
              v-if="comp.style === IonTextInputStyle.Paragraph"
              v-model="formValues[comp.customId]"
              :placeholder="comp.placeholder ?? ''"
              :minlength="comp.minLength ?? undefined"
              :maxlength="comp.maxLength ?? undefined"
              :required="comp.required ?? false"
              class="min-h-[80px]"
            />
            <Input
              v-else
              v-model="formValues[comp.customId]"
              :placeholder="comp.placeholder ?? ''"
              :minlength="comp.minLength ?? undefined"
              :maxlength="comp.maxLength ?? undefined"
              :required="comp.required ?? false"
            />
          </div>

          <!-- StringSelect -->
          <div v-else-if="comp.type === IonModalComponentType.StringSelect" class="space-y-1.5">
            <Label>
              {{ comp.label }}
              <span v-if="comp.required" class="text-destructive">*</span>
            </Label>
            <p v-if="comp.description" class="text-xs text-muted-foreground">{{ comp.description }}</p>
            <Select
              :model-value="formValues[comp.customId]"
              @update:model-value="(val: string) => formValues[comp.customId] = val"
            >
              <SelectTrigger>
                <SelectValue :placeholder="comp.placeholder || 'Select...'" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem
                  v-for="opt in (comp.options?.options ?? [])"
                  :key="opt.value"
                  :value="opt.value"
                >
                  <div class="flex flex-col">
                    <span>{{ opt.label }}</span>
                    <span v-if="opt.description" class="text-xs text-muted-foreground">
                      {{ opt.description }}
                    </span>
                  </div>
                </SelectItem>
              </SelectContent>
            </Select>
          </div>

          <!-- Checkbox -->
          <div v-else-if="comp.type === IonModalComponentType.Checkbox" class="flex items-center gap-2">
            <Checkbox
              :id="comp.customId"
              :checked="formValues[comp.customId] === 'true'"
              @update:checked="(val: boolean) => formValues[comp.customId] = val ? 'true' : 'false'"
            />
            <Label :for="comp.customId" class="cursor-pointer">
              {{ comp.label }}
              <span v-if="comp.required" class="text-destructive">*</span>
            </Label>
            <p v-if="comp.description" class="text-xs text-muted-foreground ml-1">{{ comp.description }}</p>
          </div>

          <!-- Fallback for unsupported types (UserSelect, ArchetypeSelect, ChannelSelect) -->
          <div v-else class="space-y-1.5">
            <Label>
              {{ comp.label }}
              <span v-if="comp.required" class="text-destructive">*</span>
            </Label>
            <p v-if="comp.description" class="text-xs text-muted-foreground">{{ comp.description }}</p>
            <Input
              v-model="formValues[comp.customId]"
              :placeholder="comp.placeholder ?? ''"
            />
          </div>
        </template>

        <DialogFooter class="flex justify-end gap-2 pt-2">
          <Button variant="ghost" type="button" @click="botInteraction.closeModal()">
            {{ t('cancel') || 'Cancel' }}
          </Button>
          <Button type="submit" :disabled="isSubmitting">
            <Loader2Icon v-if="isSubmitting" class="w-4 h-4 mr-2 animate-spin" />
            {{ t('submit') || 'Submit' }}
          </Button>
        </DialogFooter>
      </form>
    </DialogContent>
  </Dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed } from "vue";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@argon/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@argon/ui/select";
import { Button } from "@argon/ui/button";
import { Input } from "@argon/ui/input";
import { Textarea } from "@argon/ui/textarea";
import { Label } from "@argon/ui/label";
import { Checkbox } from "@argon/ui/checkbox";
import { Loader2Icon } from "lucide-vue-next";
import { useBotInteraction } from "@/composables/useBotInteraction";
import { useLocale } from "@/store/system/localeStore";
import { IonModalComponentType, IonTextInputStyle, type ModalSubmitValue } from "@argon/glue";

const { t } = useLocale();
const botInteraction = useBotInteraction();

const formValues = reactive<Record<string, string>>({});
const isSubmitting = ref(false);

const modal = computed(() => botInteraction.activeModal?.modal ?? null);

// Reset form when modal changes
watch(() => botInteraction.activeModal, (newModal) => {
  Object.keys(formValues).forEach((k) => delete formValues[k]);
  if (newModal?.modal?.components) {
    for (const comp of newModal.modal.components) {
      if (comp.value != null) {
        formValues[comp.customId] = comp.value;
      } else if (comp.type === IonModalComponentType.Checkbox) {
        formValues[comp.customId] = (comp.defaultChecked ?? false) ? "true" : "false";
      } else {
        formValues[comp.customId] = "";
      }
    }
  }
});

function onOpenChange(open: boolean) {
  if (!open) {
    botInteraction.closeModal();
  }
}

async function handleSubmit() {
  if (!botInteraction.activeModal || isSubmitting.value) return;

  const { interactionId, spaceId, channelId } = botInteraction.activeModal;

  const values: ModalSubmitValue[] = Object.entries(formValues).map(
    ([customId, value]) => ({ customId, value } as any),
  );

  isSubmitting.value = true;
  try {
    await botInteraction.submitModal(spaceId, channelId, interactionId, values);
  } finally {
    isSubmitting.value = false;
  }
}
</script>
