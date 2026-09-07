import { expect, it } from 'vitest';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import { queryNativeStats } from './ledger.js';
it.skipIf(process.env.RUN_LEDGER_BENCHMARK !== '1')('queries one million minute facts in under two seconds', () => {
  const fixture = createTestDatabase();
  try {
    const backend = createTestBackend(fixture.db);
    const db=fixture.db.getNativeDatabase();
    const now=Math.floor(Date.now()/60000)*60000;
    db.prepare(`WITH RECURSIVE seq(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM seq WHERE x<1000000)
      INSERT INTO sb_facts SELECT ?, 'minute', ?-(x%60)*60000, '192.0.2.'||(x%250), 'd'||(x%997)||'.example.com', 'example.com', '198.51.100.'||(x%251), 'mixed', 'node-a', 'final', 0, 100, 1000, 1 FROM seq`).run(backend,now);
    const filters={ from:new Date(now-86400000).toISOString(),dimension:'source' };
    queryNativeStats(db,backend,filters);
    const start=performance.now();const result=queryNativeStats(db,backend,filters);const ms=performance.now()-start;
    console.info(`Native ledger benchmark: 1,000,000 minute facts, ${ms.toFixed(1)}ms`);
    expect(result.total.download).toBe('1000000000');expect(ms).toBeLessThan(2000);
  } finally { fixture.cleanup(); }
},60000);
