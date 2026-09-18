<script setup lang="ts">
import { computed, ref, watch } from "vue";
import { logger } from "@argon/core";
import { Button } from "@argon/ui/button";
import { Input } from "@argon/ui/input";
import { useToast } from "@argon/ui/toast";
import { IconArrowBackUp, IconLoader2, IconUpload } from "@tabler/icons-vue";
import { useLocale } from "@/store/system/localeStore";
import { useMe } from "@/store/auth/meStore";
import { useApi } from "@/store/system/apiStore";
import { useCosmeticsStore } from "@/store/features/cosmeticsStore";
import { uploadFile } from "@/lib/uploadFile";
import ArgonAvatar from "@/components/ArgonAvatar.vue";
import type { CosmeticLoadout } from "@argon/glue";

/**
 * Who a person is in the spaces this look applies to.
 *
 * <b>A look is a diff over the account, not a copy of it.</b> Every field here is empty until it is
 * filled, and empty means the account's own value shows through — so a new look costs nothing to
 * make, and changing an avatar on the account still reaches every look that never claimed one.
 *
 * That is the whole difference from a per-server profile: the persona exists on its own and is
 * pointed at however many spaces you like, rather than being filled in once per space.
 */
const props = defineProps<{ loadout: CosmeticLoadout; busy: boolean }>();

const emit = defineEmits<{ saved: [] }>();

const { t } = useLocale();
const { toast } = useToast();
const me = useMe();
const api = useApi();
const cosmetics = useCosmeticsStore();

const name = ref("");
const bio = ref("");
const uploading = ref(false);
const picker = ref<HTMLInputElement | null>(null);

watch(() => props.loadout, loadout => {
  name.value = loadout.displayNameOverride ?? "";
  bio.value = loadout.bioOverride ?? "";
}, { immediate: true, deep: true });

const inheritedName = computed(() => me.me?.displayName ?? "");

const avatar = computed(() => props.loadout.avatarFileIdOverride ?? me.me?.avatarFileId ?? null);

const ownAvatar = computed(() => props.loadout.avatarFileIdOverride !== null);

const dirty = computed(() =>
  (name.value.trim() || null) !== (props.loadout.displayNameOverride ?? null)
  || (bio.value.trim() || null) !== (props.loadout.bioOverride ?? null));

async function save(keepAvatar = ownAvatar.value): Promise<void> {
  const ok = await cosmetics.setLoadoutIdentity(
    props.loadout.loadoutId,
    name.value.trim() || null,
    bio.value.trim() || null,
    keepAvatar,
  );

  if (!ok) {
    toast({ title: t("error"), description: t("cosmetic_identity_failed"), variant: "destructive" });
    return;
  }

  emit("saved");
}

/**
 * The look's own picture, uploaded exactly the way the account's is.
 *
 * Same ticket, same limits, same moderation on the way in — a picture other people see is a picture
 * other people see, whichever field ends up holding it.
 */
async function pick(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];

  input.value = "";

  if (!file) return;

  uploading.value = true;

  try {
    const begin = await api.cosmeticsInteraction.BeginUploadLoadoutAvatar(props.loadout.loadoutId);
    const { blobId } = await uploadFile(begin, file, "LoadoutAvatar");

    const result = await api.cosmeticsInteraction.CompleteUploadLoadoutAvatar(props.loadout.loadoutId, blobId);

    if (result.isFailedLoadoutAction()) {
      toast({ title: t("error"), description: t("cosmetic_identity_failed"), variant: "destructive" });
      return;
    }

    await cosmetics.loadLoadouts();
    emit("saved");
  } catch (error) {
    logger.warn("A look avatar could not be uploaded", error);
    toast({ title: t("error"), description: `${error}`, variant: "destructive" });
  } finally {
    uploading.value = false;
  }
}
</script>

<template>
  <div class="identity-block">
    <div class="text-sm font-medium">{{ t("cosmetic_identity") }}</div>
    <p class="text-xs text-muted-foreground">{{ t("cosmetic_identity_hint") }}</p>

    <div class="identity-row">
      <div class="identity-avatar">
        <!-- Clicked, the way the account's own avatar is: a button beside it was a second way to say
             the same thing, and the picture is the obvious place to press. -->
        <button
          class="identity-avatar-well"
          :disabled="busy || uploading"
          :title="t('cosmetic_identity_change_avatar')"
          @click="picker?.click()"
        >
          <ArgonAvatar
            :user-id="me.me?.userId"
            :file-id="avatar ?? undefined"
            :fallback="inheritedName"
            :overrided-size="64"
          />

          <span class="identity-avatar-overlay">
            <IconLoader2 v-if="uploading" class="w-5 h-5 animate-spin" />
            <IconUpload v-else class="w-5 h-5" />
          </span>
        </button>

        <input ref="picker" type="file" accept="image/*" class="hidden" @change="pick" />

        <!-- Going back is the same call as saving, with the override dropped: one way to say it. -->
        <button
          v-if="ownAvatar"
          class="identity-avatar-revert"
          :disabled="busy || uploading"
          :title="t('cosmetic_identity_inherit')"
          @click="save(false)"
        >
          <IconArrowBackUp class="w-3.5 h-3.5" />
        </button>

        <span class="identity-avatar-state">
          {{ ownAvatar ? t("cosmetic_identity_own") : t("cosmetic_identity_inherit") }}
        </span>
      </div>

      <div class="identity-fields">
        <label class="identity-field">
          <span>{{ t("display_name") }}</span>
          <Input
            v-model="name"
            :placeholder="inheritedName"
            :maxlength="32"
            :disabled="busy"
            class="h-8 text-xs"
          />
        </label>

        <label class="identity-field">
          <span>{{ t("bio") }}</span>
          <textarea
            v-model="bio"
            :placeholder="me.meProfile?.bio ?? t('cosmetic_identity_inherit')"
            :maxlength="512"
            :disabled="busy"
            rows="2"
            class="identity-bio"
          />
        </label>
      </div>
    </div>

    <div v-if="dirty" class="flex justify-end gap-2">
      <Button size="sm" variant="ghost" :disabled="busy" @click="name = loadout.displayNameOverride ?? ''; bio = loadout.bioOverride ?? ''">
        {{ t("cancel") }}
      </Button>
      <Button size="sm" :disabled="busy" @click="save()">{{ t("apply") }}</Button>
    </div>
  </div>
</template>

<style scoped>
.identity-block {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 16px;
  padding-top: 14px;
  border-top: 1px solid hsl(var(--border) / 0.4);
}

.identity-row {
  display: flex;
  /* Against the middle of the two fields beside it, not against the top of the first one. */
  align-items: center;
  gap: 14px;
}

/*
 * Wide enough for whatever the look wears on its face, not just for the face.
 *
 * A decoration is drawn bigger than the avatar it rings — up to eight tenths bigger — so at the
 * width of the picture alone the ring was cut off on both sides. 116 is a 64px face with the
 * widest ring the payload allows, and the picture stays centred in it.
 */
.identity-avatar {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 5px;
  flex: 0 0 auto;
  width: 116px;
}

/*
 * Unclipped, because what is drawn here is meant to be bigger than the button.
 *
 * The clip was rounding the picture, and the picture rounds itself — all it was actually doing
 * was taking a bite out of every avatar decoration in this block.
 */
.identity-avatar-well {
  position: relative;
  border-radius: 50%;
  overflow: visible;
  line-height: 0;
}

.identity-avatar-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  border-radius: 50%;
  background: hsl(var(--background) / 0.6);
  color: hsl(var(--foreground));
  opacity: 0;
  transition: opacity 0.15s ease;
}

.identity-avatar-well:hover .identity-avatar-overlay,
.identity-avatar-well:disabled .identity-avatar-overlay {
  opacity: 1;
}

/* Only there when there is something to go back from, which is also what says there is. */
.identity-avatar-revert {
  position: absolute;
  top: 44px;
  right: 22px;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 22px;
  height: 22px;
  border-radius: 999px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  color: hsl(var(--muted-foreground));
}

.identity-avatar-revert:hover {
  color: hsl(var(--foreground));
  border-color: hsl(var(--primary));
}

.identity-avatar-state {
  font-size: 0.65rem;
  color: hsl(var(--muted-foreground));
}

.identity-fields {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-width: 0;
}

.identity-field {
  display: flex;
  flex-direction: column;
  gap: 3px;
  font-size: 0.72rem;
  color: hsl(var(--muted-foreground));
}

.identity-bio {
  width: 100%;
  padding: 6px 9px;
  border-radius: 8px;
  border: 1px solid hsl(var(--border));
  background: hsl(var(--background));
  font-size: 0.75rem;
  line-height: 1.35;
  resize: none;
}
</style>
