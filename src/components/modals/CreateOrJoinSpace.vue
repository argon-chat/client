<template>
    <Dialog v-model:open="open">
        <DialogContent
            class="sm:max-w-[520px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-8">

            <div
                class="absolute inset-0 bg-gradient-to-t from-primary/5 via-transparent to-primary/5 pointer-events-none">
            </div>

            <div class="relative text-center space-y-8 p-4">
                <h2 class="text-3xl font-extrabold text-foreground tracking-wide">
                    {{ t('join_or_create_server') }}
                </h2>
                <p class="text-muted-foreground text-sm">
                    {{t("choose_your_path")}}
                </p>
            </div>

            <div class="relative space-y-8">

                <InputWithError v-model="spaceName" placeholder="e.g., Cool Space" :error="createError"
                    @clear-error="createError = ''">
                    <template #label>
                        <Label for="space-name" class="text-muted-foreground flex items-center gap-2">
                            <span class="i-lucide-plus-circle text-primary"></span>
                            {{ t('name') }}
                        </Label>
                    </template>
                </InputWithError>
                <Button @click="createServerCmd"
                    class="w-full bg-blue-600 hover:bg-blue-500 text-white font-semibold rounded-xl transition-all">
                    <span class="i-lucide-rocket mr-2"></span>
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
import { Dialog, DialogContent } from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Input } from '@/components/ui/input'
import { ref } from 'vue'
import { useLocale } from '@/store/localeStore'
import { useApi } from '@/store/apiStore'
import { ReloadIcon, ExclamationTriangleIcon } from '@radix-icons/vue'
import { CreateSpaceError } from '@/lib/glue/argonChat'
import InputWithError from '../shared/InputWithError.vue'
import { logger } from '@/lib/logger'
import { DeferFlag } from '@/lib/DeferFlag'
import { useSpaceStore } from '@/store/serverStore'
import { usePoolStore } from '@/store/poolStore'

const { t } = useLocale()

const isLoading = ref(false)
const createLoading = ref(false)
const createError = ref<string>('')
const joinError = ref('');
const spaceStore = useSpaceStore();
const poolStore = usePoolStore();

const inviteCode = ref("")
const spaceName = ref("")
const api = useApi()

const emit = defineEmits<{ (e: 'join', name: string): void }>()

async function createServerCmd() {
    createError.value = ''
    if (!spaceName.value?.trim()) {
        createError.value = t?.('space_name_required') ?? 'Please enter a name.'
        return
    }

    try {
        createLoading.value = true
        const res = await api.userInteraction.CreateSpace({ name: spaceName.value.trim(), description: "", avatarFieldId: "" });

        if (res.isFailedCreateSpace()) {
            logger.error("failed to create space, error: ", res.error);
            createError.value = humanizeError(res.error);
            return
        }

        spaceName.value = ''
        open.value = false
    } catch (e: any) {
        createError.value = humanizeError(e)
    } finally {
        createLoading.value = false
    }
}

function humanizeError(err: CreateSpaceError): string {
    if (err === CreateSpaceError.LIMIT_REACHED)
        return "Limit reached";
    return "Unknown error";
}


const join = async (code: string) => {
    const e = new DeferFlag(isLoading);
    try {
        if (!inviteCode.value.trim()) {
            joinError.value = "Please enter a valid invite code.";
            return;
        }
        logger.log(`Joined server with invite code: ${inviteCode.value}`);
        const result = await spaceStore.joinToServer(inviteCode.value.trim());

        if (result) {
            joinError.value = result;
            return;
        }
        inviteCode.value = "";
        open.value = false;

        poolStore.refershDatas();
        
    } finally {
        e[Symbol.dispose]();
    }
}

const open = defineModel<boolean>('open', { type: Boolean, default: false })
</script>
