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

var PROTECTED_COLOR = "#ffff00";   // exact-match yellow = "do not overwrite"
var CHUNK_DAYS      = 5;           // each API call covers <= this many days
var APPS_SCRIPT_BUDGET_MS = 5 * 60 * 1000;  // bail before hitting 6-min hard limit

var META_COLS  = ["Brand", "Line Item", "Account Code", "EBITDA Category", "Venue", "Allocation"];
var META_COUNT = META_COLS.length;
var ALLOC_COL_IDX = 5;   // 0-indexed — "tag" if Zoho line tag drove it, else the split rule name

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
      var key = row.brand + "|" + (row.account_code || row.account_name) + "|" + row.venue_slug + "|" + allocation;
      if (!accRows[key]) {
        accRows[key] = {
          brand:           row.brand,
          line_item:       row.account_name,
          account_code:    row.account_code || "",
          ebitda_category: _capitalize(row.ebitda_category),
          venue:           row.venue,
          venue_slug:      row.venue_slug,
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
  var stats    = _mergeIntoSheet(accRows, allDates, dateFrom, dateTo);

  var elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  return "✓ " + chunks.length + " chunk(s) pulled in " + elapsed + "s\n" +
         "  " + Object.keys(accRows).length + " (account,venue) row(s) merged\n" +
         "  " + stats.appended + " new row(s), " + stats.updated + " cell update(s), " + stats.protected + " protected cell(s) skipped";
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

function _mergeIntoSheet(accRows, allDates, refreshFrom, refreshTo) {
  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB) || ss.insertSheet(EBIDA_TAB);
  var stats = { appended: 0, updated: 0, protected: 0 };

  // Empty / brand-new sheet → write fresh
  if (sheet.getLastRow() === 0) {
    _writeFreshSheet(sheet, accRows, allDates);
    stats.appended = Object.keys(accRows).length;
    return stats;
  }

  // Snapshot current state
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var values      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var backgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();
  var header      = values[0].map(function(v) { return String(v).trim(); });

  // Detect Venue column (insert if missing)
  var venueIdx = -1;
  for (var c = 0; c < Math.min(META_COUNT, header.length); c++) {
    if (header[c].toLowerCase() === "venue") { venueIdx = c; break; }
  }
  if (venueIdx === -1) {
    // 4-col layout (existing user sheet) — insert Venue col at position 5 (after EBITDA Category)
    sheet.insertColumnAfter(4);
    sheet.getRange(1, 5).setValue("Venue").setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
    // Auto-infer venue for existing rows from line item name
    var inferRows = [];
    for (var r = 1; r < values.length; r++) {
      var brand     = String(values[r][0]).trim();
      var lineItem  = String(values[r][1]).trim();
      var accCode   = String(values[r][2]).trim();
      var ebitdaCat = String(values[r][3]).trim();
      // Skip brand-section rows and blanks
      if (!brand) { inferRows.push([""]); continue; }
      if (brand && !lineItem && !accCode && !ebitdaCat) { inferRows.push([""]); continue; }
      inferRows.push([_inferVenueFromName(lineItem)]);
    }
    if (inferRows.length > 0) sheet.getRange(2, 5, inferRows.length, 1).setValues(inferRows);
    // Re-snapshot
    lastCol = sheet.getLastColumn();
    values      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    backgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();
    header      = values[0].map(function(v) { return String(v).trim(); });
    venueIdx = 4;
  }

  // Parse existing date columns. If a header is undated (e.g. "Jan-1"),
  // default its year to the pull window's "from" year — and rewrite the
  // header in canonical "Mon-D YYYY" format so future pulls don't need to
  // guess. Detect duplicates (multiple cols resolving to the same ISO date)
  // and consolidate values into the leftmost, blanking the duplicate(s).
  var refreshYear = parseInt(refreshFrom.slice(0, 4), 10);
  var dateToCol   = {};
  var headerRewrites = [];   // [{ col1based, value }]
  var dupColsToBlank = [];   // 0-indexed col indexes whose values move into leftmost
  for (var c = META_COUNT; c < header.length; c++) {
    var rawHeader = header[c];
    var iso = _parseDateHeader(rawHeader, refreshYear);
    if (!iso) continue;
    if (iso in dateToCol) {
      // Duplicate — merge this col's values into the leftmost, then blank header
      var leftCol = dateToCol[iso];
      for (var rr = 1; rr < values.length; rr++) {
        var dupVal = values[rr][c];
        if (dupVal === "" || dupVal == null) continue;
        // Preserve leftmost cell if it's protected OR already has a value
        var leftVal = values[rr][leftCol];
        var leftBg  = backgrounds[rr][leftCol] || "";
        if (leftBg.toLowerCase() === PROTECTED_COLOR) continue;
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
  // Apply header rewrites
  for (var hi = 0; hi < headerRewrites.length; hi++) {
    sheet.getRange(1, headerRewrites[hi].col1based).setValue(headerRewrites[hi].value);
  }
  // Delete duplicate columns (in reverse so indices stay valid)
  if (dupColsToBlank.length > 0) {
    dupColsToBlank.sort(function(a, b) { return b - a; });
    for (var di = 0; di < dupColsToBlank.length; di++) {
      sheet.deleteColumn(dupColsToBlank[di] + 1);
    }
    // Re-snapshot after deletions (col indices for surviving date cols shift)
    lastCol     = sheet.getLastColumn();
    values      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    backgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();
    header      = values[0].map(function(v) { return String(v).trim(); });
    // Rebuild dateToCol from the post-deletion header
    dateToCol = {};
    for (var c = META_COUNT; c < header.length; c++) {
      var iso2 = _parseDateHeader(header[c], refreshYear);
      if (iso2) dateToCol[iso2] = c;
    }
  }

  // Append missing date columns (chronological sort applied at end)
  var missing = [];
  for (var i = 0; i < allDates.length; i++) {
    if (!(allDates[i] in dateToCol)) missing.push(allDates[i]);
  }
  if (missing.length > 0) {
    missing.sort();
    var insertAt = sheet.getLastColumn() + 1;
    sheet.insertColumnsAfter(sheet.getLastColumn(), missing.length);
    var headerCells = missing.map(_formatDateHeader);
    sheet.getRange(1, insertAt, 1, missing.length).setValues([headerCells])
         .setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");
    // Number format for the new daily cells
    if (lastRow >= 2) {
      sheet.getRange(2, insertAt, lastRow - 1, missing.length).setNumberFormat("#,##0.00;(#,##0.00);-");
    }
    for (var mi = 0; mi < missing.length; mi++) {
      dateToCol[missing[mi]] = insertAt + mi - 1;  // 0-indexed col
    }
    // Re-snapshot after inserts
    lastCol     = sheet.getLastColumn();
    values      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
    backgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();
    header      = values[0].map(function(v) { return String(v).trim(); });
  }

  // Refresh window date set
  var refreshDates = {};
  for (var i = 0; i < allDates.length; i++) {
    if (allDates[i] >= refreshFrom && allDates[i] <= refreshTo) refreshDates[allDates[i]] = true;
  }

  // Index existing rows by identity (skip brand-section + blank rows)
  var existingRowKey = {};
  for (var r = 1; r < values.length; r++) {
    var brand     = String(values[r][0]).trim();
    var lineItem  = String(values[r][1]).trim();
    var accCode   = String(values[r][2]).trim();
    var ebitdaCat = String(values[r][3]).trim();
    var venue     = String(values[r][venueIdx]).trim();
    var alloc     = String(values[r][ALLOC_COL_IDX] || "").trim() || "split";
    if (!brand) continue;
    if (brand && !lineItem && !accCode && !ebitdaCat && !venue) continue;
    var venueSlug = _venueToSlug(venue);
    var key = brand + "|" + (accCode || lineItem) + "|" + venueSlug + "|" + alloc;
    existingRowKey[key] = r;
  }

  // Apply per-row updates
  for (var key in accRows) {
    var newRow = accRows[key];
    var existingIdx = existingRowKey[key];
    if (existingIdx == null) continue;  // handled in append pass below
    for (var iso in refreshDates) {
      var colIdx = dateToCol[iso];
      if (colIdx == null) continue;
      var bg = backgrounds[existingIdx][colIdx] || "";
      if (bg.toLowerCase() === PROTECTED_COLOR) { stats.protected++; continue; }
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
      var bg = backgrounds[rowIdx][colIdx] || "";
      if (bg.toLowerCase() === PROTECTED_COLOR) { stats.protected++; continue; }
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

function _writeFreshSheet(sheet, accRows, allDates) {
  var header = META_COLS.concat(allDates.map(_formatDateHeader));
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
      var sectionRow = new Array(header.length).fill("");
      sectionRow[0] = r.brand;
      data.push(sectionRow);
      currentBrand = r.brand;
    }
    var dataRow = new Array(header.length).fill("");
    dataRow[0] = r.brand;
    dataRow[1] = r.line_item;
    dataRow[2] = r.account_code;
    dataRow[3] = r.ebitda_category;
    dataRow[4] = r.venue;
    dataRow[ALLOC_COL_IDX] = r.allocation;
    for (var iso in r.daily) {
      var idx = META_COUNT + allDates.indexOf(iso);
      if (idx >= META_COUNT) dataRow[idx] = r.daily[iso];
    }
    data.push(dataRow);
  }

  sheet.getRange(1, 1, data.length, header.length).setValues(data);
  sheet.getRange(1, 1, 1, header.length).setBackground(HEADER_BG).setFontColor(HEADER_FG).setFontWeight("bold");

  for (var r = 2; r <= data.length; r++) {
    if (data[r - 1][0] && !data[r - 1][1] && !data[r - 1][2]) {
      sheet.getRange(r, 1, 1, header.length).setBackground(BRAND_HEADER_BG).setFontColor(BRAND_HEADER_FG).setFontWeight("bold");
    }
  }
  if (allDates.length > 0) {
    sheet.getRange(2, META_COUNT + 1, data.length - 1, allDates.length)
         .setNumberFormat("#,##0.00;(#,##0.00);-");
  }
  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(META_COUNT);
  sheet.setColumnWidth(1, 80);
  sheet.setColumnWidth(2, 280);
  sheet.setColumnWidth(3, 90);
  sheet.setColumnWidth(4, 140);
  sheet.setColumnWidth(5, 140);
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
  if (raw instanceof Date && !isNaN(raw.getTime())) return _isoDate(raw);
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
