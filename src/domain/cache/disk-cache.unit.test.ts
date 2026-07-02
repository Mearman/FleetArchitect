import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { access, mkdtemp, rm, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { serialize } from "node:v8";
import { DiskSimCache } from "@/domain/cache/disk-cache";
import { sampleResult } from "@/domain/cache/test-fixtures";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sim-cache-disk-"));
});

afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

// The disk cache pins the on-disk filename to the Node major (the v8 wire
// format is version-specific), so tests that touch files by name replicate
// that prefix. Kept in sync with `DiskSimCache.filePath`.
const nodeMajor = process.versions.node.split(".")[0]!;
const binFile = (key: string): string => `v8n${nodeMajor}-${key}.bin`;

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
    // A valid v8 buffer whose value is not a BattleResult: deserialise
    // succeeds, the shape guard rejects it, and the file is reclaimed.
    await writeFile(join(dir, binFile("broken")), serialize({ nope: true }));

    expect(await cache.get("broken")).toBeUndefined();
    // The stale file is removed so it is not re-read every lookup.
    expect(await cache.has("broken")).toBe(false);
  });

  it("treats an undecodable stored file as a miss and evicts it", async () => {
    const cache = new DiskSimCache(dir);
    // Garbage bytes that v8 cannot deserialise (truncated / corrupt): the
    // decode is caught, the file reclaimed, and the lookup reports a miss.
    await writeFile(join(dir, binFile("corrupt")), Buffer.from([0, 1, 2, 3, 99]));

    expect(await cache.get("corrupt")).toBeUndefined();
    expect(await cache.has("corrupt")).toBe(false);
  });

  it("evicts oldest-mtime files until the byte budget holds", async () => {
    // A budget that fits two results but not three forces one eviction on the
    // third write. The on-disk size is the v8 buffer length, not the JSON
    // string length, so the budget is sized off `serialize`. mtimes are set
    // explicitly (coarse FS mtime granularity would otherwise make sub-second
    // write ordering ambiguous) so the oldest is unambiguous: "a" is the oldest
    // and must be the one evicted.
    const oneResultBytes = serialize(sampleResult("sizer")).length;
    const cache = new DiskSimCache(dir, oneResultBytes * 2 + 1);

    await cache.set("a", sampleResult("a"));
    await cache.set("b", sampleResult("b"));
    await utimes(join(dir, binFile("a")), new Date(1000), new Date(1000));
    await utimes(join(dir, binFile("b")), new Date(2000), new Date(2000));
    // The third write pushes the total over budget; the oldest ("a") is evicted.
    await cache.set("c", sampleResult("c"));

    expect(await cache.has("a")).toBe(false);
    expect(await cache.has("b")).toBe(true);
    expect(await cache.has("c")).toBe(true);
  });

  it("reclaims legacy .json files left by an earlier format version", async () => {
    // An orphaned JSON file from the pre-v8 format still counts toward the
    // directory total and must be evicted alongside the current .bin files.
    // Budget fits three current-format results but not three plus the legacy
    // file, so the over-budget write evicts exactly the oldest entry — the
    // legacy .json — leaving the current-format results intact.
    const oneResultBytes = serialize(sampleResult("sizer")).length;
    const cache = new DiskSimCache(dir, oneResultBytes * 3 + 1);

    await cache.set("a", sampleResult("a"));
    await cache.set("b", sampleResult("b"));
    // Plant a legacy-format file, backdated to the epoch so it is unambiguously
    // the oldest entry in the directory.
    await writeFile(join(dir, "legacy.json"), JSON.stringify(sampleResult("old")));
    await utimes(join(dir, "legacy.json"), new Date(500), new Date(500));
    // Writing "c" crosses the budget; the legacy .json is reclaimed first,
    // bringing the total back under budget without touching a/b/c.
    await cache.set("c", sampleResult("c"));

    expect(await cache.has("a")).toBe(true);
    expect(await cache.has("b")).toBe(true);
    expect(await cache.has("c")).toBe(true);
    // The legacy file itself is gone, proving the evictor ranks both formats.
    await expect(access(join(dir, "legacy.json"))).rejects.toThrow();
  });

  it("touching a result on get refreshes its mtime so it survives eviction", async () => {
    const oneResultBytes = serialize(sampleResult("sizer")).length;
    const cache = new DiskSimCache(dir, oneResultBytes * 2 + 1);

    await cache.set("a", sampleResult("a"));
    await cache.set("b", sampleResult("b"));
    // Backdate both so "a" is clearly older than "b".
    await utimes(join(dir, binFile("a")), new Date(1000), new Date(1000));
    await utimes(join(dir, binFile("b")), new Date(2000), new Date(2000));
    // Touch "a" on get: its mtime jumps to now, making "b" the oldest.
    await cache.get("a");
    // The third write evicts the oldest, which is now "b".
    await cache.set("c", sampleResult("c"));

    expect(await cache.has("a")).toBe(true);
    expect(await cache.has("b")).toBe(false);
    expect(await cache.has("c")).toBe(true);
  });
});
