// Run against a local web server. API responses are isolated fixtures.
// Set PLAYWRIGHT_MODULE to an installed Playwright module if it is not on the package path.
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
import assert from 'node:assert/strict';
const browser=await chromium.launch({headless:true});
try {
 const page=await browser.newPage({viewport:{width:1440,height:1100},hasTouch:true});
 const errors=[];page.on('pageerror',e=>errors.push(e.message));
 const queries=[];const now=Math.floor(Date.now()/60000)*60000;
 await page.route('**/api/singbox/**',route=>{
  const path=new URL(route.request().url()).pathname;
  if(path.endsWith('/status'))return route.fulfill({json:{connected:true,error:'',backend:1,run:'test',meta:{since:now-86400000,last_commit:now},gaps:[],totals:{uplinkTotal:'0',downlinkTotal:'0'},databaseBytes:0,groups:[]}});
  if(path.endsWith('/connections'))return route.fulfill({json:[]});
  return route.fulfill({json:{from:now-86400000,to:now,stepMs:60000,granularity:'minute',trend:[],rows:[],total:{upload:'0',download:'0',connections:'0'},recovered:{upload:'0',download:'0'}}});
 });
 await page.route('**/api/singbox/stats?*',route=>{
  const url=new URL(route.request().url());queries.push(url.searchParams);
  const from=Date.parse(url.searchParams.get('from'))||now-86400000,to=Date.parse(url.searchParams.get('to'))||now;
  const stepMs=Math.max(60000,Math.ceil((to-from)/60/60000)*60000);
  const trend=[];for(let bucket=from;bucket<to;bucket+=stepMs)trend.push({bucket:String(bucket),upload:'1000',download:'5000'});
  return route.fulfill({json:{from,to,stepMs,granularity:'minute',trend,rows:[],total:{upload:'60000',download:'300000',connections:'0'},recovered:{upload:'0',download:'0'}}});
 });
 await page.goto((process.env.BASE_URL || 'http://127.0.0.1:3100') + '/zh');
 const selection=page.getByTestId('time-selection');await selection.waitFor();
 const latest=()=>queries.at(-1);
 const active=async()=>new URL(await page.getByRole('link',{name:'CSV',exact:true}).getAttribute('href'),'http://localhost').searchParams;
 const bounds=async()=>{await selection.waitFor();await selection.scrollIntoViewIfNeeded();return selection.boundingBox();};
 async function drag(a,b,escape=false){const box=await bounds();await page.mouse.move(box.x+box.width*a,box.y+box.height/2);await page.mouse.down();await page.mouse.move(box.x+box.width*b,box.y+box.height/2,{steps:10});if(escape)await page.keyboard.press('Escape');await page.mouse.up();}
 const initial=latest().get('from');
 await drag(.2,.8);
 await page.waitForFunction(()=>document.querySelector('select[aria-label="时间范围"]').value==='custom');
 await selection.waitFor();
 assert.ok(Date.parse(latest().get('from'))>Date.parse(initial));
 const first=latest().get('from'), firstTo=latest().get('to');
 await drag(.8,.2);
 await page.waitForFunction(value=>document.querySelector('input[aria-label="开始时间（上海）"]').value!==value,new Date(Date.parse(first)+28800000).toISOString().slice(0,16));
 await selection.waitFor();
 assert.ok(Date.parse(latest().get('from'))>Date.parse(first));
 await page.getByRole('button',{name:'返回上一级',exact:true}).click();await selection.waitFor();
 assert.equal((await active()).get('from'),first);assert.equal((await active()).get('to'),firstTo);
 await drag(.2,.7,true);assert.equal((await active()).get('from'),first);
 await drag(.5,.501);assert.equal((await active()).get('from'),first);
 const exportUrl=new URL(await page.getByRole('link',{name:'CSV',exact:true}).getAttribute('href'),'http://localhost');
 assert.equal(exportUrl.searchParams.get('from'),first);assert.equal(exportUrl.searchParams.get('to'),firstTo);
 await page.getByLabel('开始时间（上海）',{exact:true}).fill('2026-09-08T10:00');
 await page.getByLabel('结束时间（上海）',{exact:true}).fill('2026-09-08T09:00');
 await page.getByRole('button',{name:'应用时间',exact:true}).click();await page.getByRole('alert').filter({hasText:'结束时间必须晚于开始时间'}).waitFor();
 assert.equal((await active()).get('from'),first);
 await page.getByLabel('结束时间（上海）',{exact:true}).fill('2026-09-08T11:00');
 await page.getByRole('button',{name:'应用时间',exact:true}).click();await selection.waitFor();
 assert.equal((await active()).get('from'),'2026-09-08T02:00:00.000Z');
 assert.equal((await active()).get('to'),'2026-09-08T03:00:00.000Z');
 await page.getByRole('button',{name:'重置时间',exact:true}).click();await selection.waitFor();
 assert.equal(await page.getByLabel('时间范围',{exact:true}).inputValue(),'24');
 assert.equal(await page.getByRole('button',{name:'返回上一级',exact:true}).isDisabled(),true);
 // A rolling preset must not move the plot under an active pointer.
 await page.clock.install();
 const beforeRefresh=await active(),plot=await bounds();
 await page.mouse.move(plot.x+plot.width*.25,plot.y+plot.height/2);await page.mouse.down();
 await page.clock.fastForward(600000);
 await page.mouse.move(plot.x+plot.width*.75,plot.y+plot.height/2,{steps:5});await page.mouse.up();
 const expected=Math.floor((Date.parse(beforeRefresh.get('from'))+(Date.parse(beforeRefresh.get('to'))-Date.parse(beforeRefresh.get('from')))*.25)/60000)*60000;
 assert.equal(Date.parse((await active()).get('from')),expected);
 await page.clock.resume();
 await page.getByRole('button',{name:'重置时间',exact:true}).click();await selection.waitFor();
 await page.getByRole('button',{name:'切换主题',exact:true}).click();
 await page.setViewportSize({width:390,height:844});await selection.waitFor();
 assert.ok((await selection.boundingBox()).width>100);
 await selection.scrollIntoViewIfNeeded();
 const box=await selection.boundingBox();const touch=await page.context().newCDPSession(page);
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:box.x+box.width*.2,y:box.y+box.height*.5}]});
 for(let i=3;i<=8;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:box.x+box.width*i/10,y:box.y+box.height*.5}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(()=>document.querySelector('select[aria-label="时间范围"]').value==='custom');
 const fixed=(await active()).get('from');
 await selection.scrollIntoViewIfNeeded();const vertical=await selection.boundingBox();
 const scroll=await page.evaluate(()=>scrollY);
 await touch.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:vertical.x+vertical.width/2,y:vertical.y+vertical.height/2}]});
 for(let i=1;i<=5;i++)await touch.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:vertical.x+vertical.width/2,y:vertical.y+vertical.height/2-i*20}]});
 await touch.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
 await page.waitForFunction(previous=>scrollY>previous,scroll);
 assert.equal((await active()).get('from'),fixed);
 assert.deepEqual(errors,[]);
 console.log('Passed forward/reverse zoom, back/reset, Escape/click cancellation, input validation, Shanghai conversion, exports, themes and real touch dragging.');
} finally {await browser.close();}
