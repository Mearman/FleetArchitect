import { describe, expect, it } from "vitest";
import { MemorySimCache } from "@/domain/cache/memory-cache";
import { sampleResult } from "@/domain/cache/test-fixtures";

describe("MemorySimCache", () => {
  it("returns undefined on a miss and the stored value on a hit", async () => {
    const cache = new MemorySimCache();
    expect(await cache.get("missing")).toBeUndefined();
    expect(await cache.has("missing")).toBe(false);

    const result = sampleResult("r1");
    await cache.set("k1", result);

    expect(await cache.has("k1")).toBe(true);
    expect(await cache.get("k1")).toBe(result);
  });

  it("evicts the oldest entry once the count bound is exceeded", async () => {
    const cache = new MemorySimCache(2);
    await cache.set("a", sampleResult("a"));
    await cache.set("b", sampleResult("b"));
    await cache.set("c", sampleResult("c"));

    // "a" was the oldest and is evicted; "b" and "c" remain.
    expect(await cache.has("a")).toBe(false);
    expect(await cache.has("b")).toBe(true);
    expect(await cache.has("c")).toBe(true);
  });

  it("re-inserts on get so a touched entry survives the next eviction", async () => {
    const cache = new MemorySimCache(2);
    await cache.set("a", sampleResult("a"));
    await cache.set("b", sampleResult("b"));

    // Touch "a" so it becomes most-recent; "b" is now the oldest.
    await cache.get("a");
    await cache.set("c", sampleResult("c"));

    expect(await cache.has("a")).toBe(true);
    expect(await cache.has("b")).toBe(false);
    expect(await cache.has("c")).toBe(true);
  });

  it("overwriting an existing key refreshes its recency", async () => {
    const cache = new MemorySimCache(2);
    await cache.set("a", sampleResult("a"));
    await cache.set("b", sampleResult("b"));

    // Overwrite "a": it becomes most-recent, so "b" is now the oldest.
    const replacement = sampleResult("a", { ticks: 99 });
    await cache.set("a", replacement);
    await cache.set("c", sampleResult("c"));

    expect(await cache.has("a")).toBe(true);
    expect(await cache.get("a")).toBe(replacement);
    expect(await cache.has("b")).toBe(false);
  });
});
