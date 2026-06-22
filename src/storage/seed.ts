import { presetDesigns, presetFleets } from "@/data/presets";
import { getMeta, setMeta, storage } from "@/storage/db";

/**
 * Bump when the bundled preset set changes. On boot, if the stored version is
 * older than this, any preset whose id is not already present is inserted; the
 * version is then recorded. A player who deleted a preset keeps it deleted
 * until the preset set itself changes and this version bumps.
 *
 * Version 3: Phase D — floor/corridor cells and munitions magazines added to
 * all ships with finite-ammo weapons; new reachability faults added to the
 * design validator.
 *
 * Version 4: Phase B — sensor and comms modules added to key presets. Scout
 * ships (Sabre, Drone Skimmer) gain long-range sensors; capital ships
 * (Leviathan, Hive Lord) gain comms backbone links and squad-net transceivers.
 *
 * Version 5: Directional sensors + Newtonian rotation manoeuvring gear, both
 * landing together. Sensors gained a comms-style cone model
 * (sensorType/arc/bearing): preset sensor modules are now typed as omni passive
 * arrays or forward-facing directional/dish scanners on scouts. Separately,
 * every preset now carries manoeuvring gear (RCS thrusters and/or reaction
 * wheels) so it has real commandable turn authority under the torque-driven
 * attitude model — centre-line-only designs could not rotate at all without it.
 * This bump reseeds the combined set over either feature's v4.
 *
 * Version 6: factions-tech — Crystalline, Foundry, Corsair, Synthetic factions
 * added alongside the existing Terran and Swarm, each with starter ships.
 *
 * Version 7: layered-cell migration (Phase 2). The grid cell model changes
 * from empty/hull/module/floor to empty/solid: every built cell is substrate
 * carrying a surface (bare/deck/armor), four edge states, and optional
 * equipment. Armour equipment modules are gone (armour is now a cell surface);
 * their stats moved onto per-faction layer materials. Crew walkability is
 * deck-only and edge-gated. Break-apart anchors on substrate (every solid
 * cell), not on a hull-effect gate. Designs saved under the previous cell
 * model are not migrated — this bump reseeds the preset set so the new
 * bundled designs replace any prior-version copies.
 *
 * Version 8: SI catalogue + balanced preset drives (Phase 14). The catalogue
 * is re-authored in real SI units — masses in kilograms (derived from
 * material density x volume), engine thrust in Newtons (massFlow x
 * exhaustVelocity), per-cell layer masses as areal density x cell area.
 * Preset ships are re-gridded with balanced drive sets (aft prograde + fore
 * retrograde + lateral RCS translation) so they can close, brake at weapon
 * range, and station-keep without flipping. Old stores hold the prior
 * arbitrary-unit values; this bump reseeds.
 *
 * Version 9: 1 m scale — all preset designs are re-authored at physical scale
 * (1 m per cell). Each coarse ASCII grid is subdivided by the W3 generator so
 * the ship's occupied-cell span matches its class target: fighters ~20 m,
 * frigates ~60 m, cruisers ~150 m, dreadnoughts ≤ 300 m. Old stores hold
 * the pre-scale coarse grids, which no longer match the class thresholds; this
 * bump replaces any preset-source record so the rescaled designs load. Only
 * records with source "preset" are touched; player-authored (source "user")
 * records are left untouched.
 *
 * Version 12: reseed protection is now keyed on source "user", not "not
 * preset". Stores seeded before the `source` field existed kept sourceless
 * legacy preset records (empty/hull/module/floor cells, no `grid.connections`)
 * that the old skip logic mistook for user copies and never replaced — they
 * crashed the resolver (`resolveHardwires` read `connections.length` off
 * undefined). This bump force-replaces every bundled id that is not an explicit
 * `source: "user"` record, so the legacy ships are finally overwritten with the
 * current layered-cell designs.
 *
 * Version 13: OutlineMode collapse — `"hexadecilinear"` removed from the enum;
 * existing persisted values migrate to `"octilinear"` via a Zod preprocess.
 * All preset grids and fresh designs now carry `outlineMode: "octilinear"`.
 * This bump reseeds so preset records carry the updated default explicitly.
 *
 * Version 14: the cell's structural-base field `scaffold` is renamed to
 * `substrate` (a legacy `scaffold` key migrates on parse). This bump reseeds so
 * preset records store the renamed field rather than relying on the migration.
 */
const PRESETS_VERSION = 14;
const VERSION_KEY = "presetsVersion";

/**
 * Seed the bundled starter ships and fleets on first run (and whenever the
 * preset set is upgraded).
 *
 * Behaviour:
 * - A bundled preset id is **force-replaced** with the current bundled version
 *   unless the store holds a genuine player-authored record (source "user") at
 *   that id. This ensures re-authored presets (grid rescale, layout changes,
 *   etc.) take effect over any previously-seeded copy.
 * - Records with source "user" are never touched, so player edits and copies
 *   are fully preserved.
 * - The protected set is keyed on source **"user"**, not "not preset". Records
 *   written before the `source` field existed carry no source at all; those are
 *   stale presets (legacy cell shapes, missing `grid.connections`, etc.), not
 *   user copies, and must be replaced — keying on `source !== "preset"` wrongly
 *   protected them, leaving old-shape ships in the store that crashed the
 *   resolver. Only an explicit `source === "user"` marks a record as the
 *   player's to keep.
 * - Fleet records are force-replaced by the same logic.
 */
export async function seedPresets(): Promise<void> {
  const stored = await getMeta(VERSION_KEY);
  const seenVersion = typeof stored === "number" ? stored : 0;
  if (seenVersion >= PRESETS_VERSION) return;

  const [existingShips, existingFleets] = await Promise.all([
    storage().ships.list(),
    storage().fleets.list(),
  ]);

  // Ids the player owns (explicit source "user"): these are never overwritten.
  // Everything else at a bundled id — current presets, and legacy records with
  // no source predating the field — is force-replaced with the bundled version.
  const userShipIds = new Set(
    existingShips.filter((s) => s.source === "user").map((s) => s.id),
  );
  const userFleetIds = new Set(
    existingFleets.filter((f) => f.source === "user").map((f) => f.id),
  );

  for (const design of presetDesigns) {
    // Preserve a player-authored design that occupies this id.
    if (userShipIds.has(design.id)) continue;
    // Force-replace any existing record (preset or sourceless legacy); insert
    // new ones. `remove` is a no-op when the id is absent.
    await storage().ships.remove(design.id);
    await storage().ships.save(design);
  }
  for (const fleet of presetFleets) {
    if (userFleetIds.has(fleet.id)) continue;
    await storage().fleets.remove(fleet.id);
    await storage().fleets.save(fleet);
  }

  await setMeta(VERSION_KEY, PRESETS_VERSION);
}
