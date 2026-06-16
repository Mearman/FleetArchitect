# Fleet Architect

A modern, browser-based reimagining of [Gratuitous Space Battles][gsb]. Design
individual spaceships, compose them into fleets with a doctrine, and watch a
deterministic autonomous space battle play out. You don't fly the ships — you
architect the fleet and set the orders.

[gsb]: https://store.steampowered.com/app/41800/Gratuitous_Space_Battles/

## Status

Alpha. Ship designer, fleet builder, and a deterministic battle simulator with
replay. Designs and fleets are saved in your browser (IndexedDB) and shared via
data URLs; a sync server is planned.

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
