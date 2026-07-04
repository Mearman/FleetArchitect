# [1.43.0](https://github.com/Mearman/FleetArchitect/compare/v1.42.0...v1.43.0) (2026-07-04)


### Features

* **ui:** render the bevelled hull outline in the battle view ([49dea90](https://github.com/Mearman/FleetArchitect/commit/49dea90d4df7f5892cebef90317ad2428f13cc74))

# [1.42.0](https://github.com/Mearman/FleetArchitect/compare/v1.41.1...v1.42.0) (2026-07-04)


### Features

* **ui:** chamfer armour corners in the 2D battle view ([d5b0cdc](https://github.com/Mearman/FleetArchitect/commit/d5b0cdcc292b668ce855ab71b3ba6fc6383ef6b2))
* **ui:** chamfer armour corners in the iso (2.5D) battle view ([2354783](https://github.com/Mearman/FleetArchitect/commit/2354783da6ad5132540d89d40fb4128a5ac4fb63))

## [1.41.1](https://github.com/Mearman/FleetArchitect/compare/v1.41.0...v1.41.1) (2026-07-04)


### Bug Fixes

* **ci:** build the tagged release commit for the version header ([1b6d775](https://github.com/Mearman/FleetArchitect/commit/1b6d775c7c7945622407b68d7b52003e4655d096))
* show the release version in the header, not the commit hash ([2d1dc82](https://github.com/Mearman/FleetArchitect/commit/2d1dc8246d5a632c3c551d3cf8c7e14195965d71))

# [1.41.0](https://github.com/Mearman/FleetArchitect/compare/v1.40.1...v1.41.0) (2026-07-04)


### Features

* **ui:** render internal walls and doors in the battle view ([705978c](https://github.com/Mearman/FleetArchitect/commit/705978c00cf76c865ff96ece1bafdae3c3523bd6)), closes [#3a3f3c](https://github.com/Mearman/FleetArchitect/issues/3a3f3c) [#ffb000](https://github.com/Mearman/FleetArchitect/issues/ffb000)

## [1.40.1](https://github.com/Mearman/FleetArchitect/compare/v1.40.0...v1.40.1) (2026-07-04)


### Bug Fixes

* **render:** render armour cells as armour, not hull ([2c4fefd](https://github.com/Mearman/FleetArchitect/commit/2c4fefda59475cb1d1ce8580b93db4c03c37d250)), closes [#6f7a86](https://github.com/Mearman/FleetArchitect/issues/6f7a86)

# [1.40.0](https://github.com/Mearman/FleetArchitect/compare/v1.39.4...v1.40.0) (2026-07-04)


### Features

* **presets:** expand and rebalance the ship design roster ([74fa1af](https://github.com/Mearman/FleetArchitect/commit/74fa1af2b8461bf8105dd764b1974c910529ecfd))

## [1.39.4](https://github.com/Mearman/FleetArchitect/compare/v1.39.3...v1.39.4) (2026-07-03)


### Bug Fixes

* **storage:** repair the v9 checkpoints primary-key upgrade ([c3dba3d](https://github.com/Mearman/FleetArchitect/commit/c3dba3d7bda1f047ce37e51ba755b4519f825520))
* **ui:** contain a throwing cache-failure notifier ([dd153fb](https://github.com/Mearman/FleetArchitect/commit/dd153fb4c31f2162ade98c5357d143591905dfe0))

## [1.39.3](https://github.com/Mearman/FleetArchitect/compare/v1.39.2...v1.39.3) (2026-07-03)


### Performance Improvements

* **cache:** memoise the engine algorithm signature ([ccef58a](https://github.com/Mearman/FleetArchitect/commit/ccef58aa191a2139fd18515e1fd077cda1f86613))
* **cache:** single-pass canonical stringifier for the cache key ([b81a87e](https://github.com/Mearman/FleetArchitect/commit/b81a87e292e6d0a655d4a5df4ea36a42de084914))
* **sim:** compute per-pair emission product once in direct contacts ([b341e75](https://github.com/Mearman/FleetArchitect/commit/b341e75919a4de451763d2499ffd0dfee62f08cc))
* **sim:** drop dead weapon list rebuild in chooseAmmoRun ([10dd9e0](https://github.com/Mearman/FleetArchitect/commit/10dd9e06382d0e804b6708157587b2bb9b27da0d))
* **sim:** flatten medium neighbour index to int32 stride ([d9e64b6](https://github.com/Mearman/FleetArchitect/commit/d9e64b6dcc5bf607daf17a80c3b0514cbc021849))
* **sim:** partition ships in one pass in snapshot ([54a8b47](https://github.com/Mearman/FleetArchitect/commit/54a8b472293de49107c1ca523389aa4a16234ea5))
* **sim:** pass ship map iterator directly to buildShipCellHash ([3ac7608](https://github.com/Mearman/FleetArchitect/commit/3ac76088bc8ba36cf81605f2b89d72ba2e5f292f))
* **sim:** pool resource-step per-call map and set containers ([d892f3f](https://github.com/Mearman/FleetArchitect/commit/d892f3f8168a2b393fa19cc241e12d4cc63c4698))
* **sim:** pool the separation-field spatial hash on EngineState ([2a9e50e](https://github.com/Mearman/FleetArchitect/commit/2a9e50e2b73425f461dc89d125b1739218028ac0))
* **sim:** skip crew candidate-list build when no crew is idle ([aab4ca6](https://github.com/Mearman/FleetArchitect/commit/aab4ca6a1cf05a487793a4a85c20be62128fb494))
* **sim:** skip formation-doctrine build when no ship uses it ([3ac7e2d](https://github.com/Mearman/FleetArchitect/commit/3ac7e2d68bcf9a4b6ceba3aa30b0d1a4574710dc))
* **sim:** skip newlyDead scan on ticks with no deaths ([f01903a](https://github.com/Mearman/FleetArchitect/commit/f01903a0256279c2db3233292fe2a077d90a5c68))
* **sim:** step exhaust particles in place with stable compaction ([8342b00](https://github.com/Mearman/FleetArchitect/commit/8342b009fdc1168c503edd88855e51ae846e60df))
* **sim:** type medium source buffers as Float64Array ([8886d0d](https://github.com/Mearman/FleetArchitect/commit/8886d0dcded537b3efe54e7d548ca7c408dd23bf))
* **sim:** use fastHypot in EM reception ([c02e9df](https://github.com/Mearman/FleetArchitect/commit/c02e9dfbe175bf2460eb022953a08b508d420c7c))
* **storage:** split sim-cache eviction metadata into its own table ([33176c0](https://github.com/Mearman/FleetArchitect/commit/33176c0dc1bc8c40b22d3150eff42bfb93fc850c))
* **ui:** cache per-design analysis by id and revision ([a36c019](https://github.com/Mearman/FleetArchitect/commit/a36c019ef1f3564e3383386353b07912df335a53))
* **ui:** drop unread door-states per cell per frame ([ef4419c](https://github.com/Mearman/FleetArchitect/commit/ef4419ce0e033cdaf9195d2d4ba5177cf7549be7))
* **ui:** fire the durable sim-cache write without blocking completion ([1f718c6](https://github.com/Mearman/FleetArchitect/commit/1f718c677f7bef7d40043c270456a7b3a56562de))
* **ui:** narrow ship-designer analysis memo deps ([a11d61f](https://github.com/Mearman/FleetArchitect/commit/a11d61fa0248f7566cedb9cd3cef349a71df9d9c))
* **ui:** pool the iso cell depth-sort buffer ([4ad8a02](https://github.com/Mearman/FleetArchitect/commit/4ad8a02ad08417d5d2fc3ae3ce70c6fe4b7a096d))
* **ui:** reuse the battle camera transform across frames ([3834ecf](https://github.com/Mearman/FleetArchitect/commit/3834ecf4f95ad5b90bb7a439302cb24afe4e4e76))
* **ui:** share a cached per-frame ship index across overlays ([96c4c94](https://github.com/Mearman/FleetArchitect/commit/96c4c94cd53776548b72f792f987b5cd1d40e112))

## [1.39.2](https://github.com/Mearman/FleetArchitect/compare/v1.39.1...v1.39.2) (2026-07-02)


### Bug Fixes

* **cache:** size disk cache budget to fit the matrix working set ([69beaac](https://github.com/Mearman/FleetArchitect/commit/69beaac482bab5c467855f783661a52018374a74))


### Performance Improvements

* **cache:** trust cache reads via shared shape guard and cache fleet resolve ([28d4566](https://github.com/Mearman/FleetArchitect/commit/28d45663bcd31915fd75c4d518391dee85cedd42))
* **cache:** v8-serialise disk cache results and raise budget to the working set ([2d3d156](https://github.com/Mearman/FleetArchitect/commit/2d3d156bddc3ec078db6952fa3ed82eed20b06b9))

## [1.39.1](https://github.com/Mearman/FleetArchitect/compare/v1.39.0...v1.39.1) (2026-07-02)


### Performance Improvements

* **awareness:** pool per-tick allocations on awareness scratch ([ad1c608](https://github.com/Mearman/FleetArchitect/commit/ad1c6086304451f4b5309c1275a3d6970f7b3850))
* **awareness:** skip provably-negligible hull-reception pairs ([03b93fa](https://github.com/Mearman/FleetArchitect/commit/03b93fab938e2cd0e02572e43d46e861efc9b8ea))
* **build:** split vendor chunks and drop prod sourcemaps ([002945c](https://github.com/Mearman/FleetArchitect/commit/002945c12b5b3cd93d5e7fee35959a7f63e55400))
* **cache:** memoise derive cache key per battle inputs ([69d5de5](https://github.com/Mearman/FleetArchitect/commit/69d5de547470701d663a5417c1ddd9b19f1c6b36))
* **engine:** gather separation neighbours via spatial hash ([aba680b](https://github.com/Mearman/FleetArchitect/commit/aba680b8f24b54974337b5266e199e4b1acfa92e))
* **engine:** pool collision broad-phase buffers and integer-key contacts ([4576499](https://github.com/Mearman/FleetArchitect/commit/457649950871338194cf1581b8002e1807b81ffa))
* **engine:** pre-compute first-damaged module index for repair step ([723cc2c](https://github.com/Mearman/FleetArchitect/commit/723cc2ce662d64ff7a668491afd8bc37379dcba9))
* **medium:** persist Float64Array ping-pong state in the FTCS stepper ([9fa5fb4](https://github.com/Mearman/FleetArchitect/commit/9fa5fb48250780ab069f9690ddef7d2690f6a369))
* **medium:** precompute asteroid source cells once at setup ([dbb5a35](https://github.com/Mearman/FleetArchitect/commit/dbb5a359139d7bab171f8f9b5b5b69a3f33218e5))
* **sim:** build snapshot ship frame in a single pass ([3678104](https://github.com/Mearman/FleetArchitect/commit/3678104c320d28b256d21d25a653589f22ed11d0))
* **sim:** hoist point-defence candidate list out of per-projectile loop ([1d72afa](https://github.com/Mearman/FleetArchitect/commit/1d72afa399247d6b52e2215c9b9ef6b4e0eacf1a))
* **startup:** render before seeding starter content ([6f87aad](https://github.com/Mearman/FleetArchitect/commit/6f87aad0f0dc373a808cb03c292abeb01e019739))
* **storage:** incremental checkpoint deltas and revision-keyed parse cache ([f7a0450](https://github.com/Mearman/FleetArchitect/commit/f7a04509c2d02a855ae8e94bd61f3d83117f1aa8))
* **ui:** cache backdrop bitmap, reuse render-order buffer, pool fog map, hoist inScope ([5dead6f](https://github.com/Mearman/FleetArchitect/commit/5dead6f6a571f497a7870f3a680eb87f00d96479))
* **ui:** cache mediumGlow rasterisation on field identity ([b7ad909](https://github.com/Mearman/FleetArchitect/commit/b7ad90911bc23128cbef3ec4751c641227552f46))
* **ui:** cache mediumTrails per-frame entity index in a WeakMap ([921cfe6](https://github.com/Mearman/FleetArchitect/commit/921cfe6bee73fa544f58aaf4ffacb49813b891e6))
* **ui:** gate statusFrame on modules-tab visibility ([10e682a](https://github.com/Mearman/FleetArchitect/commit/10e682a4dde22ba7754dc213aadbdd7cf3b54061))
* **ui:** pool interpolateFrame scratch across display frames ([53ee93c](https://github.com/Mearman/FleetArchitect/commit/53ee93c1cf63c53d7857d25fecde7f4cfe49cf5b))

# [1.39.0](https://github.com/Mearman/FleetArchitect/compare/v1.38.0...v1.39.0) (2026-07-02)


### Features

* **sim:** chamfer-only armour growth, drop the orthogonal ring ([d6f8baf](https://github.com/Mearman/FleetArchitect/commit/d6f8bafa972a57a216c9b5a34c28f1ce3c5225b3))

# [1.38.0](https://github.com/Mearman/FleetArchitect/compare/v1.37.0...v1.38.0) (2026-07-02)


### Features

* **presets:** give under-armoured ships an outer armour skin ([82a6866](https://github.com/Mearman/FleetArchitect/commit/82a6866497e7f2ba6ec56f8b2114a53058902806))

# [1.37.0](https://github.com/Mearman/FleetArchitect/compare/v1.36.0...v1.37.0) (2026-07-01)


### Features

* **sim:** friendly-fire/collision tests + AI rules for friendly awareness ([9dc4711](https://github.com/Mearman/FleetArchitect/commit/9dc4711479720fb0015a132c5cc9a1ec5b5039ec))

# [1.36.0](https://github.com/Mearman/FleetArchitect/compare/v1.35.0...v1.36.0) (2026-07-01)


### Features

* **sim:** (E,p)-aware armour split with finite reactive plates ([3edd09f](https://github.com/Mearman/FleetArchitect/commit/3edd09f354184514d01d3d5761bb8a9f6b0d4afa))

# [1.35.0](https://github.com/Mearman/FleetArchitect/compare/v1.34.1...v1.35.0) (2026-07-01)


### Bug Fixes

* **ui:** stop Space-bar hijack + handle import storage failure ([c2e123a](https://github.com/Mearman/FleetArchitect/commit/c2e123a76436b1e34c26548e7f523b4d7108bddf))


### Features

* **ui:** keyboard navigation for the ship designer grid ([1201307](https://github.com/Mearman/FleetArchitect/commit/12013070170969779b363b5fbf2fb3fcd37d8393))

## [1.34.1](https://github.com/Mearman/FleetArchitect/compare/v1.34.0...v1.34.1) (2026-07-01)


### Bug Fixes

* **resolve,storage:** faction guard, hardwire endpoints, revision parse ([a931085](https://github.com/Mearman/FleetArchitect/commit/a931085d3b9ddc6118b6522da535969a2d510691))
* **sharing:** bound decoded grid dimensions against share DoS ([d002b31](https://github.com/Mearman/FleetArchitect/commit/d002b3129f566fcb5f1a8f697ae5c62dc5eaa7d2))
* **sharing:** stamp fresh ids on import to stop silent overwrites ([dc22132](https://github.com/Mearman/FleetArchitect/commit/dc221323f82a6058d3c02a5dc2dc2a996fbe8d76))
* **sim:** checkpoint the reactor-loss counter for byte-identical resume ([6473222](https://github.com/Mearman/FleetArchitect/commit/64732226e8e08c999b57328e2b5e027777857731))
* **storage:** bound the resume checkpoint store (byte budget + LRU) ([68589c1](https://github.com/Mearman/FleetArchitect/commit/68589c172cfd3c33efbf2c1c0bc21e0b044a1399))

# [1.34.0](https://github.com/Mearman/FleetArchitect/compare/v1.33.1...v1.34.0) (2026-07-01)


### Bug Fixes

* **ui:** stop weapon-particle glow rendering as disconnected dots ([3cb84e9](https://github.com/Mearman/FleetArchitect/commit/3cb84e909c4a37dd7642aea638f25a52103dcab6))


### Features

* **sim:** thread real SI energy into weapon-particle intensity ([091eca8](https://github.com/Mearman/FleetArchitect/commit/091eca8043c1a75be043e1350d05fb7d3199d013))
* **ui:** drive weapon-particle brightness by local medium density ([3bead98](https://github.com/Mearman/FleetArchitect/commit/3bead98a3d401fb752a732f98e7a97627ace1257))

## [1.33.1](https://github.com/Mearman/FleetArchitect/compare/v1.33.0...v1.33.1) (2026-07-01)


### Performance Improvements

* **sim:** fast-hypot the hot N² distance loops ([eeb089c](https://github.com/Mearman/FleetArchitect/commit/eeb089ca5148f4f22b7b39ce2921b9035b9c3f3d))
* **ui:** batch the sprite knock-out into one composite pass ([91e40f0](https://github.com/Mearman/FleetArchitect/commit/91e40f0cabcd616242579c1efcea4749bdecce01))

# [1.33.0](https://github.com/Mearman/FleetArchitect/compare/v1.32.5...v1.33.0) (2026-06-30)


### Bug Fixes

* **sim:** gate reactor-loss death rule on no-progress ([643e976](https://github.com/Mearman/FleetArchitect/commit/643e9760402ef7168f341dd680abc0dbee9cf835))
* **sim:** route hitscan beams through the armour penetration path ([5c78886](https://github.com/Mearman/FleetArchitect/commit/5c788867018895fd0b2afffd5f39f4aa90bbc1c8))
* **test:** update cellhit penetration assertion for the (E,p) damage model ([3ebf2ba](https://github.com/Mearman/FleetArchitect/commit/3ebf2ba77982aa3896b3952d5b09f5e363a94255))
* **test:** update test fixtures for the (E,p) damage model ([66261c9](https://github.com/Mearman/FleetArchitect/commit/66261c963cb1780da2abd3d690000f549bfc0ec7)), closes [hi#output](https://github.com/hi/issues/output)


### Features

* **presets:** mount deflectors on shield-bearing preset ships ([a4e6d69](https://github.com/Mearman/FleetArchitect/commit/a4e6d695ec2e733e5c3314323d704bdc973f5205))
* **sim:** (E,p)-aware armour — surface vs reactive per energy/mass ([42a7e4e](https://github.com/Mearman/FleetArchitect/commit/42a7e4ed4571a3d25687e58290c7f726456581e8))
* **sim:** activate unified (E,p) damage model (Phase 5) ([299eb13](https://github.com/Mearman/FleetArchitect/commit/299eb1338b498ff5623575bd3ee746c70affb8ed))
* **sim:** add applyImpact defence maths (Phase 3) ([b864c39](https://github.com/Mearman/FleetArchitect/commit/b864c396ba2154412e7fee7fcdd08d6047bebf20))
* **sim:** add deflector modules to catalogue (Phase 4) ([31931c2](https://github.com/Mearman/FleetArchitect/commit/31931c2c759ad2934f22a219df8dfffd0760c2e4))
* **sim:** add deflector modules to Foundry and Swarm ([199f4f3](https://github.com/Mearman/FleetArchitect/commit/199f4f3b346346cca53595687aaaff540c4e11e3))
* **sim:** add deflector state model (Phase 2) ([4b5d455](https://github.com/Mearman/FleetArchitect/commit/4b5d45575e58d0b062e4f5517a7d6f181ccf16d8))
* **sim:** add unified (energy, momentum) impact profiles ([7339465](https://github.com/Mearman/FleetArchitect/commit/7339465c827c1e0cfc1be128bdd9aa5b44c05954))
* **sim:** replace no-progress watchdog with reactor-loss death rule ([a7c346a](https://github.com/Mearman/FleetArchitect/commit/a7c346a54b7010a023f72e3242e8931a3bd6a1f1))


### Performance Improvements

* **sim:** pool the spatial-hash entry objects across ticks ([7c4b09c](https://github.com/Mearman/FleetArchitect/commit/7c4b09cb1a0988c699c1ac38f4bebf8ec467245f))
* **ui:** bake the module glyph into the ship sprite ([e432d92](https://github.com/Mearman/FleetArchitect/commit/e432d9268f2e3811c9a294007da2e66fecd73a4d))
* **ui:** prerender the particle-glow atlas, blit instead of per-particle gradient ([50858cc](https://github.com/Mearman/FleetArchitect/commit/50858cc2819732e6d721d46c944e211a9c611d14))

## [1.32.5](https://github.com/Mearman/FleetArchitect/compare/v1.32.4...v1.32.5) (2026-06-30)


### Performance Improvements

* **sim:** pool the awareness comms-flood scratch across ticks ([7ab2d55](https://github.com/Mearman/FleetArchitect/commit/7ab2d55764bbe2571051f24b900997d3b8e59db6))

## [1.32.4](https://github.com/Mearman/FleetArchitect/compare/v1.32.3...v1.32.4) (2026-06-30)


### Performance Improvements

* **resolve:** memoise the per-design resolution within a fleet ([a8eb383](https://github.com/Mearman/FleetArchitect/commit/a8eb383a463fb3f3e89d518bbcb05c9fc048e805))
* **sim:** fuse shipForceAndTorque and lateralForceAndTorque (moveShips Pass B) ([6857aac](https://github.com/Mearman/FleetArchitect/commit/6857aac834947904ce93417ffb1091d788f1aea2))

## [1.32.3](https://github.com/Mearman/FleetArchitect/compare/v1.32.2...v1.32.3) (2026-06-30)


### Performance Improvements

* **ui:** add Transform.projectInto and migrate the hot draw loops ([122c4cf](https://github.com/Mearman/FleetArchitect/commit/122c4cf8b72ec6e4110051c20857aedae9512877))
* **ui:** reuse the per-ship RenderCell buffer across frames ([1661fbe](https://github.com/Mearman/FleetArchitect/commit/1661fbeb7e560aa27863a42e7b2395c21c205eab))

## [1.32.2](https://github.com/Mearman/FleetArchitect/compare/v1.32.1...v1.32.2) (2026-06-30)


### Performance Improvements

* **storage:** keep the result-cache durable write off the playback rAF ([46b9ce4](https://github.com/Mearman/FleetArchitect/commit/46b9ce42f20c5d69bd80bec8bf0bc556b7d9d0b9))
* **ui:** throttle per-frame playback state and read canvas size from the observer ([9d4f08b](https://github.com/Mearman/FleetArchitect/commit/9d4f08b6d7d9d7e32705485fbf8258bd91ba4536))

## [1.32.1](https://github.com/Mearman/FleetArchitect/compare/v1.32.0...v1.32.1) (2026-06-29)


### Bug Fixes

* **sim:** keep supply accumulation order exact in recomputeAggregates ([84b1002](https://github.com/Mearman/FleetArchitect/commit/84b100223bfe98206af90255c903ee7700a37b77))


### Performance Improvements

* **sim:** fuse recomputeAggregates module scans ([956c3df](https://github.com/Mearman/FleetArchitect/commit/956c3df501ae1c8641fed6af554e8191199718e7))
* **sim:** fuse the movement capability scans to one pass ([1fb29a2](https://github.com/Mearman/FleetArchitect/commit/1fb29a2e194180b2fbd78e1b1176568c5d18be53))

# [1.32.0](https://github.com/Mearman/FleetArchitect/compare/v1.31.1...v1.32.0) (2026-06-29)


### Bug Fixes

* **presets:** deepen leviathan armoured prow to close foundry structure gap ([c44506e](https://github.com/Mearman/FleetArchitect/commit/c44506e1ab5b2e20a223b07dae3b38cda0192e53))
* **presets:** right-size leviathan prow armour ([f0ebcc1](https://github.com/Mearman/FleetArchitect/commit/f0ebcc1b36dd39bbfd37528eb860942f5dc41b29))


### Features

* **catalog:** add crystalline resonance sensor ([5448c54](https://github.com/Mearman/FleetArchitect/commit/5448c54527a6a4c703237ecdbd0bb87b82985562))
* **presets:** add crystalline resonance court fleet ([a6124e4](https://github.com/Mearman/FleetArchitect/commit/a6124e48e890f9733bad8ca6d945a47b313ba055))
* **presets:** add crystalline spinal shield sensor tokens ([8b8efcc](https://github.com/Mearman/FleetArchitect/commit/8b8efcccd8cf3daba79bc0716502156c10b0acd8))
* **presets:** armour terran capitals and hive lord ([5c4f015](https://github.com/Mearman/FleetArchitect/commit/5c4f01508f7ad758a5a5925f04f091a41a5eb2bf))
* **presets:** rework shard and add crystalline splinter and monolith ([1fae660](https://github.com/Mearman/FleetArchitect/commit/1fae6609c6f6f876f5625eda42bfea8ab4044662))

## [1.31.1](https://github.com/Mearman/FleetArchitect/compare/v1.31.0...v1.31.1) (2026-06-29)


### Bug Fixes

* **ui:** extract lazy routes to a components-only module ([eb4918d](https://github.com/Mearman/FleetArchitect/commit/eb4918d8c0753562855c22bdbce858e66f19c428))


### Performance Improvements

* **sim:** gather observer sensors once per observer per tick ([94ab4a0](https://github.com/Mearman/FleetArchitect/commit/94ab4a0e1fa22d473fd8ec6da7eb6b1fa9d521c0))
* **sim:** hoist cell cos/sin out of the per-cell hash build ([a1e6ab7](https://github.com/Mearman/FleetArchitect/commit/a1e6ab759a7567cc7179464e89ef2b97e0532c5f))
* **sim:** hoist medium-stepper loop-invariant coefficients ([516138b](https://github.com/Mearman/FleetArchitect/commit/516138b06fe05c810da9edd6664c85623c06395d))
* **ui:** cut battle-start resolve and streaming render churn ([b9eb814](https://github.com/Mearman/FleetArchitect/commit/b9eb814f18d0d3c029bae6a7297d02624f4eca73))
* **ui:** cut per-frame canvas setup in the battle draw ([9208006](https://github.com/Mearman/FleetArchitect/commit/92080061de948ccfa45d24229d9c8d3e0004c341))
* **ui:** lazy-load routes to split the battle bundle ([2e975bc](https://github.com/Mearman/FleetArchitect/commit/2e975bc48dfa48b655eaca3e8cd21dc8f501091f))

# [1.31.0](https://github.com/Mearman/FleetArchitect/compare/v1.30.6...v1.31.0) (2026-06-29)


### Bug Fixes

* **sim:** drive the sim-speed bar from the delivered rate ([350f691](https://github.com/Mearman/FleetArchitect/commit/350f69158d56ae70dfb4fb2c32bed4e4876c3869))
* **sim:** widen overdrive-off pacing lead to stop playback stutter ([b4a42b5](https://github.com/Mearman/FleetArchitect/commit/b4a42b563283282afc567dc162f4dd255a1692d6))
* **ui:** wire in medium trails and weapon particle glow overlays ([03146bc](https://github.com/Mearman/FleetArchitect/commit/03146bc7e92a79125d3a6d36803cc9a50fdf763b))


### Features

* **sim:** add inter-ship separation steering ([51e8434](https://github.com/Mearman/FleetArchitect/commit/51e84349a5bfe228878eb3197884d8ce9cc90d17))
* **sim:** add overdrive toggle to pace the simulation to playback ([7b63c2c](https://github.com/Mearman/FleetArchitect/commit/7b63c2c30da2d756c762ff94c5d86f65d25a355b))
* **ui:** playback speed slider with sim-speed telemetry ([094ee09](https://github.com/Mearman/FleetArchitect/commit/094ee093cfc1470676914ce55499f11e09ba8e32))


### Performance Improvements

* **ui:** foveated weapon-particle density by energy variance ([41df54c](https://github.com/Mearman/FleetArchitect/commit/41df54cd235729fae2a9a70546c036bf47054392))

## [1.30.6](https://github.com/Mearman/FleetArchitect/compare/v1.30.5...v1.30.6) (2026-06-29)


### Bug Fixes

* **sim:** remove the medium glow's hard grid border; fix the bugs it exposed ([aed3f1f](https://github.com/Mearman/FleetArchitect/commit/aed3f1f832e55f789ccc0a200806b920b2bc8ad9))
* **sim:** square medium grid + clamp advection velocity (WIP) ([85281f2](https://github.com/Mearman/FleetArchitect/commit/85281f2b5a857af60066596cbe159bf2e46f83bf)), closes [hi#u](https://github.com/hi/issues/u)
* **sim:** use bbox + pad for the medium grid, not square (CI OOM) ([7bfc53e](https://github.com/Mearman/FleetArchitect/commit/7bfc53ee576dae71cb78edd31b2a50b5bbe9f072))
* **ui:** tone-map medium glow to stop the brightness blow-out ([5d7a3b1](https://github.com/Mearman/FleetArchitect/commit/5d7a3b11961e9be41375f0ed2cbdb472271e5660))

## [1.30.5](https://github.com/Mearman/FleetArchitect/compare/v1.30.4...v1.30.5) (2026-06-28)


### Performance Improvements

* **sim:** cache moduleByCell per ship and inline door-presence check ([a1d19ab](https://github.com/Mearman/FleetArchitect/commit/a1d19abd747dc81f49b8873d1b7b15bae2a941b6))
* **sim:** cache modulesBySlot + linearise A* path reconstruction (cluster C) ([be5ac90](https://github.com/Mearman/FleetArchitect/commit/be5ac90fd0d765a8bba1a6c94a52641debc6ce85))
* **sim:** fold resource-step indices into cached graph, split oracle ([a819216](https://github.com/Mearman/FleetArchitect/commit/a81921670a363ee51093926256464094937b6290))
* **sim:** gate formation-targeting context + drop unused aggregate build ([4fbc5d3](https://github.com/Mearman/FleetArchitect/commit/4fbc5d3289684369cb98158a6c3483806b9d60a2))
* **sim:** integer-keyed spatial hash + no-alloc candidate iteration ([e07a0c9](https://github.com/Mearman/FleetArchitect/commit/e07a0c9cd4a66148689c310c6f323902597a7acc))
* **sim:** pool per-tick scratch + share sorted lists, emissions, byId, shield cache ([4ee8901](https://github.com/Mearman/FleetArchitect/commit/4ee8901bd61231251d507d42885982f1bab7ce95))
* **sim:** pose-cache outer hull loop + single-pass polygon contact ([5943621](https://github.com/Mearman/FleetArchitect/commit/5943621a1a4ac1c7e81c762930d50d1a20522c47))
* **sim:** precompute targeting scoreEnemy extrema once per ship (O(K^2)→O(K)) ([09ba7bd](https://github.com/Mearman/FleetArchitect/commit/09ba7bd9087ac2594a4d227cd5514b71c6a07671))
* **sim:** retire brownoutBounded flag + in-place nearestAliveModule ([c98d57f](https://github.com/Mearman/FleetArchitect/commit/c98d57f30d278283236ab3900069c0846fcc8834))
* **sim:** reuse medium + transport-field buffers across sub-steps ([ccf3915](https://github.com/Mearman/FleetArchitect/commit/ccf39153a066c8c8e2aa0f5d72132d3fc4fb85d8))
* **sim:** skip unchanged aggregate recomputes + fuse per-ship passes ([6cd428a](https://github.com/Mearman/FleetArchitect/commit/6cd428a5acc38dbd9495ef33d3d33c1ad0f6a020))

## [1.30.4](https://github.com/Mearman/FleetArchitect/compare/v1.30.3...v1.30.4) (2026-06-28)


### Bug Fixes

* **ui:** floor the timeline slider tooltip to whole ticks ([fddee63](https://github.com/Mearman/FleetArchitect/commit/fddee63beb84e360991137c792da2a86274724dd))

## [1.30.3](https://github.com/Mearman/FleetArchitect/compare/v1.30.2...v1.30.3) (2026-06-28)


### Bug Fixes

* **sim:** consume base.targeting relational modes + formation stance on rules ([77e674c](https://github.com/Mearman/FleetArchitect/commit/77e674cf7531d15f6b661b5f65ad360fdcda1174))

## [1.30.2](https://github.com/Mearman/FleetArchitect/compare/v1.30.1...v1.30.2) (2026-06-28)


### Bug Fixes

* **sim:** consume base.spatial kite/evade/maintain/close (not just rules) ([afded3c](https://github.com/Mearman/FleetArchitect/commit/afded3c6975fecb92f456d0709f7d56d6273191d))

## [1.30.1](https://github.com/Mearman/FleetArchitect/compare/v1.30.0...v1.30.1) (2026-06-28)


### Bug Fixes

* **resolve:** don't leak undefined role onto resolved ships ([7731805](https://github.com/Mearman/FleetArchitect/commit/7731805faacb5c0110aac06c269d52540a913672))

# [1.30.0](https://github.com/Mearman/FleetArchitect/compare/v1.29.0...v1.30.0) (2026-06-27)


### Features

* **formation:** named waypoints + formation-showcase preset fleets ([09e2499](https://github.com/Mearman/FleetArchitect/commit/09e24992a834e2a1f4fda0b9411b0e3defc76b21))

# [1.29.0](https://github.com/Mearman/FleetArchitect/compare/v1.28.0...v1.29.0) (2026-06-27)


### Features

* **resolve:** consume formation layouts in the resolver ([dbec54c](https://github.com/Mearman/FleetArchitect/commit/dbec54c4f80f05958e637ef22cf39b8ad6a4e88a))

# [1.28.0](https://github.com/Mearman/FleetArchitect/compare/v1.27.0...v1.28.0) (2026-06-27)


### Features

* **ui:** formation-authoring console (tree, doctrine, canvas, templates) ([09bb231](https://github.com/Mearman/FleetArchitect/commit/09bb23178c308aa8a0211207f72f05fe35577fb9))

# [1.27.0](https://github.com/Mearman/FleetArchitect/compare/v1.26.0...v1.27.0) (2026-06-27)


### Features

* **sharing:** round-trip formation trees and share formation templates ([985fa9a](https://github.com/Mearman/FleetArchitect/commit/985fa9a1fe910db5875eab192a33e63286d1943c))

# [1.26.0](https://github.com/Mearman/FleetArchitect/compare/v1.25.0...v1.26.0) (2026-06-27)


### Features

* **schema:** wire formation templates into storage and battle-start ([9330cef](https://github.com/Mearman/FleetArchitect/commit/9330cef605c8562ec675dd332a4bf621a23feecc))

# [1.25.0](https://github.com/Mearman/FleetArchitect/compare/v1.24.0...v1.25.0) (2026-06-27)


### Features

* **sim:** carry formation identity on replay descriptor and roster ([befaccf](https://github.com/Mearman/FleetArchitect/commit/befaccf4da2a0414a99f1566e961805977e6d178))

# [1.24.0](https://github.com/Mearman/FleetArchitect/compare/v1.23.0...v1.24.0) (2026-06-27)


### Features

* **sim:** consume formation doctrine in movement and targeting ([eb51f3d](https://github.com/Mearman/FleetArchitect/commit/eb51f3de28709598feb8427c6babe6d96a521cf5))

# [1.23.0](https://github.com/Mearman/FleetArchitect/compare/v1.22.0...v1.23.0) (2026-06-27)


### Features

* **sim:** add the formation-doctrine pass (step 0d) ([14304db](https://github.com/Mearman/FleetArchitect/commit/14304db01192e499178ad5a710a743d24107ad28))

# [1.22.0](https://github.com/Mearman/FleetArchitect/compare/v1.21.2...v1.22.0) (2026-06-27)


### Features

* **schema:** expand formation templates and stamp formation identity at resolve ([5db2fd6](https://github.com/Mearman/FleetArchitect/commit/5db2fd680e60d54b6846a266954374d12009d881))

## [1.21.2](https://github.com/Mearman/FleetArchitect/compare/v1.21.1...v1.21.2) (2026-06-27)


### Bug Fixes

* **sharing:** round-trip leaf doctrine so decoded fleets resolve identically ([0bfcf66](https://github.com/Mearman/FleetArchitect/commit/0bfcf66f90b31c7013d4e773a158489454218dc5))

## [1.21.1](https://github.com/Mearman/FleetArchitect/compare/v1.21.0...v1.21.1) (2026-06-26)


### Bug Fixes

* **ui:** reduce glow gain 100x to prevent additive whiteout ([1e87d01](https://github.com/Mearman/FleetArchitect/commit/1e87d012e41d5ac720a87d73920870e9eefadff2))

# [1.21.0](https://github.com/Mearman/FleetArchitect/compare/v1.20.0...v1.21.0) (2026-06-26)


### Features

* **catalog:** capability-derived module mass + broadened anchor menu ([4e1cfda](https://github.com/Mearman/FleetArchitect/commit/4e1cfda7f293ca86517336edb5d7b2fa27afd2a5))
* **schema:** add engage range, retreat axis, and target reference ([0daeca1](https://github.com/Mearman/FleetArchitect/commit/0daeca13434978045ff74162bb97bb32b696ac64))
* **schema:** populate unified doctrine at every parse boundary ([5998884](https://github.com/Mearman/FleetArchitect/commit/59988844597966aeaf09a79ae4d3fbc91b85fc28))
* **sim:** phase 2 — exhaust deposits conserved mass + momentum into the medium ([72d6827](https://github.com/Mearman/FleetArchitect/commit/72d6827bb34a5408a30efcbf902afb60564fd722))
* **sim:** phase 3 — body-drag wakes in the medium ([109051c](https://github.com/Mearman/FleetArchitect/commit/109051cfd12783a6fcbe91bd519b952f49cebe78))
* **sim:** split medium ε into sensor-ε (stable) and visual-ε (streams) ([92746f1](https://github.com/Mearman/FleetArchitect/commit/92746f19a6a02c0693b2ea941d0e9167cf98e71e))
* **sim:** velocity substrate for the medium field (momentum + advection) ([2a949e1](https://github.com/Mearman/FleetArchitect/commit/2a949e18d3b8b3f7ebe86b5c2ff5815a0d6259f0))

# [1.20.0](https://github.com/Mearman/FleetArchitect/compare/v1.19.5...v1.20.0) (2026-06-26)


### Features

* **schema:** add unified doctrine and formation-tree vocabulary ([1079b19](https://github.com/Mearman/FleetArchitect/commit/1079b19a68a0ea72eda8e884b5bda088da626f64))
* **schema:** migrate Fleet from flat ships[] to a formation tree ([56d0149](https://github.com/Mearman/FleetArchitect/commit/56d01499f573f2bfd0dd792a290687c85baf6d6f))
* **schema:** thread formation identity onto combat and replay types ([4842310](https://github.com/Mearman/FleetArchitect/commit/4842310c11dade2da11b5c422b665a377896c5f7))
* **sim:** beam, projectile-wake, and impact-burst particle emitters ([3a06b38](https://github.com/Mearman/FleetArchitect/commit/3a06b389aedb62d5dfadda699c54b52621ec9fd7))
* **sim:** exhaust-particle collection lifecycle (step + cull by lifetime) ([d77b3ef](https://github.com/Mearman/FleetArchitect/commit/d77b3ef41283c057b986c6706d4439f95031020a))
* **sim:** exhaust-particle model — transported, emitted, cooling material ([1e5760f](https://github.com/Mearman/FleetArchitect/commit/1e5760f55b81ef37de4f929116a920fef17f7f8f))
* **sim:** gatherParticles — collect one tick's emissions from all sources ([824eece](https://github.com/Mearman/FleetArchitect/commit/824eece0ef38d4df5b7fd05b577468a08f960e6a))
* **sim:** wire exhaust particles into the engine, frames, and checkpoint ([d626c18](https://github.com/Mearman/FleetArchitect/commit/d626c1873f2dbb880a1b33efd48b38bc6f0fdae0))
* **ui:** render the weapon-source particle glow + bound its memory ([daa81cd](https://github.com/Mearman/FleetArchitect/commit/daa81cdd491ace8872b50ea11903487a603bfcc5))

## [1.19.5](https://github.com/Mearman/FleetArchitect/compare/v1.19.4...v1.19.5) (2026-06-26)


### Bug Fixes

* **designer:** stop grid drift, fix iso grid tilt, re-fit on New ([30b57e2](https://github.com/Mearman/FleetArchitect/commit/30b57e2527c61e4092c2720f440c4b0562a4393e))
* **ui:** resolve medium/atmosphere fields per-tick for scrub-safe replay ([2969d9d](https://github.com/Mearman/FleetArchitect/commit/2969d9de0ab72436e0b44be811b388222cbe4cd3))

## [1.19.4](https://github.com/Mearman/FleetArchitect/compare/v1.19.3...v1.19.4) (2026-06-25)


### Bug Fixes

* **ui:** relative star fade — stars visible at full zoom-out ([82e46cb](https://github.com/Mearman/FleetArchitect/commit/82e46cb5059cef858747af4d4997342c78651f15))

## [1.19.3](https://github.com/Mearman/FleetArchitect/compare/v1.19.2...v1.19.3) (2026-06-25)


### Bug Fixes

* **ui:** stars visible at full zoom-out — cheap integer star hash ([e92743c](https://github.com/Mearman/FleetArchitect/commit/e92743cc770764803f3befb7e64031e90754c58f))

## [1.19.2](https://github.com/Mearman/FleetArchitect/compare/v1.19.1...v1.19.2) (2026-06-25)


### Bug Fixes

* **ui:** starfield density-thinning with organic fade — no grid, no pop ([3281d21](https://github.com/Mearman/FleetArchitect/commit/3281d21ad2ee79157a1e6a91d4359241bcf4431b))

## [1.19.1](https://github.com/Mearman/FleetArchitect/compare/v1.19.0...v1.19.1) (2026-06-25)


### Bug Fixes

* **ui:** stable starfield — fixed lattice, no re-grid on zoom ([d8a6aac](https://github.com/Mearman/FleetArchitect/commit/d8a6aacce83ecc43e516a94fbcebe1f7663ae5ef))

# [1.19.0](https://github.com/Mearman/FleetArchitect/compare/v1.18.0...v1.19.0) (2026-06-25)


### Features

* **sim:** light-lag for sustained medium-cell radiation ([6944337](https://github.com/Mearman/FleetArchitect/commit/69443372c954c6f8b37e82b335ad87654154abf8))
* **ui:** analytic per-entity medium trails (exhaust/plume streaks) ([3ff7c99](https://github.com/Mearman/FleetArchitect/commit/3ff7c9905495ea6d04f72ca71b76c6281ff5b4f4))

# [1.18.0](https://github.com/Mearman/FleetArchitect/compare/v1.17.2...v1.18.0) (2026-06-25)


### Bug Fixes

* **sim:** exhaust deposits excitation only (no self-drag feedback) ([c0adb7b](https://github.com/Mearman/FleetArchitect/commit/c0adb7b60d68bafb28ba03e5964341465095b9b4)), closes [hi#thrust](https://github.com/hi/issues/thrust)
* **sim:** make medium-field radiation detectable (continuousContact + calibrated coupling) ([ae77c3e](https://github.com/Mearman/FleetArchitect/commit/ae77c3ef28fc22d5c9c63ed6df3c84ee5acfc1c4))


### Features

* **sim:** emergent sensor signatures from medium-field excitation ([de09db2](https://github.com/Mearman/FleetArchitect/commit/de09db2f36c696552e1415f5440ffdf07c3deef5)), closes [hi#excitation](https://github.com/hi/issues/excitation)
* **sim:** medium-field sources + gas drag (density-coupled physics) ([73cf340](https://github.com/Mearman/FleetArchitect/commit/73cf340fae768a352b5941585a8f1a6d7da0d50e))
* **sim:** powered×guided projectile taxonomy with finite-burn motors ([a9e2cd8](https://github.com/Mearman/FleetArchitect/commit/a9e2cd82d08cadd62d62a2bdaac4c339e5411598))
* **sim:** sensor dazzle — receiver saturation from intense EM ([df2f2ed](https://github.com/Mearman/FleetArchitect/commit/df2f2eda22ebda2e2f29be48bc7c330cd093fb6b)), closes [hi#emission](https://github.com/hi/issues/emission)
* **sim:** wire arena medium field into tick loop and frames ([5ae619a](https://github.com/Mearman/FleetArchitect/commit/5ae619a6a563d84ccab5bd8550774c05ad4c3de4))
* **ui:** medium-field glow overlay (emergent trails/plumes/ionisation) ([6a92e24](https://github.com/Mearman/FleetArchitect/commit/6a92e2476fe6829f8463005cedc669edbe8a0fd9))

## [1.17.2](https://github.com/Mearman/FleetArchitect/compare/v1.17.1...v1.17.2) (2026-06-25)


### Bug Fixes

* **ui:** drop fog shroud fill that obscured the starfield ([e4d24e9](https://github.com/Mearman/FleetArchitect/commit/e4d24e9b5fbf14a16e47a24b0dcfc0ec7251b6f2))

## [1.17.1](https://github.com/Mearman/FleetArchitect/compare/v1.17.0...v1.17.1) (2026-06-25)


### Bug Fixes

* **ui:** dedupe overlays, fix fog solid-circle bug, default off ([bc12e4e](https://github.com/Mearman/FleetArchitect/commit/bc12e4e566f85a992fce85215ce2a81a51acac4b))

# [1.17.0](https://github.com/Mearman/FleetArchitect/compare/v1.16.0...v1.17.0) (2026-06-25)


### Bug Fixes

* **sim:** correct ISM WIM baseline density (arithmetic error) ([03b60df](https://github.com/Mearman/FleetArchitect/commit/03b60df127c9edefcd48d06ff9c4cd22abdf45ee))


### Features

* **sim:** metres-based closest zoom limit for the battle camera ([6cc7947](https://github.com/Mearman/FleetArchitect/commit/6cc7947e68209df5059f645cb921e2f81dea7bbf))
* **sim:** pure arena medium-field solver (density + excitation) ([04559be](https://github.com/Mearman/FleetArchitect/commit/04559be394ecb6ea9c3b6befb61e97deefcebb2d))

# [1.16.0](https://github.com/Mearman/FleetArchitect/compare/v1.15.0...v1.16.0) (2026-06-25)


### Bug Fixes

* **armour:** grow the hull from armour cells only, not deck tiles ([61f8cb4](https://github.com/Mearman/FleetArchitect/commit/61f8cb4e8997d48cbb317aed2b49cc44598c07c9))
* **battle:** make every battle marker spatial (world units), not fixed pixels ([53e4d2c](https://github.com/Mearman/FleetArchitect/commit/53e4d2c093b5b6d862616920f2c8fd35bd37ce77))
* **battle:** project fog, overlays and anomaly through the iso transform ([fceec73](https://github.com/Mearman/FleetArchitect/commit/fceec73860ac786f809e156f5051f2843cdb8d19))
* **battle:** rescale angular acceleration into the per-tick clock ([c540580](https://github.com/Mearman/FleetArchitect/commit/c540580876304475cadd7700203a6ae44a2d28df))
* **battle:** tilt the per-ship rings into iso ellipses too ([98c6137](https://github.com/Mearman/FleetArchitect/commit/98c613741ecd54190f197d96a0093fcd1e045c22))
* **deploy:** floor the edge inset so hulls never cross the midline ([49b806e](https://github.com/Mearman/FleetArchitect/commit/49b806e2e5faffa529d3a6f32045e83e3fe44c1a))
* **designer:** attach pinch-zoom listener via callback ref ([37e2d0c](https://github.com/Mearman/FleetArchitect/commit/37e2d0cc1dba521a8b64c908b537e33f8ccac1d0))
* **designer:** hull stroke no longer scales/distorts with zoom ([a01fbfe](https://github.com/Mearman/FleetArchitect/commit/a01fbfe971ba5709f542574ac71cf265a4360e57))
* **designer:** keep content centred across zoom so the grid stops jumping ([b1cea40](https://github.com/Mearman/FleetArchitect/commit/b1cea40663a15e4d75eed68775b6a12834c47e45))
* **designer:** keep the hull overlay in sync with the grid ([45b805c](https://github.com/Mearman/FleetArchitect/commit/45b805cde6f6457584f1952c5befbc0c7e509b5c))
* **fx:** light the active key from within, not with an outer halo ([71450fd](https://github.com/Mearman/FleetArchitect/commit/71450fde789af7b1274e7b9743183caa856e1a05))
* **hull:** exclude bare substrate from the hull footprint ([d693c04](https://github.com/Mearman/FleetArchitect/commit/d693c04c149e6835effe6a1196937870517860e4))
* **hull:** keep every hull turn at or below 45 degrees on pinched footprints ([e35e283](https://github.com/Mearman/FleetArchitect/commit/e35e28335757cab5015a084d3d2860ac57303c72))
* **hull:** keep the hull hugging the plating (cap bevel deviation at one tile) ([5b2cdfb](https://github.com/Mearman/FleetArchitect/commit/5b2cdfbecb06ed50c513f1594014811aa3515858))
* **hull:** never drop plating to satisfy the sqrt-2 facet rule ([a0c8fe7](https://github.com/Mearman/FleetArchitect/commit/a0c8fe7b6d6f6c105659b9b3a50bac70059ec90e))
* **outline:** wrap the whole hull and smooth subdivided staircases ([cf90100](https://github.com/Mearman/FleetArchitect/commit/cf901005e38b9d3ad72e585dc96972be4195f6d8))
* **sim:** correct thrust->acceleration units and re-scale engagement geometry to realistic speeds ([7f7f4a6](https://github.com/Mearman/FleetArchitect/commit/7f7f4a66cfd28c31d045870b3fb34562473c7f82))
* **sim:** hold-order ships station-keep against their own recoil ([ebcd3f0](https://github.com/Mearman/FleetArchitect/commit/ebcd3f000dd3fe6a10d919cd37da119992bb12d1))
* **sim:** integrate SI re-grounding with main's checkpoint/cache stack ([f649f20](https://github.com/Mearman/FleetArchitect/commit/f649f200755d76f54f706ef12e52e6a7094b3b83))
* **sim:** keep checkpoint after completion; raise frame cap to 2000 ([d78d991](https://github.com/Mearman/FleetArchitect/commit/d78d9911aee792fe9d5e659baaa1047106835cc9))
* **sim:** re-tune the stalemate watchdog for km-scale time-of-flight ([2126c5b](https://github.com/Mearman/FleetArchitect/commit/2126c5b9b3e392f25a6773e92a30f77569f1411c))
* **sim:** seed resumed pre-frames so a re-interrupted resume keeps the full timeline ([dba8df7](https://github.com/Mearman/FleetArchitect/commit/dba8df709f462e3338707031bf67035782887368))
* **sim:** skip the resume checkpoint persist once preFrames exceeds a clone cap ([dd5aae1](https://github.com/Mearman/FleetArchitect/commit/dd5aae12a0a464f45d8509c6979b569e36ff07bd))
* **stats:** check connectivity on authored grid, not grown armour grid ([1ba6cb6](https://github.com/Mearman/FleetArchitect/commit/1ba6cb62f5393028958284c6d9a735bcf92a543e))
* **storage:** checkpoint put degrades on DataCloneError instead of throwing ([b1d7d4d](https://github.com/Mearman/FleetArchitect/commit/b1d7d4d2d0efda33970b22e36e7bd6e7ae003438))
* **storage:** degrade result cache on oversized results ([8b5dcb5](https://github.com/Mearman/FleetArchitect/commit/8b5dcb5edb3848ed4be0b0ff82571e1f24fbbabb))
* **storage:** drop the write-only battles history that OOMs IndexedDB ([cdf4b59](https://github.com/Mearman/FleetArchitect/commit/cdf4b591bf4b971505bb956e936113dc5281eb3f))
* **storage:** isUncloneable detects Dexie-wrapped DataCloneError, not just name ([a00fd4b](https://github.com/Mearman/FleetArchitect/commit/a00fd4b5f24f7a5e1d144eb6d4657a118cad592a))
* **ui:** don't show projectiles before their birth tick ([6d9818d](https://github.com/Mearman/FleetArchitect/commit/6d9818de9921443ba8565f4647d6a7e753c800ee))
* **ui:** render only asteroid discs in the asteroid-field renderer ([02109d0](https://github.com/Mearman/FleetArchitect/commit/02109d0c5bedd8eb8a39f991db2e5b27fad42ca0))
* **ui:** revert projectile streaks to interpolated dots ([5586d0b](https://github.com/Mearman/FleetArchitect/commit/5586d0b5e4dd60b349b6902df919d8f0a9d76c67))
* **ui:** smooth scrubbing via fractional slider step ([ea9c24e](https://github.com/Mearman/FleetArchitect/commit/ea9c24ef0366cfad2a824ff738e0e3860daf62c0))
* **ui:** stop nesting the delete button inside the ship-card button ([9d0de53](https://github.com/Mearman/FleetArchitect/commit/9d0de537ce06c1b628fe4337dca31f0364ae9df6))


### Features

* **armour:** fill grown corners and scale truncated-tile HP by coverage ([9b6843b](https://github.com/Mearman/FleetArchitect/commit/9b6843b361a7d554bc9cec8a15f3de69631bd386))
* **armour:** scale layer mass by coverage; fix resolve double-grow ([fc42cf0](https://github.com/Mearman/FleetArchitect/commit/fc42cf051ea546abc66226bf245e2ef0f9e6bf42))
* **armour:** wire auto-derived armour hull into sim, stats, and designer ([a312b3e](https://github.com/Mearman/FleetArchitect/commit/a312b3ef0a34c1e2aee147312e64facf01c0c490))
* **battle:** add a tilt-only 2.5D isometric battle view ([193549a](https://github.com/Mearman/FleetArchitect/commit/193549a1c8c07b02485b65643bb7f17f9e8e7935))
* **battle:** add pause/resume/stop computation lifecycle ([60e858b](https://github.com/Mearman/FleetArchitect/commit/60e858bb27dccaa9d0d8854c1d2e919a31bb867f))
* **battle:** extruded isometric ship cells + glyphs on the flat view ([2a1d292](https://github.com/Mearman/FleetArchitect/commit/2a1d2926209f8c746faf63f4585a253126d9bfdd))
* **battle:** fill the viewport; slim title; canvas grows to fit ([e1e13dd](https://github.com/Mearman/FleetArchitect/commit/e1e13dd2e9b1a2d72b8b0d75743b9fd3cae86dbf))
* **battle:** make the URL the shareable battle scenario, no share button ([c9b9f42](https://github.com/Mearman/FleetArchitect/commit/c9b9f4235b7f620db01f0077650a71b398e44359))
* **battle:** mount controls on a screen chassis; fixed console wings ([a529bf9](https://github.com/Mearman/FleetArchitect/commit/a529bf9d08ba5d25e2962a46d00f1b05286a1e68))
* **battle:** show the idle prompt on the display screen itself ([e4a4280](https://github.com/Mearman/FleetArchitect/commit/e4a4280fb679ae1cca03f15555f60785bbe9ac13))
* **battle:** wire auto-start prefs and compute controls into the route ([9882642](https://github.com/Mearman/FleetArchitect/commit/9882642d05e948ef33d41f106c7383a917503f6a))
* **designer:** auto-size the grid to fill the viewport, centred ([928b224](https://github.com/Mearman/FleetArchitect/commit/928b2241c39acb07a4aead4d9080b222f4ec2fb4))
* **designer:** centre-anchored zoom; loaded designs fill the viewport ([d0f898e](https://github.com/Mearman/FleetArchitect/commit/d0f898e64594504da53d0a3ac61d5e50be5848c6))
* **designer:** fit the ship grid to fill the viewport ([f3bafb4](https://github.com/Mearman/FleetArchitect/commit/f3bafb4fcc6f4f993715e52894bd892730c452bd))
* **designer:** fully editable isometric 2.5D ship builder ([4c556a4](https://github.com/Mearman/FleetArchitect/commit/4c556a46b6a274e1f2e33a28f17bad884fac0d4e))
* **designer:** live-sync the ship design to the URL ([607091d](https://github.com/Mearman/FleetArchitect/commit/607091df64ef5abc8271e15d2eb7f40c7dded51a))
* **designer:** render the octilinear hull outline in the grid editor ([f042ac9](https://github.com/Mearman/FleetArchitect/commit/f042ac9411497a873841a1f417b188f9abb3386c))
* **designer:** smooth pan/zoom that always fills the canvas ([2286338](https://github.com/Mearman/FleetArchitect/commit/2286338de7deeb2bb69a41025cbc1347e6f738a8))
* **designer:** trackpad pinch-to-zoom over the grid ([203bc84](https://github.com/Mearman/FleetArchitect/commit/203bc84789fc1d5bcd5c22653e2f2ea5b3f171be))
* **designer:** zoom resizes the grid to keep it filling the canvas ([c7b6ee4](https://github.com/Mearman/FleetArchitect/commit/c7b6ee444c5f627df097cfc90927005af4f361c4))
* **domain:** grow an octilinear armour hull around plating ([469421c](https://github.com/Mearman/FleetArchitect/commit/469421cda0a0f96c4a6185fed361896be6ef221a))
* **fleets:** fill the viewport; roster scrolls internally ([7788939](https://github.com/Mearman/FleetArchitect/commit/778893911f38e395699dd5ac3a46f75af5e725d3))
* **fleets:** overhaul the fleet builder with an inline grouped ship browser ([d47da12](https://github.com/Mearman/FleetArchitect/commit/d47da122cec0d4212fb69abab3975bf049449497))
* **fx:** glow controls when they become active, not on page load ([a113c41](https://github.com/Mearman/FleetArchitect/commit/a113c41e1291b6d9b61b8a091334d53d9e3d9f5c))
* **fx:** hover half-presses a key; clicking it lights it; support toggle keys ([4cbe837](https://github.com/Mearman/FleetArchitect/commit/4cbe83764bd3669211edafdd66bb8f10b0cca9f6))
* **fx:** power on displays and illuminate controls on mount, not the whole page ([94c89b6](https://github.com/Mearman/FleetArchitect/commit/94c89b606b7a5e60cb4d4e502cfa31e2e4c57fd5)), closes [#root](https://github.com/Mearman/FleetArchitect/issues/root)
* **hull:** bevel only armour; deck and walls stay rectilinear ([151dbf6](https://github.com/Mearman/FleetArchitect/commit/151dbf60607b8998252c100a4a8e329bfaefa00d))
* **hull:** grow+bevel octilinear hull outline (phase 1 geometry, wip) ([c21acd0](https://github.com/Mearman/FleetArchitect/commit/c21acd06491f94ccb039c77c3c66e0a4dca70bbe))
* **hull:** hug the plating instead of growing an armour ring ([aacdc9d](https://github.com/Mearman/FleetArchitect/commit/aacdc9dbba88c2177de79b7a2179edd83c7c23f2))
* **hull:** octilinear hull satisfies hard invariants on all real ships ([3c42b80](https://github.com/Mearman/FleetArchitect/commit/3c42b80f6f9ae3ff02c456a099d0608d10065a7c))
* **outline:** shrink-wrap the hull instead of chamfering corners ([14fbe28](https://github.com/Mearman/FleetArchitect/commit/14fbe2803a18ed8a02386b2e79744be2f741cece))
* **prefs:** add persistent battle preferences context ([b4e3fad](https://github.com/Mearman/FleetArchitect/commit/b4e3faddec927a0bf4560bd70d4826661a504477))
* **presets:** armour the Terran armoured-role frigates ([db717fb](https://github.com/Mearman/FleetArchitect/commit/db717fb886c0a9cf0adecb7444b1c331ee301c5a))
* **render:** shared per-kind module appearance — unified colour + glyphs ([2f4f563](https://github.com/Mearman/FleetArchitect/commit/2f4f563099e85ab6c2f58bf5a724468f49a61da3))
* **sharing:** compact binary grid codec ([f1b4633](https://github.com/Mearman/FleetArchitect/commit/f1b4633d5a847cf36f30fb5a077e01e2ffcc918c))
* **sharing:** compact self-contained share format v3 (binary grids) ([f4895f1](https://github.com/Mearman/FleetArchitect/commit/f4895f16f858fa9aa732244e3050a86a6d742487))
* **ships:** fill the viewport; grid grows, readouts move to the tools wing ([5b19f78](https://github.com/Mearman/FleetArchitect/commit/5b19f78c8e0618c60fa5997565621c6c535048a9))
* **ships:** overhaul the ship designer into the cassette console ([314275d](https://github.com/Mearman/FleetArchitect/commit/314275d63a781c8e7707e79aa79d13bc8b12b2eb))
* **sim:** browser interrupted-run resume via checkpoint store ([d2bdc51](https://github.com/Mearman/FleetArchitect/commit/d2bdc519a38e7a11c2e4d7b718b84303d59cfcc2))
* **sim:** cache contract with memory, disk and IndexedDB tiers ([1755c2e](https://github.com/Mearman/FleetArchitect/commit/1755c2e6b5c483ed58b47afe8d453106501a02d4))
* **sim:** content-addressed battle cache key from canonical determinants ([4f8b12a](https://github.com/Mearman/FleetArchitect/commit/4f8b12a30cdb730e9a152b5d1bc982ae935e713b))
* **sim:** derive attitude-control torque from a slew spec and real inertia ([0873f64](https://github.com/Mearman/FleetArchitect/commit/0873f648139ec5e752af5659722e19aab902c568))
* **sim:** emitters originate from their module; realistic ballistics ([150493c](https://github.com/Mearman/FleetArchitect/commit/150493c40621680246ec20f929d83c72e3a3439b))
* **sim:** energy-weapon beams as emission-duration lines ([30696f7](https://github.com/Mearman/FleetArchitect/commit/30696f74158dc6c0c9a78a34f6808f51662003b8))
* **sim:** engine checkpoint schema with authoritative-state capture and restore ([98645a4](https://github.com/Mearman/FleetArchitect/commit/98645a4e9f9c92b77f50a96e7274bdfb9e8305bc))
* **sim:** expose a canonical SimConfig determinant snapshot for cache keying ([65d7729](https://github.com/Mearman/FleetArchitect/commit/65d772995e76ec8c8ffce389af2da68abab7ccf1))
* **sim:** expose deterministic RNG and projectile-counter state for checkpointing ([ca2ca67](https://github.com/Mearman/FleetArchitect/commit/ca2ca677ca2b78b792d0cb36f7fbc61a120f87ad))
* **sim:** re-ground damage and HP in joules ([0877948](https://github.com/Mearman/FleetArchitect/commit/08779483d513bfd32a17db4e56749e9bec0bf9f7))
* **sim:** re-ground reactor power, shields and the thermal field in SI units ([abe5393](https://github.com/Mearman/FleetArchitect/commit/abe5393d3a34094a16e671166eb3b7b5402a35e9))
* **sim:** remove the battle tick cap; terminate on a no-progress watchdog ([85da3ed](https://github.com/Mearman/FleetArchitect/commit/85da3edb2190dafec5250223dc9cb3e574ef87e9))
* **sim:** rescale engagement geometry, deployment and sensors to km combat ([e7a58f1](https://github.com/Mearman/FleetArchitect/commit/e7a58f15d1c9bd7d12268a6d5fa5ef17e7ee2fd4))
* **sim:** rescale the black hole and occluders to the km arena and joule damage ([51f8fc3](https://github.com/Mearman/FleetArchitect/commit/51f8fc3ce55c468b6671d9095061c2c287591915))
* **sim:** resume a battle from an EngineCheckpoint, byte-identical to a fresh run ([cc908c3](https://github.com/Mearman/FleetArchitect/commit/cc908c312a694b01737d529672729021fda5ba30))
* **ui:** add annunciator legend-lamp button and indicator ([67822a6](https://github.com/Mearman/FleetArchitect/commit/67822a6786bf964fb56c65165b70ef9047ae54ee))
* **ui:** crop rendered cells to the chamfered hull outline ([2ed5262](https://github.com/Mearman/FleetArchitect/commit/2ed52622e39301bb3cf4ea2e32f4c1ff339c885b))
* **ui:** fit the home and import routes to the viewport ([8b1d558](https://github.com/Mearman/FleetArchitect/commit/8b1d55836cfd388f494d46f478fb53883cb64da4))
* **ui:** format energy and power stats with SI prefixes ([34d32dd](https://github.com/Mearman/FleetArchitect/commit/34d32dda0b2a5b9236f5e91192bdf9d608a6a199))
* **ui:** grouped, visual ship browser with sprite thumbnails ([740d445](https://github.com/Mearman/FleetArchitect/commit/740d4452b005889565aa574c73d181dc3cad168b))
* **ui:** lock the app shell to the viewport on desktop ([8b7cc7e](https://github.com/Mearman/FleetArchitect/commit/8b7cc7e43e6089c723785dfe1edb47dd9fc18885))
* **ui:** multi-select combinable spatial anomalies ([96c78c5](https://github.com/Mearman/FleetArchitect/commit/96c78c5041b5dad6fb9bb6f9f8136af8392d34a6))
* **ui:** read-through battle result cache at the runner boundary ([749bcca](https://github.com/Mearman/FleetArchitect/commit/749bcca2067971aa83d80d85ef03c1c2103fccde))


### Performance Improvements

* **cache:** refactor-stable algorithm signature from pinned frame hashes + cheap cache-read guard ([3ea7c87](https://github.com/Mearman/FleetArchitect/commit/3ea7c87adcca704539c7b72331c02b9aece8c86a))
* **designer:** render only built cells; draw the grid as a background ([dc5c400](https://github.com/Mearman/FleetArchitect/commit/dc5c400d2e72dd35d0be1924a1ed9c8c1489568b))
* **sim:** add per-tick battle benchmark ([94da81f](https://github.com/Mearman/FleetArchitect/commit/94da81f69dba27a488b3fdf272ca3cbd8a039e90))
* **sim:** array-indexed union-find in break-apart as a parallel implementation ([bf1542c](https://github.com/Mearman/FleetArchitect/commit/bf1542cee2984dcb8e0441540708ba5d4fea95d6))
* **sim:** assemble the worker result on the main thread, stop re-sending frames ([9b9abe1](https://github.com/Mearman/FleetArchitect/commit/9b9abe1ef929f518c661495aec4687b55395b5e0))
* **sim:** binary-frame cells + resource via typed arrays, zero-copy transfer ([0e7ce02](https://github.com/Mearman/FleetArchitect/commit/0e7ce027f0bef3933037313e25a46a1c8d043915))
* **sim:** cache the transport index on each module as a parallel implementation, byte-identical ([22ac12c](https://github.com/Mearman/FleetArchitect/commit/22ac12c1bec0c2bd52d1b8dd4580feddfbfdc948)), closes [#1](https://github.com/Mearman/FleetArchitect/issues/1)
* **sim:** drop the redundant slotId from per-tick CellState, index-match cells ([95a3ffa](https://github.com/Mearman/FleetArchitect/commit/95a3ffa2fd44769741dae6ba2c5afcc2b2a8dc91))
* **sim:** forward the resume checkpoint only when it changes, not every batch ([0cfb333](https://github.com/Mearman/FleetArchitect/commit/0cfb333aac1d5235d03843dd21187ff32708fbd6))
* **sim:** lighten worker streaming - envelope guard, smaller batches, rAF-deferred UI accumulation ([56e8c72](https://github.com/Mearman/FleetArchitect/commit/56e8c720a5413f4ba7e67c273cbf6741b651e41a))
* **sim:** numeric cell keys in break-apart fast path, drop per-call string keys ([837e768](https://github.com/Mearman/FleetArchitect/commit/837e768b24eca3c04d19ec2553836e760f16b1a1))
* **sim:** rebuild roster maps only when ship count changes ([a4af4f9](https://github.com/Mearman/FleetArchitect/commit/a4af4f92a6be36320965e05afa64023dcd33fa17))
* **sim:** ship-pair collision broad-phase as a parallel implementation, byte-identical ([64945bd](https://github.com/Mearman/FleetArchitect/commit/64945bd2ce3381529c885f232f4d0dfc2931c994))
* **sim:** skip break-apart on an unchanged alive count, as parallel implementations ([1d27d7b](https://github.com/Mearman/FleetArchitect/commit/1d27d7b8f06e6b698e2020a882ecbd8cd6e6e312))
* **sim:** skip cell-hash build on projectile-empty ticks ([f7d915d](https://github.com/Mearman/FleetArchitect/commit/f7d915d93ba4a1d8fb50ae68abd5d436ca1d0f2d))
* **sim:** subsample the per-tick resource block, renderer holds the last-known ([65ade21](https://github.com/Mearman/FleetArchitect/commit/65ade21ea9e4e7c589dde7334c26c4580a8af267))

# [1.16.0](https://github.com/Mearman/FleetArchitect/compare/v1.15.0...v1.16.0) (2026-06-22)


### Bug Fixes

* **deploy:** floor the edge inset so hulls never cross the midline ([49b806e](https://github.com/Mearman/FleetArchitect/commit/49b806e2e5faffa529d3a6f32045e83e3fe44c1a))
* **fx:** light the active key from within, not with an outer halo ([71450fd](https://github.com/Mearman/FleetArchitect/commit/71450fde789af7b1274e7b9743183caa856e1a05))
* **outline:** wrap the whole hull and smooth subdivided staircases ([cf90100](https://github.com/Mearman/FleetArchitect/commit/cf901005e38b9d3ad72e585dc96972be4195f6d8))
* **sim:** correct thrust->acceleration units and re-scale engagement geometry to realistic speeds ([7f7f4a6](https://github.com/Mearman/FleetArchitect/commit/7f7f4a66cfd28c31d045870b3fb34562473c7f82))


### Features

* **battle:** make the URL the shareable battle scenario, no share button ([c9b9f42](https://github.com/Mearman/FleetArchitect/commit/c9b9f4235b7f620db01f0077650a71b398e44359))
* **battle:** mount controls on a screen chassis; fixed console wings ([a529bf9](https://github.com/Mearman/FleetArchitect/commit/a529bf9d08ba5d25e2962a46d00f1b05286a1e68))
* **battle:** show the idle prompt on the display screen itself ([e4a4280](https://github.com/Mearman/FleetArchitect/commit/e4a4280fb679ae1cca03f15555f60785bbe9ac13))
* **fleets:** overhaul the fleet builder with an inline grouped ship browser ([d47da12](https://github.com/Mearman/FleetArchitect/commit/d47da122cec0d4212fb69abab3975bf049449497))
* **fx:** glow controls when they become active, not on page load ([a113c41](https://github.com/Mearman/FleetArchitect/commit/a113c41e1291b6d9b61b8a091334d53d9e3d9f5c))
* **fx:** hover half-presses a key; clicking it lights it; support toggle keys ([4cbe837](https://github.com/Mearman/FleetArchitect/commit/4cbe83764bd3669211edafdd66bb8f10b0cca9f6))
* **fx:** power on displays and illuminate controls on mount, not the whole page ([94c89b6](https://github.com/Mearman/FleetArchitect/commit/94c89b606b7a5e60cb4d4e502cfa31e2e4c57fd5)), closes [#root](https://github.com/Mearman/FleetArchitect/issues/root)
* **outline:** shrink-wrap the hull instead of chamfering corners ([14fbe28](https://github.com/Mearman/FleetArchitect/commit/14fbe2803a18ed8a02386b2e79744be2f741cece))
* **sharing:** compact binary grid codec ([f1b4633](https://github.com/Mearman/FleetArchitect/commit/f1b4633d5a847cf36f30fb5a077e01e2ffcc918c))
* **sharing:** compact self-contained share format v3 (binary grids) ([f4895f1](https://github.com/Mearman/FleetArchitect/commit/f4895f16f858fa9aa732244e3050a86a6d742487))
* **ships:** overhaul the ship designer into the cassette console ([314275d](https://github.com/Mearman/FleetArchitect/commit/314275d63a781c8e7707e79aa79d13bc8b12b2eb))
* **sim:** remove the battle tick cap; terminate on a no-progress watchdog ([85da3ed](https://github.com/Mearman/FleetArchitect/commit/85da3edb2190dafec5250223dc9cb3e574ef87e9))
* **ui:** add annunciator legend-lamp button and indicator ([67822a6](https://github.com/Mearman/FleetArchitect/commit/67822a6786bf964fb56c65165b70ef9047ae54ee))
* **ui:** grouped, visual ship browser with sprite thumbnails ([740d445](https://github.com/Mearman/FleetArchitect/commit/740d4452b005889565aa574c73d181dc3cad168b))

# [1.15.0](https://github.com/Mearman/FleetArchitect/compare/v1.14.0...v1.15.0) (2026-06-21)


### Bug Fixes

* **canvas:** pin the backdrop grid and starfield to a fixed world lattice ([33ccd61](https://github.com/Mearman/FleetArchitect/commit/33ccd615e16300763caf8db78154311d2e43c1fa))


### Features

* add material and bevel design tokens ([76c4ce3](https://github.com/Mearman/FleetArchitect/commit/76c4ce30fabb5428fe4dac99cdbeab4b5d74cc0a))
* confine CRT scanlines and vignette to the battle and designer displays ([a16b211](https://github.com/Mearman/FleetArchitect/commit/a16b211b5a4ea7bd9e8eedebe2e5f9f07316d860))
* pressable hardware buttons and recessed inset inputs ([acc438c](https://github.com/Mearman/FleetArchitect/commit/acc438c6a20a2c29cfb0f086da14d7f2a5212394))
* raise panels into bezels with fx-gated brushed metal ([ad9c828](https://github.com/Mearman/FleetArchitect/commit/ad9c828596fba7194ea8c685b3b348e1ec43aa9e))
* recess battle and designer viewports into screen wells ([aa2fee7](https://github.com/Mearman/FleetArchitect/commit/aa2fee7e722de08780351726ec1543a4fef5ecac))

# [1.14.0](https://github.com/Mearman/FleetArchitect/compare/v1.13.1...v1.14.0) (2026-06-21)


### Features

* **battle:** auto-fit the camera to live ships, breakable by zoom/pan ([feb4adc](https://github.com/Mearman/FleetArchitect/commit/feb4adc9f2a0db4ae0d67e26ebf9a283927b19f0))

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
