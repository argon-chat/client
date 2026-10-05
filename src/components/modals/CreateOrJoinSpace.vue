<template>
    <Dialog v-model:open="open">
        <DialogContent described
            class="sm:max-w-[520px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-8">

            <div
                class="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-primary/5 pointer-events-none">
            </div>

            <div class="relative text-center space-y-8 p-4">
                <DialogTitle as="h2" class="text-3xl font-extrabold text-foreground tracking-wide leading-9">
                    {{ t('join_or_create_server') }}
                </DialogTitle>
                <DialogDescription class="text-muted-foreground text-sm">
                    {{t("choose_your_path")}}
                </DialogDescription>
            </div>

            <div class="relative space-y-8">

                <InputWithError v-model="spaceName" placeholder="e.g., Cool Space" :error="createError"
                    :maxlength="MAX_SPACE_NAME_LENGTH" @clear-error="createError = ''">
                    <template #label>
                        <Label for="space-name" class="text-muted-foreground flex items-center gap-2">
                            <span class="i-lucide-plus-circle text-primary"></span>
                            {{ t('name') }}
                        </Label>
                    </template>
                </InputWithError>
                <Button @click="createServerCmd" :disabled="createLoading"
                    class="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all">
                    <span v-if="createLoading" class="animate-spin i-lucide-loader-2 mr-2"></span>
                    <span v-else class="i-lucide-rocket mr-2"></span>
                    {{ t('create_new_server') }}
                </Button>
            </div>
 
            <div class="relative flex items-center gap-2 text-muted-foreground">
                <div class="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent"></div>
                <span class="text-xs uppercase tracking-widest">{{ t('or') }}</span>
                <div class="flex-1 h-px bg-gradient-to-r from-transparent via-border to-transparent"></div>
            </div>

            <div class="relative space-y-8">

                <InputWithError id="invite-code" v-model="inviteCode" placeholder="e.g., XDq2-17jS-KJj2" :error="joinError"
                    @clear-error="joinError = ''">
                    <template #label>
                        <Label for="invite-code" class="text-muted-foreground flex items-center gap-2">
                            <span class="i-lucide-link-2 text-primary"></span>
                            {{ t('invite_code') }}
                        </Label>
                    </template>
                </InputWithError>
                <br/>

                <Button @click="join(inviteCode)" :disabled="isLoading"
                    class="w-full bg-purple-600 hover:bg-purple-500 text-white font-semibold rounded-xl transition-all">
                    <span v-if="isLoading" class="animate-spin i-lucide-loader-2 mr-2"></span>
                    <span v-else class="i-lucide-log-in mr-2"></span>
                    {{ t('join_to_server') }}
                </Button>
            </div>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@argon/ui/dialog'
import { Button } from '@argon/ui/button'
import { Label } from '@argon/ui/label'
import { ref } from 'vue'
import { useLocale } from '@/store/system/localeStore'
import { useApi } from '@/store/system/apiStore'
import { CreateSpaceError } from '@argon/glue'
import InputWithError from '../shared/InputWithError.vue'
import { logger } from '@argon/core'
import { usePoolStore } from '@/store/data/poolStore'
import { useWindow } from '@/store/ui/windowStore'

const { t } = useLocale()

const isLoading = ref(false)
const createLoading = ref(false)
const createError = ref<string>('')
const joinError = ref('');
const poolStore = usePoolStore();
const windows = useWindow();

const inviteCode = ref("")
const spaceName = ref("")
const api = useApi()

/** The server's limit (SpaceGrain.MaxSpaceNameLength); the box stops at it so the refusal is never reached by typing. */
const MAX_SPACE_NAME_LENGTH = 64

const emit = defineEmits<{ (e: 'join', name: string): void }>()

async function createServerCmd() {
    createError.value = ''
    const name = spaceName.value.trim()
    if (!name) {
        createError.value = t('space_error_name_empty')
        return
    }
    if (name.length > MAX_SPACE_NAME_LENGTH) {
        createError.value = errorText(CreateSpaceError.NAME_TOO_LONG)
        return
    }

    try {
        createLoading.value = true
        const res = await api.userInteraction.CreateSpace({ name, description: "", avatarFieldId: "" });

        if (res.isFailedCreateSpace()) {
            logger.error("failed to create space, error: ", res.error);
            createError.value = errorText(res.error);
            return
        }

        spaceName.value = ''
        open.value = false

        await poolStore.refershDatas()
    } catch (e) {
        logger.error("failed to create space", e);
        createError.value = t('space_error_unknown')
    } finally {
        createLoading.value = false
    }
}

function errorText(error: CreateSpaceError): string {
    switch (error) {
        case CreateSpaceError.LIMIT_REACHED:
            return t('space_error_limit_reached')
        case CreateSpaceError.NAME_EMPTY:
            return t('space_error_name_empty')
        case CreateSpaceError.NAME_TOO_LONG:
            return t('space_error_name_too_long', { max: MAX_SPACE_NAME_LENGTH })
        case CreateSpaceError.DESCRIPTION_TOO_LONG:
            return t('space_error_description_too_long')
        default:
            return t('space_error_unknown')
    }
}


const join = (_code: string) => {
    if (!inviteCode.value.trim()) {
        joinError.value = "Please enter a valid invite code.";
        return;
    }
    // Show the invite preview first; the user confirms the join from there.
    windows.openInvitePreview(inviteCode.value.trim());
    inviteCode.value = "";
    open.value = false;
}

const open = defineModel<boolean>('open', { type: Boolean, default: false })
</script>
