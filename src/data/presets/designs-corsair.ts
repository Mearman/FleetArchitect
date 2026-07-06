import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { corsairGrid, mountMultiCell, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";
import { CORSAIR_FOOTPRINTS } from "@/data/catalog/modules/corsair";
import { CORSAIR_CAPITAL_FOOTPRINTS } from "@/data/catalog/modules/corsair-capital";

// Corsair Reavers designs — asymmetric scavenger hulls. One heavy side, one
// light side; ragged silhouettes; missile volleys and scrambled ECM. Strike
// fast, blink out, let the Foundry wonder what hit it. Isolated from
// designs.ts so the roster file stays under the max-lines guard.

// Subdivision factors (f): expand each coarse cell into an f × f block of 1 m
// cells so the hull classifies to the correct tier (fighter ≤ 20 m,
// frigate ≤ 60 m, cruiser ≤ 150 m, dreadnought > 150 m).
const F_CUTLASS    = 4;   // 5 m × 4 → 20 m (fighter)
const F_REAVER     = 3;   // 7 m × 3 → 21 m (frigate)
const F_WARBRINGER = 7;   // 10 m × 7 → 70 m (cruiser)
const F_MARAUDER   = 3;   // 9 m × 3 → 27 m (frigate)
const F_GALLEON    = 12;  // 13 m × 12 → 156 m (dreadnought)

/** Corsair Reavers preset ship designs. */
export const corsairDesigns: ShipDesignInput[] = [
  {
    id: "preset-ship-cutlass",
    name: "Cutlass",
    faction: "Corsair",
    // Fighter: a fast asymmetric raider interceptor. The upper hull carries
    // heavier plating and a pair of missile racks; the lower hull is stripped
    // back for engine clearance. A salvaged reactor and magazine keep the
    // volley sustained; lateral drives give it the edge in a turning fight.
    grid: subdivideGrid(withEdges(corsairGrid([
      ".##>.",
      "ECFM#",
      "#FMGe",
      ".#<..",
    ]), [
      { col: 1, row: 1, dir: "e", kind: "door" },
      { col: 1, row: 2, dir: "e", kind: "wall" },
    ]), F_CUTLASS),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-reaver",
    name: "Reaver",
    faction: "Corsair",
    // Frigate: the classic asymmetric raider. The top half carries armour and
    // missile racks; the bottom is engine-heavy with a scrambler and a blink
    // drive for the getaway. Crew quarters sit off-centre on the lighter side.
    // It looks like it was assembled in a hurry from three different ships —
    // which it was — and it works exactly because of that.
    // Reaver: deliberately open-plan (no interior bulkheads) — the classic
    // raider is built for speed, not compartmentalisation. A sealed bulkhead
    // costs a tick of crew-reassignment latency (the trade-off for blast
    // containment), which the raid doctrine — frequent retargeting, sparse crew
    // — can't spare. The crew door bug that once forced this choice is fixed
    // (advanceCrew now reopens sealed doors), but the responsiveness trade-off
    // makes open-plan the right raider design regardless. The Reaver also fields
    // a Twin Raid Cannon (2-cell kinetic battery) on the central deck bay — a
    // fighter-mountable module hosted here because the Cutlass fighter has no
    // deck bay to receive it.
    grid: mountMultiCell(
      subdivideGrid(corsairGrid([
        ".####>.",
        "ECF##Me",
        "EFM~GJe",
        "#CFMGe.",
        "..##<..",
      ]), F_REAVER),
      F_REAVER,
      [
        // Twin raid cannon: a 2-cell kinetic battery on the central deck bay.
        // (Spec put K3 on the Cutlass fighter, which has no `~` cell and no
        // raid-cannon cell to replace; the Reaver is the frigate with a ready
        // deck bay for the twin cannon.)
        [3, 2, "cor-twin-raid-cannon", CORSAIR_CAPITAL_FOOTPRINTS.twinRaidCannon],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-warbringer",
    name: "Warbringer",
    faction: "Corsair",
    // Cruiser: a massive raider hull with a blink drive and a swarm missile
    // complement that can strip shields off a Leviathan in a single volley.
    // Asymmetric by design: the upper section is all armour and missile
    // launchers, the lower section carries the drives and the blink core.
    // Raids in, empties the magazines, blinks out before the point defences
    // find their rhythm. A raid cannon (R) per broadside gives sustained fire
    // once the missile magazines run dry, and a holo decoy launcher (L) on
    // the lower stern covers its withdrawal. The cruiser scales up to capital
    // multi-cell kit: a Heavy Swarm Rack (3-cell L-tromino broadside array), a
    // Heavy Raid Cannon (H, heavyAutocannon-band slug), and a Drone Spawner
    // (the Reavers' first carrier bay) on the prow deck. Each anchor's covered
    // cell is installed by `mountMultiCell` after subdivision.
    grid: mountMultiCell(
      subdivideGrid(withEdges(corsairGrid([
        ".##>######",
        "ECF~CMH###",
        "EFMGC~MR##",
        "#CFBGWM###",
        "##FM<GL###",
        ".##e######",
      ]), [
      { col: 0, row: 1, dir: "e", kind: "wall" },
      { col: 0, row: 2, dir: "e", kind: "wall" },
      { col: 3, row: 0, dir: "s", kind: "wall" },
      { col: 3, row: 5, dir: "n", kind: "wall" },
      { col: 4, row: 1, dir: "w", kind: "door" },
      { col: 4, row: 2, dir: "w", kind: "wall" },
      { col: 4, row: 1, dir: "e", kind: "wall" },
      { col: 4, row: 2, dir: "e", kind: "wall" },
      { col: 4, row: 2, dir: "s", kind: "wall" },
      { col: 2, row: 1, dir: "e", kind: "door" },
      { col: 2, row: 2, dir: "e", kind: "door" },
      { col: 4, row: 3, dir: "w", kind: "door" },
      { col: 4, row: 3, dir: "e", kind: "door" },
      { col: 5, row: 4, dir: "n", kind: "door" },
      { col: 5, row: 4, dir: "e", kind: "wall" },
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "door" },
      { col: 6, row: 2, dir: "e", kind: "door" },
      { col: 5, row: 3, dir: "e", kind: "wall" },
    ]), F_WARBRINGER),
      F_WARBRINGER,
      [
        // Heavy swarm rack (L-tromino) replacing the twin-rail broadside array
        // for a heavier 3-cell volley; the Y token at (5,2) is opened to a deck
        // anchor for the heavy rack.
        [5, 2, "cor-heavy-swarm-rack", CORSAIR_CAPITAL_FOOTPRINTS.heavySwarmRack],
        // Heavy autocannon replacing a raid cannon for harder sustained fire.
        [6, 1, "cor-heavy-raid-cannon", CORSAIR_FOOTPRINTS.heavyRaidCannon],
        // Drone spawner: the Reavers' first carrier capability, on the prow bay.
        [3, 1, "cor-drone-spawner", CORSAIR_CAPITAL_FOOTPRINTS.droneSpawner],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-marauder",
    name: "Marauder",
    faction: "Corsair",
    // Frigate: the ambush payoff specialist — closes under cloak, looses
    // boarding pods (O) to disable a target's systems, then finishes with
    // raid cannons (R) at point-blank. A raider missile rack (M) softens the
    // approach and an ECM scrambler (J) spoils the return fire. Twin
    // magazines (G) feed the missile rack and pods; salvaged reactors and
    // crew quarters keep the raid sustained. Balanced raid drives — aft (E),
    // forward brake (e), lateral (>/<) — let it hold position long enough to
    // board, then scatter. Fields the previously unshipped cor-boarding-pod
    // as its primary armament. Implies raid doctrine (aggressive, short-range,
    // scatter). The frigate also fields the new capital kit: a Salvage Cutter
    // (the Reavers' first beam) on the central deck bay and a Salvage Magazine
    // Vault (3-cell) replacing the standard magazine. Grid (9 cols × 5 rows),
    // subdivided ×3 → 27 m frigate.
    grid: mountMultiCell(
      subdivideGrid(withEdges(corsairGrid([
        ".####>###",
        "ECFC#MRe#",
        "EFM~~JOe#",
        "#CFMGRe##",
        ".###<O###",
      ]), [
        { col: 1, row: 1, dir: "e", kind: "door" },
        { col: 1, row: 2, dir: "e", kind: "wall" },
        { col: 1, row: 3, dir: "e", kind: "door" },
        { col: 2, row: 1, dir: "s", kind: "wall" },
        { col: 2, row: 3, dir: "n", kind: "wall" },
        { col: 2, row: 3, dir: "e", kind: "wall" },
        { col: 2, row: 2, dir: "e", kind: "door" },
        { col: 3, row: 2, dir: "e", kind: "door" },
        { col: 3, row: 3, dir: "e", kind: "wall" },
        { col: 5, row: 1, dir: "e", kind: "wall" },
        { col: 5, row: 2, dir: "e", kind: "door" },
        { col: 4, row: 4, dir: "n", kind: "door" },
        { col: 6, row: 3, dir: "e", kind: "wall" },
      ]), F_MARAUDER),
      F_MARAUDER,
      [
        // Salvage cutter beam: the Reavers' first beam, on the central deck bay.
        [3, 2, "cor-salvage-cutter", CORSAIR_CAPITAL_FOOTPRINTS.salvageCutter],
        // Salvage magazine vault: a 3-cell vault replacing the standard magazine
        // (the G token at (4,2) is opened to a deck anchor for the vault).
        [4, 2, "cor-salvage-magazine-vault", CORSAIR_CAPITAL_FOOTPRINTS.salvageMagazineVault],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-galleon",
    name: "Galleon",
    faction: "Corsair",
    // Dreadnought: the pirate treasure-ship — a vast scavenger hull that
    // raids in with a storm of raider and swarm missiles, punch-through raid
    // cannons for sustained fire, and a pair of boarding pods (O) to finish
    // crippled capitals. Banks of salvaged reactors and deep magazines feed
    // the volley; an ECM scrambler (J) strips return fire and a holo decoy
    // launcher (L) covers the withdrawal. A blink drive (B) stands by for the
    // unthinkable (retreat). Balanced raid drives — aft (E×3), forward brake
    // (e), lateral (>/<) — drive the mass. Fields cor-boarding-pod,
    // cor-raid-cannon, cor-swarm-missile, and cor-decoy-launcher. Implies
    // raid doctrine. Grid (13 cols × 7 rows), subdivided ×12 → 156 m
    // dreadnought.
    //
    // The apex hull fields the capital multi-cell kit: a Broadside Swarm Rack
    // (Y, twin-rail missile array on a broadside mount), a Heavy Raid Cannon
    // (H, heavyAutocannon-band slug), an Overdrive Reactor (X, advanced-fusion
    // command core), and an ECM Scrambler Array (U, wide-aperture jammer), plus
    // a Raider Shield Bastion (2×2 capital bubble), a Plus Scrambler Hub
    // (5-cell ECM cross-roads), and a Triple Raid Drive (1×3 thrust-train) on
    // the lower deck bays. Each anchor's covered cell is installed by
    // `mountMultiCell` after subdivision.
    grid: mountMultiCell(
      subdivideGrid(withEdges(corsairGrid([
        "..##>########",
        ".ECF~CMR#####",
        "EFMG~CYMHR###",
        "#CXBGOOUMWLe#",
        "##FMG~CWMRR##",
        ".ECF~CMR#####",
        "..##<########",
      ]), [
      { col: 1, row: 1, dir: "e", kind: "wall" },
      { col: 0, row: 2, dir: "e", kind: "wall" },
      { col: 1, row: 5, dir: "e", kind: "wall" },
      { col: 11, row: 3, dir: "w", kind: "wall" },
      { col: 4, row: 0, dir: "s", kind: "wall" },
      { col: 4, row: 6, dir: "n", kind: "wall" },
      { col: 3, row: 1, dir: "e", kind: "door" },
      { col: 3, row: 2, dir: "e", kind: "wall" },
      { col: 3, row: 5, dir: "e", kind: "door" },
      { col: 3, row: 4, dir: "e", kind: "wall" },
      { col: 4, row: 3, dir: "n", kind: "door" },
      { col: 4, row: 3, dir: "s", kind: "door" },
      { col: 4, row: 3, dir: "w", kind: "wall" },
      { col: 5, row: 3, dir: "e", kind: "door" },
      { col: 6, row: 3, dir: "e", kind: "door" },
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "door" },
      { col: 5, row: 5, dir: "e", kind: "wall" },
      { col: 5, row: 4, dir: "e", kind: "door" },
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 5, dir: "e", kind: "wall" },
    ]), F_GALLEON),
      F_GALLEON,
      [
        // Twin-rail broadside missile array on a broadside mount.
        [6, 2, "cor-broadside-swarm-rack", CORSAIR_FOOTPRINTS.broadsideSwarmRack],
        // Heavy autocannon replacing a raid cannon for harder sustained fire.
        [8, 2, "cor-heavy-raid-cannon", CORSAIR_FOOTPRINTS.heavyRaidCannon],
        // Advanced-fusion overdrive reactor (command node) replacing a
        // salvaged single-core reactor.
        [2, 3, "cor-overdrive-reactor", CORSAIR_FOOTPRINTS.overdriveReactor],
        // Wide-aperture ECM jammer array replacing the single scrambler.
        [7, 3, "cor-scrambler-array", CORSAIR_FOOTPRINTS.scramblerArray],
        // Raider shield bastion: a 2×2 capital shield bubble on the lower deck
        // bay. (The spec referenced a prow shield cell that does not exist in
        // this grid; the Galleon has no shield module, so this adds one.)
        [5, 4, "cor-raider-shield-bastion", CORSAIR_CAPITAL_FOOTPRINTS.raiderShieldBastion],
        // Plus scrambler hub: a wide-aperture 5-cell ECM cross-roads on the
        // central keel deck bay.
        [4, 2, "cor-plus-scrambler-hub", CORSAIR_CAPITAL_FOOTPRINTS.plusScramblerHub],
        // Triple raid drive: a 3-cell thrust-train on the lower keel deck bay.
        // (The spec referenced an aft drive-bank cell that does not exist; this
        // adds a triple drive alongside the existing stern drives.)
        [4, 5, "cor-raider-drive-triple", CORSAIR_CAPITAL_FOOTPRINTS.raiderDriveTriple],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
