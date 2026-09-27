// Vector outline placeholders: the compressed path format Telegram uses for sticker thumbnails
// (https://core.telegram.org/api/files#vector-thumbnails), ported from tweb's getPathFromBytes.

const LOOKUP = "AACAAAAHAAALMAAAQASTAVAAAZaacaaaahaaalmaaaqastava.az0123456789-,";

/** The SVG path (`M…z`) packed in the bytes. */
export function decodeOutline(bytes: Uint8Array): string {
  let path = "M";
  for (let i = 0; i < bytes.length; ++i) {
    const num = bytes[i];
    if (num >= 128 + 64) {
      path += LOOKUP[num - 128 - 64];
    } else {
      if (num >= 128) path += ",";
      else if (num >= 64) path += "-";
      path += "" + (num & 63);
    }
  }
  return path + "z";
}

const isDigit = (code: number) => code >= 48 && code <= 57;

/**
 * The bytes for an SVG path (`M…z`): the inverse of `decodeOutline`, byte for byte the server's
 * OutlineCodec.Encode. A digit run becomes chunks of 0..63 without leading zeros ("512" → 51, 2,
 * which decode back to "51" + "2"); only the first chunk carries the ',' or '-' that preceded it.
 */
export function encodeOutline(path: string): Uint8Array {
  if (path.length < 2 || path[0] !== "M" || path[path.length - 1] !== "z") {
    throw new Error("An outline path starts with 'M' and ends with 'z'");
  }
  const body = path.slice(1, -1);
  const out: number[] = [];

  const emitDigits = (start: number, end: number, prefix: number) => {
    let i = start;
    while (i < end) {
      let value = body.charCodeAt(i) - 48;
      let length = 1;
      if (value !== 0) {
        while (i + length < end) {
          const next = value * 10 + (body.charCodeAt(i + length) - 48);
          if (next > 63) break;
          value = next;
          length++;
        }
      }
      out.push(prefix | value);
      prefix = 0;
      i += length;
    }
  };

  let i = 0;
  while (i < body.length) {
    const c = body[i];
    if ((c === "," || c === "-") && i + 1 < body.length && isDigit(body.charCodeAt(i + 1))) {
      const start = ++i;
      while (i < body.length && isDigit(body.charCodeAt(i))) i++;
      emitDigits(start, i, c === "," ? 128 : 64);
    } else if (isDigit(body.charCodeAt(i))) {
      const start = i;
      while (i < body.length && isDigit(body.charCodeAt(i))) i++;
      emitDigits(start, i, 0);
    } else {
      const index = LOOKUP.indexOf(c);
      if (index < 0) throw new Error(`'${c}' cannot be encoded in an outline path`);
      out.push(192 + index);
      i++;
    }
  }
  return Uint8Array.from(out);
}

/** A standalone SVG document with the outline, in a width×height (512×512 by default) view box. */
export function outlineSvg(bytes: Uint8Array, width = 512, height = 512, fill = "currentColor"): string {
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}">` +
    `<path fill="${fill}" d="${decodeOutline(bytes)}"/></svg>`
  );
}

/** The outline as a data URL for an `<img>` or a CSS background. */
export function outlineDataUrl(bytes: Uint8Array, width = 512, height = 512, fill = "#8884"): string {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(outlineSvg(bytes, width, height, fill))}`;
}
