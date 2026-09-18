import type { ArgonUserProfile, EquippedCosmetic, EquippedCosmeticOption } from "@argon/glue";
import { cosmeticKinds, resolveKind } from "@/cosmetics/registry";
import { componentForKind, rendererFor } from "@/cosmetics/primitives/renderers";
import { textEffect } from "@/cosmetics/kinds/option-text-effect";
import { isCompositional, type CosmeticKindModule, type CosmeticSurface } from "@/cosmetics/types";
import type { PreviewItem, PreviewStage, PreviewVerdict } from "@/cosmetics/preview/protocol";

/**
 * Turning a catalogue row an operator is editing into a profile that wears it.
 *
 * <b>Nothing here draws anything.</b> The renderers take a profile, so the shortest honest route to
 * a real picture of an unpublished row is to make a person wearing it — then every surface, every
 * inset and every compositing rule applies by itself, and the preview cannot disagree with the
 * product because it went in through the same door.
 */

/** The one person in the preview. Fixed, so a re-render patches the card rather than remounting it. */
const PREVIEW_USER_ID = "00000000-0000-0000-0000-0000000c0de0";
const PREVIEW_ITEM_ID = "00000000-0000-0000-0000-0000000c0de1";
const PREVIEW_CARRIER_ID = "00000000-0000-0000-0000-0000000c0de2";

/** Which of the four places a surface shows up in. A surface with no stage is simply not offered. */
const STAGE_OF_SURFACE: Partial<Record<CosmeticSurface, PreviewStage>> = {
  profileCard: "profileCard",
  ownProfile: "profileCard",
  avatar: "avatar",
  nicknameInMessages: "message",
  memberListRow: "memberRow",
};


export interface PreviewResolution {
  verdict: PreviewVerdict;
  warnings: string[];
  stages: PreviewStage[];
  profile: ArgonUserProfile | null;

  /** The kind actually worn — the row's own, or the one carrying it when the row is an option. */
  worn: CosmeticKindModule | null;
}

/**
 * The kind that offers this one as an option, if any.
 *
 * <b>A colour cannot be worn.</b> An option kind has no surfaces, so a profile wearing one renders
 * nothing anywhere — and the operator authoring a typeface still has to see a name set in it. So the
 * row is composed onto whichever kind names it on an axis, and that kind is found rather than
 * written down: a new option kind becomes previewable because some kind's facet points at it, with
 * nothing here to update.
 */
function carrierFor(optionKindKey: string): { kind: CosmeticKindModule; facetId: string } | null {
  for (const kind of cosmeticKinds) {
    const facet = kind.facets?.find(candidate => candidate.optionKindKey === optionKindKey);

    if (facet) {
      return { kind, facetId: facet.id };
    }
  }

  return null;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw === "" ? "{}" : raw);
  } catch {
    return undefined;
  }
}

function assetMap(assets: readonly { slot: string; fileId: string }[] | undefined): Record<string, string> {
  const map: Record<string, string> = {};

  for (const asset of assets ?? []) {
    map[asset.slot] = asset.fileId;
  }

  return map;
}

function stagesFor(kind: CosmeticKindModule): PreviewStage[] {
  const stages: PreviewStage[] = [];

  for (const surface of kind.surfaces) {
    const stage = STAGE_OF_SURFACE[surface];

    if (stage && !stages.includes(stage)) {
      stages.push(stage);
    }
  }

  return stages;
}

/**
 * What draws, but not the way it was meant to — said before the operator concludes this is a bug.
 *
 * Every one of these is a row that publishes cleanly and renders as nothing, which is the failure
 * this page exists to catch. The server's validator reads a payload; none of it knows which files
 * this build ships or which slots somebody actually filled.
 */
function warningsFor(kind: CosmeticKindModule, item: PreviewItem): string[] {
  const warnings: string[] = [];
  const assets = assetMap(item.assets);

  if (rendererFor(kind.primitive)?.needsFile && !assets.Primary) {
    warnings.push(`${kind.key} draws the file in its Primary slot and this row has none, so nothing is drawn.`);
  }

  // A widget is a frame somebody writes into, and what they write is theirs — so the card here is
  // the empty one, and an operator looking at an empty card should be told which of the two it is.
  if (kind.board && !item.contentJson) {
    warnings.push("A widget's content is written by whoever wears it, so this card is drawn empty. Its size and its own chrome are what this row decides.");
  }

  if (kind.primitive === "videoLayer" && !assets.Poster) {
    warnings.push("No Poster file: anybody who has turned motion off sees the video's first frame instead of a still.");
  }

  if (kind.key === "option.text-effect" && !textEffect(item.slug)) {
    warnings.push(`This build ships no treatment file for the slug "${item.slug}", so the name draws untreated. A treatment is half a catalogue row and half a file in the client.`);
  }

  return warnings;
}

function equip(item: PreviewItem, kind: CosmeticKindModule): EquippedCosmetic {
  return {
    kindKey: item.kindKey,
    itemId: PREVIEW_ITEM_ID,
    slug: item.slug,
    layer: kind.layer,
    slotIndex: 0,
    payloadJson: item.payloadJson === "" ? "{}" : item.payloadJson,
    assets: item.assets ?? [],
    options: item.options ?? [],
    contentJson: item.contentJson ?? null,
    boardX: 0,
    boardY: 0,
    boardW: kind.board?.minWidth ?? 2,
    boardH: kind.board?.minHeight ?? 1,
    version: 1,
  } as unknown as EquippedCosmetic;
}

/** The row worn as one axis of the kind that offers it, that kind being worn bare otherwise. */
function equipAsOption(item: PreviewItem, carrier: { kind: CosmeticKindModule; facetId: string }): EquippedCosmetic {
  const option = {
    facetId: carrier.facetId,
    kindKey: item.kindKey,
    itemId: PREVIEW_ITEM_ID,
    slug: item.slug,
    payloadJson: item.payloadJson === "" ? "{}" : item.payloadJson,
    assets: item.assets ?? [],
    version: 1,
  } as unknown as EquippedCosmeticOption;

  return {
    kindKey: carrier.kind.key,
    itemId: PREVIEW_CARRIER_ID,
    slug: "preview",
    layer: carrier.kind.layer,
    slotIndex: 0,
    payloadJson: "{}",
    assets: [],
    options: [option],
    contentJson: null,
    boardX: 0,
    boardY: 0,
    boardW: 2,
    boardH: 1,
    version: 1,
  } as unknown as EquippedCosmetic;
}

/**
 * The person underneath, for the parts of a card that are not the cosmetic.
 *
 * No name here: the stages put the name in the slot they give the renderer, which is how a real
 * surface does it — a profile's `displayNameOverride` is the look's own override of that, and a
 * preview that set it would be previewing a second thing nobody asked about.
 */
export interface PreviewWearer {
  bio?: string | null;
  avatarFileId?: string | null;
  primaryColor?: number | null;
  accentColor?: number | null;
}

export function previewProfileFor(item: PreviewItem, wearer: PreviewWearer): PreviewResolution {
  const kind = resolveKind(item.kindKey);

  if (!kind) {
    return { verdict: "unknown-kind", warnings: [], stages: [], profile: null, worn: null };
  }

  // Asked before anything is built, because a refused payload is the answer the operator came for:
  // the renderer's refusal is a different gate from the server's validator, catches different
  // things, and is the one that decides whether anybody ever sees this row.
  const raw = parseJson(item.payloadJson);

  if (raw === undefined || kind.parsePayload(raw) === null) {
    return { verdict: "payload-rejected", warnings: [], stages: [], profile: null, worn: kind };
  }

  const carrier = isCompositional(kind) ? carrierFor(kind.key) : null;

  if (isCompositional(kind) && !carrier) {
    return {
      verdict: "no-renderer",
      warnings: [`Nothing in this build offers ${kind.key} on an axis, so there is nowhere it could be drawn.`],
      stages: [],
      profile: null,
      worn: kind,
    };
  }

  const equipped = carrier ? equipAsOption(item, carrier) : equip(item, kind);
  const worn = carrier?.kind ?? kind;

  // A kind whose primitive this build has no component for. The server knows the kind, the payload
  // validates, the row publishes — and every surface skips it in silence, which is the failure this
  // page exists to catch and the one nothing else can see.
  if (!componentForKind(worn)) {
    return {
      verdict: "no-renderer",
      warnings: [`${worn.key} is drawn as "${worn.primitive}", and this build has no renderer for that.`],
      stages: [],
      profile: null,
      worn,
    };
  }

  const profile = {
    userId: PREVIEW_USER_ID,
    displayNameOverride: null,
    avatarFileIdOverride: wearer.avatarFileId ?? null,
    customStatus: null,
    customStatusIconId: null,
    bannerFileID: null,
    dateOfBirth: null,
    bio: wearer.bio ?? null,
    badges: [],
    archetypes: [],
    backgroundId: null,
    voiceCardEffectId: null,
    avatarFrameId: null,
    nickEffectId: null,
    primaryColor: wearer.primaryColor ?? null,
    accentColor: wearer.accentColor ?? null,
    registeredAt: null,
    cosmetics: [equipped],
    loadoutId: null,
  } as unknown as ArgonUserProfile;

  return {
    verdict: "rendered",
    warnings: warningsFor(kind, item),
    stages: stagesFor(worn),
    profile,
    worn,
  };
}

export { PREVIEW_USER_ID };
