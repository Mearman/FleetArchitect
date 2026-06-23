import { describe, expect, it } from "vitest";
import { CompositeSimCache } from "@/domain/cache/composite-cache";
import { MemorySimCache } from "@/domain/cache/memory-cache";
import { sampleResult } from "@/domain/cache/test-fixtures";

/**
 * The composite is tested against two `MemorySimCache` instances standing in for
 * the volatile and durable tiers — the contract is identical, and using the real
 * pure adapter keeps the test honest about back-fill and write-through behaviour
 * without a filesystem or IndexedDB.
 */
function tiers(): {
  memory: MemorySimCache;
  durable: MemorySimCache;
  composite: CompositeSimCache;
} {
  const memory = new MemorySimCache();
  const durable = new MemorySimCache();
  return { memory, durable, composite: new CompositeSimCache(memory, durable) };
}

describe("CompositeSimCache", () => {
  it("set writes through to both tiers", async () => {
    const { memory, durable, composite } = tiers();
    const result = sampleResult("r1");
    await composite.set("k1", result);

    expect(await memory.has("k1")).toBe(true);
    expect(await durable.has("k1")).toBe(true);
  });

  it("get serves a memory hit without consulting the durable tier", async () => {
    const { memory, composite } = tiers();
    const result = sampleResult("r1");
    await memory.set("k1", result);

    expect(await composite.get("k1")).toBe(result);
  });

  it("get back-fills memory on a durable hit", async () => {
    const { memory, durable, composite } = tiers();
    const result = sampleResult("r1");
    // Seed only the durable tier — memory is cold.
    await durable.set("k1", result);
    expect(await memory.has("k1")).toBe(false);

    expect(await composite.get("k1")).toBe(result);
    // The durable hit warmed memory for the next read.
    expect(await memory.has("k1")).toBe(true);
  });

  it("get returns undefined when neither tier holds the key", async () => {
    const { composite } = tiers();
    expect(await composite.get("missing")).toBeUndefined();
  });

  it("has reports a hit in either tier", async () => {
    const { memory, durable, composite } = tiers();
    await memory.set("inMemory", sampleResult("m"));
    await durable.set("inDurable", sampleResult("d"));

    expect(await composite.has("inMemory")).toBe(true);
    expect(await composite.has("inDurable")).toBe(true);
    expect(await composite.has("neither")).toBe(false);
  });
});
