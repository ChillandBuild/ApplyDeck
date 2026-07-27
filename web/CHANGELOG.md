# Changelog

## [0.4.0](https://github.com/ChillandBuild/ApplyDeck/compare/web-v0.3.0...web-v0.4.0) (2026-07-27)


### Features

* scheduled-automation runner + apify field-map fallbacks; fix blacklist bug ([03ce7b9](https://github.com/ChillandBuild/ApplyDeck/commit/03ce7b9865320d930e029fa3376e542f6b327f2d))
* **web:** add a company to scan by pasting its job-board URL ([04fbe71](https://github.com/ChillandBuild/ApplyDeck/commit/04fbe71613546b8c366ac40802d4e301b34331ab))
* **web:** add ApifyScanEvent type and widen ExploreMode to include apify ([ca74e63](https://github.com/ChillandBuild/ApplyDeck/commit/ca74e63ebede4fb6bfb1a4ec969d8d9f27c68f4d))
* **web:** add ApifySourcePicker, the dynamic Sources row for Apify mode ([36b2936](https://github.com/ChillandBuild/ApplyDeck/commit/36b2936de2b487f63ee2799e2daa4c915d4781da))
* **web:** add isApifyPluginEnabled/isApifyTokenConfigured gate helpers ([30efb9d](https://github.com/ChillandBuild/ApplyDeck/commit/30efb9def8062e38d8962a6ee155aa642e0441fe))
* **web:** add POST /api/explore/apify streaming discovery route ([7871fa2](https://github.com/ChillandBuild/ApplyDeck/commit/7871fa2dade565db7d3f500dffe94d12b307a83f))
* **web:** add the Apify pill to the Explore mode toggle ([6c138bf](https://github.com/ChillandBuild/ApplyDeck/commit/6c138bfe44c3ec2ce1260744add97bb0378d6d7c))
* **web:** Apify composer (Phase 1) + Pilot/Scout page scaffolding ([420714c](https://github.com/ChillandBuild/ApplyDeck/commit/420714ceedd326fe45e62d35c0e776d75d4b2924))
* **web:** Automation Safety card on the Config page (caps, allowlist, vendors) ([75901dc](https://github.com/ChillandBuild/ApplyDeck/commit/75901dc44c84ae9e35198c4723c55405eb20f478))
* **web:** bring-your-own Apify token, stored in .env, never echoed back ([62b5d82](https://github.com/ChillandBuild/ApplyDeck/commit/62b5d82445dc0f2686717c68871c1da28366522f))
* **web:** complete Pilot/Scout wiring — de-dup, scheduled Apify, web search ([ee20e62](https://github.com/ChillandBuild/ApplyDeck/commit/ee20e62b31f3b1a62ea1bf5996187fb246b47345))
* **web:** Do Not Apply blacklist editor on the Config page ([d7d3b52](https://github.com/ChillandBuild/ApplyDeck/commit/d7d3b524a14f26db12f61d16311a47b4954f51cc))
* **web:** expose automation safety caps + tier switch via /api/automation ([ed499c9](https://github.com/ChillandBuild/ApplyDeck/commit/ed499c927a5628358b839625849571ba81eecca3))
* **web:** expose provider:apify entries as apifySources on the snapshot ([1c17d99](https://github.com/ChillandBuild/ApplyDeck/commit/1c17d99612355c6bc290de7d365a6e1a28c415b1))
* **web:** extract readPortalsDoc() shared portals.yml reader ([8fc015f](https://github.com/ChillandBuild/ApplyDeck/commit/8fc015f9db595c4d023437d0d20ef2b7eb2ace60))
* **web:** GET/PUT /api/automation — schedule_hours reader/writer ([1f62452](https://github.com/ChillandBuild/ApplyDeck/commit/1f62452bdd9c706197c1ea9160acf2b8a02af7e6))
* **web:** Job Targeting card on the Config page ([c545808](https://github.com/ChillandBuild/ApplyDeck/commit/c545808cd337ae844689ef4b1d6bda763444e8d2))
* **web:** PUT /api/portals — targeting + apify entry writer ([1787d18](https://github.com/ChillandBuild/ApplyDeck/commit/1787d1826685994a6be663cf920fcdd0cc927346))
* **web:** read-only Automation Activity log on the Config page ([6e5cf46](https://github.com/ChillandBuild/ApplyDeck/commit/6e5cf46bf9f6308f73eb29cd2059e8d97437ce9b))
* **web:** rebrand UI to ApplyDeck — deck-mark logo, favicon, visible strings ([4219d71](https://github.com/ChillandBuild/ApplyDeck/commit/4219d71837c8c83a407ff07bb5d719237232f877))
* **web:** render Apify mode in ExplorerView ([81b7649](https://github.com/ChillandBuild/ApplyDeck/commit/81b76492cfaabcba5cec9cfe7fbd52a8975660af))
* **web:** toggleable Search Sources card on the Config page ([effab8b](https://github.com/ChillandBuild/ApplyDeck/commit/effab8b30138910f12970a74f303191db1757e5f))
* **web:** wire Apify mode into ExploreProvider ([00751e7](https://github.com/ChillandBuild/ApplyDeck/commit/00751e78a9baeee64d625f3b00907e3a312c3d3c))


### Bug Fixes

* **web:** inbox pipeline sync, cv upload, shuffle sampling; apify url fixes ([170d446](https://github.com/ChillandBuild/ApplyDeck/commit/170d44608932806433c14b9377ea47a5f5b87157))
* **web:** make the targeting-UI tests actually runnable, harden gitignore ([4ba1e20](https://github.com/ChillandBuild/ApplyDeck/commit/4ba1e202ae2caca3339da672dd8bbc71282e8daf))

## [0.3.0](https://github.com/santifer/career-ops/compare/web-v0.2.0...web-v0.3.0) (2026-07-07)


### Features

* **patterns:** per-agency advance-rate analysis from the Via channel ([b6ce551](https://github.com/santifer/career-ops/commit/b6ce551e4404f15b20404ecc642886cfe8a2c4c5))
* **tracker:** Via channel — end employer vs recruiter/agency intermediary ([#1599](https://github.com/santifer/career-ops/issues/1599)) ([b66c0b4](https://github.com/santifer/career-ops/commit/b66c0b4a76e9f3738bbddac2ebeb612053e0a9cc))


### Bug Fixes

* **deps:** update npm dependencies ([#1593](https://github.com/santifer/career-ops/issues/1593)) ([253c571](https://github.com/santifer/career-ops/commit/253c5719df403cdaa493db27cdd17349f54f7889))
* **tracker:** retrofit remaining positional readers onto the shared header-aware parser ([#1598](https://github.com/santifer/career-ops/issues/1598)) ([369a5ff](https://github.com/santifer/career-ops/commit/369a5ffcf6623750fcbedbd16be7d3c1c84f1111))
* **web:** 44px tap-targets at the component level ([#1629](https://github.com/santifer/career-ops/issues/1629)) ([388542f](https://github.com/santifer/career-ops/commit/388542f3c0a2f82eeac83be8db5b616c213225b9))
* **web:** contrast tokens — AA across both themes ([#1627](https://github.com/santifer/career-ops/issues/1627)) ([ee89bea](https://github.com/santifer/career-ops/commit/ee89bea997702d40d1cc01620f727bbb66146b9b))
* **web:** portals copy + analytics semantics ([#1628](https://github.com/santifer/career-ops/issues/1628)) ([f8daa19](https://github.com/santifer/career-ops/commit/f8daa19d8ea164dd2bbb63834f2d048a34ccaa63))
* **web:** ux-audit cleanup — CostBadge global CSS + last sub-44 stragglers ([#1648](https://github.com/santifer/career-ops/issues/1648)) ([786b960](https://github.com/santifer/career-ops/commit/786b960c2761e88a534886eafdc9d59f82aba56b))

## [0.2.0](https://github.com/santifer/career-ops/compare/web-v0.1.0...web-v0.2.0) (2026-07-05)


### Features

* experimental local-first web UI (opt-in alpha) ([#1451](https://github.com/santifer/career-ops/issues/1451)) ([1791dc4](https://github.com/santifer/career-ops/commit/1791dc4e3a14aeb10decd852c927bb636aefe00d))
* **pipeline:** optional per-offer note in the pipeline writer ([#1483](https://github.com/santifer/career-ops/issues/1483)) ([6435b1a](https://github.com/santifer/career-ops/commit/6435b1a4dc93a9d441df8768e481d878e3309ae3))
* **web:** Config microcopy humanized (P1.5) ([#1538](https://github.com/santifer/career-ops/issues/1538)) ([8ae3475](https://github.com/santifer/career-ops/commit/8ae347502b8380692a5f80f490bc59f20d1c8491))
* **web:** cost affordance — CostBadge muted (P1.6) ([#1536](https://github.com/santifer/career-ops/issues/1536)) ([b212bb3](https://github.com/santifer/career-ops/commit/b212bb3591de4c374347dec40fc400c4d6ab9bda))
* **web:** dedupe bug reports at write — stable fingerprint + click-gated similar-issue search ([#1473](https://github.com/santifer/career-ops/issues/1473)) ([e13a4f3](https://github.com/santifer/career-ops/commit/e13a4f37d6df9d21c0acca1d1716993df036e01d))
* **web:** empty-state free-scan button (P0.1) ([#1534](https://github.com/santifer/career-ops/issues/1534)) ([28f12e3](https://github.com/santifer/career-ops/commit/28f12e39e3e41104bb7a1f3650a0a508701f82fe))
* **web:** extract cleanChips to a tested module + tab/CR paste delimiter ([#1516](https://github.com/santifer/career-ops/issues/1516)) ([7e676f4](https://github.com/santifer/career-ops/commit/7e676f403e16c84231bb08669c79218615a88c83))
* **web:** inbox triage — Abundance → Triage → Shortlist → Opt-in Score ([#1569](https://github.com/santifer/career-ops/issues/1569)) ([f1e6cc0](https://github.com/santifer/career-ops/commit/f1e6cc0ef2dae1f134e9d6bbb152611107a36308))
* **web:** mobile tap-targets ≥44px + FAB clearance ([#1542](https://github.com/santifer/career-ops/issues/1542)) ([7f6fd1c](https://github.com/santifer/career-ops/commit/7f6fd1c8f34fd0137a995bd2bb4b1f295c8a9303))
* **web:** orange hierarchy — brand-soft Mark-applied + inbox cost legend (P1.4) ([#1537](https://github.com/santifer/career-ops/issues/1537)) ([85d8290](https://github.com/santifer/career-ops/commit/85d829018c7b7225a1bbd547c53b817fd165924d))
* **web:** report progressive disclosure (P0.3+P1.8) ([#1535](https://github.com/santifer/career-ops/issues/1535)) ([30fa1d1](https://github.com/santifer/career-ops/commit/30fa1d19d00bf9a269adcef6778c52a1627d668c))
* **web:** richer bug-report diagnostics — data-shape fingerprint, core version, API errors ([#1469](https://github.com/santifer/career-ops/issues/1469)) ([6a13d8a](https://github.com/santifer/career-ops/commit/6a13d8a7a5448c5f488cac1631a1da471c070335))


### Bug Fixes

* correctness sweep across tracker, providers, and eval reporting ([#1528](https://github.com/santifer/career-ops/issues/1528)) ([bd2a44f](https://github.com/santifer/career-ops/commit/bd2a44f4ee1ea6c6def70200d7750969e67ebadf)), closes [#1527](https://github.com/santifer/career-ops/issues/1527)
* **web:** bump FOLLOW-UPS DUE tap-targets to 44px on mobile ([#1568](https://github.com/santifer/career-ops/issues/1568)) ([f5e8362](https://github.com/santifer/career-ops/commit/f5e836268c8a16707566becb51675d0b52a670dd))
* **web:** pin turbopack.root to prevent Windows postcss OOM ([#1530](https://github.com/santifer/career-ops/issues/1530)) ([8560153](https://github.com/santifer/career-ops/commit/8560153ad8aa37a3993418d32f951f25c868c6c4))
* **web:** point the 'Get one free' link at the free-AI-engine guide ([#1540](https://github.com/santifer/career-ops/issues/1540)) ([8369b40](https://github.com/santifer/career-ops/commit/8369b4001ba63be78818240b9dbc3aa94aebe2e8))
* **web:** restore the report-a-bug kit lost between the RC branch and main ([#1456](https://github.com/santifer/career-ops/issues/1456)) ([b11231f](https://github.com/santifer/career-ops/commit/b11231ffc77dfbd36b745b35df0b6ded3bb73720))
