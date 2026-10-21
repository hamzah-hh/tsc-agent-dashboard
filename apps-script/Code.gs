/**
 * Google Apps Script for TSC Agent Dashboard
 * Paste this script into Extensions > Apps Script in your Google Spreadsheet.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Incentive App')
    .addItem('Sync Now', 'syncNow')
    .addItem('Sync all sheets (no questions)', 'syncAll')
    .addItem('Install daily trigger', 'installDailyTrigger')
    .addToUi();
}

/** True when a person started the script from the sheet (menu), false in a time-driven trigger. */
function isInteractive_() {
  try {
    SpreadsheetApp.getUi();
    return true;
  } catch (e) {
    return false;
  }
}

/**
 * Tells whoever ran the sync what happened.
 * - From the menu: a dialog.
 * - From the daily trigger nobody is watching: a toast, and a FAILURE is thrown only when the sync
 *   really failed. The run then shows as "Failed" under Executions, and Apps Script can email the owner
 *   (Triggers > Failure notification settings). Before, every daily run ended with an error (a trigger
 *   cannot open a dialog), so a real failure looked exactly like a good run.
 */
function report_(interactive, ss, title, message, isError) {
  if (isError) {
    console.error(title + ': ' + message);
  } else {
    console.log(title + ': ' + message);
  }
  if (interactive) {
    var ui = SpreadsheetApp.getUi();
    ui.alert(title, message, ui.ButtonSet.OK);
    return;
  }
  try {
    ss.toast(message, title, isError ? 8 : 5);
  } catch (e) {
    // a toast is only a courtesy
  }
  if (isError) {
    throw new Error(title + ': ' + message);
  }
}

/**
 * From the menu: opens the list of sheets to choose from (all ticked). From the daily trigger, where nobody
 * can answer a dialog: syncs all sheets.
 */
function syncNow() {
  if (isInteractive_()) {
    showSyncPicker();
    return;
  }
  syncAll();
}

/** Syncs every sheet without asking. */
function syncAll() {
  var interactive = isInteractive_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();

  var scriptProperties = PropertiesService.getScriptProperties();
  var syncUrl = scriptProperties.getProperty('SYNC_URL');
  var syncKey = scriptProperties.getProperty('SYNC_KEY');
  var cycleStart = scriptProperties.getProperty('CYCLE_START');
  var cycleEnd = scriptProperties.getProperty('CYCLE_END');

  if (!syncUrl || !syncKey) {
    report_(interactive, ss, 'Configuration Error',
      'Missing Script Properties: SYNC_URL or SYNC_KEY not set. Check Project Settings > Script Properties.', true);
    return;
  }

  // Clean layout (an Agents tab): send the six input tabs and stop here
  if (ss.getSheetByName('Agents')) {
    sendPayload_(interactive, ss, syncUrl, syncKey, cleanPayload_(ss));
    return;
  }

  var mainSheet = ss.getSheetByName('MainSheet');
  var qualitySheet = ss.getSheetByName('D-1_QualityAudit_Summary');

  if (!mainSheet) {
    report_(interactive, ss, 'Error', "Sheet 'MainSheet' was not found.", true);
    return;
  }

  // 1. Read MainSheet
  var mainData = mainSheet.getDataRange().getValues();
  if (mainData.length < 2) {
    report_(interactive, ss, 'Notice', "'MainSheet' is empty.", true);
    return;
  }

  var mainHeaders = mainData[0];
  var mainRows = [];

  for (var i = 1; i < mainData.length; i++) {
    var row = mainData[i];
    var obj = {};
    for (var j = 0; j < mainHeaders.length; j++) {
      var header = String(mainHeaders[j]).trim();
      var val = row[j];

      // Format Date objects to yyyy-MM-dd in Asia/Kolkata
      if (val instanceof Date) {
        val = Utilities.formatDate(val, 'Asia/Kolkata', 'yyyy-MM-dd');
      }
      obj[header] = val;
    }

    // Keep rows between CYCLE_START and CYCLE_END if provided
    var rowDateStr = String(obj['Date'] || '').trim();
    if (cycleStart && rowDateStr && rowDateStr < cycleStart) {
      continue;
    }
    if (cycleEnd && rowDateStr && rowDateStr > cycleEnd) {
      continue;
    }

    mainRows.push(obj);
  }

  // 2. Read Quality Sheet if available
  var qualityRows = [];
  if (qualitySheet) {
    var qData = qualitySheet.getDataRange().getValues();
    if (qData.length >= 2) {
      var qHeaders = qData[0];
      for (var q = 1; q < qData.length; q++) {
        var qRow = qData[q];
        var qObj = {};
        for (var k = 0; k < qHeaders.length; k++) {
          var qh = String(qHeaders[k]).trim();
          qObj[qh] = qRow[k];
        }
        qualityRows.push(qObj);
      }
    }
  }

  // 3. Read Revenue Breakdown Sheet if available (DoD_AgentRevenue, Revenue, ChannelRevenue, TeamRevenue)
  var revenueSheet =
    ss.getSheetByName('DoD_AgentRevenue') ||
    ss.getSheetByName('Revenue') ||
    ss.getSheetByName('ChannelRevenue') ||
    ss.getSheetByName('TeamRevenue') ||
    ss.getSheetByName('RevenueBreakdown');
  var revenueRows = [];
  if (revenueSheet) {
    var rData = revenueSheet.getDataRange().getValues();
    if (rData.length >= 2) {
      var rHeaders = rData[0];
      for (var r = 1; r < rData.length; r++) {
        var rRow = rData[r];
        var rObj = {};
        for (var l = 0; l < rHeaders.length; l++) {
          var rh = String(rHeaders[l]).trim();
          var rVal = rRow[l];
          if (rVal instanceof Date) {
            rVal = Utilities.formatDate(rVal, 'Asia/Kolkata', 'yyyy-MM-dd');
          }
          rObj[rh] = rVal;
        }
        revenueRows.push(rObj);
      }
    }
  }

  // 4. Read Leader_Mapping Sheet if available
  var leaderMappingSheet = ss.getSheetByName('Leader_Mapping');
  var leaderMappingRows = [];
  if (leaderMappingSheet) {
    var lmData = leaderMappingSheet.getDataRange().getValues();
    if (lmData.length >= 2) {
      var lmHeaders = lmData[0];
      for (var lmIdx = 1; lmIdx < lmData.length; lmIdx++) {
        var lmRow = lmData[lmIdx];
        var lmObj = {};
        for (var lmH = 0; lmH < lmHeaders.length; lmH++) {
          var lmHeaderName = String(lmHeaders[lmH]).trim();
          lmObj[lmHeaderName] = lmRow[lmH];
        }
        leaderMappingRows.push(lmObj);
      }
    }
  }

  // 5. Read Excluded_Agents Sheet if available
  var excludedAgentsSheet = ss.getSheetByName('Excluded_Agents');
  var excludedAgentsRows = [];
  if (excludedAgentsSheet) {
    var exData = excludedAgentsSheet.getDataRange().getValues();
    if (exData.length >= 2) {
      var exHeaders = exData[0];
      for (var exIdx = 1; exIdx < exData.length; exIdx++) {
        var exRow = exData[exIdx];
        var exObj = {};
        for (var exH = 0; exH < exHeaders.length; exH++) {
          var exHeaderName = String(exHeaders[exH]).trim();
          exObj[exHeaderName] = exRow[exH];
        }
        excludedAgentsRows.push(exObj);
      }
    }
  }

  // 6. Read Raw_Visit Sheet if available
  var rawVisitSheet = ss.getSheetByName('Raw_Visit');
  var rawVisitRows = [];
  if (rawVisitSheet) {
    var rvData = rawVisitSheet.getDataRange().getValues();
    if (rvData.length >= 2) {
      var rvHeaders = rvData[0];
      for (var rvIdx = 1; rvIdx < rvData.length; rvIdx++) {
        var rvRow = rvData[rvIdx];
        var rvObj = {};
        for (var rvH = 0; rvH < rvHeaders.length; rvH++) {
          var rvHeaderName = String(rvHeaders[rvH]).trim();
          var rvVal = rvRow[rvH];
          if (rvVal instanceof Date) {
            rvVal = Utilities.formatDate(rvVal, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
          }
          rvObj[rvHeaderName] = rvVal;
        }
        rawVisitRows.push(rvObj);
      }
    }
  }

  // 7. Read Raw_Revenue Sheet if available
  var rawRevenueTabSheet = ss.getSheetByName('Raw_Revenue');
  var rawRevenueTabRows = [];
  if (rawRevenueTabSheet) {
    var rrData = rawRevenueTabSheet.getDataRange().getValues();
    if (rrData.length >= 2) {
      var rrHeaders = rrData[0];
      for (var rrIdx = 1; rrIdx < rrData.length; rrIdx++) {
        var rrRow = rrData[rrIdx];
        var rrObj = {};
        for (var rrH = 0; rrH < rrHeaders.length; rrH++) {
          var rrHeaderName = String(rrHeaders[rrH]).trim();
          var rrVal = rrRow[rrH];
          if (rrVal instanceof Date) {
            rrVal = Utilities.formatDate(rrVal, 'Asia/Kolkata', 'yyyy-MM-dd HH:mm:ss');
          }
          rrObj[rrHeaderName] = rrVal;
        }
        rawRevenueTabRows.push(rrObj);
      }
    }
  }

  // 8. Send POST request
  sendPayload_(interactive, ss, syncUrl, syncKey, {
    mainRows: mainRows,
    qualityRows: qualityRows,
    revenueRows: revenueRows,
    leaderMappingRows: leaderMappingRows,
    excludedAgentsRows: excludedAgentsRows,
    rawVisitRows: rawVisitRows,
    rawRevenueTabRows: rawRevenueTabRows,
  });
}

/** Posts the rows to the dashboard (gzip-compressed when large) and reports the outcome. */
function sendPayload_(interactive, ss, syncUrl, syncKey, data) {
  var payload = JSON.stringify(data);

  var endpoint = syncUrl.replace(/\/+$/, '') + '/api/sync';
  var headers = {
    'X-Sync-Key': syncKey,
  };
  var body = payload;
  // Vercel refuses request bodies over about 4.5 MB. A big sheet is sent gzip-compressed (sheet JSON
  // shrinks about 10x; the server unpacks it). Smaller syncs are sent as plain JSON, as before.
  if (payload.length > 3500000) {
    body = Utilities.gzip(Utilities.newBlob(payload, 'application/json')).getBytes();
    headers['Content-Encoding'] = 'gzip';
  }
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: headers,
    payload: body,
    muteHttpExceptions: true,
  };

  var response;
  try {
    response = UrlFetchApp.fetch(endpoint, options);
  } catch (err) {
    report_(interactive, ss, 'Network Error', String(err), true);
    return;
  }

  var responseCode = response.getResponseCode();
  var responseText = response.getContentText();
  var json = {};
  try {
    json = JSON.parse(responseText);
  } catch (e) {
    json = { error: responseText };
  }

  if (responseCode >= 200 && responseCode < 300 && json.result === 'ok') {
    if (json.partial) {
      var partialMsg = 'Saved: ' + ((json.saved && json.saved.length) ? json.saved.join(', ') : 'nothing (the chosen sheets were empty or missing)') + '. The incentive data was not synced.';
      if (json.warnings && json.warnings.length > 0) {
        partialMsg += '\nWarnings: ' + json.warnings.join('; ');
      }
      report_(interactive, ss, 'Sync Complete', partialMsg, false);
      return;
    }
    var successMsg = 'Sync successful! Rows: ' + (json.rows || 0) + ', Agents: ' + (json.agents || 0) + (json.lastDataDate ? ' (Data up to ' + json.lastDataDate + ')' : '');
    if (json.warnings && json.warnings.length > 0) {
      successMsg += '\nWarnings: ' + json.warnings.join('; ');
    }
    report_(interactive, ss, 'Sync Complete', successMsg, false);
  } else {
    report_(interactive, ss, 'Sync Failed', 'Sync failed (' + responseCode + '): ' + (json.error || responseText), true);
  }
}

/**
 * The clean layout: Agents, Orders, Visits, Dialer, PreSales and Quality, with no MainSheet.
 * Every tab is sent as it is; the dashboard builds the daily values from them.
 * Dates are sent as the sheet shows them (the spreadsheet's own time zone), as 'yyyy-MM-dd HH:mm:ss'.
 */
var CLEAN_TABS_ = {
  agentsRows: 'Agents',
  ordersRows: 'Orders',
  visitsRows: 'Visits',
  dialerRows: 'Dialer',
  preSalesRows: 'PreSales',
  qualityRows: 'Quality',
  breaksRows: 'Breaks',
  targetsRows: 'Targets',
  cohortRows: 'Anirban_Ref',
  cohortV2Rows: 'Anirban_Cohort_Reportv2',
  companyDodRows: 'Company_DOD',
  businessOverviewRows: 'Business_Overview',
  diwaliRows: 'Diwali_Projection',
};

function readTab_(ss, name, timeZone) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return [];
  var data = sheet.getDataRange().getValues();
  var rows = [];
  if (data.length < 2) return rows;
  var headers = data[0];
  for (var i = 1; i < data.length; i++) {
    var obj = {};
    var filled = false;
    for (var j = 0; j < headers.length; j++) {
      var header = String(headers[j]).trim();
      if (!header) continue;
      var val = data[i][j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, timeZone, 'yyyy-MM-dd HH:mm:ss');
      }
      if (val !== '' && val !== null) filled = true;
      obj[header] = val;
    }
    if (filled) rows.push(obj);
  }
  return rows;
}

/**
 * What "Sync selected sheets" offers. The incentive data (first group) is one unit: its tabs depend on each
 * other, so they are synced together or not at all. Every report tab can be chosen on its own.
 */
var SYNC_GROUPS_ = [
  {
    id: 'core',
    label: 'Incentive data: Agents, Orders, Visits, Dialer, PreSales, Quality, Breaks, Targets',
    keys: ['agentsRows', 'ordersRows', 'visitsRows', 'dialerRows', 'preSalesRows', 'qualityRows', 'breaksRows', 'targetsRows'],
    required: 'Agents',
  },
  { id: 'cohort', label: 'Anirban_Ref (Talk Time Cohort report)', keys: ['cohortRows'] },
  { id: 'cohortV2', label: 'Anirban_Cohort_Reportv2 (April onwards attribution)', keys: ['cohortV2Rows'] },
  { id: 'companyDod', label: 'Company_DOD', keys: ['companyDodRows'] },
  { id: 'diwali', label: 'Diwali_Projection', keys: ['diwaliRows'] },
  { id: 'businessOverview', label: 'Business_Overview (past months)', keys: ['businessOverviewRows'] },
];

/** Every tab of the full sync. Report tabs that do not exist in this spreadsheet are left out, so they are never emptied. */
function cleanPayload_(ss, onlyKeys) {
  var timeZone = ss.getSpreadsheetTimeZone() || 'Asia/Kolkata';
  var data = { format: 'clean-v1' };
  var coreKeys = SYNC_GROUPS_[0].keys;
  for (var key in CLEAN_TABS_) {
    if (onlyKeys && onlyKeys.indexOf(key) < 0) continue;
    var isCore = coreKeys.indexOf(key) >= 0;
    if (!isCore && !ss.getSheetByName(CLEAN_TABS_[key])) continue;
    data[key] = readTab_(ss, CLEAN_TABS_[key], timeZone);
  }
  return data;
}

/** Opens the list of sheets to choose from. */
function showSyncPicker() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var groups = [];
  for (var i = 0; i < SYNC_GROUPS_.length; i++) {
    var g = SYNC_GROUPS_[i];
    var missing = [];
    for (var k = 0; k < g.keys.length; k++) {
      if (!ss.getSheetByName(CLEAN_TABS_[g.keys[k]])) missing.push(CLEAN_TABS_[g.keys[k]]);
    }
    // The incentive data needs its Agents tab; a report tab needs its own tab
    var exists = g.required ? !!ss.getSheetByName(g.required) : missing.length === 0;
    groups.push({ id: g.id, label: g.label, exists: exists, note: exists ? '' : 'sheet not found' });
  }
  var html =
    '<div style="font-family:Arial,sans-serif;font-size:13px">' +
    '<p style="margin:0 0 8px">Choose the sheets to sync. Sheets you leave out are not touched on the dashboard.</p>' +
    '<div id="list"></div>' +
    '<p style="margin:10px 0 0"><a href="#" onclick="setAll(true);return false">Select all</a> &middot; ' +
    '<a href="#" onclick="setAll(false);return false">Clear</a></p>' +
    '<p id="msg" style="color:#b00020;min-height:18px;margin:8px 0"></p>' +
    '<button id="go" onclick="go()" style="padding:6px 16px">Sync selected</button> ' +
    '<button onclick="google.script.host.close()" style="padding:6px 16px">Cancel</button>' +
    '</div>' +
    '<script>' +
    'var groups=' + JSON.stringify(groups).replace(/</g, '\\u003c') + ';' +
    'var list=document.getElementById("list");' +
    'groups.forEach(function(g){var l=document.createElement("label");l.style.display="block";l.style.margin="4px 0";' +
    'var c=document.createElement("input");c.type="checkbox";c.id="g_"+g.id;c.checked=g.exists;c.disabled=!g.exists;' +
    'l.appendChild(c);l.appendChild(document.createTextNode(" "+g.label+(g.note?" ("+g.note+")":"")));list.appendChild(l);});' +
    'function setAll(v){groups.forEach(function(g){if(g.exists)document.getElementById("g_"+g.id).checked=v;});}' +
    'function go(){var ids=groups.filter(function(g){return g.exists&&document.getElementById("g_"+g.id).checked;}).map(function(g){return g.id;});' +
    'var msg=document.getElementById("msg");if(!ids.length){msg.textContent="Choose at least one sheet.";return;}' +
    'msg.style.color="#333";msg.textContent="Syncing...";document.getElementById("go").disabled=true;' +
    'google.script.run.withSuccessHandler(function(){google.script.host.close();}).withFailureHandler(function(e){msg.style.color="#b00020";msg.textContent="Failed: "+e.message;document.getElementById("go").disabled=false;}).syncSelected(ids);}' +
    '</script>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(520).setHeight(360), 'Sync selected sheets');
}

/** Syncs the chosen groups (ids from SYNC_GROUPS_). Called by the picker. */
function syncSelected(groupIds) {
  var interactive = isInteractive_();
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var props = PropertiesService.getScriptProperties();
  var syncUrl = props.getProperty('SYNC_URL');
  var syncKey = props.getProperty('SYNC_KEY');
  if (!syncUrl || !syncKey) {
    report_(interactive, ss, 'Configuration Error',
      'Missing Script Properties: SYNC_URL or SYNC_KEY not set. Check Project Settings > Script Properties.', true);
    return;
  }
  var keys = [];
  var withCore = false;
  for (var i = 0; i < SYNC_GROUPS_.length; i++) {
    var g = SYNC_GROUPS_[i];
    if (!groupIds || groupIds.indexOf(g.id) < 0) continue;
    if (g.id === 'core') withCore = true;
    keys = keys.concat(g.keys);
  }
  if (keys.length === 0) {
    report_(interactive, ss, 'Nothing selected', 'Choose at least one sheet to sync.', true);
    return;
  }
  if (withCore && !ss.getSheetByName('Agents')) {
    report_(interactive, ss, 'Error', "The incentive data needs the 'Agents' sheet, which was not found.", true);
    return;
  }
  var payload = cleanPayload_(ss, keys);
  // Without the incentive data the server saves only the report tabs and leaves everything else alone
  if (!withCore) payload.partial = true;
  sendPayload_(interactive, ss, syncUrl, syncKey, payload);
}

function installDailyTrigger() {
  // Delete existing triggers for syncNow
  var triggers = ScriptApp.getProjectTriggers();
  for (var i = 0; i < triggers.length; i++) {
    if (triggers[i].getHandlerFunction() === 'syncNow') {
      ScriptApp.deleteTrigger(triggers[i]);
    }
  }

  // Daily at about 1:30 PM in the script time zone (Project Settings must say Asia/Kolkata)
  ScriptApp.newTrigger('syncNow')
    .timeBased()
    .atHour(13)
    .nearMinute(30)
    .everyDays(1)
    .create();

  SpreadsheetApp.getUi().alert(
    'Trigger Installed',
    'Daily sync trigger scheduled for about 1:30 PM IST (Apps Script may start it up to 15 minutes either side). ' +
      'In the Triggers page, set "Failure notification settings" to notify you immediately, so a failed daily sync is never silent.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
