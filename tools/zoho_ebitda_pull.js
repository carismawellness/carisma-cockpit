/**
 * Zoho SPA Data Pull — EBITDA Workbook
 *
 * Adds a "Zoho Data" menu to the EBITDA spreadsheet.
 * User picks a date range; the script calls the Cockpit API,
 * which pulls SPA P&L from Zoho Books, applies COA EBITDA mapping
 * and venue split rules, and returns structured JSON.
 * This script then writes the result to the "EBITDA Zoho data" tab.
 *
 * Spreadsheet: 1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s
 * Apps Script project: 1rqVPC2MEy3eQlcKClIKpMpuTyV02vUcopGZzR3QV6ciZt5OCvYHwx5zp
 *
 * DEPLOYMENT: Add this file as a new .gs file in the existing EBITDA project.
 * The onOpen() here merges with the existing onOpen() — rename if conflict.
 */

// ── Config ────────────────────────────────────────────────────────────────────

var COCKPIT_BASE  = "https://carisma-support-u2vb.vercel.app";
var ZOHO_TAB_NAME = "EBITDA Zoho data";

var LINE_LABELS = {
  revenue:     "Revenue",
  cogs:        "COGS",
  wages:       "Wages & Salaries",
  advertising: "Advertising",
  rent:        "Rent",
  utilities:   "Utilities",
  sga:         "SG&A"
};
var LINE_ORDER = ["revenue", "cogs", "wages", "advertising", "rent", "utilities", "sga"];

// Section header background colours
var LINE_COLOURS = {
  revenue:     "#d9ead3",
  cogs:        "#cfe2f3",
  wages:       "#fff2cc",
  advertising: "#fce5cd",
  rent:        "#ead1dc",
  utilities:   "#d0e0e3",
  sga:         "#e6d0de"
};

// ── Menu ──────────────────────────────────────────────────────────────────────

function onOpenZohoMenu() {
  SpreadsheetApp.getUi()
    .createMenu("Zoho Data")
    .addItem("Pull SPA Data from Zoho…", "showZohoPullDialog")
    .addToUi();
}

// ── Dialog HTML ───────────────────────────────────────────────────────────────

var PULL_DIALOG_HTML = '<!DOCTYPE html><html><head><base target="_top">' +
  '<style>' +
  'body{font-family:Google Sans,Arial,sans-serif;padding:20px;margin:0;font-size:13px;color:#202124}' +
  'h3{margin:0 0 6px;font-size:15px;color:#1a73e8}' +
  'p{margin:0 0 14px;color:#5f6368;font-size:12px;line-height:1.5}' +
  'label{display:block;font-weight:600;margin-bottom:4px;font-size:12px}' +
  'input[type=date]{width:100%;padding:7px 9px;border:1px solid #dadce0;border-radius:4px;font-size:13px;margin-bottom:14px;box-sizing:border-box;outline:none}' +
  'input[type=date]:focus{border-color:#1a73e8}' +
  'button{width:100%;background:#1a73e8;color:#fff;border:none;padding:9px 16px;border-radius:4px;font-size:13px;font-weight:600;cursor:pointer;transition:background 0.15s}' +
  'button:hover{background:#1557b0}' +
  'button:disabled{opacity:0.55;cursor:not-allowed}' +
  '#status{margin-top:12px;padding:8px 10px;border-radius:4px;font-size:12px;display:none}' +
  '.info{background:#e8f0fe;color:#1967d2}' +
  '.ok{background:#e6f4ea;color:#137333}' +
  '.err{background:#fce8e6;color:#c5221f}' +
  '</style></head>' +
  '<body>' +
  '<h3>Pull Zoho SPA Data</h3>' +
  '<p>Fetches the SPA P&L from Zoho Books, applies EBITDA COA mapping and venue tag rules, and writes to the <strong>EBITDA Zoho data</strong> tab.</p>' +
  '<label>From</label><input type="date" id="df"/>' +
  '<label>To</label><input type="date" id="dt"/>' +
  '<button id="btn" onclick="go()">Pull Data</button>' +
  '<div id="status"></div>' +
  '<script>' +
  'var now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,"0"),last=new Date(y,now.getMonth()+1,0).getDate();' +
  'document.getElementById("df").value=y+"-"+m+"-01";' +
  'document.getElementById("dt").value=y+"-"+m+"-"+String(last).padStart(2,"0");' +
  'function go(){' +
  '  var df=document.getElementById("df").value,dt=document.getElementById("dt").value;' +
  '  if(!df||!dt){show("Please select both dates.","err");return;}' +
  '  document.getElementById("btn").disabled=true;' +
  '  show("Fetching from Zoho Books — may take 30–60 seconds…","info");' +
  '  google.script.run' +
  '    .withSuccessHandler(function(r){show(r,"ok");document.getElementById("btn").disabled=false;})' +
  '    .withFailureHandler(function(e){show("Error: "+e.message,"err");document.getElementById("btn").disabled=false;})' +
  '    .pullAndWriteZohoData(df,dt);' +
  '}' +
  'function show(msg,cls){var el=document.getElementById("status");el.textContent=msg;el.className=cls;el.style.display="block";}' +
  '<\/script></body></html>';

function showZohoPullDialog() {
  var html = HtmlService.createHtmlOutput(PULL_DIALOG_HTML).setWidth(340).setHeight(310);
  SpreadsheetApp.getUi().showModalDialog(html, "Pull Zoho SPA Data");
}

// ── Main pull function (called from dialog) ───────────────────────────────────

function pullAndWriteZohoData(dateFrom, dateTo) {
  // 1. Call Cockpit API
  var url = COCKPIT_BASE + "/api/finance/zoho-spa-breakdown"
          + "?date_from=" + dateFrom + "&date_to=" + dateTo;

  var resp = UrlFetchApp.fetch(url, {
    method:             "get",
    muteHttpExceptions: true,
    headers:            { "Accept": "application/json" }
  });

  var code = resp.getResponseCode();
  if (code !== 200) {
    try {
      var err = JSON.parse(resp.getContentText());
      throw new Error(err.error || "API returned " + code);
    } catch (e) {
      throw new Error("API returned " + code + ": " + resp.getContentText().slice(0, 200));
    }
  }

  var data = JSON.parse(resp.getContentText());
  if (!data.accounts || !data.tag_options) {
    throw new Error("Unexpected response structure from API");
  }

  // 2. Write to sheet
  _writeZohoTab(data, dateFrom, dateTo);

  return (
    "✓ Written " + data.accounts.length + " accounts across " +
    data.tag_options.length + " venues (" + dateFrom + " – " + dateTo + ")"
  );
}

// ── Sheet writer ──────────────────────────────────────────────────────────────

function _writeZohoTab(data, dateFrom, dateTo) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(ZOHO_TAB_NAME) || ss.insertSheet(ZOHO_TAB_NAME);

  sheet.clearContents();
  sheet.clearFormats();

  var tagOptions = data.tag_options;  // [{slug, display_name, tag_option_id}]
  var accounts   = data.accounts;     // AccountRow[]
  var slugs      = tagOptions.map(function(t) { return t.slug; });
  var names      = tagOptions.map(function(t) { return t.display_name; });
  var numVenues  = names.length;
  var totalCols  = 4 + numVenues + 1;  // Account | Code | EBITDA Line | Split Rule | venues... | Total

  // ── Build rows ──────────────────────────────────────────────────────────────

  var rows       = [];
  var fmtRows    = [];  // parallel array: {bg, bold, italic} per row

  // Row 1: Title
  var titleRow = [
    "Zoho SPA — Account Breakdown  |  " + dateFrom + " to " + dateTo
  ];
  for (var c = 1; c < totalCols; c++) titleRow.push("");
  rows.push(titleRow);
  fmtRows.push({ bg: "#1a1a2e", fontColor: "#ffffff", bold: true, italic: false, type: "title" });

  // Row 2: Column headers
  var headerRow = ["Account", "Code", "EBITDA Line", "Split Rule"].concat(names).concat(["Total (Zoho)"]);
  rows.push(headerRow);
  fmtRows.push({ bg: "#e8f0fe", fontColor: "#1967d2", bold: true, italic: false, type: "header" });

  // Group accounts by EBITDA line
  var grouped = {};
  for (var i = 0; i < accounts.length; i++) {
    var acc = accounts[i];
    var line = acc.ebitda_line;
    if (!grouped[line]) grouped[line] = [];
    grouped[line].push(acc);
  }

  for (var li = 0; li < LINE_ORDER.length; li++) {
    var lineName = LINE_ORDER[li];
    var lineAccs = grouped[lineName];
    if (!lineAccs || lineAccs.length === 0) continue;

    var lineLabel = LINE_LABELS[lineName] || lineName;
    var lineBg    = LINE_COLOURS[lineName] || "#f3f3f3";

    // Section subtotal row
    var secVenueTotals = slugs.map(function(slug) {
      return lineAccs.reduce(function(s, a) { return s + (a.venue_amounts[slug] || 0); }, 0);
    });
    var secTotal = lineAccs.reduce(function(s, a) { return s + a.total; }, 0);

    var secRow = ["— " + lineLabel + " —", "", "", ""].concat(
      secVenueTotals.map(function(v) { return _round(v); })
    ).concat([_round(secTotal)]);
    rows.push(secRow);
    fmtRows.push({ bg: lineBg, fontColor: "#000000", bold: true, italic: false, type: "section" });

    // Account detail rows
    for (var ai = 0; ai < lineAccs.length; ai++) {
      var a = lineAccs[ai];
      var tagNote = a.tagged_total > 0
        ? (a.untagged_amount > 0 ? "partial tag" : "tagged")
        : "split rule";

      var detailVenues = slugs.map(function(slug) {
        var v = a.venue_amounts[slug] || 0;
        return v === 0 ? "" : _round(v);
      });

      var detailRow = [
        a.name,
        a.code || "",
        lineLabel,
        a.split_rule + " (" + tagNote + ")"
      ].concat(detailVenues).concat([_round(a.total)]);

      rows.push(detailRow);
      fmtRows.push({ bg: "", fontColor: "", bold: false, italic: tagNote === "split rule", type: "detail" });
    }

    // Blank separator
    rows.push(new Array(totalCols).fill(""));
    fmtRows.push({ bg: "", fontColor: "", bold: false, italic: false, type: "blank" });
  }

  // ── Write to sheet ──────────────────────────────────────────────────────────

  if (rows.length === 0) return;
  var range = sheet.getRange(1, 1, rows.length, totalCols);
  range.setValues(rows);

  // Apply formatting row by row
  for (var r = 0; r < fmtRows.length; r++) {
    var fmt  = fmtRows[r];
    var row  = sheet.getRange(r + 1, 1, 1, totalCols);
    if (fmt.bg)        row.setBackground(fmt.bg);
    if (fmt.fontColor) row.setFontColor(fmt.fontColor);
    if (fmt.bold)      row.setFontWeight("bold");
    if (fmt.italic)    row.setFontStyle("italic");
  }

  // Number format for venue + total columns (columns 5 to totalCols)
  var numRange = sheet.getRange(3, 5, rows.length - 2, numVenues + 1);
  numRange.setNumberFormat("#,##0.00;(#,##0.00);-");

  // Freeze header rows and info columns
  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(4);

  // Column widths
  sheet.setColumnWidth(1, 260);  // Account name
  sheet.setColumnWidth(2, 90);   // Code
  sheet.setColumnWidth(3, 110);  // EBITDA Line
  sheet.setColumnWidth(4, 160);  // Split Rule
  for (var vc = 5; vc <= 4 + numVenues; vc++) sheet.setColumnWidth(vc, 100);
  sheet.setColumnWidth(4 + numVenues + 1, 110); // Total

  // Bold the Total column header
  sheet.getRange(2, 4 + numVenues + 1, 1, 1).setFontWeight("bold").setBackground("#c9daf8");

  // Timestamp in top-right cell
  sheet.getRange(1, totalCols).setValue("Last pulled: " + new Date().toLocaleString("en-GB"));
}

// ── Helper ────────────────────────────────────────────────────────────────────

function _round(v) {
  return Math.round(v * 100) / 100;
}
function runPullNow() {
  var today = new Date();
  var todayStr = today.getFullYear() + "-" +
                 String(today.getMonth() + 1).padStart(2, "0") + "-" +
                 String(today.getDate()).padStart(2, "0");
  return pullAndWriteEbidaLayer("2025-01-01", todayStr, "SPA");
}
