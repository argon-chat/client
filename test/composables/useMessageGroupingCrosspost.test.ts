/**
 * A crosspost carries its original author as sender, and that author may also post here. Grouping
 * by sender alone would fold a crosspost under the author's own message and hide where it came
 * from; crossposts group by their source channel instead.
 */

import { describe, test, expect } from "vitest";
import { shallowRef } from "vue";
import { IonDateTime } from "@argon-chat/ion.webcore";
import { useMessageGrouping } from "@/composables/useMessageGrouping";

const t0 = new Date("2026-09-26T10:00:00Z").getTime();

const message = (id: number, sender: string, sourceChannelId?: string) =>
  ({
    messageId: BigInt(id),
    sender,
    timeSent: IonDateTime.fromDate(new Date(t0 + id * 1000)),
    crosspost: sourceChannelId ? { sourceChannelId } : null,
  }) as any;

const firsts = (list: any[]) => useMessageGrouping(shallowRef(list)).groupingMap.value.map((g) => g.isFirstInGroup);

describe("grouping crossposts", () => {
  test("a crosspost does not join its author's own messages, either way round", () => {
    expect(firsts([message(1, "ada"), message(2, "ada", "news"), message(3, "ada")])).toEqual([true, true, true]);
  });

  test("crossposts from one source channel group; from another they do not", () => {
    expect(firsts([message(1, "ada", "news"), message(2, "bob", "news"), message(3, "ada", "blog")])).toEqual([
      true,
      false,
      true,
    ]);
  });

  test("plain messages still group by sender", () => {
    expect(firsts([message(1, "ada"), message(2, "ada"), message(3, "bob")])).toEqual([true, false, true]);
  });
});
