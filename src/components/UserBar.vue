<template>
  <div class="user-bar" v-if="me.me">
    <Popover>
      <PopoverTrigger as-child>
        <button type="button" class="user-info" style="width: 150px;">
          <!--
            The look worn where the person is standing, decoration and all. This bar is the one place
            somebody sees themselves as everybody else sees them, and showing the account here while
            the space showed a persona made it look like the persona had not taken.
          -->
          <ArgonAvatar class="user-avatar" :fallback="me.me.displayName"
            :file-id="cosmetics.wornAvatar(pool.selectedServer ?? null, me.me.userId, me.me?.avatarFileId)"
            :user-id="me.me.userId" :space-id="pool.selectedServer ?? undefined" />

          <div class="user-details items-start">
            <CosmeticNickname
              class="user-name"
              surface="memberListRow"
              :user-id="me.me.userId"
              :space-id="pool.selectedServer ?? null"
            >{{ me.me?.displayName }}</CosmeticNickname>
            <span :class="['user-status', me.statusClass(me.me!.currentStatus, false)]">
              {{ t(`status_${me.me?.currentStatus}`) }}
            </span>
          </div>
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" class="w-auto p-0">
        <AccountSwitcher @add="addAccountOpen = true" />
      </PopoverContent>
    </Popover>

    <div class="control-bar">
      <div class="controls">
        <button @click="windows.settingsOpen = true" class="icon-motion icon-motion--spin"
          style="padding-right: 5px;">
          <Settings class="w-6 h-6" />
        </button>
      </div>
    </div>

    <AddAccountModal v-model:open="addAccountOpen" />
  </div>
</template>

<script setup lang="ts">
import { ref, watchEffect } from "vue";
import { useMe } from "@/store/auth/meStore";
import ArgonAvatar from "./ArgonAvatar.vue";
import CosmeticNickname from "@/cosmetics/CosmeticNickname.vue";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { usePoolStore } from "@/store/data/poolStore";
import { useWindow } from "@/store/ui/windowStore";
import { Settings } from "lucide-vue-next";
import { useLocale } from "@/store/system/localeStore";
import { Popover, PopoverTrigger, PopoverContent } from "@argon/ui/popover";
import AccountSwitcher from "@/components/account/AccountSwitcher.vue";
import AddAccountModal from "@/components/account/AddAccountModal.vue";

const { t } = useLocale();
const windows = useWindow();
const me = useMe();
const pool = usePoolStore();
const cosmetics = useCosmeticsStore();
const addAccountOpen = ref(false);

/**
 * The bar draws somebody who is not in the member list it would otherwise be fed from, so it asks
 * for its own answer — one person, one scope, and the store remembers it for the rest of the page.
 */
watchEffect(() => {
  if (me.me) void cosmetics.prefetchWorn(pool.selectedServer ?? null, [me.me.userId]);
});
</script>

<style scoped>
.audio-visualizer {
  z-index: 3;
  display: block;
  width: 200px !important;
  height: 59px !important;
  margin-left: -20px !important;

}

.user-bar {
  background-color: hsl(var(--card) / var(--card-alpha));
  border: 1px solid hsl(var(--border) / 0.5);
  border-radius: var(--radius);
  padding: 10px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  position: relative;
}

.user-info {
  display: flex;
  align-items: center;
}

.user-avatar {
  flex: 0 0 auto;
  width: 38px;
  height: 38px;
  margin-right: 10px;
  border-radius: 50%;
}

.user-details {
  display: flex;
  flex-direction: column;
}

.user-name {
  display: block;
  max-width: 100%;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  position: relative;

  mask-image: linear-gradient(to right, black 90%, transparent 100%);
  mask-repeat: no-repeat;
  mask-size: 100% 100%;

  -webkit-mask-image: linear-gradient(to right, black 90%, transparent 100%);
  -webkit-mask-repeat: no-repeat;
  -webkit-mask-size: 100% 100%;

  font-size: 14px;
  color: hsl(var(--foreground));
}

.user-status {
  font-size: 12px;
}

.bad {
  color: #f04747;
}

.moderate {
  color: #f0d747
}

.good {
  color: #43b581;
}

.online {
  color: #43b581;
}

.away {
  color: #276e9e;
}

.ingame {
  color: #279e3b;
}

.offline {
  color: hsl(var(--muted-foreground));
}

.donotdisturb {
  color: #f04747;
}

.listen {
  color: #279e3b;
}

.touchgrass {
  color: #90279e;
}

.controls button {
  background: none;
  border: none;
  color: hsl(var(--foreground));
  font-size: 16px;
  cursor: pointer;
  margin-left: 5px;
  transition: color 0.3s;
  margin: 5px;
}

.controls {
  justify-content: center;
  display: flex;
}

.controls button:hover {
  color: hsl(var(--primary));
}

.controls button.active {
  color: hsl(var(--destructive));
}

.connection-card {
  background-color: hsl(var(--muted));
  text-align: center;
  margin-bottom: -5px;
  left: 10%;
  bottom: 100%;
  width: calc(100% - 50px);
}

@keyframes spinOutline {
  to {
    transform: rotate(360deg);
  }
}

.hover-spin-outline:hover {
  animation: spinOutline 1s linear infinite;
}
</style>
