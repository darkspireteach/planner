const fs = require('fs');
process.chdir(require('path').join(__dirname, '..'));   // run from anywhere
const {JSDOM} = require('jsdom');
const html = fs.readFileSync('index.html','utf8')
  .replace(/<link[^>]*>/g,'').replace(/<script[^>]*><\/script>/g,'').replace('<script>start();</script>','');
const dom = new JSDOM(html, {pretendToBeVisual:true});
global.window = dom.window; global.document = dom.window.document;
const mem = {};
global.localStorage = {getItem: k => k in mem ? mem[k] : null, setItem: (k,v) => mem[k]=String(v)};
document.execCommand = () => true;
const load = f => fs.readFileSync(f,'utf8');
const CSS = fs.readFileSync('styles.css','utf8');
const probe = `
loadPrefs(); wireToolbar(); wireEditor();
const fail = [];
const check = (name, ok, detail) => console.log((ok ? '  PASS  ' : '  FAIL  ') + name + (detail ? '   ' + detail : '')) || (ok || fail.push(name));

console.log('\\n--- HARD CONSTRAINTS ---');
for (const v of [false, true]) { byClass = v; for (wi of [0,1]) { render();
  const cols = new Set([...document.querySelectorAll('.dh')].map(e => e.style.gridColumn));
  if (cols.size !== 5) fail.push('week is not five columns');
} }
check('week view is always Mon-Fri, never a 7-day cycle', !fail.includes('week is not five columns'), '5 day columns in both views');

byClass = false; student = false; render();
const absCells = [...document.querySelectorAll('.abs')];
check('Attend row is never editable', absCells.every(c => !c.dataset.f), absCells.length + ' absence cells, none writable');

student = true; render();
const inPreview = document.getElementById('app').innerHTML;
check('absences never reach the student view', !document.querySelector('.abs') && !/Absent/.test(inPreview));

// no held link leaks its url to students
let leaked = 0, heldSeen = 0;
for (const w of WEEKS) for (const d of w.days) for (const b of d.blocks)
  for (const ls of [b.cw, b.hw]) for (const l of (ls||[])) if (l)
    for (const s of l.spans) if (s.url && !s.rel) { heldSeen++; if (inPreview.includes(s.url)) leaked++; }
check('held-back links carry no url in preview', leaked === 0, heldSeen + ' held links checked');

/* per line, not by scanning one week's html for another week's text —
   a private note reading "Convocation" matched "Grade 11 Convocation" */
let privLeak = 0, privSeen = 0, privSpanLeak = 0, privSpanSeen = 0;
for (const w of WEEKS) for (const d of w.days) for (const b of d.blocks)
  for (const ls of [b.cw, b.hw]) for (const l of (ls||[])) {
    if (!l) continue;
    if (l.private) { privSeen++; if (lines([l]).trim() !== '') privLeak++; }
    for (const s of l.spans) if (s.priv) {
      privSpanSeen++;
      if (s.t.trim() && lines([l]).includes(s.t)) privSpanLeak++;
    }
  }
check('private lines never reach the student view', privLeak === 0, privSeen + ' checked');
check('(( )) runs never reach the student view', privSpanLeak === 0, privSpanSeen + ' checked');

let urlLeak = 0, urlSeen = 0;
for (const w of WEEKS) for (const d of w.days) for (const b of d.blocks)
  for (const ls of [b.cw, b.hw]) for (const l of (ls||[])) if (l)
    for (const s of l.spans) if (s.url && !s.rel) { urlSeen++; if (lines([l]).includes(s.url)) urlLeak++; }
check('held urls absent from the rendered line', urlLeak === 0, urlSeen + ' checked');
student = false;

console.log('\\n--- ABSENCES ---');
absent = {'P1|9/2': ['AB: Test Student', 'T: Late Student'], 'P1|9/3': []};
wi = 0; byClass = false; student = false; render();   // 9/2 lives in the first week
check('absences appear for the teacher',
  /AB: Test Student/.test(document.getElementById('app').innerHTML));
check('each code gets its own line',
  /T: Late Student/.test(document.getElementById('app').innerHTML));
check('a day never taken stays blank', absText('2026-09-04', 1) === '');
check('absence cells are never editable',
  [...document.querySelectorAll('.cell.sub.abs')].every(c => !c.dataset.f));
student = true; render();
check('absences never reach the student view',
  !/Test Student/.test(document.getElementById('app').innerHTML));
student = false;
saveSync();
check('student names are never written to this machine',
  !/Test Student/.test(localStorage.getItem('planner.sync.v1') || ''));
absent = {}; render();

console.log('\\n--- SELF CONTAINED ---');
/* The page must load nothing from the network. A missing webfont on a school
   machine changes wrapping and density at the small sizes actually used. */
const HTML = require('fs').readFileSync('index.html', 'utf8');
const ext = [];
for (const src of [HTML, CSS]) {
  let k = src.indexOf('http');
  while (k >= 0) { ext.push(src.slice(k, k + 44)); k = src.indexOf('http', k + 4); }
}
check('no external resources', ext.length === 0, ext.join('  ') || 'nothing fetched');
check('the font ships with the app', CSS.includes('@font-face') && CSS.includes('fonts/'));

console.log('\\n--- LINE LAYOUT ---');
/* A line must never be a flex container: flex promotes every inline element to
   its own item, so a bullet holding two links, or text plus a (( )) note, gets
   laid out as side-by-side columns. It has broken twice on different content. */
const cssText = CSS;
const lineRules = cssText.split('}').filter(r => /(^|,|\\s)\\.ln\\b/.test(r.split('{')[0] || ''));
const flexy = lineRules.filter(r => /display:\\s*flex/.test(r));
check('no line is a flex container', flexy.length === 0, lineRules.length + ' rules on .ln');
const inlineHosts = ['.pvs', 'a.l', 'a.h', '.pend'];
check('inline runs stay inline',
  inlineHosts.every(sel => {
    const r = cssText.split('}').find(x => (x.split('{')[0] || '').includes(sel));
    return !r || !/display:\s*(flex|grid|block)/.test(r);
  }), inlineHosts.join(' '));

console.log('\\n--- COLOUR ---');
const seen = new Map();
for (const w of WEEKS) for (const d of w.days) for (const b of d.blocks) if (b.course) seen.set(b.period, b.course);
const hue = h => { const r=parseInt(h.slice(1,3),16), g=parseInt(h.slice(3,5),16), b=parseInt(h.slice(5,7),16);
  return (r > g + 12 && r > b + 12) ? 'red-ish' : (g > r + 12 && g > b + 12) ? 'green-ish' : 'neither'; };
const reds = [...seen.values()].filter(c => hue(c.fill) === 'red-ish').length;
const greens = [...seen.values()].filter(c => hue(c.fill) === 'green-ish').length;
check('no red/green pair carries meaning', !(reds && greens), 'red-ish ' + reds + ', green-ish ' + greens);

console.log('\\n--- DATA INTEGRITY ---');
let cells = 0, ok = 0;
for (const w of WEEKS) for (const d of w.days) for (const b of d.blocks) for (const f of ['cw','hw']) {
  const orig = b[f]; if (!orig || !orig.length) continue;
  cells++;
  const el = document.createElement('div'); el.innerHTML = editHTML(orig);
  if (JSON.stringify(cellLines(el)) === JSON.stringify(orig)) ok++;
}
check('every cell round-trips through the editor', ok === cells, ok + '/' + cells);

byClass = false; render();
const writable = [...document.querySelectorAll('.cell.sub')].filter(e => !e.classList.contains('abs'));
check('no cell looks writable without a record', writable.every(e => e.dataset.f), writable.length + ' cells');

console.log('\\n' + (fail.length ? fail.length + ' FAILED' : 'all checks passed'));
`;
global.CSS = CSS;
eval(load('data.js') + load('render.js') + load('editor.js') + load('sync.js') + probe);
