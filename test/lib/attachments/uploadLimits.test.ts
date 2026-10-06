/**
 * The upload limits of a target: asked once per target (a channel, a direct chat) and kept for the
 * session; a server that fails or predates GetUploadLimits gives the defaults (100 MB, 4 h) without
 * breaking anything and is asked again a minute later; a refusal forgets what was known.
 */
import { describe, test, expect, vi, beforeEach, afterEach } from "vitest";
import type { UploadLimits } from "@argon/glue";
import {
  DEFAULT_UPLOAD_LIMITS,
  clearUploadLimits,
  formatLimitBytes,
  formatLimitDuration,
  invalidateUploadLimits,
  resolveUploadLimits,
} from "@/lib/attachments/uploadLimits";

const MB = 1024 * 1024;
const channel = { kind: "channel", spaceId: "s1", channelId: "c1" } as const;
const otherChannel = { kind: "channel", spaceId: "s1", channelId: "c2" } as const;
const dm = { kind: "dm", peerId: "p1" } as const;

const limits = (video: number, durationMs: number, attachment = 25 * MB): UploadLimits => ({
  attachmentMaxBytes: BigInt(attachment),
  videoMaxBytes: BigInt(video),
  videoMaxDurationMs: BigInt(durationMs),
});

let channelCall: ReturnType<typeof vi.fn>;
let dmCall: ReturnType<typeof vi.fn>;
const api = () => ({ channelInteraction: { GetUploadLimits: channelCall }, userChatInteractions: { GetUploadLimits: dmCall } }) as never;

beforeEach(() => {
  clearUploadLimits();
  channelCall = vi.fn().mockResolvedValue(limits(2048 * MB, 2 * 3_600_000));
  dmCall = vi.fn().mockResolvedValue(limits(500 * MB, 3_600_000));
});

afterEach(() => {
  vi.useRealTimers();
});

describe("resolveUploadLimits", () => {
  test("a channel's limits come from the channel call, a direct chat's from the peer's, as numbers", async () => {
    expect(await resolveUploadLimits(api(), channel)).toEqual({
      attachmentMaxBytes: 25 * MB,
      videoMaxBytes: 2048 * MB,
      videoMaxDurationMs: 7_200_000,
      fallback: false,
    });
    expect(channelCall).toHaveBeenCalledWith("s1", "c1");

    expect((await resolveUploadLimits(api(), dm)).videoMaxBytes).toBe(500 * MB);
    expect(dmCall).toHaveBeenCalledWith("p1");
  });

  test("asked once per target for the session; concurrent asks share the call", async () => {
    await Promise.all([resolveUploadLimits(api(), channel), resolveUploadLimits(api(), channel)]);
    await resolveUploadLimits(api(), channel);
    expect(channelCall).toHaveBeenCalledTimes(1);

    await resolveUploadLimits(api(), otherChannel);
    expect(channelCall).toHaveBeenCalledTimes(2);
  });

  test("a server without the method (or failing) gives the defaults, and is asked again a minute later", async () => {
    vi.useFakeTimers({ now: 0 });
    channelCall.mockRejectedValueOnce(new Error("Unknown method IChannelInteraction.GetUploadLimits"));

    const first = await resolveUploadLimits(api(), channel);
    expect(first).toEqual(DEFAULT_UPLOAD_LIMITS);
    expect(first).toMatchObject({ videoMaxBytes: 100 * MB, videoMaxDurationMs: 4 * 3_600_000, fallback: true });

    // Within the minute the defaults stand, without asking again.
    vi.setSystemTime(30_000);
    await resolveUploadLimits(api(), channel);
    expect(channelCall).toHaveBeenCalledTimes(1);

    vi.setSystemTime(61_000);
    expect((await resolveUploadLimits(api(), channel)).videoMaxBytes).toBe(2048 * MB);
    expect(channelCall).toHaveBeenCalledTimes(2);
  });

  test("a limit the server leaves at zero falls back to its default, the others are kept", async () => {
    channelCall.mockResolvedValue(limits(0, 600_000, 0));
    expect(await resolveUploadLimits(api(), channel)).toEqual({
      attachmentMaxBytes: DEFAULT_UPLOAD_LIMITS.attachmentMaxBytes,
      videoMaxBytes: DEFAULT_UPLOAD_LIMITS.videoMaxBytes,
      videoMaxDurationMs: 600_000,
      fallback: false,
    });
  });

  test("a refusal forgets the target's limits: the next send asks again", async () => {
    await resolveUploadLimits(api(), channel);
    invalidateUploadLimits(channel);
    channelCall.mockResolvedValue(limits(50 * MB, 3_600_000));
    expect((await resolveUploadLimits(api(), channel)).videoMaxBytes).toBe(50 * MB);
    expect(channelCall).toHaveBeenCalledTimes(2);
    // Other targets keep theirs.
    await resolveUploadLimits(api(), dm);
    invalidateUploadLimits(channel);
    await resolveUploadLimits(api(), dm);
    expect(dmCall).toHaveBeenCalledTimes(1);
  });
});

describe("formatting", () => {
  test.each([
    [100 * MB, "100 MB"],
    [2048 * MB, "2 GB"],
    [1536 * MB, "1.5 GB"],
    [500 * MB, "500 MB"],
  ])("%i bytes → %s", (bytes, text) => {
    expect(formatLimitBytes(bytes)).toBe(text);
  });

  test.each([
    [4 * 3_600_000, "4:00:00"],
    [10 * 60_000, "10:00"],
    [90 * 60_000 + 5_000, "1:30:05"],
  ])("%i ms → %s", (ms, text) => {
    expect(formatLimitDuration(ms)).toBe(text);
  });
});
