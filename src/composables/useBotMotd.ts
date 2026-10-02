import { computed, toValue, watch, type MaybeRefOrGetter } from "vue";
import { UserFlag } from "@argon/glue";
import { persisted, type PersistedRef } from "@argon/storage";
import { usePoolStore } from "@/store/data/poolStore";
import { useAppTextsStore } from "@/store/data/appTextsStore";
import { useLocale } from "@/store/system/localeStore";
import { AppTextKey, appRefByBotUser } from "@/lib/appTexts";
import { userScopedKey } from "@/lib/userScopedStorage";

const MOTD_KEYS = [AppTextKey.Motd];

export const BOT_MOTD_HIDDEN_KEY = "argon_bot_motd_hidden";

// One copy for every DM view, so closing the strip in one hides it in the other (the call sidebar).
let hidden: { key: string; ref: PersistedRef<Record<string, string>> } | null = null;

/** Bot user id → fingerprint of the MOTD the reader closed. */
function hiddenMotds(): PersistedRef<Record<string, string>> {
  const key = userScopedKey(BOT_MOTD_HIDDEN_KEY);
  if (hidden?.key !== key) hidden = { key, ref: persisted<Record<string, string>>(key, {}) };
  return hidden.ref;
}

/**
 * The MOTD of the bot a DM is with, in the reader's language; null for a person, a bot without one,
 * or one the reader closed — until the bot's developer changes it.
 */
export function useBotMotd(peerId: MaybeRefOrGetter<string | undefined>) {
  const pool = usePoolStore();
  const appTexts = useAppTextsStore();
  const locale = useLocale();
  const closed = hiddenMotds();

  const id = computed(() => toValue(peerId)?.toLowerCase());
  const peer = pool.getUserReactive(id);

  // The system account carries BOT as well, but has no developer and so no MOTD.
  const isBot = computed(() => {
    const flags = peer.value?.flags ?? 0;
    return (flags & UserFlag.BOT) !== 0 && (flags & UserFlag.SYSTEM) === 0;
  });

  const ref = computed(() => (id.value && isBot.value ? appRefByBotUser(id.value) : null));

  watch(
    ref,
    (app) => {
      if (app) void appTexts.ensureLoaded(app, MOTD_KEYS);
    },
    { immediate: true },
  );

  const fingerprint = computed(() => (ref.value ? appTexts.fingerprint(ref.value, AppTextKey.Motd) : null));

  const motd = computed(() => {
    if (!ref.value || !id.value) return null;
    if (fingerprint.value && closed.value[id.value] === fingerprint.value) return null;
    return appTexts.text(ref.value, AppTextKey.Motd, locale.currentLocale);
  });

  /** Hides this MOTD for good; a changed one shows again. */
  function dismiss() {
    if (id.value && fingerprint.value) closed.set_key(id.value, fingerprint.value);
  }

  return { motd, dismiss };
}
