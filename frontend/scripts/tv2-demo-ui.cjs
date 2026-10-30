// Browser-only fixtures; all /api requests are intercepted, never forwarded to Supabase.
const assert=require('node:assert/strict');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os');
const {chromium}=require(process.env.REGISTRATION_PLAYWRIGHT_PATH||path.join(os.tmpdir(),'jollishift-ui-test/node_modules/playwright-core'));
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.TV2_BROWSER_PATH||'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',headless:true});
 const page=await browser.newPage({viewport:{width:1366,height:768}});
 const errors=[],registrationCalls=[];
 page.on('pageerror',e=>errors.push(e.message));page.on('dialog',dialog=>dialog.accept());
 const user={id:'browser-demo-fixture',username:'browser_fixture',email:'fixture@example.invalid',role:'NV',branch_id:'fixture-branch',branch_name:'Fixture branch',is_active:true,must_change_password:false,employee:{id:'fixture-employee',full_name:'Fixture employee',department_name:'Fixture department',skill_level:'REGULAR'}};
 await page.route('**/api/**',async route=>{
  const req=route.request();
  if(req.url().includes('/api/registrations'))registrationCalls.push(req.url());
  if(req.url().endsWith('/api/auth/me')&&req.method()==='GET')return route.fulfill({json:{status:'ok',user}});
  return route.fulfill({status:400,json:{status:'error',message:'Blocked by isolated browser fixture'}});
 });
 await page.addInitScript(()=>{localStorage.setItem('jollishift_access_token','isolated-browser-fixture');localStorage.setItem('jollishift_expires_at',String(Math.floor(Date.now()/1000)+3600));});
 const dir=path.join(os.tmpdir(),'jollishift-tv2-ui');fs.mkdirSync(dir,{recursive:true});
 try{
  await page.goto(process.env.TV2_DEMO_URL||'http://localhost:5173/employee/register');
  await page.getByText('DEMO – dữ liệu giả lập',{exact:true}).waitFor();
  await page.locator('.reg-days fieldset').first().waitFor();
  assert.equal(await page.locator('.reg-days fieldset').count(),7);
  const initial=await page.locator('.registration').evaluate(el=>({height:Math.round(el.getBoundingClientRect().height),actionsBottom:Math.round(el.querySelector('.reg-actions').getBoundingClientRect().bottom)}));
  const day=page.locator('.reg-days fieldset').first(),boxes=day.getByRole('checkbox');
  for(let i=0;i<3;i++)await boxes.nth(i).check();
  assert.equal(await day.locator('input:checked').count(),3);
  await page.getByRole('button',{name:'Lưu nháp',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã lưu nháp'}).waitFor();
  assert.ok((await page.locator('.reg-days fieldset').nth(1).textContent()).includes('Chưa gửi đăng ký'));
  await page.getByRole('button',{name:'Gửi đăng ký',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã gửi đăng ký hợp lệ'}).waitFor();
  assert.ok((await page.locator('.reg-days fieldset').nth(1).textContent()).includes('OFF · Đã gửi đăng ký'));
  await boxes.nth(2).uncheck();await page.getByRole('button',{name:'Gửi đăng ký',exact:true}).click();await page.getByRole('status').filter({hasText:'Đã gửi đăng ký hợp lệ'}).waitFor();
  const layout=[];
  for(const [width,height,columns] of [[1366,768,4],[1024,768,2],[390,844,1]]){
   await page.setViewportSize({width,height});
   const metrics=await page.locator('.reg-days').evaluate(grid=>({columns:getComputedStyle(grid).gridTemplateColumns.split(' ').length,overflow:document.documentElement.scrollWidth>innerWidth,rows:[...new Set([...grid.children].map(c=>Math.round(c.getBoundingClientRect().top)))].length,registrationHeight:Math.round(document.querySelector('.registration').getBoundingClientRect().height)}));
   assert.equal(metrics.columns,columns);assert.equal(metrics.overflow,false);layout.push({width,height,...metrics});
   await page.evaluate(()=>window.scrollTo(0,0));
   await page.screenshot({path:path.join(dir,`registration-${width}.png`),fullPage:true});
  }
  await page.setViewportSize({width:1366,height:768});
  await page.locator('.reg-demo summary').click();
  await page.getByRole('button',{name:'Đặt lại DEMO',exact:true}).click();
  await page.getByRole('button',{name:'Gửi đăng ký',exact:true}).click();
  await page.getByRole('status').filter({hasText:'Đã gửi đăng ký hợp lệ'}).waitFor();
  assert.equal(await page.locator('.reg-badge').textContent(),'Hợp lệ');
  assert.equal(await page.locator('.reg-day-state').filter({hasText:'OFF · Đã gửi đăng ký'}).count(),7);
  await page.getByRole('button',{name:'Mô phỏng đóng đợt',exact:true}).click();
  assert.equal(await boxes.nth(0).isDisabled(),true);
  assert.equal(await page.getByRole('button',{name:'Lưu nháp',exact:true}).isDisabled(),true);
  await page.getByRole('button',{name:'Đặt lại DEMO',exact:true}).click();
  assert.equal(await boxes.nth(0).isDisabled(),false);
  assert.deepEqual(registrationCalls,[]);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({passed:true,initial,layout,registrationApiCalls:registrationCalls.length,screenshots:dir}));
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
