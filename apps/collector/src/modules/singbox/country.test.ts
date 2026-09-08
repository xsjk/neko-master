import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
const mocks = vi.hoisted(() => ({resolve4:vi.fn(),resolve6:vi.fn()}));
beforeEach(()=>{
  vi.stubGlobal('fetch',vi.fn(async (url:URL)=>{
    const v4=url.searchParams.get('type')==='A';
    const values=await (v4 ? mocks.resolve4 : mocks.resolve6)(url.searchParams.get('name'));
    return {ok:true,json:async()=>({Status:0,Answer:values.map((data:string)=>({type:v4?1:28,data}))})};
  }));
});
vi.mock('../geo/geo.service.js', () => ({openLocalCountryDatabase:async()=> (ip:string)=>ip.startsWith('1.') ? 'CN' : 'US'}));
afterEach(()=>{vi.resetModules();vi.clearAllMocks();vi.unstubAllGlobals();vi.unstubAllEnvs();});
it('classifies a hostname once regardless of DNS answer count, without changing bytes', async () => {
  mocks.resolve4.mockResolvedValue(['1.1.1.1','1.1.1.2']);mocks.resolve6.mockResolvedValue([]);
  const {loadNativeCountry,registerNativeCountry}=await import('./country.js');
  await loadNativeCountry('fixture');
  const db=new Database(':memory:');
  try {
    db.exec("CREATE TABLE facts(destination TEXT, bytes INTEGER); INSERT INTO facts VALUES('api.example.com',100),('api.example.com',200),('2.2.2.2',50)");
    const query=()=>db.prepare('SELECT sb_country(destination) country,SUM(bytes) bytes FROM facts GROUP BY country ORDER BY country').all();
    registerNativeCountry(db);expect(query()).toEqual([{country:'',bytes:300},{country:'US',bytes:50}]);
    await vi.waitFor(()=>expect(mocks.resolve4).toHaveBeenCalledTimes(1));
    await new Promise(resolve=>setImmediate(resolve));
    // Existing query/export snapshot does not change as DNS completes.
    expect(query()).toEqual([{country:'',bytes:300},{country:'US',bytes:50}]);
    registerNativeCountry(db);expect(query()).toEqual([{country:'CN',bytes:300},{country:'US',bytes:50}]);
    expect(db.prepare('SELECT SUM(bytes) total FROM facts').get()).toEqual({total:350});
    expect(mocks.resolve4).toHaveBeenCalledTimes(1);
  } finally {db.close();}
});
it('keeps mixed-country and failed DNS answers Unknown and caches failures',async()=>{
  mocks.resolve4.mockResolvedValueOnce(['1.1.1.1','2.2.2.2']).mockRejectedValue(new Error('DNS failed'));mocks.resolve6.mockResolvedValue([]);
  const {loadNativeCountry,nativeCountry}=await import('./country.js');await loadNativeCountry('fixture');
  nativeCountry('mixed.example.com');nativeCountry('failed.example.com');
  await new Promise(resolve=>setImmediate(resolve));
  expect(nativeCountry('mixed.example.com')).toBe('');expect(nativeCountry('failed.example.com')).toBe('');
  expect(mocks.resolve4).toHaveBeenCalledTimes(2);
});

it('uses only the configured sing-box API and respects empty and CNAME-only responses',async()=>{
  vi.stubEnv('SINGBOX_CLASH_API_URL','http://127.0.0.1:19090');
  vi.stubEnv('SINGBOX_CLASH_SECRET','fixture-token');
  const fetchMock=vi.fn().mockResolvedValue({ok:true,json:async()=>({Status:0,Answer:[{type:5,data:'alias.example.com.'}]})});
  vi.stubGlobal('fetch',fetchMock);
  const {loadNativeCountry,nativeCountry}=await import('./country.js');await loadNativeCountry('fixture');
  nativeCountry('ipv6.example.com');await new Promise(resolve=>setImmediate(resolve));
  expect(nativeCountry('ipv6.example.com')).toBe('');expect(fetchMock).toHaveBeenCalledTimes(2);
  for(const [url,options] of fetchMock.mock.calls){
    expect(url.origin).toBe('http://127.0.0.1:19090');expect(url.pathname).toBe('/dns/query');
    expect(options.headers.Authorization).toBe('Bearer fixture-token');
  }
});
