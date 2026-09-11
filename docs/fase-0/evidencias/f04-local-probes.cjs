// Local probes over actual TS source. All credentials are generated fixtures;
// no Firebase/provider requests, dotenv loading or app writes are performed.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { Readable } = require('node:stream');
const ts = require('typescript');
const root = path.resolve(__dirname, '../../..');
const env = { FIREBASE_PROJECT_ID: 'demo-f04', GEMINI_API_KEY: 'test-placeholder', AI_PROXY_ALLOWED_MODELS: 'only-allowed-fixture' };
const calls = [];
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'local-fixture' };
const modules = new Map();
function load(rel) {
  const file = path.resolve(root, rel);
  if (modules.has(file)) return modules.get(file).exports;
  const module = { exports: {} }; modules.set(file, module);
  const output = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  function localRequire(name) {
    if (name === '@google/genai') return { GoogleGenAI: class { models = { generateContent: async (body) => { calls.push({ model: body.model }); return { text: 'mock-only' }; } }; } };
    if (name.endsWith('/services/ai/schema')) return { toGeminiSchema: x => x, toResponseFormat: x => x };
    if (name.startsWith('.')) return load(path.relative(root, path.resolve(path.dirname(file), name + '.ts')));
    if (name.startsWith('node:')) return require(name);
    throw new Error('Unexpected dependency: ' + name);
  }
  const sandbox = { module, exports: module.exports, require: localRequire, process: { env }, Buffer, console: { info() {}, warn() {}, error() {} },
    fetch: async (url) => { assert.equal(url, 'https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'); return { ok: true, json: async () => ({ keys: [jwk] }) }; } };
  vm.runInNewContext(output, sandbox, { filename: file });
  return module.exports;
}
const now = Math.floor(Date.now() / 1000);
const encoded = x => Buffer.from(JSON.stringify(x)).toString('base64url');
const unsigned = encoded({ alg: 'RS256', kid: 'local-fixture' }) + '.' + encoded({ aud: 'demo-f04', iss: 'https://securetoken.google.com/demo-f04', sub: 'unprovisioned-fixture', iat: now, exp: now + 300 });
const token = unsigned + '.' + crypto.sign('RSA-SHA256', Buffer.from(unsigned), privateKey).toString('base64url');
function request(body) { const req = Readable.from([Buffer.from(JSON.stringify(body))]); req.method = 'POST'; req.headers = { authorization: 'Bearer ' + token }; req.socket = { remoteAddress: '127.0.0.1' }; return req; }
async function invoke(file, body) { const res = { statusCode: 0, status(n) { this.statusCode = n; return this; }, json(x) { this.body = x; }, setHeader() {} }; await load(file).default(request(body), res); return res; }
(async () => {
  const auth = await load('api/_shared/authenticateProxyCaller.ts').authenticateProxyCaller(request({}));
  assert.equal(auth.allowed, true);
  console.log('PASS: correctly signed local JWT without any profile lookup is accepted (membership absent by design).');
  let res = await invoke('api/ai.ts', { model: 'forbidden-fixture', prompt: 'local' });
  assert.equal(res.statusCode, 403);
  console.log('PASS control: /api/ai explicit non-allowlisted model rejected 403.');
  res = await invoke('api/ai.ts', { prompt: 'local' });
  assert.equal(res.statusCode, 200); assert.equal(calls.at(-1).model, 'gemini-2.5-flash');
  console.log('CONFIRMED local: /api/ai omitted model bypasses configured allowlist; default model reaches MOCK provider.');
  res = await invoke('api/gemini.ts', { model: 'forbidden-fixture', contents: [] });
  assert.equal(res.statusCode, 200); assert.equal(calls.at(-1).model, 'forbidden-fixture');
  console.log('CONFIRMED local: /api/gemini arbitrary model bypasses configured allowlist and reaches MOCK provider.');
  env.AI_PROXY_ALLOW_UNAUTHENTICATED = 'true';
  const missing = request({}); missing.headers = {};
  assert.equal((await load('api/_shared/authenticateProxyCaller.ts').authenticateProxyCaller(missing)).allowed, true);
  console.log('CONFIRMED local: opt-in unauthenticated flag accepts missing bearer; production flag state NOT checked.');
  console.log('No real provider/network calls; generated signing key and token never printed; no Firestore emulator used.');
})().catch(error => { console.error(error.name + ': probe failed'); process.exitCode = 1; });
