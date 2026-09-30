// Builds packages/i18n/src/core/en_tengwar.json from en.json: English, written in Tengwar.
//
// The transcription is glaemscribe's phonemic English mode (it runs eSpeak to get the sounds), emitted
// on the Free Tengwar Font Project's Private Use Area mapping (U+E000–E07F), which the bundled Alcarin
// Tengwar font reads. Because every tengwa is a private-use code point, the font can be scoped to that
// range with unicode-range and everything else on screen stays in the UI font. glaemscribe is AGPL and
// only ever runs here, at development time; nothing of it ships in the client.
//
//   bun run i18n:tengwar            rebuild the bundle
//   bun run i18n:tengwar -- Tengwar transcribe one word (for labels)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const lib = resolve(root, "node_modules/glaemscribe/js");
const source = resolve(root, "packages/i18n/src/core/en.json");
const target = resolve(root, "packages/i18n/src/core/en_tengwar.json");

// glaemscribe is a browser bundle; its eSpeak build detects Node and wants the CommonJS globals.
globalThis.window = globalThis;
globalThis.require = createRequire(`${lib}/x.js`);
globalThis.__dirname = lib;
globalThis.__filename = `${lib}/espeakng.for.glaemscribe.nowasm.sync.js`;
const load = (file) => vm.runInThisContext(readFileSync(`${lib}/${file}`, "utf8"), { filename: file });
load("glaemscribe.js");
load("espeakng.for.glaemscribe.nowasm.sync.js");
load("charsets/tengwar_freemono.cst.js");
load("modes/english-tengwar-espeak.glaem.js");

const manager = Glaemscribe.resource_manager;
manager.load_modes();
const mode = manager.loaded_modes["english-tengwar-espeak"];
const charset = manager.loaded_charsets["tengwar_freemono"];

// vue-i18n message syntax: a bare @ starts a linked message and | separates plural forms. The mapping
// never emits them, but a charset change could; as literals they are harmless either way.
const escapeMessage = (text) => text.replace(/[@|]/g, (c) => `{'${c}'}`);

function transcribe(text) {
  const core = text.trim();
  // Nothing to say: eSpeak would read a lone ":" or "%" out as a word ("colon", "percent").
  if (!/[A-Za-z]/.test(core)) return text;
  const [ok, out, context] = mode.transcribe(core, charset);
  if (!ok) throw new Error(`transcription failed: ${JSON.stringify(text)} ${context?.errors?.map((e) => e.message).join("; ") ?? ""}`);
  // The mode marks a character it has no tengwar for with a skull. Whatever it is, keep it out of
  // the transcription (see TOKENS) rather than shipping a glyph the font lacks.
  if (out.includes("☠")) throw new Error(`untranscribable character in ${JSON.stringify(text)}`);
  const lead = text.slice(0, text.length - text.trimStart().length);
  const trail = text.slice(text.trimEnd().length);
  return lead + escapeMessage(out) + trail;
}

// Interpolations ({name}, {'@'} literals), HTML tags and double quotes stay exactly as they are; only
// the text between them is transcribed. split() with a capturing group alternates text and tokens.
const TOKENS = /(\{[^{}]*\}|<\/?[a-zA-Z][^>]*>|")/g;
const convert = (value) => value.split(TOKENS).map((part, i) => (i % 2 ? part : transcribe(part))).join("");

const walk = (node) => Object.fromEntries(Object.entries(node).map(([k, v]) => [k, typeof v === "string" ? convert(v) : walk(v)]));

const word = process.argv.slice(2).filter((a) => a !== "--").join(" ");
if (word) {
  console.log(transcribe(word));
} else {
  const en = JSON.parse(readFileSync(source, "utf8"));
  const out = walk(en);
  writeFileSync(target, JSON.stringify(out, null, 2) + "\n");
  console.log(`wrote ${target} (${Object.keys(out).length} keys)`);
}
