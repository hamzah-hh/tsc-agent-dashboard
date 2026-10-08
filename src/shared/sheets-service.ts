import { RawMainRow, RawQualityRow } from './types';

/**
 * Extracts spreadsheetId from a Google Sheets URL or returns the clean ID string.
 */
export function extractSpreadsheetId(input: string): string {
  if (!input) return '';
  const trimmed = input.trim();
  const match = trimmed.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
  if (match && match[1]) {
    return match[1];
  }
  return trimmed;
}

export interface GoogleSheetFetchResult {
  spreadsheetTitle: string;
  sheetsFound: string[];
  mainSheetName: string;
  qualitySheetName?: string;
  revenueSheetName?: string;
  mainRows: RawMainRow[];
  qualityRows: RawQualityRow[];
  revenueRows: any[];
}

/**
 * Fetches sheet tabs and row values directly from Google Sheets API v4.
 */
export async function fetchGoogleSpreadsheetData(
  spreadsheetId: string,
  accessToken: string
): Promise<GoogleSheetFetchResult> {
  const cleanId = extractSpreadsheetId(spreadsheetId);
  if (!cleanId) {
    throw new Error('Please enter a valid Google Spreadsheet ID or URL.');
  }

  // 1. Fetch metadata to discover tabs
  const metaRes = await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}?fields=properties.title,sheets.properties.title`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!metaRes.ok) {
    const errJson = await metaRes.json().catch(() => ({}));
    const message = errJson?.error?.message || `Google Sheets API error HTTP ${metaRes.status}`;
    if (metaRes.status === 403 || metaRes.status === 401) {
      throw new Error(`Google Sheets access denied: ${message}. Make sure your Google account has read access to this spreadsheet.`);
    }
    if (metaRes.status === 404) {
      throw new Error(`Spreadsheet not found (ID: ${cleanId}). Check the URL.`);
    }
    throw new Error(message);
  }

  const metaData = await metaRes.json();
  const spreadsheetTitle = metaData.properties?.title || 'Google Sheet';
  const sheets: string[] = (metaData.sheets || []).map((s: any) => s.properties?.title).filter(Boolean);

  if (sheets.length === 0) {
    throw new Error('No sheet tabs were found in this spreadsheet.');
  }

  // Identify sheet tabs (case-insensitive search)
  const mainSheetName =
    sheets.find((n) => ['mainsheet', 'sheet1', 'performance', 'data'].includes(n.toLowerCase())) ||
    sheets[0];

  const qualitySheetName = sheets.find((n) =>
    ['quality', 'qualityaudit', 'd-1_qualityaudit_summary'].some((q) => n.toLowerCase().includes(q))
  );

  const revenueSheetName = sheets.find((n) =>
    ['revenue', 'channelrevenue', 'teamrevenue', 'revenuebreakdown'].some((r) => n.toLowerCase().includes(r))
  );

  // Helper to fetch and parse rows from a sheet tab
  const fetchSheetRows = async (tabName: string): Promise<Record<string, any>[]> => {
    const encTab = encodeURIComponent(tabName);
    const valRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${cleanId}/values/${encTab}?valueRenderOption=FORMATTED_VALUE&dateTimeRenderOption=FORMATTED_STRING`,
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
        },
      }
    );

    if (!valRes.ok) {
      const err = await valRes.json().catch(() => ({}));
      throw new Error(`Failed to read sheet tab "${tabName}": ${err?.error?.message || valRes.statusText}`);
    }

    const valData = await valRes.json();
    const rows: any[][] = valData.values || [];
    if (rows.length < 2) return [];

    const headers = rows[0].map((h: any) => String(h || '').trim());
    const parsedRows: Record<string, any>[] = [];

    for (let i = 1; i < rows.length; i++) {
      const rowArr = rows[i];
      const rowObj: Record<string, any> = {};
      let hasData = false;

      for (let j = 0; j < headers.length; j++) {
        const header = headers[j];
        if (!header) continue;
        const val = rowArr[j] !== undefined && rowArr[j] !== null ? rowArr[j] : '';
        rowObj[header] = val;
        if (val !== '') hasData = true;
      }

      if (hasData) {
        parsedRows.push(rowObj);
      }
    }

    return parsedRows;
  };

  const mainRows = (await fetchSheetRows(mainSheetName)) as RawMainRow[];
  const qualityRows = qualitySheetName
    ? ((await fetchSheetRows(qualitySheetName)) as RawQualityRow[])
    : [];
  const revenueRows = revenueSheetName
    ? await fetchSheetRows(revenueSheetName)
    : [];

  return {
    spreadsheetTitle,
    sheetsFound: sheets,
    mainSheetName,
    qualitySheetName,
    revenueSheetName,
    mainRows,
    qualityRows,
    revenueRows,
  };
}
