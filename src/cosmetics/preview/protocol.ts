/**
 * What the admin console says to the preview page, and what it hears back.
 *
 * <b>The console does not draw cosmetics.</b> It cannot: a second renderer over there would drift
 * from this one, and an operator approving a drifted drawing publishes something nobody has seen.
 * So the console frames `cosmetic-preview.html` from this build and posts it a row; the picture that
 * comes back is drawn by the same files that draw a real profile.
 *
 * The two sides are different repositories, so this file is duplicated there by hand. It is kept
 * small and versioned for exactly that reason: `PREVIEW_PROTOCOL` is what a console of one age and a
 * client of another compare before either trusts the other.
 */

export const PREVIEW_CHANNEL = "argon.cosmetic-preview";

/**
 * Raised when a message's meaning changes, never when a field is added.
 *
 * The far side is deployed separately and may be older or newer than this one, which makes silence
 * about the version the one failure nobody would notice — a console showing a stale drawing looks
 * exactly like a console showing a fresh one.
 */
export const PREVIEW_PROTOCOL = 1;

/** Where the operator is asking to see the thing: the four places a cosmetic can show up. */
export type PreviewStage = "profileCard" | "memberRow" | "message" | "avatar";

export interface PreviewAsset {
  slot: string;
  fileId: string;
}

/**
 * One option composed onto the row being previewed.
 *
 * Carries the slug as well as the payload because a treatment is selected by slug — the row names
 * the file in `effects/`, and a row whose slug this build has no file for draws untreated.
 */
export interface PreviewOption {
  facetId: string;
  kindKey: string;
  slug: string;
  payloadJson: string;
  assets: PreviewAsset[];
}

/**
 * The row as it stands in the editor — including edits nobody has saved yet.
 *
 * That is the point of the whole arrangement: the operator is looking at what they are about to
 * publish, not at what is already stored.
 */
export interface PreviewItem {
  kindKey: string;
  slug: string;
  payloadJson: string;
  assets: PreviewAsset[];

  /** What a wearer would have written into a board card. Null for everything that is not one. */
  contentJson?: string | null;

  options?: PreviewOption[];
}

/** The person the thing is drawn on, so a frame is previewed around a face and a name. */
export interface PreviewSample {
  displayName: string;
  username: string;
  avatarFileId?: string | null;
  bio?: string | null;

  /** ARGB, as the profile carries them: the card's own colours under whatever is worn over them. */
  primaryColor?: number | null;
  accentColor?: number | null;
}

export interface PreviewRenderCommand {
  channel: typeof PREVIEW_CHANNEL;
  v: number;
  type: "render";

  item: PreviewItem;
  stage: PreviewStage;
  theme: "dark" | "light" | "oled";

  /** False draws the still frame of everything that moves, the way the accessibility switch does. */
  motion: boolean;

  sample: PreviewSample;

  /**
   * How much bigger than life to draw it, for looking closely at a thin edge or a small mark.
   *
   * Applied here rather than to the frame around this page: scaling the iframe would scale the
   * blur, the hairlines and the text rendering along with it, and the operator would be judging a
   * photograph of the thing instead of the thing.
   */
  zoom?: number;

  /**
   * Where this stand's files are: `${fileBase}/${fileId}`.
   *
   * Sent rather than assumed, because the console administers whichever stand it is pointed at and
   * this page is served by whichever client is deployed beside it — a local api, a staging one, the
   * CDN. Nothing here is fetched with credentials; these files are public by design.
   */
  fileBase: string;
}

export type PreviewCommand = PreviewRenderCommand;

/** One kind this build of the client ships, as the console needs to know it. */
export interface PreviewKindReport {
  key: string;
  primitive: string;
  surfaces: string[];
  facets: { id: string; optionKindKey: string }[];
  bare: boolean;
}

/**
 * Sent once, unprompted, as soon as the page is up.
 *
 * <b>It is also the console's answer to "can the thing I am authoring be drawn at all".</b> A kind
 * missing from this list is a kind the deployed client has no file for, which no server-side
 * validator can tell anybody: the row would publish, and render as nothing.
 */
export interface PreviewReadyEvent {
  channel: typeof PREVIEW_CHANNEL;
  v: number;
  type: "ready";
  kinds: PreviewKindReport[];
}

/**
 * What the renderer made of the row.
 *
 * `rendered` is the only verdict that means the operator is looking at the finished thing; the rest
 * say why they are not, in the renderer's own terms rather than the validator's.
 */
export type PreviewVerdict = "rendered" | "unknown-kind" | "payload-rejected" | "no-renderer";

export interface PreviewResultEvent {
  channel: typeof PREVIEW_CHANNEL;
  v: number;
  type: "result";

  verdict: PreviewVerdict;

  /** Things that draw, but not as the operator probably intends — a missing file, a missing slug. */
  warnings: string[];

  /** The stages this row can honestly be shown on, from the kind's own surfaces. */
  stages: PreviewStage[];

  /** How tall the drawing came out, so the frame around it can be exactly that tall. */
  height: number;

  /**
   * What it was actually drawn at, which is not always what was asked for.
   *
   * A profile card is 320 pixels wide before a frame hangs anything outside it, and the panel
   * framing this page can be narrower than that. Life size in a box too small for it is a drawing
   * with its edges out of sight behind a scrollbar — the edges being the part of a frame somebody is
   * looking at — so the page shrinks it to fit instead, and says so here rather than letting the
   * console keep claiming 100%.
   */
  scale: number;
}

export type PreviewEvent = PreviewReadyEvent | PreviewResultEvent;

export function isPreviewCommand(data: unknown): data is PreviewCommand {
  if (typeof data !== "object" || data === null) return false;

  const message = data as Partial<PreviewCommand>;

  return message.channel === PREVIEW_CHANNEL && message.type === "render" && typeof message.item === "object";
}
