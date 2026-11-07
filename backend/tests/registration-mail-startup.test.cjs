const {test}=require('node:test'),assert=require('node:assert/strict'),net=require('node:net'),cp=require('node:child_process'),path=require('node:path');
test('Express startup exposes enabled worker health using loopback-only database, no email',async()=>{
 const socket=net.createServer();await new Promise(r=>socket.listen(0,'127.0.0.1',r));const port=socket.address().port;await new Promise(r=>socket.close(r));
 const child=cp.spawn(process.execPath,[path.resolve(__dirname,'../dist/server.js')],{cwd:path.resolve(__dirname,'..'),windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...process.env,NODE_ENV:'production',PORT:String(port),SUPABASE_URL:'http://127.0.0.1:9',SUPABASE_SECRET_KEY:'isolated-startup-fixture',EMAIL_NOTIFICATIONS_ENABLED:'true',GOOGLE_SCRIPT_URL:'',GOOGLE_MAIL_SECRET:'',TV3_AI_EXTERNAL_ENABLED:'false'}});
 let logs='';child.stdout.on('data',v=>logs+=v);child.stderr.on('data',()=>{});
 try{
  let body;
  for(let i=0;i<80;i++){try{const r=await fetch(`http://127.0.0.1:${port}/api/health`);if(r.ok){body=await r.json();break;}}catch{}await new Promise(r=>setTimeout(r,50));}
  assert.equal(body?.status,'ok');assert.equal(body.registration_mail.enabled,true);assert.equal(body.registration_mail.started,true);
  assert.ok(body.registration_mail.last_checked_at);assert.ok(logs.includes('worker started'));
  assert.ok(!JSON.stringify(body).includes('GOOGLE_MAIL_SECRET'));
 }finally{child.kill();await new Promise(r=>child.exitCode!==null?r():child.once('exit',r));}
});
