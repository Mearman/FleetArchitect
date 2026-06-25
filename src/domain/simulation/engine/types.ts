/**
 * Mutable engine-internal types: the per-ship / per-module / per-entity
 * runtime state the simulation carries across ticks.
 *
 * Leaf module: imports only schema/domain types, so no cycle can originate
 * here.
 */

import type { ShipClassification } from "@/schema/armor";
import type { CellEdges, SurfaceKind } from "@/schema/grid";
import type { ModuleEffect, WeaponEffect, WeaponType } from "@/schema/module";
import type { Orders } from "@/schema/fleet";
import type { CrewPriority, Rule, ShipStance } from "@/schema/ai";
import type { ResolvedHardwire, SimCrew } from "../types";

import type { UNREACHABLE } from "./config";
import type { EnergyBuffer } from "./power";
import type { RectangularTransportGraph } from "./transport-graph";

/**
 * Per-ship resource state (Phase 12). The three transport-field φ arrays —
 * thermal (temperature, K), propellant (fuel mass, kg), atmosphere (gas mass,
 * kg) — plus the power energy buffer. Advanced each tick by `resourceStep`,
 * which also enforces the consequences: overheat module destruction, energy-buffer
 * brownout load-shedding, dry-tank engine flame-out, and (via the airtightness
 * vent mask) decompression and crew vacuum exposure.
 *
 * Cell indexing is module-sparse: `n = number of modules`, indices are
 * assigned in sorted (col, row) order, and `moduleIndex` maps "col,row" keys
 * to dense 0..n−1 indices. This avoids the O(bounding-box) cost of the
 * rectangular approach for ships with widely spread modules.
 */
export interface ResourceState {
  /** Sparse cell-to-index map: `"col,row"` → dense φ index (0..n−1). */
  moduleIndex: ReadonlyMap<string, number>;
  thermal: number[];
  propellant: number[];
  atmosphere: number[];
  powerBuffer: EnergyBuffer;
  /**
   * Per-cell thermal heat capacity (J/K), keyed by dense φ index — `cell mass ×
   * the faction material's specific heat`. The thermal field divides each watt
   * source and watt radiative flux by this to get a kelvin-per-second rate. A
   * cell's mass is fixed for the battle (damage destroys a cell, it does not
   * lighten it) and the index map is fixed, so this is built ONCE in
   * `makeResourceState` and reused every tick rather than rebuilt — the thermal
   * step would otherwise rebuild an n-entry map per ship per tick, a measurable
   * cost on capital ships with thousands of cells.
   */
  heatCapacity: ReadonlyMap<number, number>;
}

/** Cached transport graph for a ship's current topology (Phase 12 wiring).
 *  Rebuilt when the alive-cell fingerprint changes. */
export interface CachedTransportGraph {
  graph: RectangularTransportGraph;
  fingerprint: number;
}

/**
 * A live awareness contact: an enemy this observer (or a relaying ally on its
 * comms net) currently has a fix on. `origin` is the instanceId of the observer
 * that directly sensed the enemy — used by the per-observer propagation to mark
 * forwarded (third-party) contacts so a leaf doesn't re-forward them. `threat`
 * orders the bandwidth-limited relay queue (higher forwarded first).
 */
export interface Contact {
  enemyId: string;
  x: number;
  y: number;
  facing: number;
  threat: number;
  origin: string;
}

/**
 * A ghost contact: a fading memory of where an enemy was last seen. Persisted on
 * the observer across ticks (unlike the transient live `awareness` set), decayed
 * one tick at a time, and dropped when it expires or its target dies. The AI
 * engages a ghost's last-known position so a ship keeps firing through a brief
 * occlusion instead of instantly forgetting a target.
 */
export interface GhostContact {
  enemyId: string;
  x: number;
  y: number;
  facing: number;
  threat: number;
  ticksLeft: number;
}

/** Mutable per-ship runtime state carried across ticks. */
export interface SimShip {
  instanceId: string;
  /** Faction this ship belongs to, carried from the resolved CombatShip so the
   *  run can build the battle roster without re-reading the design. */
  faction: string;
  side: "attacker" | "defender";
  classification: ShipClassification;
  x: number;
  y: number;
  facing: number;
  /** Linear velocity (world units per tick). Persists across ticks — momentum. */
  velX: number;
  velY: number;
  /**
   * Relativistic linear momentum (`p = gamma·m·v`, world units · mass per tick).
   * The post-update record from the relativistic integrator
   * (`relativisticMomentumStep`): velocity remains the single source of truth
   * for motion (gravity, collisions, and recoil all write `velX`/`velY`
   * directly), so these are RE-DERIVED from the live velocity each tick rather
   * than carried as authoritative state. At sub-relativistic speed `gamma → 1`
   * and these reduce to the Newtonian `m·v`. Not snapshotted — derived
   * bookkeeping only.
   */
  px: number;
  py: number;
  /** Angular velocity (radians per tick). Persists — angular momentum. */
  angVel: number;
  structure: number;
  maxStructure: number;
  shield: number;
  maxShield: number;
  shieldRechargeRate: number;
  shieldRechargeDelay: number;
  shieldRegenCountdown: number;
  /**
   * Adaptive shields (factions update). The aggregate per-tick ramp rate
   * (`adaptiveRampRate`) of the ship's shields: the extra fraction of the base
   * recharge rate added for every tick the shield has gone untouched. Derived
   * in `recomputeAggregates` as the max across alive, functional shield modules
   * (the best generator governs), so a ship with no adaptive shield carries 0
   * and recharges exactly as before. Read only by the shield-regen step.
   */
  shieldAdaptiveRamp: number;
  /**
   * Adaptive shields: consecutive ticks the shield has gone untouched, capped so
   * the bonus cannot grow without bound. Reset to 0 in `applyDamage` whenever the
   * shield pool absorbs any damage, and incremented each tick by the shield-regen
   * step. Stays 0 (never incremented past 0 to any effect) for a ship with no
   * adaptive shield, since the regen step only ramps when `shieldAdaptiveRamp > 0`.
   */
  shieldUntouchedTicks: number;
  /**
   * Command aura (factions update). The best (max) friendly aura bonuses
   * covering this ship this tick: an added fraction to weapon range
   * (`auraRangeBonus`) and to firing accuracy (`auraAccuracyBonus`). Recomputed
   * each tick in `applyCommandAuras` before firing, then read by `fireWeapons`
   * and `spawnProjectile`. Both stay 0 when no aura covers the ship — and a
   * battle with no aura modules never sets them — so non-aura play is unchanged.
   */
  auraRangeBonus: number;
  auraAccuracyBonus: number;
  armourReduction: number;
  thrust: number;
  turnRate: number;
  /**
   * Effective engine throttle actually applied this tick (Phase 12 fuel model):
   * the fraction of rated thrust the movement step commanded from the main
   * engines, including any afterburner multiplier, or 0 on a tick the ship did
   * not fire its engines (coasting, holding station, or still turning onto its
   * heading). The resource step burns propellant in proportion to this — a
   * station-keeping ship draws no fuel, while one accelerating at full thrust
   * burns at its rated rate — so the dry-tank flame-out reflects real usage
   * rather than charging every engine full burn every tick. Set by `moveShips`
   * each tick before `resourceStep` reads it; defaults to 0 so a ship that never
   * moves (or the legacy aggregated path) consumes no fuel.
   */
  engineThrottle: number;
  /** Total ship mass (hull base + installed modules). Drives acceleration. */
  mass: number;
  /**
   * Ship-local centre of mass (relative to ship.x/ship.y). On modular
   * ships this is the mass-weighted centroid of every module (alive and
   * dead — destroyed hull still contributes structural mass until it is
   * excluded by a recompute). On legacy non-modular ships it stays at
   * (0, 0) — the ship's position is its centre of mass. Rotation pivots
   * about this point; linear forces are lever-armed against it for the
   * torque calculation.
   */
  comX: number;
  comY: number;
  /**
   * Scalar moment of inertia about the z-axis through the centre of
   * mass. On modular ships it is derived as `Σ m_i · |r_i − r_com|²`;
   * on legacy ships it falls back to `mass * legacyMoI`. Drives how
   * readily off-centre forces spin the ship.
   */
  momentOfInertia: number;
  radius: number;
  /** Chamfered hull outline polygon (computed from the grid at resolve time
   *  via computeOutline over the armor shell; re-derived on break-apart).
   *  Render-only — collision stays per-cell. */
  outline?: { x: number; y: number }[][];
  /** Proper-time dilation factor (1 = real-time, <1 = slowed). Computed
   *  each tick from velocity (SR) + gravitational potential (GR); ship rates
   *  (cooldowns, recharge, crew) multiply by it. */
  dilationFactor: number;
  cost: number;
  weapons: readonly WeaponEffect[];
  weaponCooldowns: number[];
  orders: Orders;
  /**
   * Crew task-scheduler priority mode (Phase 6 wiring). Read by the crew tick
   * to reorder the four task kinds via `crewTaskOrder`. Defaults to `"combat"`
   * (the historical fixed order) so legacy designs behave unchanged.
   */
  crewPriority: CrewPriority;
  /**
   * Base ship stance (Phase 7 wiring). The AI interpreter reads it each tick
   * as the base posture; `rules` layer on top. Defaults to `"balanced"`.
   */
  shipStance: ShipStance;
  /**
   * Player-authored trigger/action rules (Phase 7 wiring). Evaluated in list
   * order each tick by `effectiveAi`; the first matching rule wins. Empty by
   * default — the stance alone governs behaviour.
   */
  rules: Rule[];
  /**
   * Transient per-tick AI decision (Phase 7 wiring): whether the ship holds
   * fire this tick. Set by the AI interpreter step from the effective
   * AiState's `holdFire` flag (a rule or stance ceasing weapon fire); read by
   * the weapon-fire step to skip firing. Recomputed each tick before firing;
   * never snapshotted. False by default (the historical behaviour) so a ship
   * with no rules and the default stance always fires as before.
   */
  aiHoldFire: boolean;
  /**
   * Transient per-tick AI decisions (Phase 7 wiring), the live counterparts to
   * the ship's static {@link Orders}. Set by the AI interpreter step from the
   * effective {@link AiState} each tick (alongside `aiHoldFire`), then read by
   * the targeting, movement and crew steps, which prefer the live value when the
   * AI has set it and fall back to the static orders otherwise. All default to
   * their "AI has said nothing" value — `null` for the stance (no override) and
   * `false` for the flags — so a ship with no rules and the default stance
   * behaves byte-identically to before.
   *
   * - `aiStance`           — the effective stance a `setStance` rule selected, or
   *                          `null` when the AI left the base stance in place.
   *                          Consumers fall back to `orders.stance`.
   * - `aiFocusFire`        — true when a `focusFire` rule fired this tick, asking
   *                          the ship to concentrate fire with its allies.
   * - `aiRetreat`          — true when a `retreat` rule fired this tick, forcing
   *                          the ship to disengage regardless of its static
   *                          `orders.retreatThreshold`.
   * - `aiPrioritiseRepair` — true when a `prioritiseRepair` rule fired this tick,
   *                          asking the crew scheduler to favour repair tasks.
   * - `aiRally`            — true when a `rally` rule fired this tick, steering the
   *                          ship toward its fleet's centroid.
   */
  aiStance: ShipStance | null;
  aiFocusFire: boolean;
  aiRetreat: boolean;
  aiPrioritiseRepair: boolean;
  aiRally: boolean;
  target: string | undefined;
  alive: boolean;
  /**
   * Salvage mass (kg) this ship has swept up from the debris field over the
   * battle (salvage mechanics). Each tick a living ship collects any drifting
   * wreckage within `SALVAGE_RANGE_M`, adding the fragment's mass here; the
   * post-battle summary reports the total. Initialised to 0 in `toSimShip`; a
   * battle with no destruction never adds to it. Never snapshotted per tick —
   * it surfaces only in the result's salvage summary — so it changes no frame
   * output for existing battles.
   */
  salvageMass: number;
  /**
   * When this hull has been claimed as salvage, the instanceId of the claiming
   * ship (salvage mechanics). A hull becomes claimable once every weapon and
   * drive is disabled, it has no living crew, and it is not already claimed; the
   * first living enemy within `SALVAGE_RANGE_M` claims it. Once set, the tick
   * loop suppresses the hull's engine steps so it drifts inert as wreckage.
   * Undefined for every unclaimed hull, so unsalvaged play is unchanged.
   */
  claimedBy?: string;
  /**
   * Per-module instances when the ship was built from a ShipDesign with
   * per-module data. Each module has its own hit points and can be
   * destroyed independently; the aggregate fields above are recomputed
   * from the alive set each tick (`recomputeAggregates`). Undefined
   * means the legacy aggregated path is in use.
   */
  modules?: SimModule[];
  /**
   * Crew aboard the ship: physical entities that walk the walkable interior
   * (alive cells) to man stations and haul resources. Populated from the
   * design's crew-quarters cells in `toSimShip`; advanced each tick by
   * `updateCrew` after aggregates recompute. Always present on modular ships
   * (possibly empty); undefined on the legacy aggregated path, which has no
   * cells to walk and ignores crew entirely.
   */
  crew?: SimCrew[];
  /**
   * Per-ship cache of crew pathfinding results, keyed by a numeric cell encoding
   * (`cellNum`) as a nested map: outer keyed by the from-cell, inner keyed by
   * the to-cell. Stores the full path array (inclusive of both endpoints) for a
   * reachable pair, or the `UNREACHABLE` sentinel for a pair with no
   * 4-connected route. The cache is invalidated wholesale whenever the ship's
   * alive-cell topology changes — a module dies or a chunk splits off — detected
   * by comparing `topologyFingerprint`. Between topology changes (the vast
   * majority of ticks) every `findCrewPath` call is an O(1) nested map lookup.
   * Present only on modular ships (the only kind with a crew interior to path
   * over). Numeric keys avoid the per-lookup string allocation the `"col,row"`
   * form would impose across the tens of thousands of lookups per tick. */
  pathCache?: Map<number, Map<number, { col: number; row: number }[] | typeof UNREACHABLE>>;
  /**
   * Rolling fingerprint of the ship's alive-cell set: a count and a hash over
   * every alive cell's `(col, row)`. Recomputed at the top of `updateCrew`; when
   * it differs from the cached value the path cache is cleared and the new
   * fingerprint stored. Also seeded for a fresh chunk ship in `makeChunkShip`.
   * A pure function of the alive set, so two ships with identical topology share
   * a fingerprint without ambiguity, and a topology change always moves it. */
  topologyFingerprint?: number;
  /**
   * Cached wiring reach (cells within `powerWiringRadius` of any alive reactor),
   * computed once per topology change and reused every tick in between. A Set of
   * `"col,row"` cell keys. `undefined` means not yet computed for the current
   * topology; `refreshPathCache` clears it alongside the path cache on a
   * fingerprint change. The wiring BFS depends only on the alive-cell graph and
   * reactor positions, so it is stable across ticks with no module death — the
   * common case. */
  wiringReach?: Set<string>;
  /**
   * Cached index of alive modules by cell key (`"col,row"` → module), built once
   * per topology change and reused across ticks. `updateCrew` reads it every
   * tick for crew-on-cell lookups and pathfinding seeds; rebuilding it from
   * scratch each tick was a measurable per-ship cost on capital-heavy battles.
   * `refreshPathCache` clears it alongside the path cache on a fingerprint
   * change. The map is stable between module deaths — exactly the same
   * invariant the path cache relies on. */
  aliveCells?: Map<string, SimModule>;
  /** Hull base thrust, used by recomputeAggregates to recover the non-engine
   *  thrust floor. Set only when modules are present. */
  hullBaseThrust?: number;
  /**
   * Resolved hardwire conduits carried from the CombatShip: fixed one-to-one
   * source-to-sink links by slot id, each carrying one resource. Present only
   * when the design had `connections` (otherwise undefined), so the per-tick
   * loop short-circuits the hardwire path for every unhardwired ship and
   * behaviour stays byte-identical. The link behaviour itself lands in a later
   * stage; here the loop can read these to find each sink's feeding source.
   */
  hardwires?: ResolvedHardwire[];
  /**
   * True on the tick this ship was created as a break-away chunk from a
   * parent ship. Cleared by snapshot so the flag highlights only the
   * split frame, not every frame the chunk exists.
   */
  brokeOff?: boolean;
  /**
   * Fading memories of enemies recently seen, persisted across ticks. Refreshed
   * to full life when the enemy is currently visible (directly or via the comms
   * net), decayed one tick otherwise, and dropped when expired or the target
   * dies. Kept sorted by enemyId for a deterministic snapshot order. A chunk
   * inherits a deep copy of its parent's ghosts on a split. Initialised `[]`
   * in `toSimShip`; the legacy aggregated path never has awareness so it stays
   * empty there.
   */
  ghosts: GhostContact[];
  /**
   * The transient per-tick awareness set: every enemy this ship can engage this
   * tick — live contacts plus any ghost last-known positions (live overrides a
   * ghost for the same enemy). Rebuilt from scratch each tick by
   * `computeAwareness`, never persisted across ticks; held as a field only so
   * the targeting block can read it. Keyed by enemyId for stable lookup.
   */
  awareness: Map<string, Contact>;
  /**
   * Sensor saturation (battlefield-medium phase 5): how blinded this ship's
   * receiver currently is, on a [0, ∞) scale where 0 is fully recovered. An
   * intense incident emission above the dazzle threshold boosts this
   * ({@link dazzleBoost}); it then multiplies the receiver's effective noise
   * floor by `(1 + sensorSaturation)` ({@link effectiveReceiverFloor}), so a
   * saturated sensor loses its weaker contacts until it recovers. Decayed once
   * per tick at the top of the awareness phase by {@link SATURATION_DECAY_FACTOR}
   * (timescale {@link SATURATION_RECOVERY_TICKS}), and the per-tick boost from
   * the observer's received emissions is added AFTER the reception pass, so a
   * flash on tick T raises the floor on ticks T+1 onward. Source-agnostic: any
   * strong received emission (hull, pulse, medium-cell) dazzles. Initialised to
   * 0 in `toSimShip`/phantom/chunk; carried across ticks and captured by the
   * checkpoint so resume preserves the blinded state.
   */
  sensorSaturation: number;
   /**
   * Stealth detectability (factions update). The most recent tick on which this
   * ship fired any weapon, used by the cloak rule: a cloaked ship drops its
   * cloak for `decloakTicks` after firing, so it is detectable while
   * `currentTick - lastFiredTick < decloakTicks`. Initialised to
   * `Number.NEGATIVE_INFINITY` ("never fired") so a ship that has not yet fired
   * is fully cloaked, and so the subtraction can never spuriously place a recent
   * shot inside the decloak window. Only read for ships carrying a cloak module;
   * a non-cloak ship's value is never consulted, and it is never snapshotted, so
   * carrying it changes no frame output for existing battles.
   */
  lastFiredTick: number;
  /**
   * Phantom ship (factions update): a lightweight, non-real combatant launched
   * by a hangar (drone) or decoy launcher (decoy) rather than deployed from a
   * fleet. Present only on phantoms; every real ship leaves it undefined so the
   * existing pipelines treat them exactly as before.
   *
   * A phantom IS a full SimShip so the targeting, projectile, point-defence and
   * damage pipelines strike it without special-casing — enemies can acquire and
   * shoot a drone or decoy exactly as they would a real ship. Phantoms are
   * deliberately excluded from the things only real ships do: they never fire or
   * move via the normal loops (a drone homes and strikes in a bespoke step; a
   * decoy is static), they never count for victory, and they are never elected
   * as a focus-fire target. Their hit points live in `structure`/`maxStructure`
   * like any ship; when depleted (or their `ticksLeft` expires) they are removed.
   */
  phantom?: {
    kind: "drone" | "decoy";
    /** Owning real ship's instance id (for re-counting a hangar's live drones). */
    ownerId: string;
    /** Ticks before the phantom expires on its own (decoys use `duration`;
     *  drones use their `droneLifetime` if set, else a large default). */
    ticksLeft: number;
    /** Drone-only: damage dealt each tick to an enemy in `range`. 0 for decoys. */
    damage: number;
    /** Drone-only: range at which a drone strikes its target. 0 for decoys. */
    range: number;
    /** Drone-only: homing speed in world units per tick. 0 for decoys. */
    speed: number;
  };
  /**
   * Per-ship resource state (Phase 12 wiring, use-deferred). The thermal,
   * propellant, atmosphere, and power fields advanced each tick by
   * `resourceStep`. Present only on modular ships; `undefined` on the legacy
   * aggregated path and phantoms. Built once in `toSimShip`; values computed
   * but no consequence is enforced.
   */
  resource?: ResourceState;
  /**
   * Cached transport graph for the ship's current cell topology (Phase 12
   * wiring). Rebuilt lazily by `resourceStep` when the topology fingerprint
   * changes; cleared alongside the path cache by `refreshPathCache` so a
   * module death or chunk split invalidates it.
   */
  resourceGraph?: CachedTransportGraph;
  /**
   * Current count of alive modules, recomputed each tick by
   * `recomputeAggregates` (a free side effect of its module pass). A
   * transient derived cache: not captured by the checkpoint (re-warms after
   * resume), so it changes no frame output. Sufficient as a topology-change
   * signal: the engine only flips `alive` true→false, so an unchanged count
   * holds exactly when no module died and the connectivity graph is unchanged.
   */
  aliveCount?: number;
  /**
   * The alive-module count at the last break-apart evaluation. Same derived
   * category as `topologyFingerprint` — not captured by the checkpoint, so
   * on resume it re-warms to `undefined` and the first pass analyses; on an
   * unchanged topology that returns `[]` exactly as a skip would. When this
   * equals `aliveCount`, break-apart returns `[]` without its union-find.
   */
  breakApartLastAliveCount?: number;
}

/**
 * Mutable per-module runtime state. Built from a `ResolvedModule` in
 * `toSimShip`; aggregates are recomputed from the alive set each tick.
 */
export interface SimModule {
  slotId: string;
  moduleId: string;
  kind: ModuleEffect["kind"];
  /** Integer grid coordinates of the cell this module occupies. Break-apart
   *  unions over exact 4-connected (edge-sharing) neighbours on these, with no
   *  rounding of the ship-local world position. */
  col: number;
  row: number;
  /** Position in ship-local (design) coordinates, for hit selection. */
  x: number;
  y: number;
  /** The cell's surface kind. Walkability is `surface === "deck" && alive`;
   *  damage depletes the surface layer (armor/deck) before the substrate layer;
   *  equipment placement rules consult it. */
  surface: SurfaceKind;
  /** The cell's four edge states, copied off the resolved module. The engine's
   *  A* and airtightness logic read these to decide passability and seal. */
  edges: CellEdges;
  /** Current HP of the surface layer (armor or deck). Damage depletes this
   *  layer before it reaches the substrate layer (`hp`). Zero for `bare` cells
   *  (no surface layer). */
  surfaceHp: number;
  /** Starting (and maximum) HP of the surface layer. */
  maxSurfaceHp: number;
  /**
   * Fraction (0..1) of an incoming hit this cell's surface (armour) layer
   * absorbs before it depletes surface HP — the armour material's
   * `damageReduction`, applied per cell in `damageCell` (scaled by the hit's
   * `armourPiercing`). Zero for bare/deck cells, so the reduction path is inert
   * there. Copied off the `ResolvedModule` in `toSimModule`; fixed for life.
   */
  surfaceReduction: number;
  /**
   * Reactive-armour fields carried from the armour material. While the cell has
   * a surface layer and `reactiveCharge === 0` (ready), a surface hit absorbs an
   * extra `reactiveReduction` fraction (pierce-scaled) and then sets
   * `reactiveCharge = reactiveWindow`, recharging over that many ticks (counted
   * down in `stepTechCooldowns`). Both zero for passive armour and bare/deck
   * cells, so the reactive path is inert for them.
   */
  reactiveReduction: number;
  reactiveWindow: number;
  /** Current HP of the substrate layer. When this reaches zero the cell is
   *  destroyed (`alive = false`) and break-apart may sever the graph. */
  hp: number;
  /** Starting (and maximum) HP of the substrate layer. */
  maxHp: number;
  mass: number;
  /** Power drawn from the reactor each tick when running. */
  powerDraw: number;
  effect: ModuleEffect;
  /** Weapon: ticks until next fire. Shield regen is pooled at ship level. */
  cooldown: number;
  /**
   * Weapon: remaining magazine. Decremented by 1 per shot; a weapon at 0
   * cannot fire. Always present on weapon modules; initialised from the
   * effect's `ammo` (defaulting to DEFAULT_WEAPON_AMMO when undefined).
   */
  ammo: number;
  /**
   * Rounds remaining in a magazine module's store. Initialised from
   * `MagazineEffect.ammoStored`; decremented as crew draw runs from it to
   * resupply dry weapons. Zero on every non-magazine module. Kept on the
   * SimModule (not the shared effect) so two ships built from the same design
   * deplete their own magazines independently.
   */
  ammoStored: number;
  /**
   * Local energy buffer a power-drawing module spends each tick it operates.
   * Crew haul charge packets from reactors to top it up. A module whose buffer
   * hits zero goes idle even when the whole-ship brownout would otherwise power
   * it, so the physical distance to a reactor — and the crew routing it — matters.
   * Modules with `powerDraw === 0` never consume charge and are always
   * considered charged. Initialised so reactor-adjacent modules start live;
   * isolated ones drain and starve unless crew feed them.
   */
  charge: number;
  alive: boolean;
  /**
   * Whether the power grid can sustain this module this tick. Reactors
   * supply a finite output; when total draw exceeds it, power-hungry
   * modules (weapons, then shields) go offline until supply recovers.
   */
  powered: boolean;
  /**
   * Resource consequence (Phase 12): the energy buffer ran dry this tick and the
   * grid shed this module to fit reactor output plus stored charge. Distinct from
   * `powered` (the instantaneous reactor-vs-draw brownout in `recomputeAggregates`):
   * this is the capacitor-bank brownout enforced by `resourceStep` after the energy
   * buffer is stepped, shedding modules in a fixed priority order (weapons, then
   * sensors, shields, engines; never the bridge, quarters, reactor, or repair). A
   * power-cut module is non-functional this tick exactly as an unpowered one is, so
   * the functional gate (`isOperational`) and every consumer treat it the same.
   * Recomputed fresh each tick: `resourceStep` clears it before re-evaluating, so a
   * ship whose buffer is healthy never carries a cut and behaves exactly as before.
   */
  powerCut: boolean;
  /**
   * Resource consequence (Phase 12): an engine cell whose propellant tank ran dry
   * this tick. Set by `resourceStep` after the propellant transport step for any
   * thrust-producing engine whose cell holds no fuel; a fuel-starved engine
   * produces no thrust and no geometric torque this tick (the movement and
   * aggregate paths skip it), modelling a flame-out. Only ever set on engine
   * modules; recomputed fresh each tick (cleared before re-evaluation), so a fully
   * fuelled ship never carries it and moves exactly as before.
   */
  fuelStarved: boolean;
  /**
   * Whether enough crew currently occupy this module's cell to operate it:
   * the count of crew on the cell is at least the module's `crewRequired`.
   * A module that needs no crew (`crewRequired === 0`) is always manned.
   * Recomputed each tick by `updateCrew` from live crew positions, then read
   * by `recomputeAggregates` and the firing loop so an unmanned station
   * contributes nothing and cannot fire. A station functions only when
   * `alive && powered && manned`.
   */
  manned: boolean;
  /** How many crew must occupy this cell for the module to be manned. Copied
   *  off the module definition; 0 means the module needs no crew. */
  crewRequired: number;
  /** Whether this module serves as the ship's bridge / command module. */
  command: boolean;
  /**
   * HP healed to one damaged module on the same ship per tick. Zero for
   * every non-repair module. Read by the per-tick repair step.
   */
  repairRate: number;
  /** Directional shield arc in radians; 2π means omnidirectional. */
  shieldArc: number;
  /** Direction (radians) the directional shield points. */
  shieldFacing: number;
  /**
   * For directional thrusters: the direction the engine thrusts, in
   * radians, ship-local. Default 0 (forward, +x). Mirrors
   * `ResolvedModule.facing`; carried on `SimModule` so the per-tick
   * movement loop can read each engine's force vector and lever arm
   * without re-walking the resolver.
   */
  facing: number;
  /**
   * Ship-local direction (radians) the weapon fires relative to the host
   * ship's heading. 0 fires along +x in ship-local space (forward); π/2
   * fires left, -π/2 fires right, π fires backward. Copied off the
   * resolved module's `weaponFacing` so the per-tick firing step can add it
   * to the ship's world heading without re-deriving it from the effect.
   * Only meaningful for weapon modules; default 0 is harmless elsewhere.
   */
  weaponFacing: number;
  /**
   * Turret traverse half-arc (radians, ship-local) about `weaponFacing` and
   * slew speed (radians per tick). `turretTurnRate === 0` is a fixed mount.
   */
  turretArc: number;
  turretTurnRate: number;
  /**
   * Hardwire conduits where this module is the consumer (sink): the resolved
   * links feeding it directly from a named source module. Empty (and omitted)
   * unless the design hardwired this cell as a sink. The per-tick loop reads
   * these to feed the module from its source's stored resource; the source is
   * looked up by `sourceSlotId` against the ship's modules, and the link is
   * dead if either endpoint module is destroyed. Behaviour lands in a later
   * stage — this only carries the structure.
   */
  hardwireSinks?: ResolvedHardwire[];
  /**
   * Hardwire conduits where this module is the source: the resolved links it
   * feeds. Carried so a source can divide its stored ammo / power output across
   * its hardwired sinks (no dynamic reallocation). Empty (and omitted) unless
   * the design hardwired this cell as a source.
   */
  hardwireSources?: ResolvedHardwire[];
  /**
   * Live barrel angle (radians, ship-local) for a turret weapon. Slews toward
   * the target bearing each tick at `turretTurnRate`, clamped to
   * `[weaponFacing - turretArc, weaponFacing + turretArc]`. Firing direction
   * and recoil use this live angle, not the static `weaponFacing`. On a fixed
   * mount it stays equal to `weaponFacing` for the ship's whole life, so the
   * firing path can read it unconditionally.
   */
  turretAngle: number;
  /**
   * Comms channel for a comms module: the per-instance grid override when set,
   * else the comms effect's own channel. Two comms units link only on a matching
   * channel. Copied off the resolved module; 0 on non-comms modules (unused).
   */
  channel: number;
  /**
   * Ship-local mount bearing (radians) of a comms module's antenna, copied off
   * the resolved module's `commsBearing`. Fixed for the module's life; the live
   * world bearing is `commsBearing + ship.facing` for omni/directional/laser
   * units. 0 on non-comms modules (unused).
   */
  commsBearing: number;
  /**
   * Live world-space antenna bearing (radians) for a comms module, analogous to
   * a weapon turret's `turretAngle`. Each tick the awareness phase recomputes
   * it: a steerable dish aims it at its chosen relay partner (or, with no
   * partner, leaves the previous value); every other comms type sets it to
   * `commsBearing + ship.facing`. The renderer reads it to draw the antenna arc.
   * Initialised to the mount bearing in `toSimModule`. Unused on non-comms
   * modules.
   */
  dishAngle: number;
  /**
   * Per-instance range setting for a `variable` comms module (world units),
   * from the resolved module's `commsRange`. Undefined when the design set none
   * (then the effect's `maxRange` is used). Only meaningful for variable comms
   * modules; undefined and unused on every other kind.
   */
  dishRangeSetting?: number;
  /**
   * Ship-local mount bearing (radians) of a sensor module's cone, copied off the
   * resolved module's `sensorBearing`. Fixed for the module's life; the live
   * world bearing is `sensorBearing + ship.facing`. 0 on non-sensor modules.
   */
  sensorBearing: number;
  /**
   * Per-instance range setting for a `variable` sensor module (world units),
   * from the resolved module's `sensorRangeSetting`. Undefined when the design
   * set none (then the effect's `maxRange` is used). Only meaningful for variable
   * sensor modules; undefined and unused on every other kind.
   */
  sensorRangeSetting?: number;
   /**
   * Movement/power tech timers (factions update). All default to 0 and are only
   * ever non-zero on the matching tech module, so a ship without these modules
   * carries them at their defaults and behaves byte-identically.
   *
   * `techCooldown` is the shared recharge counter for the one-shot tech kinds
   * (`blink`, `afterburner`, `overcharge`): ticks remaining before the module
   * may fire/activate again. `techActive` is the active-duration counter for the
   * sustained kinds (`afterburner`, `overcharge`): ticks of boost remaining. A
   * blink drive uses only `techCooldown` (its effect is the instant teleport,
   * with no active window). Decremented once per tick in `stepTechCooldowns`.
   */
  techCooldown: number;
  techActive: number;
  /**
   * Reactive armour recharge counter (factions update). Ticks remaining before
   * an armour module's reactive layer is charged and can absorb its extra
   * `reactiveReduction` fraction again. 0 means charged (ready). Set to the
   * module's `reactiveWindow` the moment the layer absorbs a hit, then counted
   * down once per tick in `stepTechCooldowns`. Only ever non-zero on an armour
   * module carrying `reactiveReduction`, so a passive-armour or non-armour
   * module keeps it at 0 for its whole life and the reactive path is inert.
   */
  reactiveCharge: number;
  /**
   * Mine-layer recharge counter (factions update). Ticks remaining before a
   * mine-layer module may lay its next batch. 0 means ready. Set to the effect's
   * `layCooldown` the moment a batch is laid, then counted down once per tick in
   * `stepTechCooldowns`. Only ever non-zero on a mine-layer module, so every
   * other module keeps it at 0 for its whole life and the lay path is inert.
   */
  mineCooldown: number;
  /**
   * Boarding launcher recharge counter (factions update). Ticks remaining
   * before a boarding module may launch its next pod salvo. 0 means ready. Set
   * to the effect's `cooldown` the moment a salvo launches, then counted down
   * once per tick in `stepTechCooldowns`. Only ever non-zero on a boarding
   * module, so every other module keeps it at 0 for its whole life and the
   * launch path is inert.
   */
  boardingCooldown: number;
  /** Explosive chain reactions (Phase 4). Set true once a volatile module (a
   *  reactor or magazine) has its blast processed, so each detonates at most
   *  once per battle. Non-volatile modules keep `false`. Not snapshotted. */
  exploded: boolean;
  /** Dense transport index (Phase 12): cached copy of the value
   *  `ResourceState.moduleIndex` maps this module's `"col,row"` cell to, written
   *  once by `makeResourceState` from the map. The `resourceModuleIndex`
   *  PERF_GUARDS flag toggles cached read vs map lookup; see `resource-step.ts`. */
  transportIndex?: number;
}

/** Mutable in-flight projectile. */
export interface SimProjectile {
  /** Stable id for interpolation matching across frames. Assigned from a
   *  deterministic per-battle counter at spawn time so two same-seed runs
   *  produce byte-identical ids (the counter increments in spawn order, which
   *  is fixed by the seeded RNG and tick update order). */
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  kind: WeaponType;
  /** Projectile mass — carried so the hit-impulse step knows the momentum
   *  to transfer without re-deriving it from the owning weapon. */
  mass: number;
  /** Ship-local position of the muzzle that fired this projectile, relative
   *  to the firing ship's centre. Used by the firing-recoil step to compute
   *  the lever arm against the firing ship's CoM. */
  muzzleLocalX: number;
  muzzleLocalY: number;
  damage: number;
  tracking: number;
  shieldPiercing: number;
  armourPiercing: number;
  range: number;
  travelled: number;
  ttl: number;
  ownerId: string;
  ownerSide: "attacker" | "defender";
  targetId: string;
  // Powered×guided taxonomy (finite-burn motors), resolved from the optional
  // WeaponEffect fields at spawn. powered/guided fixed for life; thrust is the
  // SI m·s⁻² applied while burnTicks > 0. burnTicks is MUTABLE (decremented
  // each burning tick). Unpowered rounds (cannon/plasma) carry false/0. The
  // medium exhaust source reads burnTicks > 0 to inject the plume.
  powered: boolean;
  guided: boolean;
  thrust: number;
  burnTicks: number;
}

/**
 * Deployed proximity mines and in-flight boarding pods — the non-ship, non-
 * module world entities. Defined in `./world-entities` and re-exported here so
 * the engine's existing `import { SimMine, SimPod } from "./types"` callers are
 * unchanged. Extracted to keep this module under the lint line cap.
 */
export type { SimMine, SimPod } from "./world-entities";
