import { computed } from "vue";
import type { Guid } from "@argon-chat/ion.webcore";
import { PinMessageError } from "@argon/glue";
import { useToast } from "@argon/ui/toast";
import { useLocale } from "@/store/system/localeStore";
import { usePexStore } from "@/store/data/permissionStore";
import { PIN_LIMIT, usePinStore, type PinOutcome } from "@/store/data/pinStore";

/** The toast description for a refused pin or unpin. */
export function pinErrorKey(error: PinMessageError | null): string {
  switch (error) {
    case PinMessageError.PIN_LIMIT_REACHED:
      return "pins_error_limit";
    case PinMessageError.INSUFFICIENT_PERMISSIONS:
      return "pins_error_no_permission";
    case PinMessageError.MESSAGE_NOT_FOUND:
      return "pins_error_not_found";
    default:
      return "pins_error_unknown";
  }
}

/** Pins of one channel: the list, whether the user may change it, and pin/unpin with feedback. */
export function useChannelPins(channelId: () => Guid, spaceId: () => Guid | undefined | null) {
  const store = usePinStore();
  const pex = usePexStore();
  const { toast } = useToast();
  const { t } = useLocale();

  const pins = computed(() => store.list(channelId()));
  const count = computed(() => pins.value.length);
  const loaded = computed(() => store.isLoaded(channelId()));
  const canManage = computed(() => pex.hasIn(channelId(), "ManageMessages", spaceId()));

  function isPinned(messageId: bigint): boolean {
    return store.isPinned(channelId(), messageId);
  }

  async function refresh(): Promise<void> {
    const space = spaceId();
    if (space) await store.load(space, channelId());
  }

  function report(outcome: PinOutcome, title: string): boolean {
    if (outcome.ok) return true;
    toast({
      title: t(title),
      description: t(pinErrorKey(outcome.error), { limit: PIN_LIMIT }),
      variant: "destructive",
    });
    return false;
  }

  async function pin(messageId: bigint): Promise<boolean> {
    const space = spaceId();
    if (!space) return false;
    return report(await store.pin(space, channelId(), messageId), "pins_pin_failed");
  }

  async function unpin(messageId: bigint): Promise<boolean> {
    const space = spaceId();
    if (!space) return false;
    return report(await store.unpin(space, channelId(), messageId), "pins_unpin_failed");
  }

  function toggle(messageId: bigint): Promise<boolean> {
    return isPinned(messageId) ? unpin(messageId) : pin(messageId);
  }

  return { pins, count, loaded, canManage, isPinned, refresh, pin, unpin, toggle };
}
