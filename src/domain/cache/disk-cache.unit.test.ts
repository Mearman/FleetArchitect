import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DiskSimCache } from "@/domain/cache/disk-cache";
import { sampleResult } from "@/domain/cache/test-fixtures";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sim-cache-disk-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

describe("DiskSimCache", () => {
  it("returns undefined on a miss and round-trips a stored result", async () => {
    const cache = new DiskSimCache(dir);
    expect(await cache.get("missing")).toBeUndefined();
    expect(await cache.has("missing")).toBe(false);

    const result = sampleResult("r1", { ticks: 5 });
    await cache.set("k1", result);

    expect(await cache.has("k1")).toBe(true);
    expect(await cache.get("k1")).toEqual(result);
  });

  it("treats a schema-invalid stored file as a miss and evicts it", async () => {
    const cache = new DiskSimCache(dir);
    // Write a file that does not parse as a BattleResult under the key's name.
    await writeFile(join(dir, "broken.json"), JSON.stringify({ nope: true }), "utf8");

    expect(await cache.get("broken")).toBeUndefined();
    // The stale file is removed so it is not re-read every lookup.
    expect(await cache.has("broken")).toBe(false);
  });

  it("evicts oldest-mtime files until the byte budget holds", async () => {
    // A budget that fits two results but not three forces one eviction on the
    // third write. mtimes are set explicitly (coarse FS mtime granularity would
    // otherwise make sub-second write ordering ambiguous) so the oldest is
    // unambiguous: "a" is the oldest and must be the one evicted.
    const oneResultBytes = new TextEncoder().encode(
      JSON.stringify(sampleResult("sizer")),
    ).length;
    const cache = new DiskSimCache(dir, oneResultBytes * 2 + 1);

    await cache.set("a", sampleResult("a"));
    await cache.set("b", sampleResult("b"));
    await utimes(join(dir, "a.json"), new Date(1000), new Date(1000));
    await utimes(join(dir, "b.json"), new Date(2000), new Date(2000));
    // The third write pushes the total over budget; the oldest ("a") is evicted.
    await cache.set("c", sampleResult("c"));

    expect(await cache.has("a")).toBe(false);
    expect(await cache.has("b")).toBe(true);
    expect(await cache.has("c")).toBe(true);
  });

  it("touching a result on get refreshes its mtime so it survives eviction", async () => {
    const oneResultBytes = new TextEncoder().encode(
      JSON.stringify(sampleResult("sizer")),
    ).length;
    const cache = new DiskSimCache(dir, oneResultBytes * 2 + 1);

    await cache.set("a", sampleResult("a"));
    await cache.set("b", sampleResult("b"));
    // Backdate both so "a" is clearly older than "b".
    await utimes(join(dir, "a.json"), new Date(1000), new Date(1000));
    await utimes(join(dir, "b.json"), new Date(2000), new Date(2000));
    // Touch "a" on get: its mtime jumps to now, making "b" the oldest.
    await cache.get("a");
    // The third write evicts the oldest, which is now "b".
    await cache.set("c", sampleResult("c"));

    expect(await cache.has("a")).toBe(true);
    expect(await cache.has("b")).toBe(false);
    expect(await cache.has("c")).toBe(true);
  });
});
