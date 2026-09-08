import type Database from 'better-sqlite3';
import { isIP } from 'node:net';
import { openLocalCountryDatabase } from '../geo/geo.service.js';

let lookup: ((ip: string) => string) | undefined;
let error: string | null = 'Country database is not configured';
const cache = new Map<string, string>();
const registered = new WeakSet<Database.Database>();
export async function loadNativeCountry(filename?: string) {
  if (!filename) return;
  try { lookup = await openLocalCountryDatabase(filename); cache.clear(); error = null; }
  catch (err) { error = err instanceof Error ? err.message : String(err); }
}
export const nativeCountryStatus = () => ({ ready: !!lookup, error });
export function nativeCountry(ip: string): string {
  if (!isIP(ip)) return '';
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
  if (registered.has(db)) return;
  db.function('sb_country', { deterministic: true }, (ip: unknown) => nativeCountry(String(ip ?? '')));
  registered.add(db);
}
