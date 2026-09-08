import { afterEach, expect, it, vi } from 'vitest';
import Database from 'better-sqlite3';
const mocks = vi.hoisted(() => ({resolve4:vi.fn(),resolve6:vi.fn()}));
vi.mock('node:dns/promises', () => ({Resolver:class {resolve4=mocks.resolve4;resolve6=mocks.resolve6;}}));
vi.mock('../geo/geo.service.js', () => ({openLocalCountryDatabase:async()=> (ip:string)=>ip.startsWith('1.') ? 'CN' : 'US'}));
afterEach(()=>{vi.resetModules();vi.clearAllMocks();});
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
