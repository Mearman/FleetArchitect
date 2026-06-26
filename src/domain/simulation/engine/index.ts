/**
 * The battle tick loop and the two public entry points (`runBattle`,
 * `simulateBattle`). Re-exports `comTangentialVelocity`. Resets
 * `projectileCounter` at the start of each battle so two same-seed runs
 * produce byte-identical projectile ids.
 */

import { createId, nowIso } from "@/domain/id";
import { mulberry32 } from "@/domain/simulation/rng";
import { computeOccluders } from "@/domain/occluders";
import { hasAnomaly } from "@/domain/anomaly";
import type { BattleFrame, BattleResult, ShipDescriptor } from "@/schema/battle";
import type { BattleInputs, BattleSummary } from "../types";
import { STALEMATE_IDLE_TICKS, TICKS_PER_SECOND } from "../types";
import { createStalemateWatch, tickStalemateWatch } from "./stalemate";
import type { StalemateWatch } from "./stalemate";

import { computeAwareness } from "./awareness";
import { stepAi } from "./ai-step";
import { rebuildEmissions } from "./em-reception";
import { launchPods, updatePods } from "./boarding";
import { applyCollisionDamage, buildShipCellHash, resolveShipCollisions } from "./collision";
import { SIM } from "./config";
import { bootstrapEngine } from "./bootstrap";
import { captureCheckpoint } from "./checkpoint";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import { leadingSide } from "./outcome";
import { stepArenaMediumFromState } from "./medium-setup";
import { ageBeams } from "./beams";
import { stepPlume } from "./particle-sources";
import { updateCrew } from "./crew";
import { refillHardwiredAmmo } from "./crew-haul";
import { resourceStep } from "./resource-step";
import { spawnDebris, stepDebris } from "./debris";
import { claimHulls, collectDebris, isClaimed, summariseSalvage } from "./salvage";
import { resolveChainReactions } from "./chain-reaction";
import { applyDamage, splitBreakApart } from "./damage";
import { layMines, stepTechCooldowns, updateMines } from "./mines";
import { moveShips } from "./movement";
import { launchDecoys, launchDrones, stepPhantoms } from "./phantoms";
import { stepPulses } from "./pulse-step";
import { hasAliveCommand, recomputeAggregates } from "./physics";
import { electFocusTarget, pickTarget } from "./targeting";
import { refreshRosterIncremental } from "./roster";
import { applyBlink, applyCommandAuras, stepOvercharge } from "./tech";
import { shipDescriptor, snapshot } from "./snapshot";
import type { SimShip } from "./types";
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
 * `options.descriptorSink`, when provided, is populated with each instance's
 * static descriptor (cell layout + outline) the first frame it appears, keyed by
 * instanceId — a side channel so a streaming consumer (the worker) can forward
 * freshly captured descriptors alongside each batch before the final summary
 * (which also carries the complete, sorted descriptor list) lands.
 *
 * `options.resumeFrom`, when provided, restarts the battle from a captured
 * {@link EngineCheckpoint} instead of from tick 0: `bootstrapEngine` restores the
 * RNG, the projectile counter and the engine state, the occluders and static
 * descriptors re-derive byte-identically (pure functions of `(anomaly, seed)` and
 * the ship layout), and the loop re-enters at `checkpoint.tick + 1` WITHOUT
 * re-yielding tick `checkpoint.tick`. A fresh run (no `resumeFrom`) runs exactly
 * the prologue it always did, so its frames stay byte-for-byte reproducible.
 *
 * `options.checkpointEvery` / `options.onCheckpoint`, when both provided, emit a
 * checkpoint at every tick where `tick % checkpointEvery === 0`, after the frame
 * is yielded and the termination checks have run, so a resume reproduces the tail
 * exactly. With either omitted the loop does no capture — the no-options path is
 * zero-cost.
 */
export interface SimulateBattleOptions {
  /** Side channel populated with each instance's static descriptor on first
   *  appearance, for a streaming consumer (the worker). */
  descriptorSink?: Map<string, ShipDescriptor>;
  /** Resume from this captured checkpoint instead of starting at tick 0. */
  resumeFrom?: EngineCheckpoint;
  /** Emit a checkpoint every this-many ticks (requires `onCheckpoint`). */
  checkpointEvery?: number;
  /** Receives each emitted checkpoint (requires `checkpointEvery`). */
  onCheckpoint?: (checkpoint: EngineCheckpoint) => void;
}

export function* simulateBattle(
  inputs: BattleInputs,
  options?: SimulateBattleOptions,
): Generator<BattleFrame, BattleSummary> {
  const resumeFrom = options?.resumeFrom;
  // Restore the RNG to its end-of-tick position on resume; seed a fresh
  // generator at `seed >>> 0` on a cold start. The fresh path is byte-identical
  // to the original `mulberry32(inputs.seed >>> 0)` call.
  const rng =
    resumeFrom === undefined
      ? mulberry32(inputs.seed >>> 0)
      : mulberry32(inputs.seed >>> 0, resumeFrom.rngState);
  // Static descriptors, captured the first frame each instance appears. Either
  // the caller's sink (streaming) or a private map (direct runs). Sorted into
  // the summary at the end so two same-seed runs return the same order. On
  // resume they re-derive byte-identically from the restored ships the first
  // resumed tick (a pure function of the ship layout), so the sink starts empty
  // exactly as on a cold start.
  const descriptors = options?.descriptorSink ?? new Map<string, ShipDescriptor>();
  const captureDescriptors = (live: readonly SimShip[]): void => {
    for (const s of live) {
      if (!descriptors.has(s.instanceId)) {
        descriptors.set(s.instanceId, shipDescriptor(s));
      }
    }
  };

  // Assemble the initial engine state: built fresh from the resolved ships on a
  // cold start, or rebuilt from the checkpoint on resume. `startTick` is 1 on a
  // cold start or `checkpoint.tick + 1` on resume; `stalemate` is undefined on
  // a cold start (the frame-0 prologue below creates it) and restored on resume.
  const bootstrap = bootstrapEngine(inputs, rng, resumeFrom);
  const state = bootstrap.state;
  const startTick = bootstrap.startTick;
  let stalemate: StalemateWatch | undefined = bootstrap.stalemate;

  // Deterministic id minters. Each consumes one slot from a monotonic counter
  // on the EngineState, combining it with the spawning ship's id, the kind, and
  // the tick so ids are unique and reproducible across identical runs. No rng,
  // no clock — a pure function of spawn order.
  const nextChunkId = (parentId: string, tick: number): string =>
    `${parentId}#chunk#${tick}#${state.chunkSeq += 1}`;
  const nextMineId = (ownerId: string, tick: number): string =>
    `${ownerId}#mine#${tick}#${state.mineSeq += 1}`;
  const nextPodId = (ownerId: string, tick: number): string =>
    `${ownerId}#pod#${tick}#${state.podSeq += 1}`;
  const nextPhantomId = (ownerId: string, kind: string, tick: number): string =>
    `${ownerId}#${kind}#${tick}#${state.phantomSeq += 1}`;
  const nextDebrisId = (parentId: string, tick: number): string =>
    `${parentId}#debris#${tick}#${state.debrisSeq += 1}`;

  // Occluders are a pure function of (anomaly, seed): compute them once here
  // (drawing from a salted, separate rng inside computeOccluders, never the
  // battle rng) and reuse the same array for every tick's awareness phase and
  // every snapshot. This keeps the awareness phase from touching the battle rng.
  const occluders = computeOccluders(inputs.anomalies, inputs.seed >>> 0);

  // Frame 0 + stalemate watch: the cold-start prologue only. On resume neither
  // runs again (frame 0 was yielded, the watch restored) — re-running would
  // diverge from a fresh run's tail.
  if (resumeFrom === undefined) {
    // Frame 0: run the awareness phase once so the opening snapshot carries the
    // same fog-of-war data every later frame does, and so each ship's `awareness`
    // is populated before the first targeting pass below.
    const frame0Awareness = computeAwareness(state.ships, state.byId, occluders, inputs.anomalies, state.medium, 0);
    // Record the frame-0 EM emission log alongside the awareness it produced. The
    // monotonic counter threads from its initial value through every later tick.
    state.emissionSeq = rebuildEmissions(state.ships, state.emissions, 0, state.emissionSeq, state.medium);

    captureDescriptors(state.ships);
    yield snapshot(0, state.ships, state.projectiles, frame0Awareness, state.mines, state.pods, state.pulses, state.emissions, state.debris, state.beams, state.particles, state.medium);

    // No-progress stalemate watchdog (see ./stalemate) — the termination
    // guarantee for an uncapped battle, created only when there is no explicit
    // `maxTicks` (a focused test passing a cap runs the legacy fixed-length loop).
    stalemate =
      inputs.maxTicks === undefined ? createStalemateWatch(state.ships) : undefined;
  }

  // Both `checkpointEvery` (a positive cadence) and `onCheckpoint` must be
  // present to capture; with either omitted the loop does no capture at all
  // (zero-cost no-options path). A single thunk closes over both so the loop body
  // narrows once here rather than per-tick: undefined when not capturing.
  const checkpointEvery = options?.checkpointEvery;
  const onCheckpoint = options?.onCheckpoint;
  const emitCheckpoint =
    checkpointEvery !== undefined && checkpointEvery > 0 && onCheckpoint !== undefined
      ? (tick: number): void => {
          if (tick % checkpointEvery === 0) {
            onCheckpoint(captureCheckpoint(state, rng, tick, stalemate));
          }
        }
      : undefined;

  for (let tick = startTick; inputs.maxTicks === undefined || tick <= inputs.maxTicks; tick++) {
    // 0. Awareness phase (sensors, comms, fog of war). Runs first so the
    //    targeting pass below reads each ship's freshly computed `awareness`.
    //    Pure function of ship state + occluders + anomaly; draws ZERO times
    //    from the battle rng. The returned snapshot is recorded on this tick's
    //    frame at the end of the loop body.
    //
    //    Dynamic occluders: the static anomaly occluders are pre-computed once
    //    (line ~161 above), but debris fragments change every tick as new
    //    wreckage spawns. Rebuild a per-tick list each awareness pass by
    //    appending one Disc per drifting fragment — radius maps directly from
    //    the fragment's `radius` field to `r` (same physical meaning, different
    //    field name by convention). The static array is never mutated.
    const dynamicOccluders = state.debris.length === 0
      ? occluders
      : [
          ...occluders,
          ...state.debris.filter((d): d is NonNullable<typeof d> => d !== undefined).map((d) => ({
            x: d.x,
            y: d.y,
            r: d.radius,
          })),
        ];
    const awareness = computeAwareness(state.ships, state.byId, dynamicOccluders, inputs.anomalies, state.medium, tick);
    // 0a. Record the continuous EM emission log for this tick (Phase 9), behind
    //     the monotonic emission counter. The reception that built `awareness`
    //     above evaluated each enemy's emission strength per-pair; this log is
    //     the deterministic record of every EM event for the snapshot. Rebuilt
    //     from scratch each tick (a continuous emission reflects the current
    //     positions), so the array is freshly populated, never appended across
    //     ticks.
    state.emissionSeq = rebuildEmissions(state.ships, state.emissions, tick, state.emissionSeq, state.medium);
    // 0. Refresh the per-side ship lists and id index from the live `ships`
    //    array so they include phantoms (drones/decoys) and break-away chunks
    //    added on a previous tick. Incremental: membership only grows and ships
    //    never change side, so the rebuild runs only when the count changed
    //    (see ./roster.ts).
    refreshRosterIncremental(state);

    // 0a-debris. Record which real ships are alive entering this tick, so the
    //     debris step after the damage phases can spawn wreckage for exactly the
    //     ships that died this tick (a transition from alive to dead). Phantoms
    //     (drones/decoys) leave no debris — they are transient projections, not
    //     hulls. Captured before any death-producing step runs.
    const aliveAtTickStart = new Set(
      state.ships.filter((s) => s.alive && s.phantom === undefined).map((s) => s.instanceId),
    );

    // 0b. Active-radar pulse field (Phase 8). Each active-mode sensor emits a
    //     light-speed pulse; live pulses expand by c and scatter reflections off
    //     enemies they sweep across; a reflection that has completed its round
    //     trip writes a light-lagged contact onto the emitter's freshly computed
    //     awareness (hence after computeAwareness, before targeting reads it).
    //     Opt-in: a no-op (array stays empty) for a battle with no active sensor,
    //     so byte output is unchanged for passive-only fleets.
    state.pulseSeq = stepPulses(state.ships, state.byId, state.pulses, inputs.anomalies, tick, state.pulseSeq);

    // 0c. AI interpreter (Phase 7 wiring). Evaluate each ship's stance + rules
    //     against the frame state and write the resulting hold-fire decision
    //     onto `aiHoldFire`, which the weapon-fire step reads below. Runs after
    //     awareness (so rules can read who has a target) and before targeting
    //     (so the decision reflects the ship's current situation, not the prior
    //     tick's). Pure: deterministic ship order, pure predicates, first-match
    //     rule wins. A ship with no rules evaluates to holdFire=false, so
    //     byte-output is unchanged for rule-less fleets.
    stepAi(state.ships, state.byId);

    // 1. Targeting.
    // Elect focus-fire targets once per tick per side. A ship with
    // focusFire=true defers to this fleet-agreed target; all others pick
    // independently. Computing the election outside the per-ship loop keeps
    // determinism: every ship on a side sees the same fleet target for this
    // tick, not a target that shifts as earlier ships set their own.
    const attackerFocusTarget = electFocusTarget("attacker", state.ships, state.defenders, tick);
    const defenderFocusTarget = electFocusTarget("defender", state.ships, state.attackers, tick);
    for (const ship of state.ships) {
      if (!ship.alive) continue;
      // A claimed hull is inert salvage: it holds no target and engages nothing.
      if (isClaimed(ship)) {
        ship.target = undefined;
        continue;
      }
      const enemies = ship.side === "attacker" ? state.defenders : state.attackers;
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
    for (const ship of state.ships) {
      if (!ship.alive) continue;
      stepTechCooldowns(ship);
    }
    for (const ship of state.ships) {
      if (!ship.alive) continue;
      applyBlink(ship, state.byId, state.ships);
    }

    // 2. Movement + facing.
    moveShips(state.ships, state.byId, inputs.anomalies, state.deployment, SIM.defaultRange, state.medium);

    // 2b. Ship-vs-ship collision at cell granularity. After movement, any two
    //     ships whose cells now overlap are pushed apart with an elastic
    //     impulse plus positional separation, so ships can't drive through each
    //     other. All sides are solid — friendlies collide too. The resolved
    //     contacts feed the kinetic-damage step below.
    const shipContacts = resolveShipCollisions(buildShipCellHash(state.ships));

    // 2b-kinetic. Kinetic collision damage (realism overhaul, Phase 4). Convert a
    //     fraction of each contact's collision kinetic energy (measured from the
    //     pre-impulse approach velocity the resolve step captured) into structural
    //     damage on both ships (Newton's third law), routed through applyDamage so
    //     shields/armour/modules apply. A no-op tick with no contacts, so byte
    //     output is unchanged for battles where ships never touch.
    applyCollisionDamage(shipContacts);

    // 2b-debris. Debris kinetic hazard (Phase 12). Drifting wreckage occupies the
    //     same world space as ships; when a fragment's bounding disc overlaps a
    //     ship's bounding disc, it transfers kinetic energy to the ship's hull
    //     (½·m·v_rel²·damageFraction), routed through applyDamage so
    //     shields/armour/modules apply. No shieldPiercing or armourPiercing —
    //     wreckage hits the outer surface. The debris fragment is not destroyed or
    //     modified (it is large drifting mass, not a round). Contacts below
    //     SIM.debrisMinRelSpeed are ignored (stationary relative nudges). Debris
    //     is advanced one tick later (step 4e-debris below), so the positions here
    //     are from the previous tick's advance — consistent: the advance and the
    //     damage step are in the same relative order every tick. A no-op until the
    //     first ship dies and leaves wreckage; ships iterated in instanceId order.
    if (state.debris.length > 0) {
      // Build a sorted alive-ship list once for this debris pass, deterministic.
      const aliveShipsSorted = state.ships
        .filter((s) => s.alive && s.phantom === undefined)
        .sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
      for (const d of state.debris) {
        if (d === undefined) continue;
        for (const s of aliveShipsSorted) {
          const dx = d.x - s.x;
          const dy = d.y - s.y;
          const distSq = dx * dx + dy * dy;
          const contactDist = d.radius + s.radius;
          if (distSq > contactDist * contactDist) continue;
          const relVx = d.velX - s.velX;
          const relVy = d.velY - s.velY;
          const relSpeedSq = relVx * relVx + relVy * relVy;
          if (relSpeedSq <= SIM.debrisMinRelSpeed * SIM.debrisMinRelSpeed) continue;
          // Kinetic energy transferred: KE = ½ · m · v_rel²
          // (sub-light debris, no relativistic correction needed here — a debris
          // fragment moves at hull momentum / hull mass, well below c).
          const ke = 0.5 * d.mass * relSpeedSq;
          const damage = ke * SIM.debrisCollisionDamageFraction;
          if (damage <= 0) continue;
          applyDamage(s, damage, 0, 0, d.x, d.y);
        }
      }
    }

    // 2c. Command auras (factions update). With positions settled for the tick,
    //     recompute each ship's best friendly aura bonus so the firing step below
    //     reads the current buff. Opt-in: a no-op (every bonus reset to 0, then
    //     left there) for a battle with no command-aura module, so byte output is
    //     unchanged.
    applyCommandAuras(state.ships);

    // 2d. Mine laying (factions update). With positions settled, every ready,
    //     operational mine-layer drops its batch at the ship's current centre.
    //     Opt-in: a no-op (array untouched) for a battle with no mine-layer
    //     module, so byte output is unchanged for them.
    for (const ship of state.ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      layMines(ship, state.mines, tick, nextMineId, SIM.mineRingSpacing);
    }

    // 2e. Boarding pod launches (factions update). With positions settled, every
    //     ready, operational boarding module with a detectable enemy in range
    //     launches its pod salvo. Opt-in: a no-op for a battle with no boarding
    //     module, so byte output is unchanged for them.
    for (const ship of state.ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      launchPods(ship, state.pods, state.ships, tick, nextPodId);
    }

    // 2f. Phantom launches (factions update). Hangars top up their drone wings
    //     and decoy launchers emit their false contacts, pushing phantom
    //     SimShips into `ships`. They are targetable from next tick (the
    //     per-side lists refresh at the top of the loop). Opt-in: a no-op for a
    //     battle with no hangar/decoy module, so byte output is unchanged.
    for (const ship of state.ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      launchDrones(ship, state.ships, tick, nextPhantomId);
      launchDecoys(ship, state.ships, tick, nextPhantomId);
    }

    // 3. Weapon firing (creates projectiles; hitscan applies damage at once).
    state.projectiles = state.projectiles.concat(fireWeapons(state.ships, state.byId, rng, tick, inputs.anomalies, state.beams));

    // 3-beams. Age the beam emissions the fire step just pushed and drop expired
    //     entries (order-preserving; byte-identical across same-seed runs).
    state.beams = ageBeams(state.beams);

    // 3b. PD cooldowns tick down so a battery that just fired can fire again
    //     the next tick. Tick here (before projectile resolution) so a PD
    //     module that's about to be online can intercept in-flight ordnance
    //     on this same tick if its cooldown just hit 0.
    for (const ship of state.ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      for (const m of ship.modules) {
        if (!m.alive) continue;
        if (m.effect.kind !== "pointDefense") continue;
        if (m.cooldown > 0) m.cooldown -= 1;
      }
    }

    // 4. Projectile travel, homing, asteroid deflection, and collision.
    state.projectiles = updateProjectiles(state.projectiles, state.byId, inputs.anomalies, rng, state.medium);

    // 4-mines. Mines (factions update). Arm down, then detonate any armed mine
    //     with an enemy in range against the nearest such enemy (via applyDamage,
    //     so shields/armour/modules apply). Detonated mines are dropped. Runs in
    //     the same damage phase as projectiles so the aggregate recompute below
    //     reflects modules a mine destroyed this tick. A no-op when no mines
    //     exist, so byte output is unchanged for battles without mine-layers.
    state.mines = updateMines(state.mines, state.ships);

    // 4-pods. Boarding pods (factions update). Home toward their targets and
    //     board on contact, disabling modules (so shields/armour/weapons drop)
    //     via recomputeAggregates inside boardShip. Runs in the same damage
    //     phase so the aggregate recompute below reflects modules a boarding
    //     disabled this tick. A no-op when no pods exist, so byte output is
    //     unchanged for battles without boarding modules.
    state.pods = updatePods(state.pods, state.ships);

    // 4-phantoms. Drones and decoys (factions update). Drones home on the
    //     nearest real enemy and strike it (via applyDamage); decoys merely
    //     count down. Expired or destroyed phantoms are marked dead in place.
    //     Runs in the damage phase so the aggregate recompute below reflects
    //     anything a drone destroyed this tick. A no-op when no phantoms exist.
    stepPhantoms(state.ships);

    // 4a-chain. Explosive chain reactions (realism overhaul, Phase 4). Any
    //     volatile module (reactor / magazine) reduced to zero HP this tick — by
    //     a weapon, a mine, a kinetic ram, or an earlier blast — detonates,
    //     dealing radial damage to its ship's other modules and chaining into any
    //     further volatile cells it destroys. Drained to completion within this
    //     tick before the aggregate recompute below, so a reactor breach is
    //     reflected in the same frame. A no-op for a ship that lost no volatile
    //     module, so byte output is unchanged for those.
    for (const ship of state.ships) {
      if (ship.modules !== undefined) resolveChainReactions(ship, state.ships);
    }

    // 4b. Recompute aggregate stats from the alive module set, so a module
    //     destroyed this tick (hitscan or projectile) is reflected in the
    //     shield pool, thrust, and weapon list before regen and the snapshot,
    //     and carried into the next tick's movement and firing.
    for (const ship of state.ships) {
      if (ship.modules !== undefined) recomputeAggregates(ship);
    }

    // 4b-overcharge. Reactor overcharge (factions update). With the power budget
    //     settled, any ship still browning out fires a ready overcharge module;
    //     a second aggregate pass then folds the surge into the budget so the
    //     newly-lifted ceiling powers more modules this same tick. Opt-in: a no-op
    //     for ships with no overcharge module or no brownout, so byte output is
    //     unchanged for them.
    for (const ship of state.ships) {
      if (ship.modules === undefined) continue;
      if (stepOvercharge(ship)) recomputeAggregates(ship);
    }

    // 4b-crew. Crew AI + movement. After aggregates settle `powered`, each
    //     ship's crew walk one cell toward an under-manned station, then every
    //     module's `manned` flag is recomputed from the new positions. Done
    //     before break-apart so the split partitions crew by their post-move
    //     cell. Fully deterministic: crew iterate in id order, stations scan in
    //     (col, row) order, paths come from the fixed-tie-break A*.
    for (const ship of state.ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      updateCrew(ship);
    }

    // 4b-ammo. Ammo conduits: refill every conduit-fed weapon directly from its
    //     magazine's store, dividing each magazine across its hardwired sinks.
    //     Runs after crew (which never haul to a conduit-fed weapon) and at the
    //     same latency as a crew deposit — rounds land this tick and fire next —
    //     and independently of crew, so a crewless hardwired ship is resupplied
    //     too. A no-op on designs with no ammo hardwires, preserving byte output.
    for (const ship of state.ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      refillHardwiredAmmo(ship);
    }

    // 4b-resource. Resource & environment step (Phase 12). Advance each ship's
    //     thermal, propellant, atmosphere, and power state one tick, then enforce
    //     the resource consequences: dry-tank engine flame-out, energy-buffer
    //     brownout load-shedding, and overheat module destruction (asphyxiation /
    //     venting is enforced inside the step via the airtightness vent mask).
    //     Runs after crew (atmosphere reads settled positions) and before
    //     break-apart, so an overheat-killed cell splits the hull this same tick.
    //     A no-op for ships with no resource state.
    for (const ship of state.ships) {
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
    for (const ship of state.ships) {
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
        state.ships.push(chunk);
        state.byId.set(chunk.instanceId, chunk);
      }
      // Refresh side lists so termination checks below see new arrivals.
      state.attackers.length = 0;
      state.defenders.length = 0;
      for (const s of state.ships) {
        if (s.side === "attacker") state.attackers.push(s);
        else state.defenders.push(s);
      }
    }

    // 4d. A modular ship whose bridge (every command module) has been
    //     destroyed is a powerless derelict — it cannot fire, navigate, or
    //     coordinate. Kill it outright so disarmed survivors do not stall
    //     a battle that is otherwise decided. Runs after break-apart so a
    //     ship that loses its bridge mid-split still produces chunks first.
    //     Legacy non-modular ships are unaffected (hasAliveCommand returns
    //     true when there are no modules).
    for (const ship of state.ships) {
      if (!ship.alive) continue;
      if (ship.modules !== undefined && !hasAliveCommand(ship)) {
        ship.alive = false;
        ship.structure = 0;
      }
    }

    // 4e-salvage. Salvage mechanics: debris collection and hull claiming. Runs
    //     BEFORE this tick's wreckage is spawned, so it sweeps only the fragments
    //     that drifted in from earlier ticks — a fragment is therefore snapshotted
    //     at least once (the tick it spawned) before any ship can collect it,
    //     rather than vanishing the instant it appears. Each living, unclaimed,
    //     non-phantom ship collects any drifting wreckage within `SALVAGE_RANGE_M`
    //     (adding its mass to the ship's running `salvageMass` and removing it from
    //     the field), then each living salvager claims the first derelict enemy
    //     hull in range — every weapon and drive disabled, no crew left, not
    //     already claimed. Both passes iterate ships in instanceId order and debris
    //     in id order, so the outcome is a pure deterministic function of state. A
    //     no-op until wreckage exists (no debris) and a hull is derelict, so byte
    //     output is unchanged for battles with no salvage.
    collectDebris(state.ships, state.debris);
    claimHulls(state.ships);

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
    const newlyDead = state.ships
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
      state.debris.push(
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
    for (let i = 0; i < state.debris.length; i++) {
      const d = state.debris[i];
      if (d !== undefined) state.debris[i] = stepDebris(d);
    }

    // 5. Shield regeneration.
    const regenFactor = hasAnomaly(inputs.anomalies, "nebula") ? SIM.nebulaRegenFactor : 1;
    for (const ship of state.ships) {
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
        // `shieldRechargeRate` is watts; /TICKS_PER_SECOND gives joules-per-tick
        // (else it regens TPS× too fast). The ramp multiple stays unitless.
        const rechargeJoulesThisTick =
          (ship.shieldRechargeRate / TICKS_PER_SECOND) * rampMultiple * regenFactor * ship.dilationFactor;
        ship.shield = Math.min(ship.maxShield, ship.shield + rechargeJoulesThisTick);
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
    for (const ship of state.ships) {
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

    // 5c. Arena medium: per-tick sources, then diffuse and decay. `tick` seeds
    //     the per-cell birthTicks the sustained-radiation startup light-lag gates.
    const pMedium = state.projectiles.map((p) => ({ x: p.x, y: p.y, powered: p.powered, burnTicks: p.burnTicks, thrust: p.thrust, mass: p.mass }));
    state.medium = stepArenaMediumFromState(state.medium, state.ships, state.debris, pMedium, inputs.anomalies, state.asteroidDiscs, tick);
    // 5d. Exhaust/plume particles: step the live plume (transport + cool + cull)
    //     and gather this tick's emissions — no RNG, deterministic.
    state.particles = stepPlume(state.particles, state.ships, state.beams, state.projectiles);
    // Capture descriptors for new instances (break-away chunks, launched phantoms).
    captureDescriptors(state.ships);
    yield snapshot(tick, state.ships, state.projectiles, awareness, state.mines, state.pods, state.pulses, state.emissions, state.debris, state.beams, state.particles, state.medium);
    state.ticks += 1;

    // 6. Termination. Only real ships decide the battle — a side whose hulls
    //    are all gone loses even if its drones are still in the air.
    const attackerAlive = state.attackers.some((s) => s.alive && s.phantom === undefined);
    const defenderAlive = state.defenders.some((s) => s.alive && s.phantom === undefined);
    if (!attackerAlive && !defenderAlive) {
      state.winner = "draw";
      state.resolved = true;
      break;
    }
    if (!attackerAlive) {
      state.winner = "defender";
      state.resolved = true;
      break;
    }
    if (!defenderAlive) {
      state.winner = "attacker";
      state.resolved = true;
      break;
    }

    // 7. No-progress watchdog (uncapped battles only). Runs after the
    //    elimination checks so a decisive kill always wins over a stalemate
    //    call. STALEMATE_IDLE_TICKS ticks with no progress means neither side
    //    can finish the other — decide it on remaining HP.
    if (
      stalemate !== undefined &&
      tickStalemateWatch(stalemate, state.ships, state.attackers, state.defenders, state.mines, STALEMATE_IDLE_TICKS)
    ) {
      state.winner = leadingSide(state.attackers, state.defenders);
      state.resolved = true;
      break;
    }

    // 8. Checkpoint emission (resume support). Capture an end-of-tick checkpoint
    //    on the requested cadence, AFTER the frame is yielded and the termination
    //    checks have run — so a checkpoint is only ever taken for a tick the
    //    battle survived. The capture reads the live EngineState, the RNG
    //    position, and the stalemate watch, so resuming reproduces the tail
    //    byte-identically. Skipped unless both `checkpointEvery` and
    //    `onCheckpoint` are set, so the no-options path is zero-cost.
    if (emitCheckpoint !== undefined) emitCheckpoint(tick);
  }

  // Hit an explicit `maxTicks` early-stop without a decisive end (focused tests
  // only): decide by remaining hit points, as the watchdog would.
  if (!state.resolved) {
    state.winner = leadingSide(state.attackers, state.defenders);
  }

  return {
    winner: state.winner,
    ticks: state.ticks,
    descriptors: sortedDescriptors(descriptors),
    // Per-ship salvage earned over the battle, in instanceId order.
    salvage: summariseSalvage(state.ships),
  };
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
      anomalies: inputs.anomalies,
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
    // Static per-ship cell layout + outline (renderer derives cell positions).
    descriptors: summary.descriptors,
    // Per-ship salvage earned, omitted when nothing was salvaged.
    ...(summary.salvage.length > 0 ? { salvage: summary.salvage } : {}),
  };
}
