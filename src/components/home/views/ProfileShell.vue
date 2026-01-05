<template>
    <div v-bind="$attrs" class="flex flex-col h-full" v-if="profile">
        <div class="w-full flex justify-center">
            <div class="w-full max-w-4xl">
                <ProfileBanner :banner-id="profile.bannerFileID" :user-id="profile.userId" />

                <div
                    class="relative flex items-end gap-4 px-6 py-4 -mt-12 rounded-xl backdrop-blur-md bg-background/50 shadow-lg border border-border/50">
                    <ProfileAvatar :user-id="profile.userId" />

                    <div class="pb-2 flex-1">
                        <div class="flex items-center gap-3 mb-1">
                            <h1 class="text-2xl font-bold leading-tight">
                                {{ me.me?.displayName }}
                            </h1>
                            <div class="flex items-center gap-1.5 text-xs text-muted-foreground bg-muted px-2 py-1 rounded-full">
                                <div class="w-2 h-2 rounded-full bg-green-500 animate-pulse"></div>
                                <span>{{ t('online') }}</span>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 text-sm text-muted-foreground mb-2">
                            <span class="font-medium">@{{ me.me?.username }}</span>
                            <span class="text-xs">•</span>
                            <span class="text-xs">{{ t('member_since') }} {{ new Date().toLocaleDateString() }}</span>
                        </div>
                        <ProfileBadges :badges="profile.badges" />
                    </div>

                    <div class="ml-auto flex flex-col gap-2">
                        <button class="px-4 py-2 bg-primary text-primary-foreground rounded-lg hover:bg-primary/90 transition-all flex items-center gap-2 shadow-md hover:shadow-lg hover:scale-105">
                            <IconEdit class="w-4 h-4" />
                            {{ t('edit_profile') }}
                        </button>
                        <button class="px-4 py-2 bg-secondary text-secondary-foreground rounded-lg hover:bg-secondary/80 transition-all flex items-center gap-2">
                            <IconShare class="w-4 h-4" />
                            {{ t('share') }}
                        </button>
                    </div>
                </div>

                <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-2 space-y-4 min-h-full">
                        <div class="shell-item p-6 hover:shadow-xl transition-shadow">
                            <h2 class="flex items-center gap-2 text-lg font-semibold mb-4">
                                <div class="p-2 rounded-lg bg-primary/10">
                                    <IconRss class="w-5 h-5 text-primary" />
                                </div>
                                <span>{{ t("activity") }}</span>
                            </h2>
                            <div class="flex flex-col items-center justify-center py-12 text-center">
                                <div class="mb-4 p-4 rounded-full bg-muted/50">
                                    <IconMoodEmpty class="w-12 h-12 text-muted-foreground/50" />
                                </div>
                                <p class="text-muted-foreground text-sm mb-2">{{t("no_activity")}}</p>
                                <p class="text-xs text-muted-foreground/70">{{ t('activity_description') }}</p>
                            </div>
                        </div> 
                    </div>

                    <div class="space-y-4">
                        <div class="shell-item p-5 hover:shadow-xl transition-shadow">
                            <h2 class="flex items-center gap-2 text-lg font-semibold mb-4">
                                <div class="p-2 rounded-lg bg-primary/10">
                                    <IconClipboardFilled class="w-5 h-5 text-primary" />
                                </div>
                                {{t("bio")}}
                            </h2>
                            <p class="text-sm text-muted-foreground leading-relaxed" v-if="profile.bio">
                                {{ profile.bio }}
                            </p>
                            <p class="text-sm text-muted-foreground/50 italic" v-else>
                                {{ t('no_bio') }}
                            </p>
                        </div>

                        <div class="shell-item p-5 hover:shadow-xl transition-shadow">
                            <h2 class="flex items-center gap-2 text-lg font-semibold mb-4">
                                <div class="p-2 rounded-lg bg-primary/10">
                                    <IconChartBar class="w-5 h-5 text-primary" />
                                </div>
                                {{ t('stats') }}
                            </h2>
                            <div class="space-y-4">
                                <div class="flex justify-between items-center p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                                    <div class="flex items-center gap-2">
                                        <IconUsers class="w-4 h-4 text-muted-foreground" />
                                        <span class="text-sm text-muted-foreground">{{ t('friends') }}</span>
                                    </div>
                                    <span class="font-semibold">0</span>
                                </div>
                                <div class="flex justify-between items-center p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                                    <div class="flex items-center gap-2">
                                        <IconServer class="w-4 h-4 text-muted-foreground" />
                                        <span class="text-sm text-muted-foreground">{{ t('servers') }}</span>
                                    </div>
                                    <span class="font-semibold">0</span>
                                </div>
                                <div class="flex justify-between items-center p-3 rounded-lg bg-muted/30 hover:bg-muted/50 transition-colors">
                                    <div class="flex items-center gap-2">
                                        <IconMessage class="w-4 h-4 text-muted-foreground" />
                                        <span class="text-sm text-muted-foreground">{{ t('messages') }}</span>
                                    </div>
                                    <span class="font-semibold">0</span>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>
</template>
<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { onMounted, ref } from 'vue';
import { useApi } from '@/store/apiStore';
import { ArgonUserProfile } from '@/lib/glue/argonChat';
import { useMe } from '@/store/meStore';
import ProfileBanner from './ProfileBanner.vue';
import ProfileAvatar from './ProfileAvatar.vue';
import ProfileBadges from './ProfileBadges.vue';
import { IconRss, IconClipboardFilled, IconEdit, IconShare, IconMoodEmpty, IconChartBar, IconUsers, IconServer, IconMessage } from "@tabler/icons-vue"

const { t } = useLocale();
const api = useApi();
const profile = ref(null as null | ArgonUserProfile);
const me = useMe();

defineOptions({ inheritAttrs: false })

onMounted(async () => {
    profile.value = await api.userInteraction.GetMyProfile();
})


</script>
<style lang="css" scoped>
.shell-item {
    background-color: hsl(var(--card));
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    border: 1px solid hsl(var(--border) / 0.5);
    transition: all 0.3s ease;
}

.shell-item:hover {
    transform: translateY(-2px);
}

@keyframes pulse {
    0%, 100% {
        opacity: 1;
    }
    50% {
        opacity: 0.5;
    }
}

.animate-pulse {
    animation: pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
}
</style>