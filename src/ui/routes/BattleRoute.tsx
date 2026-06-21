import {
  ActionIcon,
  Badge,
  Box,
  Center,
  Group,
  Loader,
  Paper,
  Stack,
  Text,
  Title,
  Tooltip,
} from "@mantine/core";
import { useIsMobile } from "@/ui/responsive/useViewport";
import { notifications } from "@mantine/notifications";
import {
  IconMaximize,
  IconMinus,
  IconPlus,
  IconSwords,
} from "@tabler/icons-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { useFleets, useShipDesigns } from "@/ui/hooks/storage";
import { BattleAnomaly } from "@/schema/battle";
import type { BattleAnomaly as BattleAnomalyType, BattleFrame } from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import { interpolateFrame } from "@/ui/interpolateFrame";
import { DEFAULT_CAMERA } from "./battleCamera";
import type { Camera } from "./battleCamera";
import { ANOMALY_LABEL } from "./battleConstants";
import { BattleControlsPanel } from "./BattleControlsPanel";
import { BattleSetupPanel } from "./BattleSetupPanel";
import { BattleStatusReadout } from "./BattleStatusReadout";
import { BattleWorkspace } from "./BattleWorkspace";
import { PlaybackControls } from "./PlaybackControls";
import { OVERLAYS } from "./overlays";
import type { OverlayScope } from "./overlays";
import { useBattleCamera } from "./useBattleCamera";
import { useBattleCanvas } from "./useBattleCanvas";
import { useBattlePlayback } from "./useBattlePlayback";
import { useBattleSimulation } from "./useBattleSimulation";
import { touchTarget } from "@/ui/components/panel.css";
import { screenPowerOn } from "@/ui/fx/CrtOverlay.css";
import { CrtScreen } from "@/ui/fx/CrtScreen";
import * as styles from "./BattleRoute.css";

export function BattleRoute() {
  const fleets = useFleets();
  const designs = useShipDesigns();
  const isMobile = useIsMobile();
  const [attackerId, setAttackerId] = useState<string | null>(null);
  const [defenderId, setDefenderId] = useState<string | null>(null);
  const [anomaly, setAnomaly] = useState<BattleAnomalyType>("none");
  const [seed, setSeed] = useState(1);

  /**
   * Whether the setup dock/drawer is expanded. Defaults to true so the user
   * can immediately pick fleets; collapses to a rail when the first batch
   * arrives so the battle takes centre stage without vanishing the setup.
   */
  const [setupOpen, setSetupOpen] = useState(true);
  /**
   * Whether the controls dock/drawer (layers + modules) is expanded.
   * Starts closed; the user opens it when they want to toggle overlays or
   * inspect module status.
   */
  const [controlsOpen, setControlsOpen] = useState(false);
  /** Active tab within the controls panel. */
  const [controlsTab, setControlsTab] = useState<"layers" | "modules">("layers");

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
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cameraRef = useRef<Camera>(DEFAULT_CAMERA);
  const framesRef = useRef<BattleFrame[]>([]);
  const simTickRateRef = useRef(0);
  const playbackTimeRef = useRef(0);
  const bufferingRef = useRef(false);
  const descriptorsRef = useRef<DescriptorMap>(new Map());

  /**
   * Latest-callback ref for the simulation hook's cross-hook resets. The
   * simulation hook is called before playback/camera (it produces the values
   * they consume), but its `onFirstBatch`/`resetForNewRun` side-effects need
   * playback and camera setters (stable, but not yet bound when the simulation
   * hook runs). The ref holds the latest closures, kept current by the effect
   * below; `onFrames` (a worker callback) fires well after render, so the ref
   * is always current by the time it reads.
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
    descriptorsRef,
    resetForNewRun: () => engineCallbacksRef.current.resetForNewRun(),
    onFirstBatch: () => engineCallbacksRef.current.onFirstBatch(),
  });

  /**
   * Whether any frames have streamed in yet. The canvas stage and all the
   * draw/playback machinery key off this rather than `result`, so playback can
   * begin the moment the first batch arrives — long before the final result
   * resolves.
   */
  const hasFrames = simulation.frameCount > 0;

  // --- Camera hook (canvas sizing/camera state/pointer) -------------------
  const camera = useBattleCamera({
    canvasRef,
    cameraRef,
    playbackTimeRef,
    framesRef,
    descriptorsRef,
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

  // Per-ship faction from the battle roster, so the canvas can tint each ship
  // by its faction palette.
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
    descriptors: simulation.descriptors,
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
    // Gate statusFrame updates on the controls dock being open so we skip the
    // React state update when the panel is hidden.
    statusOpen: controlsOpen,
    canvasSize: camera.canvasSize,
  });

  // Keep the engine-callbacks ref current after every render.
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
        // Collapse setup dock to rail — the battle takes centre stage but
        // the user can still re-expand without a full-width layout shift.
        setSetupOpen(false);
        playback.setPlaying(true);
      },
    };
  }, [playback, camera]);

  /** Authoritative max tick: the streamed leading edge while computing, the
   *  final tick count once the result has landed. */
  const maxTick = simulation.result !== null ? simulation.result.ticks : simulation.computedTicks;

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
   * the battle.
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
   * Toggle play/pause. Restarts from the top when paused at the true end of a
   * finished battle; mid-stream it resumes rather than rewinds.
   */
  const onTogglePlay = () => {
    if (simulation.result !== null && currentTick >= simulation.result.ticks) {
      playbackTimeRef.current = 0;
      playback.setPlaybackTime(0);
    }
    playback.setPlaying((p) => !p);
  };

  const onTogglePlayRef = useRef(onTogglePlay);
  useEffect(() => {
    onTogglePlayRef.current = onTogglePlay;
  });

  // Space-bar toggles play/pause when the canvas is active.
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
    return (
      <Text c="dimmed" role="status" aria-live="polite">
        Loading…
      </Text>
    );
  }

  const winnerBadgeColor =
    simulation.result?.winner === "attacker"
      ? "red"
      : simulation.result?.winner === "defender"
        ? "blue"
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

  const setupContent = (
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
  );

  const controlsContent = (
    <BattleControlsPanel
      showFog={showFog}
      onFogChange={setShowFog}
      overlays={overlays}
      onOverlayChange={(id, patch) =>
        setOverlays((prev) => {
          const cur = prev[id];
          if (cur === undefined) return prev;
          return { ...prev, [id]: { ...cur, ...patch } };
        })
      }
      frame={playback.statusFrame}
      descriptors={simulation.descriptors}
      activeTab={controlsTab}
      onTabChange={setControlsTab}
    />
  );

  return (
    <Stack gap="md">
      <Group justify="space-between" align="center">
        <Title order={1}>Battle Arena</Title>
        {simulation.result !== null && (
          <Badge size="lg" color={winnerBadgeColor}>
            {simulation.result.winner === "draw"
              ? "Draw"
              : `${simulation.result.winner.toUpperCase()} WINS`}
          </Badge>
        )}
      </Group>

      <BattleWorkspace
        setupContent={setupContent}
        controlsContent={controlsContent}
        setupOpen={setupOpen}
        controlsOpen={controlsOpen}
        onSetupToggle={() => setSetupOpen((o) => !o)}
        onControlsToggle={() => setControlsOpen((o) => !o)}
        isMobile={isMobile}
        hasFrames={hasFrames}
      >
        {!hasFrames ? (
          <Stack gap="sm">
            <Paper p={0} withBorder className={styles.stage}>
              {/* The idle prompt sits on the powered-on display itself, not a
                  separate panel — an empty screen waiting for a battle. */}
              <Box className={`${styles.canvasBox} ${screenPowerOn}`}>
                <CrtScreen />
                <div className={styles.glassGlare} aria-hidden="true" />
                <Center h="100%">
                  {simulation.computing ? (
                    <Stack align="center" gap="xs">
                      <Loader />
                      <Text c="dimmed">Computing battle…</Text>
                    </Stack>
                  ) : (
                    <Stack align="center" gap="xs">
                      <IconSwords size={40} color="var(--mantine-color-dimmed)" />
                      <Text c="dimmed">
                        Pick two fleets and engage to watch the battle.
                      </Text>
                    </Stack>
                  )}
                </Center>
              </Box>
            </Paper>
          </Stack>
        ) : (
          <Stack gap="sm">
            <Paper p={0} withBorder className={styles.stage}>
              <Box className={`${styles.canvasBox} ${screenPowerOn}`}>
                {/* CRT screen effects (scanlines, vignette, aberration), confined to this display. */}
                <CrtScreen />
                {/* Glass-glare overlay: diagonal highlight visible only at data-fx="full". */}
                <div className={styles.glassGlare} aria-hidden="true" />
                <canvas
                  ref={canvasRef}
                  className={`${styles.canvas}${camera.dragging ? ` ${styles.canvasGrabbing}` : ""}`}
                  onPointerDown={camera.handlePointerDown}
                  onPointerMove={camera.handlePointerMove}
                  onPointerUp={camera.handlePointerUp}
                  onPointerCancel={camera.handlePointerUp}
                  aria-label="Battle canvas — drag to pan, scroll or use +/− buttons to zoom"
                />

                <Badge
                  className={styles.anomalyLegend}
                  size="sm"
                  variant="outline"
                  color="amber"
                >
                  {ANOMALY_LABEL[simulation.activeAnomaly]}
                  {camera.camera.followId !== null ? " · following" : ""}
                </Badge>

                {showFog && (
                  <Badge className={styles.fogLegend} size="sm" variant="outline" color="cyan">
                    Fog of war
                  </Badge>
                )}

                {/* Camera controls — zoom and fit only; layer/status toggles live in the dock */}
                <Group className={styles.cameraControls} gap={4}>
                  <Tooltip label="Zoom in">
                    <ActionIcon
                      size="md"
                      className={touchTarget}
                      variant="default"
                      aria-label="Zoom in"
                      onClick={() => camera.zoomBy(1.4)}
                    >
                      <IconPlus size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Zoom out">
                    <ActionIcon
                      size="md"
                      className={touchTarget}
                      variant="default"
                      aria-label="Zoom out"
                      onClick={() => camera.zoomBy(1 / 1.4)}
                    >
                      <IconMinus size={16} />
                    </ActionIcon>
                  </Tooltip>
                  <Tooltip label="Auto-fit live ships">
                    <ActionIcon
                      size="md"
                      className={touchTarget}
                      variant={camera.camera.autoFit ? "filled" : "default"}
                      aria-label="Auto-fit live ships"
                      onClick={camera.restoreAutoFit}
                    >
                      <IconMaximize size={16} />
                    </ActionIcon>
                  </Tooltip>
                </Group>

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
              onRestoreFit={camera.restoreAutoFit}
            />
          </Stack>
        )}
      </BattleWorkspace>
    </Stack>
  );
}
