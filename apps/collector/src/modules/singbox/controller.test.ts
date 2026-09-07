import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { createTestDatabase } from '../../__tests__/helpers.js';
import { singboxController } from './controller.js';
import type { NativeConnection } from '@neko-master/shared';
let fixture: ReturnType<typeof createTestDatabase>;
let app:FastifyInstance;
beforeEach(async()=>{
  vi.stubEnv('SINGBOX_ADDRESS','127.0.0.1:1');
  fixture=createTestDatabase();
  app=Fastify();app.decorate('db',fixture.db);
  await app.register(singboxController,{prefix:'/api/singbox'});await app.ready();
  const backend=fixture.db.getAllBackends()[0].id;
  fixture.db.repos.trafficWriter.batchUpdateTrafficStats(backend,[],false,{batch:{events:[],reset:true},run:'test',now:Date.now(),initial:true});
  for(const [id,source,domain,upload] of [['a','192.0.2.1:1000','example.com','9007199254740993'],['b','192.0.2.2:1000','=formula','1']]) {
    const connection:NativeConnection={id,source,domain, destination:'1.1.1.1:443',inbound:'mixed',outbound:'direct',rule:'final',network:'tcp',user:'',chainList:['direct'],createdAt:String(Date.now()),closedAt:String(Date.now()),uplinkTotal:upload,downlinkTotal:'100'};
    fixture.db.repos.trafficWriter.batchUpdateTrafficStats(backend,[],false,{batch:{reset:false,events:[{id,connection,type:'CONNECTION_EVENT_CLOSED',closedAt:connection.closedAt,uplinkDelta:'0',downlinkDelta:'0'}]},run:'test',now:Date.now(),initial:false});
  }
});
afterEach(async()=>{await app.close();fixture.cleanup();vi.unstubAllEnvs();});
describe('native query and export HTTP API',()=>{
  it('filters source and returns exact byte strings',async()=>{
    const res=await app.inject('/api/singbox/stats?source=192.0.2.1');
    expect(res.statusCode).toBe(200);expect(res.json().total.upload).toBe('9007199254740993');
  });
  it('exports JSONL and escapes spreadsheet formula prefixes in CSV',async()=>{
    const json=await app.inject('/api/singbox/export?format=jsonl');
    expect(json.statusCode).toBe(200);
    const rows=json.body.trim().split('\n').map(s=>JSON.parse(s));
    expect(rows.length).toBe(2);expect(rows.find(r=>r.id==='a').upload).toBe('9007199254740993');
    const csv=await app.inject('/api/singbox/export?format=csv');
    expect(csv.body).toContain('"\'=formula"');expect(csv.headers['content-disposition']).toContain('connections.csv');
  });
  it('rejects foreign origins, invalid filters and selection while offline',async()=>{
    expect((await app.inject({url:'/api/singbox/status',headers:{origin:'https://example.com'}})).statusCode).toBe(403);
    expect((await app.inject('/api/singbox/stats?from=bad')).statusCode).toBe(400);
    expect((await app.inject('/api/singbox/export?format=html')).statusCode).toBe(400);
    expect((await app.inject({method:'PUT',url:'/api/singbox/groups/selection',payload:{group:'not-selector',member:'direct'}})).statusCode).toBe(400);
  });
});
