/**
 * Google Apps Script for TSC Agent Dashboard
 * Paste this script into Extensions > Apps Script in your Google Spreadsheet.
 */

function onOpen() {
  var ui = SpreadsheetApp.getUi();
  ui.createMenu('Incentive App')
    .addItem('Sync Now', 'syncNow')
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

function syncNow() {
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

  // 3. Send POST request
  var payload = JSON.stringify({
    mainRows: mainRows,
    qualityRows: qualityRows,
  });

  var endpoint = syncUrl.replace(/\/+$/, '') + '/api/sync';
  var options = {
    method: 'post',
    contentType: 'application/json',
    headers: {
      'X-Sync-Key': syncKey,
    },
    payload: payload,
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
    var successMsg = 'Sync successful! Rows: ' + (json.rows || 0) + ', Agents: ' + (json.agents || 0) + (json.lastDataDate ? ' (Data up to ' + json.lastDataDate + ')' : '');
    if (json.warnings && json.warnings.length > 0) {
      successMsg += '\nWarnings: ' + json.warnings.join('; ');
    }
    report_(interactive, ss, 'Sync Complete', successMsg, false);
  } else {
    report_(interactive, ss, 'Sync Failed', 'Sync failed (' + responseCode + '): ' + (json.error || responseText), true);
  }
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
