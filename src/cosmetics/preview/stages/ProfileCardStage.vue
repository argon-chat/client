<script setup lang="ts">
import type { ArgonUserProfile } from "@argon/glue";
import ProfileCardPreview from "@/components/settings/ProfileCardPreview.vue";
import { PREVIEW_USER_ID } from "@/cosmetics/preview/previewProfile";

/**
 * The profile card, which is the card everybody actually looks at.
 *
 * <b>It is the settings card, not a copy of it.</b> The one a person sees while arranging their own
 * profile already draws every layer in the right order, leaves a frame the room it asks for and lets
 * a board card sit where it will — so the operator approving a row is looking at the same component
 * its wearer will, which is the only claim this whole preview is making.
 */
defineProps<{
  profile: ArgonUserProfile | null;
  displayName: string;
  username: string;
  bio: string | null;
  avatarFileId: string | null;
  primaryColor: number | null;
  accentColor: number | null;
}>();
</script>

<template>
  <ProfileCardPreview
    :profile="profile"
    :display-name="displayName"
    :username="username"
    :user-id="PREVIEW_USER_ID"
    :avatar-file-id="avatarFileId"
    :bio="bio"
    :is-premium="false"
    :primary-color="primaryColor"
    :accent-color="accentColor"
    :background-id="null"
  />
</template>
