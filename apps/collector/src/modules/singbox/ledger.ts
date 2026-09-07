import type Database from 'better-sqlite3';
import { getDomain } from 'tldts';
import type { NativeBatch, NativeConnection, NativeFilters, NativeStats } from '@neko-master/shared';

export interface NativeWriteBatch { batch: NativeBatch; run: string; now: number; initial: boolean }
type Row = Record<string, string | bigint>;
const integer = (v: string | undefined) => BigInt(v || '0');
export const addressIP = (s: string) => s.startsWith('[') ? s.slice(1, s.indexOf(']')) : s.replace(/:\d+$/, '');
const DIMENSIONS: Record<string, string> = { source: 'source', domain: 'domain', rootDomain: 'root_domain', destination: 'destination', inbound: 'inbound', outbound: 'outbound', rule: 'rule' };
const DAY = 86400000;

/** Called only inside TrafficWriterRepository.batchUpdateTrafficStats's transaction. */
export function applyNativeBatch(db: Database.Database, backend: number, input: NativeWriteBatch) {
  const { batch, run, now, initial } = input;
  const fresh = !db.prepare('SELECT 1 FROM sb_meta WHERE backend_id=?').get(backend);
  db.prepare('INSERT OR IGNORE INTO sb_meta(backend_id,since) VALUES(?,?)').run(backend, now);
  db.prepare('INSERT OR IGNORE INTO sb_runs VALUES(?,?,?)').run(backend, run, now);
  db.prepare('UPDATE sb_connections SET closed=?,interrupted=1 WHERE backend_id=? AND run<>? AND closed=0').run(now, backend, run);
  const existing = db.prepare('SELECT * FROM sb_connections WHERE backend_id=? AND run=? AND id=?').safeIntegers();
  const insert = db.prepare(`INSERT INTO sb_connections
    (backend_id,run,id,source,destination,domain,root_domain,inbound,outbound,rule,network,user,chain,created,closed,upload,download,baseline_upload,baseline_download)
    VALUES (@backend,@run,@id,@source,@destination,@domain,@root_domain,@inbound,@outbound,@rule,@network,@user,@chain,@created,@closed,@upload,@download,@baseline_upload,@baseline_download)`);
  const update = db.prepare('UPDATE sb_connections SET upload=?,download=?,closed=? WHERE backend_id=? AND run=? AND id=?');
  const fact = db.prepare(`INSERT INTO sb_facts VALUES(@backend,@resolution,@bucket,@source,@domain,@root_domain,@destination,@inbound,@outbound,@rule,@recovered,@upload,@download,@connections)
    ON CONFLICT DO UPDATE SET upload=upload+excluded.upload,download=download+excluded.download,connections=connections+excluded.connections`);
  for (const event of batch.events) {
    let old = existing.get(backend, run, event.id) as Row | undefined;
    const c = event.connection;
    if (!old && !c) {
      throw new Error('Connection update without metadata; reconnect required');
    }
    if (initial && !old && c && Number(c.closedAt) > 0 && Number(c.closedAt) < now - 90 * DAY) continue;
    if (old && BigInt(old.closed) > 0n && !c) continue;
    // A final snapshot is authoritative. Updates are ordered deltas within one subscription.
    let up = c ? integer(c.uplinkTotal) : integer(event.uplinkDelta) + BigInt(old!.upload);
    let down = c ? integer(c.downlinkTotal) : integer(event.downlinkDelta) + BigInt(old!.download);
    if (up < 0n || down < 0n) throw new Error('Negative native traffic counter');
    const baseline = fresh && initial;
    const recovered = initial && !fresh;
    let count = 0n;
    let diffUp = 0n;
    let diffDown = 0n;
    const closed = Number(event.closedAt) > 0 ? Number(event.closedAt) : Number(c?.closedAt || 0);
    if (!old) {
      const conn = c as NativeConnection;
      const domain = (conn.domain || '').toLowerCase().replace(/\.$/, '');
      old = {
        source: addressIP(conn.source || ''), destination: addressIP(conn.destination || ''), domain,
        root_domain: getDomain(domain, { allowPrivateDomains: true }) || domain,
        inbound: conn.inbound || '', outbound: conn.outbound || '', rule: conn.rule || '',
        network: conn.network || '', user: conn.user || '', chain: JSON.stringify(conn.chainList || []),
        created: BigInt(conn.createdAt || now), closed: BigInt(closed), upload: up, download: down,
        baseline_upload: baseline ? up : 0n, baseline_download: baseline ? down : 0n,
      };
      insert.run({ ...old, backend, run, id: event.id });
      if (!baseline) { diffUp = up; diffDown = down; count = 1n; }
    } else {
      // Old/repeated snapshots must never lower checkpoints or reopen a connection.
      up = up > BigInt(old.upload) ? up : BigInt(old.upload);
      down = down > BigInt(old.download) ? down : BigInt(old.download);
      diffUp = up - BigInt(old.upload); diffDown = down - BigInt(old.download);
      update.run(up, down, closed || old.closed, backend, run, event.id);
    }
    if (!diffUp && !diffDown && !count) continue;
    const values = { backend, source: old.source, destination: old.destination, domain: old.domain,
      root_domain: old.root_domain, inbound: old.inbound, outbound: old.outbound, rule: old.rule,
      recovered: recovered ? 1 : 0, upload: diffUp, download: diffDown, connections: count };
    // Recovered bytes have a separate bucket; their original timing is unknown.
    for (const resolution of ['minute', 'day']) {
      const bucket = recovered ? 0 : resolution === 'minute' ? Math.floor(now / 60000) * 60000 : Math.floor((now + 28800000) / DAY) * DAY - 28800000;
      fact.run({ ...values, resolution, bucket });
    }
  }
  db.prepare('UPDATE sb_meta SET last_commit=? WHERE backend_id=?').run(now, backend);
}

export function cleanupNative(db: Database.Database, now = Date.now()) {
  const cutoff = now - 90 * DAY;
  db.transaction(() => {
    db.prepare('DELETE FROM sb_connections WHERE closed>0 AND closed<?').run(cutoff);
    db.prepare("DELETE FROM sb_facts WHERE resolution='minute' AND recovered=0 AND bucket<?").run(cutoff);
  })();
}

function where(filters: NativeFilters, detail = false) {
  const clauses: string[] = []; const params: (string | number)[] = [];
  for (const [key, col] of Object.entries(DIMENSIONS)) {
    const v = filters[key as keyof NativeFilters];
    if (v) { clauses.push(`${col}=?`); params.push(v); }
  }
  if (detail) {
    if (filters.from) { clauses.push('created>=?'); params.push(parseTime(filters.from)); }
    if (filters.to) { clauses.push('created<?'); params.push(parseTime(filters.to)); }
    if (filters.live === 'true') clauses.push('closed=0');
    else if (filters.live === 'false') clauses.push('closed>0');
  }
  return { sql: clauses.length ? ' AND ' + clauses.join(' AND ') : '', params };
}
export function parseTime(s: string): number {
  const n = Date.parse(s);
  if (!Number.isFinite(n)) throw new Error('Invalid ISO date');
  return n;
}
const jsonRows = (rows: unknown) => JSON.parse(JSON.stringify(rows, (_, v: unknown) => typeof v === 'bigint' ? v.toString() : v));
export function queryNativeStats(db: Database.Database, backend: number, filters: NativeFilters): NativeStats {
  let from = filters.from ? parseTime(filters.from) : 0;
  let to = filters.to ? parseTime(filters.to) : Date.now() + 60000;
  if (to <= from) throw new Error('End must follow start');
  const resolution = from < Date.now() - 90 * DAY || to - from > 7 * DAY ? 'day' : 'minute';
  if (resolution === 'day') {
    from = Math.floor((from + 28800000) / DAY) * DAY - 28800000;
    to = Math.ceil((to + 28800000) / DAY) * DAY - 28800000;
  }
  const dimension = DIMENSIONS[filters.dimension || 'domain'];
  if (!dimension) throw new Error('Invalid dimension');
  const f = where(filters);
  const scope = !filters.from && !filters.to ? '(recovered=1 OR (bucket>=? AND bucket<?))' : 'recovered=0 AND bucket>=? AND bucket<?';
  const base = ` FROM sb_facts WHERE backend_id=? AND resolution=? AND ${scope}${f.sql}`;
  const args = [backend, resolution, from, to, ...f.params];
  const sums = 'COALESCE(SUM(upload),0) upload,COALESCE(SUM(download),0) download,COALESCE(SUM(connections),0) connections';
  const rows = db.prepare(`SELECT ${dimension} label,${sums}${base} GROUP BY ${dimension} ORDER BY SUM(upload)+SUM(download) DESC LIMIT 100`).safeIntegers().all(...args);
  const total = db.prepare(`SELECT ${sums}${base}`).safeIntegers().get(...args);
  const step = resolution === 'day' ? DAY : Math.max(60000, Math.ceil((to - from) / 240 / 60000) * 60000);
  const trend = db.prepare(`SELECT CAST(bucket / ? AS INTEGER)*? bucket,${sums}${base} AND recovered=0 GROUP BY 1 ORDER BY 1`).safeIntegers().all(step, step, ...args);
  const recovered = db.prepare(`SELECT ${sums} FROM sb_facts WHERE backend_id=? AND resolution='day' AND recovered=1${f.sql}`).safeIntegers().get(backend, ...f.params);
  return jsonRows({ rows, total, trend, recovered, granularity: resolution });
}
export function queryNativeConnections(db: Database.Database, backend: number, filters: NativeFilters, exportAll = false) {
  const f = where(filters, true);
  const page = Number(filters.page || 0);
  if (!Number.isSafeInteger(page) || page < 0 || page > 1000000) throw new Error('Invalid page');
  const stmt = db.prepare(`SELECT *,upload-baseline_upload recorded_upload,download-baseline_download recorded_download FROM sb_connections WHERE backend_id=?${f.sql} ORDER BY created DESC${exportAll ? '' : ' LIMIT 100 OFFSET ?'}`).safeIntegers();
  const args = exportAll ? [backend, ...f.params] : [backend, ...f.params, page * 100];
  return exportAll ? stmt.iterate(...args) : jsonRows(stmt.all(...args));
}
