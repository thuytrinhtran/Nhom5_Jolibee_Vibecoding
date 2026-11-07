const {test}=require('node:test'),assert=require('node:assert/strict');
const {sendGoogleMail}=require('../dist/services/google-mail.service.js');
test('mail contract, concurrent dedupe, validation and controlled errors without network',async()=>{
 const saved={url:process.env.GOOGLE_SCRIPT_URL,secret:process.env.GOOGLE_MAIL_SECRET};
 process.env.GOOGLE_SCRIPT_URL='https://script.google.com/macros/s/fixture/exec';process.env.GOOGLE_MAIL_SECRET='fixture-only-secret';
 const mail={to:'qa@example.invalid',subject:'Fixture',message:'Hello'};let count=0,release;
 try{
  const send=async(url,options)=>{count++;assert.equal(url,process.env.GOOGLE_SCRIPT_URL);assert.equal(options.method,'POST');assert.deepEqual(JSON.parse(options.body),{secret:'fixture-only-secret',...mail});assert.ok(options.signal instanceof AbortSignal);await new Promise(r=>release=r);return Response.json({success:true,status:'sent'});};
  const first=sendGoogleMail(mail,send),second=sendGoogleMail(mail,send);release();assert.deepEqual(await Promise.all([first,second]),['sent','sent']);assert.equal(count,1);
  assert.equal(await sendGoogleMail(mail,async()=>Response.json({success:true,status:'duplicate'})),'duplicate');
  for(const [status,code] of Object.entries({unauthorized:'MAIL_UNAUTHORIZED',invalid_input:'MAIL_PROVIDER_INVALID_INPUT',busy:'MAIL_PROVIDER_BUSY',capacity:'MAIL_PROVIDER_CAPACITY',delivery_unknown:'MAIL_PROVIDER_DELIVERY_UNKNOWN'})) {
    await assert.rejects(sendGoogleMail(mail,async()=>Response.json({success:false,status})),{code});
  }
  for(const response of [()=>new Response('failure',{status:503}),()=>Response.json({success:false,status:'unauthorized'}),()=>new Response('<html>login</html>')])await assert.rejects(sendGoogleMail(mail,async()=>response()),e=>e.code.startsWith('MAIL_')&&!e.message.includes('fixture-only-secret'));
  await assert.rejects(sendGoogleMail(mail,async()=>new Response('<html>login</html>')),{code:'MAIL_HTML_RESPONSE'});
  await assert.rejects(sendGoogleMail(mail,async()=>new Response('not JSON')),{code:'MAIL_INVALID_JSON'});
  await assert.rejects(sendGoogleMail(mail,async()=>{throw new DOMException('fixture-only-secret','TimeoutError')}),{code:'MAIL_TIMEOUT_RESULT_UNKNOWN'});
  await assert.rejects(sendGoogleMail(mail,async()=>{throw Error('fixture-only-secret')}),{code:'MAIL_NETWORK_RESULT_UNKNOWN'});
  await assert.rejects(sendGoogleMail(mail,async()=>Response.json({success:false,status:'delivery_unknown',diagnostic:'SEND'})),{code:'MAIL_PROVIDER_DELIVERY_UNKNOWN',diagnostic:'SEND'});
  await assert.rejects(sendGoogleMail({...mail,to:'a@example.com,b@example.com'},async()=>assert.fail('No call')),{code:'MAIL_INVALID_INPUT'});
  delete process.env.GOOGLE_MAIL_SECRET;await assert.rejects(sendGoogleMail(mail,async()=>assert.fail('No call')),{code:'MAIL_NOT_CONFIGURED'});
 }finally{for(const [key,value] of [['GOOGLE_SCRIPT_URL',saved.url],['GOOGLE_MAIL_SECRET',saved.secret]])if(value===undefined)delete process.env[key];else process.env[key]=value;}
});

test('Apps Script reserves before send and survives retry/restart with durable duplicate state',()=>{
 const fs=require('node:fs'),vm=require('node:vm'),crypto=require('node:crypto');const props=new Map([['GOOGLE_MAIL_SECRET','fixture']]);let sends=0,fail=false;
 const box={ContentService:{MimeType:{JSON:'json'},createTextOutput:s=>({value:JSON.parse(s),setMimeType(){return this}})},PropertiesService:{getScriptProperties:()=>({getProperty:k=>props.get(k),getProperties:()=>Object.fromEntries(props),setProperty:(k,v)=>props.set(k,v),deleteProperty:k=>props.delete(k)})},LockService:{getScriptLock:()=>({tryLock:()=>true,hasLock:()=>true,releaseLock(){}})},Utilities:{DigestAlgorithm:{SHA_256:'sha256'},Charset:{UTF_8:'utf8'},computeDigest:(_,s)=>crypto.createHash('sha256').update(s).digest(),base64EncodeWebSafe:b=>Buffer.from(b).toString('base64url')},MailApp:{getRemainingDailyQuota:()=>100,sendEmail(){sends++;assert.ok([...props.values()].some(v=>v.includes('pending')));if(fail)throw Error('transport');}}};
 const source=fs.readFileSync(require('node:path').join(__dirname,'../../docs/google-mail-webapp.gs'),'utf8');
 const authContext=vm.createContext({...box});vm.runInContext(source,authContext);assert.equal(authContext.authorizeMail(),100);assert.equal(sends,0);
 const call=(message='fixture',secret='fixture',action)=>{const context=vm.createContext({...box});vm.runInContext(source,context);return context.doPost({postData:{contents:JSON.stringify({secret,to:'qa@example.invalid',subject:'QA',message,action})}}).value;};
 assert.equal(call().status,'sent');assert.equal(call().status,'duplicate');assert.equal(sends,1);assert.equal(call('fixture','wrong').success,false);
 fail=true;assert.equal(call('other').diagnostic,'SEND');assert.equal(call('other').diagnostic,'PENDING_PREVIOUS_ATTEMPT');assert.equal(sends,2);
 const before=JSON.stringify([...props]);assert.equal(call('', 'fixture', 'diagnose').status,'diagnostic');assert.equal(sends,2);assert.equal(JSON.stringify([...props]),before);
});
