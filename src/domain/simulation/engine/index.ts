/**
 * The battle tick loop and the two public entry points (`runBattle`,
 * `simulateBattle`). Re-exports `comTangentialVelocity`. Resets
 * `projectileCounter` at the start of each battle so two same-seed runs
 * produce byte-identical projectile ids.
 */

import { createId, nowIso } from "@/domain/id";
import { mulberry32 } from "@/domain/simulation/rng";
import { computeOccluders } from "@/domain/occluders";
import type { Disc } from "@/domain/occluders";
import { hasAnomaly } from "@/domain/anomaly";
import type { BattleFrame, BattleResult, ShipDescriptor } from "@/schema/battle";
import type { BattleInputs, BattleSummary } from "../types";
import { buildShipRoster, TICKS_PER_SECOND } from "../types";

import { computeAwareness } from "./awareness";
import { stepAi } from "./ai-step";
import { stepFormationDoctrine } from "./formation-doctrine";
import { buildFormationTargetingContext } from "./formation-targeting";
import { rebuildEmissions } from "./em-reception";
import { launchPods, updatePods } from "./boarding";
import { applyCollisionDamage, buildShipCellHash, resolveShipCollisions } from "./collision";
import { SIM } from "./config";
import { bootstrapEngine } from "./bootstrap";
import { captureCheckpoint } from "./checkpoint";
import type { EngineCheckpoint } from "@/schema/checkpoint";
import { leadingSide } from "./outcome";
import { stepArenaMediumFromState } from "./medium-setup";
import { collectMediumEmissions } from "./medium-emissions";
import { ageBeams } from "./beams";
import { stepPlume } from "./particle-sources";
import { updateCrew } from "./crew";
import { refillHardwiredAmmo } from "./crew-haul";
import { resourceStep } from "./resource-step";
import { spawnDebris, stepDebris } from "./debris";
import { claimHulls, collectDebris, isClaimed, summariseSalvage } from "./salvage";
import { resolveChainReactions } from "./chain-reaction";
import { splitBreakApart } from "./damage";
import { applyImpact } from "./damage-impact";
import { debrisImpactProfile } from "./impact-profile";
import { layMines, stepTechCooldowns, updateMines } from "./mines";
import { moveShips } from "./movement";
import { launchDecoys, launchDrones, stepPhantoms } from "./phantoms";
import { stepPulses } from "./pulse-step";
import { aggregatesChanged } from "./aggregates-fingerprint";
import { hasAliveCommand, hasAliveReactor, recomputeAggregates } from "./physics";
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
  // cold start or `checkpoint.tick + 1` on resume.
  const bootstrap = bootstrapEngine(inputs, rng, resumeFrom);
  const state = bootstrap.state;
  const startTick = bootstrap.startTick;

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

  // Frame 0: the cold-start prologue only. On resume it does not run again
  // (frame 0 was yielded) — re-running would diverge from a fresh run's tail.
  if (resumeFrom === undefined) {
    // Frame 0: run the awareness phase once so the opening snapshot carries the
    // same fog-of-war data every later frame does, and so each ship's `awareness`
    // is populated before the first targeting pass below. The medium-cell
    // emissions are collected once and shared between `computeAwareness` (the
    // reception pass) and `rebuildEmissions` (the snapshot log) — same array,
    // same row-major order, byte-identical to each building its own copy.
    const frame0MediumEmissions = collectMediumEmissions(state.medium);
    const frame0Awareness = computeAwareness(state.ships, state.byId, occluders, inputs.anomalies, state.medium, 0, frame0MediumEmissions);
    // Record the frame-0 EM emission log alongside the awareness it produced. The
    // monotonic counter threads from its initial value through every later tick.
    state.emissionSeq = rebuildEmissions(state.ships, state.emissions, 0, state.emissionSeq, state.medium, undefined, frame0MediumEmissions);

    captureDescriptors(state.ships);
    yield snapshot(0, state.ships, state.projectiles, frame0Awareness, state.mines, state.pods, state.pulses, state.emissions, state.debris, state.beams, state.particles, state.medium);
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
            onCheckpoint(captureCheckpoint(state, rng, tick));
          }
        }
      : undefined;

  // The reactor-loss stalemate breaker's no-progress counter lives on EngineState
  // (state.ticksSinceLastDeath) so the checkpoint captures it and a resumed run
  // reaches the 1200-tick threshold at the same absolute tick as the cold run.

  for (let tick = startTick; inputs.maxTicks === undefined || tick <= inputs.maxTicks; tick++) {
    // 0. Awareness phase (sensors, comms, fog of war). Runs first so the
    //    targeting pass below reads each ship's freshly computed `awareness`.
    //    Pure function of ship state + occluders + anomaly; draws ZERO times
    //    from the battle rng. The returned snapshot is recorded on this tick's
    //    frame at the end of the loop body.
    //
    //    Dynamic occluders: static anomaly occluders are pre-computed once, but
    //    debris fragments change every tick. Rebuild by clearing the pooled
    //    scratch and pushing the static occluders then one Disc per debris
    //    fragment (radius → r). When there is no debris the static array is used
    //    directly. The static array is never mutated.
    let dynamicOccluders: readonly Disc[] = occluders;
    if (state.debris.length > 0) {
      const occluderScratch = state.dynamicOccluderScratch;
      occluderScratch.length = 0;
      for (const o of occluders) occluderScratch.push(o);
      for (const d of state.debris) {
        if (d === undefined) continue;
        occluderScratch.push({ x: d.x, y: d.y, r: d.radius });
      }
      dynamicOccluders = occluderScratch;
    }
    // Medium-cell emissions: a pure function of `state.medium`, computed once
    // and shared between `computeAwareness` and `rebuildEmissions` (medium is
    // unchanged between them) — byte-identical to each building its own copy.
    const mediumEmissions = collectMediumEmissions(state.medium);
    // Alive-real-sorted producer (U15): the alive, non-phantom, instanceId-sorted
    // ship list, built once here into the pooled scratch. Read by
    // `rebuildEmissions` and `aliveAtTickStart` (no ship can die between this
    // build and those reads). The debris hazard later in the tick refreshes the
    // buffer in place — post-collision deaths can shrink the alive set by then.
    const aliveRealSorted = state.aliveRealSortedScratch;
    aliveRealSorted.length = 0;
    for (const s of state.ships) {
      if (s.alive && s.phantom === undefined) aliveRealSorted.push(s);
    }
    aliveRealSorted.sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
    const awareness = computeAwareness(state.ships, state.byId, dynamicOccluders, inputs.anomalies, state.medium, tick, mediumEmissions, state.awarenessScratch);
    // 0a. Record the continuous EM emission log for this tick (Phase 9), behind
    //     the monotonic emission counter. Rebuilt from scratch each tick. The
    //     alive-real-sorted list and medium emissions are threaded in from the
    //     producer above (same contents + order; byte-identical).
    state.emissionSeq = rebuildEmissions(state.ships, state.emissions, tick, state.emissionSeq, state.medium, aliveRealSorted, mediumEmissions);
    // 0. Refresh the per-side ship lists and id index from the live `ships`
    //    array so they include phantoms (drones/decoys) and break-away chunks
    //    added on a previous tick. Incremental: membership only grows and ships
    //    never change side, so the rebuild runs only when the count changed
    //    (see ./roster.ts).
    refreshRosterIncremental(state);

    // 0a-debris. Record which real ships are alive entering this tick, so the
    //     debris step can spawn wreckage for exactly the ships that died this
    //     tick. Phantoms leave no debris. Built from the pooled alive-real-sorted
    //     list into the pooled Set — no per-tick allocation.
    const aliveAtTickStart = state.aliveAtTickStartScratch;
    aliveAtTickStart.clear();
    for (const s of aliveRealSorted) aliveAtTickStart.add(s.instanceId);

    // 0b. Active-radar pulse field (Phase 8). Each active-mode sensor emits a
    //     light-speed pulse; live pulses expand by c and scatter reflections off
    //     enemies they sweep across; a reflection that has completed its round
    //     trip writes a light-lagged contact onto the emitter's freshly computed
    //     awareness (hence after computeAwareness, before targeting reads it).
    //     Opt-in: a no-op (array stays empty) for a battle with no active sensor,
    //     so byte output is unchanged for passive-only fleets.
    state.pulseSeq = stepPulses(state.ships, state.byId, state.pulses, inputs.anomalies, tick, state.pulseSeq);

    // 0c. AI interpreter (Phase 7 wiring). Evaluate each ship's stance + rules
    //     and write the hold-fire decision onto `aiHoldFire` (read by the
    //     weapon-fire step). Runs after awareness and before targeting. Pure:
    //     deterministic ship order, pure predicates, first-match rule wins. A
    //     ship with no rules evaluates to holdFire=false.
    stepAi(state.ships, state.byId);
    // 0d. Formation-doctrine pass. Evaluates unified rules whose conditions are
    //     formation/spatial/temporal/boolean kinds (the kinds `stepAi` leaves
    //     unsatisfied), writing the resolved axes onto `ai*` fields. GATED to a
    //     no-op for fleets with no formation condition, so presets are byte-identical.
    stepFormationDoctrine(state.ships, state.byId, tick, state.deployment, state.points);

    // 1. Targeting. Phase D: build the formation-targeting context once per tick
    //    so an `aiTargeting` override can filter/score candidates by relational
    //    mode. Harmless for presets (identity filter).
    const formationTargeting = buildFormationTargetingContext(state.ships, state.byId);
    // Elect focus-fire targets once per tick per side, outside the per-ship loop
    // so every ship on a side sees the same fleet target this tick.
    const attackerFocusTarget = electFocusTarget("attacker", state.ships, state.defenders, tick, formationTargeting);
    const defenderFocusTarget = electFocusTarget("defender", state.ships, state.attackers, tick, formationTargeting);
    for (const ship of state.ships) {
      if (!ship.alive) continue;
      if (isClaimed(ship)) {
        ship.target = undefined;
        continue;
      }
      const enemies = ship.side === "attacker" ? state.defenders : state.attackers;
      const focusTarget =
        ship.side === "attacker" ? attackerFocusTarget : defenderFocusTarget;
      ship.target = pickTarget(ship, enemies, focusTarget, tick, formationTargeting, state.byId)?.instanceId;
    }

    // 1b. Tech timers (factions update). Advance every movement/power tech
    //     module's active-window and cooldown counters one tick, then fire any
    //     ready blink drive (teleporting the hull before movement runs, so the
    //     jumped-to position is where the ship thrusts from this tick). Fused
    //     into one per-ship pass: `stepTechCooldowns` writes only timer fields
    //     (no positions), and `applyBlink` reads other ships' positions — not
    //     their timers — so interleaving is byte-identical to the prior two-pass
    //     all-timers-then-all-blink form (within-array blink order is unchanged).
    //     Opt-in: a ship with no tech modules is untouched.
    for (const ship of state.ships) {
      if (!ship.alive) continue;
      stepTechCooldowns(ship);
      applyBlink(ship, state.byId, state.ships);
    }

    // 2. Movement + facing.
    moveShips(state.ships, state.byId, inputs.anomalies, state.deployment, SIM.defaultRange, state.medium, tick, state.points, state.separationHashScratch);

    // 2b. Ship-vs-ship collision at cell granularity. After movement, any two
    //     ships whose cells now overlap are pushed apart with an elastic
    //     impulse plus positional separation, so ships can't drive through each
    //     other. All sides are solid — friendlies collide too. The resolved
    //     contacts feed the kinetic-damage step below.
    const cellHash = buildShipCellHash(state.ships, state.shipCellHashScratch);
    const shipContacts = resolveShipCollisions(cellHash, state.collisionScratch);

    // 2b-kinetic. Kinetic collision damage (realism overhaul, Phase 4). Convert
    //     a fraction of each contact's collision kinetic energy into structural
    //     damage on both ships (Newton's third law), routed through applyDamage.
    //     A no-op tick with no contacts.
    applyCollisionDamage(shipContacts);

    // 2b-debris. Debris kinetic hazard (Phase 12). A drifting fragment whose
    //     bounding disc overlaps a ship transfers kinetic energy
    //     (½·m·v_rel²·damageFraction) through applyDamage (no piercing — wreckage
    //     hits the outer surface; the fragment is not destroyed). Contacts below
    //     SIM.debrisMinRelSpeed are ignored. Debris is advanced one tick later
    //     (4e-debris), so positions are from the previous advance — same relative
    //     order every tick. A no-op until the first ship dies; ships in
    //     instanceId order.
    if (state.debris.length > 0) {
      // Sorted alive-ship list for this debris pass, reusing the pooled
      // alive-real-sorted scratch. Refreshed in place because collision damage
      // at 2b-kinetic may have killed ships since the early-tick build; reading
      // the stale snapshot would iterate dead ships. Byte-identical to the
      // prior filter+sort (same set, same order).
      const aliveShipsSorted = state.aliveRealSortedScratch;
      aliveShipsSorted.length = 0;
      for (const s of state.ships) {
        if (s.alive && s.phantom === undefined) aliveShipsSorted.push(s);
      }
      aliveShipsSorted.sort((a, b) => (a.instanceId < b.instanceId ? -1 : a.instanceId > b.instanceId ? 1 : 0));
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
          // Debris hazard: a pure-momentum impact (sub-light, no relativistic
          // correction). debrisImpactProfile's p²/2m × debrisCollisionDamageFraction
          // = ½·m·v² × fraction, byte-identical to the old scalar damage.
          applyImpact(s, debrisImpactProfile({ massKg: d.mass, relSpeedMps: Math.sqrt(relSpeedSq) }), d.x, d.y);
        }
      }
    }

    // 2c. Command auras (factions update). With positions settled, recompute
    //     each ship's best friendly aura bonus so the firing step reads the
    //     current buff. Opt-in: a no-op for a battle with no command-aura module.
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
    //    The newly fired projectiles are pushed in place onto the existing
    //    array rather than `concat`-allocating a fresh one — same contents,
    //    same order (existing entries preserved, new ones appended), byte-
    //    identical snapshot output.
    for (const p of fireWeapons(state.ships, state.byId, rng, tick, inputs.anomalies, state.beams)) {
      state.projectiles.push(p);
    }

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
    state.projectiles = updateProjectiles(state.projectiles, state.byId, inputs.anomalies, rng, state.medium, state.shipCellHashScratch);

    // 4-mines. Mines (factions update). Arm down, then detonate any armed mine
    //     with an enemy in range against the nearest (via applyDamage). Runs in
    //     the same damage phase so the aggregate recompute below reflects modules
    //     a mine destroyed this tick. A no-op when no mines exist.
    state.mines = updateMines(state.mines, state.ships);

    // 4-pods. Boarding pods (factions update). Home and board on contact,
    //     disabling modules via recomputeAggregates inside boardShip. Runs in
    //     the damage phase so the aggregate recompute below reflects modules a
    //     boarding disabled this tick. A no-op when no pods exist.
    state.pods = updatePods(state.pods, state.ships);

    // 4-phantoms. Drones and decoys (factions update). Drones home on the
    //     nearest real enemy and strike it (via applyDamage); decoys count down.
    //     Expired or destroyed phantoms are marked dead in place. A no-op when
    //     no phantoms exist.
    stepPhantoms(state.ships);

    // 4a-chain. Explosive chain reactions (realism overhaul, Phase 4). A
    //     volatile module (reactor / magazine) reduced to zero HP this tick
    //     detonates, dealing radial damage and chaining into further volatile
    //     cells. Drained to completion before the aggregate recompute below, so
    //     a breach is reflected in the same frame. A no-op for a ship that lost
    //     no volatile module.
    for (const ship of state.ships) {
      if (ship.modules !== undefined) resolveChainReactions(ship, state.ships);
    }

    // 4b. Recompute aggregate stats from the alive module set, so a module
    //     destroyed this tick (hitscan or projectile) is reflected in the
    //     shield pool, thrust, and weapon list before regen and the snapshot.
    //     Skipped when `aggregatesChanged` reports no aggregate-relevant input
    //     has moved since the last recompute — an unchanged hash means every
    //     tracked flag equals its prior value, so a re-run would produce
    //     identical aggregates. The overcharge and break-apart sites below still
    //     run unconditionally on their own triggers (and move next tick's hash).
    for (const ship of state.ships) {
      if (ship.modules !== undefined && aggregatesChanged(ship)) recomputeAggregates(ship);
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

    // 4b-crew/ammo. Crew AI + movement, then ammo-conduit refill — fused into a
    //     single per-ship pass because both are fully per-ship, so interleaving
    //     is byte-identical to the prior two-pass form. After aggregates settle
    //     `powered`, crew walk one cell toward an under-manned station and
    //     `manned` is recomputed (before break-apart so splits partition crew by
    //     post-move cell); then conduit-fed weapons refill from their magazine,
    //     dividing each magazine across its sinks at crew-deposit latency. A
    //     no-op on designs with no crew / no ammo hardwires.
    for (const ship of state.ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      updateCrew(ship);
      refillHardwiredAmmo(ship);
    }

    // 4b-resource. Resource & environment step (Phase 12). Advance thermal,
    //     propellant, atmosphere, and power one tick, then enforce consequences:
    //     dry-tank flame-out, brownout load-shedding, overheat module destruction
    //     (asphyxiation/venting inside the step via the airtightness mask). Runs
    //     after crew (atmosphere reads settled positions) and before break-apart,
    //     so an overheat-killed cell splits the hull this same tick. A no-op for
    //     ships with no resource state.
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

    // 4d-reactor. Gate the reactor-loss death rule on no-progress (1200 idle
    //     ticks since the last real-ship death) so it breaks stalemates without
    //     ending active combat prematurely.
    for (const s of state.ships) {
      if (!s.alive && aliveAtTickStart.has(s.instanceId)) { state.ticksSinceLastDeath = -1; break; }
    }
    state.ticksSinceLastDeath += 1;
    if (state.ticksSinceLastDeath >= 1200) {
      for (const ship of state.ships) {
        if (ship.alive && ship.modules !== undefined && !hasAliveReactor(ship)) {
          ship.alive = false;
          ship.structure = 0;
        }
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
    //     at top of loop, dead now) and was genuinely destroyed rather than
    //     split into chunks (break-apart carried that mass into its chunks, so
    //     those deaths are excluded). The fragment inherits the ship's COM
    //     velocity (Newton's first law), no breakup kick (no deterministic
    //     direction without rng). Wreckage mass is a fraction of the hull's BUILT
    //     structural mass — every cell's mass, alive or destroyed (`ship.mass`
    //     counts only alive; legacy non-modular falls back to per-class). Spawned
    //     in lexicographic id order behind the monotonic debris counter, then every debris drifts one tick.
    // `ticksSinceLastDeath === 0` here means a monitored death fired this tick
    // (set to -1 above then incremented); otherwise skip the full-list scan.
    const deadPool = state.ticksSinceLastDeath === 0 ? state.ships : [];
    const newlyDead = deadPool
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
      // Adaptive shields: ticks since last touched (a hit reset it to 0 in
      // applyDamage); bounded by the ramp's cap, read only by the regen below.
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
        // Rate ramps with the untouched streak (capped), scaled by dilationFactor;
        // shieldRechargeRate is watts → /TICKS_PER_SECOND gives joules-per-tick.
        const rampMultiple = Math.min(SIM.adaptiveShieldMaxMultiple, 1 + ship.shieldAdaptiveRamp * ship.shieldUntouchedTicks);
        const rechargeJoulesThisTick =
          (ship.shieldRechargeRate / TICKS_PER_SECOND) * rampMultiple * regenFactor * ship.dilationFactor;
        ship.shield = Math.min(ship.maxShield, ship.shield + rechargeJoulesThisTick);
      }
    }

    // 5a-deflector. Deflector (momentum screen) regen; mirrors shield regen, no adaptive ramp, inert while maxDeflector is 0.
    for (const ship of state.ships) {
      if (!ship.alive || ship.deflector >= ship.maxDeflector) continue;
      if (ship.deflectorRegenCountdown > 0) {
        ship.deflectorRegenCountdown -= ship.dilationFactor;
      } else {
        const recharge = (ship.deflectorRechargeRate / TICKS_PER_SECOND) * ship.dilationFactor;
        ship.deflector = Math.min(ship.maxDeflector, ship.deflector + recharge);
      }
    }

    // 5b. Module repair: each alive repair module heals the first damaged
    //     alive module in array order (dilation-scaled).  First-damaged
    //     index pre-computed per ship, advanced on heal-to-full.
    for (const ship of state.ships) {
      if (!ship.alive || ship.modules === undefined) continue;
      const mods = ship.modules;
      const find = (from: number): number => {
        for (let i = from; i < mods.length; i++) { const m = mods[i]; if (m !== undefined && m.alive && m.hp < m.maxHp) return i; }
        return -1;
      };
      let di = find(0);
      for (const healer of mods) {
        if (!healer.alive || healer.repairRate <= 0 || di === -1) continue;
        const target = mods[di]; if (target === undefined) break;
        target.hp = Math.min(target.maxHp, target.hp + healer.repairRate * ship.dilationFactor);
        if (target.hp >= target.maxHp) di = find(di + 1);
      }
    }

    // 5c. Arena medium: per-tick sources, then diffuse and decay. `tick` seeds
    //     the per-cell birthTicks the sustained-radiation startup light-lag gates.
    //     The projectile-medium entries are cleared and refilled into the pooled
    //     scratch each tick (no `.map` allocation) — same entries, same order.
    const pMedium = state.projectileMediumScratch;
    pMedium.length = 0;
    for (const p of state.projectiles) {
      pMedium.push({ x: p.x, y: p.y, powered: p.powered, burnTicks: p.burnTicks, thrust: p.thrust, mass: p.mass });
    }
    state.medium = stepArenaMediumFromState(state.medium, state.ships, state.debris, pMedium, inputs.anomalies, state.asteroidSourceCells, tick);
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

    // 7. Checkpoint emission (resume support). Capture an end-of-tick checkpoint
    //    on the requested cadence, AFTER the frame is yielded and the termination
    //    checks have run — so a checkpoint is only ever taken for a tick the
    //    battle survived. The capture reads the live EngineState and the RNG
    //    position, so resuming reproduces the tail byte-identically. Skipped
    //    unless both `checkpointEvery` and `onCheckpoint` are set, so the
    //    no-options path is zero-cost.
    if (emitCheckpoint !== undefined) emitCheckpoint(tick);
  }

  // Hit an explicit `maxTicks` early-stop without a decisive end (focused tests
  // only): decide by remaining hit points.
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
    roster: buildShipRoster(inputs.ships),
    // Static per-ship cell layout + outline (renderer derives cell positions).
    descriptors: summary.descriptors,
    // Per-ship salvage earned, omitted when nothing was salvaged.
    ...(summary.salvage.length > 0 ? { salvage: summary.salvage } : {}),
  };
}
