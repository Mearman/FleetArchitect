/**
 * Target selection: building the visible-enemy candidate set, scoring, the
 * per-ship pick, and the fleet-wide focus-fire election.
 *
 * Scoring split (U5): the priority/distance normalisation extrema (min/max of
 * the raw score and of distance-squared over the living set) are precomputed
 * ONCE per (ship, living-set) and threaded into {@link scoreEnemy} as a lazy
 * resolver, rather than recomputed for every candidate scored. `pickTarget`
 * scores K candidates and previously re-ran the O(K) extrema scan inside every
 * `scoreEnemy` call — O(K^2) per ship per tick off the fast path. Two
 * first-class implementations share the scoring core ({@link scoreEnemyImpl}),
 * exactly mirroring the `resolveChainReactions` / `resolveChainReactionsReference`
 * and `resourceStep` / `resourceStepReference` splits:
 *  - `scoreEnemy`: the production (optimised) path. The caller
 *    (`pickTarget` / `electFocusTarget`) memoises the extrema scan once and
 *    passes a resolver that returns the cached result, so each `scoreEnemy`
 *    call is O(1) off the fast path.
 *  - `scoreEnemyReference`: the naive (oracle) path, kept as a first-class
 *    implementation the equivalence test
 *    (`engine.targeting.equivalence.unit.test.ts`) compares against the
 *    optimised path. Re-scans the living set on every call — the unoptimised
 *    O(K^2) the optimised path bounds. Not wired into production.
 * Both derive the extrema as a min/max reduction over the same ordered living
 * array, so the floats are bit-identical and the final blend is unchanged.
 */

import { SIM } from "./config";
import { effectiveStance } from "./movement";
import { isDetectable } from "./stealth";
import type { SimShip } from "./types";
import {
  filterVisibleByTargeting,
  pointDefenseBias,
  type FormationTargetingContext,
} from "./formation-targeting";

/**
 * The scalar target priority a ship scores enemies by: the doctrine targeting
 * mode when it is one of the four scalar kinds, else `"nearest"` (the default
 * when no targeting objective is authored). Relational modes —
 * threatsTo/membersOf/etc. — are the formation-aware layer (deferred); a ship
 * with one falls back to `"nearest"` so its scalar scoring is unchanged.
 */
function targetPriorityOf(ship: SimShip): "nearest" | "weakest" | "strongest" | "highestCost" {
  const mode = ship.doctrine.base.targeting?.mode;
  if (mode !== undefined) {
    switch (mode.kind) {
      case "nearest":
      case "weakest":
      case "strongest":
      case "highestCost":
        return mode.kind;
    }
  }
  return "nearest";
}

function vulnerableWeightOf(ship: SimShip): number {
  return ship.doctrine.base.targeting?.vulnerableWeight ?? 0;
}

/**
 * Whether a ship is concentrating fire with its fleet this tick: the live AI
 * decision (`aiFocusFire`, raised by a `focusFire` rule this tick) OR the
 * static doctrine `targeting.focusFire`. A rule-less ship leaves `aiFocusFire`
 * false and reads its doctrine's static flag.
 */
export function wantsFocusFire(ship: SimShip): boolean {
  return (
    ship.aiFocusFire ||
    (ship.doctrine.base.targeting?.focusFire ?? false)
  );
}

/**
 * The view of an enemy a ship's targeting AI is allowed to act on this tick.
 * Either a live contact (the real enemy's current pose and health) or a ghost
 * stand-in (the enemy's last-known position, with its current — still alive —
 * health and cost). Carries exactly the fields `scoreEnemy` reads, so targeting
 * is identical whether it scores a live ship or a remembered ghost position. The
 * `instanceId` is the real enemy's id, so `ship.target` still resolves to a live
 * ship in the firing/movement passes.
 */
export interface EnemyView {
  instanceId: string;
  x: number;
  y: number;
  structure: number;
  shield: number;
  maxStructure: number;
  maxShield: number;
  cost: number;
}

/**
 * The enemies a ship may target this tick: exactly those in its awareness set.
 * A live contact yields a view at the enemy's real current pose; a ghost yields
 * a view at the ghost's last-known position but the enemy's live health/cost
 * (the AI keeps engaging the last fix). Enemies the ship cannot see at all —
 * directly or relayed — are absent, so it never targets or votes for them. Built
 * in awareness-map order then sorted by instanceId for a deterministic scan.
 */
export function visibleEnemyViews(
  ship: SimShip,
  enemies: readonly SimShip[],
  tick: number,
): EnemyView[] {
  const enemyById = new Map(enemies.map((e) => [e.instanceId, e]));
  const views: EnemyView[] = [];
  for (const [enemyId, contact] of ship.awareness) {
    const enemy = enemyById.get(enemyId);
    // The awareness set may name an enemy that has since died or that belongs to
    // the other enemy list (focus election passes a single side's list); only
    // act on a live enemy present in this list.
    if (enemy === undefined || !enemy.alive) continue;
    // Stealth acquisition gate (factions update): even an enemy the ship is
    // aware of (seen via sensors/fog) cannot be locked onto while it is cloaked
    // or beyond the viewer's signature-reduced acquisition range, unless a
    // pierce-cloak sensor defeats the cloak. A target with neither stealth
    // module is always detectable, so a non-stealth battle's visible set — and
    // thus its targeting — is byte-identical to before.
    const distSq = (contact.x - ship.x) ** 2 + (contact.y - ship.y) ** 2;
    if (!isDetectable(ship, enemy, distSq, tick)) continue;
    views.push({
      instanceId: enemy.instanceId,
      // Position comes from the contact (the ghost's last-known x/y, or the
      // live fix which equals the enemy's current position).
      x: contact.x,
      y: contact.y,
      structure: enemy.structure,
      shield: enemy.shield,
      maxStructure: enemy.maxStructure,
      maxShield: enemy.maxShield,
      cost: enemy.cost,
    });
  }
  views.sort((p, q) =>
    p.instanceId < q.instanceId ? -1 : p.instanceId > q.instanceId ? 1 : 0,
  );
  return views;
}

/**
 * The min/max extrema {@link scoreEnemy} normalises against, precomputed once
 * per (ship, living-set) by {@link pickTarget} / {@link electFocusTarget} and
 * threaded in as a lazy resolver. `minRaw`/`maxRaw` bound the raw priority
 * score; `minDistSq`/`maxDistSq` bound distance-squared (the stance-bias term
 * normalises distance over the same set). Both are plain min/max reductions
 * over the ordered living array, so the per-candidate scan in
 * {@link scoreEnemyReference} and the single precompute scan produce
 * bit-identical values — comparisons are exact on finite floats and the
 * reduction over a set is independent of which member seeds it.
 */
export interface TargetingExtrema {
  minRaw: number;
  maxRaw: number;
  minDistSq: number;
  maxDistSq: number;
}

/**
 * Raw priority score (higher = better target) for `enemy` at the given squared
 * distance, for the scalar targeting mode. Extracted so the candidate path and
 * the extrema scan compute it identically — no duplicated switch.
 */
function rawPriorityScore(
  targetPriority: "nearest" | "weakest" | "strongest" | "highestCost",
  enemy: EnemyView,
  distSq: number,
): number {
  switch (targetPriority) {
    case "nearest":
      return -distSq;
    case "weakest":
      return -(enemy.structure + enemy.shield);
    case "strongest":
      return enemy.structure + enemy.shield;
    case "highestCost":
      return enemy.cost;
  }
}

/**
 * The min/max extrema of the raw priority score and of distance-squared over
 * `living`, from `ship`'s perspective. A single O(K) reduction that the
 * reference path re-runs inside every `scoreEnemy` call. Derives the scalar
 * priority from `ship` (so callers need not). Seeds from the first living
 * member then folds every member through the same `<` / `>` comparisons the
 * reference scan uses, so the result is the identical set reduction (min/max
 * over a set is independent of which member seeds it; folding the seed again
 * in the loop is a no-op since `x < x` and `x > x` are both false). Exported so
 * the equivalence test can build the optimised resolver identically to
 * `pickTarget` / `electFocusTarget`.
 */
export function scanExtrema(
  ship: SimShip,
  living: readonly EnemyView[],
): TargetingExtrema {
  const targetPriority = targetPriorityOf(ship);
  const first = living[0];
  if (first === undefined) {
    // scoreEnemy is only ever called with a non-empty living set (the scored
    // candidate is itself a member), so this is unreachable in production.
    // Throw loudly rather than mask a caller bug with a sentinel value.
    throw new Error("scanExtrema: living set must be non-empty");
  }
  const dSq0 = (first.x - ship.x) ** 2 + (first.y - ship.y) ** 2;
  const s0 = rawPriorityScore(targetPriority, first, dSq0);
  let minRaw = s0;
  let maxRaw = s0;
  let minDistSq = dSq0;
  let maxDistSq = dSq0;
  for (const e of living) {
    const dSq = (e.x - ship.x) ** 2 + (e.y - ship.y) ** 2;
    if (dSq < minDistSq) minDistSq = dSq;
    if (dSq > maxDistSq) maxDistSq = dSq;
    const s = rawPriorityScore(targetPriority, e, dSq);
    if (s < minRaw) minRaw = s;
    if (s > maxRaw) maxRaw = s;
  }
  return { minRaw, maxRaw, minDistSq, maxDistSq };
}

/**
 * Shared scoring core. Computes the candidate's raw priority score, then either
 * returns it directly (the fast path — no normalisation, no extrema resolved) or
 * resolves the extrema via `resolveExtrema` and blends them. The ONLY difference
 * between the optimised and reference paths is what `resolveExtrema` does:
 *  - optimised ({@link scoreEnemy}): returns the caller's memoised scan result;
 *  - reference ({@link scoreEnemyReference}): scans `living` on every call.
 *
 * Fast path: when `vulnerableWeight <= 0`, the effective stance contributes no
 * distance bias, and there is no point-defence bias, the score is the raw
 * priority — no normalisation pass, no extrema resolved, so `resolveExtrema` is
 * never called and a preset battle (every candidate on the fast path) is
 * byte-identical to before and pays nothing for the precompute machinery.
 *
 * Slow path: the raw priority score is normalised to [0, 1] across the living
 * set so the blend with the vulnerability score (already in [0, 1]) is
 * dimensionally consistent — otherwise a cost-based score in the thousands
 * would swamp a distance-based score near -1. Vulnerability is
 * `1 - (structure + shield) / (maxStructure + maxShield)`, so a freshly spawned
 * enemy scores 0 and a nearly dead one scores near 1; a zero max-total scores 0.
 * The effective {@link ShipStance} adds a signed near/far preference blended in
 * by the same normalised machinery; a balanced/default stance contributes zero.
 * The `pdPriority` bias is added last so a point-defence ship surfaces phantoms
 * above any real ship regardless of the doctrine/stance blend.
 */
function scoreEnemyImpl(
  ship: SimShip,
  enemy: EnemyView,
  formationCtx: FormationTargetingContext | undefined,
  resolveExtrema: () => TargetingExtrema,
): number {
  const targetPriority = targetPriorityOf(ship);
  const distSq = (enemy.x - ship.x) ** 2 + (enemy.y - ship.y) ** 2;
  const rawScore = rawPriorityScore(targetPriority, enemy, distSq);

  const w = vulnerableWeightOf(ship);
  // Stance bias: a signed near(+)/far(-) preference for the ship's effective
  // stance (its base stance, or an `aiStance` override). Zero for a balanced or
  // default stance, so the fast path is unchanged for rule-less fleets.
  const stanceBias = SIM.stanceTargetDistanceBias[effectiveStance(ship)];
  // Phase D: the `pdPriority` targeting mode adds a positive bias for phantom
  // (drone/decoy) candidates so a point-defence ship prefers them over real
  // ships. Zero for every preset ship (no `aiTargeting` override) and for real
  // enemies, so the fast path is unchanged.
  const pdBias =
    formationCtx !== undefined
      ? pointDefenseBias(ship, enemy.instanceId, formationCtx.byId)
      : 0;
  if (w <= 0 && stanceBias === 0 && pdBias === 0) return rawScore; // fast path

  // Normalise priority score to [0, 1] across the living set so the blend with
  // the vulnerability score (already in [0,1]) is dimensionally consistent.
  // Distance is normalised in the same pass for the stance bias term. The
  // extrema are a min/max reduction over the living set — identical whether
  // computed once here (optimised, via the memoising resolver) or per call
  // (reference), so the normalised values are bit-identical.
  const extrema = resolveExtrema();
  const range = extrema.maxRaw - extrema.minRaw;
  const normPriority = range > 0 ? (rawScore - extrema.minRaw) / range : 1;

  // Vulnerability: fraction of max HP already lost.
  const maxTotal = enemy.maxStructure + enemy.maxShield;
  const curTotal = enemy.structure + enemy.shield;
  const vulnerability = maxTotal > 0 ? 1 - curTotal / maxTotal : 0;

  // Player-doctrine blend: priority vs vulnerability.
  const doctrineScore = (1 - w) * normPriority + w * vulnerability;

  // The PD bias is added last so a point-defence ship surfaces phantoms above
  // any real ship regardless of the doctrine/stance blend.
  if (stanceBias === 0) return doctrineScore + pdBias;

  // Stance preference: normalise distance to [0, 1] (0 = nearest of the set,
  // 1 = farthest), turn it into a near-preference (1 - normDist) so a positive
  // bias favours close targets, then add the signed, weighted term. Both the
  // doctrine score and the near term live in [0, 1], so the bias magnitude
  // (|stanceBias|, in [0, 1]) scales them on the same footing.
  const distRange = extrema.maxDistSq - extrema.minDistSq;
  const normDist = distRange > 0 ? (distSq - extrema.minDistSq) / distRange : 0;
  const nearPreference = 1 - normDist;
  return doctrineScore + stanceBias * nearPreference + pdBias;
}

/**
 * Production (optimised) target score for `enemy` from `ship`'s perspective.
 * Higher is better. The caller memoises the living-set extrema scan once and
 * passes it as `getExtrema`; that resolver is invoked ONLY on the slow path
 * (when the blend is needed), so a preset fast-path battle resolves zero scans.
 * Production runs this path; the equivalence test compares it against
 * {@link scoreEnemyReference}.
 */
export function scoreEnemy(
  ship: SimShip,
  enemy: EnemyView,
  getExtrema: () => TargetingExtrema,
  formationCtx?: FormationTargetingContext,
): number {
  return scoreEnemyImpl(ship, enemy, formationCtx, getExtrema);
}

/**
 * REFERENCE (oracle) target score: the naive per-candidate extrema scan, kept
 * as a first-class implementation the equivalence test compares against the
 * optimised {@link scoreEnemy}. Not wired into production; production runs
 * {@link scoreEnemy}. Scans `living` afresh on every slow-path call — the
 * unoptimised O(K^2) over K candidates the optimised path's memoised precompute
 * bounds to O(K). The scan is the same min/max reduction, so the resolved
 * extrema — and therefore the blended score — are bit-identical to the
 * optimised path.
 */
export function scoreEnemyReference(
  ship: SimShip,
  enemy: EnemyView,
  living: readonly EnemyView[],
  formationCtx?: FormationTargetingContext,
): number {
  return scoreEnemyImpl(ship, enemy, formationCtx, () =>
    scanExtrema(ship, living),
  );
}

/**
 * The visible, filter-surviving candidate set for `ship`'s pick this tick, or
 * `undefined` when nothing is visible. Shared by {@link pickTarget} and
 * {@link pickTargetReference} so the awareness/stealth/relational-filter
 * derivation — everything before the scoring argmax — is identical across the
 * two paths.
 */
function visibleCandidates(
  ship: SimShip,
  enemies: readonly SimShip[],
  tick: number,
  formationCtx: FormationTargetingContext | undefined,
): EnemyView[] | undefined {
  // Visible = enemies in awareness (fog/sensors) AND locked-on (stealth gate),
  // filtered inside `visibleEnemyViews`. A non-stealth battle's candidate set is
  // unchanged, so targeting stays byte-identical for fleets without stealth tech.
  const allVisible = visibleEnemyViews(ship, enemies, tick);
  if (allVisible.length === 0) return undefined;

  // Phase D: apply the relational targeting filter (threatsTo/membersOf/class/
  // inZone/sameAs/none) when the ship has an `aiTargeting` override. Returns
  // the input list unchanged when there is no override (the gate).
  const visible =
    formationCtx !== undefined
      ? filterVisibleByTargeting(ship, allVisible, formationCtx)
      : allVisible;
  return visible.length === 0 ? undefined : visible;
}

/**
 * Pick the best target for `ship` from `enemies`.
 *
 * When `focusTargetId` is defined (non-undefined), the ship is part of a
 * focus-fire group and must pick that target if it is still alive. This lets
 * an entire side concentrate fire on one enemy at a time rather than spreading
 * damage across the fleet.
 *
 * Otherwise the ship scores each living enemy with {@link scoreEnemy} and picks
 * the highest. `vulnerableTargetWeight` blends vulnerability into that score.
 *
 * Awareness gate: the ship may only target an enemy in its own awareness set
 * (live contact or surviving ghost). An empty awareness means it sees nothing
 * and holds fire (returns undefined). The fleet focus target is honoured only
 * when this ship can personally see it; otherwise it falls through to its own
 * gated scoring.
 *
 * Optimisation (U5): the normalisation extrema are memoised once per
 * (ship, living-set) in `cached` and resolved lazily — `getExtrema` is invoked
 * only when `scoreEnemy` takes its slow path, so a preset fast-path battle does
 * zero extrema scans, and a slow-path battle does exactly one scan per pick
 * (O(K) total) instead of one per candidate (O(K^2)).
 */
export function pickTarget(
  ship: SimShip,
  enemies: readonly SimShip[],
  focusTargetId: string | undefined,
  tick: number,
  /** Formation-targeting context (Phase D). When present and the ship carries
   *  an `aiTargeting` override, the visible candidate set is filtered by the
   *  relational mode before scoring. Undefined (or no override) leaves the
   *  candidate set unchanged — the gate that keeps preset battles byte-identical. */
  formationCtx?: FormationTargetingContext,
): EnemyView | undefined {
  const visible = visibleCandidates(ship, enemies, tick, formationCtx);
  if (visible === undefined) return undefined;

  // Focus-fire: defer to the fleet-agreed target, but only if this ship can
  // personally see it AND it survives the relational filter; a target it can't
  // see (or that the filter excludes) falls through to scoring.
  if (wantsFocusFire(ship) && focusTargetId !== undefined) {
    const focus = visible.find((e) => e.instanceId === focusTargetId);
    if (focus !== undefined) return focus;
    // Fleet target not in this ship's awareness — fall through to scoring.
  }

  // Memoise the extrema scan once per (ship, living-set). The resolver is
  // passed into scoreEnemy, which calls it only on the slow path; the fast path
  // (every preset candidate) never invokes it, so `cached` stays undefined and
  // no scan runs.
  let cached: TargetingExtrema | undefined;
  const getExtrema = (): TargetingExtrema => {
    if (cached === undefined) cached = scanExtrema(ship, visible);
    return cached;
  };

  let best: EnemyView | undefined;
  let bestScore = -Infinity;
  for (const enemy of visible) {
    const score = scoreEnemy(ship, enemy, getExtrema, formationCtx);
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

/**
 * REFERENCE (oracle) pick: the naive per-candidate extrema scan, kept as a
 * first-class implementation the equivalence test compares against the optimised
 * {@link pickTarget}. Not wired into production; production runs
 * {@link pickTarget}. Identical to {@link pickTarget} apart from scoring each
 * candidate with {@link scoreEnemyReference} (which re-scans the living set per
 * call) instead of the memoised {@link scoreEnemy} — so the two are
 * byte-identical in result and differ only in the O(K^2) vs O(K) scan count.
 */
export function pickTargetReference(
  ship: SimShip,
  enemies: readonly SimShip[],
  focusTargetId: string | undefined,
  tick: number,
  formationCtx?: FormationTargetingContext,
): EnemyView | undefined {
  const visible = visibleCandidates(ship, enemies, tick, formationCtx);
  if (visible === undefined) return undefined;

  if (wantsFocusFire(ship) && focusTargetId !== undefined) {
    const focus = visible.find((e) => e.instanceId === focusTargetId);
    if (focus !== undefined) return focus;
  }

  let best: EnemyView | undefined;
  let bestScore = -Infinity;
  for (const enemy of visible) {
    const score = scoreEnemyReference(ship, enemy, visible, formationCtx);
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
}

/**
 * The living (non-phantom) enemy candidates and the focus-fire voters for a
 * side, or `undefined` when either set is empty. Shared by
 * {@link electFocusTarget} and {@link electFocusTargetReference} so the
 * candidate/voter derivation is identical across the two paths. Only real ships
 * are focus-election candidates and voters — a fleet should never agree to
 * focus-fire a drone or decoy, and phantoms carry no doctrine.
 */
function focusVotersAndLiving(
  side: "attacker" | "defender",
  ships: readonly SimShip[],
  enemies: readonly SimShip[],
): { living: SimShip[]; voters: SimShip[] } | undefined {
  const living = enemies.filter((e) => e.alive && e.phantom === undefined);
  if (living.length === 0) return undefined;
  const voters = ships.filter(
    (s) => s.alive && s.side === side && wantsFocusFire(s) && s.phantom === undefined,
  );
  if (voters.length === 0) return undefined;
  return { living, voters };
}

/**
 * The instanceId with the highest aggregate score in `totals`, breaking ties in
 * ascending instanceId order. Iterating the sorted candidate ids makes the
 * tie-break explicit and robust (independent of Map insertion order).
 */
function bestFocusId(totals: Map<string, number>): string | undefined {
  let bestId: string | undefined;
  let bestTotal = -Infinity;
  const candidateIds = [...totals.keys()].sort((p, q) =>
    p < q ? -1 : p > q ? 1 : 0,
  );
  for (const id of candidateIds) {
    const total = totals.get(id);
    if (total === undefined) continue;
    if (total > bestTotal) {
      bestTotal = total;
      bestId = id;
    }
  }
  return bestId;
}

/**
 * Elect the fleet-agreed focus-fire target for a side. All living ships on
 * the side with `focusFire = true` vote by scoring each enemy; the enemy with
 * the highest aggregate score wins. Returns `undefined` when no ships have
 * focus-fire enabled or there are no living enemies.
 *
 * Using an aggregate vote rather than a single ship's score makes the choice
 * stable even as ships are destroyed: the fleet converges on the same answer
 * regardless of which ships are alive, as long as at least one focus-fire ship
 * remains on the side.
 *
 * Aggregate score: each voter scores only the enemies in its OWN awareness set,
 * so an enemy no focus-fire ship can see receives no votes and cannot be
 * elected. A voter scores over its own visible set (the same set its individual
 * pickTarget would normalise against), keeping the election consistent with
 * what each voter would pick alone.
 *
 * Optimisation (U5): the normalisation extrema are memoised once per
 * (voter, visible-set) — reset for each voter, since both the ship and its
 * living set change — and resolved lazily, so a voter whose every candidate is
 * on the fast path does zero scans, and a slow-path voter does exactly one scan
 * (O(K) per voter) instead of one per candidate (O(K^2)).
 */
export function electFocusTarget(
  side: "attacker" | "defender",
  ships: readonly SimShip[],
  enemies: readonly SimShip[],
  tick: number,
  /** Formation-targeting context (Phase D). Threaded through so a focus-fire
   *  voter with an `aiTargeting` override applies its relational filter and PD
   *  bias to its scoring. Undefined (or voters with no override) leaves the
   *  election unchanged — the gate. */
  formationCtx?: FormationTargetingContext,
): string | undefined {
  const sets = focusVotersAndLiving(side, ships, enemies);
  if (sets === undefined) return undefined;
  const { living, voters } = sets;

  const totals = new Map<string, number>();
  for (const voter of voters) {
    let visible = visibleEnemyViews(voter, living, tick);
    if (formationCtx !== undefined) {
      visible = filterVisibleByTargeting(voter, visible, formationCtx);
    }
    // Memoise the extrema scan once per (voter, visible-set). Reset for each
    // voter; resolved lazily so a fast-path voter does zero scans.
    let cached: TargetingExtrema | undefined;
    const getExtrema = (): TargetingExtrema => {
      if (cached === undefined) cached = scanExtrema(voter, visible);
      return cached;
    };
    for (const enemy of visible) {
      const s = scoreEnemy(voter, enemy, getExtrema, formationCtx);
      const prev = totals.get(enemy.instanceId);
      totals.set(enemy.instanceId, prev === undefined ? s : prev + s);
    }
  }

  return bestFocusId(totals);
}

/**
 * REFERENCE (oracle) focus election: the naive per-candidate extrema scan, kept
 * as a first-class implementation the equivalence test compares against the
 * optimised {@link electFocusTarget}. Not wired into production; production runs
 * {@link electFocusTarget}. Identical to {@link electFocusTarget} apart from
 * scoring each candidate with {@link scoreEnemyReference} (re-scans per call)
 * instead of the memoised {@link scoreEnemy} — byte-identical in result,
 * differing only in the O(K^2) vs O(K) scan count per voter.
 */
export function electFocusTargetReference(
  side: "attacker" | "defender",
  ships: readonly SimShip[],
  enemies: readonly SimShip[],
  tick: number,
  formationCtx?: FormationTargetingContext,
): string | undefined {
  const sets = focusVotersAndLiving(side, ships, enemies);
  if (sets === undefined) return undefined;
  const { living, voters } = sets;

  const totals = new Map<string, number>();
  for (const voter of voters) {
    let visible = visibleEnemyViews(voter, living, tick);
    if (formationCtx !== undefined) {
      visible = filterVisibleByTargeting(voter, visible, formationCtx);
    }
    for (const enemy of visible) {
      const s = scoreEnemyReference(voter, enemy, visible, formationCtx);
      const prev = totals.get(enemy.instanceId);
      totals.set(enemy.instanceId, prev === undefined ? s : prev + s);
    }
  }

  return bestFocusId(totals);
}
