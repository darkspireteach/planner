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

function dayHTML(d) {
  if (d.off) {
    return `<section class="day off"><h3>${esc(d.d)}</h3>` +
           `<p class="note">${esc(d.off)}</p></section>`;
  }
  const meets = (d.meets || []).filter(m => m.cw || m.hw);
  if (!meets.length) return '';         // met, nothing posted: say nothing
  return `<section class="day"><h3>${esc(d.d)}</h3>` +
    meets.map(m => field('Class work', m.cw) + field('Homework', m.hw)).join('') +
    '</section>';
}

function render(data) {
  const app = document.getElementById('app');
  const c = data.course;
  document.getElementById('title').textContent =
    c ? c.name + (c.sec ? ' ' + c.sec : '') : 'Class agenda';
  document.title = c ? c.name + ' — agenda' : 'Class agenda';
  if (c && c.fill) document.documentElement.style.setProperty('--accent', c.ink || '#1B3A5C');

  if (data.updated) {
    document.getElementById('stamp').textContent =
      'Updated ' + new Date(data.updated).toLocaleString(undefined,
        {weekday: 'short', month: 'short', day: 'numeric',
         hour: 'numeric', minute: '2-digit'});
  }

  const weeks = (data.weeks || [])
    .map(w => {
      const days = (w.days || []).map(dayHTML).join('');
      return days ? `<section class="week"><h2>${esc(w.label)}</h2>${days}</section>` : '';
    })
    .filter(Boolean);

  app.innerHTML = weeks.length ? weeks.join('')
    : '<p class="msg">Nothing posted yet.</p>';
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
