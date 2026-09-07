import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, request } from 'node:http';
import { createServer as tcpServer } from 'node:net';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { NativeService } from './service.js';
import { queryNativeConnections, queryNativeStats } from './ledger.js';
import { createTestDatabase } from '../../__tests__/helpers.js';

async function port() {
  const s = tcpServer(); await new Promise<void>(resolve => s.listen(0,'127.0.0.1',resolve));
  const p = (s.address() as {port:number}).port; await new Promise<void>(resolve => s.close(() => resolve())); return p;
}
async function until(check: () => boolean, ms = 15000) {
  const end=Date.now()+ms;
  while(Date.now()<end) { if(check()) return; await new Promise(resolve=>setTimeout(resolve,100)); }
  throw new Error('Condition timed out');
}
let fixture:ReturnType<typeof createTestDatabase>, native:NativeService, child:ChildProcess;
let proxyPort:number, apiPort:number, targetPort:number, directory:string;
const body = Buffer.alloc(32768,'a');
const target=createServer((req,res)=>{ req.resume(); req.on('end',()=>{res.writeHead(200,{'Content-Length':body.length});res.end(body);}); });
async function traffic(localAddress='127.0.0.2') {
  return new Promise<void>((resolve,reject)=>{
    const req=request({hostname:'127.0.0.1',port:proxyPort,localAddress,method:'POST',path:`http://localhost:${targetPort}/file`,headers:{Host:`localhost:${targetPort}`,'Content-Length':1024}},res=>{res.resume();res.on('end',resolve);});
    req.on('error',reject); req.end(Buffer.alloc(1024));
  });
}
function startBox() { child=spawn('sing-box',['run','-c',join(directory,'config.json')],{stdio:['ignore','ignore','inherit']}); }
beforeAll(async()=>{
  fixture=createTestDatabase();directory=mkdtempSync(join(tmpdir(),'sb-integration-'));
  proxyPort=await port();apiPort=await port();
  await new Promise<void>(resolve=>target.listen(0,'127.0.0.1',resolve));targetPort=(target.address() as {port:number}).port;
  writeFileSync(join(directory,'config.json'),JSON.stringify({
    log:{level:'error'},dns:{servers:[{type:'local',tag:'local'}]},
    inbounds:[{type:'mixed',tag:'test-in',listen:'127.0.0.1',listen_port:proxyPort}],
    outbounds:[{type:'selector',tag:'test-select',outbounds:['direct-a','direct-b']},{type:'direct',tag:'direct-a'},{type:'direct',tag:'direct-b'}],
    route:{final:'test-select',default_domain_resolver:'local'},
    services:[{type:'api',tag:'api',listen:'127.0.0.1',listen_port:apiPort,secret:'test-secret'}],
  }));
  startBox();native=new NativeService(fixture.db,`127.0.0.1:${apiPort}`,'test-secret');native.start();
  try { await until(()=>native.status().connected); } catch (e) { console.error(native.status()); throw e; }
},20000);
afterAll(async()=>{native?.stop();child?.kill('SIGTERM');await new Promise<void>(resolve=>target.close(()=>resolve()));fixture?.cleanup();if(directory)rmSync(directory,{recursive:true,force:true});});
describe('real sing-box native API (without TUN)',()=>{
  it('records short upload/download connections with source addresses',async()=>{
    await traffic();await traffic('127.0.0.3');
    await until(()=>queryNativeStats(fixture.db.getNativeDatabase(),native.backend,{}).total.connections==='2');
    const rows=queryNativeStats(fixture.db.getNativeDatabase(),native.backend,{dimension:'source'}).rows;
    expect(rows.map(r=>r.label).sort()).toEqual(['127.0.0.2','127.0.0.3']);
    for(const row of rows) {expect(BigInt(row.download)).toBeGreaterThanOrEqual(32768n);expect(BigInt(row.upload)).toBeGreaterThanOrEqual(1024n);}
    const details=queryNativeConnections(fixture.db.getNativeDatabase(),native.backend,{}) as Record<string,string>[];
    expect(details.every(r=>Number(r.closed)>0)).toBe(true);
  },20000);
  it('rejects non-selectors and confirms a legal selector change',async()=>{
    await until(()=>native.getGroups().length>0);
    await expect(native.select('direct-a','direct-b')).rejects.toThrow();
    await expect(native.select('test-select','missing')).rejects.toThrow();
    await native.select('test-select','direct-b');
    expect(native.getGroups().find(g=>g.tag==='test-select')?.selected).toBe('direct-b');
  },15000);
  it('reconnects without duplicating previously closed connections',async()=>{
    const before=queryNativeStats(fixture.db.getNativeDatabase(),native.backend,{}).total;
    native.stop();native=new NativeService(fixture.db,`127.0.0.1:${apiPort}`,'test-secret');native.start();
    await until(()=>native.status().connected);
    expect(queryNativeStats(fixture.db.getNativeDatabase(),native.backend,{}).total).toEqual(before);
  },15000);
  it('preserves history when sing-box restarts and records new traffic',async()=>{
    const before=queryNativeStats(fixture.db.getNativeDatabase(),native.backend,{}).total;
    const previousRun=native.status().run;
    child.kill('SIGTERM');await new Promise<void>(resolve=>child.once('exit',()=>resolve()));
    await until(()=>!native.status().connected);startBox();
    await until(()=>native.status().connected && native.status().run!==previousRun);
    expect(queryNativeStats(fixture.db.getNativeDatabase(),native.backend,{}).total).toEqual(before);
    await traffic();
    await until(()=>BigInt(queryNativeStats(fixture.db.getNativeDatabase(),native.backend,{}).total.download)>BigInt(before.download));
  },20000);
});
