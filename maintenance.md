# TSC Agent Dashboard — Setup & Daily Maintenance Guide

This document is the operational runbook for administrators and developers managing the **TSC Agent Dashboard** (production URL: `https://tsc-agent-db.ai.studio/`).

---

## 1. System Architecture & Components

| Component | Technology | Purpose |
| :--- | :--- | :--- |
| **Frontend** | React 19, Vite, Tailwind CSS, Lucide Icons, Recharts | Caller performance UI, target simulator, team view, and leaderboards |
| **Backend API** | Node.js (v22), Express, TypeScript (TSX) | REST endpoints for data sync, authentication verification, and calculation engine |
| **Database** | Google Cloud Firestore (`(default)` in project `tsc-data-506812`) | Real-time persistent storage for cycles, agents, leaderboards, access control, and logs |
| **Authentication** | Firebase Authentication (Google Sign-In) | Identity verification with role-based routing (Super Admin, Manager, TL, Caller) |
| **AI Engine** | Google Gemini 2.5 Flash via `@google/genai` | Personalized caller suggestions & Hinglish/English coaching tips |

---

## 2. One-Time Initial Setup Checklist

Follow these steps once to initialize or verify a fresh deployment.

### Step 1: Firebase Project & Firestore Configuration
1. Open the [Firebase Console](https://console.firebase.google.com/) and navigate to project **`tsc-data-506812`**.
2. Go to **Build &rarr; Firestore Database**:
   - Ensure the database is created with ID `(default)`.
3. Go to **Build &rarr; Firestore Database &rarr; Rules** and verify the security rules match `firestore.rules`:
   - `/config/app`: Readable by signed-in users, writable only by Super Admins.
   - `/access/{email}`: Readable by the authenticated user or managers/super admins.
   - `/cycles/{cycleId}`: Readable by team members, writable by Super Admins.
   - `/health/*`: Private to the backend service account.

### Step 2: Service Account Credentials
The backend uses a Google Cloud Service Account to read and write to Firestore.
- **Service Account**: `firebase-adminsdk-fbsvc@tsc-data-506812.iam.gserviceaccount.com`
- **Required IAM Role**: **Cloud Datastore User** (or Firebase Admin SDK Administrator).
- **Files in repo**:
  - `server-service-account.ts`: Directly embedded credentials for Cloud Run production execution.
  - `service-account.json`: Local development key.

### Step 3: Firebase Authentication & Authorized Domains
1. In the Firebase Console, go to **Build &rarr; Authentication &rarr; Sign-in method**:
   - Ensure **Google** is **Enabled**.
2. Go to the **Settings** tab &rarr; scroll to **Authorized domains**:
   - Confirm the following domains are in the list:
     - `localhost`
     - `tsc-agent-db.ai.studio`
     - `ai.studio`
     - `*.run.app` (for Cloud Run preview deployments)

### Step 4: Core Configuration in Firestore (`config/app`)
The single document `/config/app` governs app-wide settings.
- **`superAdmins`**: `['agha.h489@gmail.com']`
- **`managers`**: Array of manager emails (cross-location overview).
- **`activeCycleId`**: String identifying the active cycle (e.g. `"diwali-2026"`).
- **`locations`**: `['Dighe (Pre Sales)', 'Dighe', 'Andheri', 'Bangalore']`
- **`tierMap`**:
  ```json
  {
    "PreSales": "PRE_SALES",
    "Pre Sales": "PRE_SALES",
    "HO Callers": "HO",
    "Store Callers": "STORE"
  }
  ```
- **`testMode`**: `false` (set to `true` only during automated sandbox tests).
- **`aiEnabled`**: `true`
- **`aiTone`**: `"hinglish"` (or `"english"`).

---

## 3. Team Types & Branch Rules

The dashboard models two distinct operating models:

### Model A: Revenue Branches (`Dighe`, `Andheri`, `Bangalore`)
- **Roles**: Head Office (HO) Callers and Store Callers.
- **Targets**:
  - HO Target: **₹90,00,000**
  - Store Target: **₹1,30,00,000**
- **Revenue Classes**:
  - **NQ** (&le; 90%): 0.00% rate
  - **Class A** (> 90%): 0.15% rate
  - **Class B** (> 100%): 0.30% rate
  - **Class C** (> 120%): 0.45% rate
  - **Class D** (> 160%): 0.60% rate
- **KPI Bonuses**: Quality Score, Unique Connects/day, Talk Minutes/day.
- **Rider**: Attributed store visits ladder.

### Model B: Inbound Calling Branch (`Dighe (Pre Sales)`)
*Pre Sales operates on Inbound Call Volume and Talk Time Tiers. It does **not** have revenue targets or the 4 revenue classes.*

- **Quality Score Gate**: Must score **&ge; 85%** on Quality Audits.
  - *If Quality Score is below 85% or no audits are logged, both incentive payouts are ₹0.*
- **Daily Inbound Calls Tiers (Cumulative Payout)**:
  - **Tier 1 (101 – 115 calls/day)**: ₹500
  - **Tier 2 (116 – 130 calls/day)**: ₹1,000
  - **Tier 3 (131+ calls/day)**: ₹2,000
- **Daily Average Talk Time Tiers**:
  - **Tier 1 (166 – 180 seconds)**: ₹500
  - **Tier 2 (181 – 210 seconds)**: ₹1,000
  - **Tier 3 (211+ seconds)**: ₹2,000
- **Team & Leaderboard Display**: Shows Call Volume, Talk Time seconds, and Quality Gate status.

---

## 4. Google Sheets Sync Setup (Apps Script & Direct API)

The system updates caller metrics from your primary Google Sheet:
- **Primary Google Sheet URL**: [`https://docs.google.com/spreadsheets/d/1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk/edit?usp=sharing`](https://docs.google.com/spreadsheets/d/1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk/edit?usp=sharing)
- **Spreadsheet ID**: `1cyAdyup2UontNJecjnZYdS4ndBq8qZtX9JJ5qiuq8mk`

You can sync data into the dashboard in two ways:
1. **Direct One-Click Sync**: In the **Admin** tab, click **Fetch from Google Sheet** and then **Sync Google Sheet to Dashboard Now**.
2. **Automated Nightly Webhook**: Follow the Apps Script steps below inside the linked sheet.

### Required Sheet Columns
#### Main Data Sheet
| Header | Type | Description |
| :--- | :--- | :--- |
| `Date` | `YYYY-MM-DD` | Date of recorded metrics |
| `Month` | String | e.g. "October 2026" |
| `Agent_Name` | String | Caller full name |
| `Agent_Email_Official` | String | Corporate email ID (primary key) |
| `Agent_Email_Personal` | String | Personal Gmail used for Google Sign-In |
| `Agent_Location` | String | `Dighe (Pre Sales)`, `Dighe`, `Andheri`, or `Bangalore` |
| `Agent_Tier` | String | `PreSales`, `HO Callers`, or `Store Callers` |
| `Count_of_Orders` | Number | Orders closed (Revenue branches) |
| `Sales` | Number | Net revenue in ₹ (Revenue branches) |
| `Average_Order_Value` | Number | AOV in ₹ |
| `Unique_Connects` | Number | Outbound connects count |
| `Talk_Time_Minutes` | Number | Outbound talk time in **minutes** |
| `Inbound_Calls` | Number | Inbound calls answered (**Pre Sales**) |
| `Avg_TT_per_day` | Number | Average inbound call talk time in seconds (**Pre Sales**) |
| `TL_Official_Email` | String | Team Leader official email |
| `TL_Personal_Email` | String | Team Leader personal Gmail |
| `Store_Visits_Attributed`| Number | Attributed store footfall count |
| `Day` | Number | `1` if agent worked that day, `0` if absent/off |

#### Quality Audit Sheet (Optional/Joined)
| Header | Description |
| :--- | :--- |
| `Agent_Email_Official` | Official email matching main sheet |
| `Total_Audits` | Count of quality calls evaluated |
| `Average_Audit_Score` | 0 – 100 percentage score |

### Google Apps Script Code
Add this script to your Google Sheet (`Extensions &rarr; Apps Script`):

```javascript
const DASHBOARD_SYNC_URL = "https://tsc-agent-db.ai.studio/api/sync";
const SYNC_KEY = "CHANGE_ME_TO_24_OR_MORE_RANDOM_CHARACTERS";

function syncDataToDashboard() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error("Could not find active spreadsheet. Make sure this script is opened via Extensions > Apps Script inside your Google Sheet.");
  }
  
  // 1. Read Main Performance Data (looks for MainSheet or takes the first tab)
  const allSheets = ss.getSheets();
  if (!allSheets || allSheets.length === 0) {
    throw new Error("No sheet tabs found in this spreadsheet.");
  }
  const mainSheet = 
    ss.getSheetByName("MainSheet") || 
    ss.getSheetByName("Sheet1") || 
    ss.getSheetByName("Performance") || 
    ss.getSheetByName("Data") || 
    allSheets[0];
  const mainData = getRowsAsObjects(mainSheet);
  
  // 2. Read Quality Scores (optional, from Quality tab if present)
  const qualitySheet = 
    ss.getSheetByName("Quality") || 
    ss.getSheetByName("QualityAudit") || 
    ss.getSheetByName("D-1_QualityAudit_Summary");
  const qualityData = getRowsAsObjects(qualitySheet);

  // 3. Read Channel Revenue Breakdown (optional, from Revenue tab if present)
  const revenueSheet = 
    ss.getSheetByName("Revenue") || 
    ss.getSheetByName("ChannelRevenue") || 
    ss.getSheetByName("TeamRevenue") || 
    ss.getSheetByName("RevenueBreakdown");
  const revenueData = getRowsAsObjects(revenueSheet);

  const payload = {
    mainRows: mainData,
    qualityRows: qualityData,
    revenueRows: revenueData,
    syncSource: "apps-script",
    timestamp: new Date().toISOString()
  };

  const options = {
    method: "post",
    contentType: "application/json",
    headers: {
      "X-Sync-Key": SYNC_KEY
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  };

  const response = UrlFetchApp.fetch(DASHBOARD_SYNC_URL, options);
  Logger.log("Response Code: " + response.getResponseCode());
  Logger.log("Response Body: " + response.getContentText());
}

function getRowsAsObjects(sheet) {
  if (!sheet) return [];
  const range = sheet.getDataRange();
  if (!range) return [];
  const data = range.getValues();
  if (!data || data.length < 2) return [];
  
  const tz = SpreadsheetApp.getActiveSpreadsheet()?.getSpreadsheetTimeZone() || "Asia/Kolkata";
  const headers = data[0].map(h => String(h || '').trim());
  const rows = [];
  
  for (let i = 1; i < data.length; i++) {
    const row = {};
    let hasValue = false;
    for (let j = 0; j < headers.length; j++) {
      const header = headers[j];
      if (!header) continue;
      let val = data[i][j];
      if (val instanceof Date) {
        val = Utilities.formatDate(val, tz, "yyyy-MM-dd");
      }
      row[header] = val;
      if (val !== "" && val !== null && val !== undefined) {
        hasValue = true;
      }
    }
    if (hasValue) {
      rows.push(row);
    }
  }
  return rows;
}
```

### Automation Schedule
Set up a time-driven trigger in Apps Script:
1. In Apps Script, click the **Triggers (Clock)** icon &rarr; **Add Trigger**.
2. Select function: `syncDataToDashboard`.
3. Event source: **Time-driven**.
4. Type: **Day timer** (recommended: 2:00 AM – 3:00 AM IST daily).

---

## 5. Daily Maintenance Routine

Administrators should perform these quick checks:

### 1. Check Data Freshness
- Look at the top banner in the app:
  - If data is current, no banner appears.
  - If data is older than 2 calendar days, a yellow **Stale Data Warning** appears with the date of the latest recorded metrics.
- If stale, verify the daily Apps Script execution logs or manually trigger sync from the **Test Center / Admin Panel**.

### 2. Verify Sync Logs
- Go to the **Admin / Test Center** tab &rarr; scroll to **Sync Logs**:
  - Check the status column: `OK` or `Error`.
  - Check the number of rows and active agents processed.

### 3. Adding New Agents
1. Add the agent row to the Google Sheet with their `Agent_Email_Official` and `Agent_Email_Personal` (their Google login email).
2. Run the sync.
3. The dashboard automatically provisions their `/access/{email}` document with the correct role (`agent` or `tl`) and location.

### 4. Updating Managers or Super Admins
1. Open the **Admin Panel** (visible to Super Admins).
2. Enter the manager's Gmail address under **Manager Permissions** &rarr; click **Add Manager**.
3. The change immediately updates `/config/app` in Firestore.

---

## 6. Cycle Rollover (New Month / Festival Cycle)

When starting a new incentive cycle (e.g. from `diwali-2026` to `november-2026`):

1. **Create the New Cycle Document in Firestore**:
   - Collection: `cycles`
   - Document ID: `november-2026`
   - Fields:
     ```json
     {
       "name": "November 2026 Cycle",
       "startDate": "2026-11-01",
       "endDate": "2026-11-30",
       "status": "active",
       "workingDaysPerWeek": 6
     }
     ```
2. **Update Active Cycle in `config/app`**:
   - Change `activeCycleId` to `"november-2026"`.
3. **Trigger Sheet Sync**:
   - Sync the sheet for the new month. The system will populate agents and leaderboards under the new cycle ID.
4. Historical cycles remain stored under `/cycles/{oldCycleId}` for audit and review.

---

## 7. Troubleshooting Runbook

### Issue: `Firestore read/write failed: HTTP 403 PERMISSION_DENIED`
- **Cause**: Service account lacks access to the Firestore database.
- **Resolution**:
  1. Open [Google Cloud IAM Console](https://console.cloud.google.com/iam-admin/iam?project=tsc-data-506812).
  2. Verify `firebase-adminsdk-fbsvc@tsc-data-506812.iam.gserviceaccount.com` has the **Cloud Datastore User** role.
  3. Verify `service-account.json` or `server-service-account.ts` contains the valid private key.

### Issue: `auth/unauthorized-domain` on Google Sign-In
- **Cause**: The current domain is not whitelisted in Firebase Auth.
- **Resolution**:
  1. Open Firebase Console &rarr; **Authentication** &rarr; **Settings** &rarr; **Authorized domains**.
  2. Add `tsc-agent-db.ai.studio`.

### Issue: Agent sees "Access Restricted" or cannot sign in
- **Cause**: The email they used to sign in with Google does not match their `Agent_Email_Personal` or `Agent_Email_Official` in the synced data.
- **Resolution**:
  1. Check the agent's Google login email.
  2. Update the `Agent_Email_Personal` column in the Google Sheet to match their login email.
  3. Re-sync data.

### Issue: Pre Sales shows no payouts despite high calls
- **Cause**: The Quality Gate is not met.
- **Resolution**:
  1. Verify the caller has evaluated audits in the Quality sheet.
  2. Verify their average audit score is &ge; 85%. Both Call and Talk Time incentives strictly require Quality &ge; 85%.
