import { computed, ref, type Ref } from "vue";
import { logger } from "@argon/core";
import { ChannelWebhookError, type ArgonChannel, type ChannelWebhook } from "@argon/glue";
import { useApi } from "@/store/system/apiStore";

/**
 * The channel's incoming webhooks, for the Integrations tab: list, create, rename, new URL, delete.
 * A webhook's URL leaves the server only when it is created or regenerated, so it is kept here
 * (`revealed`) until the user dismisses it, and never again.
 */

export const MAX_WEBHOOKS_PER_CHANNEL = 10;
export const MAX_WEBHOOK_NAME_LENGTH = 32;

export type WebhookOutcome = { ok: true } | { ok: false; errorKey: string };

export interface RevealedWebhook {
  webhookId: string;
  name: string;
  url: string;
}

export function webhookErrorKey(error: ChannelWebhookError): string {
  switch (error) {
    case ChannelWebhookError.NAME_EMPTY:
      return "webhook_error_name_empty";
    case ChannelWebhookError.NAME_TOO_LONG:
      return "webhook_error_name_too_long";
    case ChannelWebhookError.LIMIT_REACHED:
      return "webhook_error_limit";
    case ChannelWebhookError.INSUFFICIENT_PERMISSIONS:
      return "webhook_error_permissions";
    case ChannelWebhookError.NOT_A_TEXT_CHANNEL:
      return "webhook_error_not_text";
    case ChannelWebhookError.WEBHOOK_NOT_FOUND:
    case ChannelWebhookError.CHANNEL_NOT_FOUND:
      return "webhook_error_not_found";
    default:
      return "webhook_error_generic";
  }
}

/** The same rule the server applies, so an obviously bad name never makes the round trip. */
export function validateWebhookName(name: string): ChannelWebhookError {
  const trimmed = name.trim();
  if (!trimmed) return ChannelWebhookError.NAME_EMPTY;
  if (trimmed.length > MAX_WEBHOOK_NAME_LENGTH) return ChannelWebhookError.NAME_TOO_LONG;
  return ChannelWebhookError.NONE;
}

/** The server answers with a relative URL when it has no public base configured; this client's API is that base. */
export function absoluteWebhookUrl(url: string, apiEndpoint: string): string {
  if (/^https?:\/\//i.test(url)) return url;
  return `${apiEndpoint.replace(/\/+$/, "")}/${url.replace(/^\/+/, "")}`;
}

const fail = (error: ChannelWebhookError): WebhookOutcome => ({ ok: false, errorKey: webhookErrorKey(error) });
const failed: WebhookOutcome = { ok: false, errorKey: "webhook_error_generic" };

export function useChannelWebhooks(channel: Ref<Pick<ArgonChannel, "spaceId" | "channelId">>) {
  const api = useApi();

  const webhooks = ref<ChannelWebhook[]>([]);
  const loading = ref(false);
  const busy = ref(false);
  const revealed = ref<RevealedWebhook | null>(null);

  const atLimit = computed(() => webhooks.value.length >= MAX_WEBHOOKS_PER_CHANNEL);

  const client = () => api.channelWebhookInteraction;

  async function load(): Promise<boolean> {
    const { spaceId, channelId } = channel.value;
    loading.value = true;
    try {
      const list = await client().GetWebhooks(spaceId, channelId);
      // The drawer may have moved on to another channel meanwhile.
      if (channel.value.channelId === channelId) webhooks.value = [...list];
      return true;
    } catch (e) {
      logger.warn("[Webhooks] GetWebhooks failed", e);
      return false;
    } finally {
      loading.value = false;
    }
  }

  function upsert(hook: ChannelWebhook) {
    const index = webhooks.value.findIndex((w) => w.webhookId === hook.webhookId);
    webhooks.value = index < 0
      ? [...webhooks.value, hook]
      : webhooks.value.map((w, i) => (i === index ? hook : w));
  }

  function reveal(hook: ChannelWebhook, url: string) {
    revealed.value = { webhookId: hook.webhookId, name: hook.name, url: absoluteWebhookUrl(url, api.apiEndpoint) };
  }

  async function guarded(what: string, call: () => Promise<WebhookOutcome>): Promise<WebhookOutcome> {
    if (busy.value) return failed;
    busy.value = true;
    try {
      return await call();
    } catch (e) {
      logger.warn(`[Webhooks] ${what} failed`, e);
      return failed;
    } finally {
      busy.value = false;
    }
  }

  function create(name: string): Promise<WebhookOutcome> {
    const invalid = validateWebhookName(name);
    if (invalid !== ChannelWebhookError.NONE) return Promise.resolve(fail(invalid));
    if (atLimit.value) return Promise.resolve(fail(ChannelWebhookError.LIMIT_REACHED));

    return guarded("CreateWebhook", async () => {
      const { spaceId, channelId } = channel.value;
      const result = await client().CreateWebhook(spaceId, channelId, name.trim());
      if (!result.isSuccessCreateWebhook()) return fail(result.isFailedCreateWebhook() ? result.error : ChannelWebhookError.NONE);
      upsert(result.webhook);
      reveal(result.webhook, result.url);
      return { ok: true };
    });
  }

  function rename(webhookId: string, name: string): Promise<WebhookOutcome> {
    const invalid = validateWebhookName(name);
    if (invalid !== ChannelWebhookError.NONE) return Promise.resolve(fail(invalid));

    return guarded("RenameWebhook", async () => {
      const { spaceId, channelId } = channel.value;
      const result = await client().RenameWebhook(spaceId, channelId, webhookId, name.trim());
      if (!result.isSuccessUpdateWebhook()) return fail(result.isFailedUpdateWebhook() ? result.error : ChannelWebhookError.NONE);
      upsert(result.webhook);
      if (revealed.value?.webhookId === webhookId) revealed.value = { ...revealed.value, name: result.webhook.name };
      return { ok: true };
    });
  }

  function regenerate(webhookId: string): Promise<WebhookOutcome> {
    return guarded("RegenerateWebhookToken", async () => {
      const { spaceId, channelId } = channel.value;
      const result = await client().RegenerateWebhookToken(spaceId, channelId, webhookId);
      if (!result.isSuccessCreateWebhook()) return fail(result.isFailedCreateWebhook() ? result.error : ChannelWebhookError.NONE);
      upsert(result.webhook);
      reveal(result.webhook, result.url);
      return { ok: true };
    });
  }

  function remove(webhookId: string): Promise<WebhookOutcome> {
    return guarded("DeleteWebhook", async () => {
      const { spaceId, channelId } = channel.value;
      const deleted = await client().DeleteWebhook(spaceId, channelId, webhookId);
      // False is "already gone" as much as "refused"; either way it is not in the channel.
      webhooks.value = webhooks.value.filter((w) => w.webhookId !== webhookId);
      if (revealed.value?.webhookId === webhookId) revealed.value = null;
      return deleted ? { ok: true } : fail(ChannelWebhookError.WEBHOOK_NOT_FOUND);
    });
  }

  function dismissReveal() {
    revealed.value = null;
  }

  return { webhooks, loading, busy, revealed, atLimit, load, create, rename, regenerate, remove, dismissReveal };
}
