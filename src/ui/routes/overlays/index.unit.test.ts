import { describe, expect, it } from "vitest";

import { OVERLAYS, OVER_SHIP_IDS, UNDER_SHIP_IDS } from "./index";

/**
 * The glow is a single overlay (`battle-glow`) that composes the medium field
 * and the live particles through one brightness truth — not three separate
 * medium/particle render paths. This pins the registry so a re-added separate
 * glow overlay fails loudly.
 */
describe("overlay registry", () => {
  it("has a single unified battlefield-glow overlay, no separate medium/particle paths", () => {
    const ids = OVERLAYS.map((o) => o.id);
    expect(ids).toContain("battle-glow");
    expect(ids).not.toContain("medium-glow");
    expect(ids).not.toContain("medium-trails");
    expect(ids).not.toContain("particle-glow");
    // One glow overlay total.
    expect(ids.filter((id) => id.endsWith("glow"))).toEqual(["battle-glow"]);
    expect(UNDER_SHIP_IDS.has("battle-glow")).toBe(true);
    expect(OVER_SHIP_IDS.has("battle-glow")).toBe(false);
  });
});
