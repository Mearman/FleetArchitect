import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { crystalGrid, mountMultiCell, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";
import { CRYSTALLINE_FOOTPRINTS } from "@/data/catalog/modules/crystalline-capital";

// Crystalline Concord designs — phase skirmishers: adaptive shields, blink,
// cloak. Brittle crystal hulls that rely on shields and mobility, not bulk.
// Isolated from designs.ts so the roster file stays under the max-lines guard.

// Subdivision factors (f): expand each coarse cell into an f × f block of 1 m
// cells so the hull classifies to the correct tier (fighter ≤ 20 m,
// frigate ≤ 60 m, cruiser ≤ 150 m, dreadnought > 150 m).
const F_SHARD    = 4;   // 11 m × 4 → 44 m (frigate)
const F_SPLINTER = 2;   // 8 m × 2 → 16 m (fighter)
const F_MONOLITH = 12;  // 13 m × 12 → 156 m (dreadnought)
const F_OBELISK  = 7;   // 11 m × 7 → 77 m (cruiser)

/** Crystalline Concord preset ship designs. */
export const crystallineDesigns: ShipDesignInput[] = [
  {
    id: "preset-ship-shard",
    name: "Shard",
    faction: "Crystalline",
    // A phase skirmisher built to blink in, strike, and cloak out. A power
    // crystal (F, command) and two resonator cores (C×2, 10 berths for 8 crew)
    // anchor a spine carrying an adaptive shield (S), a resonance shard volley
    // (the 2-cell cry-resonance-shard-volley mounted on the former bulwark
    // cell — a powerable capital-grade kinetic pairing with the phase lance's
    // beam) and a phase lance (H) as the main battery, a blink drive (B), a
    // resonance sensor (v), and a phase-cloak (K). Balanced drives — an aft
    // resonance thruster (E) plus a forward-firing brake (e) — let it hold a
    // kite. The flanking armour caps (##) form its brittle crystal silhouette;
    // it relies on shields and mobility, not hull. The shard-volley anchor is a
    // multi-cell module; `mountMultiCell` installs its covered cell after
    // subdivision. Grid (11 cols × 3 rows), subdivided ×4 → 44 m frigate.
    grid: mountMultiCell(
      subdivideGrid(withEdges(crystalGrid([
        "###########",
        "EeFCCSBKv~H",
        "###########",
      ]), [
        { col: 1, row: 1, dir: "e", kind: "door" },
        { col: 4, row: 1, dir: "e", kind: "door" },
        { col: 8, row: 1, dir: "e", kind: "door" },
      ]), F_SHARD),
      F_SHARD,
      [
        // Resonance Shard Volley (2-cell) replaces the single bulwark cell
        // with a paired shard-thrower battery — a capital-grade kinetic the
        // frigate's power crystal can feed (the capital beams are not).
        [9, 1, "cry-resonance-shard-volley", CRYSTALLINE_FOOTPRINTS.resonanceShardVolley],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-splinter",
    name: "Splinter",
    faction: "Crystalline",
    // The lean cloak-striker fighter — the disposable screen Crystalline
    // otherwise lacks. A glass needle that closes under cloak, lands a prism
    // beam strike, and folds clear; it trades the Shard's signature kit (blink
    // drive, phase lance) for a bare-minimum raider. A power crystal (F,
    // command) and one resonator core (C, 5 berths for 3 crew) feed a prism
    // beam (L), a phase-cloak (K), and a resonance sensor (v). Balanced drives
    // — an aft resonance thruster (E) and a forward brake (e). Brittle armour
    // caps (##) give it its dart silhouette. Grid (8 cols × 3 rows),
    // subdivided ×2 → 16 m fighter.
    grid: subdivideGrid(withEdges(crystalGrid([
      "########",
      "EeFCvK~L",
      "########",
    ]), [
      { col: 6, row: 1, dir: "e", kind: "door" },
    ]), F_SPLINTER),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-monolith",
    name: "Monolith",
    faction: "Crystalline",
    // A capital phase dreadnought: a crystal slab that throws a devastating
    // heavy spinal-lance pulse from behind a wall of adaptive shielding, then
    // blinks to a new bearing. A quantum lattice spire (M, command, 15 GW),
    // a quantum spire apex (the 2×2 cry-spire-apex, 175 GW command core), and
    // a quantum spire plus (the 5-cell cry-spire-plus, 25 GW command core)
    // together feed the heavy spinal lance (I, the 150 GW fixed-forward
    // capital beam — the heaviest Concord weapon, now powerable once the apex
    // reactor fields it), a heavy shard cannon (J, fixed-forward capital
    // kinetic), a resonance shard volley (the 2-cell cry-resonance-shard-volley)
    // and two phase lances (H×2) as the main battery, a resonance bulwark
    // bastion (the 2×2 cry-resonance-bulwark-bastion on the former bulwark Mk II
    // cell), a diamond bastion (the 2×2 cry-diamond-bastion) and an adaptive
    // bastion (N) — the capital multi-cell shields — for defence, a blink
    // drive (B), a resonance sensor (v), and six resonator cores (C×6, 30
    // berths for 30 crew). Balanced drives — three aft resonance thrusters
    // (E×3) and a forward brake (e). An armour prow of crystal plate (#)
    // caps the weapon face and a full dorsal/ventral plate band (#) wraps
    // the hull; the interior deck relies on its shields rather than bulk. The
    // M, I, J, N, spire-apex, spire-plus, diamond-bastion, bulwark-bastion,
    // and shard-volley anchors are multi-cell capital modules; `mountMultiCell`
    // installs each footprint's covered cells after subdivision. Grid (13
    // cols × 5 rows), subdivided ×12 → 156 m dreadnought.
    grid: mountMultiCell(
      subdivideGrid(withEdges(crystalGrid([
        "..###########",
        "E~#CC~~H~C~CI",
        "Ee#M~Bv~~####",
        "E~#CCN~H~~~~J",
        "..###########",
      ]), [
        { col: 4, row: 1, dir: "e", kind: "wall" },
        { col: 4, row: 2, dir: "e", kind: "door" },
        { col: 4, row: 3, dir: "e", kind: "wall" },
        { col: 5, row: 1, dir: "e", kind: "wall" },
        { col: 5, row: 2, dir: "e", kind: "door" },
        { col: 5, row: 3, dir: "e", kind: "wall" },
        { col: 6, row: 1, dir: "e", kind: "wall" },
        { col: 6, row: 2, dir: "e", kind: "door" },
        { col: 6, row: 3, dir: "e", kind: "wall" },
        { col: 7, row: 1, dir: "e", kind: "wall" },
        { col: 7, row: 2, dir: "e", kind: "door" },
        { col: 7, row: 3, dir: "e", kind: "wall" },
        { col: 11, row: 1, dir: "e", kind: "door" },
        { col: 11, row: 3, dir: "e", kind: "door" },
      ]), F_MONOLITH),
      F_MONOLITH,
      [
        // Keel: a three-cell Quantum Lattice Spire (M) replaces the single
        // quantum-lattice core as the 15 GW command power plant.
        [3, 2, "cry-quantum-spire", CRYSTALLINE_FOOTPRINTS.quantumSpire],
        // Keel: a 2×2 Quantum Spire Apex on the central deck — the 175 GW
        // apex capital power plant that feeds the heavy spinal lance (150 GW)
        // with margin for shields, drive, and sensors.
        [4, 2, "cry-spire-apex", CRYSTALLINE_FOOTPRINTS.spireApex],
        // Weapon face: the upper spinal mount fields the Heavy Spinal Lance
        // (I) — the heaviest Concord beam, a fixed-forward capital array the
        // spire-apex now feeds (its 150 GW draw was what browned the lattice
        // out before the apex reactor existed).
        [12, 1, "cry-spinal-lance-heavy", CRYSTALLINE_FOOTPRINTS.heavySpinalLance],
        // The lower spinal mount keeps a Heavy Shard Cannon (J) — a capital
        // kinetic alongside the beam battery.
        [12, 3, "cry-shard-cannon-heavy", CRYSTALLINE_FOOTPRINTS.heavyShardCannon],
        // Defence: the stern adaptive shield becomes a four-cell Adaptive
        // Bastion (N), the Concord's strongest bulwark.
        [5, 3, "cry-adaptive-bastion", CRYSTALLINE_FOOTPRINTS.adaptiveBastion],
        // Resonance Shard Volley (2-cell) on the weapon-face deck — a third
        // capital-grade kinetic alongside the heavy shard cannon.
        [10, 1, "cry-resonance-shard-volley", CRYSTALLINE_FOOTPRINTS.resonanceShardVolley],
        // Diamond Bastion (2×2) on the central deck cross-roads — the
        // Concord's signature capital adaptive shield.
        [7, 2, "cry-diamond-bastion", CRYSTALLINE_FOOTPRINTS.diamondBastion],
        // Resonance Bulwark Bastion (2×2) replaces the former bulwark Mk II
        // cell with a capital momentum screen.
        [5, 1, "cry-resonance-bulwark-bastion", CRYSTALLINE_FOOTPRINTS.resonanceBulwarkBastion],
        // Quantum Spire Plus (plus-shape) on the central keel deck — a
        // 25 GW command core alongside the existing 15 GW M spire.
        [8, 2, "cry-spire-plus", CRYSTALLINE_FOOTPRINTS.spirePlus],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-obelisk",
    name: "Obelisk",
    faction: "Crystalline",
    // Cruiser: a standing-stone capital — the rung the Concord lacked between
    // the Shard frigate and the Monolith dreadnought. A beam-and-shard hybrid
    // that throws phase lances and lobbed resonance shards from behind a wall
    // of adaptive shielding, then overcharges its arrays and blinks to a new
    // bearing. A quantum lattice (X, command, 5 GW) drives two phase lances
    // (H×2) and a fixed-forward heavy shard cannon (J) — the capital
    // multi-cell kinetic, subbed for the heavy spinal lance whose folded
    // 150 GW draw would brown out the lattice — as the main battery, a
    // resonance shard volley (the 2-cell cry-resonance-shard-volley mounted
    // on the former upper resonance-cannon cell) and one resonance cannon
    // (Y) for lobbed shard fire, an adaptive bastion (N) — the capital
    // multi-cell shield — and an adaptive shield Mk II (D) plus a resonance
    // bulwark Mk II (Q) for defence, a resonance mender (the 2-cell
    // cry-resonance-mender on the central deck — Crystalline's first repair
    // module), an overcharger (O) — the previously unfielded cry-overcharger
    // — to surge the arrays through a brownout, a blink drive (B), a
    // resonance sensor (v), and five resonator cores (C×5, 25 berths for 21
    // crew). Balanced drives — three aft resonance thrusters (E×3) and a
    // forward brake (e). Crystal plate (#) caps the prow and wraps the
    // dorsal/ventral band; the grown-crystal interior relies on its shields
    // and mobility, not bulk. Implies phase doctrine (evasive, long-range,
    // blink away from trouble). The J, N, shard-volley, and mender anchors
    // are multi-cell capital modules; `mountMultiCell` installs each
    // footprint's covered cells after subdivision. Grid (11 cols × 5 rows),
    // subdivided ×7 → 77 m cruiser.
    grid: mountMultiCell(
      subdivideGrid(withEdges(crystalGrid([
        "#####~#####",
        "E#CCSDH~~~J",
        "EeXOBv~~C~#",
        "E#CCQN~H~~#",
        "#####Y#####",
      ]), [
        { col: 1, row: 2, dir: "e", kind: "door" },
        { col: 3, row: 1, dir: "e", kind: "wall" },
        { col: 3, row: 2, dir: "e", kind: "door" },
        { col: 3, row: 3, dir: "e", kind: "wall" },
        { col: 5, row: 1, dir: "e", kind: "wall" },
        { col: 5, row: 2, dir: "e", kind: "door" },
        { col: 5, row: 3, dir: "e", kind: "wall" },
        { col: 7, row: 1, dir: "e", kind: "wall" },
        { col: 7, row: 2, dir: "e", kind: "door" },
        { col: 7, row: 3, dir: "e", kind: "wall" },
        { col: 5, row: 0, dir: "s", kind: "door" },
        { col: 5, row: 3, dir: "s", kind: "door" },
      ]), F_OBELISK),
      F_OBELISK,
      [
        // Weapon face: the spinal mount fields a three-cell Heavy Shard
        // Cannon (J) — the heaviest Concord kinetic the lattice can power
        // (the folded capital beams' draw would brown it out).
        [10, 1, "cry-shard-cannon-heavy", CRYSTALLINE_FOOTPRINTS.heavyShardCannon],
        // Defence: the stern adaptive shield becomes a four-cell Adaptive
        // Bastion (N), the Concord's strongest bulwark.
        [5, 3, "cry-adaptive-bastion", CRYSTALLINE_FOOTPRINTS.adaptiveBastion],
        // Resonance Shard Volley (2-cell) replaces the upper resonance cannon
        // with a twin shard-thrower battery — the kinetic upgrade.
        [5, 0, "cry-resonance-shard-volley", CRYSTALLINE_FOOTPRINTS.resonanceShardVolley],
        // Resonance Mender (L-tromino) on the central deck — Crystalline's
        // first repair module.
        [7, 2, "cry-resonance-mender", CRYSTALLINE_FOOTPRINTS.resonanceMender],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
