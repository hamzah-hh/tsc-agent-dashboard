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

function syncNow() {
  var isInteractive = true;
  try {
    SpreadsheetApp.getActiveSpreadsheet();
  } catch (e) {
    isInteractive = false;
  }

  var scriptProperties = PropertiesService.getScriptProperties();
  var syncUrl = scriptProperties.getProperty('SYNC_URL');
  var syncKey = scriptProperties.getProperty('SYNC_KEY');
  var cycleStart = scriptProperties.getProperty('CYCLE_START');
  var cycleEnd = scriptProperties.getProperty('CYCLE_END');

  if (!syncUrl || !syncKey) {
    var errorMsg = 'Missing Script Properties: SYNC_URL or SYNC_KEY not set. Check Project Settings > Script Properties.';
    console.error(errorMsg);
    if (isInteractive) {
      SpreadsheetApp.getUi().alert('Configuration Error', errorMsg, SpreadsheetApp.getUi().ButtonSet.OK);
    }
    return;
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var mainSheet = ss.getSheetByName('MainSheet');
  var qualitySheet = ss.getSheetByName('D-1_QualityAudit_Summary');

  if (!mainSheet) {
    var notFoundMsg = "Sheet 'MainSheet' was not found.";
    console.error(notFoundMsg);
    if (isInteractive) {
      SpreadsheetApp.getUi().alert('Error', notFoundMsg, SpreadsheetApp.getUi().ButtonSet.OK);
    }
    return;
  }

  // 1. Read MainSheet
  var mainData = mainSheet.getDataRange().getValues();
  if (mainData.length < 2) {
    var emptyMsg = "'MainSheet' is empty.";
    console.error(emptyMsg);
    if (isInteractive) {
      SpreadsheetApp.getUi().alert('Notice', emptyMsg, SpreadsheetApp.getUi().ButtonSet.OK);
    }
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

  try {
    var response = UrlFetchApp.fetch(endpoint, options);
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
      console.log(successMsg);
      if (isInteractive) {
        SpreadsheetApp.getUi().alert('Sync Complete', successMsg, SpreadsheetApp.getUi().ButtonSet.OK);
      } else {
        ss.toast(successMsg, 'Sync Complete', 5);
      }
    } else {
      var failMsg = 'Sync failed (' + responseCode + '): ' + (json.error || responseText);
      console.error(failMsg);
      if (isInteractive) {
        SpreadsheetApp.getUi().alert('Sync Failed', failMsg, SpreadsheetApp.getUi().ButtonSet.OK);
      } else {
        ss.toast(failMsg, 'Sync Error', 8);
      }
    }
  } catch (err) {
    console.error('Fetch error during sync:', err);
    if (isInteractive) {
      SpreadsheetApp.getUi().alert('Network Error', String(err), SpreadsheetApp.getUi().ButtonSet.OK);
    } else {
      ss.toast(String(err), 'Network Error', 8);
    }
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

  // Create daily trigger at hour 13 (1 PM - 2 PM in script time zone)
  ScriptApp.newTrigger('syncNow')
    .timeBased()
    .atHour(13)
    .everyDays(1)
    .create();

  SpreadsheetApp.getUi().alert(
    'Trigger Installed',
    'Daily sync trigger scheduled between 1:00 PM and 2:00 PM IST.',
    SpreadsheetApp.getUi().ButtonSet.OK
  );
}
