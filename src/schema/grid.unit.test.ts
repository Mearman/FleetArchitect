import { describe, expect, it } from "vitest";
import { ALL_OPEN_EDGES, GridCell, SolidCell } from "./grid";
import { ShipDesign } from "./ship";
import { compactDesignForSerialization } from "./grid-compact";

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

describe("SolidCell.edges default", () => {
  it("fills all-open edges when the edges key is omitted", () => {
    const parsed = SolidCell.parse({
      kind: "solid",
      substrate: true,
      surface: "deck",
    });
    expect(parsed.edges).toEqual(OPEN);
    // The default value is the frozen module-level constant's content.
    expect(parsed.edges).toEqual(ALL_OPEN_EDGES);
  });

  it("parses an explicit-edges cell unchanged", () => {
    const explicit = {
      kind: "solid",
      substrate: true,
      surface: "deck",
      edges: {
        n: "wall",
        e: "open",
        s: "door",
        w: "open",
        doorStates: { s: "closed" },
      },
    };
    expect(SolidCell.parse(explicit)).toEqual(explicit);
  });

  it("still enforces the doorStates refine after the default fills edges", () => {
    // A door edge with no recorded door state must fail the refine even though
    // `edges` was supplied explicitly (the default only fills a missing key).
    const result = SolidCell.safeParse({
      kind: "solid",
      substrate: true,
      surface: "deck",
      edges: { n: "door", e: "open", s: "open", w: "open", doorStates: {} },
    });
    expect(result.success).toBe(false);
  });
});

describe("compactDesignForSerialization", () => {
  const baseDesign = {
    id: "design_test",
    name: "Compact Fixture",
    faction: "Terran",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    grid: {
      cols: 2,
      rows: 2,
      cells: [
        // All-open solid cell — edges should be stripped on compaction.
        { kind: "solid", substrate: true, surface: "deck", edges: OPEN },
        // Walled solid cell — edges must be preserved.
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: {
            n: "wall",
            e: "open",
            s: "open",
            w: "open",
            doorStates: {},
          },
        },
        // Empty cell — untouched.
        { kind: "empty" },
        // All-open solid cell carrying equipment — edges stripped, equipment kept.
        {
          kind: "solid",
          substrate: true,
          surface: "deck",
          edges: OPEN,
          equipment: { moduleId: "mod_x", facing: 0 },
        },
      ],
    },
  };

  it("strips all-open edges and round-trips to the original via parse", () => {
    const design = ShipDesign.parse(baseDesign);
    const compacted = compactDesignForSerialization(design);

    // The compacted form omits the edges key on the two all-open cells.
    const firstCompacted = compacted.grid.cells?.[0];
    if (typeof firstCompacted !== "object" || firstCompacted === null) {
      throw new Error("missing cell 0");
    }
    expect("edges" in firstCompacted).toBe(false);

    const walledCompacted = compacted.grid.cells?.[1];
    if (typeof walledCompacted !== "object" || walledCompacted === null) {
      throw new Error("missing cell 1");
    }
    expect("edges" in walledCompacted).toBe(true);

    // Reparsing the compacted form refills edges to deep-equal the original.
    const reparsed = ShipDesign.parse(compacted);
    expect(reparsed).toEqual(design);
  });

  it("does not mutate the input design", () => {
    const design = ShipDesign.parse(baseDesign);
    const before = structuredClone(design);
    compactDesignForSerialization(design);
    expect(design).toEqual(before);
  });
});
