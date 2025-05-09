<template>
    <div class="connected-devices text-white rounded-lg space-y-6">
        <h2 class="text-2xl font-bold">{{ t("account_socials") }}</h2>

        <div class="flex flex-row items-center justify-between rounded-lg border p-4" v-for="i in allSocials"
            :key="i.code">
            <div class="space-y-0.5">
                <div class="text-base">
                    {{ i.key }} 
                </div>
            </div>
            <div class="space-y-0.5">
                <TelegramWidget v-if="i.key == 'Telegram' && socials.find(q => q.Kind == 'Telegram')" :data="socials.find(q => q.Kind == 'Telegram')!" @deleted="onSocialDeleted"/>
                <Button v-else @click="beginLinkTelegram">
                    {{ t("link_soc_") }} {{ i.code }}
                </Button>
            </div>
        </div>
    </div>
</template>

<script setup lang="ts">
import { useApi } from '@/store/apiStore';
import { useLocale } from '@/store/localeStore';
import { onMounted, onUnmounted, ref } from 'vue';
import TelegramWidget from './socials/TelegramWidget.vue';
import { Button } from '@/components/ui/button';
import { PhTelegramLogo } from "@phosphor-icons/vue";
import { logger } from '@/lib/logger';
import { useMe } from '@/store/meStore';
import basex from 'base-x';
const { t } = useLocale();
const api = useApi();
const me = useMe();
const socials = ref([] as IUserSocialIntegrationDto[]);
const brd = basex("123qpxcvd");
const rrd = {
    encode: (e: string) => brd.encode(new TextEncoder().encode(e)),
    decode: (e: string) => new TextDecoder().decode(brd.decode(e))
};

const generateLinkUrl = async (): Promise<string> => {
    const avatar = `${me.me?.Id.replaceAll('-', '')}/${me.me?.AvatarFileId}`;
    return `https://link.argon.gl/?aac=${await api.userInteraction.CreateSocialBoundAsync("Telegram")}&aav=${rrd.encode(avatar)}`;
}
function windowFeatures(width = 600, height = 400) {
  const dualScreenLeft = window.screenLeft ?? window.screenX;
  const dualScreenTop = window.screenTop ?? window.screenY;

  const screenWidth = window.innerWidth ?? document.documentElement.clientWidth;
  const screenHeight = window.innerHeight ?? document.documentElement.clientHeight;

  const left = dualScreenLeft + (screenWidth - width) / 2;
  const top = dualScreenTop + (screenHeight - height) / 2;

  return `width=${width},height=${height},top=${top},left=${left},scrollbars=off,resizable=off`;
}
const beginLinkTelegram = async () => {
    if (argon.isArgonHost) {
        await native.openUrl(await generateLinkUrl());
    } else {
        const p = window.open(
            "about:blank",
            "popupWindow",
            windowFeatures(1000, 800)
        );

        const url = await generateLinkUrl();

        if (!p) {
            logger.error("cannot open popup");
            return;
        }

        p.location.href = url;
    }
}

let timer = 0 as number;

onMounted(async () => {
    socials.value = await api.userInteraction.GetMeSocials();
    timer = setInterval(async () => {
        await onSocialDeleted("");
    }, 10000) as any;
});

onUnmounted(() => {
    clearInterval(timer);
})

const onSocialDeleted = async (e: Guid) => {
    socials.value = await api.userInteraction.GetMeSocials();
}

const allSocials = [
    { key: "Telegram", code: "Telegram", icon: PhTelegramLogo, color: "blue" },
]
</script>

<style lang="css"></style>
