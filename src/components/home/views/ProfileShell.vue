<template>
    <div class="flex flex-col h-full" v-if="profile">
        <div class="w-full flex justify-center">
            <div class="w-full max-w-4xl">
                <ProfileBanner :banner-id="profile.bannerFileID" :user-id="profile.userId" />

                <div
                    class="relative flex items-end gap-4 px-6 py-4 -mt-12 rounded-xl backdrop-blur-md bg-background/50 shadow-md">
                    <ProfileAvatar :user-id="profile.userId" />

                    <div class="pb-2">
                        <h1 class="text-xl font-semibold leading-tight">
                            {{ me.me?.displayName }}
                        </h1>
                        <div class="flex items-center gap-2 text-muted-foreground">
                            <span>@{{ me.me?.username }}</span>
                            <ProfileBadges :badges="profile.badges" />
                        </div>


                    </div>

                    <div class="ml-auto" v-if="false">
                        <n-statistic label="Profile Views" tabular-nums>
                            <n-number-animation show-separator :from="0" :to="1832"
                                :active="true" />
                        </n-statistic>
                    </div>
                </div>

                <div class="mt-6 grid grid-cols-1 md:grid-cols-3 gap-6">
                    <div class="md:col-span-2 space-y-4 min-h-full">
                        <div class="rounded-xl shadow">
                            <h2
                                class="flex items-center gap-2 text-lg font-semibold mb-4 shell-item h-auto text-start p-4">
                                <IconRss class="w-5 h-5 text-primary" />
                                <span>Activity</span>
                            </h2>
                            <p class="text-muted-foreground text-xs p-4 shell-item">No any activity...</p>
                        </div> 
                    </div>

                    <div class="space-y-4 shell-item">
                        <div class="p-4 rounded-xl shadow">
                            <h2 class="flex items-center gap-2 text-lg font-semibold h-auto text-start mb-4 ">
                                <IconClipboardFilled />
                                Bio
                            </h2>
                            <p class="text-muted-foreground">
                                {{ profile.bio || "" }}
                            </p>
                        </div>

                        <!--<div class="p-4 rounded-xl bg-background shadow">
                            <h2 class="text-lg font-semibold mb-2">Socials</h2>
                            <ul class="space-y-2 text-sm">
                                <li><a href="https://twitter.com/" class="text-primary hover:underline">Twitter</a></li>
                                <li><a href="https://github.com/" class="text-primary hover:underline">GitHub</a></li>
                                <li><a href="https://t.me/" class="text-primary hover:underline">Telegram</a></li>
                            </ul>
                        </div>-->
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
import { IconRss, IconClipboardFilled } from "@tabler/icons-vue"
import { NStatistic, NNumberAnimation } from "naive-ui";

const { t } = useLocale();
const api = useApi();
const profile = ref(null as null | ArgonUserProfile);
const me = useMe();

onMounted(async () => {
    profile.value = await api.userInteraction.GetMyProfile();
})


</script>
<style lang="css" scoped>
.shell-item {
    background-color: #161616f5;
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}
</style>