import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NativeBatch, NativeConnection, NativeEvent } from '@neko-master/shared';
import { createTestBackend, createTestDatabase } from '../../__tests__/helpers.js';
import { StatsDatabase } from '../db/db.js';
import { cleanupNative, queryNativeChains, queryNativeStats, queryNativeConnections, addressIP } from './ledger.js';

let fixture: ReturnType<typeof createTestDatabase>;
let backend: number;
const connection = (id: string, up = '0', down = '0', extra: Partial<NativeConnection> = {}): NativeConnection => ({
  id, source: '192.168.1.20:45678', destination: '1.1.1.1:443', domain: 'cdn.example.com',
  inbound: 'mixed', outbound: 'node-a', network: 'tcp', rule: 'final', user: '', chainList: ['node-a', 'auto'],
  createdAt: String(Date.now()), closedAt: '0', uplinkTotal: up, downlinkTotal: down, ...extra,
});
const event = (c: NativeConnection, closed = false): NativeEvent => ({ id: c.id, type: closed ? 'CONNECTION_EVENT_CLOSED' : 'CONNECTION_EVENT_NEW', connection: c, uplinkDelta: '0', downlinkDelta: '0', closedAt: closed ? String(Date.now()) : '0' });
function write(events: NativeEvent[], options: { now?: number; run?: string; reset?: boolean } = {}) {
  const batch: NativeBatch = { events, reset: options.reset || false };
  fixture.db.repos.trafficWriter.batchUpdateTrafficStats(backend, [], false, { batch, run: options.run || 'run1', now: options.now || Date.now(), initial: !!options.reset });
}
const stats = () => queryNativeStats(fixture.db.getNativeDatabase(), backend, {});

beforeEach(() => { fixture = createTestDatabase(); backend = createTestBackend(fixture.db); });
afterEach(() => fixture.cleanup());
describe('native lossless ledger', () => {
  it('records short connections and final tails exactly once without multiplying the chain', () => {
    write([], { reset: true });
    write([event(connection('short', '10', '200'), true)]);
    write([event(connection('short', '10', '200'), true)]);
    expect(stats().total).toEqual({ upload: '10', download: '200', connections: '1' });
    expect(queryNativeStats(fixture.db.getNativeDatabase(), backend, { source: '192.168.1.20', dimension: 'rootDomain' }).rows[0].label).toBe('example.com');
  });
  it('establishes first snapshot baseline, then counts live deltas and close correction', () => {
    write([event(connection('a', '100', '500'))], { reset: true });
    write([{ id: 'a', type: 'CONNECTION_EVENT_UPDATE', uplinkDelta: '5', downlinkDelta: '20', closedAt: '0' }]);
    write([event(connection('a', '109', '530'), true)]);
    expect(stats().total.upload).toBe('9');
    expect(stats().total.download).toBe('30');
    const detail = queryNativeConnections(fixture.db.getNativeDatabase(), backend, {}) as Record<string,string>[];
    expect(detail[0].recorded_download).toBe('30');
  });
  it('reconciles reconnect snapshots without attributing unknown timing to a minute', () => {
    write([], { reset: true }); write([event(connection('a', '10', '100'))]);
    write([event(connection('a', '15', '150'))], { reset: true });
    write([event(connection('a', '15', '150'))], { reset: true });
    expect(stats().recovered.download).toBe('50');
    expect(stats().total.download).toBe('150');
    expect(stats().rows[0].download).toBe('150');
    expect(stats().trend.reduce((n,r) => n+BigInt(r.download),0n)).toBe(100n);
  });
  it('rolls back both checkpoint and facts on write failure', () => {
    write([], { reset: true });
    fixture.db.getNativeDatabase().exec("CREATE TRIGGER reject_facts BEFORE INSERT ON sb_facts BEGIN SELECT RAISE(ABORT,'disk error'); END;");
    expect(() => write([event(connection('a', '10', '100'))])).toThrow('disk error');
    expect((queryNativeConnections(fixture.db.getNativeDatabase(), backend, {}) as unknown[]).length).toBe(0);
    fixture.db.getNativeDatabase().exec('DROP TRIGGER reject_facts');
    write([event(connection('a', '10', '100'))]);
    expect(stats().total.download).toBe('100');
  });
  it('preserves integers greater than JavaScript safe integer and handles IPv6/unknown domain', () => {
    write([], { reset: true });
    write([event(connection('a', '9007199254740993', '1', { source: '[fd00::1]:5000', domain: '' }))]);
    expect(stats().total.upload).toBe('9007199254740993');
    expect(addressIP('[fd00::1]:5000')).toBe('fd00::1');
    expect(queryNativeStats(fixture.db.getNativeDatabase(), backend, { dimension: 'source' }).rows[0].label).toBe('fd00::1');
  });
  it('keeps daily history after minute and connection retention expires', () => {
    const old = Date.now() - 100 * 86400000;
    write([], { reset: true, now: old });
    const c = connection('old', '10', '100', { createdAt: String(old), closedAt: String(old+1000) });
    write([event(c)], { now: old });
    cleanupNative(fixture.db.getNativeDatabase());
    expect(stats().total.download).toBe('100');
    expect((queryNativeConnections(fixture.db.getNativeDatabase(), backend, {}) as unknown[]).length).toBe(0);
    expect(fixture.db.getNativeDatabase().prepare("SELECT COUNT(*) n FROM sb_facts WHERE resolution='minute'").get()).toEqual({ n: 0 });
  });
  it('uses Shanghai daily boundaries and marks previous-run live connections interrupted', () => {
    const first = Date.parse('2026-09-07T15:59:59Z'), second = first + 2000;
    write([], { reset: true, now: first });
    write([event(connection('a', '10', '0'))], { now: first });
    write([{ id:'a',type:'CONNECTION_EVENT_UPDATE',uplinkDelta:'10',downlinkDelta:'0',closedAt:'0' }], { now: second });
    const days = fixture.db.getNativeDatabase().prepare("SELECT bucket FROM sb_facts WHERE resolution='day' ORDER BY bucket").all() as {bucket:number}[];
    expect(days.map(d => new Date(d.bucket).toISOString())).toEqual(['2026-09-06T16:00:00.000Z','2026-09-07T16:00:00.000Z']);
    write([], { run:'run2',reset:true,now:second+1000 });
    expect(fixture.db.getNativeDatabase().prepare('SELECT interrupted FROM sb_connections').get()).toEqual({ interrupted: 1 });
  });
  it('reduces trend bucket width when zooming from a day to an hour', () => {
    const end = Math.floor(Date.now() / 60000) * 60000;
    const query = (hours: number) => queryNativeStats(fixture.db.getNativeDatabase(), backend, {
      from: new Date(end - hours * 3600000).toISOString(), to: new Date(end).toISOString(),
    });
    expect(query(24).stepMs).toBe(360000);
    expect(query(1).stepMs).toBe(60000);
  });
  it('returns minute-aligned half-open bounds and excludes the end bucket', () => {
    const start = Math.floor(Date.now() / 60000) * 60000 - 600000;
    write([], { reset: true, now: start });
    write([event(connection('a', '10', '100'))], { now: start });
    write([event(connection('b', '20', '200'))], { now: start + 60000 });
    const result = queryNativeStats(fixture.db.getNativeDatabase(), backend, {
      from: new Date(start + 1000).toISOString(), to: new Date(start + 59000).toISOString(),
    });
    expect(result.from).toBe(start); expect(result.to).toBe(start + 60000);
    expect(result.stepMs).toBe(60000); expect(result.granularity).toBe('minute');
    expect(result.total.download).toBe('100');
    expect(result.rows[0].download).toBe('100');
    expect(result.trend.map(row => Number(row.bucket))).toEqual([start, start + 60000]);
  });
  it('keeps daily chart buckets at Shanghai midnight and exposes effective bounds', () => {
    const start = Date.parse('2020-01-01T00:00:00+08:00');
    write([], { reset: true, now: start });
    write([event(connection('a', '10', '100'))], { now: start + 1000 });
    write([event(connection('b', '20', '200'))], { now: start + 86400000 });
    write([event(connection('c', '30', '300'))], { now: start + 2 * 86400000 });
    const result = queryNativeStats(fixture.db.getNativeDatabase(), backend, {
      from: '2020-01-01T08:00:00+08:00', to: '2020-01-01T09:00:00+08:00',
    });
    expect(result.from).toBe(start); expect(result.to).toBe(start + 86400000);
    expect(result.stepMs).toBe(86400000); expect(result.granularity).toBe('day');
    expect(result.trend.map(row => Number(row.bucket))).toEqual([start, start + 86400000]);
    expect(result.total.download).toBe('100');
  });
  it('fetches a complete aggregated right-hand bucket without extending totals', () => {
    const start = Math.floor((Date.now() - 2 * 86400000) / 360000) * 360000;
    const end = start + 86400000 - 60000; // Inside a six-minute display bucket.
    write([], { reset: true, now: start });
    write([event(connection('inside', '10', '100'))], { now: end - 60000 });
    write([event(connection('edge', '10', '200'))], { now: start + 86400000 });
    write([event(connection('tail', '10', '300'))], { now: start + 86400000 + 5 * 60000 });
    write([event(connection('outside', '10', '400'))], { now: start + 86400000 + 6 * 60000 });
    const result = queryNativeStats(fixture.db.getNativeDatabase(), backend, {from:new Date(start).toISOString(),to:new Date(end).toISOString()});
    expect(result.stepMs).toBe(360000);expect(result.to).toBe(end);
    expect(result.total.download).toBe('100');
    expect(result.trend.at(-1)).toMatchObject({bucket:start + 86400000,download:'500'});
    const latest = queryNativeStats(fixture.db.getNativeDatabase(), backend, {from:new Date(start).toISOString(),to:new Date(Date.now()).toISOString()});
    expect(latest.trend.every(row=>Number(row.bucket)<Date.now())).toBe(true);
  });
  it('isolates backends and rejects invalid query ranges/dimensions', () => {
    write([], { reset:true }); write([event(connection('a','1','2'))]);
    const other = createTestBackend(fixture.db,'other');
    expect(queryNativeStats(fixture.db.getNativeDatabase(),other,{}).total.download).toBe('0');
    expect(() => queryNativeStats(fixture.db.getNativeDatabase(),backend,{dimension:'source;DROP TABLE sb_facts'})).toThrow();
    expect(() => queryNativeStats(fixture.db.getNativeDatabase(),backend,{from:'invalid'})).toThrow();
  });
  it('migrates a rowid ledger without changing historical totals', () => {
    write([], { reset: true }); write([event(connection('a', '10', '100'))]);
    const sql = fixture.db.getNativeDatabase();
    const ddl = (sql.prepare("SELECT sql FROM sqlite_master WHERE name='sb_facts'").get() as {sql:string}).sql;
    sql.exec(ddl.replace('sb_facts', 'old_facts').replace('WITHOUT ROWID', ''));
    sql.exec('INSERT INTO old_facts SELECT * FROM sb_facts; DROP TABLE sb_facts; ALTER TABLE old_facts RENAME TO sb_facts');
    const reopened = new StatsDatabase(sql.name);
    try {
      expect(queryNativeStats(reopened.getNativeDatabase(), backend, {}).total.download).toBe('100');
      expect((sql.prepare("SELECT sql FROM sqlite_master WHERE name='sb_facts'").get() as {sql:string}).sql).toContain('WITHOUT ROWID');
    } finally { reopened.close(); }
  });

  it('preserves different observed paths within a minute and filters them by rule', () => {
    const now = Math.floor(Date.now()/60000)*60000;
    write([], {reset:true,now});
    write([event(connection('a','10','100',{chainList:['node-a','auto']})),event(connection('b','20','200',{chainList:['node-a','manual'],rule:'other'}))],{now});
    const query = {from:new Date(now).toISOString(),to:new Date(now+60000).toISOString()};
    const result = queryNativeChains(fixture.db.getNativeDatabase(),backend,query);
    expect(result.total.download).toBe('300');
    expect(result.paths.map((path: {chain:string[]})=>path.chain)).toEqual([['node-a','manual'],['node-a','auto']]);
    expect(result.unrecorded.download).toBe('0');
    expect(queryNativeChains(fixture.db.getNativeDatabase(),backend,{...query,filter:JSON.stringify({match:'all',rules:[{field:'rule',op:'in',values:['final']}]})}).paths).toHaveLength(1);
    write([event(connection('a','10','100',{chainList:['node-a','auto']}))],{now,reset:true});
    expect(queryNativeChains(fixture.db.getNativeDatabase(),backend,query).total.download).toBe('300');
  });
  it('migrates pre-chain facts without assigning historical connection paths', () => {
    write([], {reset:true});write([event(connection('a','10','100'))]);
    const db = fixture.db.getNativeDatabase();
    const ddl = (db.prepare("SELECT sql FROM sqlite_master WHERE name='sb_facts'").get() as {sql:string}).sql;
    db.exec(ddl.replace('sb_facts','old_facts').replace("chain TEXT NOT NULL DEFAULT '', ",'').replace('rule,chain,recovered','rule,recovered'));
    const columns = (db.prepare('PRAGMA table_info(old_facts)').all() as {name:string}[]).map(c=>c.name).join(',');
    db.exec(`INSERT INTO old_facts SELECT ${columns} FROM sb_facts; DROP TABLE sb_facts; ALTER TABLE old_facts RENAME TO sb_facts`);
    const reopened = new StatsDatabase(db.name);
    try {
      const result = queryNativeChains(reopened.getNativeDatabase(),backend,{});
      expect(result.total.download).toBe('100');expect(result.unrecorded.download).toBe('100');expect(result.paths).toEqual([]);
    } finally {reopened.close();}
  });
  it('uses the same country filter for facts, details and export readers', () => {
    write([], {reset:true});
    write([event(connection('local','10','100',{destination:'192.168.2.1:443'})),event(connection('public','20','200'))]);
    const filter=JSON.stringify({match:'all',rules:[{field:'country',op:'in',values:['LOCAL']}]});
    const db=fixture.db.getNativeDatabase();
    expect(queryNativeStats(db,backend,{filter,dimension:'country'}).rows[0]).toMatchObject({label:'LOCAL',download:'100'});
    expect(queryNativeConnections(db,backend,{filter})).toHaveLength(1);
    expect([...queryNativeConnections(db,backend,{filter},true)]).toHaveLength(1);
  });

});
