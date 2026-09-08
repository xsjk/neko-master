#!/usr/bin/env node
// DB-IP Country Lite (CC BY 4.0): https://db-ip.com/db/download/ip-to-country-lite
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, mkdtemp, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
const require = createRequire(new URL('../apps/collector/package.json', import.meta.url));
const maxmind = require('maxmind');
const month = process.argv[2] || new Date().toISOString().slice(0,7);
if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('Expected release YYYY-MM');
const dir = process.env.SINGBOX_GEOIP_DIR || resolve(fileURLToPath(new URL('../..', import.meta.url)), 'geoip');
await mkdir(dir, {recursive:true});
const temp = await mkdtemp(join(dir,'.download-'));
try {
  const url = `https://download.db-ip.com/free/dbip-country-lite-${month}.mmdb.gz`;
  execFileSync('curl',['--fail','--location','--retry','2','--max-time','180','--output',join(temp,'country.gz'),url],{stdio:'inherit'});
  const file = join(temp,'country.mmdb');
  await writeFile(file,gunzipSync(await readFile(join(temp,'country.gz'))));
  const reader = await maxmind.open(file);
  if (!reader.get('8.8.8.8')?.country?.iso_code) throw new Error('Country database validation failed');
  await rename(file,join(dir,'dbip-country-lite.mmdb'));
  await writeFile(join(dir,'SOURCE.txt'),`DB-IP Country Lite ${month}\n${url}\nCC BY 4.0 — https://creativecommons.org/licenses/by/4.0/\nIP Geolocation by DB-IP — https://db-ip.com\n`);
  console.log(`Installed ${join(dir,'dbip-country-lite.mmdb')}. Restart the collector to load it.`);
} finally { await rm(temp,{recursive:true,force:true}); }
