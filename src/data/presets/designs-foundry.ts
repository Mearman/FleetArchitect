import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { foundryGrid, mountMultiCell, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";
import { FOUNDRY_FOOTPRINTS } from "@/data/catalog/modules/foundry-capital";

// Foundry Combine designs, isolated from designs.ts so the roster file stays
// under the max-lines guard. Slow, heavily-armoured fortress slabs: thick
// reactive prows, repair bays that weld damage shut, and (after the roster
// review) real capital weapons — gauss, siege plasma, torpedoes, flak,
// bulwark deflectors. No shields — they take every hit on the plate.

// Subdivision factors: expand each coarse cell into an f × f block of 1 m
// cells so the hull classifies to the correct tier (fighter ≤ 20 m,
// frigate ≤ 60 m, cruiser ≤ 150 m, dreadnought > 150 m).
const F_INGOT       = 4;   // 5 m × 4 → 20 m (fighter)
const F_ANVIL       = 3;   // 7 m × 3 → 21 m (frigate)
const F_BATTLERAM   = 6;   // 11 m × 6 → 66 m (cruiser)
const F_SIEGE_TITAN = 12;  // 13 m × 12 → 156 m (dreadnought)
const F_CRUCIBLE    = 3;   // 7 m × 3 → 21 m (frigate)
const F_CAULDRON    = 6;   // 11 m × 6 → 66 m (cruiser)

/** Foundry Combine preset ship designs. */
export const foundryDesigns: ShipDesignInput[] = [
  {
    id: "preset-ship-ingot",
    name: "Ingot",
    faction: "Foundry",
    // Fighter: the heavy interceptor. A squat block of reactive plating around
    // an autocannon battery and a pair of crew barracks; slow but near-unkillable.
    grid: subdivideGrid(withEdges(foundryGrid([
      "###>#",
      "#CFA#",
      "EFAGe",
      "#CFA#",
      "###<#",
    ]), [
      { col: 2, row: 1, dir: "e", kind: "wall" },
      { col: 2, row: 2, dir: "e", kind: "door" },
      { col: 2, row: 3, dir: "e", kind: "wall" },
    ]), F_INGOT),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-anvil",
    name: "Anvil",
    faction: "Foundry",
    // Frigate: a fortress slab with a deep reactive prow and an autocannon
    // battery fronted by a damage-control bay. No shields — it absorbs fire.
    grid: subdivideGrid(withEdges(foundryGrid([
      "####>##",
      "ECFW~A#",
      "XFW~AGe",
      "ECFW~A#",
      "####<##",
    ]), [
      { col: 0, row: 1, dir: "e", kind: "wall" },
      { col: 0, row: 2, dir: "e", kind: "door" },
      { col: 0, row: 3, dir: "e", kind: "wall" },
      { col: 1, row: 1, dir: "e", kind: "wall" },
      { col: 1, row: 2, dir: "e", kind: "door" },
      { col: 1, row: 3, dir: "e", kind: "wall" },
      { col: 3, row: 1, dir: "e", kind: "wall" },
      { col: 3, row: 2, dir: "e", kind: "door" },
      { col: 3, row: 3, dir: "e", kind: "wall" },
      { col: 4, row: 1, dir: "e", kind: "wall" },
      { col: 4, row: 2, dir: "e", kind: "door" },
      { col: 4, row: 3, dir: "e", kind: "wall" },
    ]), F_ANVIL),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-battleram",
    name: "Battleram",
    faction: "Foundry",
    // Cruiser, re-armed: heavy gauss cannons (H, fnd-heavy-cannon) form the
    // broadside, flak batteries (L) shred ordnance, a bulwark deflector (U)
    // arrests kinetics, a mine layer (M) holds the close lane. The centre keel
    // steps up to capital multi-cell stores: a Shell Magazine Bunker (K,
    // 2× the standard magazine's rounds) and a Damage Control Bastion (T,
    // 2× the repair bay's welder headcount). Each anchor's covered cell is
    // installed by `mountMultiCell` after subdivision.
    grid: mountMultiCell(
      subdivideGrid(withEdges(foundryGrid([
        "..###H####.",
        ".#XCFW~HAG#",
        "#XCCW~LUAG#",
        "PXCCFTHMAKe",
        "#XCCW~LUAG#",
        ".#XCFW~HAG#",
        "..###H####.",
      ]), [
        { col: 1, row: 2, dir: "e", kind: "wall" },
        { col: 1, row: 3, dir: "e", kind: "door" },
        { col: 1, row: 4, dir: "e", kind: "wall" },
        { col: 3, row: 1, dir: "e", kind: "wall" },
        { col: 3, row: 2, dir: "e", kind: "wall" },
        { col: 3, row: 3, dir: "e", kind: "door" },
        { col: 3, row: 4, dir: "e", kind: "wall" },
        { col: 3, row: 5, dir: "e", kind: "wall" },
        { col: 5, row: 1, dir: "e", kind: "wall" },
        { col: 5, row: 2, dir: "e", kind: "wall" },
        { col: 5, row: 3, dir: "e", kind: "door" },
        { col: 5, row: 4, dir: "e", kind: "wall" },
        { col: 5, row: 5, dir: "e", kind: "wall" },
        { col: 7, row: 1, dir: "e", kind: "wall" },
        { col: 7, row: 2, dir: "e", kind: "wall" },
        { col: 7, row: 3, dir: "e", kind: "door" },
        { col: 7, row: 4, dir: "e", kind: "wall" },
        { col: 7, row: 5, dir: "e", kind: "wall" },
        { col: 8, row: 1, dir: "e", kind: "wall" },
        { col: 8, row: 2, dir: "e", kind: "door" },
        { col: 8, row: 3, dir: "e", kind: "wall" },
        { col: 8, row: 4, dir: "e", kind: "door" },
        { col: 8, row: 5, dir: "e", kind: "wall" },
      ]), F_BATTLERAM),
      F_BATTLERAM,
      [
        [9, 3, "fnd-magazine-bunker", FOUNDRY_FOOTPRINTS.magazineBunker],
        [5, 3, "fnd-repair-bastion", FOUNDRY_FOOTPRINTS.repairBastion],
        // Repair lathe: an L-tromino welder cluster running alongside the
        // damage-control bastion. (The gauss turret bank was relocated to the
        // Cauldron — the Battleram's crew headroom takes only one of the two.)
        [5, 2, "fnd-repair-lathe", FOUNDRY_FOOTPRINTS.repairLathe],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-siege-titan",
    name: "Siege Titan",
    faction: "Foundry",
    // Dreadnought, re-armed: siege-plasma mortars (Q) alpha, gauss cannons (H)
    // sustain, torpedoes (Y) crack plate, flak (L) and bulwark deflectors (U)
    // screen every vector — the previously unfielded capital battery. Plus
    // repair bays (W) and a mine layer (M).
    //
    // The apex hull fields the capital multi-cell kit. The stern grav drive (P)
    // becomes a three-cell Forge Drive train (J); the keel Industrial Core (X)
    // becomes the four-cell T-section Cross-Section Core command heart (Z); the
    // centre siege-plasma (Q) becomes the 2×2 Siege Cannon Heavy (S); the fore
    // bulwark deflector (U) steps up to a 2×2 Bulwark Bastion (N) and the aft
    // one to a TL4 1×3 Bulwark Screen Bank — the dreadnought's deflector band.
    // One mine layer is trimmed to cover the Screen Bank's cost delta within the
    // fleet budget. Each anchor's covered cells are installed by `mountMultiCell`
    // after subdivision.
    grid: mountMultiCell(
      subdivideGrid(withEdges(foundryGrid([
        "...##>######.",
        "..##XCFW~HL##",
        ".##XCCW~HQG##",
        "##XCCCFWNQMY#",
        "JZCCCFW~SHGe#",
        "##XCCCFW~Q~Y#",
        ".##XCCW~HQG##",
        "..##XCFW~HL##",
        "...##<######.",
      ]), [
        { col: 1, row: 4, dir: "e", kind: "door" },
        { col: 3, row: 2, dir: "e", kind: "wall" },
        { col: 3, row: 3, dir: "e", kind: "wall" },
        { col: 3, row: 4, dir: "e", kind: "door" },
        { col: 3, row: 5, dir: "e", kind: "wall" },
        { col: 3, row: 6, dir: "e", kind: "wall" },
        { col: 5, row: 1, dir: "e", kind: "wall" },
        { col: 5, row: 2, dir: "e", kind: "wall" },
        { col: 5, row: 3, dir: "e", kind: "wall" },
        { col: 5, row: 4, dir: "e", kind: "door" },
        { col: 5, row: 5, dir: "e", kind: "wall" },
        { col: 5, row: 6, dir: "e", kind: "wall" },
        { col: 5, row: 7, dir: "e", kind: "wall" },
        { col: 7, row: 1, dir: "e", kind: "wall" },
        { col: 7, row: 2, dir: "e", kind: "wall" },
        { col: 7, row: 3, dir: "e", kind: "wall" },
        { col: 7, row: 4, dir: "e", kind: "door" },
        { col: 7, row: 5, dir: "e", kind: "wall" },
        { col: 7, row: 6, dir: "e", kind: "wall" },
        { col: 7, row: 7, dir: "e", kind: "wall" },
        { col: 8, row: 1, dir: "e", kind: "wall" },
        { col: 8, row: 2, dir: "e", kind: "wall" },
        { col: 8, row: 3, dir: "e", kind: "wall" },
        { col: 8, row: 4, dir: "e", kind: "door" },
        { col: 8, row: 5, dir: "e", kind: "wall" },
        { col: 8, row: 6, dir: "e", kind: "wall" },
        { col: 8, row: 7, dir: "e", kind: "wall" },
        { col: 9, row: 1, dir: "e", kind: "wall" },
        { col: 9, row: 2, dir: "e", kind: "door" },
        { col: 9, row: 3, dir: "e", kind: "wall" },
        { col: 9, row: 4, dir: "e", kind: "wall" },
        { col: 9, row: 5, dir: "e", kind: "wall" },
        { col: 9, row: 6, dir: "e", kind: "door" },
        { col: 9, row: 7, dir: "e", kind: "wall" },
        { col: 10, row: 3, dir: "e", kind: "door" },
        { col: 10, row: 4, dir: "e", kind: "wall" },
        { col: 10, row: 5, dir: "e", kind: "door" },
      ]), F_SIEGE_TITAN),
      F_SIEGE_TITAN,
      [
        // Stern: the 1×3 Forge Drive train (J) replaces the grav drive as the
        // main capital propulsion.
        [0, 4, "fnd-forge-drive", FOUNDRY_FOOTPRINTS.forgeDrive],
        // Keel reactor: the T-section Cross-Section Core (Z) — the 12 GW
        // command heart, supplanting the single Industrial Core.
        [1, 4, "fnd-cross-section-core", FOUNDRY_FOOTPRINTS.crossSectionCore],
        // Centre keel: the 2×2 Siege Cannon Heavy (S) replaces the
        // siege-plasma as the heaviest alpha strike.
        [8, 4, "fnd-siege-cannon-heavy", FOUNDRY_FOOTPRINTS.siegeCannonHeavy],
        // Flanking momentum screens: a 2×2 Bulwark Bastion (N) fore, and a TL4
        // 1×3 Bulwark Screen Bank aft — the dreadnought's capital deflector
        // band, stepping the aft screen up from the Bastion. The aft Bastion's
        // N token is dropped to a `~` deck cell so the Screen Bank anchor
        // installs cleanly (empty-anchor branch).
        [8, 3, "fnd-bulwark-bastion", FOUNDRY_FOOTPRINTS.bulwarkBastion],
        [8, 5, "fnd-bulwark-screen-bank", FOUNDRY_FOOTPRINTS.bulwarkScreenBank],
        // Twin siege mortar: a 2×2 capital plasma battery alongside the
        // siege-plasma battery — the apex alpha strike.
        [7, 2, "fnd-twin-siege-mortar", FOUNDRY_FOOTPRINTS.twinSiegeMortar],
        // Plus-section forge core: a five-cell advanced-fusion command cross
        // at the central keel deck cross-roads, alongside the antimatter core.
        [7, 4, "fnd-plus-forge-core", FOUNDRY_FOOTPRINTS.plusForgeCore],
        // Heavy magazine bunker: a 2×2 blast-door reserve feeding the
        // dreadnought's siege battery through a long slugging match.
        [7, 6, "fnd-magazine-bunker-heavy", FOUNDRY_FOOTPRINTS.magazineBunkerHeavy],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-crucible",
    name: "Crucible",
    faction: "Foundry",
    // Frigate PD escort: flak batteries (L, fnd-flak-battery) flank an
    // autocannon (A) to shred incoming ordnance so the slabs reach range.
    // Repair bay (W), magazine (G), balanced drives. Grid 7×5, ×3 → 21 m.
    grid: mountMultiCell(
      subdivideGrid(withEdges(foundryGrid([
        "####>##",
        "ECFWL~#",
        "CFAGLGe",
        "ECFWL~#",
        "####<##",
      ]), [
        { col: 0, row: 1, dir: "e", kind: "wall" },
        { col: 0, row: 2, dir: "e", kind: "door" },
        { col: 0, row: 3, dir: "e", kind: "wall" },
        { col: 1, row: 1, dir: "e", kind: "wall" },
        { col: 1, row: 2, dir: "e", kind: "door" },
        { col: 1, row: 3, dir: "e", kind: "wall" },
        { col: 2, row: 1, dir: "e", kind: "wall" },
        { col: 2, row: 2, dir: "e", kind: "door" },
        { col: 2, row: 3, dir: "e", kind: "wall" },
        { col: 3, row: 1, dir: "e", kind: "wall" },
        { col: 3, row: 2, dir: "e", kind: "door" },
        { col: 3, row: 3, dir: "e", kind: "wall" },
      ]), F_CRUCIBLE),
      F_CRUCIBLE,
      [
        // Twin torpedo bank: a 2-cell capital-grade alpha strike on a frigate
        // hull, mounted on the forward deck.
        [5, 1, "fnd-twin-torpedo-bank", FOUNDRY_FOOTPRINTS.twinTorpedoBank],
        // Twin autocannon: a 2-cell gauss-band battery. Fielded on the
        // Crucible (the Anvil carries no crew headroom for a crewed upgrade).
        [5, 3, "fnd-twin-autocannon", FOUNDRY_FOOTPRINTS.twinAutocannon],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-cauldron",
    name: "Cauldron",
    faction: "Foundry",
    // Cruiser minelayer: sows minefields across approach lanes (M, five
    // layers) while heavy cannons (H) and flak (L) dissuade anything that
    // closes. Magazines (G) feed the ammo weapons; repair bays (W) sustain.
    grid: mountMultiCell(
      subdivideGrid(withEdges(foundryGrid([
        "..###>####.",
        ".#XCFW~MLG#",
        "#XCCW~MHAG#",
        "~XCCFWMHAGe",
        "#XCCW~MHAG#",
        ".#XCFW~MLG#",
        "..###<####.",
      ]), [
        { col: 1, row: 2, dir: "e", kind: "wall" },
        { col: 1, row: 3, dir: "e", kind: "door" },
        { col: 1, row: 4, dir: "e", kind: "wall" },
        { col: 3, row: 1, dir: "e", kind: "wall" },
        { col: 3, row: 2, dir: "e", kind: "wall" },
        { col: 3, row: 3, dir: "e", kind: "door" },
        { col: 3, row: 4, dir: "e", kind: "wall" },
        { col: 3, row: 5, dir: "e", kind: "wall" },
        { col: 5, row: 1, dir: "e", kind: "wall" },
        { col: 5, row: 2, dir: "e", kind: "wall" },
        { col: 5, row: 3, dir: "e", kind: "door" },
        { col: 5, row: 4, dir: "e", kind: "wall" },
        { col: 5, row: 5, dir: "e", kind: "wall" },
        { col: 7, row: 1, dir: "e", kind: "wall" },
        { col: 7, row: 2, dir: "e", kind: "wall" },
        { col: 7, row: 3, dir: "e", kind: "door" },
        { col: 7, row: 4, dir: "e", kind: "wall" },
        { col: 7, row: 5, dir: "e", kind: "wall" },
        { col: 8, row: 1, dir: "e", kind: "wall" },
        { col: 8, row: 2, dir: "e", kind: "door" },
        { col: 8, row: 3, dir: "e", kind: "wall" },
        { col: 8, row: 4, dir: "e", kind: "door" },
        { col: 8, row: 5, dir: "e", kind: "wall" },
      ]), F_CAULDRON),
      F_CAULDRON,
      [
        // Flak bunker: a 2×2 capital point-defence block on the cruiser's
        // central deck — four ganged flak turrets behind blast walls.
        [5, 2, "fnd-flak-bunker", FOUNDRY_FOOTPRINTS.flakBunker],
        // Gauss turret bank: a 2-cell traversing twin coilgun. Relocated from
        // the Battleram (crew-tight) to this cruiser, where it joins the
        // heavy-cannon broadside.
        [5, 4, "fnd-gauss-turret-bank", FOUNDRY_FOOTPRINTS.gaussTurretBank],
        // Twin grav drive: a 2-cell capital drive train (320 kN, double the
        // singleton grav drive) on the stern, replacing the singleton grav
        // drive. The stern P token is dropped to a `~` deck cell so the anchor
        // installs facing aft (π) via the empty-anchor branch.
        [0, 3, "fnd-twin-grav-drive", FOUNDRY_FOOTPRINTS.twinGravDrive, Math.PI],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
