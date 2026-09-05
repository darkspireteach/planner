/* Rendering. WEEKS (data.js) is the model — editor.js mutates it in place. */

const SIZES = [10, 11, 12.5, 14, 16];
const COLOUR = ['header', 'tinted', 'full'];
let wi = 0, si = 2, ci = 1, byClass = false, hidePrep = false, student = false, tight = false;

/* three rules, drawn close or far apart — the button shows the spacing you get */
const LINES = t => '<svg viewBox="0 0 16 16">' +
  (t ? '<path d="M2 5h12M2 8h12M2 11h12"/>' : '<path d="M2 3h12M2 8h12M2 13h12"/>') + '</svg>';
const off = new Set();                       // periods switched off
const shown = p => !off.has(p);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/* every course in the file, so the switches don't move week to week */
const ALL = (() => {
  const m = new Map();
  for (const w of WEEKS) for (const d of w.days) for (const b of d.blocks)
    if (b.course) m.set(b.period, b.course);
  return [...m.keys()].sort((a, z) => a - z).map(p => [p, m.get(p)]);
})();

/* Day notes start life as the plain string the sheet had; from here they are
   records like any other cell, so they can be edited and synced. */
for (const w of WEEKS) for (const d of w.days) {
  if (d.noteLines === undefined) {
    // on a day with no school the note IS the reason, so there is one field to
    // edit rather than two that mean nearly the same thing
    const seed = d.cycle ? d.note : (d.off || d.note);
    d.noteLines = seed
      ? [{bullet: false, private: false, spans: [{t: seed, url: null, rel: false, priv: false}]}]
      : null;
  }
}

/** the plain text of a day's note, used as the off-day label */
function noteText(d) {
  if (!d.noteLines) return d.cycle ? '' : (d.off || '');
  return d.noteLines.filter(Boolean).map(l => l.spans.map(s => s.t).join('')).join(' ').trim();
}

/* Monday of the week we're actually in, as YYYY-MM-DD */
function mondayISO() {
  const d = new Date(); d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  const p = n => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* Hold the label box open at the width of the longest label in the file. */
let sized = false;
function sizeWeekLabel() {
  if (sized) return;
  const box = document.getElementById('wksizer');
  if (!box) return;
  let longest = '';
  for (const w of WEEKS) {
    const t = 'This week \u00b7 ' + w.label;
    if (t.length > longest.length) longest = t;
  }
  box.innerHTML = '<b>This week</b> \u00b7 ' + esc(longest.replace(/^This week \u00b7 /, ''));
  sized = true;
}

function tintOf(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  const f = i => Math.round(255 + ((n >> i & 255) - 255) * k);
  return `rgb(${f(16)},${f(8)},${f(0)})`;
}
const bodyBG = c => ci === 0 ? '' : `background:${tintOf(c.fill, ci === 1 ? .55 : 1)};`;

function roster(w) {
  const seen = new Map();
  for (const d of w.days) for (const b of d.blocks)
    if (b.course && shown(b.period)) seen.set(b.period, b.course);
  return [...seen.keys()].sort((a, z) => a - z).map(p => [p, seen.get(p)]);
}

/* ---------- lines -> html ---------- */

function lineHTML(l) {
  if (!l) return '<div class="ln"><br></div>';
  // one wrapper per (( )) run, not per span, so the brackets the CSS draws
  // appear once around the whole note rather than around every fragment
  let inner = '', inPriv = false;
  for (const s of l.spans) {
    if (s.priv && student) continue;                 // (( )) never reaches students
    if (s.priv && !inPriv) { inner += '<span class="pvs">'; inPriv = true; }
    else if (!s.priv && inPriv) { inner += '</span>'; inPriv = false; }
    const t = esc(s.t) || '&nbsp;';
    if (!s.url) { inner += t; continue; }
    if (s.rel) inner += `<a class="l" href="${s.url}" data-u="${s.url}" data-r="1">${t}</a>`;
    // preview only: a held link reads as plain text, with a faint rule so it can
    // still be found. The generated student page emits no marker at all.
    else if (student) inner += `<span class="pend">${t}</span>`;
    else inner += `<a class="h" href="${s.url}" data-u="${s.url}" data-r="0">${t}</a>`;
  }
  if (inPriv) inner += '</span>';
  if (student && !inner.trim()) return '';           // nothing left once hidden
  return `<div class="ln${l.bullet ? ' b' : ''}${l.private ? ' pv' : ''}"` +
         `${l.bullet ? ' data-b="1"' : ''}${l.private ? ' data-p="1"' : ''}>${inner || '<br>'}</div>`;
}

function lines(ls) {
  if (!ls || !ls.length) return '';
  return ls.filter(l => !(student && l && l.private)).map(lineHTML).join('');   // '//' lines
}

/* Absences are held in memory by sync.js and never stored on this machine.
   Teacher-only: the rows they sit in are not drawn in the student view. */
function absText(iso, period) {
  if (typeof absent === 'undefined' || !absent || !iso) return '';
  const p = iso.split('-');
  const v = absent['P' + period + '|' + (+p[1]) + '/' + (+p[2])];
  if (!v) return '';                     // attendance not taken: say nothing
  return v.map(t => `<div class="ln${t === 'All here' ? ' allhere' : ''}">${esc(t)}</div>`).join('');
}

function held(b) {
  let n = 0;
  for (const ls of [b.cw, b.hw])
    for (const l of (ls || [])) if (l && !l.private)
      for (const s of l.spans) if (s.url && !s.rel && !s.priv) n++;
  return n;
}
const heldTag = b => { const n = held(b); return (n && !student) ? `<span class="heldn">${n} held</span>` : ''; };

/* ---------- grid ---------- */

const P = [];
const put = (col, row, span, cls, style, html, attrs) =>
  P.push(`<div class="${cls}" style="grid-column:${col};grid-row:${row}/span ${span};${style || ''}"` +
         `${attrs || ''}>${html || ''}</div>`);

/* which record a cell edits */
const key = (w, d, bi) => `${w}.${d}.${bi}`;
const ref = (w, d, bi, f) => ` data-w="${w}" data-d="${d}" data-bi="${bi}" data-f="${f}"` +
                             ` data-h="${key(w, d, bi)}"`;

function render() {
  const w = WEEKS[wi];
  document.documentElement.style.setProperty('--fs', SIZES[si] + 'px');
  document.documentElement.style.setProperty('--lh', tight ? '1.25' : '1.4');
  document.getElementById('tight').innerHTML = LINES(!tight);
  sizeWeekLabel();
  document.getElementById('wklabel').innerHTML =
    (w.mon === mondayISO() ? '<b>This week</b> \u00b7 ' : '') + w.label;
  document.getElementById('colour').textContent = 'Colour: ' + COLOUR[ci];
  document.getElementById('prev').disabled = wi === 0;
  document.getElementById('next').disabled = wi === WEEKS.length - 1;
  document.getElementById('tview').textContent = byClass ? 'By schedule' : 'By class';
  document.getElementById('tstu').textContent = student ? 'Teacher view' : 'Student view';
  document.body.classList.toggle('ed-off', student);

  const cbar = document.getElementById('classbar');
  cbar.innerHTML = '<b>Classes</b>' + ALL.map(([p, c]) =>
    `<button class="cb" data-p="${p}" aria-pressed="${shown(p)}"` +
    (shown(p) ? ` style="background:${c.fill};color:${c.ink}"` : '') +
    `>${c.sym}\u00A0${c.tag}</button>`).join('') +
    (byClass ? '' : `<button class="cb" data-p="prep" aria-pressed="${!hidePrep}"` +
      (hidePrep ? '' : ` style="background:var(--rail);color:var(--slate)"`) + `>Prep</button>`) +
    `<span id="hint">${student ? 'Read-only preview' : 'Click a cell to write \u00b7 paste a URL onto selected words'}</span>`;

  P.length = 0;
  put(1, 1, 1, 'corner');
  w.days.forEach((d, i) => put(i + 2, 1, 1, 'dh', '',
    `<b>${d.d}</b><span>${d.cycle ? 'Day ' + d.cycle : esc(noteText(d) || 'No school')}</span>` +
    (student ? '' : `<div class="dhnote" data-w="${wi}" data-d="${i}" ` +
      `data-f="note" data-h="${wi}.${i}.n">${lines(d.noteLines)}</div>`)));

  let r = 2;
  if (byClass) {
    for (const [per, c] of roster(w)) {
      // a course that picks up ASP any day this week gets its own row for it,
      // so every day keeps the same rows and the columns stay aligned
      const hasAsp = w.days.some(d => d.cycle &&
        d.blocks.some(b => b.period === per && b.block === 'ASP') &&
        d.blocks.some(b => b.period === per && b.block !== 'ASP'));
      // ASP sits below the absence line, which separates it from the block
      const absRow = student ? -1 : 3;
      const aspRow = hasAsp ? (student ? 3 : 4) : -1;
      const rowsN = 3 + (hasAsp ? 1 : 0) + (student ? 0 : 1);
      put(1, r, 1, 'rc bt', `background:${c.fill};color:${c.ink}`, `<b>${c.sym} ${c.tag}</b>`);
      put(1, r + 1, 1, 'rl', '', 'Class work');
      put(1, r + 2, 1, 'rl', '', 'Homework');
      if (absRow > 0) put(1, r + absRow, 1, 'rl', '', 'Absent');
      if (aspRow > 0) put(1, r + aspRow, 1, 'rl asp-lbl', '', 'ASP');
      w.days.forEach((d, di) => {
        const col = di + 2;
        const idx = d.cycle ? d.blocks.map((b, i) => [b, i]).filter(([b]) => b.period === per) : [];
        if (!idx.length) {
          put(col, r, rowsN, 'cell off bt', '', d.cycle ? '' : `<div class="offtag">${esc(noteText(d) || 'No school')}</div>`);
          return;
        }
        const [main, mi] = idx.find(([b]) => b.block !== 'ASP') || idx[0];
        const other = idx.find(([b]) => b.block !== main.block);
        put(col, r, 1, 'chd bt', `background:${c.fill};color:${c.ink}`,
            `${heldTag(main)}<span class="tg">${c.sym}\u00A0${c.tag}</span> ` +
            `<span class="nm">${c.name} &middot; ${main.block}</span>`,
            ` data-h="${key(wi, di, mi)}"`);
        put(col, r + 1, 1, 'cell sub', bodyBG(c), lines(main.cw), ref(wi, di, mi, 'cw'));
        put(col, r + 2, 1, 'cell sub', bodyBG(c), lines(main.hw), ref(wi, di, mi, 'hw'));
        // no ASP for this course today: grey, like any period that doesn't run.
        // Left tinted it looked identical to an empty cell you could write in.
        if (absRow > 0) put(col, r + absRow, 1, 'cell sub abs', bodyBG(c),
                           absText(d.iso, main.period));
        if (aspRow > 0) {
          if (other) put(col, r + aspRow, 1, 'cell sub asp-row', bodyBG(c),
                         lines(other[0].cw), ref(wi, di, other[1], 'cw'));
          else put(col, r + aspRow, 1, 'cell off asp-row', '', '');
        }
      });
      r += rowsN;
    }
  } else {
    WEEKS[0].days[2].blocks.forEach((proto, bi) => {
      const isAsp = proto.block === 'ASP';
      const last = isAsp ? 2 : 3;
      const span = last + (student ? 0 : 1);
      if (hidePrep && !w.days.some(d => d.blocks[bi] && d.blocks[bi].course && shown(d.blocks[bi].period))) return;
      put(1, r, 1, 'rb bt', '', `<b>${proto.block}</b>`);
      put(1, r + 1, 1, 'rl', '', isAsp ? 'Notes' : 'Class work');
      if (!isAsp) put(1, r + 2, 1, 'rl', '', 'Homework');
      if (!student) put(1, r + last, 1, 'rl', '', 'Absent');
      w.days.forEach((d, di) => {
        const col = di + 2;
        if (!d.cycle) {
          put(col, r, span, 'cell off bt', '', bi === 0 ? `<div class="offtag">${esc(noteText(d) || 'No school')}</div>` : '');
          return;
        }
        const b = d.blocks[bi], c = b.course;
        if (c && !shown(b.period)) {                 // a class switched off
          put(col, r, span, 'cell prep bt', '', '');
          return;
        }
        if (!c) {                                    // a free period
          if (hidePrep || student) { put(col, r, span, 'cell prep bt', '', ''); return; }
          // a header and a box: meetings and duties land in these blocks too
          put(col, r, 1, 'chd prephd bt', '',
              `<span class="tg">P${b.period}</span> <span class="nm">Prep</span>`);
          put(col, r + 1, span - 1, 'cell sub prepbox', '',
              lines(b.prep), ref(wi, di, bi, 'prep'));
          return;
        }
        put(col, r, 1, 'chd bt', `background:${c.fill};color:${c.ink}`,
            `${heldTag(b)}<span class="tg">${c.sym}\u00A0${c.tag}</span> <span class="nm">${c.name}</span>`,
            ` data-h="${key(wi, di, bi)}"`);
        put(col, r + 1, 1, 'cell sub', bodyBG(c), lines(b.cw), ref(wi, di, bi, 'cw'));
        if (!isAsp) put(col, r + 2, 1, 'cell sub', bodyBG(c), lines(b.hw), ref(wi, di, bi, 'hw'));
        // one attendance mark per class per day, so ASP borrows the block's
        if (!student) put(col, r + last, 1, 'cell sub abs', bodyBG(c),
                          absText(d.iso, b.period));
      });
      r += span;
    });
  }
  document.getElementById('app').innerHTML = '<div class="grid">' + P.join('') + '</div>';
  if (typeof restoreSelection === 'function') restoreSelection();
  savePrefs();
}

/* ---------- preferences, per machine ---------- */

const PREFS = 'planner.view.v1';
function savePrefs() {
  try {
    localStorage.setItem(PREFS, JSON.stringify(
      {si, ci, byClass, student, tight, hidePrep, off: [...off]}));
  } catch (e) { /* storage unavailable */ }
}
function loadPrefs() {
  try {
    const p = JSON.parse(localStorage.getItem(PREFS) || '{}');
    if (Number.isInteger(p.si) && p.si >= 0 && p.si < SIZES.length) si = p.si;
    if (Number.isInteger(p.ci) && p.ci >= 0 && p.ci < COLOUR.length) ci = p.ci;
    byClass = !!p.byClass; student = !!p.student;
    tight = !!p.tight; hidePrep = !!p.hidePrep;
    if (Array.isArray(p.off)) p.off.forEach(x => off.add(+x));
  } catch (e) { /* unreadable */ }
}

/* ---------- toolbar ---------- */

function wireToolbar() {
  const on = (id, fn) => document.getElementById(id).onclick = e => { fn(e.currentTarget); render(); };
  on('prev', () => wi = Math.max(0, wi - 1));
  on('next', () => wi = Math.min(WEEKS.length - 1, wi + 1));
  on('smaller', () => si = Math.max(0, si - 1));
  on('bigger', () => si = Math.min(SIZES.length - 1, si + 1));
  on('colour', () => ci = (ci + 1) % COLOUR.length);
  on('tview', () => byClass = !byClass);
  on('tstu', () => student = !student);
  on('tight', el => {
    const v = el.getAttribute('aria-pressed') !== 'true';
    el.setAttribute('aria-pressed', v); tight = v;
  });
  document.getElementById('classbar').addEventListener('click', e => {
    const b = e.target.closest('.cb');
    if (!b) return;
    if (b.dataset.p === 'prep') { hidePrep = !hidePrep; render(); return; }
    const p = +b.dataset.p;
    off.has(p) ? off.delete(p) : off.add(p);
    render();
  });

  const bar = document.getElementById('bar');
  document.addEventListener('mouseover', e => {
    const a = e.target.closest('a[data-u]');
    if (!a) { bar.classList.remove('on'); return; }
    bar.querySelector('b').textContent = a.dataset.r === '1' ? 'Released' : 'Not released';
    bar.querySelector('span').textContent = a.dataset.u;
    bar.classList.add('on');
  });
}

function start() {
  loadPrefs();
  const i = WEEKS.findIndex(w => w.mon === mondayISO());
  if (i >= 0) wi = i;
  wireToolbar();
  wireEditor();
  render();
  if (typeof wireSync === 'function') wireSync();
}
