import {
  ActionIcon,
  Badge,
  Box,
  Button,
  Center,
  Collapse,
  Group,
  Loader,
  Paper,
  Popover,
  Stack,
  Switch,
  SegmentedControl,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconEye,
  IconEyeOff,
  IconLayoutSidebarRightExpand,
  IconMaximize,
  IconSettings,
  IconSwords,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { useFleets, useShipDesigns } from "@/ui/hooks/storage";
import { BattleAnomaly } from "@/schema/battle";
import type { BattleAnomaly as BattleAnomalyType, BattleFrame } from "@/schema/battle";
import { interpolateFrame } from "@/ui/interpolateFrame";
import { clampZoom, DEFAULT_CAMERA } from "./battleCamera";
import type { Camera } from "./battleCamera";
import { ANOMALY_LABEL } from "./battleConstants";
import { BattleSetupPanel } from "./BattleSetupPanel";
import { BattleStatusReadout } from "./BattleStatusReadout";
import { ModuleStatusPanel } from "./ModuleStatusPanel";
import { PlaybackControls } from "./PlaybackControls";
import { OVERLAYS } from "./overlays";
import type { OverlayDef, OverlayScope } from "./overlays";
import { useBattleCamera } from "./useBattleCamera";
import { useBattleCanvas } from "./useBattleCanvas";
import { useBattlePlayback } from "./useBattlePlayback";
import { useBattleSimulation } from "./useBattleSimulation";
import * as styles from "./BattleRoute.css";

export function BattleRoute() {
  const fleets = useFleets();
  const designs = useShipDesigns();
  const [attackerId, setAttackerId] = useState<string | null>(null);
  const [defenderId, setDefenderId] = useState<string | null>(null);
  const [anomaly, setAnomaly] = useState<BattleAnomalyType>("none");
  const [seed, setSeed] = useState(1);

  /** Whether the setup panel and module-status overlay are shown. */
  const [setupOpen, setSetupOpen] = useState(true);
  const [statusOpen, setStatusOpen] = useState(false);
  /** Whether the fog-of-war / awareness overlay is shown (default: on). */
  const [showFog, setShowFog] = useState(true);
  /**
   * Per-overlay on/scope state, seeded from each OverlayDef's defaults. The
   * draw loop reads this each rAF to decide which overlays to dispatch and
   * which ships are in scope. Keyed by overlay id.
   */
  const [overlays, setOverlays] = useState<Record<string, { on: boolean; scope: OverlayScope }>>(
    () =>
      Object.fromEntries(
        OVERLAYS.map((o) => [o.id, { on: o.defaultOn, scope: o.defaultScope }]),
      ),
  );

  // --- Cross-cutting refs shared across the engine hooks -------------------
  // These hold live values read by the rAF draw loop, pointer handlers, and the
  // streaming accumulator. Route-level (not hook-local) so simulation, camera,
  // canvas, and playback all read/write the same instances. The canvas element
  // ref and the camera mirror ref are also route-level so the JSX `ref` prop
  // and the draw loop can read them without a hook returning a ref object
  // (which the react-hooks/refs lint rule would flag at the call site).
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA);
  const framesRef = useRef<BattleFrame[]>([]);
  const simTickRateRef = useRef(0);
  const playbackTimeRef = useRef(0);
  const bufferingRef = useRef(false);

  /**
   * Latest-callback ref for the simulation hook's cross-hook resets. The
   * simulation hook is called before playback/camera (it produces the values
   * they consume), but its `onFirstBatch`/`resetForNewRun` side-effects need
   * playback and camera setters (stable, but not yet bound when the simulation
   * hook runs). The ref holds the latest closures, kept current by the effect
   * below; `onFrames` (a worker callback) fires well after render, so the ref
   * is always current by the time it reads. This preserves the original's
   * synchronous in-onFrames side-effect ordering exactly.
   */
  const engineCallbacksRef = useRef<{ resetForNewRun: () => void; onFirstBatch: () => void }>({
    resetForNewRun: () => {},
    onFirstBatch: () => {},
  });

  // --- Simulation hook (streaming/run lifecycle) --------------------------
  const simulation = useBattleSimulation({
    framesRef,
    simTickRateRef,
    playbackTimeRef,
    resetForNewRun: () => engineCallbacksRef.current.resetForNewRun(),
    onFirstBatch: () => engineCallbacksRef.current.onFirstBatch(),
  });

  /**
   * Whether any frames have streamed in yet. The canvas stage and all the
   * draw/playback machinery key off this rather than `result`, so playback can
   * begin the moment the first batch arrives — long before the final result
   * resolves. Derived from `frameCount` state, which the first batch flips from
   * zero, rather than reading the frames ref during render.
   */
  const hasFrames = simulation.frameCount > 0;

  // --- Camera hook (canvas sizing/camera state/pointer) -------------------
  const camera = useBattleCamera({
    canvasRef,
    cameraRef,
    playbackTimeRef,
    framesRef,
    rawBounds: simulation.rawBounds,
    hasFrames,
  });

  /**
   * Per-ship full structure/shield, taken from the deployment frame captured on
   * the first batch. Re-derived only when that frame changes (a fresh run), so
   * the HP bars are correct from the moment progressive playback begins.
   */
  const maxHp = useMemo(() => {
    const map = new Map<string, { structure: number; shield: number }>();
    if (simulation.deploymentFrame !== null) {
      for (const s of simulation.deploymentFrame.ships) {
        map.set(s.instanceId, { structure: s.structure, shield: s.shield });
      }
    }
    return map;
  }, [simulation.deploymentFrame]);

  // Per-ship faction from the battle roster, so the canvas can tint each ship by
  // its faction palette. Built once per result; absent on replays recorded before
  // the factions update, in which case ships fall back to the side colour.
  const factionByInstance = useMemo(() => {
    const map = new Map<string, string>();
    if (simulation.result !== null && simulation.result.roster !== undefined) {
      for (const entry of simulation.result.roster) {
        map.set(entry.instanceId, entry.faction);
      }
    }
    return map;
  }, [simulation.result]);

  /**
   * The battle seed baked into the running replay. Stable for a given result;
   * used to draw canonical occluder positions for the asteroid field anomaly
   * and to pass to the fog renderer.
   */
  const activeSeed: number = simulation.result?.config.seed ?? 1;

  // --- Canvas draw hook (pure draw callback) ------------------------------
  const drawFrame = useBattleCanvas({
    canvasRef,
    cameraRef,
    bounds: camera.bounds,
    maxHp,
    activeAnomaly: simulation.activeAnomaly,
    activeSeed,
    showFog,
    factionByInstance,
    overlays,
  });

  // --- Playback hook (clock + rAF/resize loops) ---------------------------
  const playback = useBattlePlayback({
    playbackTimeRef,
    bufferingRef,
    framesRef,
    simTickRateRef,
    result: simulation.result,
    computedTicks: simulation.computedTicks,
    hasFrames,
    drawFrame,
    statusOpen,
    canvasSize: camera.canvasSize,
  });

  // Keep the engine-callbacks ref current after every render. These closures
  // capture the stable setters from playback/camera and the route's own state
  // setters; `onFrames` reads them asynchronously from the worker, so the ref
  // is always current by the time it fires. This preserves the original's
  // synchronous in-onFrames side-effect ordering exactly (the
  // `playbackTimeRef.current = 0` reset happens in the simulation hook's
  // onFrames before the onFirstBatch callback runs).
  useEffect(() => {
    engineCallbacksRef.current = {
      resetForNewRun: () => {
        playback.setBuffering(false);
        bufferingRef.current = false;
        playback.setPlaying(false);
      },
      onFirstBatch: () => {
        playback.setPlaybackTime(0);
        camera.setCamera(DEFAULT_CAMERA);
        setSetupOpen(false);
        playback.setPlaying(true);
      },
    };
  }, [playback, camera]);

  /** Authoritative max tick: the streamed leading edge while computing, the
   *  final tick count once the result has landed. */
  const maxTick = simulation.result !== null ? simulation.result.ticks : simulation.computedTicks;

  // Derive the integer tick for the Slider and tick counter from playbackTime,
  // clamped to the playable ceiling: the streamed leading edge while computing,
  // the final tick count once the result has landed.
  const currentTick = hasFrames
    ? Math.min(maxTick, Math.floor(playback.playbackTime * TICKS_PER_SECOND))
    : 0;

  const fleetOptions = useMemo(
    () => (fleets ?? []).map((f) => ({ value: f.id, label: f.name })),
    [fleets],
  );

  // --- Engage / auto-roll handlers ----------------------------------------
  function engage() {
    if (fleets === undefined || designs === undefined) return;
    const attacker = fleets.find((f) => f.id === attackerId);
    const defender = fleets.find((f) => f.id === defenderId);
    if (attacker === undefined || defender === undefined) {
      notifications.show({
        title: "Pick both fleets",
        message: "Choose an attacker and a defender before engaging.",
        color: "red",
      });
      return;
    }
    void simulation.startBattle(attacker, defender, anomaly, seed, designs);
  }

  /**
   * Auto-roll a matchup: pick two (different, when possible) fleets, a random
   * anomaly, and a random seed, reflect the picks in the setup UI, and start
   * the battle. This is the "AI vs AI" mode — both sides are commanded by
   * their doctrine and the player is a spectator.
   */
  function randomBattle() {
    if (fleets === undefined) return;
    if (fleets.length === 0) {
      notifications.show({
        title: "No fleets to roll",
        message: "Build or import a fleet first.",
        color: "red",
      });
      return;
    }
    const ai = Math.floor(Math.random() * fleets.length);
    let di: number;
    if (fleets.length === 1) {
      di = ai;
    } else {
      di = Math.floor(Math.random() * (fleets.length - 1));
      if (di >= ai) di += 1;
    }
    const attacker = fleets[ai];
    const defender = fleets[di];
    if (attacker === undefined || defender === undefined) return;
    if (designs === undefined) return;

    const anomalies = BattleAnomaly.options;
    const chosenAnomaly = anomalies[Math.floor(Math.random() * anomalies.length)];
    if (chosenAnomaly === undefined) return;
    const chosenSeed = Math.floor(Math.random() * 0xffffffff);

    setAttackerId(attacker.id);
    setDefenderId(defender.id);
    setAnomaly(chosenAnomaly);
    setSeed(chosenSeed);
    void simulation.startBattle(attacker, defender, chosenAnomaly, chosenSeed, designs);
    notifications.show({
      title: "AI vs AI",
      message: `${attacker.name} vs ${defender.name} on ${ANOMALY_LABEL[chosenAnomaly] ?? chosenAnomaly}.`,
      color: "indigo",
    });
  }

  /**
   * Toggle play/pause. Restarts from the top when paused at the true end of
   * a finished battle; mid-stream it resumes rather than rewinds. Defined
   * before the early-return guard so the space-bar effect can reference it.
   */
  const onTogglePlay = () => {
    if (simulation.result !== null && currentTick >= simulation.result.ticks) {
      playbackTimeRef.current = 0;
      playback.setPlaybackTime(0);
    }
    playback.setPlaying((p) => !p);
  };

  /**
   * A ref kept current by an effect below, so the space-bar keydown listener
   * always calls the latest `onTogglePlay` without re-registering.
   */
  const onTogglePlayRef = useRef(onTogglePlay);
  useEffect(() => {
    onTogglePlayRef.current = onTogglePlay;
  });

  // Space-bar toggles play/pause when the canvas is active. The listener
  // registers once (gated on hasFrames) and reads the latest handler via ref,
  // so it never goes stale. We guard against focusable input elements so
  // typing a seed or fleet name is unaffected.
  useEffect(() => {
    if (!hasFrames) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      const target = e.target;
      if (
        target instanceof HTMLInputElement ||
        target instanceof HTMLTextAreaElement ||
        target instanceof HTMLButtonElement
      ) {
        return;
      }
      e.preventDefault();
      onTogglePlayRef.current();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [hasFrames]);

  // --- Early return: loading ----------------------------------------------
  if (fleets === undefined || designs === undefined) {
    return <Text c="dimmed">Loading…</Text>;
  }

  const winnerColour =
    simulation.result?.winner === "attacker"
      ? "#ff6b5a"
      : simulation.result?.winner === "defender"
        ? "#5ab0ff"
        : "gray";

  const onSeek = (val: number) => {
    playback.setPlaying(false);
    playback.setBuffering(false);
    const newTime = val / TICKS_PER_SECOND;
    playbackTimeRef.current = newTime;
    playback.setPlaybackTime(newTime);
    const frames = framesRef.current;
    const frame = interpolateFrame(frames, val);
    drawFrame(frame, Math.floor(val), frames);
  };

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={2}>Battle Arena</Title>
        <Group gap="xs">
          {simulation.result !== null && (
            <Badge size="lg" color="gray" style={{ color: winnerColour }}>
              {simulation.result.winner === "draw"
                ? "Draw"
                : `${simulation.result.winner.toUpperCase()} WINS`}
            </Badge>
          )}
          <Button
            variant={setupOpen ? "filled" : "light"}
            size="sm"
            leftSection={<IconSettings size={16} />}
            onClick={() => setSetupOpen((o) => !o)}
          >
            Setup
          </Button>
        </Group>
      </Group>

      <Collapse expanded={setupOpen}>
        <Paper p="md" withBorder>
          <BattleSetupPanel
            attackerId={attackerId}
            defenderId={defenderId}
            anomaly={anomaly}
            seed={seed}
            fleetOptions={fleetOptions}
            computing={simulation.computing}
            hasFleets={fleets.length > 0}
            onAttackerIdChange={setAttackerId}
            onDefenderIdChange={setDefenderId}
            onAnomalyChange={setAnomaly}
            onSeedChange={setSeed}
            onRandomSeed={() => setSeed(Math.floor(Math.random() * 1_000_000_000))}
            onEngage={engage}
            onRandomBattle={randomBattle}
          />
        </Paper>
      </Collapse>

      {!hasFrames ? (
        <Paper p="xl" withBorder>
          <Center h={360}>
            {simulation.computing ? (
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
        <Stack gap="sm">
          <Paper p={0} withBorder className={styles.stage}>
            <Box className={styles.canvasBox}>
              <canvas
                ref={canvasRef}
                className={`${styles.canvas}${camera.dragging ? ` ${styles.canvasGrabbing}` : ""}`}
                onPointerDown={camera.handlePointerDown}
                onPointerMove={camera.handlePointerMove}
                onPointerUp={camera.handlePointerUp}
                onPointerCancel={camera.handlePointerUp}
              />

              <Badge
                className={styles.anomalyLegend}
                size="sm"
                variant="filled"
                color={simulation.activeAnomaly === "none" ? "gray" : "grape"}
              >
                {ANOMALY_LABEL[simulation.activeAnomaly]}
                {camera.camera.followId !== null ? " · following" : ""}
              </Badge>

              {showFog && (
                <Badge className={styles.fogLegend} size="sm" variant="dot" color="cyan">
                  Fog of war
                </Badge>
              )}

              <Group className={styles.cameraControls} gap={4}>
                <Tooltip label="Zoom in">
                  <ActionIcon
                    variant="default"
                    onClick={() =>
                      camera.setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom * 1.4) }))
                    }
                  >
                    +
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Zoom out">
                  <ActionIcon
                    variant="default"
                    onClick={() =>
                      camera.setCamera((c) => ({ ...c, zoom: clampZoom(c.zoom / 1.4) }))
                    }
                  >
                    −
                  </ActionIcon>
                </Tooltip>
                <Tooltip label="Fit whole battle (reset camera)">
                  <ActionIcon variant="default" onClick={camera.resetCamera}>
                    <IconMaximize size={16} />
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={showFog ? "Hide fog of war overlay" : "Show fog of war overlay"}>
                  <ActionIcon
                    variant={showFog ? "filled" : "default"}
                    onClick={() => setShowFog((f) => !f)}
                  >
                    {showFog ? <IconEye size={16} /> : <IconEyeOff size={16} />}
                  </ActionIcon>
                </Tooltip>
                <Tooltip label={statusOpen ? "Hide module panel" : "Show module panel"}>
                  <ActionIcon
                    variant={statusOpen ? "filled" : "default"}
                    onClick={() => setStatusOpen((o) => !o)}
                  >
                    <IconLayoutSidebarRightExpand size={16} />
                  </ActionIcon>
                </Tooltip>
                <Popover width={260} position="top-end" withArrow shadow="md">
                  <Popover.Target>
                    <Tooltip label="Battle overlays">
                      <ActionIcon variant="default">
                        <IconSettings size={16} />
                      </ActionIcon>
                    </Tooltip>
                  </Popover.Target>
                  <Popover.Dropdown>
                    <Stack gap={6}>
                      <Text size="xs" fw={600}>
                        Overlays
                      </Text>
                      {OVERLAYS.map((def: OverlayDef) => {
                        const state = overlays[def.id];
                        if (state === undefined) return null;
                        return (
                          <Group key={def.id} gap={8} align="center" wrap="nowrap">
                            <Switch
                              size="xs"
                              label={def.label}
                              checked={state.on}
                              onChange={(e) =>
                                setOverlays((prev) => ({
                                  ...prev,
                                  [def.id]: { ...state, on: e.currentTarget.checked },
                                }))
                              }
                            />
                            <SegmentedControl
                              size="xs"
                              value={state.scope}
                              onChange={(val) =>
                                setOverlays((prev) => ({
                                  ...prev,
                                  [def.id]: {
                                    ...state,
                                    scope: val === "all" ? "all" : "active",
                                  },
                                }))
                              }
                              data={[
                                { label: "Active", value: "active" },
                                { label: "All", value: "all" },
                              ]}
                            />
                          </Group>
                        );
                      })}
                    </Stack>
                  </Popover.Dropdown>
                </Popover>
              </Group>

              {statusOpen && playback.statusFrame !== null && (
                <Box className={styles.statusOverlay}>
                  <ModuleStatusPanel frame={playback.statusFrame} />
                </Box>
              )}

              {/* Streaming progress: shown while the run is still computing (the
                  final result has not yet landed). Vanishes the moment the final
                  result arrives. */}
              {simulation.result === null && simulation.computing && (
                <BattleStatusReadout
                  buffering={playback.buffering}
                  computedTicks={simulation.computedTicks}
                />
              )}
            </Box>
          </Paper>

          <PlaybackControls
            playing={playback.playing}
            speed={playback.speed}
            currentTick={currentTick}
            maxTick={maxTick}
            finished={simulation.result !== null}
            camera={camera.camera}
            onTogglePlay={onTogglePlay}
            onSpeedChange={playback.setSpeed}
            onSeek={onSeek}
          />
        </Stack>
      )}
    </Stack>
  );
}
