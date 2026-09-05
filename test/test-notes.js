/* Day notes at the top of a column: editable, undoable, and synced like cells. */
const fs = require('fs');
process.chdir(require('path').join(__dirname, '..'));   // run from anywhere
const {JSDOM} = require('jsdom');
const html = fs.readFileSync('index.html','utf8')
  .replace(/<link[^>]*>/g,'').replace(/<script[^>]*><\/script>/g,'').replace('<script>start();</script>','');
const dom = new JSDOM(html, {pretendToBeVisual:true});
global.window = dom.window; global.document = dom.window.document;
const mem = {};
global.localStorage = {getItem: k => k in mem ? mem[k] : null, setItem: (k,v) => mem[k]=String(v)};
Object.defineProperty(globalThis, 'navigator', {value:{platform:'Test'}, configurable:true});
document.execCommand = () => false;
const pushed = [];
global.fetch = async (url, opt) => {
  const req = JSON.parse(opt.body);
  if (req.action === 'push') { pushed.push(...req.records.map(r => r.key));
    return {json: async () => ({ok:true, now:new Date().toISOString(),
      saved: req.records.map(r => ({key:r.key, updatedAt:new Date().toISOString()})), conflicts:[]})}; }
  return {json: async () => ({ok:true, now:new Date().toISOString(), records:[], byTag:{}})};
};
const load = f => fs.readFileSync(f,'utf8');
const probe = `
loadPrefs(); wireToolbar(); wireEditor(); render();
loadSync(); cfg.url='https://fake/exec'; cfg.token='good';

(async () => {
  console.log('weeks available     :', WEEKS.length);
  console.log('first / last        :', WEEKS[0].label, '->', WEEKS[WEEKS.length-1].label);

  // arrows stop rather than wrap
  wi = 0; render();
  console.log('prev disabled at start:', document.getElementById('prev').disabled);
  document.getElementById('prev').click();
  console.log('prev does nothing     :', wi === 0);
  wi = WEEKS.length - 1; render();
  console.log('next disabled at end  :', document.getElementById('next').disabled);
  document.getElementById('next').click();
  console.log('next does nothing     :', wi === WEEKS.length - 1);

  // the note is editable
  wi = 1; render();
  const note = document.querySelector('.dhnote[data-f=note]');
  console.log('');
  console.log('note field exists     :', !!note);
  const before = note.textContent;
  openCell(note);
  console.log('opens for editing     :', editing === note);
  note.dispatchEvent(new window.InputEvent('beforeinput',
    {bubbles:true, cancelable:true, inputType:'insertText', data:'D'}));   // as typing would
  note.innerHTML = '<div class="ln">Dept meeting 3-4</div>';
  closeCell();
  console.log('saved to the day      :', WEEKS[1].days.some(d => (d.noteLines||[]).some(l => l && l.spans[0].t === 'Dept meeting 3-4')));
  await new Promise(r => setTimeout(r, 20));
  console.log('pushed as a record    :', pushed.some(k => /\\|day\\|note$/.test(k)), pushed.filter(k=>/day\\|note/.test(k))[0]);

  // undo reaches it
  stepBack();
  console.log('undo restores it      :', document.querySelector('.dhnote[data-f=note]').textContent === before);

  // students never see notes
  student = true; render();
  console.log('hidden from students  :', !document.querySelector('.dhnote'));
  student = false; render();
})();
`;
eval(load('data.js') + load('test/fixture.js') + load('render.js') + load('editor.js') + load('sync.js') + probe);
