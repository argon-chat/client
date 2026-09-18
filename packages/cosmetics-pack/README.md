# @argon/cosmetics-pack

Catalogue cosmetics whose bytes ship inside the client build.

A cosmetic is born dynamic: an operator creates it in the admin console, people get it and wear it
the same day, and its files come off the CDN. This package is the second half of that life — when
somebody gets round to a client release, the console exports those files and they are unpacked here.
From then on the app draws them out of its own bundle.

## What it changes, and what it does not

Only where the **bytes** come from. The payload, the name, the price and who owns what are always
the server's answer — the pack carries no opinion about any of them.

A bundled file is used only when the server names the **same `fileId`** for the same slot. Replacing
an asset in the console mints a new id, so every client misses this map and goes back to the network
by itself, until a later release exports the new bytes. That is the whole of the invalidation, and
it is why a stale pack can only ever be slower, never wrong.

## Adding to it

1. In the admin console, open the cosmetic and press **Export for client** (or select several rows
   in the catalogue and export them together). Only published rows can be exported.
2. `bun run cosmetics:import <the.zip>` — unpacks into `items/` and runs the check.
3. Commit, release the client.
4. **Then**, in the console, mark the row as shipped. The flag records what happened; it does not
   make it happen, and marking before the release ships means the console is lying about what people
   are running.

## The shape

```
items/<kindKey>/<slug>/
  entry.json        cosmeticId, kindKey, slug, nameKey, name, version, exportedAt/From,
                    assets: [{ slot, fileId, file, bytes, sha256 }]
  Primary.webm
  Poster.webp
```

`nameKey` and `name` are for whoever opens the folder: `Thorns` says what the unit is,
`cosmetic_frame_thorns` says where its text lives. Neither is read at runtime — the client takes the
name off the catalogue, which carries every locale an operator has written — so `name` is allowed to
go stale without anything caring.

A folder is the unit, the way a file is the unit in `src/cosmetics/kinds/`. Delete the folder and
the local copy ceases to exist: the row keeps working and its files come from the CDN again. An
empty `items/` is a correct pack.

## Checking it

`bun run cosmetics:check` verifies that every entry parses, sits in the folder it names, declares
files that are present with matching size and sha256, names a kind this build actually ships, and
claims no `fileId` twice — then prints the total against the size budget.

The budget matters: a baked cosmetic is in the bundle forever, and unlike the CDN it is paid for by
everyone who downloads the app rather than by the people who wear it. Bake what is evergreen; leave
a limited drop on the CDN, where it can also stop existing.
