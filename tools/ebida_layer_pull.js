/**
 * EBIDA Layer Pull — Zoho transactions-daily into Accounting Master workbook
 *
 * Pulls per-(account, venue) daily data from /api/finance/zoho-transactions-daily
 * and MERGES it into the "EBIDA Layer" tab. Merge semantics:
 *
 *  • Sheet is persistent (NO clearContents). Days extend right, rows extend down.
 *  • Only date columns inside the pulled (from..to) window are touched.
 *  • Cells with background #ffff00 (yellow) are NEVER overwritten — manual edits.
 *  • Rows are keyed by (brand, account_code|name, venue_slug). New rows append.
 *  • New date columns appended chronologically at the right edge.
 *
 * Spreadsheet: 1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s
 */

var EBIDA_SPREADSHEET_ID = "1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s";
// IMPORTANT: writes to a DEDICATED tab owned by this script. The user-curated
// "EBIDA Layer" tab is too complex (multi-year un-yeared date columns) for
// safe automated merge — touching it caused data scatter on prior runs.
// Keep this tab name canonical; the user can VLOOKUP/QUERY into it from
// other tabs without us ever overwriting their P&L history.
var EBIDA_TAB            = "Zoho Raw Layer";
var COCKPIT_BASE         = "https://carisma-support-u2vb.vercel.app";

var PROTECTED_BG_COLOR   = "#ffff00";   // yellow background = "do not overwrite"
var PROTECTED_FONT_COLOR = "#ff0000";   // red font = "do not overwrite"
// Backward-compat alias (used in legacy spots that pre-date the font check)
var PROTECTED_COLOR = PROTECTED_BG_COLOR;
var CHUNK_DAYS      = 5;           // each API call covers <= this many days
var APPS_SCRIPT_BUDGET_MS = 5 * 60 * 1000;  // bail before hitting 6-min hard limit

var META_COLS  = ["Brand", "Line Item", "Account Code", "EBITDA Category", "Venue", "Contact", "Allocation"];
var META_COUNT = META_COLS.length;
var CONTACT_COL_IDX = 5;  // 0-indexed — Meta/Google/Klaviyo/GHL/Misc, populated only for Advertising rows
var ALLOC_COL_IDX   = 6;  // 0-indexed — "tag" if Zoho line tag drove it, else the split rule name

// Sheet layout: row 1 = pull controls, row 2 = spacer, row 3 = header, row 4+ = data
var CONTROL_ROW    = 1;
var HEADER_ROW     = 3;
var FIRST_DATA_ROW = 4;
// Control cells (1-indexed col on CONTROL_ROW)
var CTRL_FROM_COL    = 2;   // B1: from-date
var CTRL_TO_COL      = 4;   // D1: to-date
var CTRL_ORG_COL     = 6;   // F1: org (SPA / Aesthetics)
var CTRL_STATUS_COL  = 8;   // H1: last pulled / status

var BRAND_HEADER_BG = "#134a45";   // dark teal — matches existing "SPA" section row
var BRAND_HEADER_FG = "#ffffff";
var HEADER_BG       = "#e8f0fe";
var HEADER_FG       = "#1967d2";

var MONTH_NAMES   = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
var MONTH_LOOKUP  = { jan:1, feb:2, mar:3, apr:4, may:5, jun:6, jul:7, aug:8, sep:9, oct:10, nov:11, dec:12 };

// ── Menu ─────────────────────────────────────────────────────────────────────

function onOpenEbidaLayerMenu() {
  SpreadsheetApp.getUi()
    .createMenu("EBIDA Layer")
    .addItem("Pull Daily Granular from Zoho…", "showEbidaLayerDialog")
    .addToUi();
}

var EBIDA_DIALOG_HTML = '<!DOCTYPE html><html><head><base target="_top">' +
  '<style>' +
  'body{font-family:Google Sans,Arial,sans-serif;padding:20px;margin:0;font-size:13px;color:#202124}' +
  'h3{margin:0 0 6px;font-size:15px;color:#1a73e8}' +
  'p{margin:0 0 14px;color:#5f6368;font-size:12px;line-height:1.5}' +
  'label{display:block;font-weight:600;margin-bottom:4px;font-size:12px}' +
  'input[type=date],select{width:100%;padding:7px 9px;border:1px solid #dadce0;border-radius:4px;font-size:13px;margin-bottom:14px;box-sizing:border-box;outline:none;background:#fff}' +
  'input[type=date]:focus,select:focus{border-color:#1a73e8}' +
  'button{width:100%;background:#1a73e8;color:#fff;border:none;padding:9px 16px;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.15s}' +
  'button:hover{background:#1557b0}' +
  'button:disabled{opacity:0.55;cursor:not-allowed}' +
  '#status{margin-top:12px;padding:8px 10px;border-radius:4px;font-size:12px;display:none;white-space:pre-wrap}' +
  '.info{background:#e8f0fe;color:#1967d2}' +
  '.ok{background:#e6f4ea;color:#137333}' +
  '.warn{background:#fef7e0;color:#b06000}' +
  '.err{background:#fce8e6;color:#c5221f}' +
  '.note{font-size:11px;color:#5f6368;margin-top:-10px;margin-bottom:14px;line-height:1.4}' +
  '</style></head>' +
  '<body>' +
  '<h3>Pull EBIDA Layer</h3>' +
  '<p>Tag-aware daily Zoho transactions into the <strong>EBIDA Layer</strong> tab. Pull MERGES into the sheet — yellow (#ffff00) cells are never overwritten.</p>' +
  '<label>From</label><input type="date" id="df"/>' +
  '<label>To</label><input type="date" id="dt"/>' +
  '<div class="note">For windows wider than 1 week, run locally — Apps Script will time out at ~6 min.</div>' +
  '<label>Org</label><select id="org"><option value="SPA" selected>SPA</option><option value="Aesthetics">Aesthetics</option></select>' +
  '<button id="btn" onclick="go()">Pull &amp; Merge</button>' +
  '<div id="status"></div>' +
  '<script>' +
  'var now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,"0"),d=String(now.getDate()).padStart(2,"0");' +
  'var weekAgo=new Date(now.getTime()-6*86400000);' +
  'var wy=weekAgo.getFullYear(),wm=String(weekAgo.getMonth()+1).padStart(2,"0"),wd=String(weekAgo.getDate()).padStart(2,"0");' +
  'document.getElementById("df").value=wy+"-"+wm+"-"+wd;' +
  'document.getElementById("dt").value=y+"-"+m+"-"+d;' +
  'function go(){' +
  '  var df=document.getElementById("df").value,dt=document.getElementById("dt").value,org=document.getElementById("org").value;' +
  '  if(!df||!dt){show("Please select both dates.","err");return;}' +
  '  var ms=(new Date(dt)-new Date(df));if(ms>14*86400000){if(!confirm("Window is "+Math.round(ms/86400000)+" days. Apps Script may time out at ~6 min. Continue anyway?"))return;}' +
  '  document.getElementById("btn").disabled=true;' +
  '  show("Fetching from Zoho — may take up to 6 minutes…","info");' +
  '  google.script.run' +
  '    .withSuccessHandler(function(r){show(r,"ok");document.getElementById("btn").disabled=false;})' +
  '    .withFailureHandler(function(e){show("Error: "+e.message,"err");document.getElementById("btn").disabled=false;})' +
  '    .pullAndWriteEbidaLayer(df,dt,org);' +
  '}' +
  'function show(msg,cls){var el=document.getElementById("status");el.textContent=msg;el.className=cls;el.style.display="block";}' +
  '<\/script></body></html>';

function showEbidaLayerDialog() {
  var html = HtmlService.createHtmlOutput(EBIDA_DIALOG_HTML).setWidth(380).setHeight(440);
  SpreadsheetApp.getUi().showModalDialog(html, "Pull EBIDA Layer");
}

// ── Entry point ─────────────────────────────────────────────────────────────

function pullAndWriteEbidaLayer(dateFrom, dateTo, org) {
  var startedAt = Date.now();
  var orgParam  = (org || "SPA").toLowerCase();

  // Always sync the status cell at the start, regardless of which entry
  // point triggered the pull. Avoids stale "Pulling…" text from previous runs.
  _setStatus("Pulling " + dateFrom + " → " + dateTo + "… (" + (org || "SPA") + ")");

  var chunks = _computeChunks(dateFrom, dateTo, CHUNK_DAYS);

  var accRows  = {};        // brand|key|venue_slug -> { meta + daily }
  var datesSet = {};
  var done     = 0;

  for (var i = 0; i < chunks.length; i++) {
    if (Date.now() - startedAt > APPS_SCRIPT_BUDGET_MS) {
      throw new Error("Apps Script budget exhausted after " + done + "/" + chunks.length +
        " chunks. Re-run with a smaller window, or do the backfill locally via `npm run dev`.");
    }
    var c = chunks[i];
    var chunkResult = _fetchChunk(c.from, c.to, orgParam);
    for (var r = 0; r < chunkResult.rows.length; r++) {
      var row = chunkResult.rows[r];
      var allocation = row.tag_source === "tagged" ? "tag" : (row.split_rule || "split");
      var contact    = String(row.contact || "");
      var key = row.brand + "|" + (row.account_code || row.account_name) + "|" + row.venue_slug + "|" + contact + "|" + allocation;
      if (!accRows[key]) {
        accRows[key] = {
          brand:           row.brand,
          line_item:       row.account_name,
          account_code:    row.account_code || "",
          ebitda_category: _capitalize(row.ebitda_category),
          venue:           row.venue,
          venue_slug:      row.venue_slug,
          contact:         contact,
          allocation:      allocation,
          daily:           {},
        };
      }
      // Same (account, venue, allocation) tuples accumulate across chunks
      for (var d in row.daily) {
        accRows[key].daily[d] = (accRows[key].daily[d] || 0) + row.daily[d];
      }
    }
    for (var di = 0; di < chunkResult.dates.length; di++) datesSet[chunkResult.dates[di]] = true;
    done++;
  }

  var allDates = Object.keys(datesSet).sort();
  var stats    = _mergeIntoSheet(accRows, allDates, dateFrom, dateTo, org);

  var elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
  _setStatus("✓ Last pulled " + stamp + " (" + dateFrom + " → " + dateTo + ", " + (org || "SPA") + ")");
  return "✓ " + chunks.length + " chunk(s) pulled in " + elapsed + "s\n" +
         "  " + Object.keys(accRows).length + " (account,venue) row(s) merged\n" +
         "  " + stats.appended + " new row(s), " + stats.updated + " cell update(s), " + stats.protected + " protected cell(s) skipped";
}

// Returns true if a cell should be treated as a manual edit and skipped
// during overwrite. Two protection signals: yellow background OR red font.
// Either alone is sufficient — user uses both as ad-hoc edit markers.
function _isProtected(bgColor, fontColor) {
  var bg = String(bgColor || "").toLowerCase();
  var fg = String(fontColor || "").toLowerCase();
  if (bg === PROTECTED_BG_COLOR) return true;
  if (fg === PROTECTED_FONT_COLOR) return true;
  return false;
}

// Writes a one-line status into the control row's status cell. Safe even
// if the tab doesn't exist yet (no-op in that case).
function _setStatus(msg) {
  try {
    var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
    var sheet = ss.getSheetByName(EBIDA_TAB);
    if (!sheet) return;
    sheet.getRange(CONTROL_ROW, CTRL_STATUS_COL).setValue(msg);
    SpreadsheetApp.flush();
  } catch (e) { /* ignore */ }
}

// Helper for one-shot full-period local backfill from clasp test
function runPullNow() {
  var today = new Date();
  var todayStr = today.getFullYear() + "-" +
                 String(today.getMonth() + 1).padStart(2, "0") + "-" +
                 String(today.getDate()).padStart(2, "0");
  return pullAndWriteEbidaLayer("2025-01-01", todayStr, "SPA");
}

// Test wrapper: small 1-week window, SPA. Safe to clasp-run without args.
// Logs the result so the Apps Script Execution log shows the summary.
function runTestPullJan1to7() {
  var result = pullAndWriteEbidaLayer("2025-01-01", "2025-01-07", "SPA");
  Logger.log(result);
  return result;
}

// One-click reset: clears the existing Zoho Raw Layer tab content (but
// preserves the tab itself and any drawings/buttons on it) and runs the
// 1-week test pull. Use this after a layout change to rebuild content
// cleanly with the current schema without losing the assigned Pull button.
function resetAndRunTestPull() {
  var ss = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var existing = ss.getSheetByName(EBIDA_TAB);
  if (existing) {
    existing.clear();             // clears content + formatting; drawings/images survive
    existing.clearDataValidations();
    existing.setFrozenRows(0);    // reset frozen rows so next fresh-write applies cleanly
    existing.setFrozenColumns(0);
    Logger.log("Cleared existing '" + EBIDA_TAB + "' tab (button/drawing preserved).");
  } else {
    Logger.log("No existing '" + EBIDA_TAB + "' tab found.");
  }
  return runTestPullJan1to7();
}

// Reads From/To/Org from the control row at the top of the Zoho Raw Layer
// tab and triggers a pull. This is the function to assign to the in-sheet
// "Pull" button (Insert → Drawing → make a button → right-click → Assign
// script → pullFromSheetControls).
function pullFromSheetControls() {
  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB);
  if (!sheet) {
    SpreadsheetApp.getUi().alert(
      "Tab '" + EBIDA_TAB + "' doesn't exist yet. Use the EBIDA Layer menu to do a first pull " +
      "(or run runTestPullJan1to7) — that creates the tab with the control row.");
    return;
  }
  var fromVal = sheet.getRange(CONTROL_ROW, CTRL_FROM_COL).getValue();
  var toVal   = sheet.getRange(CONTROL_ROW, CTRL_TO_COL).getValue();
  var orgVal  = sheet.getRange(CONTROL_ROW, CTRL_ORG_COL).getValue();

  var fromStr = _coerceDateToIso(fromVal);
  var toStr   = _coerceDateToIso(toVal);
  var org     = String(orgVal || "SPA").trim();

  if (!fromStr || !toStr) {
    sheet.getRange(CONTROL_ROW, CTRL_STATUS_COL).setValue("Error: set From & To dates first");
    SpreadsheetApp.getUi().alert("Please set valid From and To dates in row " + CONTROL_ROW + " first.");
    return;
  }

  sheet.getRange(CONTROL_ROW, CTRL_STATUS_COL).setValue("Pulling " + fromStr + " → " + toStr + "…");
  SpreadsheetApp.flush();
  try {
    var result = pullAndWriteEbidaLayer(fromStr, toStr, org);
    var stamp  = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");
    sheet.getRange(CONTROL_ROW, CTRL_STATUS_COL).setValue("✓ Last pulled " + stamp);
    Logger.log(result);
    return result;
  } catch (e) {
    sheet.getRange(CONTROL_ROW, CTRL_STATUS_COL).setValue("Error: " + e.message);
    throw e;
  }
}

function _coerceDateToIso(v) {
  if (!v) return "";
  if (v instanceof Date && !isNaN(v.getTime())) {
    // Date objects from sheet cells are anchored to the SPREADSHEET's
    // timezone, not the script's. JS Date methods (getFullYear etc.) and
    // even Session.getScriptTimeZone() may disagree with the sheet TZ —
    // for example if the spreadsheet is Europe/Malta but Apps Script's
    // V8 runtime falls back to UTC for Date methods. Format explicitly
    // with the spreadsheet's TZ for a guaranteed-correct ISO date.
    var ssTz = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID).getSpreadsheetTimeZone();
    return Utilities.formatDate(v, ssTz, "yyyy-MM-dd");
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // Try common DD/MM/YYYY and MM/DD/YYYY
  var m = /^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/.exec(s);
  if (m) {
    // Assume DD/MM/YYYY (European, matches Malta locale)
    return m[3] + "-" + m[2].padStart(2, "0") + "-" + m[1].padStart(2, "0");
  }
  return "";
}

// ── Chunking ─────────────────────────────────────────────────────────────────

function _computeChunks(fromDate, toDate, chunkDays) {
  var out = [];
  var cursor = _parseISO(fromDate);
  var end    = _parseISO(toDate);
  while (cursor.getTime() <= end.getTime()) {
    var chunkEnd = new Date(cursor);
    chunkEnd.setUTCDate(chunkEnd.getUTCDate() + chunkDays - 1);
    if (chunkEnd.getTime() > end.getTime()) chunkEnd = new Date(end);
    out.push({ from: _isoDate(cursor), to: _isoDate(chunkEnd) });
    cursor = new Date(chunkEnd);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }
  return out;
}

function _fetchChunk(from, to, org) {
  var url = COCKPIT_BASE + "/api/finance/zoho-transactions-daily"
          + "?date_from=" + encodeURIComponent(from)
          + "&date_to="   + encodeURIComponent(to)
          + "&org="       + encodeURIComponent(org);
  var resp = UrlFetchApp.fetch(url, {
    method:             "get",
    muteHttpExceptions: true,
    headers:            { "Accept": "application/json" }
  });
  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code !== 200) {
    var msg = "API " + code + " for " + from + ".." + to + ": " + body.slice(0, 200);
    try { var e = JSON.parse(body); if (e.error) msg = "API " + code + " for " + from + ".." + to + ": " + e.error; } catch (_) { /* ignore */ }
    throw new Error(msg);
  }
  var data = JSON.parse(body);
  if (!Array.isArray(data.rows) || !Array.isArray(data.dates)) {
    throw new Error("Bad API response shape for " + from + ".." + to);
  }
  return data;
}

// ── Merge into sheet ────────────────────────────────────────────────────────

function _mergeIntoSheet(accRows, allDates, refreshFrom, refreshTo, org) {
  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB) || ss.insertSheet(EBIDA_TAB);
  var stats = { appended: 0, updated: 0, protected: 0 };

  // Empty / brand-new sheet OR no header at HEADER_ROW → write fresh (control row + header + data)
  if (sheet.getLastRow() < HEADER_ROW || String(sheet.getRange(HEADER_ROW, 1).getValue()).trim() !== "Brand") {
    _writeFreshSheet(sheet, accRows, allDates, refreshFrom, refreshTo, org);
    stats.appended = Object.keys(accRows).length;
    return stats;
  }

  // Snapshot current state (full sheet, including control + header + data rows)
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var values      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var backgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();
  var fontColors  = sheet.getRange(1, 1, lastRow, lastCol).getFontColors();
  var header      = values[HEADER_ROW - 1].map(function(v) { return String(v).trim(); });

  // Detect Venue column at HEADER_ROW (should always be present on this dedicated tab)
  var venueIdx = -1;
  for (var c = 0; c < Math.min(META_COUNT, header.length); c++) {
    if (header[c].toLowerCase() === "venue") { venueIdx = c; break; }
  }
  if (venueIdx === -1) {
    sheet.insertColumnAfter(4);
    sheet.getRange(HEADER_ROW, 5).setValue("Venue").setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
    var inferRows = [];
    for (var r = HEADER_ROW; r < values.length; r++) {
      var brand     = String(values[r][0]).trim();
      var lineItem  = String(values[r][1]).trim();
      var accCode   = String(values[r][2]).trim();
      var ebitdaCat = String(values[r][3]).trim();
      if (!brand) { inferRows.push([""]); continue; }
      if (brand && !lineItem && !accCode && !ebitdaCat) { inferRows.push([""]); continue; }
      inferRows.push([_inferVenueFromName(lineItem)]);
    }
    if (inferRows.length > 0) sheet.getRange(HEADER_ROW + 1, 5, inferRows.length, 1).setValues(inferRows);
    lastCol = sheet.getLastColumn();
    values      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    backgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();
    fontColors  = sheet.getRange(1, 1, lastRow, lastCol).getFontColors();
    header      = values[HEADER_ROW - 1].map(function(v) { return String(v).trim(); });
    venueIdx = 4;
  }

  // ── Step A: normalize date headers to TEXT format ──────────────────────
  // Sheets auto-converts "Jan-1 2025" string headers to Date objects when
  // a date format is auto-detected. That breaks dup-column detection on
  // subsequent pulls. Force the entire date-header range to "@" (text)
  // format and rewrite any existing Date-typed headers back to strings.
  if (lastCol > META_COUNT) {
    sheet.getRange(HEADER_ROW, META_COUNT + 1, 1, lastCol - META_COUNT).setNumberFormat("@");
  }
  var ssTzCached = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID).getSpreadsheetTimeZone();
  Logger.log("Spreadsheet timezone: " + ssTzCached);
  var normalizedAny = false;
  for (var c = META_COUNT; c < lastCol; c++) {
    var rawCell = values[HEADER_ROW - 1][c];
    if (rawCell instanceof Date && !isNaN(rawCell.getTime())) {
      var isoFromDate = Utilities.formatDate(rawCell, ssTzCached, "yyyy-MM-dd");
      var canonicalStr = _formatDateHeader(isoFromDate);
      sheet.getRange(HEADER_ROW, c + 1).setValue(canonicalStr);
      values[HEADER_ROW - 1][c] = canonicalStr;
      normalizedAny = true;
      Logger.log("Normalized Date header col " + (c + 1) + ": " + rawCell.toISOString() + " → '" + canonicalStr + "'");
    }
  }
  if (normalizedAny) {
    header = values[HEADER_ROW - 1].map(function(v) { return String(v).trim(); });
  }

  // ── Step B: dup detection on now-string headers ────────────────────────
  // Parse existing date columns. If a header is undated (e.g. "Jan-1"),
  // default its year to the pull window's "from" year — and rewrite the
  // header in canonical "Mon-D YYYY" format so future pulls don't need to
  // guess. Detect duplicates (multiple cols resolving to the same ISO date)
  // and consolidate values into the leftmost, blanking the duplicate(s).
  var refreshYear = parseInt(refreshFrom.slice(0, 4), 10);
  var dateToCol   = {};
  var headerRewrites = [];   // [{ col1based, value }]
  var dupColsToBlank = [];   // 0-indexed col indexes whose values move into leftmost
  Logger.log("Date-header scan (META_COUNT=" + META_COUNT + ", lastCol=" + lastCol + "):");
  for (var c = META_COUNT; c < header.length; c++) {
    var rawHeader = header[c];
    var iso = _parseDateHeader(rawHeader, refreshYear);
    Logger.log("  col " + (c + 1) + " header='" + rawHeader + "' (type=" + typeof rawHeader + ") → iso=" + iso);
    if (!iso) continue;
    if (iso in dateToCol) {
      Logger.log("    ↳ DUPLICATE of col " + (dateToCol[iso] + 1) + " — consolidating + marking for deletion");
      var leftCol = dateToCol[iso];
      for (var rr = HEADER_ROW; rr < values.length; rr++) {
        var dupVal = values[rr][c];
        if (dupVal === "" || dupVal == null) continue;
        var leftVal = values[rr][leftCol];
        if (_isProtected(backgrounds[rr][leftCol], fontColors[rr][leftCol])) continue;
        if (leftVal === "" || leftVal == null) {
          sheet.getRange(rr + 1, leftCol + 1).setValue(dupVal);
          values[rr][leftCol] = dupVal;
        }
      }
      dupColsToBlank.push(c);
    } else {
      dateToCol[iso] = c;
      var canonical = _formatDateHeader(iso);
      if (String(rawHeader).trim() !== canonical) {
        headerRewrites.push({ col1based: c + 1, value: canonical });
      }
    }
  }
  for (var hi = 0; hi < headerRewrites.length; hi++) {
    sheet.getRange(HEADER_ROW, headerRewrites[hi].col1based).setValue(headerRewrites[hi].value);
  }
  if (dupColsToBlank.length > 0) {
    dupColsToBlank.sort(function(a, b) { return b - a; });
    for (var di = 0; di < dupColsToBlank.length; di++) {
      sheet.deleteColumn(dupColsToBlank[di] + 1);
    }
    lastCol     = sheet.getLastColumn();
    values      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    backgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();
    fontColors  = sheet.getRange(1, 1, lastRow, lastCol).getFontColors();
    header      = values[HEADER_ROW - 1].map(function(v) { return String(v).trim(); });
    dateToCol = {};
    for (var c = META_COUNT; c < header.length; c++) {
      var iso2 = _parseDateHeader(header[c], refreshYear);
      if (iso2) dateToCol[iso2] = c;
    }
  }

  var missing = [];
  for (var i = 0; i < allDates.length; i++) {
    if (!(allDates[i] in dateToCol)) missing.push(allDates[i]);
  }
  if (missing.length > 0) {
    missing.sort();
    var insertAt = sheet.getLastColumn() + 1;
    sheet.insertColumnsAfter(sheet.getLastColumn(), missing.length);
    var headerCells = missing.map(_formatDateHeader);
    // Force text format BEFORE writing so Sheets doesn't auto-convert
    sheet.getRange(HEADER_ROW, insertAt, 1, missing.length).setNumberFormat("@");
    sheet.getRange(HEADER_ROW, insertAt, 1, missing.length).setValues([headerCells])
         .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
    Logger.log("Appended " + missing.length + " missing date col(s): " + missing.join(", "));
    if (lastRow > HEADER_ROW) {
      sheet.getRange(HEADER_ROW + 1, insertAt, lastRow - HEADER_ROW, missing.length).setNumberFormat("#,##0.00;(#,##0.00);-");
    }
    for (var mi = 0; mi < missing.length; mi++) {
      dateToCol[missing[mi]] = insertAt + mi - 1;
    }
    lastCol     = sheet.getLastColumn();
    values      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    backgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();
    fontColors  = sheet.getRange(1, 1, lastRow, lastCol).getFontColors();
    header      = values[HEADER_ROW - 1].map(function(v) { return String(v).trim(); });
  }

  // Refresh window date set
  var refreshDates = {};
  for (var i = 0; i < allDates.length; i++) {
    if (allDates[i] >= refreshFrom && allDates[i] <= refreshTo) refreshDates[allDates[i]] = true;
  }

  // Index existing rows by identity (start from first data row; skip section + blank rows)
  var existingRowKey = {};
  for (var r = HEADER_ROW; r < values.length; r++) {
    var brand     = String(values[r][0]).trim();
    var lineItem  = String(values[r][1]).trim();
    var accCode   = String(values[r][2]).trim();
    var ebitdaCat = String(values[r][3]).trim();
    var venue     = String(values[r][venueIdx]).trim();
    var contact   = String(values[r][CONTACT_COL_IDX] || "").trim();
    var alloc     = String(values[r][ALLOC_COL_IDX] || "").trim() || "split";
    if (!brand) continue;
    if (brand && !lineItem && !accCode && !ebitdaCat && !venue) continue;
    var venueSlug = _venueToSlug(venue);
    var key = brand + "|" + (accCode || lineItem) + "|" + venueSlug + "|" + contact + "|" + alloc;
    existingRowKey[key] = r;
  }

  // ── DIAGNOSTIC LOGGING ──────────────────────────────────────────────────
  Logger.log("=== MERGE DEBUG ===");
  Logger.log("Pull window: " + refreshFrom + " → " + refreshTo + " (org=" + org + ")");
  Logger.log("");
  Logger.log("Existing row keys in sheet (" + Object.keys(existingRowKey).length + "):");
  var existKeysSorted = Object.keys(existingRowKey).sort();
  for (var ei = 0; ei < existKeysSorted.length; ei++) {
    Logger.log("  EXIST  row " + (existingRowKey[existKeysSorted[ei]] + 1) + "  key=[" + existKeysSorted[ei] + "]");
  }
  Logger.log("");
  Logger.log("New pull keys (" + Object.keys(accRows).length + "):");
  var newKeysSorted = Object.keys(accRows).sort();
  for (var ni = 0; ni < newKeysSorted.length; ni++) {
    var matched = existingRowKey[newKeysSorted[ni]] != null ? "✓MATCH" : "✗NEW";
    Logger.log("  " + matched + "  key=[" + newKeysSorted[ni] + "]");
  }
  Logger.log("=== END DEBUG ===");

  // Apply per-row updates
  for (var key in accRows) {
    var newRow = accRows[key];
    var existingIdx = existingRowKey[key];
    if (existingIdx == null) continue;  // handled in append pass below
    for (var iso in refreshDates) {
      var colIdx = dateToCol[iso];
      if (colIdx == null) continue;
      if (_isProtected(backgrounds[existingIdx][colIdx], fontColors[existingIdx][colIdx])) {
        stats.protected++;
        continue;
      }
      var newVal = newRow.daily[iso];
      sheet.getRange(existingIdx + 1, colIdx + 1).setValue(newVal != null ? newVal : "");
      stats.updated++;
    }
  }

  // Clear existing rows that aren't in the new pull but have values in the refresh window
  for (var key in existingRowKey) {
    if (key in accRows) continue;
    var rowIdx = existingRowKey[key];
    for (var iso in refreshDates) {
      var colIdx = dateToCol[iso];
      if (colIdx == null) continue;
      var v = values[rowIdx][colIdx];
      if (v === "" || v == null) continue;
      if (_isProtected(backgrounds[rowIdx][colIdx], fontColors[rowIdx][colIdx])) {
        stats.protected++;
        continue;
      }
      sheet.getRange(rowIdx + 1, colIdx + 1).setValue("");
      stats.updated++;
    }
  }

  // Append new rows for (account, venue) combos not in sheet
  var newKeys = [];
  for (var key in accRows) {
    if (existingRowKey[key] == null) newKeys.push(key);
  }
  if (newKeys.length > 0) {
    newKeys.sort();  // stable order
    var rowsToAppend = [];
    for (var ki = 0; ki < newKeys.length; ki++) {
      var newRow = accRows[newKeys[ki]];
      var rowData = new Array(header.length).fill("");
      rowData[0] = newRow.brand;
      rowData[1] = newRow.line_item;
      rowData[2] = newRow.account_code;
      rowData[3] = newRow.ebitda_category;
      rowData[venueIdx] = newRow.venue;
      rowData[CONTACT_COL_IDX] = newRow.contact || "";
      rowData[ALLOC_COL_IDX] = newRow.allocation;
      for (var iso in newRow.daily) {
        var colIdx = dateToCol[iso];
        if (colIdx != null) rowData[colIdx] = newRow.daily[iso];
      }
      rowsToAppend.push(rowData);
    }
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rowsToAppend.length, header.length).setValues(rowsToAppend);
    if (header.length > META_COUNT) {
      sheet.getRange(startRow, META_COUNT + 1, rowsToAppend.length, header.length - META_COUNT)
           .setNumberFormat("#,##0.00;(#,##0.00);-");
    }
    stats.appended = rowsToAppend.length;
  }

  return stats;
}

// ── Fresh-sheet writer (only used if the tab is completely empty) ───────────

function _writeFreshSheet(sheet, accRows, allDates, refreshFrom, refreshTo, org) {
  var header = META_COLS.concat(allDates.map(_formatDateHeader));
  var totalCols = header.length;

  // Build the data block starting at HEADER_ROW
  var data = [header];

  var rows = [];
  for (var k in accRows) rows.push(accRows[k]);
  rows.sort(function(a, b) {
    if (a.brand !== b.brand) return a.brand.localeCompare(b.brand);
    if (a.ebitda_category !== b.ebitda_category) return a.ebitda_category.localeCompare(b.ebitda_category);
    if (a.line_item !== b.line_item) return a.line_item.localeCompare(b.line_item);
    return a.venue.localeCompare(b.venue);
  });

  var currentBrand = "";
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (r.brand !== currentBrand) {
      var sectionRow = new Array(totalCols).fill("");
      sectionRow[0] = r.brand;
      data.push(sectionRow);
      currentBrand = r.brand;
    }
    var dataRow = new Array(totalCols).fill("");
    dataRow[0] = r.brand;
    dataRow[1] = r.line_item;
    dataRow[2] = r.account_code;
    dataRow[3] = r.ebitda_category;
    dataRow[4] = r.venue;
    dataRow[CONTACT_COL_IDX] = r.contact || "";
    dataRow[ALLOC_COL_IDX] = r.allocation;
    for (var iso in r.daily) {
      var idx = META_COUNT + allDates.indexOf(iso);
      if (idx >= META_COUNT) dataRow[idx] = r.daily[iso];
    }
    data.push(dataRow);
  }

  // ── Control row at row 1 ─────────────────────────────────────────────────
  // Layout: A1 "Pull:" | B1 from-date | C1 "to" | D1 to-date | E1 "Org:" | F1 org | G1 (button placeholder) | H1 status
  var controlWidth = Math.max(totalCols, CTRL_STATUS_COL);
  sheet.getRange(CONTROL_ROW, 1, 1, controlWidth).clearContent();
  sheet.getRange(CONTROL_ROW, 1).setValue("Pull:").setFontWeight("bold");
  sheet.getRange(CONTROL_ROW, CTRL_FROM_COL).setValue(refreshFrom).setNumberFormat("yyyy-mm-dd").setBackground("#fff2cc");
  sheet.getRange(CONTROL_ROW, CTRL_FROM_COL + 1).setValue("to").setHorizontalAlignment("center");
  sheet.getRange(CONTROL_ROW, CTRL_TO_COL).setValue(refreshTo).setNumberFormat("yyyy-mm-dd").setBackground("#fff2cc");
  sheet.getRange(CONTROL_ROW, CTRL_ORG_COL - 1).setValue("Org:").setFontWeight("bold");
  sheet.getRange(CONTROL_ROW, CTRL_ORG_COL).setValue(org || "SPA").setBackground("#fff2cc");
  // Org dropdown
  var orgValidation = SpreadsheetApp.newDataValidation()
    .requireValueInList(["SPA", "Aesthetics"], true)
    .setAllowInvalid(false)
    .build();
  sheet.getRange(CONTROL_ROW, CTRL_ORG_COL).setDataValidation(orgValidation);
  // Status cell
  sheet.getRange(CONTROL_ROW, CTRL_STATUS_COL).setValue("Click the button to pull").setFontStyle("italic").setFontColor("#5f6368");
  sheet.setRowHeight(CONTROL_ROW, 32);

  // Spacer row 2 — leave blank

  // ── Data area: header at row 3 ───────────────────────────────────────────
  // Force text format on date headers FIRST so Sheets doesn't auto-convert
  // "Jan-1 2025" → Date object (which then defeats dup-column detection).
  if (allDates.length > 0) {
    sheet.getRange(HEADER_ROW, META_COUNT + 1, 1, allDates.length).setNumberFormat("@");
  }
  sheet.getRange(HEADER_ROW, 1, data.length, totalCols).setValues(data);
  sheet.getRange(HEADER_ROW, 1, 1, totalCols).setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");

  // Format brand section rows
  for (var r = 1; r < data.length; r++) {
    if (data[r][0] && !data[r][1] && !data[r][2]) {
      sheet.getRange(HEADER_ROW + r, 1, 1, totalCols).setBackground(BRAND_HEADER_BG).setFontColor(BRAND_HEADER_FG).setFontWeight("bold");
    }
  }
  if (allDates.length > 0) {
    sheet.getRange(HEADER_ROW + 1, META_COUNT + 1, data.length - 1, allDates.length)
         .setNumberFormat("#,##0.00;(#,##0.00);-");
  }
  sheet.setFrozenRows(HEADER_ROW);
  sheet.setFrozenColumns(META_COUNT);
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 280);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 140);
  sheet.setColumnWidth(6, 110);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function _capitalize(s) {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function _isoDate(d) {
  var y  = d.getUTCFullYear();
  var m  = String(d.getUTCMonth() + 1).padStart(2, "0");
  var dd = String(d.getUTCDate()).padStart(2, "0");
  return y + "-" + m + "-" + dd;
}

function _parseISO(s) {
  // Accepts "YYYY-MM-DD"; returns Date at UTC midnight
  return new Date(s + "T00:00:00Z");
}

function _formatDateHeader(iso) {
  var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso);
  if (!m) return iso;
  var mon = MONTH_NAMES[parseInt(m[2], 10) - 1];
  var day = parseInt(m[3], 10);
  return mon + "-" + day + " " + m[1];
}

function _parseDateHeader(raw, yearHint) {
  if (raw == null) return null;
  if (raw instanceof Date && !isNaN(raw.getTime())) {
    // Sheet-read Date objects are anchored to the spreadsheet's TZ, not UTC.
    // Using _isoDate() (UTC methods) would shift "Jan 1 midnight Malta" back
    // to "Dec 31" and make the dup-column detector fail, appending a fresh
    // column on every pull. Use spreadsheet TZ explicitly.
    var ssTz = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID).getSpreadsheetTimeZone();
    return Utilities.formatDate(raw, ssTz, "yyyy-MM-dd");
  }
  var s = String(raw).trim();
  if (!s) return null;
  // Already ISO?
  var iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (iso) return s;
  // "Jan-1 2025" / "Jan 1 2025" / "Jan-1, 2025" / "January-5 2025" / undated "Jan-1"
  var m = /^([A-Za-z]+)[\s\-]+(\d{1,2})(?:[,\s]+(\d{4}))?$/.exec(s);
  if (m) {
    var monAbbr = m[1].slice(0, 3).toLowerCase();
    var monNum  = MONTH_LOOKUP[monAbbr];
    var day     = parseInt(m[2], 10);
    var year    = m[3] ? parseInt(m[3], 10) : yearHint;
    if (!monNum || !day || !year) return null;
    return year + "-" + String(monNum).padStart(2, "0") + "-" + String(day).padStart(2, "0");
  }
  return null;
}

// Approximate Line-Item → venue slug for existing rows when migrating from
// the 4-col layout. Only used ONCE on the first run that inserts the Venue
// column; subsequent merges use the new pull's venue verbatim.
function _inferVenueFromName(name) {
  if (!name) return "";
  var low = String(name).toLowerCase();
  if (low.indexOf("hyatt")     >= 0) return "Hyatt";
  if (low.indexOf("hugo")      >= 0) return "Hugos";
  if (low.indexOf("inter")     >= 0) return "InterContinental";
  if (low.indexOf("ramla")     >= 0) return "Ramla";
  if (low.indexOf("labranda")  >= 0 || low.indexOf("riviera") >= 0) return "Labranda";
  if (low.indexOf("excelsior") >= 0) return "Excelsior";
  if (low.indexOf("novotel")   >= 0) return "Novotel";
  if (low.indexOf("sunny")     >= 0 || low.indexOf("odycy") >= 0 || low.indexOf("seashell") >= 0 || low.indexOf("qawra") >= 0) return "Sunny Coast";
  if (low.indexOf("aesthetic") >= 0 || low.indexOf("clinic") >= 0) return "Aesthetics";
  if (low.indexOf("slim")      >= 0) return "Slimming";
  return "";
}

// Display venue name → slug, for row-identity matching. Must mirror the
// SLUG_DISPLAY map in zoho-spa-breakdown.ts.
function _venueToSlug(venue) {
  if (!venue) return "";
  var v = String(venue).trim();
  var map = {
    "HQ":                  "hq",
    "InterContinental":    "intercontinental",
    "Hugos":               "hugos",
    "Hugo's":              "hugos",
    "Hyatt":               "hyatt",
    "Ramla Bay":           "ramla",
    "Ramla":               "ramla",
    "Labranda":            "labranda",
    "Sunny Coast (Odycy)": "sunny_coast",
    "Sunny Coast":         "sunny_coast",
    "Excelsior":           "excelsior",
    "Novotel":             "novotel",
    "Aesthetics":          "aesthetics",
    "Slimming":            "slimming",
  };
  if (v in map) return map[v];
  return v.toLowerCase().replace(/\s+/g, "_");
}
