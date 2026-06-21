## [1.13.1](https://github.com/Mearman/FleetArchitect/compare/v1.13.0...v1.13.1) (2026-06-21)


### Bug Fixes

* **storage:** reseed stale sourceless preset records so the battle stops crashing ([e19334c](https://github.com/Mearman/FleetArchitect/commit/e19334c2bfccae17e3f48b7d4a7f2ea7141d19f5))

# [1.13.0](https://github.com/Mearman/FleetArchitect/compare/v1.12.1...v1.13.0) (2026-06-21)


### Features

* **hull:** smooth hexadecilinear hull outline in the designer, traced around armour and walls ([376bd2d](https://github.com/Mearman/FleetArchitect/commit/376bd2d90e67c42d913c0e084f735c56b4f45153))

## [1.12.1](https://github.com/Mearman/FleetArchitect/compare/v1.12.0...v1.12.1) (2026-06-21)


### Bug Fixes

* **sim:** conserve atmosphere mass so the battle worker stops emitting NaN ([cbf4188](https://github.com/Mearman/FleetArchitect/commit/cbf41888f9eb44bf4affa014d9b57109484af5ab))


### Performance Improvements

* **sim:** only run atmosphere advection when a ship is breached ([224faaa](https://github.com/Mearman/FleetArchitect/commit/224faaaaaca806091435cf9660733cddbe1d04e8)), closes [air-rushing-throu#a-breach](https://github.com/air-rushing-throu/issues/a-breach)

# [1.12.0](https://github.com/Mearman/FleetArchitect/compare/v1.11.0...v1.12.0) (2026-06-21)


### Features

* **battle:** collapsible docks, unified layers panel, rehouse module status ([be75bc6](https://github.com/Mearman/FleetArchitect/commit/be75bc64863d7b77eb45dd4abccda7753b0cbc66))

# [1.11.0](https://github.com/Mearman/FleetArchitect/compare/v1.10.0...v1.11.0) (2026-06-21)


### Features

* **canvas:** cassette-cyberpunk palette, SIDE_COLOUR, backdrop starfield ([b22a9ce](https://github.com/Mearman/FleetArchitect/commit/b22a9ce154c9c1f8ac76a2a43c322b1e4226f11d))
* **fx:** crt overlay, FxContext, FxToggle wired into layout ([c8eb34d](https://github.com/Mearman/FleetArchitect/commit/c8eb34d0cb99271659bd7e73cb9f0ff6df6b613b))
* **responsive:** mobile bottom-sheet battle controls, touch targets, canvas height ([7016cc6](https://github.com/Mearman/FleetArchitect/commit/7016cc680b1f8209cd0c2a23c7658da39be8fd90))
* **theme:** cassette-futurism token layer, Mantine theme, fontsource typography ([c7578f3](https://github.com/Mearman/FleetArchitect/commit/c7578f362cbac00ad3a5e2c2756b82364b55411e))
* **ui:** cassette chrome on battle route — neon canvas frame, HUD palette ([af12f47](https://github.com/Mearman/FleetArchitect/commit/af12f4713de7926169b85b9084a304c8e5522a66))
* **ui:** cassette chrome on fleet builder ([4101989](https://github.com/Mearman/FleetArchitect/commit/41019891fd036a1b68572001b6c6615df5cffe0e))
* **ui:** cassette chrome on HomeRoute ([33a87e9](https://github.com/Mearman/FleetArchitect/commit/33a87e9ed1a99d7c56413a492bf2d4a592748341))
* **ui:** cassette chrome on ship designer — cell colours, palette remap ([f5c5527](https://github.com/Mearman/FleetArchitect/commit/f5c55276b095dc5a60b883c097d85998bc32f88e))
* **ui:** cassette panel shared chrome component ([d3e9414](https://github.com/Mearman/FleetArchitect/commit/d3e94146ba054cb78ecddd5de137c35264d2c357))

# [1.10.0](https://github.com/Mearman/FleetArchitect/compare/v1.9.0...v1.10.0) (2026-06-21)


### Features

* **ai:** wire aiRetreat/aiRally/aiStance into movement and targeting ([1a8ef6e](https://github.com/Mearman/FleetArchitect/commit/1a8ef6e921359748733dce69a849dd37f77c4fa0))
* **battle:** opt-in astronomical-scale arena mode — light-lag visible at 300,000 km ([ef5afa2](https://github.com/Mearman/FleetArchitect/commit/ef5afa2865a8cb10596464ab77ab9a1beaa8247b))
* **history:** wire saveShipDesign/saveFleet through all callers and activate history panels ([9287cd5](https://github.com/Mearman/FleetArchitect/commit/9287cd57284a35aacc2d24337b81ec2a48871a12))
* **overlay:** atmosphere and hull breach visualisation ([37b4ae4](https://github.com/Mearman/FleetArchitect/commit/37b4ae4db3cde648aa74ff8d2cbd4250368f0cab))
* **overlay:** sensor pulse visualisation — expanding arcs, reflections, emission flashes ([dc660a8](https://github.com/Mearman/FleetArchitect/commit/dc660a8695c9fc02ad3ba6d7fbc6fa6a3e863687))
* **renderer:** boarding pods as block grids; debris and salvage overlay ([e0d20b2](https://github.com/Mearman/FleetArchitect/commit/e0d20b265583d4f3b393ce08b9d57bdf784d5939))
* **salvage:** deterministic debris collection and hull-claiming mechanics ([3b9bef7](https://github.com/Mearman/FleetArchitect/commit/3b9bef74bb7037223674fc76494eab752bc45755))
* **snapshot:** crew injured state, atmosphere/breach, pulse strength, pod cells, debris ([687cfb1](https://github.com/Mearman/FleetArchitect/commit/687cfb186ee2ef74ce9f0de55434cc79ff96f3b9))

# [1.9.0](https://github.com/Mearman/FleetArchitect/compare/v1.8.0...v1.9.0) (2026-06-21)


### Features

* **presets:** add mixed-composition fleets for Foundry and Corsair ([4649ca6](https://github.com/Mearman/FleetArchitect/commit/4649ca6d07f749825ec193824c35a1fd5226259d))

# [1.8.0](https://github.com/Mearman/FleetArchitect/compare/v1.7.1...v1.8.0) (2026-06-21)


### Bug Fixes

* **ai:** add missing stance configs; rally overrides formation-keeping ([8494fbf](https://github.com/Mearman/FleetArchitect/commit/8494fbf33ea89e38270a696a465f3c633881a761))


### Features

* **presets:** expand faction ship rosters — Foundry, Corsair, Synthetic ([c4218ca](https://github.com/Mearman/FleetArchitect/commit/c4218ca8df8417467a9ca9beba56499e23795ec3))
* **sim:** chain-reaction blasts propagate to adjacent ships within blast radius ([6a7dfb4](https://github.com/Mearman/FleetArchitect/commit/6a7dfb41a8f36b8178e52067b51a6fd808ef8d64))
* **sim:** debris blocks EM sight lines and deals kinetic collision damage ([79e87fc](https://github.com/Mearman/FleetArchitect/commit/79e87fc33df6830b140c034b16b05a21d88fb845))
* **sim:** enforce brownout, dry-tank flame-out, overheat shutdown; re-enable atmo advection ([76427e1](https://github.com/Mearman/FleetArchitect/commit/76427e1497c54bc67cfdea05b7d8ec7173bb5070))
* **sim:** hull outline polygon as collision geometry — hitscan entry and ship-ship narrow-phase ([86b198f](https://github.com/Mearman/FleetArchitect/commit/86b198fc2e99798021ecbf35ef977e234c422662))
* **sim:** wall-edge barriers and scaffold damage tier ([c8c7d11](https://github.com/Mearman/FleetArchitect/commit/c8c7d1177b70620de52529874e6beed89312f8fb))

# [1.8.0](https://github.com/Mearman/FleetArchitect/compare/v1.7.1...v1.8.0) (2026-06-21)


### Bug Fixes

* **ai:** add missing stance configs; rally overrides formation-keeping ([8494fbf](https://github.com/Mearman/FleetArchitect/commit/8494fbf33ea89e38270a696a465f3c633881a761))


### Features

* **sim:** chain-reaction blasts propagate to adjacent ships within blast radius ([6a7dfb4](https://github.com/Mearman/FleetArchitect/commit/6a7dfb41a8f36b8178e52067b51a6fd808ef8d64))
* **sim:** debris blocks EM sight lines and deals kinetic collision damage ([79e87fc](https://github.com/Mearman/FleetArchitect/commit/79e87fc33df6830b140c034b16b05a21d88fb845))
* **sim:** enforce brownout, dry-tank flame-out, overheat shutdown; re-enable atmo advection ([76427e1](https://github.com/Mearman/FleetArchitect/commit/76427e1497c54bc67cfdea05b7d8ec7173bb5070))
* **sim:** hull outline polygon as collision geometry — hitscan entry and ship-ship narrow-phase ([86b198f](https://github.com/Mearman/FleetArchitect/commit/86b198fc2e99798021ecbf35ef977e234c422662))

## [1.7.1](https://github.com/Mearman/FleetArchitect/compare/v1.7.0...v1.7.1) (2026-06-21)


### Bug Fixes

* **sim:** stable instanceIds and deep-copy catalog effects for cross-battle determinism ([a5652d6](https://github.com/Mearman/FleetArchitect/commit/a5652d6ae0c8a11d456ca90675a37761518ca461))

# [1.7.0](https://github.com/Mearman/FleetArchitect/compare/v1.6.0...v1.7.0) (2026-06-20)


### Features

* **presets:** re-author ships at 1 m scale and force preset reseed ([3c1cc54](https://github.com/Mearman/FleetArchitect/commit/3c1cc543ed72ece8bb866fd1a575c3f73dbbf861))
* **shipgen:** pure subdivision generator for 1 m layered hulls ([eac5a78](https://github.com/Mearman/FleetArchitect/commit/eac5a78c269b29d791d6b37427829fbb0174b0cd))


### Performance Improvements

* **render,engine:** cache static ship sprites; bound O(n^2) damage/power paths ([59461c3](https://github.com/Mearman/FleetArchitect/commit/59461c38c57449e59f813d87501091e93a349409))
* **snapshot:** derive cell positions from ship pose; emit static grid once ([2c73822](https://github.com/Mearman/FleetArchitect/commit/2c738222e7b82e12e35c8aa63bd3f130033f721a))

# [1.6.0](https://github.com/Mearman/FleetArchitect/compare/v1.5.0...v1.6.0) (2026-06-20)


### Features

* **ai:** wire all 5 AiState outputs — focusFire, retreat, prioritiseRepair, rally, stance ([2c49fc6](https://github.com/Mearman/FleetArchitect/commit/2c49fc6e41eb76a14e21abe8e756ab72e1dbe9c5))
* **schema:** add mode/sweepRate/emitStrength/passiveBands/gain to SensorEffect ([f4d451e](https://github.com/Mearman/FleetArchitect/commit/f4d451e52c70ae148fa55a8f89d4e4f6760f8791))
* **schema:** expose surface hp, door states and resource state in battle snapshot ([a088c8b](https://github.com/Mearman/FleetArchitect/commit/a088c8ba30baaf168bb0ae65f01808b1e06b17dd))
* **sim:** apply time dilation to shield recharge, repair, and crew advancement ([485198d](https://github.com/Mearman/FleetArchitect/commit/485198d8069d310199477625a4409f9f05b29245))
* **sim:** compute hull outline for break-apart chunk ships ([22f0f77](https://github.com/Mearman/FleetArchitect/commit/22f0f77d3b039b65194764463bf323bde53a10be))
* **sim:** live airtightness — hull breaches vent compartments and expose crew to vacuum ([f9130f8](https://github.com/Mearman/FleetArchitect/commit/f9130f8e770d48fd4485a5c396bb3636d7a1b1e6))
* **sim:** n-body gravity with stable id-sorted accumulation; ground SIM.blackHole constants ([e9b670f](https://github.com/Mearman/FleetArchitect/commit/e9b670ff4022e5fe6f742935b232584d54278f20))
* **sim:** relativistic collision KE via numerically stable identity ([b0b60aa](https://github.com/Mearman/FleetArchitect/commit/b0b60aa8c5f48b8daa898c31bb5b8955089852a0))
* **sim:** relativistic p=gamma*m*v momentum integrator with closed-form velocity update ([d3fe0d6](https://github.com/Mearman/FleetArchitect/commit/d3fe0d6f63e9e4fb59609f9c128198852612532c))
* **sim:** replace instant geometric detection with EM reception (Phase 9) ([96d3c70](https://github.com/Mearman/FleetArchitect/commit/96d3c70de1996d5a71806fed20bd8804b6ec0d17))
* **sim:** restore reactive armour, joules damage accounting; re-enable skipped retreat tests ([6860ae4](https://github.com/Mearman/FleetArchitect/commit/6860ae4a5a30966b570abda579cb22a201592b50))
* **sim:** wire Phase-10 optics — beam divergence, Doppler aberration, and gravitational lensing ([7956de5](https://github.com/Mearman/FleetArchitect/commit/7956de501cf0a2f1ad157448da8d57ed847d6c91))
* **sim:** wire Phase-12 debris field into the live tick loop ([0a929e0](https://github.com/Mearman/FleetArchitect/commit/0a929e0ff9a32d520d6a9cde61b762cf1ab552fe))
* **sim:** wire Phase-8 active radar pulses into tick loop with finite light-speed propagation ([ffa6a37](https://github.com/Mearman/FleetArchitect/commit/ffa6a3772ecb379a2247205b12d8cac09788867a))

# [1.5.0](https://github.com/Mearman/FleetArchitect/compare/v1.4.0...v1.5.0) (2026-06-20)


### Features

* **a11y:** aria-labels, heading hierarchy, loading role=status, canvas label ([219e736](https://github.com/Mearman/FleetArchitect/commit/219e736b7b56c163cd16672ea7d0dddbe6d5ad0d))
* **a11y:** error boundary — class ErrorBoundary + react-router errorElement ([31cbbf8](https://github.com/Mearman/FleetArchitect/commit/31cbbf8e4eb51846fdcc4c0834caa8ac00bceb11))
* **a11y:** focus ring on grid cells, edge indicators as keyboard-accessible buttons ([1bc903a](https://github.com/Mearman/FleetArchitect/commit/1bc903adb412ffb565befdbebb9613bfdd2b8157))
* **battle:** replay UX improvements and canvas responsiveness ([f02437e](https://github.com/Mearman/FleetArchitect/commit/f02437eb9325888acc631d2686734ff558b6139c))
* **designer:** drag-to-paint, responsive layout, Tooltip palette, preset CTA ([c41f1c3](https://github.com/Mearman/FleetArchitect/commit/c41f1c3defd066b81450221a0ee000d09951015b))
* **fleet-builder:** improve Fleet Builder UX ([f7d52c4](https://github.com/Mearman/FleetArchitect/commit/f7d52c474e0087efc2244485463fc587eab17d81))
* **layout:** full-bleed canvas, Container per route, PlaybackControls wrap ([861b0e1](https://github.com/Mearman/FleetArchitect/commit/861b0e13276376266ef98fe015a9a91e01c9dbc9))
* **nav:** active NavLink state, aria-current, mobile Burger + Drawer ([7fa0146](https://github.com/Mearman/FleetArchitect/commit/7fa0146af1193995f54ff610f6cd09fe0561eb97))

# [1.4.0](https://github.com/Mearman/FleetArchitect/compare/v1.3.1...v1.4.0) (2026-06-20)


### Features

* **sim:** crew door-toggling — open on crossing, close when clear (Phase 2) ([933f895](https://github.com/Mearman/FleetArchitect/commit/933f895054c8187b9e4996f38827d4a90cdf3872))

## [1.3.1](https://github.com/Mearman/FleetArchitect/compare/v1.3.0...v1.3.1) (2026-06-20)


### Bug Fixes

* **build:** move edgePositionClass out of .css.ts (vanilla-extract v8 forbids function exports) ([7a2aa1a](https://github.com/Mearman/FleetArchitect/commit/7a2aa1a3b7bb91087efe49990f54ef5bd7dd27e6))

# [1.3.0](https://github.com/Mearman/FleetArchitect/compare/v1.2.0...v1.3.0) (2026-06-20)


### Bug Fixes

* **engine:** advance to engagement range, not the deployment centroid ([7a871e8](https://github.com/Mearman/FleetArchitect/commit/7a871e8e74c75000fd8e3a4d7b8a88b977bf0780))
* **sim,storage:** resolve type and lint issues in Phase 4/9 implementations ([3c72a22](https://github.com/Mearman/FleetArchitect/commit/3c72a225997022a7f46986406b518cb80159c757))
* **sim:** isRetreating uses effective HP (structure + module HP) ([f1248de](https://github.com/Mearman/FleetArchitect/commit/f1248de288dda26809239c2fe4969a28927adaed))
* **test:** set testTimeout to 30s for long-running battle simulations ([e2451cc](https://github.com/Mearman/FleetArchitect/commit/e2451ccad74e7c02bd80a560d5837de76f97ee21))
* **test:** simplify engagement test design and verify battle simulation works ([640bab0](https://github.com/Mearman/FleetArchitect/commit/640bab0d8cf941515726e94a6a67aab00a831749))


### Features

* **designer:** layered brushes + airtightness feedback + preset copy-not-edit (Phase 13) ([c18fc12](https://github.com/Mearman/FleetArchitect/commit/c18fc12535a0474db6479316abe5f90a84f72058))
* **designer:** trigger/action rule editor (phase 8a) ([389470a](https://github.com/Mearman/FleetArchitect/commit/389470ae6b56d53acb318d229419c7543e97c088))
* **designer:** version history browser and copy-to-edit (Phase 8b) ([e76310e](https://github.com/Mearman/FleetArchitect/commit/e76310ed7cf101978a95d6163fee7466152197af))
* **engine:** frictionless Newtonian movement controller ([eda790d](https://github.com/Mearman/FleetArchitect/commit/eda790d1199ddf9c9e1f8c1c981b18076e32ebb7))
* **engine:** ground world-scale constants in real physics (Phase 1) ([6cff3c4](https://github.com/Mearman/FleetArchitect/commit/6cff3c4010cdf8d47db313d571e825ee73cacf74))
* **grid:** layered cell model with surface, edges, and equipment ([71cc0e9](https://github.com/Mearman/FleetArchitect/commit/71cc0e9aa7b7664542569916c62240841138ec8b))
* **outline:** layered-cell shell extractor (Phase 11) ([70ae4fe](https://github.com/Mearman/FleetArchitect/commit/70ae4fe54a729b354302f043a934dba20220bb87))
* **presets:** SI catalogue + preset re-authoring + lethality unblock (Phase 14) ([d9d4966](https://github.com/Mearman/FleetArchitect/commit/d9d4966ac75398ed675dd2ac2d14a76285e3881e))
* **schema:** add AI rules, version history, outline mode, source flag ([a48238c](https://github.com/Mearman/FleetArchitect/commit/a48238c12a3dc8ebce9ad0e9b88ca1b34cd0d168))
* **sim:** chain reactions and kinetic collision damage (Phase 4) ([5f39e18](https://github.com/Mearman/FleetArchitect/commit/5f39e183cfbbea9cbbfcf32bdc23b25d023824da))
* **sim:** compute outline at resolve (Phase 11 wiring) ([d03ce26](https://github.com/Mearman/FleetArchitect/commit/d03ce26b9de42f9664e2d50aa257b6e3866574a8))
* **sim:** crew priority modes (Phase 6, use-deferred) ([a5f80b7](https://github.com/Mearman/FleetArchitect/commit/a5f80b72bba7f87769098dcf48d92f69856e0179))
* **sim:** debris field module (v1, use-deferred) ([8d52268](https://github.com/Mearman/FleetArchitect/commit/8d52268c0f8218c3bbc99b61e29d5c6b6b53ddaa))
* **sim:** outline algorithm + resource-sim subsystems (v1, use-deferred) ([291b1c3](https://github.com/Mearman/FleetArchitect/commit/291b1c3c0449377669bc2234e8ce7b892a07001d))
* **sim:** outline field on SimShip + snapshot emission (Phase 11 wiring) ([f6bf29c](https://github.com/Mearman/FleetArchitect/commit/f6bf29c84a1bf8fb43739121b8141234a2a109b7))
* **sim:** proper-time dilation physics (Phase 4, v1) ([53940bc](https://github.com/Mearman/FleetArchitect/commit/53940bcdf3901d4a69f7f78fd1885752110cea6a))
* **sim:** radar pulse physics (Phase 8, v1) ([62d36e2](https://github.com/Mearman/FleetArchitect/commit/62d36e2f02c81b8d7c213364e281aa5d9fe0930a))
* **sim:** relativistic ray optics (Phase 10, v1) ([279fda5](https://github.com/Mearman/FleetArchitect/commit/279fda5a6771a1d05e220d88bfd20730f8359fdd))
* **sim:** ship AI rule interpreter (Phase 7, v1) ([2b69c66](https://github.com/Mearman/FleetArchitect/commit/2b69c66a1cb3de7c2b026fd11a56415c3fc8421e))
* **sim:** support initial ship velocity ([47d2449](https://github.com/Mearman/FleetArchitect/commit/47d24492813d874c383988c242f732cc3477e0be))
* **sim:** unified EM awareness reception model (Phase 9, v1) ([db2afc7](https://github.com/Mearman/FleetArchitect/commit/db2afc7e81546af8f431fcdfbdff2de40a9cab85))
* **sim:** wire AI interpreter holdFire into the tick loop (Phase 7) ([ac9520e](https://github.com/Mearman/FleetArchitect/commit/ac9520e36fe60eeb9b710eecbf21c64ae61c6e2d))
* **sim:** wire crew priority modes into the crew tick (Phase 6) ([985469b](https://github.com/Mearman/FleetArchitect/commit/985469b8a1b1bf3f073d6fbb11b82e242374eabe))
* **sim:** wire proper-time dilation to weapon cooldowns (Phase 4 complete) ([751c057](https://github.com/Mearman/FleetArchitect/commit/751c057724274360a5b4cc11783d7eeb72ae0f97))
* **sim:** wire resource step into the tick loop (Phase 12) ([5c012e8](https://github.com/Mearman/FleetArchitect/commit/5c012e8ff9b91dc1aeadbbed26451c5f52f36f68))
* **sim:** wire resource step into tick loop with sparse module graph (Phase 12) ([10da0f6](https://github.com/Mearman/FleetArchitect/commit/10da0f64332faabb0c17937ccf398825877bd3c6))
* **storage:** version history and copy API (Phase 9) ([11e54c9](https://github.com/Mearman/FleetArchitect/commit/11e54c9204572621f089635ad934f1fab8965d81))
* **ui:** render chamfered hull outline on the battle canvas (Phase 11 complete) ([33208aa](https://github.com/Mearman/FleetArchitect/commit/33208aa120e75dd2ce64e966053e2497b11bb8a3))


### Performance Improvements

* **sim:** inline flux with faces-by-cell lookup, remove dead functions ([ff1bed8](https://github.com/Mearman/FleetArchitect/commit/ff1bed8a2fdc9adca28dc7aca4b6553bf02014c2))


### Reverts

* remove resource-step tick-loop wiring (37 test failures) ([5af0ce2](https://github.com/Mearman/FleetArchitect/commit/5af0ce2bd9c8aec4f01884f66485f1ca2b885a81))

# [1.2.0](https://github.com/Mearman/FleetArchitect/compare/v1.1.0...v1.2.0) (2026-06-19)


### Features

* **build:** enable React Compiler via a post-transform babel pass ([d6686b1](https://github.com/Mearman/FleetArchitect/commit/d6686b127bfc39b343fac248cd6c8a6c7e277a9e))

# [1.1.0](https://github.com/Mearman/FleetArchitect/compare/v1.0.0...v1.1.0) (2026-06-19)


### Features

* **ui:** show time-since-build tooltip on the version link ([651f38f](https://github.com/Mearman/FleetArchitect/commit/651f38f3c9ec06332462845574b1a8ca0fd3089f))

# 1.0.0 (2026-06-19)


### Bug Fixes

* **designer:** handle floor cell kind in cellColour and cellLabel ([ddfe71a](https://github.com/Mearman/FleetArchitect/commit/ddfe71aacf4713c3649e01b21e55732a3a450e76))
* **domain:** mirror defender fleet to the opposite arena side ([0088f9b](https://github.com/Mearman/FleetArchitect/commit/0088f9b168c8e938495c34d0d4a114f0451059a5))
* **presets,tests:** update Orders literals to include new required fields ([783abfe](https://github.com/Mearman/FleetArchitect/commit/783abfe0feaf739402782781cf782c001c004eaa))
* **simulation:** correct thrust direction and edge-relative fleet deployment ([41aa2ee](https://github.com/Mearman/FleetArchitect/commit/41aa2eed65d10222954b160637010fd95fb86e6c))
* **simulation:** increase streamed batch size to prevent playback buffering ([073ecd2](https://github.com/Mearman/FleetArchitect/commit/073ecd2eb078027608a1de42b02248bf08338dac))
* **test:** add turret fields to collision and cellhit fixtures ([24bc3aa](https://github.com/Mearman/FleetArchitect/commit/24bc3aad4f3d881dc2db796fc9353eda51d51dfd))
* **ui:** keep battle canvas crisp at any display size ([e9eb11c](https://github.com/Mearman/FleetArchitect/commit/e9eb11c1a7ffa2f6127c877db9fb898b118cf11d))
* **ui:** key module HP bars on the Tooltip, not the inner Box ([79dc5f0](https://github.com/Mearman/FleetArchitect/commit/79dc5f01fe8d744f124361e10a23270d435a9c99))
* **ui:** render ships back-to-front by screen depth ([ab25ede](https://github.com/Mearman/FleetArchitect/commit/ab25ede139dc3c3b48ec78d50ee80637a06676ee))


### Features

* **awareness:** AwarenessSnapshot on BattleFrame ([ddcf3ed](https://github.com/Mearman/FleetArchitect/commit/ddcf3ed8126271a35ccc504e4c47bffd9a8c5d7e))
* **awareness:** neutral sensor/comms handling in consumer switches ([08fb70d](https://github.com/Mearman/FleetArchitect/commit/08fb70d1eeb14b42e9bdd79e61d8c0033fee3cc8))
* **awareness:** per-instance comms config fields on ModuleCell ([d3701e2](https://github.com/Mearman/FleetArchitect/commit/d3701e2fe0a36c9cb5199464b2c58b426a82d997))
* **awareness:** pure occluder module for line-of-sight ([c076a02](https://github.com/Mearman/FleetArchitect/commit/c076a0277e93ddca8edf42721191ed1c965b8d8f))
* **awareness:** SensorEffect and CommsEffect module kinds ([1fbf0e6](https://github.com/Mearman/FleetArchitect/commit/1fbf0e63fe1e47e918dd071ffb540e5fb7a60251))
* **battle:** draw crew and supply status on the canvas ([0564ae6](https://github.com/Mearman/FleetArchitect/commit/0564ae6c245c144e118017197b0215f80b3b71d6))
* **battle:** draw ships as true-scale sculpted hulls ([ee60f20](https://github.com/Mearman/FleetArchitect/commit/ee60f20bfab58b4f1441919a0fa52b7dc86ae560))
* bundle starter ships and fleets, seeded on first run ([6149bb7](https://github.com/Mearman/FleetArchitect/commit/6149bb73465a3827abfaf6b4f4c947f51c7f7695))
* **catalog:** Crystalline, Foundry, Corsair and Synthetic factions ([9e55e61](https://github.com/Mearman/FleetArchitect/commit/9e55e61b1266e8ff0407a76c3b765797af1415e8))
* **catalog:** faction magazine modules and weapon ammo capacities ([326140d](https://github.com/Mearman/FleetArchitect/commit/326140d28cb268e0935d201646511629bfc224b7))
* **catalog:** hull-tile types replace slotted hulls ([29a7fb2](https://github.com/Mearman/FleetArchitect/commit/29a7fb28bd7e7c4650c31d8ecb725a1543cfb27f))
* **data:** rebuild presets as grids; bump Dexie to v3 ([acced38](https://github.com/Mearman/FleetArchitect/commit/acced385d27679a98acc931603479eec7584cca2))
* **designer:** floor / corridor brush in ship palette ([152fc31](https://github.com/Mearman/FleetArchitect/commit/152fc313857169a9c22c4c4d919e04b3cb926ac6)), closes [#c9a84c](https://github.com/Mearman/FleetArchitect/issues/c9a84c) [#8794b8](https://github.com/Mearman/FleetArchitect/issues/8794b8) [#6ea8ff](https://github.com/Mearman/FleetArchitect/issues/6ea8ff)
* **domain:** pure grid geometry and derivation helpers ([fb94828](https://github.com/Mearman/FleetArchitect/commit/fb94828c775e84eb796fba6d849983bdaf49ef50))
* **domain:** resolve and stats read the grid ([a304fc3](https://github.com/Mearman/FleetArchitect/commit/a304fc3296bfc382e1cd22d8b67a18c94aa5816d))
* **factions:** add Swarm faction — schema, catalog, stats validation, presets ([cb2c664](https://github.com/Mearman/FleetArchitect/commit/cb2c664df3dc332858952db237496e95a79ca13c))
* **factions:** faction picker in Ship Designer and Fleet Builder ([1abc920](https://github.com/Mearman/FleetArchitect/commit/1abc920d641e89687650ebc519e067f6836191eb))
* **grid:** deterministic pathfinding and reachability helpers ([8612d71](https://github.com/Mearman/FleetArchitect/commit/8612d71d4706ec45e1ef888101acd26a14ae58fc))
* **grid:** rescale size-classification tiers for larger hulls ([c5e4f69](https://github.com/Mearman/FleetArchitect/commit/c5e4f69f3222ed0186a7832d3e1b1932fa4c9e83))
* **orders:** deepen Orders schema — focusFire, vulnerableTargetWeight, formationKeeping, rangeKeepingBand ([d1da46e](https://github.com/Mearman/FleetArchitect/commit/d1da46e2d206a1e4c40d2049243827e341a383d9))
* **orders:** engine reads focusFire, vulnerableTargetWeight, formationKeeping, rangeKeepingBand ([5abb159](https://github.com/Mearman/FleetArchitect/commit/5abb1592e6a77ca6e1d2d7b69d910a5089123b6e))
* **playback:** pure interpolateFrame helper — position, facing shortest-arc, CoM ([c3ecbae](https://github.com/Mearman/FleetArchitect/commit/c3ecbaeaed36afca73d93e616e9d58c57f6eee4b))
* **playback:** wall-clock timeline — decouple sim tick rate, playback speed, display refresh ([6a6eb45](https://github.com/Mearman/FleetArchitect/commit/6a6eb45e68192e3f5385c352745e2a2ebc9dfa4e))
* **presets:** add magazines and floor corridors to crewed warships ([64f29ad](https://github.com/Mearman/FleetArchitect/commit/64f29ad9b788fd360d05a89913bf5786f1c987b6))
* **presets:** richer, more varied ship roster across both factions ([d310434](https://github.com/Mearman/FleetArchitect/commit/d31043407cdd18eda74ca5ca31e22b23e6f1e55d))
* **presets:** sculpted, capital-scale ship designs and larger fleet budget ([334c3c8](https://github.com/Mearman/FleetArchitect/commit/334c3c8edc27806774326c37d74fe860b3764d08))
* **presets:** starter ships and fleets for the new factions ([cdf9fad](https://github.com/Mearman/FleetArchitect/commit/cdf9fade845560eb4ab5cdbc7859334ef7e0c8e4))
* **resolve:** populate per-module instances when resolving a ship ([89704f2](https://github.com/Mearman/FleetArchitect/commit/89704f2b23fd2025baa9972b443ce061b80559dc))
* scaffold Fleet Architect foundation ([82fc3cf](https://github.com/Mearman/FleetArchitect/commit/82fc3cf4f4f440e49937162fba0e2d051df35ab6))
* **schema:** add FloorCell walkable interior decking to GridCell union ([8271c0d](https://github.com/Mearman/FleetArchitect/commit/8271c0d0defd5dc8e5143774cfa2326eea4655c9))
* **schema:** expose ship velocity in battle replay snapshot ([9a3cc9c](https://github.com/Mearman/FleetArchitect/commit/9a3cc9c22b4156d7a3a4df5df22d01aadc9a7da9))
* **schema:** magazine effect and crew/supply snapshot fields ([b0d0202](https://github.com/Mearman/FleetArchitect/commit/b0d0202e07644b62388a31e45dcb02912e2f8a1a))
* **schema:** replace slot-based ship model with an authoritative tile grid ([aa3a7cf](https://github.com/Mearman/FleetArchitect/commit/aa3a7cfd8056c373818bdda8536400cda6543a1f))
* **schema:** tech-web and hardwire foundations (inert) ([3b8667c](https://github.com/Mearman/FleetArchitect/commit/3b8667c78dc90fdea35417c00f0269059ca0d7d4))
* **schema:** turret traverse fields on WeaponEffect ([9f36945](https://github.com/Mearman/FleetArchitect/commit/9f36945848fec18a3d82a08da1cc0f2ecb69354b))
* **sim:** factions-tech engine — full tech web and entities ([7e1f833](https://github.com/Mearman/FleetArchitect/commit/7e1f833f91b4ad990b1e8abe29ff7a21993445e7))
* **sim:** resolve foundation for hardwiring and factions ([7146bd0](https://github.com/Mearman/FleetArchitect/commit/7146bd056f6427256fc431a8cd157a9f35fc827f))
* **simulation:** add ResolvedModule and optional per-module state to CombatShip ([6e7595f](https://github.com/Mearman/FleetArchitect/commit/6e7595f10c2c16bc69377a655039de9d54ef6525))
* **simulation:** break apart modular ships along module connectivity ([f20053e](https://github.com/Mearman/FleetArchitect/commit/f20053e774561401f0a12ee0e636a36a70d4d226))
* **simulation:** bridge / command-module disarms ship when destroyed ([b3c289b](https://github.com/Mearman/FleetArchitect/commit/b3c289b64259d9f24e8e83a5c14df97ca6b82eb8))
* **simulation:** cell-level collision, cell-precise hits, grid-derived mass ([41a768b](https://github.com/Mearman/FleetArchitect/commit/41a768ba1759db260cb769a4b4a63f7fc6a4f61c))
* **simulation:** correct break-apart momentum split ([f90b904](https://github.com/Mearman/FleetArchitect/commit/f90b9046071d533cb51e98f53c2341437b0658ae))
* **simulation:** crew ammo hauling from magazines ([3c04f36](https://github.com/Mearman/FleetArchitect/commit/3c04f365c1050d5740047a86c91aa52ff320ee44))
* **simulation:** crew entities and station manning ([da69f4b](https://github.com/Mearman/FleetArchitect/commit/da69f4b6a89a9a5f219c41f748522e421489ad25))
* **simulation:** crew power hauling from reactors ([eb2bc02](https://github.com/Mearman/FleetArchitect/commit/eb2bc02f855a388f22ed45ae4950507b7076591a))
* **simulation:** directional sensors with per-cone detection ([3fdc156](https://github.com/Mearman/FleetArchitect/commit/3fdc156a2ae7b47eabb98ed6054905609b428d5a))
* **simulation:** directional shields with arc and facing ([aca84a5](https://github.com/Mearman/FleetArchitect/commit/aca84a53fda78f208848c36049acb58e4697a1da))
* **simulation:** directional thrusters — per-cell thrust and torque ([6733408](https://github.com/Mearman/FleetArchitect/commit/6733408e57275560ea453114aac31ab915ddfa70))
* **simulation:** emit per-ship targetId in battle frame snapshots ([3665ba9](https://github.com/Mearman/FleetArchitect/commit/3665ba914ba1aa46c44d4d9a9748108b9a5416ad))
* **simulation:** enforce per-module power grid in the firing path ([74efa82](https://github.com/Mearman/FleetArchitect/commit/74efa826b2c28c9db9ca670e214ad16e755479c4))
* **simulation:** exact 4-connected break-apart on grid coords ([9a11f72](https://github.com/Mearman/FleetArchitect/commit/9a11f72ff3f697137c69b66611c00a02e968d521))
* **simulation:** finite ammo for per-module weapons ([72c8a4e](https://github.com/Mearman/FleetArchitect/commit/72c8a4e863b5261c29b255f6ea565f93080a4763))
* **simulation:** handle magazine effect in aggregates and stats ([f18fc3c](https://github.com/Mearman/FleetArchitect/commit/f18fc3cb445f6258ef9ac3df097df468d213abb9))
* **simulation:** implement deterministic battle engine ([9e7efe3](https://github.com/Mearman/FleetArchitect/commit/9e7efe3f4fa8abf5e3ccac5f3dbf94711e09c809))
* **simulation:** independently-rotating turrets ([9cd2c39](https://github.com/Mearman/FleetArchitect/commit/9cd2c399bfc193b8aa69a7f7dc35567243b06ebc))
* **simulation:** interpolate projectile positions for smooth slow-mo playback ([5537675](https://github.com/Mearman/FleetArchitect/commit/55376752f118d1e84dad5064f862d45f2322280a))
* **simulation:** Newtonian ship movement with mass-based acceleration ([5a77951](https://github.com/Mearman/FleetArchitect/commit/5a7795185afec931901314f0cacecaa35b729d46))
* **simulation:** partition crew on break-apart and snapshot crew ([e80ec9a](https://github.com/Mearman/FleetArchitect/commit/e80ec9a6fe7a4f7c04b21c394a03f28f8d072629))
* **simulation:** per-module damage model — ships degrade system by system ([5f57c76](https://github.com/Mearman/FleetArchitect/commit/5f57c76d87c9b5c1c6c3a18b576be8cbff5037de))
* **simulation:** per-module facing — weapons fire in their mount direction ([9569f56](https://github.com/Mearman/FleetArchitect/commit/9569f56f3d0e665e1d917807a6f6f5aa239c7964))
* **simulation:** per-module repair / damage-control bays ([75b1f8a](https://github.com/Mearman/FleetArchitect/commit/75b1f8acbc97a9cc8739b53e1a3067ad2b05fee2))
* **simulation:** point-defense intercepts incoming missiles and torpedoes ([638a8c8](https://github.com/Mearman/FleetArchitect/commit/638a8c8c20a1b60ee04ca9d084885218f1252a03))
* **simulation:** proper black hole gravity — force on all entities, tidal damage ([b5793d8](https://github.com/Mearman/FleetArchitect/commit/b5793d89070340ab5f382a34c7065b827a9a0b38))
* **simulation:** rigid-body physics — CoM, projectile momentum, firing/hit torque ([4d10da1](https://github.com/Mearman/FleetArchitect/commit/4d10da1380b6d7abf29eb47c8ac1774aac920ee4))
* **simulation:** run battles in a Web Worker behind a BattleRunner port ([0f3d1cb](https://github.com/Mearman/FleetArchitect/commit/0f3d1cb26558220bd37a75b66bb34d2327d94f55))
* **simulation:** uniform spatial-hash broad-phase over world cells ([7785423](https://github.com/Mearman/FleetArchitect/commit/77854239cf1bd41ecbdf0aa447dda02c9df18a30))
* **stats:** unreachableStation and noAmmoSource reachability faults ([a052e35](https://github.com/Mearman/FleetArchitect/commit/a052e352577af2991410265801da2dd4d094d23a))
* **ui:** add reactive storage hooks and shared ship components ([9e664af](https://github.com/Mearman/FleetArchitect/commit/9e664af3b18b8644516d715be36386049915c79c))
* **ui:** AI vs AI auto-roll button in the battle arena ([1a3e40f](https://github.com/Mearman/FleetArchitect/commit/1a3e40fab8fffceed34164a4027c9f17433369f2))
* **ui:** battle arena with deterministic engine and canvas replay ([b85491d](https://github.com/Mearman/FleetArchitect/commit/b85491dfbe66cb90bf2515d6bb699c7f204268a7))
* **ui:** battle overlay framework with target-lock lines ([b03866c](https://github.com/Mearman/FleetArchitect/commit/b03866c2106d79532bf018e878a42ca7d7693d88))
* **ui:** draw ship heading line on the battle canvas ([8232742](https://github.com/Mearman/FleetArchitect/commit/8232742ab943c45e85056f03718cb0f50b03f720))
* **ui:** draw turret barrels along their live tracking angle ([c46872a](https://github.com/Mearman/FleetArchitect/commit/c46872a8c5209a5945b69e2cbc2abfcd9bed4735))
* **ui:** expose new order tunables in FleetBuilderRoute ([f0aed19](https://github.com/Mearman/FleetArchitect/commit/f0aed197233274e659d52ba1c58b27bcec10a2c2))
* **ui:** faction colour palette and side outline in battle renderer ([824e4ed](https://github.com/Mearman/FleetArchitect/commit/824e4ed60dc77e6b2494a1f57882dc2f45f332f3))
* **ui:** fleet builder with per-ship doctrine and point budget ([6170df8](https://github.com/Mearman/FleetArchitect/commit/6170df8e97710989b993d3291fe5c248bda08d78))
* **ui:** focus-ring and sensor-coverage overlays ([7c56d2f](https://github.com/Mearman/FleetArchitect/commit/7c56d2fe544063a832a096ffebba048151f4da97))
* **ui:** grid tile-painting Ship Designer ([a1bf5c5](https://github.com/Mearman/FleetArchitect/commit/a1bf5c571a93bf14007553b385542e5c654e5a21))
* **ui:** import shared designs and fleets from data URLs ([5351cce](https://github.com/Mearman/FleetArchitect/commit/5351ccec0c60b5b317281285eb39560e77a96740))
* **ui:** interpolate crew positions between frames ([15b22d5](https://github.com/Mearman/FleetArchitect/commit/15b22d5e80ae7c07b8b5d3d54770afa7244d960f))
* **ui:** link build to release or commit in the top bar ([53d977f](https://github.com/Mearman/FleetArchitect/commit/53d977fc95e64af47d879b8cd25f1db8dd7bf4c0))
* **ui:** movement-trail and damage-pulse overlays ([f0a522f](https://github.com/Mearman/FleetArchitect/commit/f0a522fd85783514c3061817b51f3d7cc6470a91))
* **ui:** per-instance sensor config UI in ship designer ([c9cd6fa](https://github.com/Mearman/FleetArchitect/commit/c9cd6fa96e46587e611a2a100dc2e87bcfb257d8))
* **ui:** render per-module parts on the battle canvas + status panel ([2ed94fe](https://github.com/Mearman/FleetArchitect/commit/2ed94fe4531225732f9697c015de3fb8c9d2f7b1))
* **ui:** ship designer with live loadout analysis ([3286614](https://github.com/Mearman/FleetArchitect/commit/3286614a9181afe68b24b574a6f7679c8d46f0c0))
