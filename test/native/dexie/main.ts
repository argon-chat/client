import "../../../src/lib/sk/aotPromise";
import Dexie from "dexie";

async function checkTransactions() {
  const database = new Dexie("argon-aot-transaction-test");
  database.version(1).stores({ tickets: "id" });
  await database.open();
  const tickets = database.table<{ id: string }, string>("tickets");
  const original = globalThis.Promise;
  await database.transaction("rw", tickets, async tx => {
    await Promise.all([tickets.put({ id: "A" }), tickets.put({ id: "B" })]);
    if (Dexie.currentTransaction !== tx) throw Error("Lost transaction context after Promise.all");
    await tickets.put({ id: "C" });
  });
  const rollback = new Error("Deliberate rollback");
  try {
    await database.transaction("rw", tickets, async tx => {
      await Promise.all([tickets.put({ id: "torn" }), tickets.delete("B")]);
      if (Dexie.currentTransaction !== tx) throw Error("Lost transaction context before rollback");
      throw rollback;
    });
    throw Error("Expected the rejected transaction to roll back");
  } catch (error) {
    if (error !== rollback) throw error;
  }
  if (globalThis.Promise !== original) throw Error("Dexie failed to restore the Promise constructor");
  await Promise.all(["D", "E"].map(id => database.transaction("rw", tickets, async tx => {
    await tickets.put({ id });
    if (Dexie.currentTransaction !== tx) throw Error("Concurrent transactions shared a context");
  })));
  const keys = await tickets.toCollection().primaryKeys();
  if (keys.join(",") !== "A,B,C,D,E") throw Error("Unexpected committed records " + keys.join(","));
  database.close();
}

checkTransactions().then(
  () => console.log("[aot-dexie] passed"),
  error => console.error("[aot-dexie] failed", error),
);
