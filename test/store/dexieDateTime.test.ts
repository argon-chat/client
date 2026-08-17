/**
 * The prototype IndexedDB drops, and putting it back.
 *
 * These tests call `structuredClone` rather than standing up a fake IndexedDB. That is not an
 * approximation: the structured clone algorithm *is* what IndexedDB stores values with, so a clone
 * reproduces exactly the object Dexie hands back.
 *
 * Worth pinning because the bug is invisible to `vue-tsc` — the value written and the value read
 * share one declared type, so every call site typechecks and then throws.
 */

import { describe, test, expect } from "vitest";
import { IonDateTime } from "@argon-chat/ion.webcore";
import { PoolDatabase } from "@/store/db/dexie";

/** What Dexie hands a reading hook: the row as IndexedDB gave it back. */
const stored = <T>(row: T): T => structuredClone(row);

describe("cached datetimes", () => {
  test("a cloned IonDateTime has lost its methods", () => {
    const clone: any = stored(IonDateTime.now());

    // The premise of the file. If this ever stops holding, the hooks are dead weight — and note it
    // is a *fresh* value, so emptying the cache on migration does not sidestep any of this.
    expect(clone).not.toBeInstanceOf(IonDateTime);
    expect(typeof clone.toDate).toBe("undefined");
    expect(typeof clone.unixTicks).toBe("bigint");
  });

  test("messages.timeSent survives the round trip", () => {
    const db = new PoolDatabase("probe-messages");
    const sent = IonDateTime.now();

    const row = db.messages.hook.reading.fire(stored({ _msgId: 7, text: "hi", timeSent: sent }));

    expect(row.timeSent).toBeInstanceOf(IonDateTime);
    // The instant has to survive, not just the type.
    expect(row.timeSent.toDate().getTime()).toBe(sent.toDate().getTime());
  });

  test("members.joinedAt keeps its offset rather than normalising to UTC", () => {
    const db = new PoolDatabase("probe-members");
    const authored = new IonDateTime(IonDateTime.now().unixTicks, -330);

    const row = db.members.hook.reading.fire(stored({ memberId: "m", joinedAt: authored }));

    expect(row.joinedAt.offsetMinutes).toBe(-330);
    expect(row.joinedAt.toString()).toBe(authored.toString());
  });

  test("profileCache reaches the datetime nested under profile", () => {
    const db = new PoolDatabase("probe-profiles");

    const row = db.profileCache.hook.reading.fire(
      stored({ key: "s:u", profile: { userId: "u", registeredAt: IonDateTime.now() }, fetchedAt: 1 }),
    );

    expect(row.profile.registeredAt).toBeInstanceOf(IonDateTime);
  });

  test("a null registeredAt passes through", () => {
    const db = new PoolDatabase("probe-null");

    const row = db.profileCache.hook.reading.fire(
      stored({ key: "s:u", profile: { userId: "u", registeredAt: null }, fetchedAt: 1 }),
    );

    expect(row.profile.registeredAt).toBeNull();
  });

  test("everything else on the row is left alone", () => {
    const db = new PoolDatabase("probe-untouched");

    const row = db.messages.hook.reading.fire(
      stored({
        _msgId: 7,
        messageId: 42n,
        text: null,
        timeSent: IonDateTime.now(),
        // Entities are class instances on the wire and arrive prototype-less too. Consumers read
        // them as data — no `instanceof`, no `isMessageEntityX()` anywhere in src/ — so the hook
        // must not start inventing prototypes for them.
        entities: [{ type: 1, offset: 0, length: 4, UnionKey: "MessageEntityBold" }],
      }),
    );

    expect(row.messageId).toBe(42n);
    expect(row.text).toBeNull();
    expect(row.entities[0]).toEqual({ type: 1, offset: 0, length: 4, UnionKey: "MessageEntityBold" });
  });
});
