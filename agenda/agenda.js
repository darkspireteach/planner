/* The student agenda.
 *
 * Renders whatever the endpoint publishes and nothing else. There is no
 * filtering here on purpose: held links arrive with no url and private notes
 * never arrive at all, because a page can be read by anyone who opens it.
 *
 * A span becomes a link only if it carries a url. Text alone stays text.
 */

const esc = s => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function spanHTML(s) {
  const t = esc(s.t);
  if (s.url) return `<a href="${esc(s.url)}" target="_blank" rel="noopener">${t}</a>`;
  // held back: shown the way it looks in the planner's own student view, so a
  // student can see something is coming. Never a link, and no address exists
  // in this payload to make one from.
  if (s.held) return `<span class="held">${t}</span>`;
  return t;
}

function linesHTML(ls) {
  if (!ls || !ls.length) return '';
  return ls.map(l => {
    if (!l) return '<div class="gap"></div>';
    return `<p class="ln${l.bullet ? ' b' : ''}">` +
           l.spans.map(spanHTML).join('') + '</p>';
  }).join('');
}

function field(name, ls) {
  if (!ls || !ls.length) return '';
  return `<div class="fld"><h4>${name}</h4>${linesHTML(ls)}</div>`;
}

/* One row per meeting: date, block, class work, homework — side by side on a
   Chromebook, stacked only when the screen is too narrow for two columns. */
function dayHTML(d, stripe) {
  const z = stripe ? ' alt' : '';
  if (d.off) {
    return `<div class="row off${z}"><div class="when">${esc(d.d)}</div>` +
           `<div class="blk"></div><div class="note" role="note">${esc(d.off)}</div></div>`;
  }
  const meets = (d.meets || []).filter(m => m.cw || m.hw);
  if (!meets.length) return '';         // met, nothing posted: say nothing
  return meets.map((m, i) =>
    `<div class="row${z}">` +
      `<div class="when">${i ? '' : esc(d.d)}</div>` +
      `<div class="blk">${esc(m.block || '')}</div>` +
      `<div class="col">${field('Class work', m.cw)}</div>` +
      `<div class="col">${field('Homework', m.hw)}</div>` +
    '</div>').join('');
}

function linkBar(links) {
  if (!links || !links.length) return '';
  return '<nav class="bar">' + links.map(l =>
    `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.label)}</a>`
  ).join('') + '</nav>';
}

function render(data) {
  const app = document.getElementById('app');
  const c = data.course;
  // period, not section — students know their class by the period they have it
  const heading = c ? (c.tag ? c.tag + ' \u00b7 ' : '') + c.name : 'Class agenda';
  document.title = c ? heading + ' Agenda' : 'Class agenda';
  if (c && c.fill) document.documentElement.style.setProperty('--accent', c.ink || '#1B3A5C');

  const stamp = data.updated
    ? 'Updated ' + new Date(data.updated).toLocaleString(undefined,
        {weekday: 'short', month: 'short', day: 'numeric',
         hour: 'numeric', minute: '2-digit'})
    : '';

  const weeks = (data.weeks || [])
    .map(w => {
      let stripe = 0;
      const days = (w.days || []).map(d => {
        const html = dayHTML(d, stripe);
        if (html) stripe = 1 - stripe;            // shade by day, not by row
        return html;
      }).join('');
      // the class name, the dates and when it was last updated all live in the
      // bar — there is no separate page header to take up a Chromebook's screen
      // dates over the updated time on one side, the class name on the other,
      // centred against both — a flex row so the centring cannot come adrift
      return days ? '<section class="week"><h2>' +
        '<span class="when2">' +
          `<span class="dates">${esc(w.label)}</span>` +
          (stamp ? `<span class="upd">${esc(stamp)}</span>` : '') +
        '</span>' +
        `<span class="cls">${esc(heading)}</span>` +
        `</h2>${days}</section>` : '';
    })
    .filter(Boolean);

  app.innerHTML = linkBar(data.links) +
    (weeks.length ? weeks.join('') : '<p class="msg">Nothing posted yet.</p>');
}

function fail(msg) {
  document.getElementById('app').innerHTML = '<p class="msg">' + esc(msg) + '</p>';
}

let lastUpdated = null;
let tag = '';

async function load(quiet) {
  try {
    // the cache-buster matters: Google caches these replies, and a stale one
    // would show yesterday's plan with no sign that it was old
    const url = ENDPOINT + '?class=' + tag + '&t=' + Date.now();
    let res;
    try {
      res = await fetch(url);
    } catch (err) {
      // the network, or the address in endpoint.js — not the page's own doing
      if (!quiet) fail('Could not reach the agenda. ' + err.message);
      return;
    }
    if (!res.ok) { if (!quiet) fail('The agenda replied ' + res.status + '.'); return; }

    let data;
    try {
      data = await res.json();
    } catch (err) {
      if (!quiet) fail('The agenda sent something unreadable. It may need publishing again.');
      return;
    }
    if (!data.ok) { if (!quiet) fail(data.error || 'Could not load the agenda.'); return; }
    if (quiet && data.updated === lastUpdated) return;    // nothing new
    lastUpdated = data.updated;
    render(data);
  } catch (err) {
    // a fault in the page itself must not read as "the network is down"
    console.error(err);
    if (!quiet) fail('The agenda could not be drawn: ' + err.message);
  }
}

/* A Chromebook tab sits open for days. Left alone, a student would be reading
   Monday's plan on Thursday with nothing to say it was stale — so this checks
   for itself, and always when the tab comes back to the front. */
function watch() {
  setInterval(() => { if (!document.hidden) load(true); }, 5 * 60 * 1000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) load(true); });
  window.addEventListener('online', () => load(true));
}

function start() {
  const q = new URLSearchParams(location.search);
  tag = (q.get('class') || q.get('cls') || '').toLowerCase();
  if (!/^p[1-7]$/.test(tag)) { fail('Add a class to the address, like ?class=p1'); return; }
  load();
  watch();
}

if (typeof document !== 'undefined' && document.getElementById('app')) start();
if (typeof module !== 'undefined') module.exports = {render, linesHTML, spanHTML, dayHTML};
