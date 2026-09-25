import { toast } from "@argon/ui/toast";
import { logger } from "@argon/core";
import type { CallNotice } from "@argon/calls";
import { useLocale } from "@/store/system/localeStore";
import { usePoolStore } from "@/store/data/poolStore";

/** Shows what the call manager wants the user to know about. */
export async function showCallNotice(notice: CallNotice): Promise<void> {
  const { t } = useLocale();
  switch (notice.kind) {
    case "server-muted":
      toast({ title: t("voice_you_were_server_muted") });
      return;
    case "server-unmuted":
      toast({ title: t("voice_you_were_server_unmuted") });
      return;
    case "server-deafened":
      toast({ title: t("voice_you_were_server_deafened") });
      return;
    case "server-undeafened":
      toast({ title: t("voice_you_were_server_undeafened") });
      return;
    case "join-refused":
      toast({ title: t("voice_join_error_insufficient_permissions"), variant: "destructive" });
      return;
    case "moved": {
      const channel = await usePoolStore().getChannel(notice.channelId).catch((e: unknown) => {
        logger.warn("[voice] moved to a channel we could not load", e);
        return null;
      });
      toast({ title: t("voice_you_were_moved", { channel: channel?.name ?? "" }) });
      return;
    }
  }
}
