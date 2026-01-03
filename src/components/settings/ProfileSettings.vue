<template>
  <div class="profile-settings text-white rounded-lg space-y-6" v-if="me.me">
    <h2 class="text-2xl font-bold">{{ t("profile_settings") }}</h2>
    <div class="avatar-username flex items-center space-x-4">
      <AvatarUploader
        :fallback="me.me.displayName"
        :avatar-file-id="me.me?.avatarFileId"
        :user-id="me.me.userId"
        @avatar-updated="onAvatarUpdated"
      />
      <div>
        <label class="block font-semibold mb-1">{{ t("username") }}</label>
        <Input readonly disabled v-model="me.me.username" type="text" class="input-field"
          placeholder="Enter username" />
      </div>
    </div>
    <div>
      <label class="block font-semibold mb-1">{{ t("display_name") }}</label>
      <Input readonly disabled v-model="me.me.displayName" type="text" class="input-field"
        placeholder="Enter display name" />
    </div>
    <div>
      <div v-if="false">
        <label class="block font-semibold mb-1">{{ t("password") }}</label>
        <Input type="password" class="input-field" placeholder="Enter new password" />
      </div>
      <div v-if="false">
        <label class="block font-semibold mb-1">{{ t("phone_number") }}</label>
        <Input type="tel" class="input-field" placeholder="Enter phone number" />
      </div>

      <div class="otp-settings" v-if="false">
        <label class="block font-semibold mb-1">{{ t("otp_title") }}</label>
        <button @click="toggleOTP" class="button bg-blue-500 text-white rounded px-4 py-2 hover:bg-blue-600">
          {{ t('disable_otp')}}
        </button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { Input } from "@/components/ui/input";
import AvatarUploader from "./AvatarUploader.vue";
import { useMe } from "@/store/meStore";
import { useLocale } from "@/store/localeStore";

const { t } = useLocale();
const me = useMe();

const toggleOTP = () => {
};

const onAvatarUpdated = () => {
  // Handle avatar update if needed (e.g., refresh user data)
  console.log("Avatar updated successfully");
};
</script>

<style scoped>
.profile-settings {
  max-width: 600px;
  margin: 0 auto;
}

.button {
  padding: 10px 16px;
  font-size: 1rem;
  font-weight: 500;
}
</style>
