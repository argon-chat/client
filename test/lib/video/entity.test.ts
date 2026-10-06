/**
 * The message entity of a video: from the server's media record once uploaded, and from what the
 * preparation measured for the bubble shown before that.
 */

import { describe, test, expect } from "vitest";
import { EntityType, MessageEntityAttachment, MessageEntityVideo, type VideoInfo } from "@argon/glue";
import { isVideoEntity, PLACEHOLDER_FILE_ID, videoEntityFromOptimistic, videoEntityOf } from "@/lib/video/entity";

const storyboard = { frameWidth: 160, frameHeight: 90, columns: 10, frameCount: 30, intervalMs: 1000 };

const info: VideoInfo = {
  fileId: "11111111-1111-1111-1111-111111111111",
  fileName: "clip.mp4",
  fileSize: 123_456n,
  contentType: "video/mp4",
  width: 1280,
  height: 720,
  durationMs: 30_000,
  hasAudio: true,
  codec: "avc1.64001f",
  thumbHash: "thumb",
  posterFileId: "22222222-2222-2222-2222-222222222222",
  storyboardFileId: "33333333-3333-3333-3333-333333333333",
  storyboard,
  preloadPrefixSize: 4096n,
  downloadUrl: "https://cdn/v",
  posterUrl: "https://cdn/p",
  storyboardUrl: "https://cdn/s",
};

describe("video entities", () => {
  test("videoEntityOf carries the media record", () => {
    const entity = videoEntityOf(info);
    expect(entity).toBeInstanceOf(MessageEntityVideo);
    expect(entity).toMatchObject({ ...info, type: EntityType.Video, offset: 0, length: 0, version: 1, variants: [] });
    expect(entity.isMessageEntityVideo()).toBe(true);
  });

  test("isVideoEntity", () => {
    expect(isVideoEntity(videoEntityOf(info))).toBe(true);
    const file = new MessageEntityAttachment(EntityType.Attachment, 0, 0, 1, "f", "a.png", 1n, "image/png", 1, 1, null, null);
    expect(isVideoEntity(file)).toBe(false);
  });

  test("the optimistic entity: placeholder id, measured size and duration, local URLs", () => {
    const prepared = {
      blob: new Blob([new Uint8Array(2048)], { type: "video/mp4" }),
      width: 720,
      height: 1280,
      durationMs: 12_345,
      hasAudio: false,
      codecString: "avc1.42e01f",
      mode: "transcode" as const,
      fileName: "phone.mp4",
      storyboard: { blob: new Blob(), storyboard },
    };
    const poster = { blob: new Blob(), width: 405, height: 720, thumbHash: "local-thumb" };

    const entity = videoEntityFromOptimistic(prepared, poster, { downloadUrl: "blob:video", posterUrl: "blob:poster" });

    expect(entity).toMatchObject({
      type: EntityType.Video,
      fileId: PLACEHOLDER_FILE_ID,
      fileName: "phone.mp4",
      fileSize: 2048n,
      contentType: "video/mp4",
      width: 720,
      height: 1280,
      durationMs: 12_345,
      hasAudio: false,
      codec: "avc1.42e01f",
      thumbHash: "local-thumb",
      posterFileId: null,
      storyboardFileId: null,
      storyboard,
      preloadPrefixSize: null,
      variants: [],
      downloadUrl: "blob:video",
      posterUrl: "blob:poster",
      storyboardUrl: null,
    });
    expect(PLACEHOLDER_FILE_ID).toBe("00000000-0000-0000-0000-000000000000");
  });

  test("the optimistic entity without a poster", () => {
    const entity = videoEntityFromOptimistic({
      blob: new Blob(["x"]),
      width: 2,
      height: 2,
      durationMs: 1,
      hasAudio: true,
      codecString: null,
      mode: "copy",
      fileName: "x.mp4",
    });
    expect(entity).toMatchObject({ thumbHash: null, storyboard: null, downloadUrl: null, posterUrl: null });
  });
});
