import { EntityType, MessageEntityVideo, type IMessageEntity, type VideoInfo } from "@argon/glue";
import type { PreparedVideo } from "./transcode";
import type { VideoPoster } from "./poster";
import type { VideoStoryboardSprite } from "./storyboard";

/** The file id of an entity whose upload has not finished (as the attachment bubbles use). */
export const PLACEHOLDER_FILE_ID = "00000000-0000-0000-0000-000000000000";

/**
 * The message entity for an uploaded video. The server overwrites every field from the file's media
 * record when the message is sent; these are what the sender's own bubble shows meanwhile.
 */
export function videoEntityOf(info: VideoInfo): MessageEntityVideo {
  return new MessageEntityVideo(
    EntityType.Video,
    0,
    0,
    1,
    info.fileId,
    info.fileName,
    info.fileSize,
    info.contentType,
    info.width,
    info.height,
    info.durationMs,
    info.hasAudio,
    info.codec,
    info.thumbHash,
    info.posterFileId,
    info.storyboardFileId,
    info.storyboard,
    info.preloadPrefixSize,
    [],
    info.downloadUrl,
    info.posterUrl,
    info.storyboardUrl,
  );
}

export function isVideoEntity(entity: IMessageEntity): entity is MessageEntityVideo {
  return entity instanceof MessageEntityVideo || entity.type === EntityType.Video;
}

/**
 * The entity of the optimistic bubble, before anything is uploaded: the placeholder file id, what
 * the preparation measured, and the poster's ThumbHash. `urls` may point at object URLs of the local
 * blobs (owned and revoked by the caller) so the bubble can show and play them right away.
 */
export function videoEntityFromOptimistic(
  prepared: PreparedVideo & { fileName: string; storyboard?: VideoStoryboardSprite | null },
  poster?: VideoPoster | null,
  urls: { downloadUrl?: string | null; posterUrl?: string | null; storyboardUrl?: string | null } = {},
): MessageEntityVideo {
  return new MessageEntityVideo(
    EntityType.Video,
    0,
    0,
    1,
    PLACEHOLDER_FILE_ID,
    prepared.fileName,
    BigInt(prepared.blob.size),
    "video/mp4",
    prepared.width,
    prepared.height,
    prepared.durationMs,
    prepared.hasAudio,
    prepared.codecString,
    poster?.thumbHash ?? null,
    null,
    null,
    prepared.storyboard?.storyboard ?? null,
    null,
    [],
    urls.downloadUrl ?? null,
    urls.posterUrl ?? null,
    urls.storyboardUrl ?? null,
  );
}
