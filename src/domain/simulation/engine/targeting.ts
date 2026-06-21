/**
 * Target selection: building the visible-enemy candidate set, scoring, the
 * per-ship pick, and the fleet-wide focus-fire election.
 */

import { SIM } from "./config";
import { effectiveStance } from "./movement";
import type { BattleSpaceConfig } from "./space-config";
import { isDetectable } from "./stealth";
import type { SimShip } from "./types";

/**
 * Whether a ship is concentrating fire with its fleet this tick: the live AI
 * decision (`aiFocusFire`, raised by a `focusFire` rule this tick) OR the static
 * `orders.focusFire` doctrine. A rule-less ship leaves `aiFocusFire` false and
 * so reads exactly its static order, keeping focus-election byte-identical.
 */
export function wantsFocusFire(ship: SimShip): boolean {
  return ship.aiFocusFire || ship.orders.focusFire;
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
  space: BattleSpaceConfig,
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
    if (!isDetectable(ship, enemy, distSq, tick, space)) continue;
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
 * Score a single enemy for targeting purposes, from `ship`'s perspective.
 * Higher scores are preferred. The raw priority score is blended with a
 * vulnerability score when `vulnerableTargetWeight > 0`:
 *
 *   finalScore = (1 − w) * priorityScore_normalised + w * vulnerabilityScore
 *
 * Priority scores are normalised to the range [0, 1] across the living set
 * so the blend is dimensionally consistent — otherwise a cost-based score in
 * the thousands would swamp a distance-based score near −1.
 *
 * Vulnerability is `1 − (structure + shield) / (maxStructure + maxShield)`,
 * so a freshly spawned enemy scores 0 and a nearly dead one scores near 1.
 * When maxStructure + maxShield is zero the score is treated as 0.
 *
 * The ship's effective {@link ShipStance} adds a third term: a signed
 * near-vs-far preference (`stanceTargetDistanceBias`) blended in by the same
 * normalised machinery. An aggressive/interceptor stance prefers the nearest
 * enemy (it is closing anyway); a defensive/evasive/sniper stance prefers a more
 * distant one it can engage from range. A `balanced`/default stance contributes
 * zero, and with `vulnerableTargetWeight <= 0` the function returns the raw
 * priority score exactly as before — so a rule-less default-stance ship targets
 * byte-identically.
 */
export function scoreEnemy(
  ship: SimShip,
  enemy: EnemyView,
  living: readonly EnemyView[],
): number {
  // Raw priority score (higher = better target for this priority).
  const distSq = (enemy.x - ship.x) ** 2 + (enemy.y - ship.y) ** 2;
  let rawScore: number;
  switch (ship.orders.targetPriority) {
    case "nearest":
      rawScore = -distSq;
      break;
    case "weakest":
      rawScore = -(enemy.structure + enemy.shield);
      break;
    case "strongest":
      rawScore = enemy.structure + enemy.shield;
      break;
    case "highestCost":
      rawScore = enemy.cost;
      break;
  }

  const w = ship.orders.vulnerableTargetWeight;
  // Stance bias: a signed near(+)/far(−) preference for the ship's effective
  // stance (its base stance, or an `aiStance` override). Zero for a balanced or
  // default stance, so the fast path below is unchanged for rule-less fleets.
  const stanceBias = SIM.stanceTargetDistanceBias[effectiveStance(ship)];
  if (w <= 0 && stanceBias === 0) return rawScore; // fast path: no blending needed

  // Normalise priority score to [0, 1] across the living set so the blend
  // with the vulnerability score (already in [0,1]) is dimensionally consistent.
  // Distance is normalised in the same pass for the stance bias term.
  let minRaw = rawScore;
  let maxRaw = rawScore;
  let minDistSq = distSq;
  let maxDistSq = distSq;
  for (const e of living) {
    const dSq = (e.x - ship.x) ** 2 + (e.y - ship.y) ** 2;
    if (dSq < minDistSq) minDistSq = dSq;
    if (dSq > maxDistSq) maxDistSq = dSq;
    let s: number;
    switch (ship.orders.targetPriority) {
      case "nearest":
        s = -dSq;
        break;
      case "weakest":
        s = -(e.structure + e.shield);
        break;
      case "strongest":
        s = e.structure + e.shield;
        break;
      case "highestCost":
        s = e.cost;
        break;
    }
    if (s < minRaw) minRaw = s;
    if (s > maxRaw) maxRaw = s;
  }
  const range = maxRaw - minRaw;
  const normPriority = range > 0 ? (rawScore - minRaw) / range : 1;

  // Vulnerability: fraction of max HP already lost.
  const maxTotal = enemy.maxStructure + enemy.maxShield;
  const curTotal = enemy.structure + enemy.shield;
  const vulnerability = maxTotal > 0 ? 1 - curTotal / maxTotal : 0;

  // Player-doctrine blend: priority vs vulnerability, exactly as before.
  const doctrineScore = (1 - w) * normPriority + w * vulnerability;

  if (stanceBias === 0) return doctrineScore;

  // Stance preference: normalise distance to [0, 1] (0 = nearest of the set,
  // 1 = farthest), turn it into a near-preference (1 − normDist) so a positive
  // bias favours close targets, then add the signed, weighted term. Both the
  // doctrine score and the near term live in [0, 1], so the bias magnitude
  // (|stanceBias|, in [0, 1]) scales them on the same footing.
  const distRange = maxDistSq - minDistSq;
  const normDist = distRange > 0 ? (distSq - minDistSq) / distRange : 0;
  const nearPreference = 1 - normDist;
  return doctrineScore + stanceBias * nearPreference;
}

/**
 * Pick the best target for `ship` from `enemies`.
 *
 * When `focusTargetId` is defined (non-undefined), the ship is part of a
 * focus-fire group and must pick that target if it is still alive. This lets
 * an entire side concentrate fire on one enemy at a time rather than spreading
 * damage across the fleet.
 *
 * Otherwise the ship scores each living enemy with `scoreEnemy` and picks the
 * highest. `vulnerableTargetWeight` blends vulnerability into that score.
 *
 * Awareness gate: the ship may only target an enemy in its own awareness set
 * (live contact or surviving ghost). An empty awareness means it sees nothing
 * and holds fire (returns undefined). The fleet focus target is honoured only
 * when this ship can personally see it; otherwise it falls through to its own
 * gated scoring.
 */
export function pickTarget(
  ship: SimShip,
  enemies: readonly SimShip[],
  focusTargetId: string | undefined,
  tick: number,
  space: BattleSpaceConfig,
): EnemyView | undefined {
  // Visible = enemies in awareness (fog/sensors) AND locked-on (stealth gate),
  // filtered inside `visibleEnemyViews`. A non-stealth battle's candidate set is
  // unchanged, so targeting stays byte-identical for fleets without stealth tech.
  const visible = visibleEnemyViews(ship, enemies, tick, space);
  if (visible.length === 0) return undefined;

  // Focus-fire: defer to the fleet-agreed target, but only if this ship can
  // personally see it; a target it can't see falls through to its own scoring.
  if (wantsFocusFire(ship) && focusTargetId !== undefined) {
    const focus = visible.find((e) => e.instanceId === focusTargetId);
    if (focus !== undefined) return focus;
    // Fleet target not in this ship's awareness — fall through to scoring.
  }

  let best: EnemyView | undefined;
  let bestScore = -Infinity;
  for (const enemy of visible) {
    const score = scoreEnemy(ship, enemy, visible);
    if (score > bestScore) {
      bestScore = score;
      best = enemy;
    }
  }
  return best;
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
 */
export function electFocusTarget(
  side: "attacker" | "defender",
  ships: readonly SimShip[],
  enemies: readonly SimShip[],
  tick: number,
  space: BattleSpaceConfig,
): string | undefined {
  // Only real ships are focus-election candidates and voters — a fleet should
  // never agree to focus-fire a drone or decoy, and phantoms carry no doctrine.
  const living = enemies.filter((e) => e.alive && e.phantom === undefined);
  if (living.length === 0) return undefined;
  const voters = ships.filter(
    (s) => s.alive && s.side === side && wantsFocusFire(s) && s.phantom === undefined,
  );
  if (voters.length === 0) return undefined;

  // Aggregate score: each voter scores only the enemies in its OWN awareness
  // set, so an enemy no focus-fire ship can see receives no votes and cannot be
  // elected. A voter scores over its own visible set (the same set its
  // individual pickTarget would normalise against), keeping the election
  // consistent with what each voter would pick alone.
  const totals = new Map<string, number>();
  for (const voter of voters) {
    const visible = visibleEnemyViews(voter, living, tick, space);
    for (const enemy of visible) {
      const s = scoreEnemy(voter, enemy, visible);
      totals.set(enemy.instanceId, (totals.get(enemy.instanceId) ?? 0) + s);
    }
  }

  let bestId: string | undefined;
  let bestTotal = -Infinity;
  // Iterate in id order so ties resolve deterministically (Map insertion order
  // depends on voter scan order, which is already deterministic, but sorting the
  // candidate ids makes the tie-break explicit and robust).
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
