<template>
    <div class="user-list-container rounded-xl p-4 shadow-md w-56 overflow-y-auto scrollbar-thin scrollbar-hide scrollbar-thumb-gray-600 scrollbar-track-gray-800"
        style="background-color: #161616;
    border-radius: 15px;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);">
        <h3 class="text-lg text-white mb-4">{{ t("users") }}</h3>
        <ul class="text-gray-400 space-y-2">
            <li v-for="user in dataPool.activeServerUsers.value" :key="user.UserId" 
                class="flex items-center space-x-3 hover:text-white user-item">
                <UserInListSideElement :user="user"/>
            </li>
        </ul>

    </div>

</template>
<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { usePoolStore } from '@/store/poolStore';
import UserInListSideElement from './UserInListSideElement.vue';

const dataPool = usePoolStore();
const { t } = useLocale();


</script>

<style lang="css" scoped>
.user-item {
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    position: relative;
    mask-image: linear-gradient(to right, black 90%, transparent 100%);
}
</style>