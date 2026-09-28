/**
 * How a file already on the server travels through the clipboard and a drag: our own payload, and
 * the `<img src>` every "Copy image" writes, read back into references the composer can send as
 * copies instead of bytes.
 */
import { describe, test, expect } from "vitest";
import {
  ATTACHMENT_CLIPBOARD_TYPE,
  ATTACHMENT_WEB_CLIPBOARD_TYPE,
  fileIdFromUrl,
  parseRefsJson,
  readAttachmentRefs,
  refsFromHtml,
  serializeRefs,
  type AttachmentRef,
} from "@/lib/attachments/clipboard";

const API = "https://api.argon.gl";
const ID = "0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5b";
const OTHER = "0199a2b3-c4d5-7e6f-8a9b-0c1d2e3f4a5c";

const cat: AttachmentRef = {
  fileId: ID,
  fileName: "cat.png",
  fileSize: 1234,
  contentType: "image/png",
  width: 640,
  height: 480,
  thumbHash: "AAAA",
};

function transfer(data: Record<string, string>, extraTypes: string[] = []): DataTransfer {
  return {
    types: [...Object.keys(data), ...extraTypes],
    getData: (k: string) => data[k] ?? "",
    files: [],
  } as unknown as DataTransfer;
}

describe("file ids in addresses", () => {
  test("the api's file address names the file, however the host is spelled", () => {
    expect(fileIdFromUrl(`${API}/files/${ID}`, API)).toBe(ID);
    expect(fileIdFromUrl(`HTTPS://API.ARGON.GL/files/${ID.toUpperCase()}?x=1`, API)).toBe(ID);
    expect(fileIdFromUrl(`${API}/files/${ID}`, `${API}/`)).toBe(ID);
  });

  test("the desktop's cache schemes name the file too", () => {
    expect(fileIdFromUrl(`app://cdn/${ID}`, API)).toBe(ID);
    expect(fileIdFromUrl(`app://cdn-proxy/${encodeURIComponent(`${API}/files/${ID}`)}`, API)).toBe(ID);
  });

  test("anything else is not a file of ours", () => {
    expect(fileIdFromUrl(`https://evil.example/files/${ID}`, API)).toBeNull();
    expect(fileIdFromUrl(`${API}/files/not-a-guid`, API)).toBeNull();
    expect(fileIdFromUrl(`${API}/avatars/${ID}`, API)).toBeNull();
    expect(fileIdFromUrl(`app://cdn/../${ID}`, API)).toBeNull();
    expect(fileIdFromUrl(null, API)).toBeNull();
  });
});

describe("html", () => {
  test("pictures and links to our files become references, once each, with their names", () => {
    const html =
      `<meta charset="utf-8"><img src="${API}/files/${ID}" alt="cat.png">` +
      `<a href="${API}/files/${OTHER}" download="doc.pdf">the document</a>` +
      `<img src="${API}/files/${ID}"><img src="https://elsewhere.example/files/${ID}">`;

    expect(refsFromHtml(html, API)).toEqual([
      { fileId: ID, fileName: "cat.png", fileSize: null, contentType: null, width: null, height: null, thumbHash: null },
      { fileId: OTHER, fileName: "doc.pdf", fileSize: null, contentType: null, width: null, height: null, thumbHash: null },
    ]);
  });

  test("html without our files yields nothing", () => {
    expect(refsFromHtml("<p>hello <img src='https://x.example/a.png'></p>", API)).toEqual([]);
    expect(refsFromHtml("", API)).toEqual([]);
  });
});

describe("our payload", () => {
  test("survives a round trip", () => {
    expect(parseRefsJson(serializeRefs([cat]))).toEqual([cat]);
  });

  test("is checked field by field, since it came off the clipboard", () => {
    expect(parseRefsJson("not json")).toEqual([]);
    expect(parseRefsJson(JSON.stringify({ v: 2, files: [cat] }))).toEqual([]);
    expect(parseRefsJson(JSON.stringify({ v: 1, files: [{ fileId: "nope" }, { ...cat, fileSize: -1, width: "wide" }] })))
      .toEqual([{ ...cat, fileSize: null, width: null }]);
  });
});

describe("reading a transfer", () => {
  test("our own type wins over the html beside it", () => {
    const dt = transfer({
      [ATTACHMENT_CLIPBOARD_TYPE]: serializeRefs([cat]),
      "text/html": `<img src="${API}/files/${OTHER}">`,
    });
    expect(readAttachmentRefs(dt, true, API)).toEqual([cat]);
  });

  test("the async clipboard's prefixed spelling is the same payload", () => {
    const dt = transfer({ [ATTACHMENT_WEB_CLIPBOARD_TYPE]: serializeRefs([cat]) });
    expect(readAttachmentRefs(dt, true, API)).toEqual([cat]);
  });

  test("html is consulted only when the caller allows it", () => {
    const dt = transfer({ "text/html": `<img src="${API}/files/${ID}">`, "text/plain": "a page" }, ["Files"]);
    expect(readAttachmentRefs(dt, true, API).map((r) => r.fileId)).toEqual([ID]);
    expect(readAttachmentRefs(dt, false, API)).toEqual([]);
  });

  test("a transfer of plain files carries no reference", () => {
    expect(readAttachmentRefs(transfer({}, ["Files"]), true, API)).toEqual([]);
    expect(readAttachmentRefs(null, true, API)).toEqual([]);
  });
});
