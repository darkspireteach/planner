/* Runs the audit, then every behaviour test. Exits non-zero if any fail. */
const {execFileSync} = require('child_process');
const fs = require('fs');

const files = ['audit.js'].concat(
  fs.readdirSync(__dirname).filter(f => /^test-.*\.js$/.test(f)).sort());

let bad = [];
for (const f of files) {
  try {
    execFileSync(process.execPath, [f], {cwd: __dirname, stdio: 'pipe'});
    process.stdout.write('  ok   ' + f + '\n');
  } catch (err) {
    bad.push(f);
    process.stdout.write('  FAIL ' + f + '\n');
    process.stdout.write(String(err.stdout || '').split('\n').slice(-6).join('\n') + '\n');
  }
}
console.log('\n' + (files.length - bad.length) + '/' + files.length + ' passed');
process.exit(bad.length ? 1 : 0);
