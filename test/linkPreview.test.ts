import { describe, expect, it } from "vitest";
import { findLinks, firstLink } from "@/lib/linkPreview/detectLinks";

describe("findLinks", () => {
  it("finds a full URL and leaves the sentence's period behind", () => {
    const [link] = findLinks("read https://example.com/docs/intro.");
    expect(link).toMatchObject({
      text: "https://example.com/docs/intro",
      url: "https://example.com/docs/intro",
      domain: "example.com",
      path: "/docs/intro",
      offset: 5,
      length: 30,
    });
  });

  it("keeps a query string and the path exactly as written", () => {
    const [link] = findLinks("https://Example.com/A?b=1&c=2");
    expect(link.domain).toBe("example.com");
    expect(link.path).toBe("/A?b=1&c=2");
    expect(link.text).toBe("https://Example.com/A?b=1&c=2");
  });

  it("accepts www. and bare domains under known TLDs, and makes them https", () => {
    const links = findLinks("see www.example.org and argon.gl/beaf, also t.me/argon");
    expect(links.map((l) => l.url)).toEqual([
      "https://www.example.org/",
      "https://argon.gl/beaf",
      "https://t.me/argon",
    ]);
    expect(links[1].text).toBe("argon.gl/beaf");
  });

  it("ignores file names, versions, mail addresses and words with dots", () => {
    expect(findLinks("open readme.md or app.js v1.2.3, mail me@example.com, e.g. this")).toEqual([]);
    expect(findLinks("3.14 is pi and 10.0.0.1 is private")).toEqual([]);
  });

  it("keeps a closing parenthesis that the link opened", () => {
    const [link] = findLinks("(see https://en.wikipedia.org/wiki/Foo_(bar))");
    expect(link.text).toBe("https://en.wikipedia.org/wiki/Foo_(bar)");
  });

  it("drops trailing punctuation and quotes", () => {
    expect(findLinks('"https://example.com/x", next').map((l) => l.text)).toEqual(["https://example.com/x"]);
    expect(findLinks("https://example.com/x?").map((l) => l.text)).toEqual(["https://example.com/x"]);
  });

  it("reports every link in order with offsets into the original text", () => {
    const text = "a https://one.test/ b two.com c";
    const links = findLinks(text);
    expect(links.map((l) => text.slice(l.offset, l.offset + l.length))).toEqual(["https://one.test/", "two.com"]);
  });

  it("refuses credentials in a link", () => {
    expect(findLinks("https://user:pw@example.com/")).toEqual([]);
  });

  it("firstLink is the first one or null", () => {
    expect(firstLink("nothing here")).toBeNull();
    expect(firstLink("x example.com y example.org")?.domain).toBe("example.com");
  });
});
