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
  if (!s.url) return t;                 // held back, or never a link
  return `<a href="${esc(s.url)}" target="_blank" rel="noopener">${t}</a>`;
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
  const heading = c ? (c.tag ? c.tag + ' ' : '') + c.name : 'Class agenda';
  document.getElementById('title').textContent = heading;
  document.title = c ? heading + ' \u2014 agenda' : 'Class agenda';
  if (c && c.fill) document.documentElement.style.setProperty('--accent', c.ink || '#1B3A5C');

  if (data.updated) {
    document.getElementById('stamp').textContent =
      'Updated ' + new Date(data.updated).toLocaleString(undefined,
        {weekday: 'short', month: 'short', day: 'numeric',
         hour: 'numeric', minute: '2-digit'});
  }

  const weeks = (data.weeks || [])
    .map(w => {
      let stripe = 0;
      const days = (w.days || []).map(d => {
        const html = dayHTML(d, stripe);
        if (html) stripe = 1 - stripe;            // shade by day, not by row
        return html;
      }).join('');
      return days ? `<section class="week"><h2>${esc(w.label)}</h2>${days}</section>` : '';
    })
    .filter(Boolean);

  app.innerHTML = linkBar(data.links) +
    (weeks.length ? weeks.join('') : '<p class="msg">Nothing posted yet.</p>');
}

function fail(msg) {
  document.getElementById('app').innerHTML = '<p class="msg">' + esc(msg) + '</p>';
}

async function load() {
  const q = new URLSearchParams(location.search);
  const tag = (q.get('class') || q.get('cls') || '').toLowerCase();
  if (!/^p[1-7]$/.test(tag)) { fail('Add a class to the address, like ?class=p1'); return; }
  try {
    // the cache-buster matters: Google caches these replies, and a stale one
    // would show yesterday's plan with no sign that it was old
    const url = ENDPOINT + '?class=' + tag + '&t=' + Date.now();
    const res = await fetch(url);
    const data = await res.json();
    if (!data.ok) { fail(data.error || 'Could not load the agenda.'); return; }
    render(data);
  } catch (err) {
    fail('Could not reach the agenda. Try again in a moment.');
  }
}

if (typeof document !== 'undefined' && document.getElementById('app')) load();
if (typeof module !== 'undefined') module.exports = {render, linesHTML, spanHTML, dayHTML};
