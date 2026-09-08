import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { NativeConnection, NativeFilterExpression, NativeFilterRule } from '@neko-master/shared';
import { createTestDatabase, createTestBackend } from '../../__tests__/helpers.js';
import { queryNativeConnections, queryNativeStats } from './ledger.js';
import { parseFilter } from './filters.js';
let fixture: ReturnType<typeof createTestDatabase>, backend: number;
beforeEach(() => {
  fixture = createTestDatabase(); backend = createTestBackend(fixture.db);
  const writer = fixture.db.repos.trafficWriter;
  writer.batchUpdateTrafficStats(backend, [], false, { batch: { reset: true, events: [] }, run: 'test', now: Date.now(), initial: true });
  for (const [id, domain, outbound, download] of [['a','a.example.com','node-a','100'],['b','b.example.com','node-b','200'],['c','literal%_.com','direct','300']]) {
    const connection: NativeConnection = { id, domain, outbound, source: `192.0.2.${id === 'a' ? '1' : '2'}:1234`, destination: '1.1.1.1:443', inbound: 'mixed', rule: 'final', network: 'tcp', user: '', chainList: [outbound], createdAt: String(Date.now()), closedAt: '0', uplinkTotal: '10', downlinkTotal: download };
    writer.batchUpdateTrafficStats(backend, [], false, { batch: { reset: false, events: [{ id, type: 'CONNECTION_EVENT_NEW', connection, closedAt: '0', uplinkDelta: '0', downlinkDelta: '0' }] }, run: 'test', now: Date.now(), initial: false });
  }
});
afterEach(() => fixture.cleanup());
function query(rules: NativeFilterRule[], match: NativeFilterExpression['match'] = 'all') {
  const filters = { filter: JSON.stringify({ match, rules }) };
  return { stats: queryNativeStats(fixture.db.getNativeDatabase(), backend, filters), rows: queryNativeConnections(fixture.db.getNativeDatabase(), backend, filters) as Record<string,string>[] };
}
describe('composable native filters', () => {
  it('selects multiple outbounds and intersects exclusions without double counting', () => {
    const multiple = query([{ field: 'outbound', op: 'in', values: ['node-a','node-b','node-a'] }]);
    expect(multiple.stats.total.download).toBe('300');expect(multiple.rows.length).toBe(2);
    const excluded = query([{ field: 'outbound', op: 'in', values: ['node-a','node-b'] }, { field: 'outbound', op: 'notIn', values: ['node-b'] }]);
    expect(excluded.stats.total.download).toBe('100');expect(excluded.rows.map(row=>row.id)).toEqual(['a']);
  });
  it('combines different fields with OR while preserving backend isolation', () => {
    const rules: NativeFilterRule[] = [{ field: 'source', op: 'in', values: ['192.0.2.1'] }, { field: 'outbound', op: 'in', values: ['direct'] }];
    const result = query(rules, 'any');expect(result.stats.total.download).toBe('400');expect(result.rows.length).toBe(2);
    expect(queryNativeStats(fixture.db.getNativeDatabase(),createTestBackend(fixture.db, 'other'),{filter:JSON.stringify({match:'any',rules})}).total.download).toBe('0');
  });
  it('supports regex alternation, negation and case flags consistently in facts and details', () => {
    expect(query([{field:'domain',op:'regex',values:['^[ab]\\.EXAMPLE\\.com$'],ignoreCase:true}]).stats.total.download).toBe('300');
    const result=query([{field:'domain',op:'notRegex',values:['\\.example\\.com$']}]);
    expect(result.stats.total.download).toBe('300');expect(result.rows[0].id).toBe('c');
  });
  it('treats text wildcards and SQL syntax literally', () => {
    expect(query([{field:'domain',op:'contains',values:['%_']}]).rows.map(row=>row.id)).toEqual(['c']);
    expect(query([{field:'domain',op:'notContains',values:['%_']}]).rows.length).toBe(2);
    expect(query([{field:'outbound',op:'in',values:["x' OR 1=1 --"]}]).rows.length).toBe(0);
  });
  it('validates malformed rules and unsupported regex before executing even on empty data', () => {
    for(const raw of ['null','{',JSON.stringify({match:'all',rules:[{field:'invalid',op:'in',values:['a']}]}),JSON.stringify({match:'any',rules:[{field:'domain',op:'regex',values:['(?=x)']}]}),JSON.stringify({match:'all',rules:[{field:'outbound',op:'in',values:[]}]}),JSON.stringify({match:'all',rules:[{field:'domain',op:'regex',values:['[']}]} )]) expect(()=>parseFilter(raw)).toThrow();
    expect(parseFilter(JSON.stringify({match:'all',rules:[]}))).toEqual({match:'all',rules:[]});
  });
});
