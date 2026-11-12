/**
 * Keeps Vue's patcher alive on a page rewritten by the browser's translator.
 *
 * Chrome's built-in translation (and Google Translate extensions) replaces text nodes with `<font>`
 * wrappers. The original nodes are detached, but Vue still holds them as anchors, so the next
 * keyed insert asks `insertBefore` for a node that is no longer a child and the whole subtree
 * crashes: `NotFoundError: insertBefore`, then `parentNode of null` and `bum of null` as the
 * half-patched tree unwinds (ARGON-CLIENT-36A…36G, a user with locale `tr` creating spaces,
 * channels and invites). We have no locale for most such users, so blocking translation would
 * leave them with a language they do not read.
 *
 * The guard only acts where the native call would throw: an anchor that is not a child of the
 * parent. It inserts before the anchor's closest ancestor that still is one (the `<font>` wrapper),
 * or appends when the anchor is gone altogether. Text the translator took over stops updating;
 * that is the translator's own trade and better than a dead screen.
 */
import { logger } from "@argon/core";

const INSTALLED = Symbol.for("argon.translatedDomGuard");

let reported = false;

function report(op: string) {
  if (reported) return;
  reported = true;
  logger.warn(`[dom-guard] ${op} on a node the page no longer holds (translated page?)`);
}

/** The child of `parent` that contains `node`, or null when `node` is not under `parent` at all. */
function childContaining(parent: Node, node: Node): Node | null {
  let current: Node | null = node;
  while (current && current.parentNode !== parent) current = current.parentNode;
  return current;
}

export function installTranslatedDomGuard(): boolean {
  if (typeof Node === "undefined") return false;
  const proto = Node.prototype as Node & { [INSTALLED]?: true };
  if (proto[INSTALLED]) return false;
  proto[INSTALLED] = true;

  const insertBefore = proto.insertBefore;
  const removeChild = proto.removeChild;

  proto.insertBefore = function <T extends Node>(this: Node, node: T, ref: Node | null): T {
    if (ref && ref.parentNode !== this) {
      report("insertBefore");
      return insertBefore.call(this, node, childContaining(this, ref)) as T;
    }
    return insertBefore.call(this, node, ref) as T;
  };

  proto.removeChild = function <T extends Node>(this: Node, child: T): T {
    if (child.parentNode !== this) {
      report("removeChild");
      if (child.parentNode && this.contains(child)) removeChild.call(child.parentNode, child);
      return child;
    }
    return removeChild.call(this, child) as T;
  };

  return true;
}
