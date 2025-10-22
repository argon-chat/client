<template>
    <Dialog v-model:open="open">
        <DialogContent class="max-w-[500px]">
            <DialogHeader>
                <DialogTitle>Premium required</DialogTitle>
            </DialogHeader>
            <p class="text-gray-300 mb-4">
                Animated avatars (GIF / WebM) are available only for Premium users.
            </p>
            <DialogFooter>
                <Button @click="buyPremium">Upgrade to Premium</Button>
                <Button variant="secondary" @click="open = false">Cancel</Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>


</template>
<script setup lang="ts">
import { ref } from 'vue';
import { useToast } from '../ui/toast';
import DialogContent from '../ui/dialog/DialogContent.vue';
import DialogHeader from '../ui/dialog/DialogHeader.vue';
import DialogTitle from '../ui/dialog/DialogTitle.vue';
import DialogFooter from '../ui/dialog/DialogFooter.vue';
import Dialog from '../ui/dialog/Dialog.vue';
import Button from '../ui/button/Button.vue';


const open = defineModel<boolean>('open', { type: Boolean, default: false })

const toast = useToast();

function buyPremium() {
    open.value = false;
    /*toast.toast({
        title: "Redirecting...",
        description: "Opening premium purchase page...",
    });
    window.open("/premium", "_blank");*/
}
</script>