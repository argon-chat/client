<template>
  <div
    class="user-list-container rounded-xl p-4 shadow-md w-56 overflow-y-auto scrollbar-thin scrollbar-hide scrollbar-thumb-gray-600 scrollbar-track-gray-800"
    style="background-color: #161616f5; border-radius: 15px; box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);">
    <div v-for="group in dataPool.groupedServerUsers.value" :key="group.archetype.Id" class="mb-4">
      <h4 class="text-sm font-semibold text-gray-300 tracking-wide mb-2 flex items-center space-x-1">
        <span v-if="group.archetype.IconFileId">
          <img :src="`/api/icons/${group.archetype.IconFileId}`" class="w-4 h-4 inline-block mr-1" />
        </span>
        <span :style="{ color: formatColour(group.archetype.Colour) }">{{ group.archetype.Name }}</span>
      </h4>
      <ul class="text-gray-400 space-y-2">
        <li v-for="user in group.users" :key="user.UserId"
          class="flex items-center space-x-3 hover:text-white user-item">
          <UserInListSideElement :user="user" />
        </li>
      </ul>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useLocale } from '@/store/localeStore';
import { usePoolStore } from '@/store/poolStore';
import UserInListSideElement from './UserInListSideElement.vue';

const dataPool = usePoolStore();
const { t } = useLocale();
const formatColour = (argb: number) => {
    const a = ((argb >> 24) & 0xff) / 255;
    const r = (argb >> 16) & 0xff;
    const g = (argb >> 8) & 0xff;
    const b = argb & 0xff;
    return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
};

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