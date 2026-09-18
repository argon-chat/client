import type { Component } from "vue";
import type { EquippedCosmetic, EquippedCosmeticOption } from "@argon/glue";

/**
 * Where a cosmetic is allowed to render. Mirrors the server's CosmeticSurface, and a kind names
 * every surface it belongs on rather than being wired into a component.
 */
export type CosmeticSurface =
  | "profileCard"
  | "ownProfile"
  | "avatar"
  | "nicknameInMessages"
  | "memberListRow"
  | "voiceCard"
  | "banner"
  | "status";

/**
 * The closed set of renderers. A kind picks one; it does not ship a component.
 *
 * Adding a member here is a client release by definition, which is the point: new *items* of an
 * existing kind need no deploy at all, and that is where the flexibility lives.
 */
export type RenderPrimitive =
  | "imageLayer"
  | "videoLayer"
  | "spriteSheet"

  /**
   * A frame around a profile card, assembled out of parts an operator arranged with numbers.
   *
   * It replaced a primitive that drew one coloured ring, which is the only shape four numbers can
   * describe. A frame that surrounds a card, or lies along its top alone, or hangs a character over
   * its edge, is a *list* of parts — and no existing primitive can express a list of anything, which
   * is the bar a new member here has to clear.
   */
  | "frameAssembly"

  | "textStyle"
  | "iconBadge"
  | "widgetSlot"

  /**
   * A picture laid over a whole profile card — a frame around it, or something moving across it.
   *
   * Distinct from an imageLayer, which is fitted inside the thing it decorates. This one is stretched
   * or cropped to the card's own shape, and the surfaces that draw a card keep it in a slot of its
   * own: over everything rather than under it.
   */
  | "cardLayer"

  /**
   * Bodies travelling a ring around an avatar, drawn with a near half and a far half.
   *
   * <b>What no other member can express is occlusion.</b> Everything above draws a layer, and a
   * layer is on one side of the thing it decorates — no inset, opacity or z-order puts half of a
   * picture behind a head and the other half in front of it, because the picture is one layer and
   * the head is one box.
   */
  | "orbitStage"

  /**
   * Actors moving across a whole profile card, each in its own band of depth.
   *
   * <b>What no other member can express is a list of moving things at different depths.</b> A
   * `cardLayer` is one picture fitted to the card and a `frameAssembly` is pieces pinned to its
   * edges standing still. Neither can put a figure in front of the card's own text while a scatter
   * of something else falls behind its glass, and neither has anywhere to put a path.
   *
   * Unlike a frame, it is bounded by the card: a scene clips. Something that both moves and leaves
   * the card is something that moves over somebody else's messages.
   */
  | "sceneStage";

export type CosmeticScope = "global" | "perSpace" | "both";

/**
 * One axis of a kind — a dimension the wearer composes rather than the operator authors.
 *
 * <b>This is what keeps the catalogue from having to enumerate combinations.</b> A nickname style is
 * one catalogue row with three axes; without them, every face crossed with every treatment crossed
 * with every colour would have had to be a row somebody authored, licensed and published.
 *
 * An axis lists nothing. It names the kind whose items are its options, so which faces or colours
 * exist is whatever rows that kind has — and adding one is a row created from the admin console, not
 * a release. The editor draws one picker per axis and knows what none of them mean.
 */
export interface CosmeticFacet {
  readonly id: string;
  readonly labelKey: string;

  /** The kind whose catalogue rows are this axis's options. */
  readonly optionKindKey: string;
}

/**
 * One kind of cosmetic, declared in exactly one file under `kinds/`.
 *
 * Deleting that file removes the kind: the registry stops resolving its key, every surface skips
 * rows carrying it, and nothing else has to be touched. Adding one is the same in reverse.
 */
export interface CosmeticKindModule<TPayload = unknown> {
  /** Must match the server's kind key exactly — it is what arrives on the wire. */
  readonly key: string;

  /**
   * Empty for a kind whose items are only ever options on another kind's axis. Such a kind belongs
   * in a picker on that axis and never in the wardrobe, which is exactly what having no surface to
   * appear on means.
   */
  readonly surfaces: readonly CosmeticSurface[];

  readonly primitive: RenderPrimitive;

  /** Compositing order within a surface, low to high. Mirrors the server's declaration. */
  readonly layer: number;

  /**
   * How many of this kind may be worn at once. Mirrors the server's <c>MaxSlots</c>, and one unless
   * the kind says otherwise — a person has one background and several badges.
   */
  readonly maxSlots?: number;

  readonly scope: CosmeticScope;

  /** Translation key for the kind's name in a picker. */
  readonly labelKey: string;

  /** The axes this kind lets its wearer compose. Absent for a kind worn exactly as authored. */
  readonly facets?: readonly CosmeticFacet[];

  /**
   * Set for a card on the profile board: what its wearer writes into it, and how wide it may be.
   *
   * <b>This is the difference between a widget and everything else.</b> A background is something an
   * operator authored and a person wears; a widget is a frame a person writes into. So the catalogue
   * row still says what the card is, and this says what may go in it — which means inventing a new
   * widget is a content type, a card component and an editor, and the board it lands on already
   * knows how to hold it.
   */
  readonly board?: CosmeticBoardModule;

  /**
   * The part of this kind only its wearer decides, for a kind that is not a board card.
   *
   * A catalogue row says what a thing is; some things also have a part nobody else can choose on
   * your behalf — the colours of your own name — and that is neither a pick from a list nor
   * something an operator can author for you. It rides the same field as a card's content, because
   * "what the wearer wrote" is one idea.
   */
  readonly tuning?: CosmeticTuningModule;

  /**
   * Whether this kind has no catalogue rows and is configured rather than chosen.
   *
   * For a kind whose whole appearance comes from its axes and its wearer's tuning. A row for one of
   * those carries nothing — no payload anybody sees, no asset, nothing to tell two of them apart —
   * so a picker of them is a choice that does not exist. Mirrors the server's declaration.
   */
  readonly bare?: boolean;

  /**
   * Turns a stored payload into something this kind's primitive can render, or null when it cannot.
   *
   * Never throws. The payload crosses the wire as text because the server has no open schema for
   * it, so this is the only place that checks it — and a cosmetic authored against a newer build
   * must degrade to "not rendered" rather than taking a profile card down with it.
   */
  parsePayload(raw: unknown): TPayload | null;

  /**
   * How far a worn item of this kind pushes the surface's own content in, per side, in pixels.
   *
   * <b>The one thing a cosmetic is allowed to say about the layout around it.</b> A frame heavy
   * enough to lie over the top of a card would otherwise put somebody's avatar under a branch, and
   * the card cannot work that out for itself — only the thing being worn knows how much of itself is
   * opaque.
   *
   * Left out by everything that simply draws in the space it is given, which is almost everything.
   */
  insetsOf?(item: ResolvedCosmetic<TPayload>): CosmeticEdges;

  /**
   * How far a worn item of this kind reaches outside the surface, per side, in pixels.
   *
   * <b>The other half of the same seam, and the half every preview needs.</b> A frame is allowed
   * outside the card it decorates — that is the whole point of it — but a card is not always alone
   * on a screen. A profile popover floats over a page and can let the thing overhang; a card sitting
   * in a settings column has a row of buttons above it, and a picker draws a grid of them side by
   * side. Those hosts reserve exactly this much room, and the frame is unchanged either way.
   *
   * Asking the worn thing rather than guessing: only it knows how far it goes, and a constant large
   * enough for the worst frame would put a hole around every modest one.
   */
  outsetsOf?(item: ResolvedCosmetic<TPayload>): CosmeticEdges;

  /**
   * Which of the surface's own edges this covers, so the surface stops drawing them.
   *
   * <b>A frame is the card's edge, not something lying on top of one.</b> Art has gaps in it — the
   * spaces between thorns, the light through leaves — and a card that goes on drawing its own hairline
   * puts a thin grey rule through every one of them. Seen once it cannot be unseen, and it is the
   * difference between a frame and a sticker.
   *
   * Per side, because a band along the top alone covers the top alone: hiding all four there would
   * leave the card's other three edges missing for no reason.
   */
  hidesEdges?(item: ResolvedCosmetic<TPayload>): CosmeticSides;

  /**
   * The escape hatch, and it should stay rare: a kind whose rendering no primitive can express.
   * When set, it is used instead of the primitive.
   */
  readonly component?: Component;

  /**
   * How one of this kind's rows draws itself in an axis picker. Compositional kinds supply it,
   * because only the kind knows whether its rows are colours, faces or treatments — a picker that
   * decided by kind key would be the one file every new option kind had to be added to.
   */
  readonly chip?: Component;
}

export function slotsOf(kind: CosmeticKindModule): number {
  return Math.max(1, kind.maxSlots ?? 1);
}

/**
 * The card width a cosmetic's pixels are authored against.
 *
 * <b>Anything drawing one smaller works out its scale from this and its own width.</b> A frame is a
 * band 34 pixels thick and a piece 108 pixels off centre; on the picker's 190px stage those same
 * numbers put both pieces off the sides of the box, which is precisely what happened before this
 * constant existed and every preview picked a scale by eye.
 *
 * It is the profile popover's width, because that is the card people actually look at.
 */
export const AUTHORED_CARD_WIDTH = 384;

/** A measurement per side of a box, in pixels: top, right, bottom, left. */
export interface CosmeticEdges {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
}

export const NO_EDGES: CosmeticEdges = { top: 0, right: 0, bottom: 0, left: 0 };

/** One yes or no per side of a box. */
export interface CosmeticSides {
  readonly top: boolean;
  readonly right: boolean;
  readonly bottom: boolean;
  readonly left: boolean;
}

export const NO_SIDES: CosmeticSides = { top: false, right: false, bottom: false, left: false };

/** Every edge that anything worn here covers. One thing covering a side is enough. */
export function hiddenEdges(worn: readonly ResolvedCosmetic[]): CosmeticSides {
  let top = false;
  let right = false;
  let bottom = false;
  let left = false;

  for (const item of worn) {
    const covered = item.kind.hidesEdges?.(item);

    if (!covered) continue;

    top ||= covered.top;
    right ||= covered.right;
    bottom ||= covered.bottom;
    left ||= covered.left;
  }

  return { top, right, bottom, left };
}

/**
 * The room everything worn here asks for, taken side by side rather than added up.
 *
 * Two things asking for the top both want to be clear of it, and the one asking for more is already
 * clear of the other — adding them would indent a card by the sum of two overlapping branches.
 */
function widest(worn: readonly ResolvedCosmetic[], ask: (item: ResolvedCosmetic) => CosmeticEdges | undefined): CosmeticEdges {
  let top = 0;
  let right = 0;
  let bottom = 0;
  let left = 0;

  for (const item of worn) {
    const asked = ask(item);

    if (!asked) continue;

    top = Math.max(top, asked.top);
    right = Math.max(right, asked.right);
    bottom = Math.max(bottom, asked.bottom);
    left = Math.max(left, asked.left);
  }

  return { top, right, bottom, left };
}

/** How far the worn things here push the surface's own content in. */
export function insetsOf(worn: readonly ResolvedCosmetic[]): CosmeticEdges {
  return widest(worn, item => item.kind.insetsOf?.(item));
}

/** How far the worn things here reach outside the surface. */
export function outsetsOf(worn: readonly ResolvedCosmetic[]): CosmeticEdges {
  return widest(worn, item => item.kind.outsetsOf?.(item));
}

export interface CosmeticTuningModule<TContent = unknown> {
  /** What this starts out holding, before its wearer has decided anything. */
  empty(): TContent;

  /** Never throws: tuning written against a newer build has to degrade, not break a profile. */
  parse(raw: unknown): TContent | null;

  /** Whether there is anything worth sending, so an untouched form writes nothing. */
  isEmpty(value: TContent): boolean;

  /**
   * Whether this row is one the form has anything to say about. Absent means always.
   *
   * <b>Because a kind's tuning is not always a kind-wide question.</b> A scene asks its wearer how
   * much of the card to play on — but only when the row it came from says the wearer may decide; one
   * authored to take the whole card bottom to top has one answer and no question. Without this the
   * picker offers a dial that changes nothing, which is worse than offering none: it reads as a
   * setting that is broken rather than as a setting that does not apply.
   */
  appliesTo?(payload: unknown): boolean;

  /** The form its wearer fills in. */
  readonly editor: Component;
}

export interface CosmeticBoardModule<TContent = unknown> {
  /** How big this card may be made, in grid cells. Mirrors the server's declaration. */
  readonly minWidth: number;
  readonly maxWidth: number;
  readonly minHeight: number;
  readonly maxHeight: number;

  /** What a card starts out holding, before its wearer has written anything. */
  empty(): TContent;

  /** Never throws: content authored against a newer build has to degrade, not break a profile. */
  parse(raw: unknown): TContent | null;

  /** Draws the card on a profile. */
  readonly card: Component;

  /**
   * What this card is, drawn, for the picker that offers it.
   *
   * <b>A footprint is not a preview.</b> The offers were three identical blue rectangles differing
   * only in proportion, which said how much room each takes and nothing about what any of them is —
   * and a card is chosen for what it is. Left out, the offer falls back to the footprint.
   */
  readonly preview?: Component;

  /** The form its wearer fills in. */
  readonly editor: Component;
}

/** One card's place on the profile board, in grid cells. */
export interface CosmeticBoardCell {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

/**
 * How wide the board is.
 *
 * Four rather than two, because two columns can only ever be symmetrical: a card is left or right
 * and nothing sits in the middle. Four lets a half-width card be centred and a board be deliberately
 * lopsided, which is what people actually arrange things to be.
 *
 * Fixed rather than a setting: a card's width is stored in columns, so changing how many there are
 * would resize every card anybody ever placed.
 */
export const BOARD_COLUMNS = 4;

/**
 * How tall the board may get. Mirrors the server's own limit.
 *
 * A profile is as tall as the lowest card on it, so an unbounded board is an unbounded profile —
 * one person dragging a card a long way down stretched the card of everybody looking at them.
 */
export const BOARD_ROWS = 16;

/** Whether this kind's items are options rather than things to wear. */
export function isCompositional(kind: CosmeticKindModule): boolean {
  return kind.surfaces.length === 0;
}

/**
 * One option the wearer chose on an axis, already resolved: the row it came from, its payload, and
 * whatever file it carries.
 */
export interface ResolvedOption<TPayload = unknown> {
  readonly facetId: string;
  readonly kindKey: string;
  readonly itemId: string;
  readonly slug: string;
  readonly payload: TPayload;
  readonly assets: Readonly<Record<string, string>>;

  /** As on the worn row: an option is a catalogue row and can be re-authored under a held copy. */
  readonly version: number | null;
}

/**
 * One equipped cosmetic, ready to render: payload parsed, kind resolved, assets in hand, and the
 * options the wearer composed it from.
 */
export interface ResolvedCosmetic<TPayload = unknown> {
  readonly itemId: string;
  readonly slug: string;
  readonly kind: CosmeticKindModule<TPayload>;
  readonly layer: number;
  readonly slotIndex: number;
  readonly payload: TPayload;

  /** Asset slot name to file id. URLs are built with cdnUrl() at render time, never stored. */
  readonly assets: Readonly<Record<string, string>>;

  readonly options: readonly ResolvedOption[];

  /** What the wearer wrote into this card, and its place on the grid. Null for anything else. */
  readonly content: unknown;
  readonly cell: CosmeticBoardCell;

  /**
   * Which authoring of the catalogue row this is, or null from a server that does not say.
   *
   * Kept through the parse so a held copy can be compared with the catalogue's. Nothing renders it;
   * it is how a profile cached before an operator re-authored the row gets found and dropped.
   */
  readonly version: number | null;
}

export function assetsOf(equipped: EquippedCosmetic | EquippedCosmeticOption): Record<string, string> {
  const assets: Record<string, string> = {};

  for (const asset of equipped.assets) {
    assets[asset.slot] = asset.fileId;
  }

  return assets;
}

/** The option on a given axis, or undefined when nothing was chosen there. */
export function optionOn(cosmetic: ResolvedCosmetic, facetId: string): ResolvedOption | undefined {
  return cosmetic.options.find(option => option.facetId === facetId);
}

/** Helper that keeps a kind file's declaration type-checked without repeating the generic. */
export function defineCosmeticKind<TPayload>(module: CosmeticKindModule<TPayload>): CosmeticKindModule<TPayload> {
  return module;
}
