import {
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  NativeSelect,
  NumberInput,
  Paper,
  Progress,
  SegmentedControl,
  Slider,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconArrowsShuffle, IconPlayerPause, IconPlayerPlay, IconRefresh, IconSwords } from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { resolveFleetToCombatShips } from "@/domain/resolve";
import { DEFAULT_MAX_TICKS } from "@/domain/simulation/types";
import { battleRunner } from "@/ui/battleRunner";
import { catalog } from "@/data/catalog";
import { useFleets, useShipDesigns } from "@/ui/hooks/storage";
import { storage } from "@/storage/db";
import { BattleAnomaly } from "@/schema/battle";
import type { BattleAnomaly as BattleAnomalyType, BattleFrame, BattleResult } from "@/schema/battle";
import type { Fleet } from "@/schema/fleet";
import type { WeaponType } from "@/schema/module";
import { interpolateFrame } from "@/ui/interpolateFrame";

/** Logical canvas resolution (CSS pixels before device-pixel-ratio scaling). */
const W = 960;
const H = 600;
const PAD = 40;

/**
 * The simulation's fixed tick rate. Playback time (seconds) × this value gives
 * the fractional sim-tick position for interpolation. Sim tick rate, playback
 * speed, and display refresh are all independent of one another.
 */
const TICKS_PER_SECOND = 30;

const PROJECTILE_COLOUR: Record<WeaponType, string> = {
  beam: "#ffe066",
  cannon: "#e8e8f5",
  missile: "#ff9a3c",
  torpedo: "#ff5a5a",
  plasma: "#e06bff",
};

/** Per-module part colour, by module kind, for the battle canvas. */
const MODULE_COLOUR: Record<string, string> = {
  weapon: "#ff8c5a",
  shield: "#6ea8ff",
  armour: "#b0b0c0",
  engine: "#7bd88f",
  power: "#ffe066",
  crew: "#c792ff",
};

interface Bounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

const DEFAULT_BOUNDS: Bounds = { minX: -700, maxX: 700, minY: -430, maxY: 430 };

const ANOMALY_LABEL: Record<BattleAnomalyType, string> = {
  none: "Open space",
  asteroidField: "Asteroid field",
  nebula: "Nebula",
  blackHole: "Black hole",
};

const MODULE_LABEL: Record<string, string> = {
  weapon: "Weapon",
  shield: "Shield",
  armour: "Armour",
  engine: "Engine",
  power: "Power",
  crew: "Crew",
};

/**
 * Per-module status readout for the current frame: each ship's modules as a
 * row of HP bars, so you can watch systems fail as the battle wears on.
 */
function ModuleStatusPanel({ frame }: { frame: BattleFrame }) {
  const withModules = frame.ships.filter((s) => s.modules !== undefined && s.modules.length > 0);
  if (withModules.length === 0) return null;
  return (
    <Paper p="sm" withBorder>
      <Stack gap={6}>
        <Text size="xs" c="dimmed" fw={600}>
          Modules
        </Text>
        {withModules.map((s) => {
          const sideColour = s.side === "attacker" ? "#ff6b5a" : "#5ab0ff";
          return (
            <Group key={s.instanceId} gap="xs" wrap="nowrap" align="center">
              <Box
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: "50%",
                  background: s.alive ? sideColour : "transparent",
                  border: `1px solid ${sideColour}`,
                  flex: "0 0 auto",
                }}
              />
              <Group gap={4} wrap="wrap" style={{ flex: 1 }}>
                {s.modules?.map((m) => {
                  const frac = m.maxHp > 0 ? Math.max(0, m.hp / m.maxHp) : 0;
                  return (
                    <Tooltip label={`${MODULE_LABEL[m.kind] ?? m.kind}: ${Math.round(m.hp)}/${m.maxHp}`}>
                      <Box
                        style={{ width: 34 }}
                        key={m.slotId}
                      >
                        <Progress
                          size={5}
                          value={m.alive ? frac * 100 : 0}
                          color={m.alive ? "teal" : "gray"}
                        />
                      </Box>
                    </Tooltip>
                  );
                })}
              </Group>
            </Group>
          );
        })}
      </Stack>
    </Paper>
  );
}

export function BattleRoute() {
  const fleets = useFleets();
  const designs = useShipDesigns();
  const [attackerId, setAttackerId] = useState<string | null>(null);
  const [defenderId, setDefenderId] = useState<string | null>(null);
  const [anomaly, setAnomaly] = useState<BattleAnomalyType>("none");
  const [seed, setSeed] = useState(1);
  const [result, setResult] = useState<BattleResult | null>(null);

  /**
   * Playback clock: elapsed playback-time in seconds, independent of rAF rate
   * and display refresh. Fractional sim-tick = playbackTime × TICKS_PER_SECOND.
   * Stored in a ref so the rAF callback reads the live value without needing a
   * re-render on every frame. Updated in effects only (never during render).
   */
  const playbackTimeRef = useRef(0);
  /**
   * playbackTime mirrored as state so the seeker Slider and tick counter stay
   * in sync with the playback clock without an additional ref-to-state dance.
   */
  const [playbackTime, setPlaybackTime] = useState(0);

  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [computing, setComputing] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [canvasSize, setCanvasSize] = useState<{ width: number; height: number } | null>(null);

  const fleetOptions = useMemo(
    () => (fleets ?? []).map((f) => ({ value: f.id, label: f.name })),
    [fleets],
  );

  const bounds = useMemo<Bounds>(() => {
    if (result === null) return DEFAULT_BOUNDS;
    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;
    for (const frame of result.frames) {
      for (const s of frame.ships) {
        minX = Math.min(minX, s.x);
        maxX = Math.max(maxX, s.x);
        minY = Math.min(minY, s.y);
        maxY = Math.max(maxY, s.y);
      }
      for (const p of frame.projectiles) {
        minX = Math.min(minX, p.x);
        maxX = Math.max(maxX, p.x);
        minY = Math.min(minY, p.y);
        maxY = Math.max(maxY, p.y);
      }
    }
    if (!Number.isFinite(minX)) return DEFAULT_BOUNDS;
    const padX = (maxX - minX) * 0.08 + 40;
    const padY = (maxY - minY) * 0.08 + 40;
    return {
      minX: minX - padX,
      maxX: maxX + padX,
      minY: minY - padY,
      maxY: maxY + padY,
    };
  }, [result]);

  /** Per-ship full structure/shield, taken from the deployment frame. */
  const maxHp = useMemo(() => {
    const map = new Map<string, { structure: number; shield: number }>();
    if (result !== null) {
      const first = result.frames[0];
      if (first !== undefined) {
        for (const s of first.ships) {
          map.set(s.instanceId, { structure: s.structure, shield: s.shield });
        }
      }
    }
    return map;
  }, [result]);

  // Keep the canvas backing store matched to its CSS display size, with a DPR
  // multiplier for crisp lines. Without this the backing is the HTML default
  // 300×150 regardless of how big the canvas renders, and the browser scales
  // that tiny bitmap up to fill the box — a blurry smear. The effect depends
  // on `result` so it (re)runs when the canvas first mounts on a new battle.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (canvas === null) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const setBacking = () => {
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw === 0 || ch === 0) return;
      const desiredW = cw * dpr;
      const desiredH = ch * dpr;
      // Only resize the backing when it actually changed — assigning to
      // canvas.width clears the bitmap, so guarding avoids a blank flash
      // when a new battle reuses the same-sized canvas element.
      if (canvas.width !== desiredW) canvas.width = desiredW;
      if (canvas.height !== desiredH) canvas.height = desiredH;
    };
    setBacking();
    const observer = new ResizeObserver(() => {
      setBacking();
      const cw = canvas.clientWidth;
      const ch = canvas.clientHeight;
      if (cw === 0 || ch === 0) return;
      setCanvasSize({ width: cw, height: ch });
    });
    observer.observe(canvas);
    return () => observer.disconnect();
  }, [result]);

  /**
   * Pure draw function: renders `frame` onto the canvas. Separated from the
   * clock-advance so resize events and seek operations can redraw without
   * advancing the playback clock.
   *
   * Closes over `bounds` and `maxHp` from the enclosing render scope. Both are
   * stable for a given `result` (they're derived from it), so `drawFrame` is
   * re-created only when those values change.
   */
  const drawFrame = useCallback(
    (frame: BattleFrame) => {
      const canvas = canvasRef.current;
      if (canvas === null) return;
      const ctx = canvas.getContext("2d");
      if (ctx === null) return;

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const width = canvas.clientWidth;
      const height = canvas.clientHeight;
      if (width === 0 || height === 0) return;
      ctx.clearRect(0, 0, width, height);

      // Uniform world-to-display scale that letterboxes to preserve the
      // world's aspect ratio. Independent x/y scales would stretch ships
      // whenever the canvas aspect doesn't match the battle's.
      const rangeX = Math.max(bounds.maxX - bounds.minX, 1);
      const rangeY = Math.max(bounds.maxY - bounds.minY, 1);
      const scale = Math.min((width - PAD * 2) / rangeX, (height - PAD * 2) / rangeY);
      const offsetX = (width - rangeX * scale) / 2;
      const offsetY = (height - rangeY * scale) / 2;

      const sx = (wx: number) => offsetX + (wx - bounds.minX) * scale;
      const sy = (wy: number) => offsetY + (wy - bounds.minY) * scale;

      for (const p of frame.projectiles) {
        const colour = PROJECTILE_COLOUR[p.kind];
        if (colour === undefined) continue;
        ctx.fillStyle = colour;
        ctx.fillRect(sx(p.x) - 1, sy(p.y) - 1, 2.5, 2.5);
      }

      for (const s of frame.ships) {
        const px = sx(s.x);
        const py = sy(s.y);
        const base = s.side === "attacker" ? "#ff6b5a" : "#5ab0ff";
        const max = maxHp.get(s.instanceId);

        if (!s.alive) {
          ctx.globalAlpha = 0.2;
          ctx.fillStyle = base;
          ctx.beginPath();
          ctx.arc(px, py, 5, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = 1;
          continue;
        }

        const maxShield = max?.shield ?? s.shield;
        if (maxShield > 0) {
          const frac = Math.max(0, s.shield / maxShield);
          if (frac > 0) {
            ctx.strokeStyle = "rgba(120,200,255,0.65)";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(px, py, 11, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
            ctx.stroke();
          }
        }

        ctx.fillStyle = base;
        ctx.beginPath();
        ctx.arc(px, py, 7, 0, Math.PI * 2);
        ctx.fill();

        // Per-module parts: each placed module drawn at its world position
        // (ship centre + the module's local cell rotated by the ship's facing),
        // coloured by kind. Destroyed parts go dark — the ship visibly comes
        // apart system by system as the battle wears on.
        if (s.modules !== undefined && s.facing !== undefined) {
          const cos = Math.cos(s.facing);
          const sin = Math.sin(s.facing);
          for (const m of s.modules) {
            const wx = s.x + m.x * cos - m.y * sin;
            const wy = s.y + m.x * sin + m.y * cos;
            const mx = sx(wx);
            const my = sy(wy);
            const colour = MODULE_COLOUR[m.kind];
            if (colour === undefined) continue;
            ctx.globalAlpha = m.alive ? 1 : 0.2;
            ctx.fillStyle = colour;
            ctx.fillRect(mx - 2, my - 2, 4, 4);
            if (!m.alive) {
              // Destroyed: a dark cross to read as a hole / wreckage.
              ctx.strokeStyle = "rgba(255,255,255,0.25)";
              ctx.lineWidth = 1;
              ctx.beginPath();
              ctx.moveTo(mx - 3, my - 3);
              ctx.lineTo(mx + 3, my + 3);
              ctx.moveTo(mx + 3, my - 3);
              ctx.lineTo(mx - 3, my + 3);
              ctx.stroke();
            }
          }
          ctx.globalAlpha = 1;
        }

        // Heading indicator: a short line along the ship's velocity vector,
        // so direction and momentum are visible. Length scales with speed,
        // capped so very fast ships don't get a huge line.
        if (s.vx !== undefined && s.vy !== undefined) {
          const vx = s.vx;
          const vy = s.vy;
          const vLen = Math.hypot(vx, vy);
          if (vLen > 0.01) {
            const lineLen = Math.min(20, 4 + vLen * 8);
            const ux = vx / vLen;
            const uy = vy / vLen;
            ctx.strokeStyle = base;
            ctx.globalAlpha = 0.85;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(px + ux * 9, py + uy * 9);
            ctx.lineTo(px + ux * (9 + lineLen), py + uy * (9 + lineLen));
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }

        const maxStructure = max?.structure ?? s.structure;
        const frac = maxStructure > 0 ? Math.max(0, s.structure / maxStructure) : 0;
        const barW = 18;
        ctx.fillStyle = "rgba(255,255,255,0.15)";
        ctx.fillRect(px - barW / 2, py + 10, barW, 3);
        ctx.fillStyle =
          frac > 0.5 ? "#7bd88f" : frac > 0.25 ? "#ffcc5a" : "#ff5a5a";
        ctx.fillRect(px - barW / 2, py + 10, barW * frac, 3);
      }
    },
    [bounds, maxHp],
  );

  /**
   * Main rAF loop: advances the playback clock by the real wall-clock delta
   * (multiplied by the speed factor), derives the fractional sim-tick position,
   * interpolates between the two bracketing frames, and draws on every rAF
   * regardless of display refresh rate.
   *
   * Pausing, seeking, and stepping all operate on `playbackTimeRef` directly;
   * this loop runs regardless of `playing` so that seek/resize redraws work.
   */
  useEffect(() => {
    if (result === null) return;

    let rafId = 0;
    let lastTimestamp: number | null = null;

    const loop = (now: number) => {
      if (lastTimestamp !== null) {
        const realDt = (now - lastTimestamp) / 1000;
        // Guard against very large dt values from hidden-tab pauses (browser
        // suspends rAF; on resume the first dt can be seconds). Clamp to 200 ms.
        const clampedDt = Math.min(realDt, 0.2);

        if (playing) {
          const maxTime = result.ticks / TICKS_PER_SECOND;
          const newTime = playbackTimeRef.current + clampedDt * speed;
          if (newTime >= maxTime) {
            playbackTimeRef.current = maxTime;
            setPlaybackTime(maxTime);
            setPlaying(false);
          } else {
            playbackTimeRef.current = newTime;
            setPlaybackTime(newTime);
          }
        }
      }

      lastTimestamp = now;

      // Draw on every rAF regardless of whether the clock advanced.
      const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
      const frame = interpolateFrame(result.frames, fractionalTick);
      drawFrame(frame);

      rafId = requestAnimationFrame(loop);
    };

    rafId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(rafId);
  // Restart the loop when: a new battle lands, playing toggles, speed changes,
  // or drawFrame is recreated (bounds/maxHp changed). All of these are
  // legitimate reasons to reset `lastTimestamp` so the first dt after each
  // change is not inflated.
  }, [result, playing, speed, drawFrame]);

  // Redraw when the canvas is resized (canvasSize changes). The draw itself is
  // purely a side-effect of the current playbackTime; no clock advance needed.
  // The rAF loop above handles the drawing during normal playback; this covers
  // the paused-then-resize case.
  useEffect(() => {
    if (result === null) return;
    const fractionalTick = playbackTimeRef.current * TICKS_PER_SECOND;
    const frame = interpolateFrame(result.frames, fractionalTick);
    drawFrame(frame);
  }, [canvasSize, result, drawFrame]);

  if (fleets === undefined || designs === undefined) {
    return <Text c="dimmed">Loading…</Text>;
  }
  const allFleets = fleets;
  const allDesigns = designs;

  /**
   * Resolve the chosen fleets, run the engine, and start the replay. The
   * caller passes fleet objects directly so both the manual and auto-rolled
   * code paths can drive the same pipeline without going through state.
   */
  async function startBattle(
    attacker: Fleet,
    defender: Fleet,
    chosenAnomaly: BattleAnomalyType,
    chosenSeed: number,
  ): Promise<void> {
    const designMap = new Map(allDesigns.map((d) => [d.id, d]));
    const attackers = resolveFleetToCombatShips(attacker, designMap, catalog(), "attacker");
    const defenders = resolveFleetToCombatShips(defender, designMap, catalog(), "defender");
    if (attackers.length === 0 || defenders.length === 0) {
      notifications.show({
        title: "Nothing to fight",
        message: "One fleet has no ships that resolve against the catalog.",
        color: "red",
      });
      return;
    }
    // Compute off the main thread via the BattleRunner contract, so the engine
    // no longer blocks the UI. The replay below is unchanged: it still drives
    // off the precomputed frames once the result arrives, on the wall-clock
    // playback timeline.
    setComputing(true);
    setPlaying(false);
    try {
      const battle = await battleRunner.run({
        ships: [...attackers, ...defenders],
        attackerFleetId: attacker.id,
        defenderFleetId: defender.id,
        anomaly: chosenAnomaly,
        seed: chosenSeed,
        maxTicks: DEFAULT_MAX_TICKS,
      });
      void storage().battles.save(battle);
      setResult(battle);
      // Reset the playback clock to the start.
      playbackTimeRef.current = 0;
      setPlaybackTime(0);
      setPlaying(true);
    } catch (error) {
      notifications.show({
        title: "Battle failed to compute",
        message: error instanceof Error ? error.message : "The simulation worker did not return a result.",
        color: "red",
      });
    } finally {
      setComputing(false);
    }
  }

  function engage() {
    const attacker = allFleets.find((f) => f.id === attackerId);
    const defender = allFleets.find((f) => f.id === defenderId);
    if (attacker === undefined || defender === undefined) {
      notifications.show({
        title: "Pick both fleets",
        message: "Choose an attacker and a defender before engaging.",
        color: "red",
      });
      return;
    }
    void startBattle(attacker, defender, anomaly, seed);
  }

  /**
   * Auto-roll a matchup: pick two (different, when possible) fleets, a random
   * anomaly, and a random seed, reflect the picks in the setup UI, and start
   * the battle. This is the "AI vs AI" mode — both sides are commanded by
   * their doctrine and the player is a spectator.
   */
  function randomBattle() {
    if (allFleets.length === 0) {
      notifications.show({
        title: "No fleets to roll",
        message: "Build or import a fleet first.",
        color: "red",
      });
      return;
    }
    const ai = Math.floor(Math.random() * allFleets.length);
    let di: number;
    if (allFleets.length === 1) {
      di = ai;
    } else {
      di = Math.floor(Math.random() * (allFleets.length - 1));
      if (di >= ai) di += 1;
    }
    const attacker = allFleets[ai];
    const defender = allFleets[di];
    if (attacker === undefined || defender === undefined) return;

    const anomalies = BattleAnomaly.options;
    const chosenAnomaly = anomalies[Math.floor(Math.random() * anomalies.length)];
    if (chosenAnomaly === undefined) return;
    const chosenSeed = Math.floor(Math.random() * 0xffffffff);

    setAttackerId(attacker.id);
    setDefenderId(defender.id);
    setAnomaly(chosenAnomaly);
    setSeed(chosenSeed);
    void startBattle(attacker, defender, chosenAnomaly, chosenSeed);
    notifications.show({
      title: "AI vs AI",
      message: `${attacker.name} vs ${defender.name} on ${ANOMALY_LABEL[chosenAnomaly] ?? chosenAnomaly}.`,
      color: "indigo",
    });
  }

  const winnerColour =
    result?.winner === "attacker"
      ? "#ff6b5a"
      : result?.winner === "defender"
        ? "#5ab0ff"
        : "gray";

  // Derive the integer tick for the Slider and tick counter from playbackTime.
  const currentTick = result !== null
    ? Math.min(result.ticks, Math.floor(playbackTime * TICKS_PER_SECOND))
    : 0;

  // The status panel uses the discrete-nearest frame since it shows system HP
  // values, not positions — there is no meaningful interpolation for HP.
  const statusFrame = result !== null
    ? (result.frames[currentTick] ?? result.frames[result.frames.length - 1])
    : null;

  return (
    <Stack gap="lg">
      <Title order={2}>Battle Arena</Title>

      <Group gap="lg" align="flex-start">
        <Paper p="md" withBorder style={{ flex: "1 1 320px" }}>
          <Stack gap="sm">
            <NativeSelect
              label="Attacker"
              value={attackerId ?? ""}
              onChange={(e) => setAttackerId(e.target.value || null)}
            >
              <option value="">— select —</option>
              {fleetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>
            <NativeSelect
              label="Defender"
              value={defenderId ?? ""}
              onChange={(e) => setDefenderId(e.target.value || null)}
            >
              <option value="">— select —</option>
              {fleetOptions.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </NativeSelect>

            <Stack gap={4}>
              <Text size="sm" fw={500}>
                Spatial anomaly
              </Text>
              <SegmentedControl
                fullWidth
                size="xs"
                data={BattleAnomaly.options.map((a) => ({
                  value: a,
                  label: ANOMALY_LABEL[a],
                }))}
                value={anomaly}
                onChange={(val) => setAnomaly(BattleAnomaly.parse(val))}
              />
            </Stack>

            <Group align="flex-end">
              <NumberInput
                label="Seed"
                value={seed}
                onChange={(val) => setSeed(typeof val === "number" ? val : 1)}
                style={{ flex: 1 }}
              />
              <Button
                variant="light"
                leftSection={<IconRefresh size={16} />}
                onClick={() => setSeed(Math.floor(Math.random() * 1_000_000_000))}
              >
                Random
              </Button>
            </Group>

            <Button
              size="md"
              leftSection={<IconSwords size={18} />}
              onClick={engage}
              loading={computing}
            >
              Engage
            </Button>

            <Tooltip label="Auto-roll attacker, defender, anomaly and seed, then watch.">
              <Button
                variant="light"
                fullWidth
                leftSection={<IconArrowsShuffle size={16} />}
                onClick={randomBattle}
                disabled={allFleets.length === 0 || computing}
              >
                AI vs AI
              </Button>
            </Tooltip>

            {result !== null && (
              <Group justify="space-between">
                <Text size="sm" c="dimmed">
                  Result
                </Text>
                <Badge size="lg" color="gray" style={{ color: winnerColour }}>
                  {result.winner === "draw"
                    ? "Draw"
                    : `${result.winner.toUpperCase()} WINS`}
                </Badge>
              </Group>
            )}
          </Stack>
        </Paper>

        <Stack gap="sm" style={{ flex: "1 1 560px" }}>
          {result === null ? (
            <Paper p="xl" withBorder>
              <Center h={360}>
                {computing ? (
                  <Stack align="center" gap="xs">
                    <Loader />
                    <Text c="dimmed">Computing battle…</Text>
                  </Stack>
                ) : (
                  <Stack align="center" gap="xs">
                    <IconSwords size={40} color="#6b7280" />
                    <Text c="dimmed">Pick two fleets and engage to watch the battle.</Text>
                  </Stack>
                )}
              </Center>
            </Paper>
          ) : (
            <>
              <Paper p="xs" withBorder>
                <canvas
                  ref={canvasRef}
                  style={{
                    width: "100%",
                    aspectRatio: `${W} / ${H}`,
                    display: "block",
                    borderRadius: 4,
                  }}
                />
              </Paper>
              <Group gap="md" align="center">
                <Button
                  variant="light"
                  leftSection={
                    playing ? <IconPlayerPause size={16} /> : <IconPlayerPlay size={16} />
                  }
                  onClick={() => {
                    if (currentTick >= result.ticks) {
                      // Rewind to start before playing again.
                      playbackTimeRef.current = 0;
                      setPlaybackTime(0);
                    }
                    setPlaying((p) => !p);
                  }}
                >
                  {playing ? "Pause" : "Play"}
                </Button>
                <Text size="sm" c="dimmed" style={{ flex: 1 }}>
                  Tick {currentTick} / {result.ticks}
                </Text>
                <SegmentedControl
                  size="xs"
                  data={[
                    { value: "0.25", label: "0.25x" },
                    { value: "0.5", label: "0.5x" },
                    { value: "1", label: "1x" },
                    { value: "2", label: "2x" },
                  ]}
                  value={String(speed)}
                  onChange={(val) => setSpeed(Number(val))}
                />
              </Group>
              <Slider
                min={0}
                max={result.ticks}
                value={currentTick}
                onChange={(val) => {
                  setPlaying(false);
                  const newTime = val / TICKS_PER_SECOND;
                  playbackTimeRef.current = newTime;
                  setPlaybackTime(newTime);
                  // Redraw immediately at the new position without waiting for
                  // the next rAF, so seeking feels instant.
                  const frame = interpolateFrame(result.frames, val);
                  drawFrame(frame);
                }}
              />
              {statusFrame !== null && statusFrame !== undefined && (
                <ModuleStatusPanel frame={statusFrame} />
              )}
            </>
          )}
        </Stack>
      </Group>
    </Stack>
  );
}
