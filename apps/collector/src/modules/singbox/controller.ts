import Database from 'better-sqlite3';
import type { FastifyPluginAsync } from 'fastify';
import { Readable } from 'node:stream';
import type { NativeFilters } from '@neko-master/shared';
import { NativeService } from './service.js';
import { queryNativeConnections, queryNativeStats } from './ledger.js';

export const singboxController: FastifyPluginAsync = async app => {
  const address = process.env.SINGBOX_ADDRESS;
  if (!address) return;
  const service = new NativeService(app.db, address, process.env.SINGBOX_SECRET || '');
  service.start();
  app.addHook('onClose', async () => service.stop());
  const sql = app.db.getNativeDatabase();
  app.addHook('onRequest', async (req, reply) => {
    const origin = req.headers.origin;
    if (origin && !['http://127.0.0.1:3000', 'http://localhost:3000'].includes(origin)) return reply.code(403).send({ error: 'Origin rejected' });
    reply.header('Cache-Control', 'no-store');
  });
  app.setErrorHandler((err, _req, reply) => reply.code(400).send({ error: err instanceof Error ? err.message : 'Native request failed' }));
  app.get('/status', async () => service.status());
  app.get('/groups', async () => service.getGroups());
  app.post<{ Body: { tag: string } }>('/groups/url-test', async req => {
    if (typeof req.body?.tag !== 'string' || !req.body.tag.trim()) throw new Error('tag is required');
    return service.testLatency(req.body.tag);
  });
  app.put<{ Body: { group: string; member: string } }>('/groups/selection', async req => {
    if (typeof req.body?.group !== 'string' || typeof req.body?.member !== 'string') throw new Error('group and member are required');
    await service.select(req.body.group, req.body.member);
    return { ok: true };
  });
  app.get<{ Querystring: NativeFilters }>('/stats', async req => queryNativeStats(sql, service.backend, req.query));
  app.get<{ Querystring: NativeFilters }>('/connections', async req => queryNativeConnections(sql, service.backend, req.query));
  app.get<{ Querystring: NativeFilters & { format?: string } }>('/export', async (req, reply) => {
    const format = req.query.format || 'jsonl';
    if (!['jsonl', 'csv'].includes(format)) throw new Error('Unsupported export format');
    const reader = new Database(sql.name, { readonly: true, fileMustExist: true });
    let rows: Iterable<Record<string, unknown>>;
    try { rows = queryNativeConnections(reader, service.backend, req.query, true) as Iterable<Record<string, unknown>>; }
    catch (err) { reader.close(); throw err; }
    const json = (v: unknown) => JSON.stringify(v, (_, value: unknown) => typeof value === 'bigint' ? value.toString() : value);
    // Yield between rows so a large export does not block the collector event loop.
    async function* output() {
      let header = true;
      try {
      for (const row of rows) {
        if (format === 'jsonl') yield json(row) + '\n';
        else {
          if (header) { yield Object.keys(row).join(',') + '\n'; header = false; }
          yield Object.values(row).map(v => '"' + String(v ?? '').replace(/^[=+@-]/, "'$&").replaceAll('"', '""') + '"').join(',') + '\n';
        }
        await new Promise<void>(resolve => setImmediate(resolve));
      }
      } finally { reader.close(); }
    }
    reply.header('Content-Disposition', `attachment; filename="connections.${format}"`);
    reply.type(format === 'csv' ? 'text/csv; charset=utf-8' : 'application/x-ndjson');
    return reply.send(Readable.from(output()));
  });
};
