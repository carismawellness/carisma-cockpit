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
    .addSeparator()
    .addItem("Lock verified columns…",   "showLockVerifiedDialog")
    .addItem("Unlock verified columns…", "showUnlockVerifiedDialog")
    .addToUi();
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
  var lockedCount = 0;
  for (var i = 0; i < matchedCols.length; i++) {
    var col   = matchedCols[i];
    var range = sheet.getRange(FIRST_DATA_ROW, col, numRows, 1);
    var protection = range.protect()
      .setDescription(LOCKED_DESC_PREFIX + " " + fromDateIso + " → " + toDateIso)
      .setWarningOnly(false);
    // removeEditors(everyone except the owner). Apps Script forbids removing
    // the sheet owner, so we enumerate and remove non-owner editors only.
    var editors = protection.getEditors();
    var toRemove = [];
    for (var ei = 0; ei < editors.length; ei++) {
      var emailE = editors[ei].getEmail();
      if (emailE && emailE.toLowerCase() !== ownerEmail.toLowerCase()) {
        toRemove.push(emailE);
      }
    }
    if (toRemove.length > 0) {
      try { protection.removeEditors(toRemove); } catch (e) { /* owner cannot be removed; ignore */ }
    }
    try { protection.addEditor(ownerEmail); } catch (e) { /* already an editor or invalid; ignore */ }
    if (protection.canDomainEdit && protection.canDomainEdit()) {
      try { protection.setDomainEdit(false); } catch (e) { /* not a domain doc; ignore */ }
    }
    range.setBackground(LOCKED_BG_COLOR);
    lockedCount++;
  }
  SpreadsheetApp.flush();

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
