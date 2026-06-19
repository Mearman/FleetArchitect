import { describe, expect, it } from "vitest";
import { catalog } from "@/data/catalog";
import { createId, nowIso } from "@/domain/id";
import { analyseShipDesign } from "@/domain/stats";
import type { CellEdges, GridCell, TileGrid } from "@/schema/grid";
import type { ShipDesign } from "@/schema/ship";

// ---------------------------------------------------------------------------
// Authoring helpers
// ---------------------------------------------------------------------------

const OPEN: CellEdges = { n: "open", e: "open", s: "open", w: "open", doorStates: {} };
const WALL: CellEdges = { n: "wall", e: "wall", s: "wall", w: "wall", doorStates: {} };

function deckEquip(moduleId: string, facing = 0): GridCell {
  return {
    kind: "solid",
    scaffold: true,
    surface: "deck",
    edges: OPEN,
    equipment: { moduleId, facing },
  };
}

function makeGrid(rows: readonly string[], tokens: Record<string, GridCell>): TileGrid {
  const cols = rows[0]?.length ?? 0;
  const cells: GridCell[] = [];
  for (const row of rows) {
    for (const ch of row) {
      const cell = tokens[ch];
      if (cell === undefined) throw new Error(`bad token "${ch}"`);
      cells.push(cell);
    }
  }
  return { cols, rows: rows.length, cells, connections: [], shape: { outlineMode: "hexadecilinear" } };
}

const TERRAN: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "solid", scaffold: true, surface: "armor", edges: WALL },
  "L": deckEquip("mod-pulse-laser"),
  "F": deckEquip("mod-reactor-fusion"),
  "C": deckEquip("mod-crew-quarters"),
};

const SWARM: Record<string, GridCell> = {
  ".": { kind: "empty" },
  "#": { kind: "solid", scaffold: true, surface: "armor", edges: WALL },
  "p": deckEquip("swm-spore-launcher"),
  "g": deckEquip("swm-neural-ganglion"),
  "j": deckEquip("swm-flagellum-drive", Math.PI),
};

function design(faction: string, g: TileGrid): ShipDesign {
  return {
    id: createId("design"),
    name: "Test",
    faction,
    grid: g,
    createdAt: nowIso(),
    updatedAt: nowIso(),
    source: "user",
    revision: 1,
    shipStance: "balanced",
    crewPriority: "combat",
    rules: [],
  };
}

// ---------------------------------------------------------------------------
// Catalog faction filtering
// ---------------------------------------------------------------------------

describe("catalog faction filtering", () => {
  it("returns only Terran modules for Terran", () => {
    const mods = catalog().modulesForFaction("Terran");
    expect(mods.length).toBeGreaterThan(0);
    for (const m of mods) {
      expect(m.faction).toBe("Terran");
    }
  });

  it("returns only Swarm modules for Swarm", () => {
    const mods = catalog().modulesForFaction("Swarm");
    expect(mods.length).toBeGreaterThan(0);
    for (const m of mods) {
      expect(m.faction).toBe("Swarm");
    }
  });

  it("Terran and Swarm module sets are disjoint by id", () => {
    const terranIds = new Set(catalog().modulesForFaction("Terran").map((m) => m.id));
    const swarmIds = new Set(catalog().modulesForFaction("Swarm").map((m) => m.id));
    for (const id of swarmIds) {
      expect(terranIds.has(id)).toBe(false);
    }
  });

  it("reports both Terran and Swarm as factions", () => {
    const factions = catalog().factions();
    expect(factions).toContain("Terran");
    expect(factions).toContain("Swarm");
  });

  it("returns Swarm armor layer material for Swarm", () => {
    const swarmArmor = catalog().armorMaterial("Swarm");
    expect(swarmArmor).toBeDefined();
    expect(swarmArmor?.faction).toBe("Swarm");
  });

  it("Swarm armor material has different mass from Terran armor material", () => {
    const terranArmor = catalog().armorMaterial("Terran");
    const swarmArmor = catalog().armorMaterial("Swarm");
    expect(terranArmor).toBeDefined();
    expect(swarmArmor).toBeDefined();
    // Swarm armour plate is lighter than Terran ablative.
    expect(swarmArmor?.mass).toBeLessThan(terranArmor?.mass ?? Infinity);
  });
});

// ---------------------------------------------------------------------------
// Cross-faction validation
// ---------------------------------------------------------------------------

describe("cross-faction design validation", () => {
  it("a pure Terran design is valid", () => {
    const { valid, faults } = analyseShipDesign(
      design("Terran", makeGrid(["LFC"], TERRAN)),
      catalog(),
    );
    expect(valid, JSON.stringify(faults)).toBe(true);
    expect(faults.some((f) => f.kind === "crossFaction")).toBe(false);
  });

  it("a pure Swarm design is valid", () => {
    const { valid, faults } = analyseShipDesign(
      design("Swarm", makeGrid(["jpg"], SWARM)),
      catalog(),
    );
    expect(valid, JSON.stringify(faults)).toBe(true);
    expect(faults.some((f) => f.kind === "crossFaction")).toBe(false);
  });

  it("a design declared Terran but containing a Swarm module is flagged crossFaction", () => {
    const mixedTokens: Record<string, GridCell> = {
      ...TERRAN,
      "p": deckEquip("swm-spore-launcher"),
    };
    const g = makeGrid(["Fp"], mixedTokens);
    const { valid, faults } = analyseShipDesign(design("Terran", g), catalog());
    expect(valid).toBe(false);
    const cf = faults.find((f) => f.kind === "crossFaction");
    expect(cf).toBeDefined();
    if (cf?.kind === "crossFaction") {
      expect(cf.expected).toBe("Terran");
      expect(cf.found).toContain("Swarm");
    }
  });

  it("a design declared Swarm but containing a Terran module is flagged crossFaction", () => {
    const mixedTokens: Record<string, GridCell> = {
      ...SWARM,
      "F": deckEquip("mod-reactor-fusion"),
    };
    const g = makeGrid(["gF"], mixedTokens);
    const { valid, faults } = analyseShipDesign(design("Swarm", g), catalog());
    expect(valid).toBe(false);
    const cf = faults.find((f) => f.kind === "crossFaction");
    expect(cf).toBeDefined();
    if (cf?.kind === "crossFaction") {
      expect(cf.expected).toBe("Swarm");
      expect(cf.found).toContain("Terran");
    }
  });

  it("crossFaction fault names the wrong factions found, not the correct one", () => {
    const mixedTokens: Record<string, GridCell> = {
      "F": deckEquip("mod-reactor-fusion"),
      "p": deckEquip("swm-spore-launcher"),
    };
    const { faults } = analyseShipDesign(
      design("Terran", makeGrid(["Fp"], mixedTokens)),
      catalog(),
    );
    const cf = faults.find((f) => f.kind === "crossFaction");
    if (cf?.kind === "crossFaction") {
      expect(cf.found).not.toContain("Terran");
    }
  });
});

// ---------------------------------------------------------------------------
// Faction-specific layer-material stats feed into mass calculation
// ---------------------------------------------------------------------------

describe("faction-specific layer-material stats", () => {
  it("a Swarm armor cell uses Swarm layer-material mass, not Terran", () => {
    // A Swarm design with one armor cell + neural ganglion.
    const swarmTokens: Record<string, GridCell> = {
      "#": { kind: "solid", scaffold: true, surface: "armor", edges: WALL },
      "g": deckEquip("swm-neural-ganglion"),
    };
    const { stats: swarmStats } = analyseShipDesign(
      design("Swarm", makeGrid(["#g"], swarmTokens)),
      catalog(),
    );

    const terranTokens: Record<string, GridCell> = {
      "#": { kind: "solid", scaffold: true, surface: "armor", edges: WALL },
      "F": deckEquip("mod-reactor-fusion"),
    };
    const { stats: terranStats } = analyseShipDesign(
      design("Terran", makeGrid(["#F"], terranTokens)),
      catalog(),
    );

    // Swarm armor (mass 12) + scaffold (mass 1) + neural ganglion (mass 6) = 19
    // Terran armor (mass 30) + scaffold (mass 2) + fusion reactor (mass 10) = 42
    expect(swarmStats.mass).toBeLessThan(terranStats.mass);
  });
});

// ---------------------------------------------------------------------------
// Six-faction catalogue completeness (factions update)
// ---------------------------------------------------------------------------

describe("catalogue faction completeness", () => {
  const EXPECTED_FACTIONS: string[] = ["Terran", "Swarm", "Crystalline", "Foundry", "Corsair", "Synthetic"];

  it("reports all six factions", () => {
    const factions = new Set(catalog().factions());
    for (const f of EXPECTED_FACTIONS) {
      expect(factions.has(f), `missing faction ${f}`).toBe(true);
    }
  });

  it("every module id is unique across the whole catalogue", () => {
    const ids = catalog().allModules().map((m) => m.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  for (const faction of EXPECTED_FACTIONS) {
    it(`${faction} has a command module, an engine, a weapon, and all three layer materials`, () => {
      const mods = catalog().modulesForFaction(faction);
      expect(mods.some((m) => m.command === true), `${faction} needs a command module`).toBe(true);
      expect(mods.some((m) => m.effect.kind === "engine"), `${faction} needs an engine`).toBe(true);
      expect(mods.some((m) => m.effect.kind === "weapon"), `${faction} needs a weapon`).toBe(true);
      expect(catalog().scaffoldMaterial(faction), `${faction} missing scaffold material`).toBeDefined();
      expect(catalog().deckMaterial(faction), `${faction} missing deck material`).toBeDefined();
      expect(catalog().armorMaterial(faction), `${faction} missing armor material`).toBeDefined();
    });

    it(`${faction} can build a valid ship from its own parts`, () => {
      // Assemble the smallest valid ship from this faction's parts: a command
      // module, an engine, a weapon, and a crew module / magazine as needed.
      // Prefer a weapon without a finite magazine so no ammo source is required;
      // if every weapon needs ammo, add the faction's magazine too.
      const mods = catalog().modulesForFaction(faction);
      const command = mods.find((m) => m.command === true);
      const engine = mods.find((m) => m.effect.kind === "engine");
      const weapon =
        mods.find((m) => m.effect.kind === "weapon" && m.effect.ammoCapacity === undefined) ??
        mods.find((m) => m.effect.kind === "weapon");
      const crew = mods.find((m) => m.effect.kind === "crew");
      const magazine = mods.find((m) => m.effect.kind === "magazine");
      if (command === undefined || engine === undefined || weapon === undefined) {
        throw new Error(`${faction} missing a command/engine/weapon module`);
      }
      // Lay equipment on deck cells, left-to-right (a 4-connected row), engines
      // facing aft (π) so their thrust drives the ship forward.
      const cells: GridCell[] = [
        deckEquip(command.id, 0),
        deckEquip(weapon.id, 0),
        deckEquip(engine.id, Math.PI),
      ];
      const weaponNeedsAmmo =
        weapon.effect.kind === "weapon" && weapon.effect.ammoCapacity !== undefined;
      if (weaponNeedsAmmo) {
        if (magazine === undefined) {
          throw new Error(`${faction} weapon needs ammo but has no magazine`);
        }
        cells.push(deckEquip(magazine.id, 0));
      }
      const placedDefs = cells
        .filter((c): c is Extract<GridCell, { kind: "solid" }> => c.kind === "solid")
        .map((c) => (c.equipment !== undefined ? mods.find((m) => m.id === c.equipment?.moduleId) : undefined))
        .filter((m): m is NonNullable<typeof m> => m !== undefined);
      const crewRequired = placedDefs.reduce((s, m) => s + m.crewRequired, 0);
      if (crewRequired > 0) {
        if (crew === undefined) {
          throw new Error(`${faction} needs crew but has no crew module`);
        }
        cells.push(deckEquip(crew.id, 0));
      }
      const grid: TileGrid = { cols: cells.length, rows: 1, cells, connections: [], shape: { outlineMode: "hexadecilinear" } };
      const { valid, faults } = analyseShipDesign(design(faction, grid), catalog());
      expect(valid, `${faction} minimal ship invalid: ${JSON.stringify(faults)}`).toBe(true);
    });
  }
});
