const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
const {spawnSync} = require('node:child_process');
const root = path.resolve(__dirname, '..');
const names = fs.readdirSync(root);
for (const name of names.filter(n => n.endsWith('.js'))) {
  const result = spawnSync(process.execPath, ['--check', path.join(root, name)], {encoding:'utf8'});
  assert.equal(result.status, 0, result.stderr);
}
for (const name of ['index.html', 'mobile.html', 'desktop.html']) {
  const html = fs.readFileSync(path.join(root, name), 'utf8');
  for (const [,ref] of html.matchAll(/(?:src|href)="([^"#]+\.(?:css|js|html))"/g)) {
    assert(fs.existsSync(path.join(root, ref)), `${name}: missing ${ref}`);
  }
}
const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
assert(/transactions:\s*\[\]/.test(app));
assert(/const DEFAULT_FIXED = \{\};/.test(app));
assert(/const TOTAL_CAP = 0;/.test(app));
const forbidden = /initialLedgerData|libfile_|wangyijie509|jiewer-monthly-budget|乖乖|t3913388531605183400/;
for (const name of names.filter(n => /\.(html|js|css)$/.test(n))) {
  assert(!forbidden.test(fs.readFileSync(path.join(root, name),'utf8')), `Private data marker: ${name}`);
}
assert(!names.includes('my-ledger.html'));
assert(!names.includes('personal-ledger.js'));
console.log('Passed: script syntax, entry resources, empty defaults and private-data markers.');
