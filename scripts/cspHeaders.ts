/**
 * Writes the inline-script hashes into `_headers` at build time.
 *
 * **The problem this solves.** A Content Security Policy worth having does not carry
 * `'unsafe-inline'`, and this page has one inline script that cannot become an external one: the
 * theme bootstrap has to run before the first paint, or every start flashes the wrong theme. The
 * only way to allow exactly that script and nothing else is its hash — and a hash written by hand
 * in a headers file is a trap. It is correct until somebody edits the script, and then the page
 * loses its theme bootstrap with no error anywhere except a console nobody has open.
 *
 * So it is computed from what is actually emitted, every build, and a `_headers` that does not ask
 * for it fails the build rather than deploying a policy that would block the app.
 *
 * **Why hashes and not a nonce.** A nonce must be unique per response, which means generating it in
 * a server. These are static files on a CDN; there is nothing to generate one. Hashes are the
 * mechanism for exactly this case.
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { Plugin } from "vite";

/** What `public/_headers` puts where the hashes go. */
const TOKEN = "{{INLINE_SCRIPT_HASHES}}";

/**
 * Script types the browser does not execute, and so does not check against `script-src`.
 * Hashing them would be harmless but misleading — they are data the page reads, not code.
 */
const NON_EXECUTABLE = /^(application\/(ld\+)?json|text\/template|application\/octet-stream)$/i;

/** Every inline `<script>` in the document, in source order. */
function inlineScripts(html: string): string[] {
  const bodies: string[] = [];

  for (const [, attrs, body] of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
    if (/\bsrc\s*=/i.test(attrs)) continue;

    const type = /\btype\s*=\s*["']?([^"'\s>]+)/i.exec(attrs)?.[1];
    if (type && NON_EXECUTABLE.test(type)) continue;

    bodies.push(body);
  }

  return bodies;
}

/** The CSP source expression for a script body — the hash of its exact bytes, as the browser takes it. */
const hashOf = (body: string): string =>
  `'sha256-${createHash("sha256").update(body, "utf8").digest("base64")}'`;

export function cspHeaders(): Plugin {
  let outDir = "dist";

  return {
    name: "argon-csp-headers",
    apply: "build",

    configResolved(config) {
      outDir = config.build.outDir;
    },

    // closeBundle, not writeBundle: the public directory — where `_headers` comes from — is copied
    // after the bundle is written, so anything earlier would read a file that is not there yet or
    // be overwritten by the copy.
    closeBundle() {
      const root = join(process.cwd(), outDir);
      const headersPath = join(root, "_headers");

      let headers: string;
      try {
        headers = readFileSync(headersPath, "utf8");
      } catch {
        // No `_headers` at all is a deployment without a policy, which is a choice someone can
        // make; silently rewriting nothing is the right response to it.
        return;
      }

      if (!headers.includes(TOKEN)) {
        throw new Error(
          `[csp] ${TOKEN} is missing from _headers. The inline script hashes have nowhere to go, ` +
          "which would ship a policy that blocks the theme bootstrap. Put the token back into " +
          "script-src, or drop this plugin if the policy no longer needs it.",
        );
      }

      const html = readFileSync(join(root, "index.html"), "utf8");
      const hashes = [...new Set(inlineScripts(html).map(hashOf))];

      writeFileSync(headersPath, headers.replaceAll(TOKEN, hashes.join(" ")), "utf8");

      console.info(
        `[csp] allowed ${hashes.length} inline script${hashes.length === 1 ? "" : "s"} by hash`,
      );
    },
  };
}
