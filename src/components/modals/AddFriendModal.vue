<template>
    <Dialog v-model:open="open">
        <DialogContent
            class="sm:max-w-[520px] rounded-2xl border bg-card/95 backdrop-blur-2xl p-8 space-y-8">

            <div class="absolute inset-0 bg-gradient-to-t 
                        from-primary/5 via-transparent to-primary/5 
                        pointer-events-none"></div>

            <div class="relative text-center space-y-2">
                <h2 class="text-3xl font-extrabold text-foreground tracking-wide">
                    {{ t('add_friend') }}
                </h2>
                <p class="text-muted-foreground text-sm">
                    {{ t('add_friend_description') }}
                </p>
            </div>

            <div class="relative space-y-3">

                <InputWithError v-model="username" :placeholder="t('username_placeholder')" :error="errorMessage" 
                    :success="successMessage" @clear-error="clearStatus">
                    <template #label>
                        <Label class="text-muted-foreground flex items-center gap-2">
                            <span class="i-lucide-user-plus text-primary"></span>
                            {{ t('username') }}
                        </Label>
                    </template>
                </InputWithError>

                <Button @click="submit" :disabled="isLoading"
                    class="w-full font-semibold rounded-xl transition-all">
                    <span v-if="isLoading" class="animate-spin i-lucide-loader-2 mr-2"></span>
                    <span v-else class="i-lucide-send mr-2"></span>
                    {{ t('send_request') }}
                </Button>
            </div>
            <DialogFooter class="relative flex justify-center pt-2">
                <Button variant="ghost" @click="open = false">
                    {{ t('close') }}
                </Button>
            </DialogFooter>

        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { ref } from "vue";
import { Dialog, DialogContent, DialogFooter } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";
import { Label } from "@argon/ui/label";
import InputWithError from "@/components/shared/InputWithError.vue";

import { useLocale } from "@/store/localeStore";
import { useApi } from "@/store/apiStore";
import { SendFriendStatus } from "@argon/glue";

const { t } = useLocale();
const api = useApi();
const client = api.freindsInteraction;

const open = defineModel<boolean>('open', { type: Boolean, default: false });

const username = ref("");
const errorMessage = ref("");
const successMessage = ref("");
const isLoading = ref(false);

const emit = defineEmits<{
    (e: "added"): void;
}>();

const statusMap: Record<string, string> = {
    SuccessSent: "request_sent",
    AutoAccepted: "auto_accepted",
    AlreadyFriends: "already_friends",
    AlreadySent: "already_sent",
    Blocked: "blocked",
    CannotFriendYourself: "cannot_self",
    TargetNotFound: "user_not_found",
    FailedSent: "failed_sent",
};

function clearStatus() {
    errorMessage.value = ''
    successMessage.value = '';
}

async function submit() {
    clearStatus();
    const name = username.value.trim();
    if (!name) {
        errorMessage.value = t("empty_username") ?? "Enter username";
        return;
    }

    try {
        isLoading.value = true;

        const result = await client.SendFriendRequest(name);
        const key = statusMap[SendFriendStatus[result]] ?? "failed_sent";
        if (result === SendFriendStatus.SuccessSent || result === SendFriendStatus.AutoAccepted) {
            emit("added");
            successMessage.value = t(key);
        } else {
            errorMessage.value = t(key);
        }

    } finally {
        isLoading.value = false;
    }
}
</script>
