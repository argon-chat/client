<template>
    <Dialog v-model:open="open" id="ussd-modal">
        <DialogContent
            class="rounded-2xl border border-white/10 bg-black/70 backdrop-blur-xl p-6 space-y-4 text-center ussd-modal"
            style="">
            <h2 class="text-2xl font-bold text-white">Dialing</h2>

            <p v-if="loading" class="text-gray-300 text-lg">
                Executing the USSD command…
            </p>

            <div v-else class="text-gray-200 text-lg whitespace-pre-line">
                <div v-html="result"></div>
            </div>

            <Button class="bg-blue-600 hover:bg-blue-500 text-white w-full rounded-xl" @click="open = false">
                OK
            </Button>
        </DialogContent>
    </Dialog>
</template>

<script setup lang="ts">
import { Dialog, DialogContent } from "@argon/ui/dialog";
import { Button } from "@argon/ui/button";

const open = defineModel<boolean>("open", { default: false });
const loading = defineModel<boolean>("loading", { default: false });
const result = defineModel<string>("result", { default: "" });
</script>
<style lang="css">
.ussd-modal {
    max-width: max-content !important;
    min-width: 30rem;
}
</style>