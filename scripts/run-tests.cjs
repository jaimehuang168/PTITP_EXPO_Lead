const fs = require('node:fs');
const {spawnSync} = require('node:child_process');
const files = fs.readdirSync('.').filter(f=>/^test_.*\.js$/.test(f)).sort();
let failures = 0;
for (const file of files) {
  const result = spawnSync(process.execPath,[file],{encoding:'utf8',timeout:30000});
  const ok = result.status === 0;
  console.log(`${ok?'PASS':'FAIL'} ${file}`);
  if(!ok){failures++; console.error(result.stdout, result.stderr, result.error||'');}
}
console.log(`${files.length-failures}/${files.length} test files passed`);
process.exitCode = failures ? 1 : 0;
