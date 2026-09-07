import { NativeLatencyTester } from './latency.js';
import * as grpc from '@grpc/grpc-js';
import { loadSync } from '@grpc/proto-loader';
import { fileURLToPath } from 'node:url';
import type { NativeBatch, NativeGroup } from '@neko-master/shared';
import type { StatsDatabase } from '../db/db.js';

const definition = loadSync(fileURLToPath(new URL('./proto/started_service.proto', import.meta.url)), { longs: String, enums: String, defaults: true, oneofs: true });
const methods = definition['daemon.StartedService'] as grpc.ServiceDefinition;
export class NativeService {
  readonly backend: number;
  private client: grpc.Client;
  private metadata = new grpc.Metadata();
  private streams: grpc.ClientReadableStream<unknown>[] = [];
  private timer?: NodeJS.Timeout;
  private maintenance: NodeJS.Timeout;
  private stopped = false;
  private retry = 0;
  private run = '';
  private pending: NativeBatch[] = [];
  private first = true;
  private gap?: number;
  private connected = false;
  private error = '';
  private groups: NativeGroup[] = [];
  private latency = new NativeLatencyTester(() => this.groups, () => this.connected && !this.stopped, tag => this.unary('URLTest', { outboundTag: tag }));
  private totals = { uplinkTotal: '0', downlinkTotal: '0' };
  constructor(private db: StatsDatabase, address: string, token: string) {
    if (process.env.CH_WRITE_ENABLED === 'true' || process.env.CH_ONLY_MODE === '1' || (process.env.STATS_QUERY_SOURCE && process.env.STATS_QUERY_SOURCE !== 'sqlite')) {
      throw new Error('Native sing-box ledger requires SQLite; ClickHouse is not supported');
    }
    this.client = new grpc.Client(address, grpc.credentials.createInsecure(), { 'grpc.enable_http_proxy': 0, 'grpc.keepalive_time_ms': 10000, 'grpc.keepalive_timeout_ms': 5000, 'grpc.keepalive_permit_without_calls': 1 });
    this.metadata.set('authorization', `Bearer ${token}`);
    const sql = db.getNativeDatabase();
    const url = `singbox://${address}`;
    const old = sql.prepare('SELECT id FROM backend_configs WHERE url=?').get(url) as { id: number } | undefined;
    this.backend = old?.id ?? Number(sql.prepare("INSERT INTO backend_configs(name,url,token,type,enabled,is_active,listening) VALUES('sing-box',?,'','singbox',1,1,1)").run(url).lastInsertRowid);
    // A collector crash leaves a coverage gap starting at its last durable checkpoint.
    const meta = sql.prepare('SELECT last_commit FROM sb_meta WHERE backend_id=?').get(this.backend) as { last_commit: number } | undefined;
    const open = sql.prepare('SELECT id FROM sb_gaps WHERE backend_id=? AND end IS NULL ORDER BY id DESC LIMIT 1').get(this.backend) as { id: number } | undefined;
    this.gap = open?.id;
    if (!this.gap) this.gap = Number(sql.prepare('INSERT INTO sb_gaps(backend_id,start,reason) VALUES(?,?,?)').run(this.backend, meta?.last_commit || Date.now(), 'collector_start').lastInsertRowid);
    this.maintenance = setInterval(() => {
      try {
        this.flush();
        if (this.connected) sql.prepare('UPDATE sb_meta SET last_commit=? WHERE backend_id=?').run(Date.now(), this.backend);
      } catch (err) { this.fail(err instanceof Error ? err : new Error(String(err))); }
    }, 1000);
  }
  start() { void this.connect(); }
  private unary<T>(name: string, request: object = {}): Promise<T> {
    const d = methods[name];
    return new Promise((resolve, reject) => this.client.makeUnaryRequest(d.path, d.requestSerialize, d.responseDeserialize, request, this.metadata, { deadline: Date.now() + 5000 }, (err, value) => err ? reject(err) : resolve(value as T)));
  }
  private stream<T>(name: string, request: object, receive: (value: T) => void) {
    const d = methods[name];
    const stream = this.client.makeServerStreamRequest(d.path, d.requestSerialize, d.responseDeserialize, request, this.metadata);
    this.streams.push(stream);
    stream.on('data', receive);
    stream.on('error', (err: Error) => this.fail(err));
    stream.on('end', () => this.fail(new Error('Native stream ended')));
  }
  private async connect() {
    if (this.stopped) return;
    try {
      const result = await this.unary<{ startedAt: string }>('GetStartedAt');
      if (this.stopped) return;
      this.run = result.startedAt;
      this.first = true;
      this.stream<NativeBatch>('SubscribeConnections', { interval: '1000000000' }, batch => {
        this.pending.push(batch);
        if (batch.reset || this.pending.reduce((n, b) => n + b.events.length, 0) >= 1000) this.flush();
      });
      this.stream<{ group: NativeGroup[] }>('SubscribeGroups', {}, value => {
        this.groups = value.group || [];
      });
      this.stream<{ uplinkTotal: string; downlinkTotal: string }>('SubscribeStatus', { interval: '1000000000' }, value => { this.totals = value; });
    } catch (err) { this.fail(err instanceof Error ? err : new Error(String(err))); }
  }
  private flush() {
    if (!this.pending.length) return;
    try {
      const batches = this.pending.slice();
      this.db.getNativeDatabase().transaction(() => {
        for (let i = 0; i < batches.length; i++) {
          this.db.repos.trafficWriter.batchUpdateTrafficStats(this.backend, [], false, {
            run: this.run, batch: batches[i], now: Date.now(), initial: (this.first && i === 0) || batches[i].reset,
          });
        }
      })();
      this.pending.splice(0, batches.length);
      this.first = false; this.connected = true; this.retry = 0; this.error = '';
      if (this.gap) {
        this.db.getNativeDatabase().prepare('UPDATE sb_gaps SET end=? WHERE id=?').run(Date.now(), this.gap);
        this.gap = undefined;
      }
    } catch (err) { this.fail(err instanceof Error ? err : new Error(String(err))); }
  }
  private fail(err: Error) {
    if (this.stopped || this.timer) return;
    this.error = err.message; this.connected = false;
    for (const stream of this.streams.splice(0)) { stream.removeAllListeners(); stream.on('error', () => {}); stream.cancel(); }
    // Discard uncommitted stream deltas; reconnect snapshots reconcile against durable totals.
    this.pending = [];
    try {
      if (!this.gap) this.gap = Number(this.db.getNativeDatabase().prepare('INSERT INTO sb_gaps(backend_id,start,reason) VALUES(?,?,?)').run(this.backend, Date.now(), err.message).lastInsertRowid);
    } catch { /* Keep the last durable checkpoint if the disk itself is unavailable. */ }
    const delay = Math.min(30000, 1000 * 2 ** Math.min(this.retry++, 5));
    this.timer = setTimeout(() => { this.timer = undefined; void this.connect(); }, delay);
  }
  status() {
    const sql = this.db.getNativeDatabase();
    return { connected: this.connected, error: this.error, backend: this.backend, run: this.run,
      meta: sql.prepare('SELECT * FROM sb_meta WHERE backend_id=?').get(this.backend) || null,
      gaps: sql.prepare('SELECT * FROM sb_gaps WHERE backend_id=? ORDER BY id DESC LIMIT 50').all(this.backend),
      totals: this.totals, databaseBytes: this.db.getDatabaseSize(), groups: this.groups };
  }
  getGroups() { return this.groups; }
  testLatency(tag: string) { return this.latency.test(tag); }
  async select(group: string, member: string) {
    if (!this.connected) throw new Error('sing-box is offline');
    const current = this.groups.find(g => g.tag === group);
    if (!current?.selectable || !current.items?.some(item => item.tag === member)) throw new Error('Group is not selectable or member is invalid');
    await this.unary('SelectOutbound', { groupTag: group, outboundTag: member });
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
      if (this.groups.find(g => g.tag === group)?.selected === member) return;
      await new Promise(resolve => setTimeout(resolve, 100));
    }
    throw new Error('Selection was not confirmed by sing-box');
  }
  stop() {
    this.flush(); this.stopped = true; clearInterval(this.maintenance); clearTimeout(this.timer);
    for (const stream of this.streams) { stream.removeAllListeners(); stream.on('error', () => {}); stream.cancel(); }
    this.client.close();
  }
}
