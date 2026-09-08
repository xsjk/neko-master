# Native sing-box time selection

The ledger supports rolling presets, applied custom dates, and horizontal drag-to-zoom on the traffic chart. Dragging applies a fixed interval immediately; Back restores the previous interval and Reset restores the rolling last 24 hours. Editing date fields does not change the query until Apply is pressed. Dates use Asia/Shanghai regardless of the browser timezone.

Statistics, rankings, connection filters and exports share the applied interval. Connection details continue to filter by creation time and show the connection's recorded lifetime bytes, rather than bytes within the selected interval. Cumulative counters remain unfiltered.

`GET /api/singbox/stats` retains its existing parameters and adds numeric `from`, `to` and `stepMs` response fields (Unix milliseconds). Bounds are half-open and rounded outwards to stored minute/day precision. Daily chart buckets retain Shanghai midnight. Ranges over seven days or beginning outside minute retention use daily facts. No schema migration is required.

The chart freezes its data during dragging, uses a continuous time axis, and breaks the line across missing buckets. The selection layer is above Recharts' SVG layers. Touch handling permits horizontal selection and native vertical scrolling; keyboard users can enter dates and use the buttons. Escape cancels an active drag.

## Verification

Run collector tests and build shared, collector and web packages as described in AGENTS.md. The browser regression uses isolated API fixtures and can target a dev or standalone web server:

```bash
BASE_URL=http://127.0.0.1:3100 node apps/web/scripts/check-singbox-time.mjs
```

Playwright and its Chromium browser must already be installed. If Playwright is installed outside the workspace, set `PLAYWRIGHT_MODULE` to its `index.mjs` path and, when needed, `PLAYWRIGHT_BROWSERS_PATH` to its browser directory. The script checks forward/reverse selection, fixed ranges during clock refresh, back/reset, invalid dates, exports, real touch dragging and vertical scroll cancellation.

Deploy the collector and web builds together so the chart receives the new range metadata.
