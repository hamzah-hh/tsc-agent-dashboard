# TSC Agent Dashboard - Google Apps Script Integration

This Apps Script integrates the master sales & audit spreadsheet with the **TSC Agent Dashboard** backend.

---

## Setup Steps

### 1. Open the Google Spreadsheet
Open the Google Sheet containing the `MainSheet` and `D-1_QualityAudit_Summary` tabs.

**MainSheet columns.** The sync finds columns by header name, so column order does not matter. Besides the original columns it reads two Pre Sales columns:

| Column | Used for |
| :--- | :--- |
| `Inbound_Calls` | Pre Sales only: inbound calls that day. Averaged over Active Days (sum of `Day`). |
| `Avg_TT_per_day` | Pre Sales only: that day's average talk time in **seconds**. Weighted by `Inbound_Calls` over the cycle. |

Pre Sales agents use `Agent_Tier` = `PreSales` (`Pre Sales` and `pre-sales` also work) and `Agent_Location` = `Dighe`. Leave the revenue columns (`Sales`, `Count_of_Orders`, `Unique_Connects`, `Talk_Time_(seconds)`, store visits) blank for Pre Sales rows, and leave `Inbound_Calls` / `Avg_TT_per_day` blank for HO and Store rows. A Pre Sales agent needs a row in `D-1_QualityAudit_Summary`: without an audit both incentives stay at ₹0.

### 2. Open Apps Script
In the top menu, navigate to:
**Extensions** > **Apps Script**

### 3. Paste the Code
- Delete any code in the editor (`Code.gs`).
- Copy the entire contents of `apps-script/Code.gs` and paste it into the editor.
- Click the disk icon **Save** (or press `Ctrl+S` / `Cmd+S`).

### 4. Set the Script Time Zone
- In the left sidebar of the Apps Script editor, click the gear icon **Project Settings**.
- Ensure the time zone is set to **(GMT+05:30) India Standard Time - Kolkata** (`Asia/Kolkata`).

### 5. Set the 4 Script Properties
Scroll down to **Script Properties** on the same **Project Settings** page and add the following 4 properties:

| Property | Value / Description | Example |
| :--- | :--- | :--- |
| `SYNC_URL` | The base URL of your deployed TSC Agent Dashboard app (without trailing slash) | `https://your-app-url.run.app` |
| `SYNC_KEY` | The secret sync key matching the server's `SYNC_KEY` environment variable | `YourSecretSyncKey123` |
| `CYCLE_START` | Start date of the active cycle in `YYYY-MM-DD` | `2026-10-01` |
| `CYCLE_END` | End date of the active cycle in `YYYY-MM-DD` | `2026-11-30` |

Click **Save script properties**.

### 6. Authorize & Test
1. Refresh the spreadsheet. A new menu item **Incentive App** will appear in the top menu bar.
2. Click **Incentive App** > **Sync Now**.
3. When prompted, review and grant the required permissions (Spreadsheets and External Connections).
4. Verify the dialog shows success with the count of rows and agents processed.

### 7. Install Daily Trigger
1. Click **Incentive App** > **Install daily trigger**.
2. This configures an automatic trigger that runs daily at about 1:30 PM IST (Apps Script may start it up to 15 minutes early or late).
3. Open the **Triggers** page (clock icon in the Apps Script sidebar), click the trigger, and set **Failure notification settings** to **Notify me immediately**. When the daily sync fails (wrong key, server down, headers changed), the run is marked as Failed and you get an email. A successful daily run is now marked as successful (before this fix, every daily run ended with an error, because a trigger cannot open a dialog, so a real failure looked like a good run).
