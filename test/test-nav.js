const fs = require('fs');
process.chdir(require('path').join(__dirname, '..'));   // run from anywhere
const {JSDOM} = require('jsdom');
const html = fs.readFileSync('index.html','utf8')
  .replace(/<link[^>]*>/g,'').replace(/<script[^>]*><\/script>/g,'').replace('<script>start();</script>','');
const dom = new JSDOM(html, {pretendToBeVisual:true});
global.window = dom.window; global.document = dom.window.document;
global.localStorage = {getItem:()=>null, setItem:()=>{}};
document.execCommand = () => true;
const load = f => fs.readFileSync(f,'utf8');
const probe = `
loadPrefs(); wireToolbar(); wireEditor(); render();
const tap = (k, opts={}) => {
  const ev = new window.KeyboardEvent('keydown', {key:k, bubbles:true, cancelable:true, ...opts});
  document.body.dispatchEvent(ev);
  return ev.defaultPrevented;
};
const where = () => { const c = current(); return c ? c.dataset.h + ':' + c.dataset.f : 'none'; };

const cells = [...document.querySelectorAll('.cell.sub[data-f]')];
select(cells[0]);
console.log('start          :', where());
tap('ArrowDown');  console.log('down           :', where());
tap('ArrowRight'); console.log('right          :', where());
tap('ArrowUp');    console.log('up             :', where());
tap('ArrowLeft');  console.log('left  (back)   :', where());

// return opens, return closes and keeps the cell selected
tap('Enter');
console.log('enter opens    :', editing === current(), '| editing', !!editing);
const openOn = where();
tap('Enter');
console.log('enter closes   :', !editing, '| still selected on', where() === openOn);

// a modifier + return is left alone, so the browser inserts a line
tap('Enter');
console.log('reopened       :', !!editing);
for (const mod of ['shiftKey','ctrlKey','metaKey']) {
  const prevented = tap('Enter', {[mod]: true});
  console.log((mod.replace('Key','') + '+enter makes a line').padEnd(31, ' '), ':', !prevented);
}
console.log('alt+enter leaves the cell'.padEnd(31), ':', tap('Enter', {altKey:true}) && !editing);
console.log('still editing  :', !!editing);

// tab steps in reading order
closeCell(); select(cells[0]);
const a = where(); tap('Tab'); const b = where(); tap('Tab', {shiftKey:true});
console.log('tab moves on   :', b !== a, '| shift-tab returns:', where() === a);

// arrows inside an open cell are left to the caret
openCell(cells[0]);
const before = where();
console.log('arrow while editing is not navigation:', !tap('ArrowRight') && where() === before);
`;
eval(load('data.js') + load('test/fixture.js') + load('render.js') + load('editor.js') + probe);
