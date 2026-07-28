# Copilot instructions for `local-check`

## Build, test, and lint commands

- Install: `npm install`
- Dev server: `npm run dev`
- Production build (TypeScript project refs + Vite): `npm run build`
- Lint: `npm run lint`
- Format check: `npm run format:check`
- Unit tests (all): `npm run test`
- Unit test (single file): `npm run test -- tests/unit/normalizeIgc.spec.ts`
- Unit test (single test name): `npm run test -- -t "normalizes a valid IGC file into a NormalizedFlight"`

## High-level architecture

This repository is a client-only React + TypeScript SPA for glider IGC replay and debrief, with no backend in Phase 1.

### Data flow

1. IGC file upload is handled in `src/hooks/useIgcFileLoader.ts`.
2. Parsing runs off the main thread in `src/workers/igcParser.worker.ts`.
3. Domain normalization (`src/domain/normalizeIgc.ts`) converts `igc-parser` output into `NormalizedFlight`.
4. Derived metrics and summary are computed once at load time in `src/domain/derivedMetrics.ts` and `src/domain/summary.ts`.
5. Zustand state in `src/state/useFlightStore.ts` stores the full flight and replay state.
6. UI components (`src/components/*`) render map, barogram, controls, telemetry, and summary from store state.

### Replay synchronization model

- `currentTimeMs` in `useFlightStore` is the single source of truth for replay position.
- Replay progression is driven by `requestAnimationFrame` in `src/replay/replayEngine.ts` via store `tick(deltaMs)`.
- `MapView` and `Barogram` both read `currentTimeMs` and call store `seek(timeMs)` for interactions; they do not sync directly to each other.

### Rendering/performance split

- Heavy IGC parsing is worker-based.
- Expensive calculations (speed, vario, cumulative distance, summary) are precomputed once, not per frame.
- Barogram downsampling is applied for large fix arrays (`DOWNSAMPLE_THRESHOLD` in `src/components/Barogram.tsx`) while seeking still uses original fixes.

## Key repository conventions

- Keep domain logic framework-agnostic in `src/domain/*` (no React/Map/chart imports there).
- `fixes` and `derived` are expected to be index-aligned 1:1 throughout the app.
- Missing numeric telemetry values use `null` (not `undefined`) and UI formatting helpers in `src/domain/units.ts` render them as `—`.
- Time handling is UTC epoch milliseconds (`timeMs`) end-to-end; display formatting is centralized in `units.ts`.
- IGC parse failures are propagated as typed `IgcParseError` unions (`invalid-format | empty-file | unknown`) and surfaced to UI.
- UI text must go through i18n keys (`src/i18n/locales/en.json`) with `useTranslation`; avoid hardcoded user-facing strings in components.
- Use `@/` alias imports configured in `vite.config.ts` for `src` paths.
- For MapLibre, keep `maplibre-gl` excluded from Vite `optimizeDeps` (see `vite.config.ts`) to avoid worker chunk resolution breakage.
- `src/components/ui/*` and `src/hooks/use-mobile.ts` are shadcn-generated primitives/hooks with specific ESLint exceptions in `eslint.config.js`; prefer not to refactor those unless required.

## Existing docs to keep aligned

- `README.md` defines Phase 1 scope and user-facing script list.
- `docs/PRD.md` contains product-level terminology and long-term roadmap.
- `docs/phase-1-technical-spec.md` describes the intended layered architecture and FR-M requirement mapping used in code comments.
