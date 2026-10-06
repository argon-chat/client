import type { MessageEntityAttachment, MessageEntityVideo } from "@argon/glue";

/** What the chat's media grid and viewer show: pictures sent as attachments, and videos. */
export type ChatMediaItem = MessageEntityAttachment | MessageEntityVideo;

// One definition, the video library's: what a video entity is, and the file id of one still being sent.
export { isVideoEntity, PLACEHOLDER_FILE_ID } from "@/lib/video/entity";
