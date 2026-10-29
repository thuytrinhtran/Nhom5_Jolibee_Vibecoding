const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const ts = require('typescript');

function provider(service) {
  const states = [], effects = [];
  let index = 0, api;
  const react = {
    createContext: () => ({ Provider: 'provider' }),
    useState: value => { const i = index++; states[i] = value; return [value, next => { states[i] = next; }]; },
    useRef: value => ({ current: value }),
    useEffect: callback => { effects.push(callback); },
    createElement: (_component, props) => { api = props.value; },
  };
  react.default = react;
  class ApiError extends Error { constructor(message,status){super(message);this.status=status;} }
  const context = { exports: {}, require: name => name === 'react' ? react : { authService: service, ApiError } };
  const code = ts.transpileModule(fs.readFileSync('src/context/AuthContext.tsx','utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  vm.runInNewContext(code,context);
  context.exports.AuthProvider({ children: null });
  return { api, states, effects };
}
const deferred = () => { let resolve, reject; const promise = new Promise((a,b)=>{resolve=a;reject=b;}); return {promise,resolve,reject}; };
test('late init, refresh and password change cannot restore user after logout', async () => {
  for (const operation of ['init','refreshUser','changePassword']) {
    const pending = deferred();
    const { api,states,effects } = provider({ getStoredToken:()=> 'fixture',getMe:()=>pending.promise,changePassword:()=>pending.promise,logout:async()=>{} });
    const work = operation === 'init' ? effects[0]() : api[operation]('','');
    await api.logout();
    pending.resolve({ id: 'old' }); await work;
    await new Promise(resolve=>setImmediate(resolve));
    assert.equal(states[0],null,operation);
  }
});
test('late logout completion cannot clear a newly logged in user', async () => {
  const pending=deferred();const profile={id:'new'};
  const {api,states}=provider({logout:()=>pending.promise,login:async()=>({user:profile})});
  const logout=api.logout(); await api.login('',''); pending.resolve(); await logout;
  assert.equal(states[0],profile); assert.equal(states[1],false);
});
