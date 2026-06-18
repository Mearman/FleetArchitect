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
 * Version 5: Newtonian rotation merged with sensors/comms/fog. Every preset now
 * carries BOTH its sensor/comms fit AND manoeuvring gear (RCS thrusters and/or
 * reaction wheels) so it has real commandable turn authority under the
 * torque-driven attitude model. Centre-line-only designs could not rotate at all
 * without it. This bump reseeds the combined set over either feature's v4.
 */
const PRESETS_VERSION = 5;
const VERSION_KEY = "presetsVersion";

/**
 * Seed the bundled starter ships and fleets on first run (and whenever the
 * preset set is upgraded). Idempotent: existing records are left untouched, so
 * a player's own edits and deletions are preserved.
 */
export async function seedPresets(): Promise<void> {
  const stored = await getMeta(VERSION_KEY);
  const seenVersion = typeof stored === "number" ? stored : 0;
  if (seenVersion >= PRESETS_VERSION) return;

  const [existingShips, existingFleets] = await Promise.all([
    storage().ships.list(),
    storage().fleets.list(),
  ]);
  const shipIds = new Set(existingShips.map((s) => s.id));
  const fleetIds = new Set(existingFleets.map((f) => f.id));

  for (const design of presetDesigns) {
    if (!shipIds.has(design.id)) {
      await storage().ships.save(design);
    }
  }
  for (const fleet of presetFleets) {
    if (!fleetIds.has(fleet.id)) {
      await storage().fleets.save(fleet);
    }
  }

  await setMeta(VERSION_KEY, PRESETS_VERSION);
}
