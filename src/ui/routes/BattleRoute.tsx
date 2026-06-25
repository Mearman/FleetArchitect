import {
  Badge,
  Box,
  Button,
  Center,
  Group,
  Loader,
  Stack,
  Text,
  Tooltip,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import {
  IconMaximize,
  IconMinus,
  IconPlayerPause,
  IconPlayerPlay,
  IconPlayerStop,
  IconPlus,
  IconSwords,
} from "@tabler/icons-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { TICKS_PER_SECOND } from "@/domain/simulation/types";
import { useFleets, useShipDesigns } from "@/ui/hooks/storage";
import { normaliseAnomalies } from "@/schema/battle";
import type { BattleAnomalyKind, BattleFrame } from "@/schema/battle";
import type { DescriptorMap } from "@/ui/cellLayout";
import { interpolateFrame } from "@/ui/interpolateFrame";
import { usePreferences } from "@/ui/preferences/usePreferences";
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
import { useBattleUrlSync } from "./useBattleUrlSync";
import type { SharedBattleMatchup } from "./useBattleUrlSync";
import { AnnunciatorButton, AnnunciatorLamp } from "@/ui/components/Annunciator";
import { panelScrews } from "@/ui/components/panel.css";
import { screenPowerOn } from "@/ui/fx/CrtOverlay.css";
import { CrtScreen } from "@/ui/fx/CrtScreen";
import { bezelGroup, bezelStrip, screenChassis } from "@/ui/components/screen.css";
import * as styles from "./BattleRoute.css";

export function BattleRoute() {
  const fleets = useFleets();
  const designs = useShipDesigns();
  const [attackerId, setAttackerId] = useState<string | null>(null);
  const [defenderId, setDefenderId] = useState<string | null>(null);
  const [anomalies, setAnomalies] = useState<BattleAnomalyKind[]>([]);
  const [seed, setSeed] = useState(1);

  /**
   * User preferences governing auto-start behaviour. Read once at the top of
   * the route so both the URL-sync effect and the onFirstBatch/onComplete gates
   * see the same persisted values on the first render.
   */
  const { preferences: prefs } = usePreferences();

  /**
   * A shared-battle matchup held for manual start when auto-start is off. The
   * URL-sync effect populates this in lieu of firing `startBattle` itself; the
   * idle-screen Start prompt drives `simulation.startBattle` from it and clears
   * it so a subsequent local engage does not resurrect the held link.
   */
  const [heldMatchup, setHeldMatchup] = useState<SharedBattleMatchup | null>(null);
  const onSharedBattleHeld = useCallback((m: SharedBattleMatchup) => {
    setHeldMatchup(m);
  }, []);

  /** Active tab within the controls panel. */
  const [controlsTab, setControlsTab] = useState<"layers" | "modules">("layers");

  /** Whether the fog-of-war / awareness overlay is shown (default: off). */
  const [showFog, setShowFog] = useState(false);
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

  // Mirror the battle config to/from the URL so the address bar is the
  // shareable scenario: a complete local matchup is encoded into the path, and
  // an externally-pasted /battle/<payload> link replays that exact battle.
  useBattleUrlSync({
    fleets,
    designs,
    attackerId,
    defenderId,
    anomalies,
    seed,
    setAnomalies,
    setSeed,
    startBattle: (attacker, defender, chosenAnomalies, chosenSeed, allDesigns) => {
      void simulation.startBattle(attacker, defender, chosenAnomalies, chosenSeed, allDesigns);
    },
    autoStart: prefs.autoStartComputationOnLoad,
    onSharedBattleHeld,
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
    activeAnomalies: simulation.activeAnomalies,
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
    // The controls wing is always present once a battle is running, so refresh
    // the status frame whenever there are frames to read.
    statusOpen: hasFrames,
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
        // Only auto-start playback on the first batch when the user has it on
        // AND wants it to trigger when the buffer is ready. The "onComplete"
        // mode is handled by the completion effect below.
        if (prefs.autoStartPlayback && prefs.playbackStartMode === "whenBuffered") {
          playback.setPlaying(true);
        }
      },
    };
  }, [playback, camera, prefs]);

  /**
   * Ref guarding the on-completion auto-start effect from re-firing when prefs
   * change after a result has already landed. Holds the id of the result the
   * effect last auto-started playback for; the effect bails when it matches the
   * current result so a preference toggle does not restart a finished battle.
   */
  const autoStartedResultIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (simulation.result === null) return;
    if (autoStartedResultIdRef.current === simulation.result.id) return;
    autoStartedResultIdRef.current = simulation.result.id;
    if (prefs.autoStartPlayback && prefs.playbackStartMode === "onComplete") {
      playbackTimeRef.current = 0;
      playback.setPlaybackTime(0);
      playback.setPlaying(true);
    }
  }, [simulation.result, prefs, playback]);

  /** Authoritative max tick: the streamed leading edge while computing, the
   *  final tick count once the result has landed. */
  const maxTick = simulation.result !== null ? simulation.result.ticks : simulation.computedTicks;

  const playbackTick = hasFrames
    ? Math.min(maxTick, playback.playbackTime * TICKS_PER_SECOND)
    : 0;
  const currentTick = Math.floor(playbackTick);

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
    void simulation.startBattle(attacker, defender, normaliseAnomalies(anomalies), seed, designs);
    setHeldMatchup(null);
  }

  /**
   * Auto-roll a matchup: pick two (different, when possible) fleets and a random
   * seed, reflect the picks in the setup UI, and start the battle. The currently-
   * selected spatial anomalies are kept as-is (not re-rolled).
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

    const chosenAnomalies = normaliseAnomalies(anomalies);
    const chosenSeed = Math.floor(Math.random() * 0xffffffff);

    setAttackerId(attacker.id);
    setDefenderId(defender.id);
    setSeed(chosenSeed);
    void simulation.startBattle(attacker, defender, chosenAnomalies, chosenSeed, designs);
    notifications.show({
      title: "AI vs AI",
      message: `${attacker.name} vs ${defender.name}.`,
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
      anomalies={anomalies}
      seed={seed}
      fleetOptions={fleetOptions}
      computing={simulation.computing}
      hasFleets={fleets.length > 0}
      onAttackerIdChange={setAttackerId}
      onDefenderIdChange={setDefenderId}
      onAnomaliesChange={setAnomalies}
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
    <div className={styles.routeRoot}>
      {/* Slim one-line title strip — amber mono label with winner badge inline. */}
      <div className={styles.titleStrip}>
        <span>Battle Arena</span>
        {simulation.result !== null && (
          <Badge size="sm" color={winnerBadgeColor}>
            {simulation.result.winner === "draw"
              ? "Draw"
              : `${simulation.result.winner.toUpperCase()} WINS`}
          </Badge>
        )}
      </div>

      <BattleWorkspace
        setupContent={setupContent}
        controlsContent={controlsContent}
        hasFrames={hasFrames}
      >
        {!hasFrames ? (
          <div className={styles.centreColumn}>
            <Box className={`${screenChassis} ${panelScrews} ${styles.screenChassisFill}`}>
              {/* The idle prompt sits on the powered-on display itself, not a
                  separate panel — an empty screen waiting for a battle. */}
              <Box className={`${styles.canvasBox} ${screenPowerOn}`}>
                <CrtScreen />
                <div className={styles.glassGlare} aria-hidden="true" />
                <Center h="100%">
                  {heldMatchup !== null ? (
                    <Stack align="center" gap="xs">
                      <IconSwords size={40} color="var(--mantine-color-dimmed)" />
                      <Text c="dimmed">
                        Shared battle loaded: {heldMatchup.attacker.name} vs{" "}
                        {heldMatchup.defender.name}
                      </Text>
                      <Button
                        onClick={() => {
                          const m = heldMatchup;
                          setHeldMatchup(null);
                          void simulation.startBattle(
                            m.attacker,
                            m.defender,
                            m.anomalies,
                            m.seed,
                            m.designs,
                          );
                        }}
                      >
                        Start
                      </Button>
                    </Stack>
                  ) : simulation.computing ? (
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
            </Box>
          </div>
        ) : (
          <div className={styles.centreColumn}>
            <Box className={`${screenChassis} ${panelScrews} ${styles.screenChassisFill}`}>
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
              </Box>

              {/* Bezel strip — indicator lamps and camera buttons mounted on the
                  chassis, not floating on the glass. */}
              <Box className={bezelStrip}>
                <Group className={bezelGroup} gap={6}>
                  <AnnunciatorLamp tint="amber" lit={simulation.activeAnomalies.length > 0}>
                    {simulation.activeAnomalies.length > 0
                      ? simulation.activeAnomalies.map((a) => ANOMALY_LABEL[a]).join(" + ")
                      : "Open space"}
                    {camera.camera.followId !== null ? " · following" : ""}
                  </AnnunciatorLamp>
                  {showFog && (
                    <AnnunciatorLamp tint="cyan" lit>
                      Fog
                    </AnnunciatorLamp>
                  )}
                  {simulation.result === null &&
                    (simulation.computing || simulation.paused) && (
                      <BattleStatusReadout
                        paused={simulation.paused}
                        buffering={playback.buffering}
                        computedTicks={simulation.computedTicks}
                      />
                    )}
                </Group>

                {/* Computation controls: pause/resume/stop the running battle
                    computation. Shown only while a run is active (running) or
                    held (paused); absent on idle and complete so a finished
                    battle has a clean bezel. */}
                {(simulation.computeStatus === "running" ||
                  simulation.computeStatus === "paused") && (
                  <Group className={bezelGroup} gap={6}>
                    {simulation.computeStatus === "running" ? (
                      <Tooltip label="Pause computation">
                        <AnnunciatorButton
                          icon={<IconPlayerPause size={14} />}
                          aria-label="Pause computation"
                          onClick={simulation.pauseComputation}
                        >
                          Pause
                        </AnnunciatorButton>
                      </Tooltip>
                    ) : (
                      <Tooltip label="Resume computation">
                        <AnnunciatorButton
                          tint="green"
                          icon={<IconPlayerPlay size={14} />}
                          aria-label="Resume computation"
                          onClick={simulation.resumeComputation}
                        >
                          Resume
                        </AnnunciatorButton>
                      </Tooltip>
                    )}
                    <Tooltip label="Stop computation and playback">
                      <AnnunciatorButton
                        icon={<IconPlayerStop size={14} />}
                        aria-label="Stop computation and playback"
                        onClick={() => {
                          simulation.pauseComputation();
                          playback.setPlaying(false);
                        }}
                      >
                        Stop
                      </AnnunciatorButton>
                    </Tooltip>
                  </Group>
                )}

                <Group className={bezelGroup} gap={6}>
                  <Tooltip label="Zoom in">
                    <AnnunciatorButton
                      icon={<IconPlus size={14} />}
                      aria-label="Zoom in"
                      onClick={() => camera.zoomBy(1.4)}
                    />
                  </Tooltip>
                  <Tooltip label="Zoom out">
                    <AnnunciatorButton
                      icon={<IconMinus size={14} />}
                      aria-label="Zoom out"
                      onClick={() => camera.zoomBy(1 / 1.4)}
                    />
                  </Tooltip>
                  <Tooltip label="Auto-fit live ships">
                    <AnnunciatorButton
                      tint="green"
                      active={camera.camera.autoFit}
                      icon={<IconMaximize size={14} />}
                      aria-label="Auto-fit live ships"
                      onClick={camera.restoreAutoFit}
                    />
                  </Tooltip>
                </Group>
              </Box>
            </Box>

            <PlaybackControls
              playing={playback.playing}
              speed={playback.speed}
              currentTick={currentTick}
              playbackTick={playbackTick}
              maxTick={maxTick}
              finished={simulation.result !== null}
              camera={camera.camera}
              onTogglePlay={onTogglePlay}
              onSpeedChange={playback.setSpeed}
              onSeek={onSeek}
              onRestoreFit={camera.restoreAutoFit}
              onProjectionChange={(mode) =>
                camera.setCamera((c) => ({ ...c, projection: mode }))
              }
            />
          </div>
        )}
      </BattleWorkspace>
    </div>
  );
}
