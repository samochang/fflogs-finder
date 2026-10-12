// Dump the full FFLogs v2 client schema to scripts/_schema.json
import { readFileSync, writeFileSync } from 'node:fs';
const env = Object.fromEntries(readFileSync(new URL('../.env', import.meta.url), 'utf8').split('\n')
  .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
  .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }));
const tok = (await fetch('https://www.fflogs.com/oauth/token', {
  method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${env.FFL_CLIENT_ID}:${env.FFL_CLIENT_SECRET}`).toString('base64') }, body: 'grant_type=client_credentials',
}).then((r) => r.json())).access_token;
const q = `{ __schema { queryType { fields { name description args { name description type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name } } } }
  types { name kind description enumValues { name } fields { name description args { name description type { kind name ofType { kind name ofType { kind name } } } } type { kind name ofType { kind name ofType { kind name } } } } } } }`;
const res = await fetch('https://www.fflogs.com/api/v2/client', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` }, body: JSON.stringify({ query: q }) }).then((r) => r.json());
writeFileSync(new URL('./_schema.json', import.meta.url), JSON.stringify(res, null, 1));
console.log('errors:', JSON.stringify(res.errors ?? null), 'bytes:', JSON.stringify(res).length);
