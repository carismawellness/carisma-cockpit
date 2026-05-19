/**
 * EBIDA Layer Pull — Zoho transactions-daily into EBITDA workbook
 *
 * Adds "Pull EBIDA Layer (Daily Granular)" under the Zoho Data menu.
 * Calls /api/finance/zoho-transactions-daily with {date_from, date_to, org}.
 * Endpoint may either write the sheet server-side (returns rows_written)
 * or return {rows, dates} for client-side write.
 *
 * Spreadsheet: 1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s
 */

var EBIDA_SPREADSHEET_ID = "1WWM7W6S5wtSC-5hdlcuJgW3zbYaO7YRgg4_-Bju4-5s";
var EBIDA_TAB            = "EBIDA Layer";
var COCKPIT_BASE         = "https://carisma-support-u2vb.vercel.app";

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
  '#status{margin-top:12px;padding:8px 10px;border-radius:4px;font-size:12px;display:none}' +
  '.info{background:#e8f0fe;color:#1967d2}' +
  '.ok{background:#e6f4ea;color:#137333}' +
  '.err{background:#fce8e6;color:#c5221f}' +
  '</style></head>' +
  '<body>' +
  '<h3>Pull EBIDA Layer</h3>' +
  '<p>Daily granular Zoho transaction data into the <strong>EBIDA Layer</strong> tab. Wide pull (Jan 2025 → today) <strong>may take 2–5 minutes</strong>; do not close this dialog.</p>' +
  '<label>From</label><input type="date" id="df"/>' +
  '<label>To</label><input type="date" id="dt"/>' +
  '<label>Org</label><select id="org"><option value="SPA" selected>SPA</option><option value="Aesthetics">Aesthetics</option></select>' +
  '<button id="btn" onclick="go()">Pull</button>' +
  '<div id="status"></div>' +
  '<script>' +
  'var now=new Date(),y=now.getFullYear(),m=String(now.getMonth()+1).padStart(2,"0"),d=String(now.getDate()).padStart(2,"0");' +
  'document.getElementById("df").value="2025-01-01";' +
  'document.getElementById("dt").value=y+"-"+m+"-"+d;' +
  'function go(){' +
  '  var df=document.getElementById("df").value,dt=document.getElementById("dt").value,org=document.getElementById("org").value;' +
  '  if(!df||!dt){show("Please select both dates.","err");return;}' +
  '  document.getElementById("btn").disabled=true;' +
  '  show("Fetching daily transactions from Zoho — may take 2–5 minutes…","info");' +
  '  google.script.run' +
  '    .withSuccessHandler(function(r){show(r,"ok");document.getElementById("btn").disabled=false;})' +
  '    .withFailureHandler(function(e){show("Error: "+e.message,"err");document.getElementById("btn").disabled=false;})' +
  '    .pullAndWriteEbidaLayer(df,dt,org);' +
  '}' +
  'function show(msg,cls){var el=document.getElementById("status");el.textContent=msg;el.className=cls;el.style.display="block";}' +
  '<\/script></body></html>';

function showEbidaLayerDialog() {
  var html = HtmlService.createHtmlOutput(EBIDA_DIALOG_HTML).setWidth(360).setHeight(380);
  SpreadsheetApp.getUi().showModalDialog(html, "Pull EBIDA Layer");
}

function pullAndWriteEbidaLayer(dateFrom, dateTo, org) {
  var url = COCKPIT_BASE + "/api/finance/zoho-transactions-daily";
  var payload = { date_from: dateFrom, date_to: dateTo, org: org };

  var resp = UrlFetchApp.fetch(url, {
    method:             "post",
    contentType:        "application/json",
    payload:            JSON.stringify(payload),
    muteHttpExceptions: true,
    headers:            { "Accept": "application/json" }
  });

  var code = resp.getResponseCode();
  var body = resp.getContentText();
  if (code !== 200) {
    try {
      var err = JSON.parse(body);
      throw new Error(err.error || "API returned " + code);
    } catch (e) {
      throw new Error("API returned " + code + ": " + body.slice(0, 200));
    }
  }

  var data = JSON.parse(body);

  if (typeof data.rows_written === "number") {
    return data.message || ("✓ Written " + data.rows_written + " rows to " + EBIDA_TAB);
  }

  if (Array.isArray(data.rows) && Array.isArray(data.dates)) {
    var n = _writeEbidaLayerGrid(data.rows, data.dates, dateFrom, dateTo, org);
    return "✓ Written " + data.rows.length + " rows × " + data.dates.length + " days to " + EBIDA_TAB;
  }

  throw new Error("Unexpected response structure: expected rows_written or rows+dates");
}

function _writeEbidaLayerGrid(rows, dates, dateFrom, dateTo, org) {
  var ss    = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(EBIDA_TAB) || ss.insertSheet(EBIDA_TAB);

  sheet.clearContents();
  sheet.clearFormats();

  var META_COLS = ["Brand", "Venue", "Line Item", "Account Code", "EBITDA Category", "Split Rule", "Tag Source"];
  var metaCount = META_COLS.length;
  var totalCols = metaCount + dates.length;

  var titleRow = new Array(totalCols).fill("");
  titleRow[0] = "EBIDA Layer — " + org + "  |  " + dateFrom + " to " + dateTo;
  titleRow[totalCols - 1] = "Last pulled: " + new Date().toLocaleString("en-GB");

  var headerRow = META_COLS.concat(dates);

  var data = [titleRow, headerRow];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    var daily = r.daily || {};
    var line = [
      r.brand || "",
      r.venue || "",
      r.account_name || r.line_item || "",
      r.account_code || "",
      r.ebitda_category || "",
      r.split_rule || "",
      r.tag_source || ""
    ];
    for (var d = 0; d < dates.length; d++) {
      var v = daily[dates[d]];
      line.push((v === undefined || v === null || v === "") ? "" : v);
    }
    data.push(line);
  }

  sheet.getRange(1, 1, data.length, totalCols).setValues(data);

  var titleRange = sheet.getRange(1, 1, 1, totalCols);
  if (totalCols > 1) titleRange.merge();
  titleRange.setBackground("#1a1a2e").setFontColor("#ffffff").setFontWeight("bold");

  sheet.getRange(2, 1, 1, totalCols)
    .setBackground("#e8f0fe")
    .setFontColor("#1967d2")
    .setFontWeight("bold");

  if (rows.length > 0 && dates.length > 0) {
    sheet.getRange(3, metaCount + 1, rows.length, dates.length)
      .setNumberFormat("#,##0.00;(#,##0.00);-");
  }

  sheet.setFrozenRows(2);
  sheet.setFrozenColumns(metaCount);

  sheet.setColumnWidth(1, 110);
  sheet.setColumnWidth(2, 140);
  sheet.setColumnWidth(3, 240);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 150);
  sheet.setColumnWidth(6, 130);
  sheet.setColumnWidth(7, 120);

  sheet.getRange(1, totalCols).setValue("Last pulled: " + new Date().toLocaleString("en-GB"));

  return rows.length;
}
