# Native ledger filter expressions

The dashboard's condition builder supports lists of exact values, exclusions, literal substring matching and regular expressions. Each rule selects a field, operator and values. Rules combine with ALL (AND, default) or ANY (OR). For example, include `node-a` and `node-b` in an outbound list, then add an AND exclusion for `node-b` to keep only `node-a`. Use a domain regex as another AND rule to narrow that traffic further.

Applied rules and ranking drill-down conditions share one compact chip strip. Each chip shows its field and value/operator; clicking its × immediately removes only that condition. Add/Edit opens the condition editor, Apply collapses it after validation, and Cancel discards draft changes. OR expressions are visually grouped, with ranking conditions outside the group joined by AND. Suggestions load only while editing.

Changes stay in a draft until Apply succeeds. The collector validates expressions before the page changes its active query. Invalid regex preserves the previous filter. Clearing removes both advanced conditions and ranking drill-down filters. Outbound/inbound/rule suggestions contain up to 200 historical values per field; outbound choices also include current group members. Names not in the suggestions can be entered manually. Exact values use one line per value; spaces and commas remain literal parts of names, and blank/whitespace-only lines are ignored. Missing metadata (Unknown) is selected explicitly via its checkbox; the API represents that choice as an empty string.

Statistics (including trends and recovered totals), connection details, and CSV/JSONL exports use the same expression. Existing exact-match query parameters remain supported and are ANDed with the expression, so ranking drill-down narrows an OR expression rather than broadening it. Time filtering retains the existing semantics: facts use their recorded time buckets, while connections/exports use creation time.

## API

`GET /api/singbox/stats`, `/connections` and `/export` accept `filter`, a URL-encoded JSON expression:

```json
{
  "match": "all",
  "rules": [
    { "field": "outbound", "op": "in", "values": ["node-a", "node-b"] },
    { "field": "outbound", "op": "notIn", "values": ["direct"] },
    { "field": "domain", "op": "regex", "values": ["\\.example\\.com$"], "ignoreCase": true }
  ]
}
```

- Fields: `source`, `domain`, `rootDomain`, `destination`, `inbound`, `outbound`, `rule`.
- Operators: `in`, `notIn`, `contains`, `notContains`, `regex`, `notRegex`. Lists use exact comparison; substring matching is literal and case-sensitive (including `%` and `_`). Regex can opt into `ignoreCase`.
- `POST /api/singbox/filters/validate` accepts `{ "filter": "<JSON text>" }`, returning the validated expression or HTTP 400.
- `GET /api/singbox/filter-options` returns `{ "outbound": [], "inbound": [], "rule": [] }` from this backend's daily facts.
- Empty rule lists mean no advanced filter. No nested groups or arbitrary SQL are accepted. Limits: 20 rules, 100 values per list, 512 characters per value, 6000 JSON characters and 8000 URL-encoded characters.

Regex uses [re2-wasm](https://github.com/google/re2-wasm), with Unicode matching and no backtracking engine. Enter patterns without slash delimiters; lookaround and backreferences are unsupported. Patterns are validated before querying and held in a bounded cache. SQL values remain bound parameters and columns/operators are allowlisted. The regex function is registered on each connection, including read-only export readers. No schema migration is needed.

## Verification

Run collector tests, both type checks and the production build. Browser coverage uses isolated API fixtures:

```bash
BASE_URL=http://127.0.0.1:3100 node apps/web/scripts/check-singbox-filters.mjs
```

As with the time-selection regression, set `PLAYWRIGHT_MODULE` and `PLAYWRIGHT_BROWSERS_PATH` when Playwright is installed outside the workspace. Deploy collector and web together for the new validation and suggestion endpoints.
