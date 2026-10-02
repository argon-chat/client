import { computed, toValue, watch, type MaybeRefOrGetter } from "vue";
import { UserFlag } from "@argon/glue";
import { usePoolStore } from "@/store/data/poolStore";
import { useAppTextsStore } from "@/store/data/appTextsStore";
import { useLocale } from "@/store/system/localeStore";
import { AppTextKey, appRefByBotUser } from "@/lib/appTexts";

const MOTD_KEYS = [AppTextKey.Motd];

/** The MOTD of the bot a DM is with, in the reader's language; null for a person or a bot without one. */
export function useBotMotd(peerId: MaybeRefOrGetter<string | undefined>) {
  const pool = usePoolStore();
  const appTexts = useAppTextsStore();
  const locale = useLocale();

  const id = computed(() => toValue(peerId));
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

  return computed(() => (ref.value ? appTexts.text(ref.value, AppTextKey.Motd, locale.currentLocale) : null));
}
