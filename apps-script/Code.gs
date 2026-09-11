/**
 * Internal Audit Report Builder — Google Apps Script bridge
 * =========================================================
 * Bound to the audit workbook and deployed as a web app. Only the Cloudflare
 * Worker calls it, and every call must carry the shared BRIDGE_TOKEN. Deploy
 * with "Execute as: Me" and "Who has access: Anyone" — the bridge token, not
 * Google's access control, is what authenticates the caller, which is why the
 * Worker is the only thing that ever knows it.
 *
 * Set the token once via  Project Settings -> Script properties:
 *     BRIDGE_TOKEN = <same value as the Worker secret>
 *
 * Tabs are created automatically on first use:
 *   Audits         one row per audit
 *   Observations   one row per observation (rich HTML lives in these cells)
 *   Config         two columns: key | value  (newline-separated picklists)
 */

/* Bump on every change. `{"action":"version"}` returns it, which is the only
   way to tell from outside whether a redeploy actually took effect — the
   /exec URL is pinned to a deployment version, so editing the code here and
   pressing Save changes nothing until a NEW VERSION is deployed. */
var VERSION = 6;

/* Appended, not inserted. Rows are addressed by position, so slotting a new
   column in ahead of the existing ones would shift every audit already in
   the sheet one place to the left - the depot code would be read back as
   the report number and updated_at would drop off the end. Column order in
   the sheet is cosmetic; only this array's order matters. */
var AUDIT_COLS = ['id','depot_code','location','region','period_from','period_to',
                  'status','audit_team','created_at','updated_at','report_no','cover'];

var OBS_COLS = ['id','audit_id','seq','title','repeat','value_at_risk','risk_rating',
                'system_improvement','background','observation',
                'root_cause','root_cause_tags','business_impact','impact_tags',
                'recommendation','recommendation_tags','management_response',
                'implementation','attachments','updated_at'];

/* Fields stored as a delimited list, and as JSON, respectively. */
var LIST_FIELDS = ['root_cause_tags','impact_tags','recommendation_tags','attachments'];
var JSON_FIELDS = ['implementation'];
/* Columns holding a plain yyyy-MM-dd date. Sheets turns such a string into a
   real date value on write, so these need normalising on the way back out. */
var DATE_FIELDS = ['period_from','period_to'];

function doPost(e) {
  try {
    var body = JSON.parse(e.postData.contents);
    var expected = PropertiesService.getScriptProperties().getProperty('BRIDGE_TOKEN');
    if (!expected || body.bridgeToken !== expected) return out({ error: 'Unauthorized' });

    switch (body.action) {
      case 'version':     return out({ version: VERSION });
      case 'config':      return out({ config: readConfig() });
      case 'saveConfig':  writeConfig(body.config || {});      return out({ ok: true });
      case 'listAudits':  return out({ audits: readRows('Audits', AUDIT_COLS) });
      case 'saveAudit':   upsert('Audits', AUDIT_COLS, body.audit);       return out({ ok: true });
      case 'deleteAudit': return out(deleteAudit(body.id));
      case 'listObs':     return out({ observations: readRows('Observations', OBS_COLS)
                                        .filter(function (o) { return o.audit_id === body.auditId; }) });
      case 'saveObs':     upsert('Observations', OBS_COLS, body.observation); return out({ ok: true });
      case 'deleteObs':   removeRow('Observations', body.id);   return out({ ok: true });
      default:            return out({ error: 'Unknown action' });
    }
  } catch (err) {
    return out({ error: String(err && err.message ? err.message : err) });
  }
}

function out(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ------------------------------------------------------------------ sheets */

/* Fetch a tab, creating it with a header row if it does not exist yet. */
function tab(name, cols) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(name);
  if (!sh) {
    sh = ss.insertSheet(name);
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
    return sh;
  }
  /* Data rows are addressed positionally, so a stale header row does not break
     reads - but after a column rename it misleads anyone reading the sheet
     directly. Rewrite row 1 whenever it no longer matches cols. */
  var width = Math.max(cols.length, sh.getLastColumn());
  var head = sh.getRange(1, 1, 1, width).getValues()[0];
  var same = head.length >= cols.length;
  for (var i = 0; same && i < cols.length; i++) {
    if (String(head[i]) !== cols[i]) same = false;
  }
  if (!same) {
    sh.getRange(1, 1, 1, width).clearContent();
    sh.getRange(1, 1, 1, cols.length).setValues([cols]).setFontWeight('bold');
    sh.setFrozenRows(1);
  }
  return sh;
}

function readRows(name, cols) {
  var sh = tab(name, cols);
  var last = sh.getLastRow();
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, cols.length).getValues();
  return values
    .filter(function (r) { return String(r[0]).trim() !== ''; })   // skip blank rows
    .map(function (r) {
      var o = {};
      cols.forEach(function (c, i) { o[c] = decodeField(c, r[i]); });
      return o;
    });
}

/* Insert or update by id (column A). */
function upsert(name, cols, rec) {
  if (!rec || !rec.id) throw new Error('Record has no id');
  var sh = tab(name, cols);
  var row = cols.map(function (c) { return encodeField(c, rec[c]); });
  var rowIndex = findRow(sh, rec.id);
  if (rowIndex > 0) sh.getRange(rowIndex, 1, 1, cols.length).setValues([row]);
  else              sh.appendRow(row);
}

function findRow(sh, id) {
  var last = sh.getLastRow();
  if (last < 2) return -1;
  var ids = sh.getRange(2, 1, last - 1, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (String(ids[i][0]) === String(id)) return i + 2;
  }
  return -1;
}

function removeRow(name, id) {
  var cols = name === 'Audits' ? AUDIT_COLS : OBS_COLS;
  var sh = tab(name, cols);
  var r = findRow(sh, id);
  if (r > 0) sh.deleteRow(r);
}

/* Deleting an audit takes its observations with it. Rows are removed bottom-up
   so the shifting row indices do not skip entries. */
function deleteAudit(id) {
  removeRow('Audits', id);
  var sh = tab('Observations', OBS_COLS);
  var last = sh.getLastRow();
  if (last >= 2) {
    var vals = sh.getRange(2, 1, last - 1, 2).getValues();     // id, audit_id
    for (var i = vals.length - 1; i >= 0; i--) {
      if (String(vals[i][1]) === String(id)) sh.deleteRow(i + 2);
    }
  }
  return { ok: true };
}

/* Arrays and objects have to become text to live in a cell. Lists use a pipe
   delimiter (no picklist value contains one); implementation rows are JSON. */
function encodeField(col, v) {
  if (LIST_FIELDS.indexOf(col) >= 0) return (v || []).join('|');
  if (JSON_FIELDS.indexOf(col) >= 0) return JSON.stringify(v || []);
  if (v === null || v === undefined) return '';
  return v;
}
function decodeField(col, v) {
  if (LIST_FIELDS.indexOf(col) >= 0) {
    return String(v || '').split('|').filter(function (s) { return s !== ''; });
  }
  if (JSON_FIELDS.indexOf(col) >= 0) {
    try { return JSON.parse(v || '[]'); } catch (e) { return []; }
  }
  if (col === 'value_at_risk' || col === 'seq') return Number(v) || 0;
  /* Sheets converts a "2023-04-01" string into a real date value on write, so
     these columns come back as something other than the string that went in.
     Normalise by column name rather than by sniffing the value's type: an
     earlier `v instanceof Date` check and a `typeof v.getTime` check both
     failed to match, so the type of these values is not something to rely on.
     new Date(...) accepts a Date, a date string or an epoch number alike. */
  if (DATE_FIELDS.indexOf(col) >= 0) return toISODate(v);
  return v === null || v === undefined ? '' : String(v);
}

/* Anything date-shaped -> "yyyy-MM-dd", or '' when it is not a real date.
   Already-correct strings are returned untouched so a value never drifts by a
   day through repeated timezone conversions. */
function toISODate(v) {
  if (v === null || v === undefined || v === '') return '';
  var str = String(v);
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(str);
  if (m) return str;
  var d = new Date(v);
  if (!d || isNaN(d.getTime())) return '';
  return Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

/* ------------------------------------------------------------------ config */

function readConfig() {
  var sh = tab('Config', ['key', 'value']);
  var last = sh.getLastRow();
  var cfg = { owners: [] };   // depot code / location / region are all typed, so no lists
  if (last < 2) return cfg;
  sh.getRange(2, 1, last - 1, 2).getValues().forEach(function (r) {
    var k = String(r[0]).trim();
    if (!k) return;
    cfg[k] = String(r[1] || '').split('\n')
      .map(function (s) { return s.trim(); })
      .filter(function (s) { return s !== ''; });
  });
  return cfg;
}

function writeConfig(cfg) {
  var sh = tab('Config', ['key', 'value']);
  var keys = Object.keys(cfg);
  if (sh.getLastRow() > 1) sh.getRange(2, 1, sh.getLastRow() - 1, 2).clearContent();
  if (!keys.length) return;
  sh.getRange(2, 1, keys.length, 2).setValues(keys.map(function (k) {
    return [k, (cfg[k] || []).join('\n')];
  }));
}
