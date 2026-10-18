# Performance report — 2026-10-18

Comparison: Nexus 0.1 prototype → Eterna IDE 0.2.0.

| Metric | Before | After | Reduction |
|---|---:|---:|---:|
| Initial JavaScript (raw) | 1,240,380.00 bytes | 262,917.00 bytes | 78.8% |
| Initial JavaScript (gzip) | 391,065.00 bytes | 81,028.00 bytes | 79.3% |
| State API median | 55.71 ms | 2.81 ms | 95.0% |
| State API p95 | 76.16 ms | 7.43 ms | 90.2% |
| Initial state response | 980,789.00 bytes | 501,324.00 bytes | 48.9% |
| Unchanged response body | 980,789.00 bytes | 0.00 bytes | 100.0% |
| Cold FCP median | 1,396.00 ms | 596.00 ms | 57.3% |
| Workspace ready median | 2,205.09 ms | 1,417.96 ms | 35.7% |

## Method

- macOS arm64, Node 24.2.0, installed Google Chrome, loopback server.
- Synthetic SQLite fixture: 500 knowledge records referencing one file; 400 completed runs, each with a 100KB context. No real project data or credentials.
- API: 15 sequential authenticated samples; p50 and nearest-rank p95. An additional conditional request checks unchanged response bytes.
- Browser: five fresh contexts with cache disabled, 4× CPU slowdown, 40ms network latency and 1.5 MB/s throughput. Non-local resources are blocked consistently in both cases.
- FCP uses the browser paint entry. Workspace readiness is measured until the project selector is visible, not a claim that every lazily loaded tool is already initialized.
- Raw results: [before.json](before.json), [after.json](after.json). Reproduce with `npm run build && npm run benchmark` from the repository root.

## Changes

Editor, language support, graph/dialogs and terminal code load when requested. Editor extensions no longer rebuild on unrelated state updates. Remote Google Fonts are no longer required for the local UI. Full historical contexts and snapshot baselines stay out of state polling: compact summaries are written transactionally alongside records. SQLite type indexes, cached record lists, per-file hash reuse with stat invalidation, bounded history pages, conditional responses and hidden-tab polling suspension reduce repeated work.

## Limits and tradeoffs

These are local synthetic measurements, not production user percentiles, low-end-device results, or model inference benchmarks. Five browser trials do not establish statistical significance. FCP is not LCP or INP; this test does not certify Core Web Vitals.

First use of the editor or terminal downloads its deferred module. Total JavaScript across all chunks is approximately 1.245MB, slightly above the prior 1.240MB; the gain comes from avoiding unnecessary startup work, not pretending all code disappeared. The first history page contains 100 runs with older records available through Load more. Full answers and contexts remain stored and available on demand. Source freshness checks still run before conditional responses, so an unchanged database cannot hide a modified evidence file.

The latest 20 completed AI runs are considered as prior-answer candidates; selected ancestry is still recursively checked for stale or revoked evidence. This bounds the candidate search, not the depth of provenance validation. Very deep histories and very large note collections need separate future benchmarks.

CI enforces an initial JavaScript gzip budget of 110KB with `node scripts/check-bundle.mjs`. Network/model availability and provider subscription limits remain independent.
