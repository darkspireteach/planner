/**
 * Lesson planner — sync endpoint.
 *
 * Stores plan records and serves them to the app. Follows the same shape as the
 * homework app: a token in Script Properties, JSON in and JSON out, a script
 * lock around every write, and errors returned rather than thrown.
 *
 * Run setup() once, then Deploy ▸ New deployment ▸ Web app,
 * executing as me, access "Anyone".
 *
 * One row per record on the _Records tab:
 *   A key        date|period|field   e.g. 2026-09-02|1|cw
 *   B updatedAt  ISO, assigned by the server, never by the client
 *   C device     last writer, for working out which machine did what
 *   D json       the lines array
 *
 * The app renders these. Nothing here formats anything for a human to read,
 * which is why this file is short and Publish.gs was not.
 */

/* Bumped whenever this file changes, and reported by ?check=1. Saving in the
   editor does not change what /exec serves — only deploying does — so there
   has to be a way to see which code is actually live. */
var VERSION = 'v9 2026-09-05';

var REC_TAB = '_Records';
var MAX_ROWS = 20000;

/**
 * Reading document names needs the Drive scope, which is only requested if the
 * script mentions DriveApp somewhere it can see. This is never called.
 */
function forceDriveScope_() {
  DriveApp.getRootFolder();
}

function setup() {
  var p = PropertiesService.getScriptProperties();
  p.setProperty('SHEET_ID', SpreadsheetApp.getActiveSpreadsheet().getId());
  if (!p.getProperty('TOKEN')) p.setProperty('TOKEN', Utilities.getUuid());
  recTab();
  Logger.log('TOKEN: ' + p.getProperty('TOKEN'));
  Logger.log('SHEET_ID: ' + p.getProperty('SHEET_ID'));
  SpreadsheetApp.getUi().alert(
    'Sync is set up.\n\nDeploy \u25b8 New deployment \u25b8 Web app, then copy the ' +
    '/exec URL.\n\nToken:\n' + p.getProperty('TOKEN'));
}

/* ---------- endpoint ---------- */

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var want = PropertiesService.getScriptProperties().getProperty('TOKEN');
    if (!want || req.token !== want) return out({ok: false, error: 'bad token'});
    if (req.action === 'ping') return out({ok: true, now: nowIso()});
    if (req.action === 'pull') return out(pull(req));
    if (req.action === 'push') return out(push(req));
    if (req.action === 'title') return out(title(req));
    if (req.action === 'absences') return out(absences());
    if (req.action === 'calendar') return out(putCalendar(req));
    if (req.action === 'publish') return out(publish());
    return out({ok: false, error: 'unknown action: ' + req.action});
  } catch (err) {
    // never throw: a thrown error returns an HTML page the app cannot parse
    return out({ok: false, error: String(err)});
  }
}

/**
 * The student feed. No token: this is what students read, so it must be
 * reachable without one — which is exactly why the redaction happens here and
 * not in the page. Nothing teacher-only is ever in this reply.
 *
 * The class goes in as ?class=p1. Do not use ?c= — such a request never
 * arrives, and Drive answers it with an error page of its own.
 */
function doGet(e) {
  try {
    var q = (e && e.parameter) || {};
    if (q.check) return out(selfCheck());            // before the class check, so
    if (q.echo) return out({ok: true, version: VERSION, sawParams: q});
    /* NOT 'c': a query with c= never reaches this script at all — no execution
       is logged and Drive answers with its own error page. Something in
       Google's URL handling takes that name. 'class' is left alone. */
    var tag = String(q['class'] || q.cls || '').toUpperCase();
    if (!/^P[1-7]$/.test(tag)) {
      return out({ok: false, error: 'which class? use ?class=p1'});
    }
    return out(readPublished(tag));
  } catch (err) {
    return out({ok: false, error: String(err)});
  }
}

function out(o) {
  return ContentService.createTextOutput(JSON.stringify(o))
    .setMimeType(ContentService.MimeType.JSON);
}

function nowIso() { return new Date().toISOString(); }

/** ?check=1 — what the endpoint can see, for when something is not working. */
function selfCheck() {
  var p = PropertiesService.getScriptProperties();
  var o = {ok: true, version: VERSION, sheetId: p.getProperty('SHEET_ID') ? 'stored' : 'MISSING',
           token: p.getProperty('TOKEN') ? 'stored' : 'MISSING'};
  try {
    o.workbook = book().getName();
    var cal = tabIfAny(CAL_TAB), pub = tabIfAny(PUB_TAB), rec = tabIfAny(REC_TAB);
    o.calendarTab = cal ? cal.getLastRow() + ' row(s)' : 'not there yet';
    o.publishedTab = pub ? pub.getLastRow() + ' row(s)' : 'not there yet';
    o.recordsTab = rec ? (rec.getLastRow() - 1) + ' record(s)' : 'not there yet';
    o.lastPublish = p.getProperty('lastPublish') || 'never';
  } catch (err) {
    o.ok = false;
    o.error = String(err);
  }
  return o;
}

/* ---------- what students may see ---------- */

/**
 * Strip a cell down to what is publishable. A held link keeps its words and
 * loses its address entirely; a private line and a (( )) run disappear.
 *
 * Pure, so the tests can run it directly rather than trusting a copy.
 */
function redactLines(lines) {
  if (!lines || !lines.length) return null;
  var out = [];
  for (var i = 0; i < lines.length; i++) {
    var l = lines[i];
    if (!l) { out.push(null); continue; }          // a blank line survives
    if (l.private) continue;                       // '//' whole line
    var spans = [];
    for (var j = 0; j < l.spans.length; j++) {
      var sp = l.spans[j];
      if (sp.priv) continue;                       // '(( ))' run
      if (!sp.t) continue;
      spans.push(sp.url && sp.rel
        ? {t: sp.t, url: sp.url}                   // released: words and address
        : {t: sp.t});                              // held: words only, no address
    }
    var any = false;
    for (var k = 0; k < spans.length; k++) if (String(spans[k].t).trim()) any = true;
    if (any) out.push({bullet: !!l.bullet, spans: spans});
  }
  while (out.length && out[out.length - 1] === null) out.pop();
  while (out.length && out[0] === null) out.shift();
  return out.length ? out : null;
}

/**
 * The last date students may see: the Friday of the current week, where the
 * week turns over at 5am on Monday rather than at midnight. Sunday evening
 * still shows the week just gone; Monday breakfast shows the new one whole.
 */
function horizonISO(now) {
  var d = new Date(now.getTime() - 5 * 3600 * 1000);   // shift the rollover
  var dow = d.getDay();                                // 0 Sun .. 6 Sat
  var back = (dow + 6) % 7;                            // days since Monday
  var mon = new Date(d.getFullYear(), d.getMonth(), d.getDate() - back);
  var fri = new Date(mon.getFullYear(), mon.getMonth(), mon.getDate() + 4);
  return iso(fri);
}

function iso(d) {
  var p = function (n) { return (n < 10 ? '0' : '') + n; };
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

/* ---------- absences ---------- */

/**
 * Read-only, straight from the gradebook workbook.
 *
 * A day is reported when the attendance column has ANY mark in it, even if
 * nobody was out — otherwise "everyone was here" and "I haven't taken it yet"
 * arrive as the same nothing, and the planner cannot tell them apart.
 *
 * Nothing here ever writes. The Attend column belongs to pullAbsences().
 */
function absences() {
  if (typeof readGradebookConfig !== 'function' || typeof inspectTab !== 'function') {
    return {ok: false, error: 'keep Publish.gs in this project — its readers are used here'};
  }
  var cfg = readGradebookConfig();
  if (!cfg.id) return {ok: false, error: 'no gradebook URL on the "Gradebook" tab'};

  var gb = SpreadsheetApp.openById(cfg.id);
  var res = resolveTabs(gb, cfg.map);
  var codes = (typeof ABSENT_CODES !== 'undefined') ? ABSENT_CODES : ['AB', 'T', 'TE', 'TX'];
  var out = {};

  Object.keys(res.byTag).forEach(function (tag) {
    var info = inspectTab(res.byTag[tag]);
    if (info.hdr < 0) return;
    var grid = info.grid, days = {};
    Object.keys(info.cols).forEach(function (c) {
      var key = info.cols[c].mo + '/' + info.cols[c].da;
      var marked = 0, byCode = {};
      for (var rr = info.hdr + 1; rr < grid.length; rr++) {
        if (!shortName(grid[rr][0], grid[rr][1])) continue;
        var code = String(grid[rr][c] || '').trim().toUpperCase();
        if (!code) continue;
        marked++;
        if (codes.indexOf(code) < 0) continue;
        (byCode[code] = byCode[code] || []).push(shortName(grid[rr][0], grid[rr][1]));
      }
      if (marked) days[key] = byCode;      // present in the reply == taken
    });
    out[tag] = days;
  });
  return {ok: true, now: nowIso(), byTag: out};
}

/* ---------- calendar, handed over by the app ---------- */

var CAL_TAB = '_Calendar', PUB_TAB = '_Published';

function book() {
  var id = PropertiesService.getScriptProperties().getProperty('SHEET_ID');
  if (!id) throw new Error('run setup() first — no SHEET_ID stored');
  return SpreadsheetApp.openById(id);
}

function tab(name) {
  var ss = book();
  var sh = ss.getSheetByName(name);
  if (!sh) { sh = ss.insertSheet(name); sh.hideSheet(); }
  return sh;
}

/** Read-only: never creates anything. doGet must not write. */
function tabIfAny(name) {
  return book().getSheetByName(name);
}

/**
 * The endpoint knows records but not the shape of the year — which dates are
 * school days, which period is which class. The app has that in data.js and
 * hands it over. One row per week keeps every cell well under the size limit.
 */
function putCalendar(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return {ok: false, error: 'busy, try again'};
  try {
    var sh = tab(CAL_TAB);
    sh.clear();
    var rows = [['courses', JSON.stringify(req.courses || {})]];
    (req.weeks || []).forEach(function (w) { rows.push([w.mon, JSON.stringify(w)]); });
    sh.getRange(1, 1, rows.length, 2).setValues(rows);
    SpreadsheetApp.flush();
    return {ok: true, weeks: rows.length - 1};
  } finally {
    lock.releaseLock();
  }
}

function getCalendar() {
  var sh = tabIfAny(CAL_TAB);
  if (!sh) return null;
  var last = sh.getLastRow();
  if (!last) return null;
  var vals = sh.getRange(1, 1, last, 2).getValues();
  var out = {courses: {}, weeks: []};
  for (var i = 0; i < vals.length; i++) {
    var k = String(vals[i][0] || '');
    if (!k) continue;
    var v = parse(String(vals[i][1] || ''));
    if (!v) continue;
    if (k === 'courses') out.courses = v; else out.weeks.push(v);
  }
  out.weeks.sort(function (a, b) { return a.mon < b.mon ? -1 : 1; });
  return out;
}

/* ---------- publishing ---------- */

/**
 * Build one payload per class from the records, redacted, up to the horizon.
 * Weeks newest first; days inside a week in order. Written per class per week,
 * so no single cell grows past what a cell can hold.
 */
function publish() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return {ok: false, error: 'busy, try again'};
  try {
    var cal = getCalendar();
    if (!cal || !cal.weeks.length) {
      return {ok: false, error: 'no calendar yet — open the planner app once to send it'};
    }
    var recs = readAll(recTab());
    var limit = horizonISO(new Date());
    var stamp = nowIso();
    var rows = [], counts = {};

    cal.weeks.forEach(function (w) {
      var days = (w.days || []).filter(function (d) { return d.iso <= limit; });
      if (!days.length) return;
      Object.keys(cal.courses).forEach(function (per) {
        var c = cal.courses[per];
        var out = [];
        days.forEach(function (d) {
          if (!d.cycle) {                            // no school
            out.push({d: d.d, iso: d.iso, off: d.off || 'No school'});
            return;
          }
          var meets = [];
          (d.blocks || []).forEach(function (b) {
            if (String(b.period) !== String(per)) return;
            var key = d.iso + '|P' + per + (b.asp ? 'a' : '') + '|';
            var cw = recs[key + 'cw'] ? redactLines(parse(recs[key + 'cw'].json)) : null;
            var hw = recs[key + 'hw'] ? redactLines(parse(recs[key + 'hw'].json)) : null;
            if (cw || hw) meets.push({block: b.block, cw: cw, hw: hw});
          });
          out.push({d: d.d, iso: d.iso, meets: meets});
        });
        var real = out.filter(function (x) { return x.meets && x.meets.length; }).length;
        if (!real) return;                           // nothing published for this class
        counts[c.tag] = (counts[c.tag] || 0) + real;
        rows.push([c.tag, w.mon, JSON.stringify({label: w.label, mon: w.mon, days: out}), stamp]);
      });
    });

    // the quick links bar, straight off the Student Links tab that Publish.gs
    // already maintains — one row, read back out when a student loads a page
    var links = {};
    try { if (typeof readStudentLinks === 'function') links = readStudentLinks(); }
    catch (err) { links = {}; }
    rows.push(['LINKS', '', JSON.stringify(links), stamp]);

    var sh = tab(PUB_TAB);
    sh.clear();
    if (rows.length) sh.getRange(1, 1, rows.length, 4).setValues(rows);
    PropertiesService.getScriptProperties().setProperty('lastPublish', stamp);
    SpreadsheetApp.flush();
    return {ok: true, now: stamp, through: limit, classes: counts};
  } finally {
    lock.releaseLock();
  }
}

/** Everything published for one class, newest week first. */
function readPublished(tag) {
  var cal = getCalendar() || {courses: {}};
  var info = null;
  Object.keys(cal.courses).forEach(function (p) {
    if (cal.courses[p].tag === tag) info = cal.courses[p];
  });
  var sh = tabIfAny(PUB_TAB);
  var last = sh ? sh.getLastRow() : 0, weeks = [], stamp = '', links = [];
  if (last) {
    var vals = sh.getRange(1, 1, last, 4).getValues();
    for (var i = 0; i < vals.length; i++) {
      var row = String(vals[i][0]);
      if (row === 'LINKS') {
        var all = parse(String(vals[i][2] || '')) || {};
        links = (all['ALL'] || []).concat(all[tag] || []);
        continue;
      }
      if (row !== tag) continue;
      var w = parse(String(vals[i][2] || ''));
      if (w) weeks.push(w);
      stamp = String(vals[i][3] || stamp);
    }
  }
  weeks.sort(function (a, b) { return a.mon < b.mon ? 1 : -1; });   // newest first
  if (!weeks.length) {
    return {ok: true, tag: tag, course: info, updated: '', links: links, weeks: [],
            note: sh ? 'nothing published for ' + tag + ' yet'
                     : 'nothing has been published yet — run Publish to students now'};
  }
  return {ok: true, tag: tag, course: info, updated: stamp, links: links, weeks: weeks};
}

/* ---------- document titles ---------- */

/**
 * The name of a Drive file, so a pasted link can label itself. Runs as me, so
 * it only ever sees files I can already open. A file that can't be read comes
 * back as an empty title rather than an error — the app just keeps the address
 * as the label and I can type over it.
 */
function title(req) {
  var id = fileId(req.url || '');
  if (!id) return {ok: true, title: ''};
  try {
    return {ok: true, title: DriveApp.getFileById(id).getName()};
  } catch (err) {
    try {
      return {ok: true, title: DriveApp.getFolderById(id).getName()};
    } catch (err2) {
      return {ok: true, title: ''};
    }
  }
}

/** the id out of any of Google's URL shapes */
function fileId(u) {
  u = String(u || '');
  var m = u.match(/\/d\/([a-zA-Z0-9_-]{20,})/);
  if (m) return m[1];
  m = u.match(/[?&]id=([a-zA-Z0-9_-]{20,})/);
  return m ? m[1] : '';
}

/* ---------- store ---------- */

function recTab() {
  var ss = SpreadsheetApp.openById(
    PropertiesService.getScriptProperties().getProperty('SHEET_ID') ||
    SpreadsheetApp.getActiveSpreadsheet().getId());
  var sh = ss.getSheetByName(REC_TAB);
  if (!sh) {
    sh = ss.insertSheet(REC_TAB);
    sh.getRange(1, 1, 1, 4).setValues([['key', 'updatedAt', 'device', 'json']])
      .setFontWeight('bold');
    sh.setFrozenRows(1);
    sh.hideSheet();
  }
  return sh;
}

/** every stored row, as { key: {row, updatedAt, device, json} } */
function readAll(sh) {
  var last = sh.getLastRow();
  if (last < 2) return {};
  var vals = sh.getRange(2, 1, last - 1, 4).getValues();
  var out = {};
  for (var i = 0; i < vals.length; i++) {
    var k = String(vals[i][0] || '');
    if (!k) continue;
    out[k] = {row: i + 2, updatedAt: String(vals[i][1] || ''),
              device: String(vals[i][2] || ''), json: String(vals[i][3] || '')};
  }
  return out;
}

/* ---------- pull ---------- */

/**
 * Everything changed since the client last heard from us. `since` is a
 * timestamp WE issued, so the clocks being compared are both the server's —
 * three machines with three slightly wrong clocks never enters into it.
 */
function pull(req) {
  var sh = recTab();
  var all = readAll(sh);
  var since = String(req.since || '');
  var recs = [];
  Object.keys(all).forEach(function (k) {
    var r = all[k];
    if (since && r.updatedAt <= since) return;
    recs.push({key: k, updatedAt: r.updatedAt, device: r.device, lines: parse(r.json)});
  });
  return {ok: true, now: nowIso(), since: since, records: recs, total: Object.keys(all).length};
}

function parse(s) {
  if (!s) return null;
  try { return JSON.parse(s); } catch (err) { return null; }
}

/* ---------- push ---------- */

/**
 * Each record carries the updatedAt the client last saw. If the stored copy is
 * newer, someone else wrote it in the meantime and this write is refused rather
 * than applied — the app is told, and shows both. Silent last-writer-wins is
 * how an evening of planning disappears.
 *
 * A record with lines: null is a deletion; the row is cleared but kept, so a
 * client pulling later learns the record went away instead of never hearing.
 */
function push(req) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) return {ok: false, error: 'busy, try again'};
  try {
    var sh = recTab();
    var all = readAll(sh);
    var stamp = nowIso();
    var device = String(req.device || 'unknown').slice(0, 40);
    var saved = [], conflicts = [], appends = [];

    (req.records || []).forEach(function (rec) {
      var k = String(rec.key || '');
      if (!k) return;
      var have = all[k];
      var base = String(rec.base || '');

      if (have && have.updatedAt && have.updatedAt !== base) {
        conflicts.push({key: k, updatedAt: have.updatedAt, device: have.device,
                        lines: parse(have.json)});
        return;
      }

      var json = rec.lines ? JSON.stringify(rec.lines) : '';
      if (have) {
        sh.getRange(have.row, 2, 1, 3).setValues([[stamp, device, json]]);
      } else {
        appends.push([k, stamp, device, json]);
        all[k] = {row: -1, updatedAt: stamp, device: device, json: json};
      }
      saved.push({key: k, updatedAt: stamp});
    });

    if (appends.length) {
      var start = sh.getLastRow() + 1;
      if (start + appends.length > MAX_ROWS) return {ok: false, error: 'record tab is full'};
      sh.getRange(start, 1, appends.length, 4).setValues(appends);
    }
    SpreadsheetApp.flush();
    return {ok: true, now: stamp, saved: saved, conflicts: conflicts};
  } finally {
    lock.releaseLock();
  }
}

/* ---------- menu ---------- */

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Planner sync')
    .addItem('Set up sync', 'setup')
    .addItem('Show token', 'showToken')
    .addItem('Record count', 'recordCount')
    .addSeparator()
    .addItem('Publish to students now', 'publishNow')
    .addItem('Turn ON auto-publishing', 'installPublishTrigger')
    .addItem('Turn OFF auto-publishing', 'removePublishTrigger')
    .addToUi();
}

function publishNow() {
  var r = publish();
  if (!r.ok) { SpreadsheetApp.getUi().alert(r.error); return; }
  var lines = Object.keys(r.classes).map(function (t) { return t + ': ' + r.classes[t]; });
  SpreadsheetApp.getUi().alert(
    'Published through ' + r.through + '\n\n' +
    (lines.join('\n') || 'nothing to publish yet') +
    '\n\nDays with something on them, per class.');
}

/** No UI: this is what the timer calls. */
function publishSilently() {
  try { publish(); } catch (err) { console.error('publish failed: ' + err); }
}

function installPublishTrigger() {
  removePublishTrigger(true);
  ScriptApp.newTrigger('publishSilently').timeBased().everyMinutes(15).create();
  SpreadsheetApp.getUi().alert(
    'Auto-publishing is ON.\n\nStudents see changes within about 15 minutes. ' +
    'Anything in // or (( )) stays private, so unfinished notes are safe.');
}

function removePublishTrigger(quiet) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'publishSilently') ScriptApp.deleteTrigger(t);
  });
  if (!quiet) SpreadsheetApp.getUi().alert('Auto-publishing is OFF.');
}

function showToken() {
  var p = PropertiesService.getScriptProperties();
  SpreadsheetApp.getUi().alert('Token:\n' + (p.getProperty('TOKEN') || '(run setup first)'));
}

function recordCount() {
  var all = readAll(recTab());
  var keys = Object.keys(all);
  var live = keys.filter(function (k) { return all[k].json; }).length;
  SpreadsheetApp.getUi().alert(
    keys.length + ' record(s), ' + live + ' with content.\n\n' +
    (keys.length ? 'Most recent: ' + keys.map(function (k) { return all[k].updatedAt; })
      .sort().pop() : ''));
}
