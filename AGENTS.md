# dubwise: working context

A dub sound system in the browser, live at https://alb777.github.io/dubwise/. Plain JavaScript ES modules, no build step, no runtime dependencies; npm is dev tooling only. Every sound is synthesized with Web Audio, and the app is a PWA that works offline.

## Layout

1. `index.html`, `styles.css` (themes are `[data-theme]` blocks), `sw.js` (offline cache), `manifest.webmanifest`, `icons/`.
2. `src/`: the browser app. `engine.js` voices and effects, `sequencer.js` scheduling, `app.js` UI, `console.js` commands and `THEMES`, `guide.js`, `selector.js`, `log.js`, `ai.js` AI providers, `ai-worker.js` plus `webllm.js` for the in-browser model.
3. `skills/dubwise/scripts/`: the core the app and the tests share. `notation.mjs` (riddim text format, `DRUMS`), `composer.mjs` (idea to riddim, `refine`), `intent.mjs`, `lexicon.mjs`, `artists.mjs` (generated). Beside them, `SKILL.md` and `cli.mjs` are the agent skill and its command line, and `llms.txt` at the root points models at the app.
4. `skills/dubwise/assets/`: preset riddims and `lexicon.bin`, the generated word map.
5. `tests/*.test.mjs`: node:test, audio rendered offline with node-web-audio-api. `tests/browser/`: headless Chromium checks over the DevTools protocol (`cdp.mjs`), screenshots in the gitignored `tests/browser/out/`.
6. `tools/`: `sw-version.mjs`, `build-lexicon.mjs`, `build-references.mjs`, demo recorders (`record-*.mjs`). `docs/`: demo video, GIF and screenshot.

## Commands

1. `npm ci`: install the dev tooling (verified 2026-10-17).
2. `npm test`: all unit tests (verified 2026-10-21, 417 passing).
3. `npm run check`: `tsc` on the JSDoc types plus `biome check .` (verified 2026-10-21).
4. `npm run check:browser`: audio and UI checks in a headless browser, Brave by default, `BROWSER=google-chrome` as in CI (verified 2026-10-21 with Brave).
5. `npm run sw:version`: restamp the service worker cache names (verified 2026-10-21, restamped for the lead line).
6. `python3 -m http.server 8000`, then open http://localhost:8000: dev server (verified 2026-10-17).
7. `npm run check:offline`: offline check against the published site (ran 2026-10-17, passed after the 96-cell grid fix).
8. `npm run check:ai`: the real in-browser model on the GPU, 1.1 GB download, needs WebGPU through Vulkan (not run).
9. `npm run build:lexicon`: rebuild `lexicon.bin` from a 512 MB model download (not run).
10. `npm run build:references`: rebuild `artists.mjs` and `src/selector-content.js` from a private source outside this repo (not run, needs that source).
11. `git push origin main`: publishes, GitHub Pages serves `main` as it is (not run).
12. `node skills/dubwise/cli.mjs compose "<idea>"`: the agent skill's CLI, `spec`, `refine`, `check` and `url` (verified 2026-10-21, `tests/skill.test.mjs`).

## Conventions

1. One-line conventional commits without scope: `feat: x`, `fix: x`, `docs: x`, `test: x`. No AI attribution, no Co-Authored-By.
2. Solo project: commit straight to `main`, no branches or PRs.
3. Before a push run `npm test` and `npm run check`, plus `npm run check:browser` when UI or audio changed.
4. After a push, follow that exact commit with `gh run list --commit <sha>` until `ci` and `pages build and deployment` are both green. Right after a push "the latest run" can still be the previous commit's. A red run gets fixed before the work counts as done.
5. Biome: 4 spaces, 120 columns, it also covers tests and tools. `tsc` is strict on `src/` and `skills/`.

## Gotchas

1. Any change to a precached file (the `PRECACHE` list in `sw.js`) or to `lexicon.bin` needs `npm run sw:version`, or a test fails and returning visitors keep the old app. A new file in `src/` or `skills/dubwise/scripts/` must also go into `PRECACHE`.
2. `artists.mjs` and `src/selector-content.js` are generated and obfuscated. Never edit them by hand.
3. A new drum voice touches `DRUMS` (notation.mjs), `TRACKS`, `MIX` and `trigger` (engine.js), `eventsAt` (sequencer.js), `refine` (composer.mjs), and the hard-coded counts: 16 `.cell` per row, 7 rows and 7 strips in `tests/browser/ui.mjs`, 112 cells in `tests/browser/offline.mjs`. A chord row such as the `organ` bubble also needs `CHANNELS` (console.js) for mute, solo and throw. A new pitched row, such as the `lead` melodica line, adds 16 more `.note` cells per row in `tests/browser/ui.mjs`.
4. node-web-audio-api applies `setTargetAtTime` early after a gap and the gain explodes. Anchor it with `setValueAtTime(v, t)` at the same time. Choke with a separate GainNode, not `cancelScheduledValues`, which also kills the decay in real browsers. It also refuses to assign a `WaveShaperNode.curve` twice, or to null: color a waveshaper per setting by automating gains around one fixed curve, never by swapping the curve.
5. Its compressor differs from Chromium's, so the master chain ends in a transparent safety clipper. Keep it.
6. `src/ai-worker.js` imports only `src/webllm.js`, which imports nothing. A heavier import delays `onmessage`, the page's first message is lost and the model never loads. A unit test guards the imports, but only `check:ai` proves the model loads.
7. WebLLM serves one request at a time per model, so a hung answer blocks every later idea. AI timeouts terminate the worker instead of interrupting it.
8. CI runs Node 24: keep the test glob quoted (`node --test "tests/*.test.mjs"`) or it finds no tests.
9. Bass, the lead line and chords are scale degrees, so key and mode changes keep them. References carry style traits only, never a real bassline or melody.
10. WebGPU on Linux needs Vulkan, which can break video in a whole browser. Suggest it only for a separate profile, never an everyday one. Keep `DUBWISE_AI_PROFILE` on disk, not on a RAM tmpfs `/tmp`.
11. Headless Chrome reports `hover: none`, so hover-only UI such as `.keys-hint` never shows in screenshots.
12. A new theme needs a `[data-theme]` block in `styles.css`, an entry in `THEMES` and a pass of the WCAG contrast test in `tests/themes.test.mjs`.
13. `skills/dubwise/cli.mjs` starts with `@ts-nocheck` on purpose: `tsconfig` has `"types": []`, so Node's process, stdin and fs are untyped there; the composer and notation it imports stay checked.
