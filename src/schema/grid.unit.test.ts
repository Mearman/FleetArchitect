import { describe, expect, it } from "vitest";
import { GridCell } from "./grid";

const OPEN = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };

describe("GridCell legacy substrate migration", () => {
  it("renames a legacy `scaffold` cell to `substrate` on parse", () => {
    // Designs and shared URLs created before the rename carry `scaffold: true`.
    const legacy = { kind: "solid", scaffold: true, surface: "deck", edges: OPEN };
    const parsed = GridCell.parse(legacy);
    expect(parsed).toEqual({
      kind: "solid",
      substrate: true,
      surface: "deck",
      edges: OPEN,
    });
    // The legacy key is dropped, not carried alongside the new one.
    expect("scaffold" in parsed).toBe(false);
  });

  it("parses a current `substrate` cell unchanged", () => {
    const current = { kind: "solid", substrate: true, surface: "armor", edges: OPEN };
    expect(GridCell.parse(current)).toEqual(current);
  });

  it("leaves an empty cell untouched", () => {
    expect(GridCell.parse({ kind: "empty" })).toEqual({ kind: "empty" });
  });
});
