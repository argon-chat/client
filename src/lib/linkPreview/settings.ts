import { persistedValue } from "@argon/storage";

// Shared singletons: the settings page and the chat read the same refs, so a toggle takes effect
// without a reload. Both default on, as in Telegram.

/** Cards under links in messages. Off hides them; the sender's card still reaches everyone else. */
export const showLinkPreviews = persistedValue<boolean>("chat.showLinkPreviews", true);

/** Whether the composer asks for a card and attaches it to what this user sends. */
export const sendLinkPreviews = persistedValue<boolean>("chat.sendLinkPreviews", true);
