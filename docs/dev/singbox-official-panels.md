# Native ledger: shared Neko Master analytics panels

The native dashboard uses Overview, Domains, Rules, Regions, Connections and Nodes tabs. Time bounds and the filter expression stay above the tabs; every selection becomes an ordinary editable rule. CSV/JSONL links remain available from every tab. Only the active tab loads its detail data; summary totals continue refreshing across tabs.

## Shared presentation

`TopDomainsChart`, `WorldTrafficMap`, `CountryTrafficList` and the rule flow renderer are shared with the upstream dashboard. `RuleDistribution` contains the original pie/list presentation extracted from `InteractiveRuleStats`; both dashboards use it. Optional selection callbacks preserve upstream container behavior. Native adapters supply ledger data without starting upstream HTTP/WS subscriptions. The map's existing geometry now includes ISO alpha-2 properties derived from its ISO numeric IDs, so country matching is not limited to the original name shortcuts.

Native rules keep their recorded names. Pie/list, domain bars, countries, and rule/terminal nodes add filters. Group nodes only describe observed topology, since an intermediate group is not the ledger's terminal outbound. All added filters obey the single AND/OR mode, including selections from different tabs. Rendering converts decimal byte strings to numbers; API/SQLite counters remain lossless.

## Facts and compatibility

Schema v3 adds `chain` to the `sb_facts` primary key. The same native batch transaction writes minute and daily path facts. Migration copies existing columns atomically, leaving old chain values empty, preserving every byte and connection count. Existing retention (90-day minutes, permanent daily facts) and backend deletion already cover the same table. This is the native SQLite path, not the upstream Clash/ClickHouse pipeline.

`GET /api/singbox/rule-chains` accepts existing native query filters and returns `NativeChainStats`: stats, `paths`, `unrecorded` byte/count totals, and `truncated`. Paths group by rule and recorded chain and are limited to the busiest 1000. Empty historical paths are not reconstructed from connection lifetime totals. Recovered bytes retain their existing timeless/all-time semantics. Time-limited queries exclude them.

sing-box records the terminal outbound first and outermost group last; only presentation reverses that order. See [the native tracker](https://github.com/SagerNet/sing-box/blob/testing/common/trafficcontrol/tracker.go). Current selector state never replaces recorded history.

`GET /api/singbox/countries` returns `NativeCountryStats`: ordinary stats grouped by country plus `geo.ready`/`geo.error`. `country` is accepted in ordinary native stats dimensions and all filter expressions, including connections and exports. `LOCAL` denotes private/local addresses; the empty string denotes Unknown.

## Offline country data

The GeoIP module exposes a country-only MMDB reader; the native SQL function registers on every querying connection, including export readers. It uses bounded in-memory caches and never calls an online geolocation service. Hostname destinations are resolved asynchronously through sing-box's Clash API `/dns/query` (A and AAAA, 8 concurrent hosts, 5-second timeout). This uses sing-box's DNS router, rules, strategy and cache, without a system-DNS or public-DNS fallback. `SINGBOX_CLASH_API_URL` defaults to `http://127.0.0.1:9090`; set `SINGBOX_CLASH_SECRET` when the controller requires authentication. Successful classifications cache for one hour; failures or ambiguous country results cache for one minute. A hostname is assigned only when all returned IPs map to the same known country. The next dashboard refresh picks up completed lookups. These are current-DNS estimates, not reconstructed historical destinations. Local lookups also classify historical facts directly, so no duplicate country aggregate table or asynchronous historical rewrite is needed. On the deployment snapshot, country and chain queries together took about 9 ms. Country assignments reflect the loaded database version and current cached DNS results. SQL queries classify each fact exactly once: no traffic rows are rewritten or multiplied by DNS answers. Export readers freeze hostname classifications for their query, so background DNS completion cannot change membership between streamed rows.

Install/update from the repository root using Node 22:

```bash
node scripts/update-native-country.mjs
# Or select a published release:
node scripts/update-native-country.mjs 2026-09
```

The default destination is `../geoip/dbip-country-lite.mmdb` beside the checkout; override with `SINGBOX_GEOIP_DIR`. The script downloads from DB-IP over HTTPS, decompresses, validates with the existing MaxMind reader, and atomically replaces the database. Download or validation failure keeps the previous database. The file and source/license notice live outside Git.

Configure `SINGBOX_COUNTRY_MMDB` to the absolute path and restart the collector after updates. No City/ASN database is required and no online fallback is used. Missing/invalid files leave the page usable with a visible unavailable state. DB-IP Country Lite is CC BY 4.0; the Regions tab links to DB-IP as required: https://db-ip.com/db/download/ip-to-country-lite.

Deployment here uses `/home/xusj/workspace/sing-box-analytics/geoip/`. Before rollout, back up the live SQLite database using its online backup API. Validate migration on a second copy, then restart collector and web together. Do not migrate the production database while the old collector is writing to it.

## Verification

Collector tests cover path separation, migration of pre-chain facts, reset idempotency, and country filtering across stats/details/exports. Browser scripts use isolated fixtures:

```bash
node apps/web/scripts/check-singbox-panels.mjs
node apps/web/scripts/check-singbox-filters.mjs
node apps/web/scripts/check-singbox-time.mjs
```

The panel check covers domain bars, pie/list integration, chain order and terminal selection, country/Unknown selection, shared export bounds, lazy tab loading and mobile/theme layout. Set `PLAYWRIGHT_MODULE`, `PLAYWRIGHT_BROWSERS_PATH` and optionally `BASE_URL` when using external tooling. Also smoke-test `/[locale]/dashboard` for the upstream containers and native APIs against an isolated database connected to the actual sing-box service.
