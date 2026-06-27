# Fleet Architect

A modern, browser-based reimagining of [Gratuitous Space Battles][gsb]. Design
individual spaceships, compose them into fleets with a doctrine, and watch a
deterministic autonomous space battle play out. You don't fly the ships — you
architect the fleet and set the orders.

[gsb]: https://store.steampowered.com/app/41800/Gratuitous_Space_Battles/

## Status

Alpha. Ship designer, fleet builder, and a deterministic battle simulator with
replay. Designs and fleets are saved in your browser (IndexedDB) and shared via
data URLs.

## Roadmap

The ship model is a Cosmoteer-style tile grid, with the physical model and
gameplay parity layered on top. The simulation runs off the main thread.

| Feature | Status |
|---------|--------|
| Per-module damage, power grid, ammo, point-defence, repair, shields | Shipped |
| Structural break-apart, directional thrusters, module facing | Shipped |
| Rigid-body physics (centre of mass, moment of inertia, recoil, hit impulse) | Shipped |
| Tile-grid ship model (cells: empty / hull-tile / module) — the keystone | Shipped |
| Tile-painting Ship Designer | Shipped |
| Grid-exact break-apart adjacency (4-connected) | Shipped |
| Break-apart with conserved linear + angular momentum | Shipped |
| Cell-precise hits (a shot strikes a cell; penetration carries to the cell behind) | Shipped |
| Cell-level collision (ships are solid at cell granularity; impulse response) | Shipped |
| Simulation in a Web Worker behind an async runner contract | Shipped |
| Playback speed, simulation tick rate, and display refresh fully independent | Shipped |
| Independently-rotating turrets (track targets off the ship's facing) | Shipped |
| Tactical order system (formation, stance, focus-fire, range-keeping) | Shipped |
| Faction / race part sets | Shipped |
| Crew as physical entities (corridor pathfinding, manned stations, hauled power and ammo) | Shipped |
| Sensors, communications, and fog of war (per-ship awareness, comms relays, geometric occlusion, last-known ghosts) | Shipped |
| Directional sensors (omni/directional/dish/variable cones mirroring comms; cone fog coverage) | Shipped |
| Version history for ship and fleet designs (revision snapshots, restore, history panel) | Shipped |
| Player-authored AI rules (trigger/action pairs wired into movement and targeting) | Shipped |
| Formation authoring — nested formation trees, formation-scoped doctrine (posture presets + unified rule editor), deployment preview canvas, reusable formation templates shared by reference | Shipped |
| Life support / atmosphere — hull breaches vent atmos; crew take vacuum damage; overlay shows state | Shipped |
| Sensor data visualisation — EM pulses travel at c, reflect off contacts, fade by strength | Shipped |
| Boarding pods rendered as block grids; debris collection; disabled-hull salvage and claiming | Shipped |
| Physics constants grounded (propellant flow from drive spec, black-hole Schwarzschild, Beer–Lambert nebula) | Shipped |
| Opt-in astronomical-scale arena — ships 300,000 km apart; light-lag and aberration visible | Shipped |
| Async online challenges (submit a fleet, others fight it) — needs a sync server | Future |
| Campaign / career progression (economy, bounties, unlocks) | Future |
| Manual / direct control (WASD flight, aim and fire) | Maybe |

## Develop

```bash
pnpm install
pnpm dev      # http://localhost:5173/
pnpm test     # pure-layer unit tests
pnpm build    # production build to dist/
```

Requires Node 20+ and pnpm.

## Deploy

Pushes to `main` run the GitHub Actions workflow (`.github/workflows/deploy.yml`),
which typechecks, builds, and publishes `dist/` to GitHub Pages. The app uses a
hash router, so deep links survive refresh under the `/FleetArchitect/` base path.

## Architecture

See [`CLAUDE.md`](./CLAUDE.md) for the full conventions. In short: Zod schemas
are the single source of truth, the simulation engine is pure and deterministic,
storage sits behind a swappable contract, and the UI is the only layer that
touches the DOM.
