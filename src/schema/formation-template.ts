import { z } from "zod";

import { EntityId, IsoTimestamp } from "./primitives";
import { FleetSource } from "./fleet";
import { Formation } from "./formation";

/**
 * A reusable formation subtree — the "composable" unit. A fleet references a
 * template by id (a `template` {@link FormationNode}); at resolve time the
 * template's formation is expanded inline into the fleet's tree, so the
 * template id never reaches the engine or the battle cache key. Editing a
 * template therefore changes every fleet that references it (the reference is
 * resolved fresh each battle), while a stored BattleResult is an immutable
 * snapshot of one resolved tree and is unaffected by later template edits.
 *
 * Mirrors the `ShipDesign` / `Fleet` provenance lifecycle: `source` distinguishes
 * bundled presets (read-only, no history) from player-authored templates, and
 * `revision` bumps on each version-history snapshot. A template's formation may
 * itself reference templates (recursive composition), with cycle detection at
 * expansion time.
 */
export const FormationTemplate = z.object({
  id: EntityId,
  name: z.string().min(1),
  faction: z.string().min(1),
  formation: Formation,
  createdAt: IsoTimestamp,
  updatedAt: IsoTimestamp,
  /** Bundled preset or player-authored; presets are read-only. */
  source: FleetSource.default("user"),
  /** Monotonically increasing; bumped on each version-history snapshot. */
  revision: z.number().int().min(1).default(1),
});
export type FormationTemplate = z.infer<typeof FormationTemplate>;
