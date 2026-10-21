import { isIP } from 'node:net';
import type Database from 'better-sqlite3';
import { getDomain } from 'tldts';

export const addressIP = (address: string) => isIP(address) ? address : address.startsWith('[') ? address.slice(1, address.indexOf(']')) : address.replace(/:\d+$/, '');

/** Use only names already recorded by sing-box; IPs do not identify a domain. */
export function destinationDomain(destination: string): string {
  const host = addressIP(destination).toLowerCase().replace(/\.$/, '');
  return isIP(host) || host.includes(':') ? '' : host;
}
const registered = new WeakSet<Database.Database>();
export function registerNativeDomains(db: Database.Database) {
  if (registered.has(db)) return;
  db.function('sb_domain', { deterministic: true }, (destination: unknown) => destinationDomain(String(destination ?? '')));
  db.function('sb_root_domain', { deterministic: true }, (destination: unknown) => {
    const domain = destinationDomain(String(destination ?? ''));
    return getDomain(domain, { allowPrivateDomains: true }) || domain;
  });
  registered.add(db);
}
