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
// On-sheet lock/unlock checkbox "buttons" (Option B — wired via installable onEdit)
var CTRL_LOCK_LABEL_COL    = 9;   // I1: "🔒 Lock data" label
var CTRL_LOCK_CHECKBOX_COL = 10;  // J1: checkbox — checking triggers lock
var CTRL_EDIT_LABEL_COL    = 11;  // K1: "🔓 Edit data" label
var CTRL_EDIT_CHECKBOX_COL = 12;  // L1: checkbox — checking triggers unlock

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
    .addItem("Pull Daily Granular from Zoho…",     "showEbidaLayerDialog")
    .addItem("Refresh Salary Supplement only…",    "showSalarySupplementDialog")
    .addSeparator()
    .addItem("Refresh Aggregated Data (full)",          "refreshAggregatedData")
    .addItem("Refresh Aggregated Data (range from B1/D1)", "refreshAggregatedDataFromControlRange")
    .addItem("Clean up false orange (matches source)",   "cleanupFalseOrange")
    .addSeparator()
    .addItem("Lock verified columns…",             "showLockVerifiedDialog")
    .addItem("Unlock verified columns…",           "showUnlockVerifiedDialog")
    .addSeparator()
    .addItem("Install on-sheet lock buttons (one-time)",         "installLockButtonsTrigger")
    .addItem("Install Aggregated Data override trigger (one-time)", "installAggregatedDataTrigger")
    .addToUi();
}

// ── Aggregated Data tab (working copy of Zoho Raw Layer for user overrides) ──
//
// "Aggregated Data" sits next to "Zoho Raw Layer" and starts as a 1-for-1
// copy. The user edits cells here when figures need to be overridden; the
// onEdit trigger paints any edited cell with AGGREGATED_OVERRIDE_BG so the
// refresh logic can preserve those edits on subsequent re-pulls from the
// raw layer.
var AGGREGATED_TAB              = "Aggregated Data";
var AGGREGATED_OVERRIDE_BG      = "#ffd966";   // orange — user override marker

// Top-level helper: convert 1-indexed column number to A1 letter notation.
// 1 → "A", 26 → "Z", 27 → "AA", 113 → "DI", 487 → "RY". Defined at
// top-level (not nested inside a function) so Apps Script V8 hoisting
// can't lose it across cached invocations.
function _ebidaColNumToA1(col) {
  var s = "";
  while (col > 0) {
    var rem = (col - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    col = Math.floor((col - 1) / 26);
  }
  return s;
}
// Aggregated Data tab's control row layout (row 1)
var AGG_CTRL_FROM_COL           = 2;   // B1 — From date for partial-range refresh
var AGG_CTRL_TO_COL             = 4;   // D1 — To date
var AGG_CTRL_REFRESH_LABEL_COL  = 9;   // I1 — "🔄 Refresh"
var AGG_CTRL_REFRESH_CHECKBOX   = 10;  // J1 — checkbox to trigger refresh
var AGG_CTRL_STATUS_COL         = 8;   // H1 — last-refresh status

// Full refresh — ignores control row dates, refreshes everything.
function refreshAggregatedData() {
  return _refreshAggregatedDataImpl(null, null);
}

// Range refresh — reads B1/D1 from the Aggregated Data tab; only touches
// date columns whose header falls inside that range. Cells in other date
// columns are left alone (untouched, no preserve-vs-update logic runs).
function refreshAggregatedDataFromControlRange() {
  var ss = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var dst = ss.getSheetByName(AGGREGATED_TAB);
  if (!dst) throw new Error("Aggregated Data tab not found — run a full refresh first to create it.");
  var fromVal = dst.getRange(CONTROL_ROW, AGG_CTRL_FROM_COL).getValue();
  var toVal   = dst.getRange(CONTROL_ROW, AGG_CTRL_TO_COL).getValue();
  var from    = _normalizeDateCell(fromVal);
  var to      = _normalizeDateCell(toVal);
  if (!from || !to) {
    throw new Error("Set From in B1 and To in D1 first (YYYY-MM-DD).");
  }
  if (from > to) throw new Error("From date must be on or before To date.");
  return _refreshAggregatedDataImpl(from, to);
}

function _normalizeDateCell(v) {
  if (!v) return null;
  if (v instanceof Date) {
    var ss = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
    return Utilities.formatDate(v, ss.getSpreadsheetTimeZone(), "yyyy-MM-dd");
  }
  var s = String(v).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return null;
}

// Core refresh — when (fromIso, toIso) supplied, restrict the refresh to date
// columns whose header falls in that range. Otherwise refresh every column.
function _refreshAggregatedDataImpl(fromIso, toIso) {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var src = ss.getSheetByName(EBIDA_TAB);
  if (!src) throw new Error("Source tab '" + EBIDA_TAB + "' not found.");

  var srcLastRow = src.getLastRow();
  var srcLastCol = src.getLastColumn();
  if (srcLastRow < HEADER_ROW || srcLastCol <= META_COUNT) {
    throw new Error("Source tab '" + EBIDA_TAB + "' has no data to copy.");
  }

  var dst = ss.getSheetByName(AGGREGATED_TAB);
  var firstTime = !dst;
  if (firstTime) {
    dst = ss.insertSheet(AGGREGATED_TAB);
    ss.setActiveSheet(dst);
    ss.moveActiveSheet(src.getIndex() + 1);
  }

  var srcRange = src.getRange(1, 1, srcLastRow, srcLastCol);
  var srcValues = srcRange.getValues();
  var srcFmts   = srcRange.getNumberFormats();

  if (firstTime) {
    dst.getRange(1, 1, srcLastRow, srcLastCol).setValues(srcValues);
    dst.getRange(1, 1, srcLastRow, srcLastCol).setNumberFormats(srcFmts);
    dst.setFrozenRows(HEADER_ROW);
    dst.setFrozenColumns(META_COUNT);
    _ensureAggregatedControlCells(dst);
    ui.alert("Aggregated Data created with " + (srcLastRow - HEADER_ROW) + " row(s) × " +
             (srcLastCol - META_COUNT) + " date column(s).\n\nUse B1/D1 + the J1 checkbox to do a date-range refresh.");
    return "Aggregated Data tab created — " + (srcLastRow - HEADER_ROW) + " rows copied from Zoho Raw Layer.";
  }

  _ensureAggregatedControlCells(dst);

  // Match destination size to source.
  var dstLastRow = dst.getLastRow();
  var dstLastCol = dst.getLastColumn();
  if (dstLastRow < srcLastRow) dst.insertRowsAfter(Math.max(dstLastRow, 1), srcLastRow - dstLastRow);
  if (dstLastCol < srcLastCol) dst.insertColumnsAfter(Math.max(dstLastCol, 1), srcLastCol - dstLastCol);

  var dstRange = dst.getRange(1, 1, srcLastRow, srcLastCol);
  var dstValues = dstRange.getValues();
  var dstBgs    = dstRange.getBackgrounds();

  // Build a set of column indices to refresh. If fromIso/toIso provided,
  // restrict to date columns whose header is in [fromIso, toIso]; otherwise
  // include EVERY column (meta + every date column).
  var refreshCols = {};
  var srcHeaderRow = srcValues[HEADER_ROW - 1];
  if (fromIso && toIso) {
    // Date-range mode: only touch matching date columns. Meta columns left alone.
    var headerYear = parseInt(fromIso.slice(0, 4), 10);
    for (var c = META_COUNT; c < srcLastCol; c++) {
      var iso = _parseDateHeader(srcHeaderRow[c], headerYear);
      if (!iso) continue;
      if (iso < fromIso || iso > toIso) continue;
      refreshCols[c] = true;
    }
  } else {
    // Full mode: every column in range.
    for (var c2 = 0; c2 < srcLastCol; c2++) refreshCols[c2] = true;
  }

  var matchedCols = Object.keys(refreshCols).length;
  if (fromIso && matchedCols === 0) {
    throw new Error("No date columns found in [" + fromIso + " → " + toIso + "].");
  }

  var updates = 0, preserved = 0;
  for (var r = 0; r < srcLastRow; r++) {
    for (var c3 in refreshCols) {
      var cIdx = parseInt(c3, 10);
      var dstBg = String(dstBgs[r][cIdx] || "").toLowerCase();
      if (dstBg === AGGREGATED_OVERRIDE_BG ||
          dstBg === PROTECTED_BG_COLOR ||
          dstBg === LOCKED_BG_COLOR) {
        preserved++;
        continue;
      }
      if (dstValues[r][cIdx] !== srcValues[r][cIdx]) {
        dst.getRange(r + 1, cIdx + 1).setValue(srcValues[r][cIdx]);
        updates++;
      }
    }
  }
  if (srcLastRow > HEADER_ROW && srcLastCol > META_COUNT) {
    dst.getRange(HEADER_ROW + 1, META_COUNT + 1, srcLastRow - HEADER_ROW, srcLastCol - META_COUNT)
       .setNumberFormat("#,##0.00;(#,##0.00);-");
  }

  var rangeDesc = fromIso ? (" [" + fromIso + " → " + toIso + ", " + matchedCols + " cols]") : " [full]";
  var msg = "Aggregated Data refreshed" + rangeDesc + " — " + updates + " cell update(s), " + preserved + " override cell(s) preserved.";
  dst.getRange(CONTROL_ROW, AGG_CTRL_STATUS_COL).setValue(msg);
  if (typeof e === "undefined" || !e) ui.alert(msg);
  return msg;
}

// Idempotent: populate B1/D1 placeholders + I1/J1 button + H1 status cell
// on the Aggregated Data tab so the user has visual controls.
function _ensureAggregatedControlCells(sheet) {
  var labelB = sheet.getRange(CONTROL_ROW, 1).getValue();
  if (!labelB || String(labelB).indexOf("Aggregated Data") === -1) {
    sheet.getRange(CONTROL_ROW, 1).setValue("Aggregated Data — overrides = orange").setFontWeight("bold");
  }
  // From / To labels + cells
  if (!sheet.getRange(CONTROL_ROW, AGG_CTRL_FROM_COL - 1).getValue()) {
    sheet.getRange(CONTROL_ROW, AGG_CTRL_FROM_COL - 1).setValue("From:").setFontWeight("bold").setHorizontalAlignment("right");
  }
  sheet.getRange(CONTROL_ROW, AGG_CTRL_FROM_COL).setNumberFormat("yyyy-mm-dd").setBackground("#fff2cc");
  if (!sheet.getRange(CONTROL_ROW, AGG_CTRL_TO_COL - 1).getValue()) {
    sheet.getRange(CONTROL_ROW, AGG_CTRL_TO_COL - 1).setValue("To:").setFontWeight("bold").setHorizontalAlignment("right");
  }
  sheet.getRange(CONTROL_ROW, AGG_CTRL_TO_COL).setNumberFormat("yyyy-mm-dd").setBackground("#fff2cc");
  // Refresh checkbox (J1) with label (I1)
  sheet.getRange(CONTROL_ROW, AGG_CTRL_REFRESH_LABEL_COL).setValue("🔄 Refresh")
    .setBackground("#e8f0fe").setFontColor("#1967d2").setFontWeight("bold")
    .setHorizontalAlignment("center");
  var cbCell = sheet.getRange(CONTROL_ROW, AGG_CTRL_REFRESH_CHECKBOX);
  cbCell.setDataValidation(SpreadsheetApp.newDataValidation().requireCheckbox().build());
  if (cbCell.getValue() !== true && cbCell.getValue() !== false) cbCell.setValue(false);
  // Status cell
  sheet.getRange(CONTROL_ROW, AGG_CTRL_STATUS_COL).setFontStyle("italic").setFontColor("#5f6368");
  sheet.setRowHeight(CONTROL_ROW, 32);
}

// onEdit handler — paint any cell the user changes in the Aggregated Data tab
// orange (#ffd966). Run as an installable trigger so we have authority to
// call setBackground (simple triggers can do this, but installable is more
// robust against re-auth issues).
// Normalises a cell value for "is this an override?" comparison. Empty,
// null, and "" all collapse to null. Numbers stay numbers; numeric-looking
// strings get parsed. Otherwise trimmed string.
function _normalizeCellValue(v) {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") {
    return isFinite(v) ? Math.round(v * 100) / 100 : null;   // round to cents to absorb float dust
  }
  var s = String(v).trim();
  if (s === "") return null;
  var n = parseFloat(s.replace(/,/g, ""));
  if (isFinite(n) && /^-?\d/.test(s)) return Math.round(n * 100) / 100;
  return s;
}

function onEditAggregatedData(e) {
  try {
    if (!e || !e.range) return;
    var sheet = e.range.getSheet();
    if (sheet.getName() !== AGGREGATED_TAB) return;
    var row = e.range.getRow();
    var col = e.range.getColumn();

    // J1 checkbox checked → run range refresh, then auto-uncheck.
    if (row === CONTROL_ROW && col === AGG_CTRL_REFRESH_CHECKBOX && e.value === "TRUE") {
      try {
        var result = refreshAggregatedDataFromControlRange();
        sheet.getRange(CONTROL_ROW, AGG_CTRL_STATUS_COL).setValue(result);
      } catch (innerErr) {
        sheet.getRange(CONTROL_ROW, AGG_CTRL_STATUS_COL).setValue("ERR: " + (innerErr.message || innerErr));
      } finally {
        sheet.getRange(CONTROL_ROW, AGG_CTRL_REFRESH_CHECKBOX).setValue(false);
      }
      return;
    }

    // Skip header rows + meta cols — overrides only make sense on data area.
    if (row < FIRST_DATA_ROW) return;
    if (col <= META_COUNT) return;

    // Compare the new value to the corresponding cell in Zoho Raw Layer.
    // ONLY paint orange when the user-supplied value actually differs from
    // the source — otherwise we'd flag accidental delete-then-untouched as
    // an override (false orange). If the value matches source, clear any
    // existing orange so the cell goes back to "in sync".
    var ss = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
    var src = ss.getSheetByName(EBIDA_TAB);
    if (!src) return;
    // Range edits (paste / clear-multi-cell) can cover many cells; handle each.
    var rng = e.range;
    var numR = rng.getNumRows();
    var numC = rng.getNumColumns();
    var dstVals = rng.getValues();
    var srcVals = src.getRange(rng.getRow(), rng.getColumn(), numR, numC).getValues();
    for (var rr = 0; rr < numR; rr++) {
      for (var cc = 0; cc < numC; cc++) {
        var dstCellRow = rng.getRow() + rr;
        var dstCellCol = rng.getColumn() + cc;
        if (dstCellRow < FIRST_DATA_ROW || dstCellCol <= META_COUNT) continue;
        var dstN = _normalizeCellValue(dstVals[rr][cc]);
        var srcN = _normalizeCellValue(srcVals[rr][cc]);
        var cell = sheet.getRange(dstCellRow, dstCellCol);
        if (dstN === srcN) {
          // Matches source — not a real override. Clear orange if present.
          var currentBg = String(cell.getBackground() || "").toLowerCase();
          if (currentBg === AGGREGATED_OVERRIDE_BG) cell.setBackground(null);
        } else {
          cell.setBackground(AGGREGATED_OVERRIDE_BG);
        }
      }
    }
  } catch (err) {
    Logger.log("onEditAggregatedData error: " + err);
  }
}

// Sweep the Aggregated Data tab and clear "false orange" — cells currently
// painted orange whose value matches Zoho Raw Layer at the same position.
// Useful one-shot cleanup if accidental edits (e.g., delete + retype) left
// stale orange marks behind from before the fix.
function cleanupFalseOrange() {
  var ui = SpreadsheetApp.getUi();
  var ss = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var dst = ss.getSheetByName(AGGREGATED_TAB);
  var src = ss.getSheetByName(EBIDA_TAB);
  if (!dst || !src) throw new Error("Aggregated Data or Zoho Raw Layer tab not found.");

  var lastRow = Math.max(dst.getLastRow(), src.getLastRow());
  var lastCol = Math.max(dst.getLastColumn(), src.getLastColumn());
  if (lastRow < FIRST_DATA_ROW || lastCol <= META_COUNT) {
    ui.alert("Nothing to scan — sheets are empty.");
    return;
  }

  var dstVals = dst.getRange(1, 1, lastRow, lastCol).getValues();
  var dstBgs  = dst.getRange(1, 1, lastRow, lastCol).getBackgrounds();
  var srcVals = src.getRange(1, 1, Math.min(src.getLastRow(), lastRow),
                                    Math.min(src.getLastColumn(), lastCol)).getValues();
  var cleared = 0, kept = 0;
  for (var r = FIRST_DATA_ROW - 1; r < lastRow; r++) {
    for (var c = META_COUNT; c < lastCol; c++) {
      var bg = String(dstBgs[r] && dstBgs[r][c] || "").toLowerCase();
      if (bg !== AGGREGATED_OVERRIDE_BG) continue;
      var srcVal = (srcVals[r] && srcVals[r][c] !== undefined) ? srcVals[r][c] : "";
      var dstN = _normalizeCellValue(dstVals[r][c]);
      var srcN = _normalizeCellValue(srcVal);
      if (dstN === srcN) {
        dst.getRange(r + 1, c + 1).setBackground(null);
        cleared++;
      } else {
        kept++;
      }
    }
  }
  var msg = "False-orange cleanup — cleared " + cleared + " cell(s); kept " + kept + " real override(s).";
  dst.getRange(CONTROL_ROW, AGG_CTRL_STATUS_COL).setValue(msg);
  ui.alert(msg);
  return msg;
}

// One-time installer for the onEdit trigger on Aggregated Data tab.
function installAggregatedDataTrigger() {
  var existing = ScriptApp.getProjectTriggers();
  for (var i = 0; i < existing.length; i++) {
    if (existing[i].getHandlerFunction() === "onEditAggregatedData") {
      ScriptApp.deleteTrigger(existing[i]);
    }
  }
  ScriptApp.newTrigger("onEditAggregatedData")
    .forSpreadsheet(EBIDA_SPREADSHEET_ID)
    .onEdit()
    .create();
  SpreadsheetApp.getUi().alert("Aggregated Data override trigger installed.\nAny edit on the 'Aggregated Data' tab will now auto-paint the cell orange (#ffd966).");
}

// Light-yellow background applied to locked cells. Chosen because:
//   • #fff9c4 is visually distinct from the existing manual-edit yellow (#ffff00)
//   • The protection-detection helper _isProtected() compares background to
//     PROTECTED_BG_COLOR (#ffff00) via string equality — #fff9c4 does NOT
//     equal #ffff00, so locked cells are NOT misclassified as manual edits.
//   • Visible enough to communicate locked state to a human reader.
var LOCKED_BG_COLOR        = "#fff9c4";
var LOCKED_DESC_PREFIX     = "Locked: verified";

// ── Lock / Unlock verified columns ───────────────────────────────────────────
// Once a month's data is reconciled to Zoho P&L + POS, lockVerifiedColumns
// is used to HARD-protect every date column in [from..to] inclusive so the
// next merge pass cannot overwrite verified figures. Unlock is the inverse,
// gated behind a YES/NO confirmation since it's the destructive direction.

var LOCK_DIALOG_CSS = '<style>' +
  'body{font-family:Google Sans,Arial,sans-serif;padding:20px;margin:0;font-size:13px;color:#202124}' +
  'h3{margin:0 0 6px;font-size:15px;color:#1a73e8}' +
  'p{margin:0 0 14px;color:#5f6368;font-size:12px;line-height:1.5}' +
  'label{display:block;font-weight:600;margin-bottom:4px;font-size:12px}' +
  'input[type=date],input[type=email]{width:100%;padding:7px 9px;border:1px solid #dadce0;border-radius:4px;font-size:13px;margin-bottom:14px;box-sizing:border-box;outline:none;background:#fff}' +
  'input[type=date]:focus,input[type=email]:focus{border-color:#1a73e8}' +
  'button{width:100%;background:#1a73e8;color:#fff;border:none;padding:9px 16px;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.15s}' +
  'button:hover{background:#1557b0}' +
  'button:disabled{opacity:0.55;cursor:not-allowed}' +
  'button.danger{background:#c5221f}' +
  'button.danger:hover{background:#a50e0e}' +
  '#status{margin-top:12px;padding:8px 10px;border-radius:4px;font-size:12px;display:none;white-space:pre-wrap}' +
  '.info{background:#e8f0fe;color:#1967d2}' +
  '.ok{background:#e6f4ea;color:#137333}' +
  '.warn{background:#fef7e0;color:#b06000}' +
  '.err{background:#fce8e6;color:#c5221f}' +
  '.note{font-size:11px;color:#5f6368;margin-top:-10px;margin-bottom:14px;line-height:1.4}' +
  '</style>';

var LOCK_DIALOG_HTML = '<!DOCTYPE html><html><head><base target="_top">' + LOCK_DIALOG_CSS + '</head><body>' +
  '<h3>Lock verified columns</h3>' +
  '<p>Hard-locks every date column whose header falls within [From, To] inclusive so the next Zoho merge cannot overwrite it. Light-yellow (#fff9c4) background marks locked cells.</p>' +
  '<label>From</label><input type="date" id="df"/>' +
  '<label>To</label><input type="date" id="dt"/>' +
  '<label>Editor email (optional)</label><input type="email" id="ed" placeholder="leave blank for active user"/>' +
  '<div class="note">Only this email retains edit rights on locked ranges.</div>' +
  '<button id="btn" onclick="go()">Lock columns</button>' +
  '<div id="status"></div>' +
  '<script>' +
  'function go(){' +
  '  var df=document.getElementById("df").value,dt=document.getElementById("dt").value,ed=document.getElementById("ed").value;' +
  '  if(!df||!dt){show("Please select both dates.","err");return;}' +
  '  document.getElementById("btn").disabled=true;' +
  '  show("Locking columns…","info");' +
  '  google.script.run' +
  '    .withSuccessHandler(function(r){show(r,"ok");document.getElementById("btn").disabled=false;})' +
  '    .withFailureHandler(function(e){show("Error: "+e.message,"err");document.getElementById("btn").disabled=false;})' +
  '    .lockVerifiedColumns(df,dt,ed);' +
  '}' +
  'function show(msg,cls){var el=document.getElementById("status");el.textContent=msg;el.className=cls;el.style.display="block";}' +
  '<\/script></body></html>';

var UNLOCK_DIALOG_HTML = '<!DOCTYPE html><html><head><base target="_top">' + LOCK_DIALOG_CSS + '</head><body>' +
  '<h3>Unlock verified columns</h3>' +
  '<p>Removes the hard-lock + light-yellow background from every column in [From, To] whose protection description starts with "' + LOCKED_DESC_PREFIX + '". You will be asked to confirm before any change is applied.</p>' +
  '<label>From</label><input type="date" id="df"/>' +
  '<label>To</label><input type="date" id="dt"/>' +
  '<button id="btn" class="danger" onclick="go()">Unlock columns</button>' +
  '<div id="status"></div>' +
  '<script>' +
  'function go(){' +
  '  var df=document.getElementById("df").value,dt=document.getElementById("dt").value;' +
  '  if(!df||!dt){show("Please select both dates.","err");return;}' +
  '  document.getElementById("btn").disabled=true;' +
  '  show("Unlocking…","info");' +
  '  google.script.run' +
  '    .withSuccessHandler(function(r){show(r,"ok");document.getElementById("btn").disabled=false;})' +
  '    .withFailureHandler(function(e){show("Error: "+e.message,"err");document.getElementById("btn").disabled=false;})' +
  '    .unlockVerifiedColumns(df,dt);' +
  '}' +
  'function show(msg,cls){var el=document.getElementById("status");el.textContent=msg;el.className=cls;el.style.display="block";}' +
  '<\/script></body></html>';

function showLockVerifiedDialog() {
  var html = HtmlService.createHtmlOutput(LOCK_DIALOG_HTML).setWidth(380).setHeight(460);
  SpreadsheetApp.getUi().showModalDialog(html, "Lock verified columns");
}

function showUnlockVerifiedDialog() {
  var html = HtmlService.createHtmlOutput(UNLOCK_DIALOG_HTML).setWidth(380).setHeight(380);
  SpreadsheetApp.getUi().showModalDialog(html, "Unlock verified columns");
}

// Locks every date column on the Zoho Raw Layer tab whose HEADER_ROW date
// header parses (via _parseDateHeader, same helper used by the merge) to a
// date in [fromDateIso, toDateIso] inclusive. Each matched column has its
// data range (FIRST_DATA_ROW … last row) protected so only `editorEmail`
// (or the active user) can edit it, and gets a light-yellow (#fff9c4)
// background as a visual cue. Hard lock — warningOnly = false.
function lockVerifiedColumns(fromDateIso, toDateIso, editorEmail) {
  if (!fromDateIso || !toDateIso) throw new Error("From and To dates are required.");
  if (fromDateIso > toDateIso)    throw new Error("From date must be on or before To date.");

  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB);
  if (!sheet) throw new Error("Tab '" + EBIDA_TAB + "' not found.");

  var ownerEmail = (editorEmail && String(editorEmail).trim()) ||
                   (Session.getActiveUser() && Session.getActiveUser().getEmail()) ||
                   "";
  if (!ownerEmail) {
    try { ownerEmail = ss.getOwner() && ss.getOwner().getEmail(); } catch (_) { /* ignore */ }
  }
  if (!ownerEmail) throw new Error("Could not determine an editor email to keep on the locked range.");

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < FIRST_DATA_ROW) throw new Error("Sheet has no data rows yet — nothing to lock.");
  if (lastCol <= META_COUNT)    throw new Error("Sheet has no date columns yet — nothing to lock.");

  var headerVals = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var refreshYear = parseInt(fromDateIso.slice(0, 4), 10);

  var matchedCols = [];   // 1-indexed column numbers
  var matchedIsos = [];
  for (var c = META_COUNT; c < headerVals.length; c++) {
    var iso = _parseDateHeader(headerVals[c], refreshYear);
    if (!iso) continue;
    if (iso < fromDateIso || iso > toDateIso) continue;
    matchedCols.push(c + 1);
    matchedIsos.push(iso);
  }

  if (matchedCols.length === 0) {
    return "No date columns found in window " + fromDateIso + " → " + toDateIso + ". Nothing locked.";
  }

  var numRows = lastRow - FIRST_DATA_ROW + 1;

  // OPT 1 — find columns ALREADY protected so we can skip them (idempotent
  // retry). For a 487-column range, this turns a re-run from "minutes" into
  // "seconds" because we only touch the columns that weren't locked yet.
  var existingProtCols = {};
  var allProts = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  for (var pi = 0; pi < allProts.length; pi++) {
    var prot = allProts[pi];
    var pRng = prot.getRange();
    if (!pRng) continue;
    if (pRng.getRow() !== FIRST_DATA_ROW) continue;     // not a date-column protection
    if (pRng.getNumColumns() !== 1) continue;
    existingProtCols[pRng.getColumn()] = true;
  }

  // OPT 2 — batch-paint backgrounds for matched columns not already
  // painted. Uses the top-level _ebidaColNumToA1 helper (defined below
  // outside any function) so hoisting/caching can't break it.
  var paintRanges = [];
  for (var pj = 0; pj < matchedCols.length; pj++) {
    var c1 = matchedCols[pj];
    if (existingProtCols[c1]) continue;
    var letter = _ebidaColNumToA1(c1);
    var a1 = letter + FIRST_DATA_ROW + ":" + letter + lastRow;
    paintRanges.push(a1);
  }
  if (paintRanges.length > 0) {
    sheet.getRangeList(paintRanges).setBackground(LOCKED_BG_COLOR);
  }

  // OPT 3 — get spreadsheet editor list ONCE rather than 487 times
  var ssEditors = ss.getEditors();
  var ssEditorEmails = [];
  for (var sei = 0; sei < ssEditors.length; sei++) {
    var em = ssEditors[sei].getEmail();
    if (em && em.toLowerCase() !== ownerEmail.toLowerCase()) {
      ssEditorEmails.push(em);
    }
  }

  var lockedCount = 0;
  var skippedCount = 0;
  for (var i = 0; i < matchedCols.length; i++) {
    var col   = matchedCols[i];
    if (existingProtCols[col]) { skippedCount++; continue; }
    var range = sheet.getRange(FIRST_DATA_ROW, col, numRows, 1);
    var protection = range.protect()
      .setDescription(LOCKED_DESC_PREFIX + " " + fromDateIso + " → " + toDateIso)
      .setWarningOnly(false);
    if (ssEditorEmails.length > 0) {
      try { protection.removeEditors(ssEditorEmails); } catch (e) { /* owner cannot be removed; ignore */ }
    }
    lockedCount++;
  }
  SpreadsheetApp.flush();
  Logger.log("lockVerifiedColumns: locked " + lockedCount + " column(s); " + skippedCount + " already locked, skipped.");

  Logger.log("lockVerifiedColumns: locked " + lockedCount + " column(s) for " +
             fromDateIso + " → " + toDateIso + " (editor=" + ownerEmail + ")");

  return "✓ Locked " + lockedCount + " column(s) for " + fromDateIso + " → " + toDateIso +
         "\n   editor: " + ownerEmail +
         "\n   columns: " + matchedIsos.join(", ");
}

// Walks every RANGE protection on the Zoho Raw Layer tab; if the
// description starts with LOCKED_DESC_PREFIX and the protected range
// overlaps any column in [from..to], removes the protection and clears
// the light-yellow background. Confirms via YES/NO before doing anything.
function unlockVerifiedColumns(fromDateIso, toDateIso) {
  if (!fromDateIso || !toDateIso) throw new Error("From and To dates are required.");
  if (fromDateIso > toDateIso)    throw new Error("From date must be on or before To date.");

  var ui   = SpreadsheetApp.getUi();
  var resp = ui.alert(
    "Unlock verified columns?",
    "This will REMOVE the hard-lock on every column in '" + EBIDA_TAB +
    "' whose protection covers a date in " + fromDateIso + " → " + toDateIso +
    ".\n\nLocked cells will revert to editable state and lose their light-yellow background. " +
    "Subsequent Zoho merges will be free to overwrite them.\n\nContinue?",
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) {
    return "Cancelled — no protections removed.";
  }

  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB);
  if (!sheet) throw new Error("Tab '" + EBIDA_TAB + "' not found.");

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < FIRST_DATA_ROW || lastCol <= META_COUNT) {
    return "Sheet is empty — nothing to unlock.";
  }

  var headerVals = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var refreshYear = parseInt(fromDateIso.slice(0, 4), 10);
  // Map column number (1-indexed) → iso, for columns whose header falls in window
  var colIso = {};
  for (var c = META_COUNT; c < headerVals.length; c++) {
    var iso = _parseDateHeader(headerVals[c], refreshYear);
    if (!iso) continue;
    if (iso < fromDateIso || iso > toDateIso) continue;
    colIso[c + 1] = iso;
  }

  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var removedCount   = 0;
  var clearedColsSet = {};

  for (var pi = 0; pi < protections.length; pi++) {
    var prot = protections[pi];
    var desc = String(prot.getDescription() || "");
    if (desc.indexOf(LOCKED_DESC_PREFIX) !== 0) continue;
    var pr = prot.getRange();
    var pStartCol = pr.getColumn();
    var pNumCols  = pr.getNumColumns();
    var overlaps = false;
    for (var k = 0; k < pNumCols; k++) {
      if ((pStartCol + k) in colIso) { overlaps = true; break; }
    }
    if (!overlaps) continue;
    for (var k2 = 0; k2 < pNumCols; k2++) {
      var colN = pStartCol + k2;
      if (colN in colIso) clearedColsSet[colN] = true;
    }
    prot.remove();
    removedCount++;
  }

  // Clear the light-yellow background on every column that was unlocked.
  var numRows = lastRow - FIRST_DATA_ROW + 1;
  var clearedCols = Object.keys(clearedColsSet).map(function(s) { return parseInt(s, 10); });
  clearedCols.sort(function(a, b) { return a - b; });
  for (var ci = 0; ci < clearedCols.length; ci++) {
    var rng = sheet.getRange(FIRST_DATA_ROW, clearedCols[ci], numRows, 1);
    var bgs = rng.getBackgrounds();
    var changed = false;
    for (var rr = 0; rr < bgs.length; rr++) {
      if (String(bgs[rr][0]).toLowerCase() === LOCKED_BG_COLOR) {
        bgs[rr][0] = "#ffffff";   // reset to white
        changed = true;
      }
    }
    if (changed) rng.setBackgrounds(bgs);
  }
  SpreadsheetApp.flush();

  Logger.log("unlockVerifiedColumns: removed " + removedCount + " protection(s); cleared " +
             clearedCols.length + " column background(s) for " + fromDateIso + " → " + toDateIso);

  if (removedCount === 0) {
    return "No matching protections found in " + fromDateIso + " → " + toDateIso + ".";
  }
  return "✓ Removed " + removedCount + " protection(s) and cleared " + clearedCols.length +
         " column background(s) for " + fromDateIso + " → " + toDateIso + ".";
}

// Silent twin of unlockVerifiedColumns — same logic, but no ui.alert confirm
// prompt. Used by the on-sheet checkbox trigger (where the act of checking
// the box IS the user's confirmation, and an installable onEdit cannot
// reliably open a dialog without raising an authorization scope). Mirrors
// unlockVerifiedColumns exactly aside from the missing prompt — keep them
// in sync if you change one.
function unlockVerifiedColumnsSilent(fromDateIso, toDateIso) {
  if (!fromDateIso || !toDateIso) throw new Error("From and To dates are required.");
  if (fromDateIso > toDateIso)    throw new Error("From date must be on or before To date.");

  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB);
  if (!sheet) throw new Error("Tab '" + EBIDA_TAB + "' not found.");

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < FIRST_DATA_ROW || lastCol <= META_COUNT) {
    return "Sheet is empty — nothing to unlock.";
  }

  var headerVals = sheet.getRange(HEADER_ROW, 1, 1, lastCol).getValues()[0];
  var refreshYear = parseInt(fromDateIso.slice(0, 4), 10);
  var colIso = {};
  for (var c = META_COUNT; c < headerVals.length; c++) {
    var iso = _parseDateHeader(headerVals[c], refreshYear);
    if (!iso) continue;
    if (iso < fromDateIso || iso > toDateIso) continue;
    colIso[c + 1] = iso;
  }

  var protections = sheet.getProtections(SpreadsheetApp.ProtectionType.RANGE);
  var removedCount   = 0;
  var clearedColsSet = {};

  for (var pi = 0; pi < protections.length; pi++) {
    var prot = protections[pi];
    var desc = String(prot.getDescription() || "");
    if (desc.indexOf(LOCKED_DESC_PREFIX) !== 0) continue;
    var pr = prot.getRange();
    var pStartCol = pr.getColumn();
    var pNumCols  = pr.getNumColumns();
    var overlaps = false;
    for (var k = 0; k < pNumCols; k++) {
      if ((pStartCol + k) in colIso) { overlaps = true; break; }
    }
    if (!overlaps) continue;
    for (var k2 = 0; k2 < pNumCols; k2++) {
      var colN = pStartCol + k2;
      if (colN in colIso) clearedColsSet[colN] = true;
    }
    prot.remove();
    removedCount++;
  }

  var numRows = lastRow - FIRST_DATA_ROW + 1;
  var clearedCols = Object.keys(clearedColsSet).map(function(s) { return parseInt(s, 10); });
  clearedCols.sort(function(a, b) { return a - b; });
  for (var ci = 0; ci < clearedCols.length; ci++) {
    var rng = sheet.getRange(FIRST_DATA_ROW, clearedCols[ci], numRows, 1);
    var bgs = rng.getBackgrounds();
    var changed = false;
    for (var rr = 0; rr < bgs.length; rr++) {
      if (String(bgs[rr][0]).toLowerCase() === LOCKED_BG_COLOR) {
        bgs[rr][0] = "#ffffff";
        changed = true;
      }
    }
    if (changed) rng.setBackgrounds(bgs);
  }
  SpreadsheetApp.flush();

  Logger.log("unlockVerifiedColumnsSilent: removed " + removedCount + " protection(s); cleared " +
             clearedCols.length + " column background(s) for " + fromDateIso + " → " + toDateIso);

  if (removedCount === 0) {
    return "No matching protections found in " + fromDateIso + " → " + toDateIso + ".";
  }
  return "✓ Removed " + removedCount + " protection(s) and cleared " + clearedCols.length +
         " column background(s) for " + fromDateIso + " → " + toDateIso + ".";
}

// ── On-sheet lock/unlock checkbox "buttons" ──────────────────────────────────
// Adds two checkboxes to row 1 of the Zoho Raw Layer tab so the user can
// lock/unlock the [B1, D1] window without opening a dialog. Wired via an
// installable onEdit trigger (`onEditLockButtons`) installed by
// `installLockButtonsTrigger`. The checkbox auto-resets to FALSE after the
// action runs — it behaves as a button, not a persistent state.

// Idempotent: writes the I1/K1 labels and J1/L1 checkboxes only if I1 is
// not already populated with the lock label. Safe to call from both
// `_writeFreshSheet` (brand-new tab) and `pullFromSheetControls` (existing
// tab gets the buttons retroactively on its next pull).
function _ensureLockButtonCells(sheet) {
  if (!sheet) return;
  try {
    var existing = String(sheet.getRange(CONTROL_ROW, CTRL_LOCK_LABEL_COL).getValue() || "").trim();
    if (existing.indexOf("Lock data") !== -1) return;  // already installed

    sheet.getRange(CONTROL_ROW, CTRL_LOCK_LABEL_COL)
      .setValue("🔒 Lock data")
      .setBackground(HEADER_BG)
      .setFontColor(HEADER_FG)
      .setFontWeight("bold")
      .setHorizontalAlignment("center");

    var checkboxRule = SpreadsheetApp.newDataValidation().requireCheckbox().build();
    sheet.getRange(CONTROL_ROW, CTRL_LOCK_CHECKBOX_COL)
      .setDataValidation(checkboxRule)
      .setValue(false)
      .setHorizontalAlignment("center");

    sheet.getRange(CONTROL_ROW, CTRL_EDIT_LABEL_COL)
      .setValue("🔓 Edit data")
      .setBackground(HEADER_BG)
      .setFontColor(HEADER_FG)
      .setFontWeight("bold")
      .setHorizontalAlignment("center");

    sheet.getRange(CONTROL_ROW, CTRL_EDIT_CHECKBOX_COL)
      .setDataValidation(checkboxRule)
      .setValue(false)
      .setHorizontalAlignment("center");
  } catch (e) {
    Logger.log("_ensureLockButtonCells: " + e.message);
  }
}

// Installable onEdit trigger handler. Bails on every edit that isn't on
// the Zoho Raw Layer tab + row 1 + J1/L1. On a J1 check, runs
// lockVerifiedColumns over the B1..D1 window. On an L1 check, runs the
// silent unlock twin. In both cases the checkbox is reset to false so it
// acts like a momentary button.
function onEditLockButtons(e) {
  if (!e || !e.range) return;
  var sheet;
  try { sheet = e.range.getSheet(); } catch (_) { return; }
  if (!sheet || sheet.getName() !== EBIDA_TAB) return;

  // Auto-revert manual edits to locked cells. The protection blocks other
  // users hard, but the owner (who must remain an editor so the Web App
  // pull can write) can technically still type into locked cells. Catch
  // that here and snap the cell back. Programmatic merge writes don't
  // fire onEdit, so this only fires on UI-driven user edits.
  if (e.range.getRow() >= FIRST_DATA_ROW && e.range.getColumn() > META_COUNT) {
    try {
      var bg = String(e.range.getBackground() || "").toLowerCase();
      if (bg === LOCKED_BG_COLOR) {
        if (e.oldValue !== undefined && e.range.getNumRows() === 1 && e.range.getNumColumns() === 1) {
          // Single-cell edit — we have the original value, restore it.
          e.range.setValue(e.oldValue);
        } else {
          // Multi-cell paste/clear — Apps Script doesn't give us the
          // originals. Clear the new values so at minimum the locked
          // figures are not corrupted with wrong data.
          e.range.clearContent();
        }
        SpreadsheetApp.getActiveSpreadsheet().toast(
          "Locked cells in Zoho Raw Layer are read-only. " +
          "Use the L1 'Edit data' checkbox to unlock the range first.",
          "Edit reverted",
          5
        );
        return;
      }
    } catch (revertErr) {
      Logger.log("onEditLockButtons revert error: " + revertErr);
    }
  }

  if (e.range.getRow() !== CONTROL_ROW) return;

  var col = e.range.getColumn();
  if (col !== CTRL_LOCK_CHECKBOX_COL && col !== CTRL_EDIT_CHECKBOX_COL) return;

  var newVal = e.value;
  // Apps Script delivers e.value as the string "TRUE"/"FALSE" for checkboxes.
  var isTrue = (newVal === true) || (String(newVal).toUpperCase() === "TRUE");
  if (!isTrue) return;  // ignore the auto-reset → false echo

  // Reset the checkbox immediately so the user sees it pop back to unchecked.
  sheet.getRange(CONTROL_ROW, col).setValue(false);
  SpreadsheetApp.flush();

  var fromVal = sheet.getRange(CONTROL_ROW, CTRL_FROM_COL).getValue();
  var toVal   = sheet.getRange(CONTROL_ROW, CTRL_TO_COL).getValue();
  var fromIso = _coerceDateToIso(fromVal);
  var toIso   = _coerceDateToIso(toVal);

  if (!fromIso || !toIso) {
    _setStatus("ERR: set From and To dates first (B1 and D1).");
    return;
  }

  try {
    var result;
    if (col === CTRL_LOCK_CHECKBOX_COL) {
      result = lockVerifiedColumns(fromIso, toIso, "");
    } else {
      result = unlockVerifiedColumnsSilent(fromIso, toIso);
    }
    // lock/unlock return multi-line strings — squash to one line for the
    // status cell (which is single-row, 32px high).
    _setStatus(String(result).replace(/\s+/g, " ").trim());
  } catch (err) {
    _setStatus("ERR: " + (err && err.message ? err.message : err));
  }
}

// One-time setup: installs the onEditLockButtons trigger and ensures the
// I1/J1/K1/L1 cells exist. Run this once per spreadsheet (re-running is
// safe; it removes the existing trigger before re-installing).
function installLockButtonsTrigger() {
  var ui = SpreadsheetApp.getUi();
  // Remove any prior copy of this trigger so we don't double-fire.
  var triggers = ScriptApp.getProjectTriggers();
  var removed = 0;
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === "onEditLockButtons") {
      ScriptApp.deleteTrigger(triggers[i]);
      removed++;
    }
  }
  ScriptApp.newTrigger("onEditLockButtons")
    .forSpreadsheet(EBIDA_SPREADSHEET_ID)
    .onEdit()
    .create();

  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB);
  if (sheet) {
    _ensureLockButtonCells(sheet);
  }

  ui.alert(
    "On-sheet lock buttons installed",
    "On-sheet lock buttons are now active. Set From and To dates in B1/D1, then check J1 to lock or L1 to unlock.\n\n" +
    (removed > 0 ? "(Replaced " + removed + " existing trigger" + (removed === 1 ? "" : "s") + ".)" : ""),
    ui.ButtonSet.OK);
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

// ── Salary Supplement refresh (Cockpit-only data, both orgs, SUPP_SAL rows only) ──
//
// Pulls SUPP_SAL rows from BOTH SPA and AES orgs over [dateFrom, dateTo] and
// merges ONLY those rows into the sheet. Non-SUPP_SAL rows (Zoho expenses,
// Lapis revenue, POS revenue, etc.) are NEVER touched by this path — neither
// updated nor cleared. Yellow background (#ffff00), red font (#ff0000), and
// the locked-data background (#fff9c4) all block writes via _isProtected().
//
// Use case: salary_supplement_monthly Supabase data changed (verification,
// corrections, talexio re-sync) → re-pull the affected date range without
// re-pulling everything else.

var SALARY_SUPPLEMENT_DIALOG_HTML = '<!DOCTYPE html><html><head><base target="_top">' +
  '<style>' +
  'body{font-family:Google Sans,Arial,sans-serif;padding:20px;margin:0;font-size:13px;color:#202124}' +
  'h3{margin:0 0 6px;font-size:15px;color:#1a73e8}' +
  'p{margin:0 0 14px;color:#5f6368;font-size:12px;line-height:1.5}' +
  'label{display:block;font-weight:600;margin-bottom:4px;font-size:12px}' +
  'input[type=date]{width:100%;padding:7px 9px;border:1px solid #dadce0;border-radius:4px;font-size:13px;margin-bottom:14px;box-sizing:border-box;outline:none;background:#fff}' +
  'input[type=date]:focus{border-color:#1a73e8}' +
  'button{width:100%;background:#137333;color:#fff;border:none;padding:9px 16px;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.15s}' +
  'button:hover{background:#0e5424}' +
  'button:disabled{opacity:0.55;cursor:not-allowed}' +
  '#status{margin-top:12px;padding:8px 10px;border-radius:4px;font-size:12px;display:none;white-space:pre-wrap}' +
  '.info{background:#e8f0fe;color:#1967d2}' +
  '.ok{background:#e6f4ea;color:#137333}' +
  '.warn{background:#fef7e0;color:#b06000}' +
  '.err{background:#fce8e6;color:#c5221f}' +
  '.note{font-size:11px;color:#5f6368;margin-top:-10px;margin-bottom:14px;line-height:1.4}' +
  '</style></head>' +
  '<body>' +
  '<h3>Refresh Salary Supplement</h3>' +
  '<p>Re-pulls Salary Supplement rows (SUPP_SAL) from Cockpit for the chosen date range. ' +
  'Posts each month\'s total on the LAST DAY of the month. ' +
  'Only SUPP_SAL rows are touched — other Zoho/Lapis/POS data is left alone. ' +
  'Yellow (#ffff00) bg or red (#ff0000) font cells are protected and never overwritten.</p>' +
  '<label>From</label><input type="date" id="df"/>' +
  '<label>To</label><input type="date" id="dt"/>' +
  '<div class="note">Range must include the month-end day(s) you want refreshed (e.g. Jan 31 for January).</div>' +
  '<button id="btn" onclick="go()">Refresh Salary Supplement</button>' +
  '<div id="status"></div>' +
  '<script>' +
  'var now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,"0"),d=String(now.getDate()).padStart(2,"0");' +
  'var firstOfMonthAgo=new Date(y,now.getMonth()-1,1);' +
  'var fy=firstOfMonthAgo.getFullYear(),fm=String(firstOfMonthAgo.getMonth()+1).padStart(2,"0"),fd="01";' +
  'document.getElementById("df").value=fy+"-"+fm+"-"+fd;' +
  'document.getElementById("dt").value=y+"-"+m+"-"+d;' +
  'function go(){' +
  '  var df=document.getElementById("df").value,dt=document.getElementById("dt").value;' +
  '  if(!df||!dt){show("Please select both dates.","err");return;}' +
  '  document.getElementById("btn").disabled=true;' +
  '  show("Refreshing Salary Supplement — may take up to 5 minutes…","info");' +
  '  google.script.run' +
  '    .withSuccessHandler(function(r){show(r,"ok");document.getElementById("btn").disabled=false;})' +
  '    .withFailureHandler(function(e){show("Error: "+e.message,"err");document.getElementById("btn").disabled=false;})' +
  '    .refreshSalarySupplement(df,dt);' +
  '}' +
  'function show(msg,cls){var el=document.getElementById("status");el.textContent=msg;el.className=cls;el.style.display="block";}' +
  '<\/script></body></html>';

function showSalarySupplementDialog() {
  var html = HtmlService.createHtmlOutput(SALARY_SUPPLEMENT_DIALOG_HTML).setWidth(420).setHeight(440);
  SpreadsheetApp.getUi().showModalDialog(html, "Refresh Salary Supplement");
}

// Refreshes SUPP_SAL rows in the sheet over [dateFrom, dateTo]. Fetches from
// BOTH SPA and AES orgs (SPA carries 8 SPA venues + HQ; AES carries
// Aesthetics + Slimming). Only writes SUPP_SAL rows; never touches other
// accounts. Returns a one-line result for the dialog.
function refreshSalarySupplement(dateFrom, dateTo) {
  if (!dateFrom || !dateTo) throw new Error("From and To dates required.");
  if (dateFrom > dateTo) throw new Error("From date must be on or before To date.");
  _setStatus("Refreshing Salary Supplement " + dateFrom + " → " + dateTo + "…");

  // Pull both orgs' API responses, filter to SUPP_SAL only.
  var allSuppRows = [];
  var allDates    = {};
  ["spa", "aesthetics"].forEach(function(org) {
    var chunks = _splitIntoChunks(dateFrom, dateTo, CHUNK_DAYS);
    for (var i = 0; i < chunks.length; i++) {
      var c = chunks[i];
      var data = _fetchChunk(c.from, c.to, org);
      data.dates.forEach(function(d) { allDates[d] = true; });
      for (var j = 0; j < data.rows.length; j++) {
        var row = data.rows[j];
        if (String(row.account_code).toUpperCase() === "SUPP_SAL") {
          allSuppRows.push(row);
        }
      }
    }
  });

  var datesList = Object.keys(allDates).sort();
  var stats = _mergeSalarySupplementOnly(allSuppRows, datesList, dateFrom, dateTo);
  var summary = "✓ Salary Supplement refreshed " + dateFrom + " → " + dateTo + "\n" +
    "  " + allSuppRows.length + " SUPP_SAL row(s) from API\n" +
    "  " + stats.updated + " cell update(s), " + stats.appended + " new row(s), " +
    stats.protected + " protected cell(s) skipped, " +
    stats.cleared + " stale cell(s) cleared";
  _setStatus(summary.replace(/\n/g, " | "));
  return summary;
}

// Specialised merge: ONLY touches rows where account_code = "SUPP_SAL".
// Update / append / clear logic mirrors _mergeIntoSheet, but the clearing
// scope is restricted to existing SUPP_SAL rows in the refresh window so
// non-SUPP_SAL data in the same window is never affected.
function _mergeSalarySupplementOnly(rows, allDates, refreshFrom, refreshTo) {
  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB);
  if (!sheet) throw new Error("Tab '" + EBIDA_TAB + "' not found — run a full pull first.");
  var stats = { updated: 0, appended: 0, protected: 0, cleared: 0 };

  // Force column C to text format on the data block — preserves the
  // SUPP_SAL string identity across reads.
  var lastRow = sheet.getLastRow();
  if (lastRow >= FIRST_DATA_ROW) {
    sheet.getRange(FIRST_DATA_ROW, 3, lastRow - FIRST_DATA_ROW + 1, 1).setNumberFormat("@");
  }
  var lastCol = sheet.getLastColumn();
  if (lastCol <= META_COUNT) throw new Error("Sheet has no date columns — run a full pull first.");

  var values      = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var backgrounds = sheet.getRange(1, 1, lastRow, lastCol).getBackgrounds();
  var fontColors  = sheet.getRange(1, 1, lastRow, lastCol).getFontColors();
  var headerVals  = values[HEADER_ROW - 1];

  // Header → column-index map for dates inside the refresh window.
  var refreshYear = parseInt(refreshFrom.slice(0, 4), 10);
  var dateToCol   = {};
  for (var c = META_COUNT; c < lastCol; c++) {
    var iso = _parseDateHeader(headerVals[c], refreshYear);
    if (!iso) continue;
    if (iso < refreshFrom || iso > refreshTo) continue;
    dateToCol[iso] = c;
  }

  // Build accRows from the new SUPP_SAL rows, keyed identically to the
  // main merge (normalized code, same delimiter).
  var venueIdx = 4;
  var accRows = {};
  for (var i = 0; i < rows.length; i++) {
    var row = rows[i];
    var allocation = row.tag_source === "tagged" ? "tag" : (row.split_rule || "split");
    var contact    = String(row.contact || "");
    var keyAccCode = _normalizeAccountCode(row.account_code) || row.account_name;
    var key = row.brand + "|" + keyAccCode + "|" + row.venue_slug + "|" + contact + "|" + allocation;
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
    for (var iso in row.daily) {
      accRows[key].daily[iso] = (accRows[key].daily[iso] || 0) + Number(row.daily[iso]);
    }
  }

  // Existing SUPP_SAL row index: key → array of row indices (handles legacy
  // duplicates from the leading-zero bug, same convention as _mergeIntoSheet).
  var existingRowKey = {};
  for (var r = HEADER_ROW; r < values.length; r++) {
    var brand     = String(values[r][0]).trim();
    var accCode   = String(values[r][2]).trim();
    if (_normalizeAccountCode(accCode) !== "SUPP_SAL") continue;
    var lineItem  = String(values[r][1]).trim();
    var venue     = String(values[r][venueIdx]).trim();
    var contact2  = String(values[r][CONTACT_COL_IDX] || "").trim();
    var alloc     = String(values[r][ALLOC_COL_IDX] || "").trim() || "split";
    var venueSlug = _venueToSlug(venue);
    var keyAccCode2 = _normalizeAccountCode(accCode) || lineItem;
    var key2 = brand + "|" + keyAccCode2 + "|" + venueSlug + "|" + contact2 + "|" + alloc;
    if (!existingRowKey[key2]) existingRowKey[key2] = [];
    existingRowKey[key2].push(r);
  }

  // Update step: write each new SUPP_SAL row's daily values into the
  // matching existing row's refresh-window cells. Duplicate-keyed rows:
  // primary gets the value, extras get cleared.
  for (var key3 in accRows) {
    var newRow = accRows[key3];
    var idxList = existingRowKey[key3];
    if (!idxList || idxList.length === 0) continue;
    var primaryIdx = idxList[0];
    for (var iso2 in dateToCol) {
      var colIdx = dateToCol[iso2];
      if (_isProtected(backgrounds[primaryIdx][colIdx], fontColors[primaryIdx][colIdx])) {
        stats.protected++;
      } else {
        var newVal = newRow.daily[iso2];
        sheet.getRange(primaryIdx + 1, colIdx + 1).setValue(newVal != null ? newVal : "");
        stats.updated++;
      }
      for (var di = 1; di < idxList.length; di++) {
        var dupIdx = idxList[di];
        if (_isProtected(backgrounds[dupIdx][colIdx], fontColors[dupIdx][colIdx])) {
          stats.protected++;
          continue;
        }
        var existing = values[dupIdx][colIdx];
        if (existing === "" || existing == null) continue;
        sheet.getRange(dupIdx + 1, colIdx + 1).setValue("");
        stats.cleared++;
      }
    }
  }

  // Clear step: SUPP_SAL rows in the sheet not in the new pull get their
  // refresh-window cells cleared. Scoped to SUPP_SAL only — never touches
  // other accounts.
  for (var key4 in existingRowKey) {
    if (key4 in accRows) continue;
    var idxList2 = existingRowKey[key4];
    for (var li = 0; li < idxList2.length; li++) {
      var rowIdx = idxList2[li];
      for (var iso3 in dateToCol) {
        var colIdx3 = dateToCol[iso3];
        var v = values[rowIdx][colIdx3];
        if (v === "" || v == null) continue;
        if (_isProtected(backgrounds[rowIdx][colIdx3], fontColors[rowIdx][colIdx3])) {
          stats.protected++;
          continue;
        }
        sheet.getRange(rowIdx + 1, colIdx3 + 1).setValue("");
        stats.cleared++;
      }
    }
  }

  // Append step: SUPP_SAL rows in the new pull with no matching existing row.
  var newKeys = [];
  for (var key5 in accRows) {
    if (existingRowKey[key5] == null) newKeys.push(key5);
  }
  if (newKeys.length > 0) {
    newKeys.sort();
    var headerLen = lastCol;
    var rowsToAppend = [];
    for (var ki = 0; ki < newKeys.length; ki++) {
      var nr = accRows[newKeys[ki]];
      var rowData = new Array(headerLen).fill("");
      rowData[0] = nr.brand;
      rowData[1] = nr.line_item;
      rowData[2] = nr.account_code;
      rowData[3] = nr.ebitda_category;
      rowData[venueIdx] = nr.venue;
      rowData[CONTACT_COL_IDX] = nr.contact || "";
      rowData[ALLOC_COL_IDX] = nr.allocation;
      for (var iso4 in nr.daily) {
        var colIdx4 = dateToCol[iso4];
        if (colIdx4 != null) rowData[colIdx4] = nr.daily[iso4];
      }
      rowsToAppend.push(rowData);
    }
    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 3, rowsToAppend.length, 1).setNumberFormat("@");
    sheet.getRange(startRow, 1, rowsToAppend.length, headerLen).setValues(rowsToAppend);
    if (headerLen > META_COUNT) {
      sheet.getRange(startRow, META_COUNT + 1, rowsToAppend.length, headerLen - META_COUNT)
           .setNumberFormat("#,##0.00;(#,##0.00);-");
    }
    stats.appended = rowsToAppend.length;
  }

  return stats;
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
  var aborted  = false;
  var abortReason = "";

  for (var i = 0; i < chunks.length; i++) {
    if (Date.now() - startedAt > APPS_SCRIPT_BUDGET_MS) {
      aborted = true;
      abortReason = "Apps Script budget exhausted after " + done + "/" + chunks.length +
        " chunks. Partial progress saved to sheet. Re-run with the remaining window " +
        "(start from " + chunks[i].from + ").";
      break;
    }
    var c = chunks[i];
    var chunkResult = _fetchChunk(c.from, c.to, orgParam);
    for (var r = 0; r < chunkResult.rows.length; r++) {
      var row = chunkResult.rows[r];
      var allocation = row.tag_source === "tagged" ? "tag" : (row.split_rule || "split");
      var contact    = String(row.contact || "");
      // Normalize account_code so the key matches existing sheet rows whose
      // codes were stripped of leading zeros by Google Sheets. Without this
      // the merge would append duplicate rows on every pull. See
      // _normalizeAccountCode for rationale.
      var keyAccCode = _normalizeAccountCode(row.account_code) || row.account_name;
      var key = row.brand + "|" + keyAccCode + "|" + row.venue_slug + "|" + contact + "|" + allocation;
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

  // Always write whatever we accumulated, even on partial completion. The merge
  // scopes overwrites to the dates actually pulled (allDates), so writing partial
  // progress is safe — dates that weren't fetched yet aren't touched.
  var allDates = Object.keys(datesSet).sort();
  var stats    = { appended: 0, updated: 0, protected: 0 };
  if (allDates.length > 0) {
    // For partial runs, narrow the refresh window to dates actually pulled so
    // we don't clear cells for accounts that *would* have appeared in later chunks.
    var actualFrom = allDates[0];
    var actualTo   = allDates[allDates.length - 1];
    stats = _mergeIntoSheet(accRows, allDates, actualFrom, actualTo, org);
  }

  var elapsed = ((Date.now() - startedAt) / 1000).toFixed(0);
  var stamp = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), "yyyy-MM-dd HH:mm");

  if (aborted) {
    _setStatus("⚠ Partial pull " + stamp + " — " + done + "/" + chunks.length + " chunks; " +
      "next: " + chunks[done].from + " → " + dateTo);
    throw new Error(abortReason);
  }

  _setStatus("✓ Last pulled " + stamp + " (" + dateFrom + " → " + dateTo + ", " + (org || "SPA") + ")");
  return "✓ " + chunks.length + " chunk(s) pulled in " + elapsed + "s\n" +
         "  " + Object.keys(accRows).length + " (account,venue) row(s) merged\n" +
         "  " + stats.appended + " new row(s), " + stats.updated + " cell update(s), " + stats.protected + " protected cell(s) skipped";
}

// Returns true if a cell should be treated as a manual edit and skipped
// during overwrite. Two protection signals: yellow background OR red font.
// Either alone is sufficient — user uses both as ad-hoc edit markers.
// Normalizes an account_code so leading-zero variants ("000003" vs "3", "" vs
// "000") resolve to the same row key. Without this, every pull's
// `_mergeIntoSheet` failed to match existing rows (where Google Sheets had
// auto-stripped the leading zeros on write) against the parser's preserved
// string codes, silently APPENDING duplicate rows on every backfill. The
// SPA "Dividends from Investments" account accumulated 163 rows over many
// pulls before this normalization landed.
//
// Convention: digits-only codes lose leading zeros; "000" → "0" (not ""); a
// non-digit code passes through unchanged (preserves LAPIS_REV, SALREF, etc).
function _normalizeAccountCode(raw) {
  var s = String(raw == null ? "" : raw).trim();
  if (s === "") return "";
  if (/^\d+$/.test(s)) {
    var stripped = s.replace(/^0+/, "");
    return stripped === "" ? "0" : stripped;
  }
  return s;
}

function _isProtected(bgColor, fontColor) {
  var bg = String(bgColor || "").toLowerCase();
  var fg = String(fontColor || "").toLowerCase();
  if (bg === PROTECTED_BG_COLOR) return true;   // #ffff00 manual-edit yellow
  if (bg === LOCKED_BG_COLOR)    return true;   // #fff9c4 verified-data lock
  if (fg === PROTECTED_FONT_COLOR) return true; // #ff0000 manual-edit red font
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

// ── Web App entry point (for automated/remote backfill) ─────────────────────
// Deployed as a web app so a pull can be triggered over HTTP, one window at a
// time, without a human clicking the in-sheet button. Shared-secret token
// gates access. Non-destructive — same merge path as the button (yellow/red
// protection, scoped overwrite). URL form:
//   <web-app-url>/exec?token=<TOKEN>&from=2025-03-01&to=2025-03-07&org=SPA
var WEBAPP_TOKEN = "cbk-ebida-a7f3e91c2d";

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (p.token !== WEBAPP_TOKEN) {
    return ContentService.createTextOutput("ERROR: invalid or missing token")
      .setMimeType(ContentService.MimeType.TEXT);
  }

  // New: audit-export endpoint. Returns per-(account_code, account_name)
  // monthly totals from the Zoho Raw Layer tab as JSON. URL form:
  //   <web-app-url>/exec?token=<TOKEN>&action=export&org=SPA&month=2025-01
  if (p.action === "export") {
    try {
      var exportResult = exportSheetMonthlyTotals(p.org, p.month);
      return ContentService.createTextOutput(JSON.stringify(exportResult))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        error: (err && err.message ? err.message : String(err))
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // EBITDA Export — creates a timestamped tab in the Accounting Master
  // spreadsheet with the period view that Cockpit just rendered. Cockpit
  // sends a JSON payload (compressed in the `payload` URL param as Base64)
  // describing brands, categories, totals, and which cells are fallback.
  // Light-blue (#cfe2f3) background marks fallback-computed cells.
  //   <web-app-url>/exec?token=<TOKEN>&action=ebitda_export&payload=<base64-json>
  if (p.action === "ebitda_export") {
    try {
      var b64 = p.payload || "";
      if (!b64) throw new Error("Missing 'payload' query param.");
      var decoded = Utilities.newBlob(Utilities.base64Decode(b64)).getDataAsString();
      var payload = JSON.parse(decoded);
      var newTabUrl = writeEbitdaExportTab(payload);
      return ContentService.createTextOutput(JSON.stringify({ ok: true, tab_url: newTabUrl }))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        error: (err && err.message ? err.message : String(err))
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Per-row per-date data from the "Aggregated Data" tab over an arbitrary
  // window. Used by Cockpit's /api/finance/ebitda-aggregated route to drive
  // the new EBITDA dashboard. Pure read — no merge/write.
  //   <web-app-url>/exec?token=<TOKEN>&action=aggregated_period&org=SPA&from=2026-01-01&to=2026-01-07
  if (p.action === "aggregated_period") {
    try {
      var aggPeriodResult = exportAggregatedDataForPeriod(p.org, p.from, p.to);
      return ContentService.createTextOutput(JSON.stringify(aggPeriodResult))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        error: (err && err.message ? err.message : String(err))
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  // Diagnostic: dump every row matching a brand + account_code substring, with
  // per-date values, so we can see if multiple sheet rows aggregate to the
  // same account_code (a clue for duplicate-key bugs in the merge).
  //   <web-app-url>/exec?token=<TOKEN>&action=dump&org=SPA&code=3&month=2025-01
  if (p.action === "dump") {
    try {
      var dumpResult = dumpSheetRows(p.org, p.code, p.month);
      return ContentService.createTextOutput(JSON.stringify(dumpResult))
        .setMimeType(ContentService.MimeType.JSON);
    } catch (err) {
      return ContentService.createTextOutput(JSON.stringify({
        error: (err && err.message ? err.message : String(err))
      })).setMimeType(ContentService.MimeType.JSON);
    }
  }

  var from = p.from, to = p.to, org = p.org || "SPA";
  if (!from || !to) {
    return ContentService.createTextOutput("ERROR: from and to params required (YYYY-MM-DD)")
      .setMimeType(ContentService.MimeType.TEXT);
  }
  try {
    var result = pullAndWriteEbidaLayer(from, to, org);
    return ContentService.createTextOutput("OK\n" + result)
      .setMimeType(ContentService.MimeType.TEXT);
  } catch (err) {
    return ContentService.createTextOutput("ERROR: " + (err && err.message ? err.message : err))
      .setMimeType(ContentService.MimeType.TEXT);
  }
}

// Per-(account_code, account_name) monthly totals from the Zoho Raw Layer tab
// for a given org + YYYY-MM. Audit endpoint — pure read, no merge/write.
//
//  org           "SPA" or "Aesthetics" (case-insensitive vs Brand column)
//  ym            "YYYY-MM" — month to aggregate
//
// Aggregation key:
//   account_code (col C). If empty, fall back to line_item (col B).
//
// Value rule:
//   sum numeric values across every date column whose header parses (via
//   _parseDateHeader, same helper the merge uses) to a date in
//   [ym-01 .. ym-last-day]. Non-numeric / null / empty cells are skipped.
//   Signed sum first (matches the API/parser convention which sums signed
//   then takes abs downstream).
//
// Return shape:
//   { org, ym, accounts: [{code, name, total}, ...],
//     total_rows_read, total_data_cells }
function exportSheetMonthlyTotals(org, ym) {
  if (!org)                      throw new Error("org param required (SPA or Aesthetics).");
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    throw new Error("month param required in YYYY-MM format.");
  }

  var orgLower  = String(org).trim().toLowerCase();
  var year      = parseInt(ym.slice(0, 4), 10);
  var monthOne  = parseInt(ym.slice(5, 7), 10);   // 1-indexed
  // JS Date: month index is 0-based; passing day=0 of next month yields
  // the last day of the requested month. (new Date(year, monthOne, 0))
  var lastDay   = new Date(year, monthOne, 0).getDate();
  var fromIso   = ym + "-01";
  var toIso     = ym + "-" + String(lastDay).padStart(2, "0");

  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB);
  if (!sheet) throw new Error("Tab '" + EBIDA_TAB + "' not found.");

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < FIRST_DATA_ROW || lastCol <= META_COUNT) {
    return { org: org, ym: ym, accounts: [], total_rows_read: 0, total_data_cells: 0 };
  }

  var values     = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headerVals = values[HEADER_ROW - 1];

  // Identify date columns falling inside the month window.
  var monthCols = [];   // 0-indexed
  for (var c = META_COUNT; c < lastCol; c++) {
    var iso = _parseDateHeader(headerVals[c], year);
    if (!iso) continue;
    if (iso < fromIso || iso > toIso) continue;
    monthCols.push(c);
  }

  // Aggregate by (account_code || line_item).
  var byKey       = {};   // key -> { code, name, total }
  var rowsRead    = 0;
  var dataCells   = 0;

  for (var r = FIRST_DATA_ROW - 1; r < values.length; r++) {
    var row   = values[r];
    var brand = String(row[0] || "").trim();
    if (!brand) continue;
    if (brand.toLowerCase() !== orgLower) continue;

    var lineItem = String(row[1] || "").trim();
    var accCode  = String(row[2] || "").trim();
    // Skip section header / fully empty rows (brand-only rows have no line_item/code).
    if (!lineItem && !accCode) continue;

    rowsRead++;
    var key  = accCode || lineItem;
    var name = lineItem;

    if (!byKey[key]) {
      byKey[key] = { code: accCode, name: name, total: 0 };
    } else if (!byKey[key].name && name) {
      byKey[key].name = name;
    }

    for (var mi = 0; mi < monthCols.length; mi++) {
      var v = row[monthCols[mi]];
      if (v === "" || v == null) continue;
      var n = (typeof v === "number") ? v : parseFloat(v);
      if (!isFinite(n)) continue;
      byKey[key].total += n;
      dataCells++;
    }
  }

  var accounts = [];
  for (var k in byKey) accounts.push(byKey[k]);
  accounts.sort(function(a, b) {
    if (a.code !== b.code) return String(a.code).localeCompare(String(b.code));
    return String(a.name).localeCompare(String(b.name));
  });

  return {
    org:              org,
    ym:               ym,
    accounts:         accounts,
    total_rows_read:  rowsRead,
    total_data_cells: dataCells,
  };
}

// Per-row per-date data from the "Aggregated Data" tab over an arbitrary
// [fromIso, toIso] window. Returns each row's daily signed values keyed by
// ISO date, plus the row's identity metadata (brand, line_item, account_code,
// ebitda_category, venue, contact, allocation). Used by Cockpit's
// /api/finance/ebitda-aggregated route — the route then applies fallback
// rules (TTM-spread / manual-annual / disabled) before aggregating per
// (brand, ebitda_category) cell.
//
// Aggregated Data tab is the user's working copy (with overrides). When it
// does not exist, falls back to reading Zoho Raw Layer so the endpoint still
// works on a fresh deployment.
//
// org           "SPA" or "Aesthetics" (case-insensitive vs Brand column).
//               "Aesthetics" returns AES + SLIM + HQ rows that live in that
//               workbook tab — the Cockpit route splits them on its side.
// fromIso/toIso YYYY-MM-DD inclusive.
function exportAggregatedDataForPeriod(org, fromIso, toIso) {
  if (!org)                                    throw new Error("org param required (SPA or Aesthetics).");
  if (!fromIso || !/^\d{4}-\d{2}-\d{2}$/.test(fromIso)) {
    throw new Error("from param required in YYYY-MM-DD format.");
  }
  if (!toIso   || !/^\d{4}-\d{2}-\d{2}$/.test(toIso)) {
    throw new Error("to param required in YYYY-MM-DD format.");
  }
  if (fromIso > toIso) throw new Error("from must be on or before to.");

  var orgLower = String(org).trim().toLowerCase();

  var ss        = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  // Prefer Aggregated Data (carries user overrides); fall back to Zoho Raw Layer.
  var sheet     = ss.getSheetByName(AGGREGATED_TAB) || ss.getSheetByName(EBIDA_TAB);
  var sourceTab = sheet ? sheet.getName() : null;
  if (!sheet) throw new Error("Neither '" + AGGREGATED_TAB + "' nor '" + EBIDA_TAB + "' tab found.");

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow < FIRST_DATA_ROW || lastCol <= META_COUNT) {
    return {
      org:        org,
      date_from:  fromIso,
      date_to:    toIso,
      source_tab: sourceTab,
      rows:       [],
      dates:      [],
    };
  }

  var values     = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headerVals = values[HEADER_ROW - 1];

  // Identify date columns that fall inside [fromIso, toIso].
  var fromYear  = parseInt(fromIso.slice(0, 4), 10);
  var matchedCols = [];   // [{ col: <0-indexed>, iso: 'YYYY-MM-DD' }]
  var matchedIsoList = [];
  for (var c = META_COUNT; c < lastCol; c++) {
    var iso = _parseDateHeader(headerVals[c], fromYear);
    if (!iso) continue;
    if (iso < fromIso || iso > toIso) continue;
    matchedCols.push({ col: c, iso: iso });
    matchedIsoList.push(iso);
  }

  // Sort the ISO list for predictable response ordering.
  matchedIsoList.sort();

  var rowsOut = [];
  for (var r = FIRST_DATA_ROW - 1; r < values.length; r++) {
    var row   = values[r];
    var brand = String(row[0] || "").trim();
    if (!brand) continue;
    // Brand-only section header rows (no line_item, no account_code).
    var lineItem  = String(row[1] || "").trim();
    var accCode   = String(row[2] || "").trim();
    var ebitdaCat = String(row[3] || "").trim();
    var venue     = String(row[4] || "").trim();
    if (!lineItem && !accCode && !ebitdaCat && !venue) continue;

    // Brand filter — SPA pulls SPA rows only; Aesthetics returns AES+SLIM+HQ.
    var brandLow = brand.toLowerCase();
    if (orgLower === "spa") {
      if (brandLow !== "spa") continue;
    } else {
      if (brandLow === "spa") continue;
    }

    var contact = String(row[CONTACT_COL_IDX] || "").trim();
    var alloc   = String(row[ALLOC_COL_IDX]   || "").trim();

    var daily = {};
    for (var mi = 0; mi < matchedCols.length; mi++) {
      var v = row[matchedCols[mi].col];
      if (v === "" || v == null) continue;
      var n = (typeof v === "number") ? v : parseFloat(v);
      if (!isFinite(n) || n === 0) continue;
      daily[matchedCols[mi].iso] = n;
    }
    // Always include rows even if they have no values in window — the
    // Cockpit route uses fallback rules to fill them in for partial periods.
    rowsOut.push({
      brand:           brand,
      line_item:       lineItem,
      account_code:    accCode,
      ebitda_category: ebitdaCat,
      venue:           venue,
      contact:         contact,
      allocation:      alloc,
      daily:           daily,
    });
  }

  return {
    org:        org,
    date_from:  fromIso,
    date_to:    toIso,
    source_tab: sourceTab,
    rows:       rowsOut,
    dates:      matchedIsoList,
  };
}

// Diagnostic: returns every sheet row that matches a brand + account_code
// (exact-match or "stripped leading zeros" match), with per-date values
// for a given YYYY-MM. Used to investigate suspected duplicate-key rows.
//
// URL form:
//   <web-app-url>/exec?token=<TOKEN>&action=dump&org=SPA&code=3&month=2025-01
function dumpSheetRows(org, code, ym) {
  if (!org)  throw new Error("org param required (SPA or Aesthetics).");
  if (!code && code !== "0" && code !== "") throw new Error("code param required (account_code to match).");
  if (!ym || !/^\d{4}-\d{2}$/.test(ym)) {
    throw new Error("month param required in YYYY-MM format.");
  }

  var orgLower = String(org).trim().toLowerCase();
  // Normalize the search code: if numeric, also match leading-zero variants.
  var searchCode = String(code).trim();
  var stripped   = /^\d+$/.test(searchCode) ? searchCode.replace(/^0+/, "") : searchCode;
  if (stripped === "" && /^\d+$/.test(searchCode)) stripped = "0";

  var year     = parseInt(ym.slice(0, 4), 10);
  var monthOne = parseInt(ym.slice(5, 7), 10);
  var lastDay  = new Date(year, monthOne, 0).getDate();
  var fromIso  = ym + "-01";
  var toIso    = ym + "-" + String(lastDay).padStart(2, "0");

  var ss    = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var sheet = ss.getSheetByName(EBIDA_TAB);
  if (!sheet) throw new Error("Tab '" + EBIDA_TAB + "' not found.");

  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  var values     = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headerVals = values[HEADER_ROW - 1];

  var monthCols = []; // [{c, iso}]
  for (var c = META_COUNT; c < lastCol; c++) {
    var iso = _parseDateHeader(headerVals[c], year);
    if (!iso) continue;
    if (iso < fromIso || iso > toIso) continue;
    monthCols.push({ c: c, iso: iso });
  }

  var rows = [];
  for (var r = FIRST_DATA_ROW - 1; r < values.length; r++) {
    var row   = values[r];
    var brand = String(row[0] || "").trim();
    if (!brand) continue;
    if (brand.toLowerCase() !== orgLower) continue;

    var rowCode = String(row[2] || "").trim();
    var rowCodeStripped = /^\d+$/.test(rowCode) ? rowCode.replace(/^0+/, "") : rowCode;
    if (rowCodeStripped === "" && /^\d+$/.test(rowCode)) rowCodeStripped = "0";
    if (rowCode !== searchCode && rowCodeStripped !== stripped) continue;

    var lineItem = String(row[1] || "").trim();
    var venue    = String(row[4] || "").trim();
    var contact  = String(row[5] || "").trim();
    var alloc    = String(row[6] || "").trim();
    var daily    = {};
    var total    = 0;
    for (var mi = 0; mi < monthCols.length; mi++) {
      var v = row[monthCols[mi].c];
      if (v === "" || v == null) continue;
      var n = (typeof v === "number") ? v : parseFloat(v);
      if (!isFinite(n) || n === 0) continue;
      daily[monthCols[mi].iso] = n;
      total += n;
    }
    rows.push({
      sheet_row: r + 1,        // 1-indexed for human readability
      brand: brand,
      line_item: lineItem,
      account_code: rowCode,
      venue: venue,
      contact: contact,
      allocation: alloc,
      total: total,
      daily: daily,
    });
  }
  return { org: org, code: code, ym: ym, matched_rows: rows.length, rows: rows };
}

// DEV-ONLY one-click reset: clears the existing Zoho Raw Layer tab content
// (but preserves the tab itself and any drawings/buttons on it) and runs the
// 1-week test pull. Use this after a layout change to rebuild content cleanly
// with the current schema without losing the assigned Pull button.
//
// IMPORTANT — this function WIPES the entire Zoho Raw Layer tab. It is named
// with a "_devOnly" suffix and guarded by an alert prompt so it isn't fired
// accidentally from the Apps Script editor's function picker. Re-populating
// the tab from scratch requires hours of Web App backfill calls.
function _resetAndRunTestPull_devOnly() {
  var ui = SpreadsheetApp.getUi();
  var resp = ui.alert(
    "DESTRUCTIVE — Zoho Raw Layer wipe",
    "This will CLEAR every row in the '" + EBIDA_TAB + "' tab and re-pull only Jan 1-7. " +
    "All historical Zoho + Lapis data in that tab will be lost and would need ~7 hours of " +
    "Web App calls to rebuild.\n\nContinue?",
    ui.ButtonSet.YES_NO);
  if (resp !== ui.Button.YES) {
    Logger.log("_resetAndRunTestPull_devOnly: cancelled by user.");
    return "Cancelled.";
  }
  var ss = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);
  var existing = ss.getSheetByName(EBIDA_TAB);
  if (existing) {
    var maxR = existing.getMaxRows();
    var maxC = existing.getMaxColumns();
    if (maxR > 0 && maxC > 0) {
      existing.getRange(1, 1, maxR, maxC).clearDataValidations();
    }
    existing.clear();             // clears content + formatting; drawings/images survive
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
  // Ensure the on-sheet lock buttons exist on the next pull so older tabs
  // (which pre-date the I1/J1/K1/L1 cells) get them retroactively.
  _ensureLockButtonCells(sheet);
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
  // Ensure column C (account_code) is text-formatted across all existing
  // rows. Idempotent — Sheets accepts the format reapplication cheaply.
  // Without this, cells written before the fix may still hold numeric
  // values (e.g., the integer 3) and re-pulls won't normalize them.
  var lastRowSoFar = sheet.getLastRow();
  if (lastRowSoFar >= FIRST_DATA_ROW) {
    sheet.getRange(FIRST_DATA_ROW, 3, lastRowSoFar - FIRST_DATA_ROW + 1, 1).setNumberFormat("@");
  }

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

  // Index existing rows by identity (start from first data row; skip section + blank rows).
  // existingRowKey: key → array of row indices. We use an array because the
  // sheet may contain MULTIPLE rows that resolve to the same normalized key
  // (legacy duplication from the leading-zero key-mismatch bug). On a key
  // hit we update the FIRST row and clear the rest in the refresh window so
  // the export aggregates correctly. The "primary" row is the lowest index;
  // all extras get their refresh-window cells cleared like any other
  // out-of-pull row.
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
    // Normalize the existing row's account_code so it matches the new pull's
    // normalized key — see _normalizeAccountCode. Without this, sheet rows
    // whose code was stripped to "3" wouldn't match the parser's "000003"
    // and we'd keep appending duplicates instead of updating.
    var keyAccCode = _normalizeAccountCode(accCode) || lineItem;
    var key = brand + "|" + keyAccCode + "|" + venueSlug + "|" + contact + "|" + alloc;
    if (!existingRowKey[key]) existingRowKey[key] = [];
    existingRowKey[key].push(r);
  }

  // ── DIAGNOSTIC LOGGING ──────────────────────────────────────────────────
  Logger.log("=== MERGE DEBUG ===");
  Logger.log("Pull window: " + refreshFrom + " → " + refreshTo + " (org=" + org + ")");
  Logger.log("");
  Logger.log("Existing row keys in sheet (" + Object.keys(existingRowKey).length + " unique, " +
             Object.keys(existingRowKey).reduce(function(s, k){ return s + existingRowKey[k].length; }, 0) +
             " rows):");
  var existKeysSorted = Object.keys(existingRowKey).sort();
  for (var ei = 0; ei < existKeysSorted.length; ei++) {
    var rowList = existingRowKey[existKeysSorted[ei]].map(function(r){ return r + 1; }).join(",");
    var dupTag  = existingRowKey[existKeysSorted[ei]].length > 1 ? " ⚠DUP" : "";
    Logger.log("  EXIST  rows " + rowList + dupTag + "  key=[" + existKeysSorted[ei] + "]");
  }
  Logger.log("");
  Logger.log("New pull keys (" + Object.keys(accRows).length + "):");
  var newKeysSorted = Object.keys(accRows).sort();
  for (var ni = 0; ni < newKeysSorted.length; ni++) {
    var matched = existingRowKey[newKeysSorted[ni]] != null ? "✓MATCH" : "✗NEW";
    Logger.log("  " + matched + "  key=[" + newKeysSorted[ni] + "]");
  }
  Logger.log("=== END DEBUG ===");

  // Apply per-row updates. When duplicate rows share a key (legacy
  // leading-zero bug), update the FIRST row with new values and CLEAR the
  // extras' refresh-window cells so the export aggregates correctly.
  for (var key in accRows) {
    var newRow = accRows[key];
    var existingIdxList = existingRowKey[key];
    if (!existingIdxList || existingIdxList.length === 0) continue;
    var primaryIdx = existingIdxList[0];
    for (var iso in refreshDates) {
      var colIdx = dateToCol[iso];
      if (colIdx == null) continue;
      // Primary row: write the new value (unless protected).
      if (_isProtected(backgrounds[primaryIdx][colIdx], fontColors[primaryIdx][colIdx])) {
        stats.protected++;
      } else {
        var newVal = newRow.daily[iso];
        sheet.getRange(primaryIdx + 1, colIdx + 1).setValue(newVal != null ? newVal : "");
        stats.updated++;
      }
      // Duplicate rows under the same normalized key: clear their cells in
      // the refresh window so they don't double-count in the export.
      for (var di = 1; di < existingIdxList.length; di++) {
        var dupIdx = existingIdxList[di];
        if (_isProtected(backgrounds[dupIdx][colIdx], fontColors[dupIdx][colIdx])) {
          stats.protected++;
          continue;
        }
        var existing = values[dupIdx][colIdx];
        if (existing === "" || existing == null) continue;
        sheet.getRange(dupIdx + 1, colIdx + 1).setValue("");
        stats.updated++;
      }
    }
  }

  // Clear existing rows that aren't in the new pull but have values in the refresh window
  //
  // CRITICAL: scope this to the org being pulled. A SPA pull must ONLY blank
  // SPA rows that disappeared from the new data — never AES rows, and vice
  // versa. Without this filter, an AES pull would iterate every SPA row,
  // find no matching key in accRows (accRows is SPA-empty for an AES pull),
  // and silently blank every SPA cell in the refresh window. That bug caused
  // SPA Jan-Feb 2025 to go blank after the AES Jan-Feb backfill ran on top
  // of an existing SPA dataset (commit 3e3128e or earlier — the bug was
  // pre-existing, not introduced by the lock-feature work).
  var orgKeyPrefix = String(org || "").trim().toLowerCase();
  for (var key in existingRowKey) {
    if (key in accRows) continue;
    var keyBrand = key.split("|", 1)[0].toLowerCase();
    if (keyBrand !== orgKeyPrefix) continue;  // never clear rows from another org
    // Clear ALL row indices that resolve to this key (handles legacy
    // duplicates from the leading-zero bug).
    var idxList = existingRowKey[key];
    for (var li = 0; li < idxList.length; li++) {
      var rowIdx = idxList[li];
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
      // Note: account_code is written as a plain string; the setNumberFormat("@")
      // call below the loop forces text storage in column C so leading zeros
      // (e.g. "000003") survive. Without that format, Sheets would auto-convert
      // and the merge would fail to match existing rows on subsequent pulls.
      rowData[2] = newRow.account_code || "";
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
    // Force column C (account_code) to text format before writing so future
    // edits to those cells also preserve leading zeros.
    sheet.getRange(startRow, 3, rowsToAppend.length, 1).setNumberFormat("@");
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
    // Plain string — the setNumberFormat("@") on column C (applied before the
    // setValues call below) forces Sheets to store the value as text so
    // leading zeros survive. Critical for row-key matching across pulls.
    dataRow[2] = r.account_code || "";
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
  // Layout: A1 "Pull from Zoho + Sales sheets…" | B1 from-date | C1 "to" | D1 to-date | E1 "Org:" | F1 org | G1 (button placeholder) | H1 status
  var controlWidth = Math.max(totalCols, CTRL_STATUS_COL);
  sheet.getRange(CONTROL_ROW, 1, 1, controlWidth).clearContent();
  sheet.getRange(CONTROL_ROW, 1).setValue("Pull from Zoho + Sales sheets (Supplement Salary excluded)").setFontWeight("bold");
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
  // Also force text format on column C (account_code) — without this, Sheets
  // auto-strips leading zeros from codes like "000003" and the merge then
  // can't match existing rows on subsequent pulls. The single-quote prefix
  // we apply per-cell is a belt-and-suspenders fallback; this is the belt.
  if (data.length > 0) {
    sheet.getRange(HEADER_ROW, 3, data.length, 1).setNumberFormat("@");
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

  // Add the on-sheet lock/unlock checkbox buttons (I1/J1/K1/L1)
  _ensureLockButtonCells(sheet);
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

// ── EBITDA Export — Cockpit "Export to Sheet" button writes here ─────────────
//
// Cockpit's /finance/ebitda page POSTs a payload to the Web App's
// ?action=ebitda_export endpoint. We create a new TIMESTAMPED tab and
// populate it with the same table Cockpit just rendered, plus a header
// summary and light-blue (#cfe2f3) markers on any cell whose value came
// from a fallback rule (TTM-spread or manual-annual).
//
// Payload shape (sent as Base64-encoded JSON in the `payload` URL param):
//   {
//     date_from:   "2026-01-01",
//     date_to:     "2026-01-07",
//     generated_at:"2026-05-26T12:34:56Z",
//     brands:      ["SPA","AES","SLIM","HQ"],
//     categories:  ["revenue","cogs","wages","rent","utilities","sga","advertising"],
//     totals: {
//       "SPA": { "revenue": {value: 31250.5, has_fallback: false},
//                "wages":   {value: 18900.0, has_fallback: true},
//                ... },
//       "AES": { ... },
//       ...
//     },
//     fallback_applied: [
//       { brand:"SPA", account_code:"619140", account_name:"Rent - InterContinental",
//         rule_type:"ttm_spread", period_value:1151.61,
//         method_detail:"TTM €60000 × 7/365" },
//       ...
//     ]
//   }

var EBITDA_EXPORT_FALLBACK_BG = "#cfe2f3";  // light blue — fallback cells

function writeEbitdaExportTab(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid payload.");
  if (!payload.date_from || !payload.date_to) throw new Error("payload missing date_from / date_to.");

  var ss = SpreadsheetApp.openById(EBIDA_SPREADSHEET_ID);

  // Timestamped tab name. Sheets disallows some chars in tab names; safe
  // format: "EBITDA Export YYYY-MM-DD HH-mm" (no colons).
  var tz = ss.getSpreadsheetTimeZone();
  var stamp = Utilities.formatDate(new Date(), tz, "yyyy-MM-dd HH-mm");
  var tabName = "EBITDA Export " + payload.date_from + " to " + payload.date_to + " (" + stamp + ")";
  // Cap at 100 chars (Sheets limit ~100); truncate from the END so the
  // human-readable prefix is preserved.
  if (tabName.length > 99) tabName = tabName.substring(0, 99);

  // If a tab with this exact name exists (unlikely with the stamp), append a counter.
  var attempts = 0;
  var finalName = tabName;
  while (ss.getSheetByName(finalName) && attempts < 10) {
    attempts++;
    finalName = tabName + " #" + (attempts + 1);
    if (finalName.length > 99) finalName = finalName.substring(0, 99);
  }
  var tab = ss.insertSheet(finalName);

  // ── Header block (rows 1-5) ─────────────────────────────────────────────
  tab.getRange(1, 1).setValue("EBITDA Export").setFontWeight("bold").setFontSize(14);
  tab.getRange(2, 1).setValue("Period:").setFontWeight("bold");
  tab.getRange(2, 2).setValue(payload.date_from + " → " + payload.date_to);
  tab.getRange(3, 1).setValue("Generated:").setFontWeight("bold");
  tab.getRange(3, 2).setValue(payload.generated_at || new Date().toISOString());
  tab.getRange(4, 1).setValue("Legend:").setFontWeight("bold");
  tab.getRange(4, 2).setValue("Light-blue cells = fallback-computed (TTM-spread or manual-annual)").setFontStyle("italic");
  tab.getRange(4, 2).setBackground(EBITDA_EXPORT_FALLBACK_BG);

  // ── Aggregated table (rows 6+) ──────────────────────────────────────────
  var brands     = Array.isArray(payload.brands)     ? payload.brands     : [];
  var categories = Array.isArray(payload.categories) ? payload.categories : [];
  var totals     = payload.totals || {};

  if (brands.length === 0 || categories.length === 0) {
    tab.getRange(6, 1).setValue("(No data in selected period.)").setFontStyle("italic").setFontColor("#5f6368");
    return ss.getUrl() + "#gid=" + tab.getSheetId();
  }

  // Header row: Category | brand1 | brand2 | ...
  var headerRow = ["EBITDA Category"];
  for (var bi = 0; bi < brands.length; bi++) headerRow.push(brands[bi]);
  // Add a "Total" column at the right
  headerRow.push("Total");
  tab.getRange(6, 1, 1, headerRow.length).setValues([headerRow])
     .setFontWeight("bold").setBackground("#e8f0fe").setFontColor("#1967d2");

  // Body rows
  var tableData = [];
  var fallbackMarks = [];   // [{row, col}] for cells to paint light-blue
  for (var ci = 0; ci < categories.length; ci++) {
    var cat = categories[ci];
    var row = [cat];
    var rowTotal = 0;
    for (var bi2 = 0; bi2 < brands.length; bi2++) {
      var cell = totals[brands[bi2]] && totals[brands[bi2]][cat];
      var v = cell ? Number(cell.value) || 0 : 0;
      row.push(v);
      rowTotal += v;
      if (cell && cell.has_fallback) {
        fallbackMarks.push({ row: 6 + 1 + ci, col: 1 + 1 + bi2 });   // 1-indexed
      }
    }
    row.push(rowTotal);
    tableData.push(row);
  }
  if (tableData.length > 0) {
    var bodyRange = tab.getRange(7, 1, tableData.length, brands.length + 2);
    bodyRange.setValues(tableData);
    // Number format on all numeric cols
    tab.getRange(7, 2, tableData.length, brands.length + 1)
       .setNumberFormat("#,##0.00;(#,##0.00);-");
    // First column (category names) bold
    tab.getRange(7, 1, tableData.length, 1).setFontWeight("bold");
  }

  // Total row at bottom
  var totalRowIdx = 7 + tableData.length;
  var totalRow = ["TOTAL"];
  var grandTotal = 0;
  for (var bi3 = 0; bi3 < brands.length; bi3++) {
    var brandSum = 0;
    for (var ci2 = 0; ci2 < categories.length; ci2++) {
      var c2 = totals[brands[bi3]] && totals[brands[bi3]][categories[ci2]];
      brandSum += c2 ? (Number(c2.value) || 0) : 0;
    }
    totalRow.push(brandSum);
    grandTotal += brandSum;
  }
  totalRow.push(grandTotal);
  tab.getRange(totalRowIdx, 1, 1, totalRow.length).setValues([totalRow])
     .setFontWeight("bold").setBackground("#fff2cc").setBorder(true, false, false, false, false, false);
  tab.getRange(totalRowIdx, 2, 1, brands.length + 1).setNumberFormat("#,##0.00;(#,##0.00);-");

  // Paint fallback markers
  if (fallbackMarks.length > 0) {
    var fallbackRanges = fallbackMarks.map(function(m) {
      return tab.getRange(m.row, m.col).getA1Notation();
    });
    tab.getRangeList(fallbackRanges).setBackground(EBITDA_EXPORT_FALLBACK_BG);
  }

  // ── Fallback detail section ─────────────────────────────────────────────
  var fbAppliedStart = totalRowIdx + 3;
  var fbApplied = Array.isArray(payload.fallback_applied) ? payload.fallback_applied : [];
  tab.getRange(fbAppliedStart, 1).setValue("Fallback-applied accounts").setFontWeight("bold").setFontSize(12);
  if (fbApplied.length === 0) {
    tab.getRange(fbAppliedStart + 1, 1).setValue("(No fallback rules fired for this period — all values are literal sums.)")
       .setFontStyle("italic").setFontColor("#5f6368");
  } else {
    var fbHeader = ["Brand", "Account Code", "Account Name", "Rule", "Period Value", "Method"];
    tab.getRange(fbAppliedStart + 1, 1, 1, fbHeader.length).setValues([fbHeader])
       .setFontWeight("bold").setBackground("#e8f0fe").setFontColor("#1967d2");
    var fbRows = fbApplied.map(function(f) {
      return [
        f.brand || "",
        f.account_code || "",
        f.account_name || "",
        f.rule_type || "",
        Number(f.period_value) || 0,
        f.method_detail || "",
      ];
    });
    tab.getRange(fbAppliedStart + 2, 1, fbRows.length, fbHeader.length).setValues(fbRows);
    tab.getRange(fbAppliedStart + 2, 5, fbRows.length, 1)
       .setNumberFormat("#,##0.00;(#,##0.00);-").setBackground(EBITDA_EXPORT_FALLBACK_BG);
  }

  // Cosmetic touches
  tab.setFrozenRows(6);
  tab.setColumnWidth(1, 200);
  for (var ci3 = 2; ci3 <= brands.length + 2; ci3++) tab.setColumnWidth(ci3, 110);

  SpreadsheetApp.flush();
  return ss.getUrl() + "#gid=" + tab.getSheetId();
}
