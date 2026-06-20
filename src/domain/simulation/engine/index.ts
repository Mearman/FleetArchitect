/**
 * The battle tick loop and the two public entry points (`runBattle`,
 * `simulateBattle`). Re-exports `comTangentialVelocity`. Resets
 * `projectileCounter` at the start of each battle so two same-seed runs
 * produce byte-identical projectile ids.
 */

import { createId, nowIso } from "@/domain/id";
import { CELL_SIZE } from "@/domain/grid";
import { mulberry32 } from "@/domain/simulation/rng";
import { computeOccluders } from "@/domain/occluders";
import type { AwarenessSnapshot, BattleFrame, BattleResult, BattleSide } from "@/schema/battle";
import type { BattleInputs, BattleSummary, SimCrew } from "../types";

import { computeAwareness } from "./awareness";
import { stepAi } from "./ai-step";
import { launchPods, updatePods } from "./boarding";
import { buildShipCellHash, resolveShipCollisions } from "./collision";
import { SIM, resetProjectileCounter } from "./config";
import { updateCrew } from "./crew";
import { refillHardwiredAmmo } from "./crew-haul";
import { crewCellKey } from "./crew-pathfinding";
import { splitBreakApart } from "./damage";
import { layMines, stepTechCooldowns, updateMines } from "./mines";
import type { DeploymentReference } from "./movement";
import { fleetCentroid, moveShips } from "./movement";
import { launchDecoys, launchDrones, stepPhantoms } from "./phantoms";
import { hasAliveCommand, recomputeAggregates } from "./physics";
import { resourceStep } from "./resource-step";
import { toSimShip } from "./setup";
import { electFocusTarget, pickTarget } from "./targeting";
import { applyBlink, applyCommandAuras, stepOvercharge } from "./tech";
import type { SimMine, SimModule, SimPod, SimProjectile, SimShip } from "./types";
import { fireWeapons, updateProjectiles } from "./weapons";

export { comTangentialVelocity } from "./physics";

/**
 * Pure deterministic battle simulation. Yields one BattleFrame per tick —
 * the tick-0 frame first, then one per simulated tick in order — and returns
 * the outcome summary once the run terminates. Contains all the simulation
 * logic; it performs no id generation, timestamping, or config assembly, so
 * the same inputs yield byte-identical frames on every run. `runBattle` wraps
 * this generator to build a replayable BattleResult.
 */
export function* simulateBattle(
  inputs: BattleInputs,
): Generator<BattleFrame, BattleSummary> {
  const rng = mulberry32(inputs.seed >>> 0);
  resetProjectileCounter();
  const ships = inputs.ships.map((s) => toSimShip(s, rng));
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

  // Occluders are a pure function of (anomaly, seed): compute them once here
  // (drawing from a salted, separate rng inside computeOccluders, never the
  // battle rng) and reuse the same array for every tick's awareness phase and
  // every snapshot. This keeps the awareness phase from touching the battle rng.
  const occluders = computeOccluders(inputs.anomaly, inputs.seed >>> 0);

  // Frame 0: run the awareness phase once so the opening snapshot carries the
  // same fog-of-war data every later frame does, and so each ship's `awareness`
  // is populated before the first targeting pass below.
  const frame0Awareness = computeAwareness(ships, byId, occluders, inputs.anomaly);

  // Number of post-initial frames yielded, matching the previous
  // `frames.length - 1`: the tick-0 frame is excluded from the count.
  let ticks = 0;
  yield snapshot(0, ships, projectiles, frame0Awareness, mines, pods);

  let winner: BattleSide = "draw";
  let resolved = false;

  for (let tick = 1; tick <= inputs.maxTicks; tick++) {
    // 0. Awareness phase (sensors, comms, fog of war). Runs first so the
    //    targeting pass below reads each ship's freshly computed `awareness`.
    //    Pure function of ship state + the pre-computed occluders + anomaly;
    //    draws ZERO times from the battle rng. The returned snapshot is recorded
    //    on this tick's frame at the end of the loop body.
    const awareness = computeAwareness(ships, byId, occluders, inputs.anomaly);
    // 0. Refresh the per-side ship lists and id index from the live `ships`
    //    array so they include phantoms (drones/decoys) and break-away chunks
    //    added on a previous tick. Phantoms are full SimShips, so the targeting,
    //    projectile and damage pipelines strike them without special-casing.
    attackers = ships.filter((s) => s.side === "attacker");
    defenders = ships.filter((s) => s.side === "defender");
    byId = new Map(ships.map((s) => [s.instanceId, s]));

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
    //     other. All sides are solid — friendlies collide too.
    resolveShipCollisions(buildShipCellHash(ships));

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
    projectiles = projectiles.concat(fireWeapons(ships, byId, rng, tick));

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

    // 4b-resource. Resource & environment step (Phase 12 wiring, use-deferred).
    //     Advance each ship's thermal, propellant, atmosphere, and power state
    //     one tick so the honest underlying simulation runs underneath the
    //     gameplay layer. Runs after crew (so the atmosphere substance reads
    //     settled crew positions) and before break-apart (so a chunk inherits a
    //     resource state in the next pass). No consequence is enforced — no
    //     overheat shutdown, brownout, asphyxiation, or dry-tank derelict. A
    //     no-op for ships with no resource state (legacy aggregated path and
    //     phantoms), so byte output is unchanged for them.
    for (const ship of ships) {
      if (!ship.alive) continue;
      resourceStep(ship);
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

    // 4c. Break-apart: if the alive modules on a modular ship no longer
    //     form a single connected graph, split the disconnected pieces
    //     into fresh SimShips. Each chunk gets its own `brokeOff` flag
    //     for the UI to highlight the split. Done after aggregates so
    //     chunks inherit their own recomputed stats.
    const newChunks: SimShip[] = [];
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
        ship.shieldRegenCountdown -= 1;
      } else {
        // Effective rate ramps with the untouched streak for an adaptive shield,
        // capped at `adaptiveShieldMaxMultiple` times the base rate; a
        // conventional shield (ramp 0) keeps its flat base rate exactly.
        const rampMultiple = Math.min(
          SIM.adaptiveShieldMaxMultiple,
          1 + ship.shieldAdaptiveRamp * ship.shieldUntouchedTicks,
        );
        ship.shield = Math.min(
          ship.maxShield,
          ship.shield + ship.shieldRechargeRate * rampMultiple * regenFactor,
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
        target.hp = Math.min(target.maxHp, target.hp + healer.repairRate);
      }
    }

    yield snapshot(tick, ships, projectiles, awareness, mines, pods);
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

  return { winner, ticks };
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

export function snapshot(
  tick: number,
  ships: readonly SimShip[],
  projectiles: readonly SimProjectile[],
  awareness: AwarenessSnapshot,
  mines: readonly SimMine[],
  pods: readonly SimPod[],
): BattleFrame {
  // Partition real ships from phantoms (drones/decoys) so phantoms never appear
  // in the `ships` array — they render from their own dedicated arrays instead.
  const realShips = ships.filter((s) => s.phantom === undefined);
  const drones = ships.filter((s) => s.phantom?.kind === "drone" && s.alive);
  const decoys = ships.filter((s) => s.phantom?.kind === "decoy" && s.alive);
  return {
    tick,
    awareness,
    ships: realShips.map((s) => {
      const base = {
        instanceId: s.instanceId,
        side: s.side,
        x: s.x,
        y: s.y,
        vx: s.velX,
        vy: s.velY,
        facing: s.facing,
        outline: s.outline,
        structure: s.structure,
        shield: s.shield,
        alive: s.alive,
        // Record the split frame, then clear so subsequent snapshots
        // don't carry a stale "freshly broken" marker.
        ...(s.brokeOff === true ? { brokeOff: true } : {}),
        // Centre of mass in ship-local coordinates. Omitted when at the
        // origin so legacy replays stay byte-compatible with pre-rigid-body
        // recordings; modular ships with offset CoM always emit it.
        ...(s.comX !== 0 || s.comY !== 0 ? { comX: s.comX, comY: s.comY } : {}),
        // Current targeting decision (the instance id of the ship this ship is
        // aiming at this tick, or undefined when it has no live target). Emitted
        // from the deterministic pickTarget result so frame determinism is
        // preserved; omitted when there is no target so frames recorded before
        // this field stay byte-identical.
        ...(s.target !== undefined ? { targetId: s.target } : {}),
      };
      if (s.brokeOff === true) s.brokeOff = false;
      if (s.modules === undefined) return base;
      const withModules = {
        ...base,
        modules: s.modules.map((m) => ({
          slotId: m.slotId,
          kind: m.kind,
          x: m.x,
          y: m.y,
          surface: m.surface,
          surfaceHp: m.surfaceHp,
          maxSurfaceHp: m.maxSurfaceHp,
          hp: m.hp,
          maxHp: m.maxHp,
          alive: m.alive,
          // Emit the live barrel angle for turrets so the renderer can draw
          // the barrel tracking the target. Omitted on fixed mounts and
          // non-weapon cells (their barrel always points along the mount
          // facing) to keep legacy replays byte-compatible.
          ...(m.turretTurnRate > 0 ? { turretAngle: m.turretAngle } : {}),
          // Manning state — only emitted for stations that need crew, so
          // crewless cells stay byte-identical to pre-crew replays.
          ...(m.crewRequired > 0 ? { manned: m.manned } : {}),
          // Remaining rounds — only for weapons with a finite local magazine
          // (an ammoCapacity); unlimited weapons and non-weapons omit it.
          ...(m.effect.kind === "weapon" && m.effect.ammoCapacity !== undefined
            ? { ammo: m.ammo }
            : {}),
          // Local charge buffer — only for power-drawing modules; draw-free
          // cells omit it so simple designs stay byte-compatible.
          ...(m.powerDraw > 0 ? { charge: m.charge } : {}),
        })),
      };
      // Crew positions and state, in ship-local coordinates. Each crew member
      // sits on the cell of the module at its (col, row); that module's x/y is
      // the cell's ship-local centre, plus the fractional render offset. Omitted
      // when the ship carries no crew so crewless replays stay byte-compatible.
      if (s.crew === undefined || s.crew.length === 0) return withModules;
      const moduleByCell = new Map<string, SimModule>();
      for (const m of s.modules) moduleByCell.set(crewCellKey(m.col, m.row), m);
      return {
        ...withModules,
        crew: s.crew.map((c) => {
          const cell = moduleByCell.get(crewCellKey(c.col, c.row));
          const cx = cell !== undefined ? cell.x : 0;
          const cy = cell !== undefined ? cell.y : 0;
          return {
            id: c.id,
            x: cx + c.ox * CELL_SIZE,
            y: cy + c.oy * CELL_SIZE,
            state: crewState(c),
            hp: c.hp,
            ...(c.carrying !== undefined ? { carrying: c.carrying } : {}),
          };
        }),
      };
    }),
    projectiles: projectiles.map((p) => ({ id: p.id, x: p.x, y: p.y, kind: p.kind })),
    // Deployed mines (factions update). Omitted when none are live so frames
    // for battles without mine-layers stay byte-identical to baseline.
    ...(mines.length > 0
      ? {
          mines: mines.map((mine) => ({
            instanceId: mine.id,
            side: mine.side,
            x: mine.x,
            y: mine.y,
            armed: mine.armingLeft <= 0,
          })),
        }
      : {}),
    // In-flight boarding pods (factions update). Omitted when none are live so
    // frames for battles without boarding modules stay byte-identical to baseline.
    ...(pods.length > 0
      ? {
          pods: pods.map((pod) => ({
            instanceId: pod.id,
            side: pod.side,
            x: pod.x,
            y: pod.y,
            targetId: pod.targetInstanceId,
          })),
        }
      : {}),
    // Active drones (factions update). Omitted when none are live.
    ...(drones.length > 0
      ? {
          drones: drones.map((s) => ({
            instanceId: s.instanceId,
            ownerId: s.phantom?.ownerId ?? "",
            side: s.side,
            x: s.x,
            y: s.y,
            facing: s.facing,
            hp: s.structure,
            maxHp: s.maxStructure,
            alive: s.alive,
          })),
        }
      : {}),
    // Active decoys (factions update). Omitted when none are live.
    ...(decoys.length > 0
      ? {
          decoys: decoys.map((s) => ({
            instanceId: s.instanceId,
            ownerId: s.phantom?.ownerId ?? "",
            side: s.side,
            x: s.x,
            y: s.y,
            hp: s.structure,
            ticksLeft: s.phantom?.ticksLeft ?? 0,
          })),
        }
      : {}),
  };
}

/**
 * Map a crew member's internal job to the snapshot's state enum the renderer
 * reads. A walking member (one with steps left on its path) shows as `walking`
 * regardless of job; an arrived hauler shows as `hauling`; an arrived gunner as
 * `manning`; an idle member as `idle`. Injury is reserved for a future damage
 * model — crew hp is emitted but not yet reduced, so `injured` is unused here.
 */
export function crewState(crew: SimCrew): "idle" | "walking" | "manning" | "hauling" | "injured" {
  if (crew.path.length - crew.pathIndex > 0) return "walking";
  if (crew.job === "haulAmmo" || crew.job === "haulPower") return "hauling";
  if (crew.job === "manning") return "manning";
  return "idle";
}
