// Ad-hoc FFLogs v2 query runner. Usage: node scripts/gql.mjs '<graphql query>' [outfile]
import { readFileSync, writeFileSync } from 'node:fs';
const env = Object.fromEntries(
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .split('\n').filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^"|"$/g, '')]; }),
);
const tok = env.FFL_TOKEN || (await fetch('https://www.fflogs.com/oauth/token', {
  method: 'POST',
  headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: 'Basic ' + Buffer.from(`${env.FFL_CLIENT_ID}:${env.FFL_CLIENT_SECRET}`).toString('base64') },
  body: 'grant_type=client_credentials',
}).then((r) => r.json())).access_token;
const res = await fetch('https://www.fflogs.com/api/v2/client', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${tok}` },
  body: JSON.stringify({ query: process.argv[2] }),
}).then((r) => r.json());
const out = JSON.stringify(res);
if (process.argv[3]) { writeFileSync(process.argv[3], JSON.stringify(res, null, 1)); console.log('wrote', process.argv[3], out.length, 'bytes'); }
else console.log(out);
