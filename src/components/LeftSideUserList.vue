<template>
  <div
    class="user-list-container rounded-xl p-4 shadow-md w-56 overflow-y-auto scrollbar-thin scrollbar-hide scrollbar-thumb-gray-600 scrollbar-track-gray-800">
    <div v-for="group in groupedUsers" :key="group.archetype.id" class="mb-4">
      <h4 class="text-sm font-semibold text-muted-foreground tracking-wide mb-2 flex items-center space-x-1">
        <span v-if="group.archetype.iconFileId">
          <img :src="`/api/icons/${group.archetype.iconFileId}`" class="w-4 h-4 inline-block mr-1" />
        </span>
        <span :style="{ color: formatColour(group.archetype.colour) }">{{ group.archetype.name }}</span>
      </h4>
      <ul class="text-muted-foreground space-y-2">
        <li v-for="user in group.users" :key="user.userId"
          class="flex items-center space-x-3 hover:text-foreground user-item">
          <UserInListSideElement :user="user" />
        </li>
      </ul>
    </div>
  </div>
</template>
<script setup lang="ts">
import { useLocale } from "@/store/localeStore";
import { usePoolStore } from "@/store/poolStore";
import UserInListSideElement from "./UserInListSideElement.vue";
import { watch, computed } from "vue";
import { persistedValue } from "@/lib/persistedValue";

const model = defineModel<string | null>('selectedSpace', {
    type: String, required: true
});



const dataPool = usePoolStore();


const groupedUsers = dataPool.useGroupedServerUsers(model);

const currentTheme = persistedValue<string>("appearance.theme", "dark");
const isLightTheme = computed(() => currentTheme.value === "light");

const { t } = useLocale();

// Calculate relative luminance
const getLuminance = (r: number, g: number, b: number) => {
  const [rs, gs, bs] = [r, g, b].map(c => {
    c = c / 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  });
  return 0.2126 * rs + 0.7152 * gs + 0.0722 * bs;
};

const formatColour = (argb: number) => {
  const a = ((argb >> 24) & 0xff) / 255;
  let r = (argb >> 16) & 0xff;
  let g = (argb >> 8) & 0xff;
  let b = argb & 0xff;
  
  const luminance = getLuminance(r, g, b);
  
  if (isLightTheme.value) {
    // On light theme, darken light colors for readability
    if (luminance > 0.5) {
      const factor = 0.6;
      r = Math.round(r * factor);
      g = Math.round(g * factor);
      b = Math.round(b * factor);
    }
  } else {
    // On dark theme, lighten very dark colors for readability
    if (luminance < 0.1) {
      const factor = 2;
      r = Math.min(255, Math.round(r * factor + 50));
      g = Math.min(255, Math.round(g * factor + 50));
      b = Math.min(255, Math.round(b * factor + 50));
    }
  }
  
  return `rgba(${r}, ${g}, ${b}, ${a.toFixed(2)})`;
};
</script>

<style lang="css" scoped>
.user-list-container {
  background-color: hsl(var(--card));
  border-radius: 15px;
  box-shadow: 0 4px 12px rgba(0, 0, 0, 0.15);
}

.user-item {
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;
  mask-image: linear-gradient(to right, black 90%, transparent 100%);
}
</style>