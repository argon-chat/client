<template>
    <Dialog v-model:open="open">
        <DialogContent class="max-w-[500px]">
            <DialogHeader>
                <DialogTitle>{{ t('ultima_premium_required') }}</DialogTitle>
            </DialogHeader>
            <p class="text-gray-300 mb-4">
                {{ t('ultima_premium_required_desc') }}
            </p>

            <div v-if="ultima.pricing" class="grid grid-cols-2 gap-3 mb-4">
                <div
                    class="p-3 rounded-lg border border-border hover:border-violet-500/50 cursor-pointer transition-colors text-center"
                    :class="{ 'border-violet-500 bg-violet-500/5': selectedPlan === UltimaPlan.Monthly }"
                    @click="selectedPlan = UltimaPlan.Monthly"
                >
                    <p class="font-semibold text-sm">{{ t('ultima_monthly') }}</p>
                    <p class="text-lg font-bold">{{ ultima.pricing.subscriptionMonthly.amount }}</p>
                    <p class="text-xs text-muted-foreground">{{ ultima.pricing.subscriptionMonthly.currency }}/mo</p>
                </div>
                <div
                    class="p-3 rounded-lg border border-border hover:border-violet-500/50 cursor-pointer transition-colors text-center"
                    :class="{ 'border-violet-500 bg-violet-500/5': selectedPlan === UltimaPlan.Annual }"
                    @click="selectedPlan = UltimaPlan.Annual"
                >
                    <p class="font-semibold text-sm">{{ t('ultima_annual') }}</p>
                    <p class="text-lg font-bold">{{ ultima.pricing.subscriptionAnnual.amount }}</p>
                    <p class="text-xs text-muted-foreground">{{ ultima.pricing.subscriptionAnnual.currency }}/yr</p>
                </div>
            </div>

            <DialogFooter>
                <Button variant="secondary" @click="open = false">{{ t('cancel') }}</Button>
                <Button class="bg-violet-600 hover:bg-violet-700" @click="handleSubscribe" :disabled="loading">
                    <Loader2 v-if="loading" class="w-4 h-4 animate-spin mr-2" />
                    {{ t('ultima_upgrade') }}
                </Button>
            </DialogFooter>
        </DialogContent>
    </Dialog>

    <UltimaCheckoutDialog v-model:open="checkoutOpen" :checkout-url="checkoutUrl" :country-code="checkoutCountry" @completed="onCompleted" />
</template>

<script setup lang="ts">
import { ref } from 'vue';
import { useToast } from '@argon/ui/toast';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@argon/ui/dialog';
import { Button } from '@argon/ui/button';
import { Loader2 } from 'lucide-vue-next';
import { useUltimaStore } from '@/store/data/ultimaStore';
import { UltimaPlan, CheckoutError } from '@argon/glue';
import UltimaCheckoutDialog from './UltimaCheckoutDialog.vue';
import { useLocale } from '@/store/system/localeStore';

const open = defineModel<boolean>('open', { type: Boolean, default: false });
const { t } = useLocale();
const ultima = useUltimaStore();
const { toast } = useToast();

const selectedPlan = ref(UltimaPlan.Annual);
const loading = ref(false);
const checkoutOpen = ref(false);
const checkoutUrl = ref('');
const checkoutCountry = ref('');

async function handleSubscribe() {
    loading.value = true;
    try {
        const result = await ultima.createCheckout(selectedPlan.value);
        if (result.success) {
            checkoutUrl.value = result.checkoutUrl;
            checkoutCountry.value = result.countryCode;
            checkoutOpen.value = true;
            open.value = false;
        } else {
            const msg = result.error === CheckoutError.ALREADY_SUBSCRIBED
                ? t('ultima_err_already_subscribed')
                : result.error === CheckoutError.REGION_UNAVAILABLE
                    ? t('ultima_err_region')
                    : t('ultima_err_payment');
            toast({ title: t('ultima_checkout_failed'), description: msg, variant: 'destructive' });
        }
    } finally {
        loading.value = false;
    }
}

function onCompleted() {
    checkoutOpen.value = false;
    ultima.fetchSubscription();
    toast({ title: t('ultima_welcome') });
}
</script>