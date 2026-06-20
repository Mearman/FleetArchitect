/**
 * The battle tick loop and the two public entry points (`runBattle`,
 * `simulateBattle`). Re-exports `comTangentialVelocity`. Resets
 * `projectileCounter` at the start of each battle so two same-seed runs
 * produce byte-identical projectile ids.
 */

import { createId, nowIso } from "@/domain/id";
import { mulberry32 } from "@/domain/simulation/rng";
import { computeOccluders } from "@/domain/occluders";
import type { BattleFrame, BattleResult, BattleSide, ShipDescriptor } from "@/schema/battle";
import type { BattleInputs, BattleSummary } from "../types";

import { computeAwareness } from "./awareness";
import { stepAi } from "./ai-step";
import type { Emission } from "./emissions";
import { rebuildEmissions } from "./em-reception";
import { launchPods, updatePods } from "./boarding";
import { applyCollisionDamage, buildShipCellHash, resolveShipCollisions } from "./collision";
import { SIM, resetProjectileCounter } from "./config";
import { updateCrew } from "./crew";
import { refillHardwiredAmmo } from "./crew-haul";
import { resourceStep } from "./resource-step";
import type { Debris } from "./debris";
import { spawnDebris, stepDebris } from "./debris";
import { resolveChainReactions } from "./chain-reaction";
import { splitBreakApart } from "./damage";
import { layMines, stepTechCooldowns, updateMines } from "./mines";
import type { DeploymentReference } from "./movement";
import { fleetCentroid, moveShips } from "./movement";
import { launchDecoys, launchDrones, stepPhantoms } from "./phantoms";
import { stepPulses } from "./pulse-step";
import type { SimPulse } from "./pulses";
import { hasAliveCommand, recomputeAggregates } from "./physics";
import { toSimShip } from "./setup";
import { electFocusTarget, pickTarget } from "./targeting";
import { applyBlink, applyCommandAuras, stepOvercharge } from "./tech";
import { shipDescriptor, snapshot } from "./snapshot";
import type { SimMine, SimPod, SimProjectile, SimShip } from "./types";
import { fireWeapons, updateProjectiles } from "./weapons";

export { comTangentialVelocity } from "./physics";
export { crewState, snapshot } from "./snapshot";

/**
 * Pure deterministic battle simulation. Yields one BattleFrame per tick —
 * the tick-0 frame first, then one per simulated tick in order — and returns
 * the outcome summary once the run terminates. Contains all the simulation
 * logic; it performs no id generation, timestamping, or config assembly, so
 * the same inputs yield byte-identical frames on every run. `runBattle` wraps
 * this generator to build a replayable BattleResult.
 *
 * `descriptorSink`, when provided, is populated with each ship instance's static
 * descriptor (cell layout + outline) the first frame that instance appears,
 * keyed by instanceId. It is a side channel so a streaming consumer (the worker)
 * can forward freshly captured descriptors alongside each batch before the final
 * summary — which also carries the complete, sorted descriptor list — lands.
 */
export function* simulateBattle(
  inputs: BattleInputs,
  descriptorSink?: Map<string, ShipDescriptor>,
): Generator<BattleFrame, BattleSummary> {
  const rng = mulberry32(inputs.seed >>> 0);
  resetProjectileCounter();
  const ships = inputs.ships.map((s) => toSimShip(s, rng));
  // Static descriptors, captured the first frame each instance appears. Either
  // the caller's sink (streaming) or a private map (direct runs). Sorted into
  // the summary at the end so two same-seed runs return the same order.
  const descriptors = descriptorSink ?? new Map<string, ShipDescriptor>();
  const captureDescriptors = (live: readonly SimShip[]): void => {
    for (const s of live) {
      if (!descriptors.has(s.instanceId)) {
        descriptors.set(s.instanceId, shipDescriptor(s));
      }
    }
  };
  // Per-side ship lists and the id index are rebuilt each tick (top of the loop)
  // so they pick up phantoms (drones/decoys) and break-away chunks added during
  // a tick. Phantoms are full SimShips so enemies can target them; the victory
  // check and focus election filter phantoms out explicitly.
  let attackers = ships.filter((s) => s.side === "attacker");
  let defenders = ships.filter((s) => s.side === "defender");
  let byId = new Map(ships.map((s) => [s.instanceId, s]));

  // Initial deployment reference: each side's centroid at the moment of
  // deployment, captured once before any ship moves. A ship with zero awareness
  // (no live contact, no ghost) advances toward the OPPOSING side's deployment
  // centroid so blind fleets close until something enters sensor range. This is
  // legitimate "we know roughly where they deployed" intel, NOT live tracking —
  // the reference never updates as enemies move, so it is not omniscience.
  const deployment: DeploymentReference = {
    attacker: fleetCentroid(ships, "attacker"),
    defender: fleetCentroid(ships, "defender"),
  };
  let projectiles: SimProjectile[] = [];
  // Deployed mines live here for the whole run, advanced each tick like
  // projectiles. Empty unless a mine-layer module lays into it, so a battle
  // with no mine-layers keeps it empty and emits no `mines` snapshots.
  let mines: SimMine[] = [];
  // Deterministic counter for break-away chunk ids. Each split consumes
  // one tick + one chunk-index slot so two battles with the same seed
  // produce the same chunk ids. Counter is private to this run.
  let chunkSeq = 0;
  const nextChunkId = (parentId: string, tick: number): string =>
    `${parentId}#chunk#${tick}#${chunkSeq += 1}`;
  // Deterministic counter for mine ids, combined with the laying ship's id and
  // the lay tick so ids are unique and reproducible across identical runs. No
  // rng, no clock — a pure function of spawn order.
  let mineSeq = 0;
  const nextMineId = (ownerId: string, tick: number): string =>
    `${ownerId}#mine#${tick}#${mineSeq += 1}`;
  // In-flight boarding pods live here for the whole run, advanced each tick like
  // projectiles/mines. Empty unless a boarding module launches into it, so a
  // battle with no boarding modules keeps it empty and emits no `pods` snapshots.
  let pods: SimPod[] = [];
  // Deterministic counter for boarding-pod ids, combined with the launching
  // ship's id and the launch tick so ids are unique and reproducible across
  // identical runs. No rng, no clock — a pure function of spawn order.
  let podSeq = 0;
  const nextPodId = (ownerId: string, tick: number): string =>
    `${ownerId}#pod#${tick}#${podSeq += 1}`;
  // Deterministic counter for phantom (drone/decoy) ids, combined with the
  // launching ship's id, the kind and the launch tick so ids are unique and
  // reproducible across identical runs. No rng, no clock.
  let phantomSeq = 0;
  const nextPhantomId = (ownerId: string, kind: string, tick: number): string =>
    `${ownerId}#${kind}#${tick}#${phantomSeq += 1}`;
  // Active-radar pulses (Phase 8) live here for the whole run, advanced each tick
  // like projectiles/mines. Empty unless an active-mode sensor emits into it, so a
  // battle with no active radar keeps it empty and emits no `pulses` snapshots.
  const pulses: SimPulse[] = [];
  // Deterministic monotonic counter for pulse (and reflection) ids, reset to 0
  // at battle start so two same-seed runs produce byte-identical pulse ids. No
  // rng, no clock — a pure function of spawn order, mirroring mineSeq.
  let pulseSeq = 0;
  // Continuous EM emission log (Phase 9). Rebuilt each tick from every ship's
  // baseline self-emission (plus active-sensor emissions), in (ship id, module
  // array) order behind a monotonic per-battle counter reset at battle start so
  // two same-seed runs produce byte-identical emission ids. The reception pass
  // (the awareness phase) consumes this; the snapshot records it (omitted when
  // empty). No rng, no clock — a pure function of ship state, mirroring pulseSeq.
  const emissions: Emission[] = [];
  let emissionSeq = 0;
  // Debris field (Phase 12). A destroyed ship leaves wreckage that keeps its
  // centre-of-mass momentum and drifts frictionlessly thereafter, advanced each
  // tick like projectiles/mines. Empty until the first ship dies, so a battle
  // with no destruction keeps it empty and emits no `debris` snapshots.
  const debris: Debris[] = [];
  // Deterministic monotonic counter for debris ids, combined with the destroyed
  // ship's id and the death tick so ids are unique and reproducible across
  // identical runs. No rng, no clock — a pure function of destruction order,
  // mirroring mineSeq.
  let debrisSeq = 0;
  const nextDebrisId = (parentId: string, tick: number): string =>
    `${parentId}#debris#${tick}#${debrisSeq += 1}`;

  // Occluders are a pure function of (anomaly, seed): compute them once here
  // (drawing from a salted, separate rng inside computeOccluders, never the
  // battle rng) and reuse the same array for every tick's awareness phase and
  // every snapshot. This keeps the awareness phase from touching the battle rng.
  const occluders = computeOccluders(inputs.anomaly, inputs.seed >>> 0);

  // Frame 0: run the awareness phase once so the opening snapshot carries the
  // same fog-of-war data every later frame does, and so each ship's `awareness`
  // is populated before the first targeting pass below.
  const frame0Awareness = computeAwareness(ships, byId, occluders, inputs.anomaly);
  // Record the frame-0 EM emission log alongside the awareness it produced. The
  // monotonic counter threads from its initial value through every later tick.
  emissionSeq = rebuildEmissions(ships, emissions, 0, emissionSeq);

  // Number of post-initial frames yielded, matching the previous
  // `frames.length - 1`: the tick-0 frame is excluded from the count.
  let ticks = 0;
  captureDescriptors(ships);
  yield snapshot(0, ships, projectiles, frame0Awareness, mines, pods, pulses, emissions, debris);

  let winner: BattleSide = "draw";
  let resolved = false;

  for (let tick = 1; tick <= inputs.maxTicks; tick++) {
    // 0. Awareness phase (sensors, comms, fog of war). Runs first so the
    //    targeting pass below reads each ship's freshly computed `awareness`.
    //    Pure function of ship state + the pre-computed occluders + anomaly;
    //    draws ZERO times from the battle rng. The returned snapshot is recorded
    //    on this tick's frame at the end of the loop body.
    const awareness = computeAwareness(ships, byId, occluders, inputs.anomaly);
    // 0a. Record the continuous EM emission log for this tick (Phase 9), behind
    //     the monotonic emission counter. The reception that built `awareness`
    //     above evaluated each enemy's emission strength per-pair; this log is
    //     the deterministic record of every EM event for the snapshot. Rebuilt
    //     from scratch each tick (a continuous emission reflects the current
    //     positions), so the array is freshly populated, never appended across
    //     ticks.
    emissionSeq = rebuildEmissions(ships, emissions, tick, emissionSeq);
    // 0. Refresh the per-side ship lists and id index from the live `ships`
    //    array so they include phantoms (drones/decoys) and break-away chunks
    //    added on a previous tick. Phantoms are full SimShips, so the targeting,
    //    projectile and damage pipelines strike them without special-casing.
    attackers = ships.filter((s) => s.side === "attacker");
    defenders = ships.filter((s) => s.side === "defender");
    byId = new Map(ships.map((s) => [s.instanceId, s]));

    // 0a-debris. Record which real ships are alive entering this tick, so the
    //     debris step after the damage phases can spawn wreckage for exactly the
    //     ships that died this tick (a transition from alive to dead). Phantoms
    //     (drones/decoys) leave no debris — they are transient projections, not
    //     hulls. Captured before any death-producing step runs.
    const aliveAtTickStart = new Set(
      ships.filter((s) => s.alive && s.phantom === undefined).map((s) => s.instanceId),
    );

    // 0b. Active-radar pulse field (Phase 8). Each active-mode sensor emits a
    //     light-speed pulse; live pulses expand by c and scatter reflections off
    //     enemies they sweep across; a reflection that has completed its round
    //     trip writes a light-lagged contact onto the emitter's freshly computed
    //     awareness (hence after computeAwareness, before targeting reads it).
    //     Opt-in: a no-op (array stays empty) for a battle with no active sensor,
    //     so byte output is unchanged for passive-only fleets.
    pulseSeq = stepPulses(ships, byId, pulses, inputs.anomaly, tick, pulseSeq);

    // 0c. AI interpreter (Phase 7 wiring). Evaluate each ship's stance + rules
    //     against the frame state and write the resulting hold-fire decision
    //     onto `aiHoldFire`, which the weapon-fire step reads below. Runs after
    //     awareness (so rules can read who has a target) and before targeting
    //     (so the decision reflects the ship's current situation, not the prior
    //     tick's). Pure: deterministic ship order, pure predicates, first-match
    //     rule wins. A ship with no rules evaluates to holdFire=false, so
    //     byte-output is unchanged for rule-less fleets.
    stepAi(ships, byId);

    // 1. Targeting.
    // Elect focus-fire targets once per tick per side. A ship with
    // focusFire=true defers to this fleet-agreed target; all others pick
    // independently. Computing the election outside the per-ship loop keeps
    // determinism: every ship on a side sees the same fleet target for this
    // tick, not a target that shifts as earlier ships set their own.
    const attackerFocusTarget = electFocusTarget("attacker", ships, defenders, tick);
    const defenderFocusTarget = electFocusTarget("defender", ships, attackers, tick);
    for (const ship of ships) {
      if (!ship.alive) continue;
      const enemies = ship.side === "attacker" ? defenders : attackers;
      const focusTarget =
        ship.side === "attacker" ? attackerFocusTarget : defenderFocusTarget;
      ship.target = pickTarget(ship, enemies, focusTarget, tick)?.instanceId;
    }

    // 1b. Tech timers (factions update). Advance every movement/power tech
    //     module's active-window and cooldown counters one tick, then fire any
    //     ready blink drive (teleporting the hull before the movement integrator
    //     runs, so the jumped-to position is where the ship thrusts from this
    //     tick). Both steps are opt-in: a ship with no tech modules has all
    //     timers at 0 and no blink modules, so neither touches its state.
    for (const ship of ships) {
      if (!ship.alive) continue;
      stepTechCooldowns(ship);
    }
    for (const ship of ships) {
      if (!ship.alive) continue;
      applyBlink(ship, byId, ships);
    }

    // 2. Movement + facing.
    moveShips(ships, byId, inputs.anomaly, deployment);

    // 2b. Ship-vs-ship collision at cell granularity. After movement, any two
    //     ships whose cells now overlap are pushed apart with an elastic
    //     impulse plus positional separation, so ships can't drive through each
    //     other. All sides are solid — friendlies collide too. The resolved
    //     contacts feed the kinetic-damage step below.
    const shipContacts = resolveShipCollisions(buildShipCellHash(ships));

    // 2b-kinetic. Kinetic collision damage (realism overhaul, Phase 4). Convert a
    //     fraction of each contact's collision kinetic energy (measured from the
    //     pre-impulse approach velocity the resolve step captured) into structural
    //     damage on both ships (Newton's third law), routed through applyDamage so
    //     shields/armour/modules apply. A no-op tick with no contacts, so byte
    //     output is unchanged for battles where ships never touch.
    applyCollisionDamage(shipContacts);

    // 2c. Command auras (factions update). With positions settled for the tick,
    //     recompute each ship's best friendly aura bonus so the firing step below
    //     reads the current buff. Opt-in: a no-op (every bonus reset to 0, then
    //     left there) for a battle with no command-aura module, so byte output is
    //     unchanged.
    applyCommandAuras(ships);

    // 2d. Mine laying (factions update). With positions settled, every ready,
    //     operational mine-layer drops its batch at the ship's current centre.
    //     Opt-in: a no-op (array untouched) for a battle with no mine-layer
    //     module, so byte output is unchanged for them.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      layMines(ship, mines, tick, nextMineId);
    }

    // 2e. Boarding pod launches (factions update). With positions settled, every
    //     ready, operational boarding module with a detectable enemy in range
    //     launches its pod salvo. Opt-in: a no-op for a battle with no boarding
    //     module, so byte output is unchanged for them.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      launchPods(ship, pods, ships, tick, nextPodId);
    }

    // 2f. Phantom launches (factions update). Hangars top up their drone wings
    //     and decoy launchers emit their false contacts, pushing phantom
    //     SimShips into `ships`. They are targetable from next tick (the
    //     per-side lists refresh at the top of the loop). Opt-in: a no-op for a
    //     battle with no hangar/decoy module, so byte output is unchanged.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      launchDrones(ship, ships, tick, nextPhantomId);
      launchDecoys(ship, ships, tick, nextPhantomId);
    }

    // 3. Weapon firing (creates projectiles; hitscan applies damage at once).
    projectiles = projectiles.concat(fireWeapons(ships, byId, rng, tick, inputs.anomaly));

    // 3b. PD cooldowns tick down so a battery that just fired can fire again
    //     the next tick. Tick here (before projectile resolution) so a PD
    //     module that's about to be online can intercept in-flight ordnance
    //     on this same tick if its cooldown just hit 0.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      for (const m of ship.modules) {
        if (!m.alive) continue;
        if (m.effect.kind !== "pointDefense") continue;
        if (m.cooldown > 0) m.cooldown -= 1;
      }
    }

    // 4. Projectile travel, homing, asteroid deflection, and collision.
    projectiles = updateProjectiles(projectiles, byId, inputs.anomaly, rng);

    // 4-mines. Mines (factions update). Arm down, then detonate any armed mine
    //     with an enemy in range against the nearest such enemy (via applyDamage,
    //     so shields/armour/modules apply). Detonated mines are dropped. Runs in
    //     the same damage phase as projectiles so the aggregate recompute below
    //     reflects modules a mine destroyed this tick. A no-op when no mines
    //     exist, so byte output is unchanged for battles without mine-layers.
    mines = updateMines(mines, ships);

    // 4-pods. Boarding pods (factions update). Home toward their targets and
    //     board on contact, disabling modules (so shields/armour/weapons drop)
    //     via recomputeAggregates inside boardShip. Runs in the same damage
    //     phase so the aggregate recompute below reflects modules a boarding
    //     disabled this tick. A no-op when no pods exist, so byte output is
    //     unchanged for battles without boarding modules.
    pods = updatePods(pods, ships);

    // 4-phantoms. Drones and decoys (factions update). Drones home on the
    //     nearest real enemy and strike it (via applyDamage); decoys merely
    //     count down. Expired or destroyed phantoms are marked dead in place.
    //     Runs in the damage phase so the aggregate recompute below reflects
    //     anything a drone destroyed this tick. A no-op when no phantoms exist.
    stepPhantoms(ships);

    // 4a-chain. Explosive chain reactions (realism overhaul, Phase 4). Any
    //     volatile module (reactor / magazine) reduced to zero HP this tick — by
    //     a weapon, a mine, a kinetic ram, or an earlier blast — detonates,
    //     dealing radial damage to its ship's other modules and chaining into any
    //     further volatile cells it destroys. Drained to completion within this
    //     tick before the aggregate recompute below, so a reactor breach is
    //     reflected in the same frame. A no-op for a ship that lost no volatile
    //     module, so byte output is unchanged for those.
    for (const ship of ships) {
      if (ship.modules !== undefined) resolveChainReactions(ship);
    }

    // 4b. Recompute aggregate stats from the alive module set, so a module
    //     destroyed this tick (hitscan or projectile) is reflected in the
    //     shield pool, thrust, and weapon list before regen and the snapshot,
    //     and carried into the next tick's movement and firing.
    for (const ship of ships) {
      if (ship.modules !== undefined) recomputeAggregates(ship);
    }

    // 4b-overcharge. Reactor overcharge (factions update). With the power budget
    //     settled, any ship still browning out fires a ready overcharge module;
    //     a second aggregate pass then folds the surge into the budget so the
    //     newly-lifted ceiling powers more modules this same tick. Opt-in: a no-op
    //     for ships with no overcharge module or no brownout, so byte output is
    //     unchanged for them.
    for (const ship of ships) {
      if (ship.modules === undefined) continue;
      if (stepOvercharge(ship)) recomputeAggregates(ship);
    }

    // 4b-crew. Crew AI + movement. After aggregates settle `powered`, each
    //     ship's crew walk one cell toward an under-manned station, then every
    //     module's `manned` flag is recomputed from the new positions. Done
    //     before break-apart so the split partitions crew by their post-move
    //     cell. Fully deterministic: crew iterate in id order, stations scan in
    //     (col, row) order, paths come from the fixed-tie-break A*.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      updateCrew(ship);
    }

    // 4b-ammo. Ammo conduits: refill every conduit-fed weapon directly from its
    //     magazine's store, dividing each magazine across its hardwired sinks.
    //     Runs after crew (which never haul to a conduit-fed weapon) and at the
    //     same latency as a crew deposit — rounds land this tick and fire next —
    //     and independently of crew, so a crewless hardwired ship is resupplied
    //     too. A no-op on designs with no ammo hardwires, preserving byte output.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      refillHardwiredAmmo(ship);
    }

    // 4b-resource. Resource & environment step (Phase 12 wiring, use-deferred).
    //     Advance each ship's thermal, propellant, atmosphere, and power state
    //     one tick. Runs after crew (atmosphere reads settled positions) and
    //     before break-apart (chunk inherits resource state next pass). No
    //     consequence is enforced — no overheat, brownout, asphyxiation, or
    //     dry-tank derelict. A no-op for ships with no resource state.
    for (const ship of ships) {
      if (!ship.alive) continue;
      resourceStep(ship);
    }

    // 4c. Break-apart: if the alive modules on a modular ship no longer
    //     form a single connected graph, split the disconnected pieces
    //     into fresh SimShips. Each chunk gets its own `brokeOff` flag
    //     for the UI to highlight the split. Done after aggregates so
    //     chunks inherit their own recomputed stats.
    const newChunks: SimShip[] = [];
    // Ships whose death this tick was a break-apart (their mass was carried off
    // into the chunks above), so the debris step must NOT also spawn wreckage
    // for them — that would double-count the same hull mass.
    const splitDeaths = new Set<string>();
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      const chunks = splitBreakApart(ship, tick, nextChunkId);
      if (chunks.length === 0) continue; // connected — nothing to do
      for (const chunk of chunks) {
        chunk.brokeOff = true;
        newChunks.push(chunk);
      }
      // A modular ship whose split drained it of all alive modules on
      // the survivor side is structurally dead — alive: false stops it
      // from being targeted, firing, or being checked for termination.
      if (ship.modules.every((m) => !m.alive)) {
        ship.alive = false;
        ship.structure = 0;
        splitDeaths.add(ship.instanceId);
      } else {
        // Re-run aggregates on the survivor since some modules flipped
        // to dead during the split (they were migrated to chunks).
        recomputeAggregates(ship);
      }
    }
    if (newChunks.length > 0) {
      for (const chunk of newChunks) {
        ships.push(chunk);
        byId.set(chunk.instanceId, chunk);
      }
      // Refresh side lists so termination checks below see new arrivals.
      attackers.length = 0;
      defenders.length = 0;
      for (const s of ships) {
        if (s.side === "attacker") attackers.push(s);
        else defenders.push(s);
      }
    }

    // 4d. A modular ship whose bridge (every command module) has been
    //     destroyed is a powerless derelict — it cannot fire, navigate, or
    //     coordinate. Kill it outright so disarmed survivors do not stall
    //     a battle that is otherwise decided. Runs after break-apart so a
    //     ship that loses its bridge mid-split still produces chunks first.
    //     Legacy non-modular ships are unaffected (hasAliveCommand returns
    //     true when there are no modules).
    for (const ship of ships) {
      if (!ship.alive) continue;
      if (ship.modules !== undefined && !hasAliveCommand(ship)) {
        ship.alive = false;
        ship.structure = 0;
      }
    }

    // 4e-debris. Spawn wreckage for every real ship that died this tick (alive
    //     at the top of the loop, dead now) and was genuinely destroyed rather
    //     than split into chunks. A break-apart already carried the hull mass off
    //     into its chunks, so those deaths are excluded to avoid double-counting.
    //     The fragment inherits the ship's centre-of-mass velocity (Newton's
    //     first law — momentum is conserved when the hull comes apart), with no
    //     breakup kick (a directed kick has no deterministic direction without
    //     rng, and reception/hazard wiring is use-deferred). The wreckage mass is
    //     a fraction of the hull's BUILT structural mass — the sum of every cell's
    //     mass, alive or destroyed, since `ship.mass` counts only alive cells and
    //     a destroyed hull has none left (a legacy non-modular ship keeps its
    //     per-class mass, so it falls back to that). Accumulated in module-array
    //     order (the fixed design-time slot order), so the sum is deterministic.
    //     Spawned in lexicographic id order behind the monotonic debris counter so
    //     two same-seed runs produce byte-identical ids; then every debris drifts
    //     one tick. A no-op until the first ship dies.
    const newlyDead = ships
      .filter(
        (s) =>
          s.phantom === undefined &&
          !s.alive &&
          aliveAtTickStart.has(s.instanceId) &&
          !splitDeaths.has(s.instanceId),
      )
      .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
    for (const dead of newlyDead) {
      let hullMass = 0;
      if (dead.modules === undefined) {
        hullMass = dead.mass;
      } else {
        for (const m of dead.modules) hullMass += m.mass;
      }
      if (hullMass <= 0) continue; // massless hull leaves nothing to track
      debris.push(
        spawnDebris(
          nextDebrisId(dead.instanceId, tick),
          { x: dead.x, y: dead.y },
          { x: dead.velX, y: dead.velY },
          { x: 0, y: 0 },
          hullMass * SIM.debrisMassFraction,
        ),
      );
    }
    // Advance every drifting fragment one tick (pure Newtonian drift). Done in
    // place over the array; `stepDebris` returns a fresh entity per fragment.
    for (let i = 0; i < debris.length; i++) {
      const d = debris[i];
      if (d !== undefined) debris[i] = stepDebris(d);
    }

    // 5. Shield regeneration.
    const regenFactor = inputs.anomaly === "nebula" ? SIM.nebulaRegenFactor : 1;
    for (const ship of ships) {
      if (!ship.alive) continue;
      // Adaptive shields: count the ticks since the shield was last touched. A hit
      // this tick already reset the streak to 0 in applyDamage, so incrementing
      // here advances any shield that went untouched. Only the regen below reads
      // it, and only when the ship's ramp is non-zero, so a conventional shield's
      // streak never affects anything. The streak is bounded by the multiplier
      // cap, so it need not grow without limit.
      if (ship.shieldAdaptiveRamp > 0) {
        const cap = Math.ceil(
          (SIM.adaptiveShieldMaxMultiple - 1) / ship.shieldAdaptiveRamp,
        );
        if (ship.shieldUntouchedTicks < cap) ship.shieldUntouchedTicks += 1;
      }
      if (ship.shield >= ship.maxShield) continue;
      if (ship.shieldRegenCountdown > 0) {
        ship.shieldRegenCountdown -= ship.dilationFactor;
      } else {
        // Effective rate ramps with the untouched streak for an adaptive shield,
        // capped at `adaptiveShieldMaxMultiple` times the base rate; a
        // conventional shield (ramp 0) keeps its flat base rate exactly.
        // The recharge amount is scaled by `dilationFactor` so a ship in a
        // relativistic frame regenerates at the same slowed rate as it fires.
        const rampMultiple = Math.min(
          SIM.adaptiveShieldMaxMultiple,
          1 + ship.shieldAdaptiveRamp * ship.shieldUntouchedTicks,
        );
        ship.shield = Math.min(
          ship.maxShield,
          ship.shield + ship.shieldRechargeRate * rampMultiple * regenFactor * ship.dilationFactor,
        );
      }
    }

    // 5b. Module repair (per-module ships only). Each alive repair module on
    //     a living ship picks the first damaged alive module in array order
    //     and heals it by `repairRate`, capped at maxHp. A repair module can
    //     heal itself (a bay patching its own systems); multiple repair
    //     modules each heal one module per tick; if there's nothing damaged
    //     yet, they idle. A repair module destroyed mid-battle can't run
    //     any more. Aggregated ships have no modules to repair, so the step
    //     is skipped for them.
    for (const ship of ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      for (const healer of ship.modules) {
        if (!healer.alive || healer.repairRate <= 0) continue;
        const target = ship.modules.find((m) => m.alive && m.hp < m.maxHp);
        if (target === undefined) continue;
        // Scale the heal by the ship's dilation factor: a relativistically
        // slowed ship repairs at the same reduced rate as it fires and recharges.
        target.hp = Math.min(target.maxHp, target.hp + healer.repairRate * ship.dilationFactor);
      }
    }

    // Capture descriptors for any instance that first appeared this tick
    // (break-away chunks, launched phantoms) before recording the frame.
    captureDescriptors(ships);
    yield snapshot(tick, ships, projectiles, awareness, mines, pods, pulses, emissions, debris);
    ticks += 1;

    // 6. Termination. Only real ships decide the battle — a side whose hulls
    //    are all gone loses even if its drones are still in the air.
    const attackerAlive = attackers.some((s) => s.alive && s.phantom === undefined);
    const defenderAlive = defenders.some((s) => s.alive && s.phantom === undefined);
    if (!attackerAlive && !defenderAlive) {
      winner = "draw";
      resolved = true;
      break;
    }
    if (!attackerAlive) {
      winner = "defender";
      resolved = true;
      break;
    }
    if (!defenderAlive) {
      winner = "attacker";
      resolved = true;
      break;
    }
  }

  // Ran out of ticks without a decisive end: decide by remaining hit points.
  if (!resolved) {
    winner = leadingSide(attackers, defenders);
  }

  return { winner, ticks, descriptors: sortedDescriptors(descriptors) };
}

/**
 * Stable lexicographic-by-instanceId ordering of the captured descriptors, so
 * two same-seed runs return byte-identical descriptor lists regardless of the
 * Map's insertion order.
 */
function sortedDescriptors(map: ReadonlyMap<string, ShipDescriptor>): ShipDescriptor[] {
  return [...map.values()].sort((a, b) =>
    a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0,
  );
}

export function runBattle(inputs: BattleInputs): BattleResult {
  const frames: BattleFrame[] = [];
  const sim = simulateBattle(inputs);
  let step = sim.next();
  while (!step.done) {
    frames.push(step.value);
    step = sim.next();
  }
  const summary = step.value;

  return {
    id: createId("battle"),
    config: {
      attackerFleetId: inputs.attackerFleetId,
      defenderFleetId: inputs.defenderFleetId,
      anomaly: inputs.anomaly,
      seed: inputs.seed,
    },
    winner: summary.winner,
    ticks: summary.ticks,
    playedAt: nowIso(),
    frames,
    // Faction/side of each combatant, carried once per battle so the renderer
    // can colour ships by faction without bloating per-tick snapshots.
    roster: inputs.ships.map((s) => ({
      instanceId: s.instanceId,
      faction: s.faction,
      side: s.side,
    })),
    // Static per-ship cell layout + outline, emitted once so frames carry only
    // dynamic cell state. The renderer derives cell world positions from these.
    descriptors: summary.descriptors,
  };
}

export function leadingSide(
  attackers: readonly SimShip[],
  defenders: readonly SimShip[],
): BattleSide {
  // Only real ships count toward the leading side — phantoms (drones/decoys)
  // are transient and must not swing a timeout decision.
  const total = (group: readonly SimShip[]) =>
    group.reduce(
      (sum, s) => (s.phantom === undefined ? sum + s.structure + s.shield : sum),
      0,
    );
  const a = total(attackers);
  const d = total(defenders);
  if (a > d) return "attacker";
  if (d > a) return "defender";
  return "draw";
}
