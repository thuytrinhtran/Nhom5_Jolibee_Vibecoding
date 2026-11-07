// Read-only preview. There is intentionally no CLI switch to send reminders.
const path=require('node:path');
require('dotenv').config({path:path.resolve(__dirname,'../.env')});
if(process.argv.length!==2){console.error('Usage: npm run mail:reminders:check');process.exitCode=1;}
else require('../dist/services/registration-mail.service.js').deliverRegistrationReminders({dryRun:true})
 .then(result=>console.log(JSON.stringify(result)))
 .catch(()=>{console.error('REGISTRATION_MAIL_PREVIEW_FAILED');process.exitCode=1;});
