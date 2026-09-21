import { argbToRgb } from "@/lib/profileCustomization";
import { resolveMotion } from "@/cosmetics/frameMotion";
import type {
  FrameAnchor,
  FramePart,
  FramePropPart,
  FrameRingPart,
  FrameSides,
  FrameSurroundPart,
} from "@/cosmetics/kinds/profile-frame";

/**
 * Where a frame's parts go and what they are painted with, as plain objects.
 *
 * Kept out of the component and free of anything that has to be mounted, because the arithmetic
 * here is the part worth testing: an anchor whose signs run the wrong way puts somebody's ornament
 * on the far side of their card; a nine-slice whose widths and outsets are swapped puts the band
 * inside the card instead of around it. None of that is a type error and none of it is visible in
 * a diff.
 *
 * <b>Everything here takes a scale.</b> A frame is authored in pixels against a real card, and the
 * same row has to draw in a 130px tile in a picker. Scaling the numbers is the only honest way to
 * shrink it — the alternative is a transform on a wrapper, and the parts are positioned against the
 * card rather than against each other, so there is no one box to transform.
 */

/**
 * Over the card's own content, level with a card effect; or under it, above the background.
 *
 * The numbers are the profile card's, not this file's invention — its background sits at 0, its
 * spacer at 1, its glass at 2, and anything laid over the whole card at 4.
 */
const OVER = "4";
const UNDER = "0";

type Style = Record<string, string>;

export function placementOf(part: FramePart, scale = 1): Style {
  const style: Style = {
    position: "absolute",
    zIndex: part.over ? OVER : UNDER,
    opacity: String(part.opacityPct / 100),
    pointerEvents: "none",
  };

  if (part.type !== "prop") {
    style.inset = "0";
    style.borderRadius = "inherit";

    if (part.type === "ring" && part.glowPct > 0) {
      // On the outer rather than beside the paint: a part can also be wearing a movement that
      // animates `filter`, and the two cannot share one element without one of them winning.
      const colours = part.colors.map(argbToRgb);

      style.filter = `drop-shadow(0 0 ${at(part.thickness * 3, scale)}px ${colours[colours.length - 1]})`;
    }

    return style;
  }

  return { ...style, ...propPlacement(part, scale) };
}

/**
 * Where a piece is pinned, in the card's own coordinates.
 *
 * A piece is placed <i>outside, touching</i>: anchored to `top`, its lower edge rests on the card's
 * upper edge, so with no offset it is entirely above the card. Offsets are read the way a screen is
 * — right and down are positive — so a positive `dy` on a top anchor drags the piece down onto the
 * card, and on a bottom anchor drags it further off.
 */
function propPlacement(part: FramePropPart, scale: number): Style {
  const w = at(part.w, scale);
  const h = at(part.h, scale);
  const dx = at(part.dx, scale);
  const dy = at(part.dy, scale);

  const style: Style = {
    width: `${w}px`,
    height: `${h}px`,
  };

  const above = nudge("100%", -dy);
  const below = nudge("100%", dy);
  const beside = nudge("100%", -dx);
  const outside = nudge("100%", dx);
  const acrossX = nudge("50%", dx);
  const acrossY = nudge("50%", dy);

  switch (part.anchor) {
    case "top":
      style.bottom = above;
      style.left = acrossX;
      style.transform = "translateX(-50%)";
      break;

    case "bottom":
      style.top = below;
      style.left = acrossX;
      style.transform = "translateX(-50%)";
      break;

    case "left":
      style.right = beside;
      style.top = acrossY;
      style.transform = "translateY(-50%)";
      break;

    case "right":
      style.left = outside;
      style.top = acrossY;
      style.transform = "translateY(-50%)";
      break;

    case "topLeft":
      style.bottom = above;
      style.right = beside;
      break;

    case "topRight":
      style.bottom = above;
      style.left = outside;
      break;

    case "bottomLeft":
      style.top = below;
      style.right = beside;
      break;

    case "bottomRight":
      style.top = below;
      style.left = outside;
      break;

    case "center":
      style.left = acrossX;
      style.top = acrossY;
      style.transform = "translate(-50%, -50%)";
      break;
  }

  return style;
}

/**
 * The point a part turns about, taken from where it is attached rather than from its middle.
 *
 * A piece sitting on the top edge rocks about its base and one hanging off the left rocks about its
 * right — which is why a movement file cannot decide this and the geometry can.
 */
export function originOf(part: FramePart): string {
  if (part.type !== "prop") return "50% 50%";

  return PIVOTS[part.anchor];
}

const PIVOTS: Record<FrameAnchor, string> = {
  top: "50% 100%",
  bottom: "50% 0%",
  left: "100% 50%",
  right: "0% 50%",
  topLeft: "100% 100%",
  topRight: "0% 100%",
  bottomLeft: "100% 0%",
  bottomRight: "0% 0%",
  center: "50% 50%",
};

/**
 * What the part is painted with, and where in a strip of frames it starts.
 *
 * `url` is null when the item carries no file in the slot the part named — an operator who has
 * created the row but not finished uploading to it. The part then draws nothing rather than a
 * broken image.
 */
export function paintOf(part: FramePart, url: string | null, reduced: boolean, scale = 1): Style | null {
  const style: Style = {
    position: "absolute",
    inset: "0",
    transformOrigin: originOf(part),
  };

  if (part.type === "ring")
    return { ...style, ...ringPaint(part, scale) };

  if (url === null) return null;

  if (part.type === "surround")
    return { ...style, ...surroundPaint(part, url, scale) };

  return { ...style, ...propPaint(part, url, reduced, scale) };
}

/**
 * The band, as a nine-slice.
 *
 * <b>`border-image` is the whole of it.</b> The corners are drawn at their own size while the edges
 * between them stretch or repeat, which is the one thing a picture pulled to a card cannot do — and
 * `border-image-outset` puts the band outside the card for free, by the same property that draws it.
 *
 * A side whose width is zero is a side with no band on it, and that is where a frame's shape comes
 * from. Note that the property deciding this is `border-image-width` and not `border-width`: setting
 * only the second leaves the image drawn on all four sides. Both come off the same four numbers so
 * they cannot drift. `border-style` has to be set for any of it to be drawn at all, even with a
 * width of zero and a colour nobody will ever see.
 *
 * The slice is the one measurement that is <i>not</i> scaled: it says where to cut the source
 * picture, in that picture's own pixels, and shrinking a frame does not move the cut.
 */
function surroundPaint(part: FrameSurroundPart, url: string, scale: number): Style {
  const width = px(part.width, scale);

  return {
    boxSizing: "border-box",
    borderStyle: "solid",
    borderColor: "transparent",
    borderWidth: width,
    borderImageSource: `url("${url}")`,
    borderImageSlice: part.slice.join(" ") + (part.fill ? " fill" : ""),
    borderImageWidth: width,
    borderImageOutset: px(part.outset, scale),
    borderImageRepeat: part.repeat,
  };
}

function propPaint(part: FramePropPart, url: string, reduced: boolean, scale: number): Style {
  const style: Style = {
    backgroundImage: `url("${url}")`,
    backgroundRepeat: "no-repeat",
  };

  if (part.sprite === null) {
    style.backgroundSize = "contain";
    style.backgroundPosition = "center";

    return style;
  }

  const { frames, columns, still } = part.sprite;
  const rows = frames / columns;
  const cellWidth = at(part.w, scale);
  const cellHeight = at(part.h, scale);

  style.backgroundSize = `${columns * 100}% ${rows * 100}%`;

  // The sheet is walked in pixels, not per cent: a percentage background position is a fraction of
  // the room left over, so the same value would land on a different frame for every strip length.
  style["--cf-sprite-x"] = `${-columns * cellWidth}px`;
  style["--cf-sprite-y"] = `${-rows * cellHeight}px`;

  if (reduced) {
    style.backgroundPositionX = `${-(still % columns) * cellWidth}px`;
    style.backgroundPositionY = `${-Math.floor(still / columns) * cellHeight}px`;
  }

  return style;
}

/**
 * The painted border: a sheet of colour with the middle cut out of it.
 *
 * The one part that takes the card's own radius, because it is the one part that is not a picture —
 * art brings its own corner shape and this has to borrow one.
 */
function ringPaint(part: FrameRingPart, scale: number): Style {
  const colours = part.colors.map(argbToRgb);
  const paint = colours.length > 1
    ? `linear-gradient(${part.angle}deg, ${colours.join(", ")})`
    : `linear-gradient(${colours[0]}, ${colours[0]})`;

  return {
    borderRadius: "inherit",
    padding: `${at(part.thickness, scale)}px`,
    background: paint,
    mask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
    maskComposite: "exclude",
    WebkitMask: "linear-gradient(#000 0 0) content-box, linear-gradient(#000 0 0)",
    WebkitMaskComposite: "xor",
  };
}

/**
 * Everything animating on this part at once: the movement it was given, and the strip of frames it
 * is drawn from, which are independent and can both be running.
 */
export function animationOf(part: FramePart, reduced: boolean): Style {
  if (reduced) return {};

  const running: string[] = [];
  const style: Style = {};

  if (part.motion !== null) {
    const motion = resolveMotion(part.motion.kind);

    // A movement released after this build. The part draws and stands still, which is how every
    // unknown thing degrades here.
    if (motion) {
      running.push(motion.animation(part.motion));
      style["--cf-amount"] = String(part.motion.amount);
    }
  }

  if (part.type === "prop" && part.sprite !== null) {
    const { frames, columns, fps } = part.sprite;
    const rows = frames / columns;

    running.push(`cosmetic-frame-sprite-x ${(columns / fps) * 1000}ms steps(${columns}) infinite`);
    running.push(`cosmetic-frame-sprite-y ${(frames / fps) * 1000}ms steps(${rows}) infinite`);
  }

  if (running.length > 0) style.animation = running.join(", ");

  return style;
}

/**
 * A measurement at the size this frame is being drawn.
 *
 * Rounded to a hundredth rather than to a pixel: at a third of size the difference between 11.33
 * and 11 is a band that misses the card's edge, and the browser draws fractions perfectly well.
 */
function at(value: number, scale: number): number {
  return scale === 1 ? value : Math.round(value * scale * 100) / 100;
}

function px(sides: FrameSides, scale: number): string {
  return `${at(sides[0], scale)}px ${at(sides[1], scale)}px ${at(sides[2], scale)}px ${at(sides[3], scale)}px`;
}

/**
 * An edge, moved by a signed number of pixels.
 *
 * The sign is folded into the operator rather than into the operand: `calc(100% + -10px)` parses,
 * but it is the sort of thing an engine or a minifier eventually disagrees about, and there is no
 * reason to find out which.
 */
function nudge(base: string, delta: number): string {
  if (delta === 0) return base;

  return delta > 0 ? `calc(${base} + ${delta}px)` : `calc(${base} - ${-delta}px)`;
}
