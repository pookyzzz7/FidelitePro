// Vérifie la syntaxe de chaque <script> inline des pages HTML et des Cloud Functions.
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'syntax-'));
let failed = false;

function check(label, file) {
  const r = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (r.status !== 0) {
    failed = true;
    console.error(`FAIL ${label}\n${r.stderr}`);
  } else {
    console.log(`ok   ${label}`);
  }
}

for (const name of fs.readdirSync(root).filter(f => f.endsWith('.html'))) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  const re = /<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g;
  let m, i = 0;
  while ((m = re.exec(html))) {
    i++;
    if (!m[1].trim()) continue;
    const f = path.join(tmp, `${name}-${i}.js`);
    fs.writeFileSync(f, m[1]);
    check(`${name} script #${i}`, f);
  }
}
check('functions/index.js', path.join(root, 'functions', 'index.js'));
process.exit(failed ? 1 : 0);
