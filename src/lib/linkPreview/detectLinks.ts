/**
 * Where the links are in a draft.
 *
 * The server never looks for links itself: the composer marks them as MessageEntityUrl and, for the
 * first one, asks for a preview — so this is the one place the rule lives. It accepts what Telegram
 * accepts: a scheme, a `www.` prefix, or a bare domain under a well-known top-level domain, followed
 * by an optional path. Trailing punctuation that far more often ends the sentence than the link is
 * left out, and a closing parenthesis is kept only when the link opened one (Wikipedia).
 */
export interface LinkSpan {
  /** Exactly as written: `example.com/x` */
  text: string;
  /** Absolute form, for fetching and for the card: `https://example.com/x` */
  url: string;
  domain: string;
  /** Path plus query, `/` when there is none — what MessageEntityUrl carries beside the domain. */
  path: string;
  offset: number;
  length: number;
}

/** Longer than this is not a link anybody meant to share; the server refuses it too. */
export const MAX_LINK_LENGTH = 2048;

// Bare domains (no scheme, no www.) only count under one of these. Two-letter file extensions that
// happen to be country codes (`.md`, `.js` is not one, `.ts`) are deliberately absent.
const BARE_TLDS = new Set([
  "com", "net", "org", "io", "gl", "gg", "dev", "app", "me", "co", "tv", "xyz", "info", "ai", "so",
  "to", "ly", "sh", "cc", "zone", "chat", "site", "online", "cloud", "one", "live", "wiki", "news",
  "blog", "store", "shop", "games", "game", "fm", "tech", "space", "world", "team", "art", "studio",
  "ru", "su", "ua", "by", "kz", "uk", "de", "fr", "it", "es", "pl", "nl", "se", "no", "fi", "dk",
  "cz", "ch", "at", "be", "pt", "ie", "gr", "tr", "il", "jp", "cn", "kr", "in", "br", "ar", "mx",
  "ca", "us", "au", "nz", "eu", "am", "ge", "az", "uz", "kg", "tj", "lt", "lv", "ee", "hu",
  "ro", "bg", "rs", "hr", "si", "sk", "sg", "hk", "tw", "id", "ph", "th", "vn", "my", "za", "ng",
  "eg", "sa", "ae", "ir", "pk", "bd",
]);

// Alternative 1: anything with a scheme or a www. prefix, up to whitespace or a quote.
// Alternative 2: a bare domain, not glued to a word, an @ (mail) or a dot (versions, file names).
const LINK_RE =
  /(?:https?:\/\/|www\.)[^\s<>"'`]+|(?<![\w@./-])(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+([a-z]{2,24})(?::\d{2,5})?(?:\/[^\s<>"'`]*)?(?![\w@.-]*[\w/])/gi;

const TRAILING = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", "'", '"', "»", "…", ">"]);

function trimTrailing(raw: string): string {
  let end = raw.length;
  while (end > 0) {
    const ch = raw[end - 1];
    if (!TRAILING.has(ch)) break;
    if (ch === ")") {
      // A link that opened a parenthesis may close it: en.wikipedia.org/wiki/Foo_(bar)
      const body = raw.slice(0, end);
      const opens = (body.match(/\(/g) ?? []).length;
      const closes = (body.match(/\)/g) ?? []).length;
      if (opens >= closes) break;
    }
    end--;
  }
  return raw.slice(0, end);
}

function parse(text: string): { url: string; domain: string; path: string } | null {
  const withScheme = /^https?:\/\//i.test(text) ? text : `https://${text}`;
  let url: URL;
  try {
    url = new URL(withScheme);
  } catch {
    return null;
  }
  if (!url.hostname || url.username || url.password) return null;
  return {
    url: url.href,
    domain: url.hostname.toLowerCase(),
    path: `${url.pathname}${url.search}`,
  };
}

export function findLinks(text: string): LinkSpan[] {
  const links: LinkSpan[] = [];
  if (!text) return links;

  LINK_RE.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = LINK_RE.exec(text)) !== null) {
    const raw = trimTrailing(match[0]);
    if (raw.length === 0) continue;

    const bareTld = match[1];
    if (bareTld !== undefined && !BARE_TLDS.has(bareTld.toLowerCase())) continue;
    if (raw.length > MAX_LINK_LENGTH) continue;

    const parsed = parse(raw);
    if (!parsed) continue;

    links.push({ text: raw, ...parsed, offset: match.index, length: raw.length });
  }
  return links;
}

/** The link a preview is about: Telegram shows a card for the first one only. */
export function firstLink(text: string): LinkSpan | null {
  return findLinks(text)[0] ?? null;
}
