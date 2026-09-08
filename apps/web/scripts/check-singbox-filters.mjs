// Isolated API fixtures; use PLAYWRIGHT_MODULE when Playwright is installed externally.
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100}});
 const errors=[];page.on('pageerror',error=>errors.push(error.message));
 const now=Math.floor(Date.now()/60000)*60000;
 const empty={rows:[{label:'a.example.com',upload:'10',download:'100',connections:'1'}],trend:[],total:{upload:'10',download:'100',connections:'1'},recovered:{upload:'0',download:'0'},from:now-3600000,to:now,stepMs:60000,granularity:'minute'};
 await page.route('**/api/singbox/**',async route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/status'))return route.fulfill({json:{connected:true,error:'',backend:1,run:'test',meta:{since:now,last_commit:now},totals:{uplinkTotal:'0',downlinkTotal:'0'},gaps:[],databaseBytes:0,groups:[]}});
  if(path.endsWith('/filter-options'))return route.fulfill({json:{outbound:['node-a','node-b','direct'],inbound:['mixed'],rule:['final']}});
  if(path.endsWith('/filters/validate')) {
   const value=JSON.parse(route.request().postDataJSON().filter);
   if(value.rules.some(rule=>rule.values.includes('[')))return route.fulfill({status:400,json:{error:'Invalid RE2 expression'}});
   return route.fulfill({json:value});
  }
  if(path.endsWith('/connections'))return route.fulfill({json:[]});
  return route.fulfill({json:empty});
 });
 await page.goto((process.env.BASE_URL || 'http://127.0.0.1:3100')+'/zh');
 const applied=async()=>new URL(await page.getByRole('link',{name:'CSV',exact:true}).getAttribute('href'),'http://localhost').searchParams;
 const expression=async()=>JSON.parse((await applied()).get('filter'));
 await page.getByRole('button',{name:'添加条件',exact:true}).click();
 await page.getByText('选择已有值',{exact:true}).click();
 await page.getByRole('checkbox',{name:'node-a',exact:true}).check();await page.getByRole('checkbox',{name:'node-b',exact:true}).check();
 assert.equal((await applied()).get('filter'),null);
 await page.getByRole('button',{name:'应用筛选',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('a[href*="format=csv"]').href.includes('filter='));
 assert.deepEqual((await expression()).rules[0],{field:'outbound',op:'in',values:['node-a','node-b']});
 await page.getByRole('button',{name:'添加条件',exact:true}).click();
 await page.getByLabel('条件 2 匹配方式',{exact:true}).selectOption('notIn');
 await page.getByLabel('条件 2 值',{exact:true}).fill('node-b');
 await page.getByRole('button',{name:'应用筛选',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(new URL(document.querySelector('a[href*="format=csv"]').href).searchParams.get('filter')).rules.length===2);
 assert.equal((await expression()).match,'all');assert.equal((await expression()).rules[1].op,'notIn');
 await page.getByLabel('条件 2 字段',{exact:true}).selectOption('domain');
 await page.getByLabel('条件 2 匹配方式',{exact:true}).selectOption('regex');
 await page.getByLabel('条件 2 值',{exact:true}).fill('^api\\.');
 await page.getByRole('checkbox',{name:'忽略大小写',exact:true}).check();
 await page.getByRole('button',{name:'应用筛选',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(new URL(document.querySelector('a[href*="format=csv"]').href).searchParams.get('filter')).rules[1].op==='regex');
 const valid=(await applied()).get('filter');assert.equal((await expression()).rules[1].ignoreCase,true);
 await page.getByLabel('条件 2 值',{exact:true}).fill('[');
 await page.getByRole('button',{name:'应用筛选',exact:true}).click();await page.getByRole('alert').getByText('Invalid RE2 expression',{exact:true}).waitFor();
 assert.equal((await applied()).get('filter'),valid);
 await page.getByLabel('条件 2 值',{exact:true}).fill('^api\\.');await page.getByLabel('条件组合',{exact:true}).selectOption('any');
 await page.getByRole('button',{name:'应用筛选',exact:true}).click();
 await page.waitForFunction(()=>JSON.parse(new URL(document.querySelector('a[href*="format=csv"]').href).searchParams.get('filter')).match==='any');
 await page.setViewportSize({width:390,height:844});
 assert.ok(await page.locator('fieldset').first().evaluate(el=>el.getBoundingClientRect().right<=innerWidth));
 await page.getByRole('button',{name:'清除筛选',exact:true}).click();assert.equal((await applied()).get('filter'),null);
 await page.getByRole('button',{name:'a.example.com',exact:true}).click();assert.equal((await applied()).get('domain'),'a.example.com');
 await page.getByRole('button',{name:'添加条件',exact:true}).click();await page.getByLabel('条件 1 值',{exact:true}).fill('node-a');
 await page.getByRole('button',{name:'应用筛选',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('a[href*="format=csv"]').href.includes('filter='));
 assert.equal((await applied()).get('domain'),'a.example.com');assert.equal((await expression()).rules[0].values[0],'node-a');
 assert.deepEqual(errors,[]);console.log('Passed multi-select, exclusions, regex, invalid draft preservation, AND/OR, clear, drill-down, exports and mobile layout.');
}finally{await browser.close();}
