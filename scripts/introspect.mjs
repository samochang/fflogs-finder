// Introspect FFLogs v2 client schema types. Usage: node scripts/introspect.mjs TypeA TypeB ...
const body = (q) => fetch('https://www.fflogs.com/api/v2/client', {
  method: 'POST',
  headers: { Authorization: `Bearer ${process.env.TOK}`, 'Content-Type': 'application/json' },
  body: JSON.stringify({ query: q }),
}).then((r) => r.json());

const tname = (t) => (t.kind === 'NON_NULL' ? `${tname(t.ofType)}!` : t.kind === 'LIST' ? `[${tname(t.ofType)}]` : t.name);

const want = process.argv.slice(2);
const q = `{ ${want.map((t, i) => `t${i}: __type(name: "${t}") { name kind fields { name type { kind name ofType { kind name ofType { kind name ofType { kind name } } } } } }`).join(' ')} }`;
const res = await body(q);
for (const k of Object.keys(res.data ?? {})) {
  const t = res.data[k];
  if (!t) { console.log(`### ${k}: NOT FOUND`); continue; }
  console.log(`### ${t.name} (${t.kind})`);
  for (const f of t.fields ?? []) console.log(`  ${f.name}: ${tname(f.type)}`);
}
if (res.errors) console.log('ERRORS:', JSON.stringify(res.errors));
