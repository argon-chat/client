interface ReadColour {
  readonly channels: readonly number[];

  /** As written, so it survives the mix unchanged; null when the colour carried none. */
  readonly alpha: string | null;
}

const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

const RGB_PATTERN = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)\s*(?:[,/]\s*([\d.]+%?)\s*)?\)$/i;

function readColour(colour: string): ReadColour | null {
  if (HEX_PATTERN.test(colour)) {
    const value = Number.parseInt(colour.slice(1), 16);

    return {
      channels: [(value >> 16) & 0xff, (value >> 8) & 0xff, value & 0xff],
      alpha: null,
    };
  }

  const parsed = RGB_PATTERN.exec(colour);

  if (parsed === null) {
    return null;
  }

  return {
    channels: [Number(parsed[1]), Number(parsed[2]), Number(parsed[3])],
    alpha: parsed[4] ?? null,
  };
}

function toHex(channels: readonly number[]): string {
  const digits = channels.map(channel => channel.toString(16).padStart(2, "0"));

  return `#${digits.join("")}`;
}

/** Towards white (255) or black (0); a colour it cannot read comes back as it was. */
function mix(colour: string, towards: number, amount: number): string {
  const read = readColour(colour);

  if (read === null) {
    return colour;
  }

  const blended = read.channels.map(channel => Math.round(channel + (towards - channel) * amount));

  if (read.alpha === null) {
    return toHex(blended);
  }

  return `rgba(${blended.join(", ")}, ${read.alpha})`;
}

export function lightenColour(colour: string, amount: number): string {
  return mix(colour, 255, amount);
}

export function shadeColour(colour: string, amount: number): string {
  return mix(colour, 0, amount);
}
