<template>
    <Dialog v-model:open="open">
        <DialogContent class="sm:max-w-[525px]">
            <div class="grid gap-4 py-4">
                <div
                    class="modal-content p-6 text-white rounded-lg shadow-lg max-w-lg w-full space-y-6 rounded-md grid w-full gap-2 z-[50]">
                    <h2 class="text-2xl font-bold text-center">{{ t('join_or_create_server') }}</h2>
                    <Button @click="emit('create', 'test-server')" :disabled="true">
                        {{ t('create_new_server') }}
                    </Button>
                    <div class="divider text-gray-400 text-center"> {{ t('or') }} </div>
                    <div class="grid w-full gap-2">
                        <Label for="invite-code">{{ t('invite_code') }}</Label>
                        <Input id="invite-code" v-model="inviteCode" placeholder="e.g., XDq2-17jS-KJj2" />
                        <br />
                        <Button @click="emit('join', inviteCode)" :disabled="isLoading">
                            {{ t('join_to_server') }}
                        </Button>
                    </div>
                </div>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ref } from 'vue';
import { useLocale } from '@/store/localeStore';

const { t } = useLocale();

const isLoading = ref(false);
const inviteCode = ref("");

const emit = defineEmits<{
    (e: 'create', name: string): void
    (e: 'join', name: string): void
}>()


const open = defineModel<boolean>('open', {
    type: Boolean, default: false
})
</script>