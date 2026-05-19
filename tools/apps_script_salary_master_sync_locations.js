/**
 * Salary Master — one-off: sync Location column across all monthly (C) tabs
 *
 * Source of truth: "Apr 26 (C)"
 * Target tabs:     every other "{Mon} {YY} (C)" tab (including hidden ones, back to Jan 25 (C))
 * Scope:           only rows where col E (Active emp) === "Active"
 *
 * Sheet ID: 1AAnfm-SAYso6RpJhbdhJbTbcGDH1Ftlk0FHBPHfN98w
 *
 * Column layout (rows 8+):
 *   A = staff #   |  B = Staff name  |  C = Location  |  D = Cash/Gross
 *   E = Active emp status  |  F = Base Salary  | ...
 *
 * Match key: column A (staff number) — primary. Falls back to normalised name in B.
 *
 * To run: paste into the bound Apps Script editor, then run `previewLocationSync()`
 * to see a dry-run summary, and `applyLocationSync()` to write the updates.
 */

const SOURCE_TAB = "Apr 26 (C)";
const DATA_START_ROW = 8;

const COL_A_NUM = 1;
const COL_B_STAFF = 2;
const COL_C_LOCATION = 3;
const COL_E_ACTIVE = 5;

const TAB_PATTERN = /^(\w{3,9})\s+(\d{2})\s+\(C\)$/;

function normaliseName(s) {
  return String(s || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function buildSourceMap() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const src = ss.getSheetByName(SOURCE_TAB);
  if (!src) throw new Error("Source tab not found: " + SOURCE_TAB);

  const lastRow = src.getLastRow();
  if (lastRow < DATA_START_ROW) throw new Error("Source tab has no data rows");

  const values = src.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 5).getValues();

  const byNum = {};
  const byName = {};
  let mapped = 0;

  for (const row of values) {
    const num = row[COL_A_NUM - 1];
    const name = row[COL_B_STAFF - 1];
    const loc = String(row[COL_C_LOCATION - 1] || "").trim();
    if (!loc) continue;
    if (num !== "" && num !== null && num !== undefined) {
      byNum[String(num).trim()] = loc;
      mapped++;
    }
    const nk = normaliseName(name);
    if (nk) byName[nk] = loc;
  }

  Logger.log("Source map built from " + SOURCE_TAB + ": " + mapped + " rows with a location.");
  return { byNum, byName };
}

function syncTabLocations(sheet, map, dryRun) {
  const tabName = sheet.getName();
  const lastRow = sheet.getLastRow();
  if (lastRow < DATA_START_ROW) return { tab: tabName, rows: 0, updates: 0, missing: 0, skipped: 0 };

  const range = sheet.getRange(DATA_START_ROW, 1, lastRow - DATA_START_ROW + 1, 5);
  const values = range.getValues();

  const newLocations = []; // [{rowIndex, oldLoc, newLoc, key}]
  let activeRows = 0;
  let missing = 0;
  let skipped = 0;

  for (let i = 0; i < values.length; i++) {
    const row = values[i];
    const active = String(row[COL_E_ACTIVE - 1] || "").trim().toLowerCase();
    if (active !== "active") continue;
    activeRows++;

    const num = row[COL_A_NUM - 1];
    const nameKey = normaliseName(row[COL_B_STAFF - 1]);
    let target = null;
    let key = null;

    if (num !== "" && num !== null && num !== undefined) {
      const k = String(num).trim();
      if (map.byNum[k]) { target = map.byNum[k]; key = "#" + k; }
    }
    if (!target && nameKey && map.byName[nameKey]) {
      target = map.byName[nameKey];
      key = nameKey;
    }

    if (!target) { missing++; continue; }

    const oldLoc = String(row[COL_C_LOCATION - 1] || "").trim();
    if (oldLoc === target) { skipped++; continue; }

    newLocations.push({
      rowIndex: DATA_START_ROW + i,
      oldLoc: oldLoc,
      newLoc: target,
      key: key
    });
  }

  if (!dryRun && newLocations.length > 0) {
    for (const u of newLocations) {
      sheet.getRange(u.rowIndex, COL_C_LOCATION).setValue(u.newLoc);
    }
  }

  Logger.log(
    tabName + ": active=" + activeRows +
    " updates=" + newLocations.length +
    " unchanged=" + skipped +
    " missing-from-source=" + missing
  );
  if (newLocations.length > 0) {
    const sample = newLocations.slice(0, 5)
      .map(u => "  row " + u.rowIndex + " [" + u.key + "]: '" + u.oldLoc + "' → '" + u.newLoc + "'")
      .join("\n");
    Logger.log("Sample changes:\n" + sample);
  }

  return {
    tab: tabName,
    activeRows: activeRows,
    updates: newLocations.length,
    unchanged: skipped,
    missing: missing
  };
}

function _run(dryRun) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const map = buildSourceMap();
  const sheets = ss.getSheets();
  const results = [];

  for (const sheet of sheets) {
    const name = sheet.getName();
    if (!TAB_PATTERN.test(name)) continue;
    if (name === SOURCE_TAB) continue;
    results.push(syncTabLocations(sheet, map, dryRun));
  }

  const totals = results.reduce((acc, r) => ({
    tabs: acc.tabs + 1,
    activeRows: acc.activeRows + r.activeRows,
    updates: acc.updates + r.updates,
    unchanged: acc.unchanged + r.unchanged,
    missing: acc.missing + r.missing
  }), { tabs: 0, activeRows: 0, updates: 0, unchanged: 0, missing: 0 });

  Logger.log("");
  Logger.log("=== " + (dryRun ? "DRY RUN" : "APPLIED") + " — SUMMARY ===");
  Logger.log("Tabs processed: " + totals.tabs);
  Logger.log("Active rows scanned: " + totals.activeRows);
  Logger.log("Location updates: " + totals.updates);
  Logger.log("Already correct: " + totals.unchanged);
  Logger.log("Active staff not in source map: " + totals.missing);
  return { totals: totals, perTab: results };
}

function previewLocationSync() {
  return _run(true);
}

function applyLocationSync() {
  return _run(false);
}
