import type Database from 'better-sqlite3';
import { isIP } from 'node:net';
import { Resolver } from 'node:dns/promises';
import { openLocalCountryDatabase } from '../geo/geo.service.js';

let lookup: ((ip: string) => string) | undefined;
let error: string | null = 'Country database is not configured';
const cache = new Map<string, string>();
const resolver = new Resolver({ timeout: 2000, tries: 1 });
const domains = new Map<string, { country: string; expires: number }>();
const pending = new Set<string>();
const queue: string[] = [];
let active = 0;
function resolveDomain(host: string) {
  if (!lookup || (domains.get(host)?.expires || 0) > Date.now() || pending.has(host) || queue.length >= 1000) return;
  pending.add(host); queue.push(host);
  drain();
}
function drain() {
  while (active < 8 && queue.length) {
    const host = queue.shift()!;
    active++;
    void Promise.allSettled([resolver.resolve4(host), resolver.resolve6(host)]).then(results => {
      const addresses = results.flatMap(result => result.status === 'fulfilled' ? result.value : []);
      // Never duplicate a hostname's bytes across DNS answers or guess between countries.
      const countries = new Set(addresses.map(ip => nativeCountry(ip)));
      const country = countries.size === 1 ? [...countries][0] : '';
      if (domains.size >= 50000) domains.delete(domains.keys().next().value!);
      domains.set(host, { country, expires: Date.now() + (country ? 3600000 : 60000) });
    }).finally(() => { active--; pending.delete(host); drain(); });
  }
}
export async function loadNativeCountry(filename?: string) {
  if (!filename) return;
  try { lookup = await openLocalCountryDatabase(filename); cache.clear(); domains.clear(); error = null; }
  catch (err) { error = err instanceof Error ? err.message : String(err); }
}
export const nativeCountryStatus = () => ({ ready: !!lookup, error });
export function nativeCountry(ip: string, snapshot = domains): string {
  if (!isIP(ip)) {
    const host = ip.toLowerCase().replace(/\.$/, '');
    if (host.length > 253 || !/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9-]{2,63}$/.test(host)) return '';
    const cached = snapshot.get(host);
    if (!cached || cached.expires <= Date.now()) resolveDomain(host);
    return cached?.country || '';
  }
  const normalized = ip.toLowerCase().replace(/^::ffff:/, '');
  if (/^(10\.|192\.168\.|127\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.|100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.)/.test(normalized) || normalized === '::1' || normalized === '::' || /^(fc|fd|fe[89ab])[0-9a-f]*:/.test(normalized)) return 'LOCAL';
  if (!lookup) return '';
  if (cache.has(ip)) return cache.get(ip)!;
  const country = lookup(ip);
  if (cache.size >= 50000) cache.delete(cache.keys().next().value!);
  cache.set(ip, country);
  return country;
}
export function registerNativeCountry(db: Database.Database) {
  // A streamed export yields between rows: freeze classifications for its entire query.
  const snapshot = new Map(domains);
  db.function('sb_country', { deterministic: true }, (ip: unknown) => nativeCountry(String(ip ?? ''), snapshot));
}

export function stopNativeCountry() {
  queue.length = 0;
  resolver.cancel();
}
