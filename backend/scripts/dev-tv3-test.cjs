const {spawn}=require('node:child_process');
// Explicit opt-in, process-local settings only. Never edit .env or seed Supabase.
const child=spawn(process.execPath,[require.resolve('tsx/cli'),'watch','src/server.ts'],{
  stdio:'inherit',env:{...process.env,NODE_ENV:'development',SCHEDULING_DATA_SOURCE:'mock',SCHEDULING_MOCK_SCENARIO:'tv3-flow'},
});
child.on('error',()=>{console.error('Cannot start TV3 test server. Check backend dependencies.');process.exitCode=1;});
child.on('exit',code=>{process.exitCode=code??1;});

// Explicit launch helper never rewrites environment files or silently switches a normal server.
