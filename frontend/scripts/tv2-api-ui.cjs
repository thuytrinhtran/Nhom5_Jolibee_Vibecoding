// Non-DEMO browser path -> actual Express routes -> isolated PostgreSQL.
// Auth provider and Supabase transport are test fixtures; this is NOT a live Supabase smoke test.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
process.env.REGISTRATION_PGLITE_PATH ||= path.join(os.tmpdir(),'jollishift-registration-test/node_modules/@electric-sql/pglite');
const {chromium}=require(process.env.REGISTRATION_PLAYWRIGHT_PATH||path.join(os.tmpdir(),'jollishift-ui-test/node_modules/playwright-core'));
(async()=>{
 const h=await require('../../backend/tests/helpers/registration-harness.cjs').createHarness();
 const api=h.app.listen(0,'127.0.0.1');await new Promise(r=>api.once('listening',r));
 let vite,browser;
 try{
  process.env.VITE_TV2_DEMO='false';process.env.VITE_API_URL='/api';
  const {createServer}=await import('vite');
  vite=await createServer({root:path.resolve(__dirname,'..'),configFile:path.resolve(__dirname,'../vite.config.ts'),cacheDir:fs.mkdtempSync(path.join(os.tmpdir(),'jollishift-tv2-api-vite-')),mode:'development',server:{port:0,strictPort:false,host:'127.0.0.1',proxy:{'/api':{target:`http://127.0.0.1:${api.address().port}`,changeOrigin:true}}}});
  await vite.listen();const origin=`http://127.0.0.1:${vite.httpServer.address().port}`;
  browser=await chromium.launch({executablePath:process.env.TV2_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
  const page=await browser.newPage({viewport:{width:1366,height:768}});const errors=[];let registrationWrites=0;
  page.on('pageerror',error=>errors.push(error.message));page.on('dialog',dialog=>dialog.accept());
  page.on('request',req=>{if(req.url().includes('/api/registrations/')&&req.method()==='PUT')registrationWrites++;});
  await page.route('**/*',route=>new URL(route.request().url()).origin===origin?route.continue():route.abort());
  await page.goto(origin+'/login');
  await page.locator('input[type=email]').fill('api-fixture@example.invalid');
  await page.locator('input[type=password]').fill('Fixture-only-Password!1');
  await page.locator('form button[type=submit]').click();await page.waitForURL(origin+'/employee');
  await page.goto(origin+'/employee/register');
  const cards=page.locator('.reg-days fieldset');await cards.first().waitFor();
  assert.equal(await page.locator('.reg-demo').count(),0);
  const morning=cards.nth(0).getByRole('checkbox').nth(0);
  assert.equal(await page.locator('.reg-days input[type=checkbox]').count(),21);
  await morning.check();
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã lưu nháp'}).waitFor();
  await page.reload();await cards.first().waitFor();assert.equal(await morning.isChecked(),true);assert.equal(await page.locator('.reg-badge').textContent(),'Nháp');assert.ok((await cards.nth(1).textContent()).includes('Chưa gửi đăng ký'));
  await page.getByRole('button',{name:'Gửi đăng ký',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã gửi đăng ký hợp lệ'}).waitFor();
  await page.reload();await cards.first().waitFor();assert.equal(await morning.isChecked(),true);assert.equal(await page.locator('.reg-badge').textContent(),'Hợp lệ');assert.ok((await cards.nth(1).textContent()).includes('OFF · Đã gửi đăng ký'));
  await cards.nth(0).getByRole('checkbox').nth(1).check();await cards.nth(0).getByRole('checkbox').nth(2).check();
  await page.getByRole('button',{name:'Gửi đăng ký',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã gửi đăng ký hợp lệ'}).waitFor();
  await page.reload();await cards.first().waitFor();assert.equal(await cards.nth(0).locator('input:checked').count(),3);assert.equal((await h.sql.query('SELECT count(*)::int n FROM shift_registrations')).rows[0].n,3);
  await h.sql.query("UPDATE registration_periods SET close_at=now()-interval '1 minute'");
  await page.reload();await cards.first().waitFor();assert.equal(await morning.isDisabled(),true);assert.equal(await page.getByRole('button',{name:'Gửi đăng ký',exact:true}).isDisabled(),true);
  assert.equal(registrationWrites,3);assert.deepEqual(errors,[]);
  // Browser-only clock test: no shared database and no production/system clock changes.
  await page.evaluate(()=>localStorage.setItem('jollishift_expires_at',String(Date.parse('2035-01-01T00:00:00Z')/1000))); // fixture token only
  let simulated='2026-10-30T14:59:00+07:00';
  await page.clock.install({time:new Date(simulated)});
  await page.route('**/api/registrations/current',async route=>{const response=await route.fetch();const body=await response.json();body.server_now=simulated;body.period={...body.period,open_at:'2026-10-30T15:00:00+07:00',close_at:'2026-11-01T12:00:00+07:00',status:'PLANNED'};await route.fulfill({response,json:body});});
  await page.reload();await cards.first().waitFor();assert.equal(await morning.isDisabled(),true);
  await page.clock.fastForward(61000);assert.equal(await morning.isDisabled(),false);
  simulated='2026-11-01T11:59:00+07:00';await page.clock.setSystemTime(new Date(simulated));
  await page.reload();await cards.first().waitFor();assert.equal(await morning.isDisabled(),false);
  await page.clock.fastForward(61000);assert.equal(await morning.isDisabled(),true);
  assert.equal(registrationWrites,3);

  console.log(JSON.stringify({passed:true,automaticBrowserBoundaries:true,demo:false,registrationHttpWrites:registrationWrites,persistedAcrossReload:true,postgresRows:{preferences:3},derivedOffDays:6,auth:'isolated fixture; not Supabase Auth',database:'isolated PostgreSQL PGlite; not shared Supabase'}));
 }finally{if(browser)await browser.close();if(vite)await vite.close();await new Promise(r=>api.close(r));await h.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
