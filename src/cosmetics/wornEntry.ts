import type {
  WornItem,
  WornNickname,
} from "@argon/glue";

// Read by key rather than through the isX() guards: a union that went through IndexedDB comes back
// as a plain object, with the key and fields intact and the prototype gone.
export function unionKeyOf(value: unknown): string | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }

  const unionKey = (value as { UnionKey?: unknown }).UnionKey;

  return typeof unionKey === "string" ? unionKey : null;
}

export function asWornItem(worn: unknown): WornItem | null {
  if (unionKeyOf(worn) !== "WornItem") {
    return null;
  }

  return typeof (worn as WornItem).itemId === "string" ? worn as WornItem : null;
}

export function asWornNickname(worn: unknown): WornNickname | null {
  return unionKeyOf(worn) === "WornNickname" ? worn as WornNickname : null;
}
