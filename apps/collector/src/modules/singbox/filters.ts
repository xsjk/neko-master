import type Database from 'better-sqlite3';
import { RE2 } from 're2-wasm';
import { nativeFilterFields, nativeFilterOperators, type NativeFilterExpression } from '@neko-master/shared';

export const filterColumns: Record<typeof nativeFilterFields[number], string> = {
  source: 'source', domain: 'domain', rootDomain: 'root_domain', destination: 'destination', inbound: 'inbound', outbound: 'outbound', rule: 'rule', country: 'sb_country(destination)',
};
const cache = new Map<string, RE2>();
const registered = new WeakSet<Database.Database>();
function regex(pattern: string, flags: string) {
  const key = JSON.stringify([pattern, flags]);
  let compiled = cache.get(key);
  if (!compiled) {
    try { compiled = new RE2(pattern, flags); }
    catch { throw new Error('Invalid RE2 expression (lookaround and backreferences are not supported)'); }
    if (cache.size >= 128) cache.delete(cache.keys().next().value!);
    cache.set(key, compiled);
  }
  return compiled;
}
export function parseFilter(raw?: string): NativeFilterExpression {
  if (raw === undefined) return { match: 'all', rules: [] };
  if (typeof raw !== 'string' || raw.length > 6000 || encodeURIComponent(raw).length > 8000) throw new Error('Filter exceeds the supported query length');
  let value: NativeFilterExpression;
  try { value = JSON.parse(raw); } catch { throw new Error('Invalid filter JSON'); }
  if (!value || !['all', 'any'].includes(value.match) || !Array.isArray(value.rules) || value.rules.length > 20) throw new Error('Filter requires all/any and at most 20 rules');
  for (const rule of value.rules) {
    if (!rule || !nativeFilterFields.includes(rule.field) || !nativeFilterOperators.includes(rule.op)) throw new Error('Unknown filter field or operator');
    if (!Array.isArray(rule.values) || !rule.values.length || rule.values.length > 100 || rule.values.some(v => typeof v !== 'string' || v.length > 512)) throw new Error('Each rule needs 1–100 text values of at most 512 characters');
    if (!['in', 'notIn'].includes(rule.op) && (rule.values.length !== 1 || !rule.values[0])) throw new Error('Text and regex rules require one nonempty value');
    if (rule.ignoreCase !== undefined && typeof rule.ignoreCase !== 'boolean') throw new Error('ignoreCase must be boolean');
    if (rule.op === 'regex' || rule.op === 'notRegex') regex(rule.values[0], rule.ignoreCase ? 'iu' : 'u');
  }
  return value;
}
export function compileFilter(db: Database.Database, raw?: string) {
  const expression = parseFilter(raw);
  const params: string[] = [];
  const clauses = expression.rules.map(rule => {
    const column = filterColumns[rule.field];
    if (rule.op === 'in' || rule.op === 'notIn') {
      params.push(...rule.values);
      return `${column} ${rule.op === 'notIn' ? 'NOT IN' : 'IN'} (${rule.values.map(() => '?').join(',')})`;
    }
    if (rule.op === 'contains' || rule.op === 'notContains') {
      params.push(rule.values[0]);
      return `instr(${column}, ?) ${rule.op === 'contains' ? '>' : '='} 0`;
    }
    // Register on every connection used for querying, including export readers.
    if (!registered.has(db)) {
      db.function('sb_regex', { deterministic: true }, (pattern: unknown, flags: unknown, value: unknown) => Number(regex(String(pattern), String(flags)).test(String(value ?? ''))));
      registered.add(db);
    }
    params.push(rule.values[0], rule.ignoreCase ? 'iu' : 'u');
    return `sb_regex(?, ?, ${column}) = ${rule.op === 'regex' ? 1 : 0}`;
  });
  return { sql: clauses.length ? ` AND (${clauses.join(expression.match === 'all' ? ' AND ' : ' OR ')})` : '', params };
}
