import type { input } from "zod";
import type { ShipDesign } from "@/schema/ship";

/** Same ShipDesign input shape used by designs.ts: schema defaults optional. */
type ShipDesignInput = input<typeof ShipDesign>;

import { swarmGrid, mountMultiCell, PRESET_TIME, withEdges } from "@/data/presets/tokens";
import type { AuthoredEdge } from "@/data/presets/tokens";
import { subdivideGrid } from "@/domain/shipgen";
import { SWARM_FOOTPRINTS } from "@/data/catalog/modules/swarm-capital";

// Swarm designs — bio-organic insectoid ships. Asymmetric, clawed, organic
// silhouettes: tapered stingers, swept carapace, clustered drive flagella.
// Swarm weapons are all bio-organic — spore launchers (cannon), acid sprayers
// (beam), and neural stings (missile with tracking). Neural stings have no
// ammoCapacity in the schema (guided bio-electric tendrils, not discrete
// rounds), so no ammon sac is needed even for sting-armed ships. All Swarm
// crewRequired values are 0; no crew quarters are needed either. Isolated
// from designs.ts so the roster file stays under the max-lines guard.

/** A vertical compartment bulkhead at `col` (its east edges): wall on every row
 *  except the listed `doorRows` (transit doors). Used by the crewless capital
 *  hulls (Devourer) for silhouette + blast containment — closed doors block
 *  chain reactions, and with no crew to reopen them the bulkheads stay sealed. */
function bulkhead(col: number, doorRows: number[]): AuthoredEdge[] {
  const edges: AuthoredEdge[] = [];
  for (let row = 0; row <= 6; row += 1) {
    edges.push({ col, row, dir: "e", kind: doorRows.includes(row) ? "door" : "wall" });
  }
  return edges;
}

// Subdivision factors (f): expand each coarse cell into an f × f block of 1 m
// cells so the hull classifies to the correct tier (fighter ≤ 20 m,
// frigate ≤ 60 m, cruiser ≤ 150 m, dreadnought > 150 m).
const F_DRONE     = 3;   // 6 m × 3 → 18 m (fighter; armour sits on the left edge
                        // only so chamfer growth leaves the longest axis ≤ 20 m)
const F_CARRION   = 2;   // 7 m × 2 → 14 m (fighter)
const F_RAVAGER   = 3;   // 9 m × 3 → 27 m (frigate)
const F_SPITTER   = 3;   // 10 m × 3 → 30 m (frigate)
const F_HIVE_LORD = 5;   // 13 m × 5 → 65 m (cruiser)
const F_DEVOURER  = 12;  // 14 m × 12 → 168 m (dreadnought)

/** Swarm preset ship designs. */
export const swarmDesigns: ShipDesignInput[] = [
  {
    id: "preset-ship-drone",
    name: "Drone Skimmer",
    faction: "Swarm",
    // Fighter: the expendable chaff brawler — the brick the Swarm throws in
    // numbers. A spore launcher snout and a neural ganglion core over twin
    // flagella, with a regen-membrane spine (r) running fore–aft through the
    // hull so a Drone cloud knits back together and survives the approach.
    // Tougher but slower than the Carrion flanker (no pulse jet). No crew, no
    // ammo. An electro-receptor membrane (e) and a pheromone net (h) sit on the
    // aft wing tips for hive-net awareness on channel 0; pseudopod clusters (x)
    // let it turn.
    grid: subdivideGrid(withEdges(swarmGrid([
      "#>xpre",
      "jgfprp",
      "#<xprh",
    ]), [
      { col: 2, row: 0, dir: "e", kind: "wall" },
      { col: 2, row: 1, dir: "e", kind: "door" },
      { col: 2, row: 2, dir: "e", kind: "wall" },
    ]), F_DRONE),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-carrion",
    name: "Carrion Wing",
    faction: "Swarm",
    // Fighter: the glass-cannon knife-range flanker — the blade that gets
    // behind armour and strips it. Opposite of the Drone: faster and more
    // fragile. Forward-swept acid claws dissolve plate at knife range; a pulse
    // jet (u) over the flagella gives it the speed edge. The armour shoulders
    // are gone — only a pair of carapace screens (w) at the prow offer token
    // kinetic defence. The ganglion core and flagella bank fill out the hull.
    grid: subdivideGrid(withEdges(swarmGrid([
      "..>xaw.",
      "j~gfaa.",
      "ug~gfaa",
      "j~gfaa.",
      "..<xaw.",
    ]), [
      { col: 3, row: 0, dir: "e", kind: "wall" },
      { col: 3, row: 1, dir: "e", kind: "wall" },
      { col: 3, row: 2, dir: "e", kind: "door" },
      { col: 3, row: 3, dir: "e", kind: "wall" },
      { col: 3, row: 4, dir: "e", kind: "wall" },
    ]), F_CARRION),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-ravager",
    name: "Ravager Assault Ship",
    faction: "Swarm",
    // Frigate: a regenerating brawler. Banks of acid sprayers over a
    // self-knitting carapace, a metabolic core, and a cluster of flagella and
    // pulse jets. No discrete ammo weapons so no ammon sac needed.
    // Catalogue-expansion refit: a two-cell Twin Sting Launcher is grafted onto
    // the prow deck cell, adding a homing-ordnance battery to the acid brawler.
    grid: mountMultiCell(
      subdivideGrid(withEdges(swarmGrid([
        "#>jx~aa##",
        "jgf~zaaa.",
        "ugm~rfaaa",
        "jgf~zaaa.",
        "#<jx~aa##",
      ]), [
        { col: 0, row: 1, dir: "e", kind: "wall" },
        { col: 0, row: 2, dir: "e", kind: "door" },
        { col: 0, row: 3, dir: "e", kind: "wall" },
        { col: 2, row: 0, dir: "e", kind: "wall" },
        { col: 2, row: 1, dir: "e", kind: "door" },
        { col: 2, row: 2, dir: "e", kind: "wall" },
        { col: 2, row: 3, dir: "e", kind: "door" },
        { col: 2, row: 4, dir: "e", kind: "wall" },
        { col: 4, row: 0, dir: "e", kind: "wall" },
        { col: 4, row: 1, dir: "e", kind: "wall" },
        { col: 4, row: 2, dir: "e", kind: "door" },
        { col: 4, row: 3, dir: "e", kind: "wall" },
        { col: 4, row: 4, dir: "e", kind: "wall" },
      ]), F_RAVAGER),
      F_RAVAGER,
      [
        // Prow deck cell: a two-cell Twin Sting Launcher (missile) adds a
        // homing-ordnance battery. Anchor on the `~` at coarse (4,0); the
        // east offset stays within the anchor's block.
        [4, 0, "swm-twin-sting-launcher", SWARM_FOOTPRINTS.twinStingLauncher],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-spitter",
    name: "Brood Spitter",
    faction: "Swarm",
    // Frigate: living artillery. A fan of neural stingers spits homing tendrils
    // downrange; spore clouds screen it. Neural stings have no ammoCapacity so
    // no ammon sac is required. Regen membranes and a metabolic core sustain it.
    // Catalogue-expansion refit: a two-cell Acid Dripper is grafted onto the
    // central deck cell, adding a heavier corrosive beam to the sting battery.
    grid: mountMultiCell(
      subdivideGrid(withEdges(swarmGrid([
        ".#>xsnn#..",
        ".jgfzsnnn.",
        "ugm~rfsnnn",
        ".jgfzsnnn.",
        ".#<xsnn#..",
      ]), [
        { col: 2, row: 0, dir: "e", kind: "wall" },
        { col: 2, row: 1, dir: "e", kind: "door" },
        { col: 2, row: 2, dir: "e", kind: "wall" },
        { col: 2, row: 3, dir: "e", kind: "door" },
        { col: 2, row: 4, dir: "e", kind: "wall" },
        { col: 4, row: 0, dir: "e", kind: "wall" },
        { col: 4, row: 1, dir: "e", kind: "wall" },
        { col: 4, row: 2, dir: "e", kind: "door" },
        { col: 4, row: 3, dir: "e", kind: "wall" },
        { col: 4, row: 4, dir: "e", kind: "wall" },
        { col: 5, row: 0, dir: "e", kind: "wall" },
        { col: 5, row: 1, dir: "e", kind: "door" },
        { col: 5, row: 2, dir: "e", kind: "wall" },
        { col: 5, row: 3, dir: "e", kind: "door" },
        { col: 5, row: 4, dir: "e", kind: "wall" },
      ]), F_SPITTER),
      F_SPITTER,
      [
        // Central deck cell: a two-cell Acid Dripper (beam) adds a heavier
        // corrosive jet. Anchor on the `~` at coarse (3,2); the east offset
        // stays within the anchor's block.
        [3, 2, "swm-acid-dripper", SWARM_FOOTPRINTS.acidDripper],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-hive-lord",
    name: "Hive Lord",
    faction: "Swarm",
    // Cruiser: the swarm capital. A great clawed prow of neural stingers and
    // acid sprayers over a regenerating carapace, ringed by spore-cloud defences,
    // with a metabolic heart and a bank of pulse-jet flagella driving the whole
    // mass. No discrete ammo weapons; no ammon sac needed.
    // Phase B: pheromone nets (h) on rows 1 and 5 provide omni squad-net
    // coverage on channel 0. Chemosensor organs (y) on rows 2 and 4 extend
    // the hive's detection reach well beyond weapon range. A biolaser spine
    // (k) on row 3 extends the Hive Lord to a high-bandwidth backbone relay
    // linking other hive-kin on the same channel. All bio-comms/sensors are
    // autonomous (crewRequired 0), adding only metabolic draw.
    // Merged: keeps the biolaser spines (k), pheromone nets (h) and chemosensor
    // organs (y) for hive-net coverage, and adds pseudopod clusters (x) plus
    // gyral organs (z) on the spine so the capital can come about.
    // Capital multi-cell refit: the centre keel trades one neural sting for a
    // four-cell Bloom Cannon (O, the heavyAutocannon-band main battery), one
    // ganglion for a three-cell Metabolic Heart (H, a 3.6 GW compound command
    // reactor), and the prow sting for a three-cell Barkweave Carapace (W, the
    // heavy deflector band). Each anchor's covered cells are installed by
    // `mountMultiCell` after subdivision.
    grid: mountMultiCell(
      subdivideGrid(withEdges(swarmGrid([
        "..#>x~nnnkccc",
        "..jgfzrsnnnnh",
        ".jgm~rfsannny",
        "uHmm~rfsaaOnW",
        ".jgm~rfsannny",
        "..jgfzrsnnnnh",
        "..#<x~nnnkccc",
      ]), [
      { col: 1, row: 2, dir: "e", kind: "wall" },
      { col: 1, row: 3, dir: "e", kind: "door" },
      { col: 1, row: 4, dir: "e", kind: "wall" },
      { col: 3, row: 0, dir: "e", kind: "wall" },
      { col: 3, row: 1, dir: "e", kind: "door" },
      { col: 3, row: 2, dir: "e", kind: "wall" },
      { col: 3, row: 3, dir: "e", kind: "wall" },
      { col: 3, row: 4, dir: "e", kind: "wall" },
      { col: 3, row: 5, dir: "e", kind: "door" },
      { col: 3, row: 6, dir: "e", kind: "wall" },
      { col: 5, row: 0, dir: "e", kind: "wall" },
      { col: 5, row: 1, dir: "e", kind: "wall" },
      { col: 5, row: 2, dir: "e", kind: "wall" },
      { col: 5, row: 3, dir: "e", kind: "door" },
      { col: 5, row: 4, dir: "e", kind: "wall" },
      { col: 5, row: 5, dir: "e", kind: "wall" },
      { col: 5, row: 6, dir: "e", kind: "wall" },
      { col: 7, row: 0, dir: "e", kind: "wall" },
      { col: 7, row: 1, dir: "e", kind: "wall" },
      { col: 7, row: 2, dir: "e", kind: "wall" },
      { col: 7, row: 3, dir: "e", kind: "door" },
      { col: 7, row: 4, dir: "e", kind: "wall" },
      { col: 7, row: 5, dir: "e", kind: "wall" },
      { col: 7, row: 6, dir: "e", kind: "wall" },
      { col: 9, row: 0, dir: "e", kind: "wall" },
      { col: 9, row: 1, dir: "e", kind: "wall" },
      { col: 9, row: 2, dir: "e", kind: "door" },
      { col: 9, row: 3, dir: "e", kind: "wall" },
      { col: 9, row: 4, dir: "e", kind: "door" },
      { col: 9, row: 5, dir: "e", kind: "wall" },
      { col: 9, row: 6, dir: "e", kind: "wall" },
      { col: 11, row: 1, dir: "e", kind: "wall" },
      { col: 11, row: 2, dir: "e", kind: "wall" },
      { col: 11, row: 3, dir: "e", kind: "door" },
      { col: 11, row: 4, dir: "e", kind: "wall" },
      { col: 11, row: 5, dir: "e", kind: "wall" },
    ]), F_HIVE_LORD),
      F_HIVE_LORD,
      [
        // Centre keel: a four-cell Bloom Cannon (O) supplants one neural sting
        // — the heavyAutocannon-band capital kinetic main battery.
        [10, 3, "swm-bloom-cannon", SWARM_FOOTPRINTS.bloomCannon],
        // Keel reactor: a three-cell Metabolic Heart (H) replaces a ganglion —
        // the 3.6 GW compound command reactor feeding the capital battery.
        [1, 3, "swm-metabolic-heart", SWARM_FOOTPRINTS.metabolicHeart],
        // Prow momentum screen: a three-cell Barkweave Carapace (W) — the heavy
        // deflector band, scaling the carapace screen up to capital grade.
        [12, 3, "swm-barkweave-carapace", SWARM_FOOTPRINTS.barkweaveCarapace],
        // --- Catalogue-expansion refit: three new bio-organs grafted onto the
        // central deck column (col 4 `~` cells), each anchored on an empty deck
        // cell so coverFootprint installs it without a dedicated token. ---
        // Upper deck: a three-cell Bile Mortar (L-tromino) — a slow-lob heavy
        // gauss-band kinetic, the cruiser's new artillery option.
        [4, 2, "swm-bile-mortar", SWARM_FOOTPRINTS.bileMortar],
        // Centreline deck: a 2×2 Heavy Flagellum Mass — a capital plasma-drive
        // cluster adding thrust above the tentacle drive's lightPlasma banding.
        [4, 3, "swm-heavy-flagellum-mass", SWARM_FOOTPRINTS.heavyFlagellumMass],
        // Lower deck: a two-cell Spore-Mine Organ — the Swarm's first mine
        // layer, seeding static proximity mines for area denial.
        [4, 4, "swm-spore-mine-organ", SWARM_FOOTPRINTS.sporeMineOrgan],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
  {
    id: "preset-ship-devourer",
    name: "Devourer",
    faction: "Swarm",
    // Dreadnought: the bio-capital — a vast spawning organism whose prow is a
    // wall of neural stings and acid sprayers, ringed by spore clouds and
    // carapace screens, with a metabolic heart and a biolaser-spine relay
    // linking the brood. Five metabolic cores and a ganglion ring drive the
    // mass; regen membranes knit the carapace; pseudopod and gyral organs let
    // it come about. It is a force multiplier for the brood, not a solo killer
    // — no spinal-lance-class alpha, just short-range sting and acid pressure
    // behind a screen of spores and living momentum baffles. Neural stings have
    // no ammoCapacity so no ammon sac is required; all Swarm modules are
    // crewless. Implies hive doctrine (aggressive short-range).
    //
    // Capital multi-cell refit. The apex hull fields the full Swarm capital
    // kit: the centre keel takes a four-cell Bloom Cannon (O, the
    // heavyAutocannon-band main battery) and a three-cell Acid Bank (V, the
    // triple-nozzle corrosive battery); a Spore Battery (B) joins the upper
    // sting rank; a three-cell Metabolic Heart (H) supplants a ganglion; the
    // centreline stern drive becomes a 2×2 Tentacle Drive Mass (T); and the
    // prow carapace screen steps up to a three-cell Barkweave Carapace (W).
    // Each anchor's covered cells are installed by `mountMultiCell` after
    // subdivision.
    //
    // Layout (14 cols × 7 rows), subdivided ×12 → 168 m dreadnought:
    // stern (left) → drive flagella → ganglion/metabolic spine →
    // regen + spore-cloud screen → sting/acid battery → carapace-screened prow.
    grid: mountMultiCell(
      subdivideGrid(withEdges(swarmGrid([
        "..#>x~nnnkwccc",
        "..jgfzrsBnnnwh",
        ".jgm~rfsannnwy",
        "THmmmrfsVaOnnW",
        ".jgm~rfsannnwy",
        "..jgfzrsnnnnwh",
        "..#<x~nnnkwccc",
      ]), [
        // Compartment bulkheads at the natural breaks (stern | drive | battery |
        // prow), each walled with transit doors through the flank rows. The
        // Devourer is crewless, so these shape the silhouette and add blast
        // containment — closed doors block chain reactions, making a
        // compartmentalised hull a better damage sponge than an open one.
        ...bulkhead(4, [2, 4]),
        ...bulkhead(7, [2, 4]),
        ...bulkhead(10, [2, 4]),
      ]), F_DEVOURER),
      F_DEVOURER,
      [
        // Centre-spine battery: a four-cell Bloom Cannon (O) and a three-cell
        // Acid Bank (V) — the capital kinetic + corrosive main battery.
        [10, 3, "swm-bloom-cannon", SWARM_FOOTPRINTS.bloomCannon],
        [8, 3, "swm-acid-bank", SWARM_FOOTPRINTS.acidBank],
        // Upper rank: a two-cell Spore Battery (B) joins the sting cluster.
        [8, 1, "swm-spore-battery", SWARM_FOOTPRINTS.sporeBattery],
        // Keel reactor: a three-cell Metabolic Heart (H) replaces a ganglion —
        // the 3.6 GW compound command reactor.
        [1, 3, "swm-metabolic-heart", SWARM_FOOTPRINTS.metabolicHeart],
        // Centreline stern: a 2×2 Tentacle Drive Mass (T) supplants the pulse
        // jet — the capital-scale bio-drive cluster.
        [0, 3, "swm-tentacle-drive-mass", SWARM_FOOTPRINTS.tentacleDriveMass],
        // Prow momentum screen: a three-cell Barkweave Carapace (W) — the heavy
        // deflector band, supplanting the light carapace screen.
        [13, 3, "swm-barkweave-carapace", SWARM_FOOTPRINTS.barkweaveCarapace],
        // --- Catalogue-expansion refit: two new bio-organs grafted onto the
        // central deck column (col 4 `~` cells). The crewed Ammon Cyst is
        // omitted: every Swarm preset is crewless, so a crewed magazine would
        // break the crew-balance gate (it stays a catalogue-only option, like
        // the existing swm-ammon-vault). ---
        // Upper deck: a 2×2 Spore-Drone Spawner — a bloated brood bay that
        // launches autonomous spore-drones, a new carrier doctrine angle.
        [4, 2, "swm-spore-drone-spawner", SWARM_FOOTPRINTS.sporeDroneSpawner],
        // Lower deck: a plus-shape Radial Metabolic Heart — a 6 GW compound
        // command reactor alongside the existing H, scaling the keel core up.
        // The west/north offsets land on solid `m`/`r` neighbours.
        [4, 4, "swm-plus-metabolic-heart", SWARM_FOOTPRINTS.plusMetabolicHeart],
      ],
    ),
    createdAt: PRESET_TIME,
    updatedAt: PRESET_TIME,
    source: "preset",
    revision: 1,
  },
];
