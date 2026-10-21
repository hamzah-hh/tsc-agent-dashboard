# TSC Agent Dashboard - Google Apps Script Integration

This Apps Script integrates the master sales & audit spreadsheet with the **TSC Agent Dashboard** backend.

---

## Setup Steps

### 1. Open the Google Spreadsheet
The script reads one of two layouts. When the sheet has an **`Agents`** tab it uses the clean layout; otherwise the old one (`MainSheet` and friends, below).

#### Clean layout (recommended)
Six input tabs: paste exports as values, no formulas. Headers are matched ignoring case, spaces and punctuation, so column order does not matter. The dashboard builds every agent's daily numbers from these tabs.

| Tab | One row per | Columns |
| :--- | :--- | :--- |
| `Agents` | person | `Agent_Name`, `Agent_Email_Official`, `Agent_Email_Personal`, `Agent_Location`, `Agent_Tier`, `TL_Official_Email`, `TL_Personal_Email`, `Status` |
| `Orders` | order | `Order ID`, `Order Value`, `Date`, `Credit_Date`, `Order Time`, `Order Phone / Alternate Phone`, `Agent`, `Talk Time Cohort`, `Category`, `Agent Category`, `Channel` |
| `Visits` | visit | `Visit Date Time`, `Phone`, `Agent_Email`, `Location`, `Talk_Time_(s)`, `source` |
| `Dialer` | agent per day | `Date`, `Agent_ID`, `Day_Type`, `Total_Unique_Connected_Calls`, `Total_Talk_Time_sec` (other columns are ignored) |
| `PreSales` | agent per day | `Date`, `Agent_ID`, `Calls`, `TT_Per_Call_(sec)` |
| `Quality` | agent and month | `Month` ("Oct-2026"), `Agent_Email`, `Total_Audits`, `Average_Score` |
| `Breaks` | agent per day | `Date`, `Agent_ID`, `Day_Type`, `Bio_or_Misc`, `First_Break`, `Lunch_Break`, `Last_Break`, `Total_Break`, `After_Call_Work`, `Idle_Time`, `Staffed_Duration`, `Idle_Time_+_After_Call_Work` (seconds; `Idle_Time+ACW_%` is recalculated) |
| `Targets` | TL / Manager | `Manager_Email`, `Total Sales in Diwali Period`, `Total Target in Diwali Period` |

| `Anirban_Ref` | day x category x cohort | `Month`, `Day_Number`, `Date`, `Sale_Category`, `TT_Cohort`, `Order_Count`, `Sales` |
| `Business_Overview` | past months by tier (one row per Month and Tier) | `Month`, `Tier` (HO Caller / Store Callers - Andheri / Store Callers - Bangalore / All), `Outbound_Calls`, `Avg_Outbound_Calls_Per_Agent_Day`, `Connected_Calls`, `Avg_Connected_Calls_Per_Agent_Day`, `Talk_Time_Sec`, `Avg_Talk_Time_Sec`, `Revenue` (rupees), `Avg_Revenue_Per_Agent`, `Active_Team_Size`, `AOV`, `Quality_Score`, `Quality_Score_Pre_Sales` |
| `Anirban_Cohort_Reportv2` | day, sale category, talk time cohort | Same columns as `Anirban_Ref` (`Month`, `Day_Number`, `Date`, `Sale_Category`, `TT_Cohort`, `Order_Count`, `Sales`), on the April onwards attribution. Shown behind the **View April_Onwards Attribution** button of the Cohort Report |
| `Diwali_Projection` | day | `Date`, `DoW`, `Week_Flag`, `Sale_Percentage`, `Company_Projection`, `Company_Actual`, `Attributed_Revenue`, `3_min_Revenue` (the % columns are recalculated) |
| `Company_DOD` | company revenue per day and channel | `date`, `channel`, `sales`, `order_id` (orders), `Main_Channel` (Retail / Website / Marketplace) |

`Breaks` and `Targets` feed only the **Team Summary & Targets** page (TLs and Managers). `Anirban_Ref`, `Company_DOD` and `Diwali_Projection` feed only the private **Talk Time Cohort Report**, which only Anirban (anirban.tsc@gmail.com) and the owner (agha.h489@gmail.com) can open in the app (not Managers or TLs). Note that anyone with the sheet's link can still read the tab in Google Sheets. Other tabs (`TL_AM_Ref`, ...) are ignored.

Rules:
- **Only people in `Agents` count.** Rows for any other email are left out (the sync warning lists them). A `Status` other than `Active` excludes the person (this replaces `Excluded_Agents`). Every active agent can sign in, even before their first data.
- **Orders** count on `Credit_Date` (`Credited_Date` also works); leave it blank to use the order `Date`. Orders credited outside the cycle are left out. One agent gets an `Order ID` once; an order under two agents counts in full for both. `Category` gives the team revenue split (`Shopify`, `Bought From Another Number`, `Marketplace`, `POS OC`).
- **Visits:** one agent gets a phone number's visit once (the earliest). A visit under two agents counts for both. Visits from another number can be added later with their real visit date.
- **Worked days** come from `Dialer` only: `Day_Type` 1 or 0.5 (or `Full Day` / `Half Day`). A Pre Sales day with calls counts as one worked day.
- **Pre Sales talk time** is `TT_Per_Call_(sec)`, weighted by `Calls` over the cycle. A cell that is not a number (`#VALUE!`) is skipped with a warning.
- Dates may be real dates or text (`2026-10-01`, `01-10-2026`).

#### Old layout
Open the Google Sheet containing the `MainSheet` and `D-1_QualityAudit_Summary` tabs.

**MainSheet columns.** The sync finds columns by header name, so column order does not matter. Besides the original columns it reads two Pre Sales columns:

| Column | Used for |
| :--- | :--- |
| `Inbound_Calls` | Pre Sales only: inbound calls that day. Averaged over Active Days (sum of `Day`; a Pre Sales row with `Day` blank and calls above 0 counts as 1 day). |
| `Avg_TT_per_day` | Pre Sales only: that day's average talk time in **seconds**. Weighted by `Inbound_Calls` over the cycle. |

Pre Sales agents use `Agent_Tier` = `PreSales` (`Pre Sales` and `pre-sales` also work) and `Agent_Location` = `Dighe`. Leave the revenue columns (`Sales`, `Count_of_Orders`, `Unique_Connects`, `Talk_Time_Minutes`, store visits) blank for Pre Sales rows, and leave `Inbound_Calls` / `Avg_TT_per_day` blank for HO and Store rows. A Pre Sales agent needs a row in `D-1_QualityAudit_Summary`: without an audit both incentives stay at ₹0.

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
2. Click **Incentive App** > **Sync Now**, which asks which sheets to sync (all are ticked; untick what you do not want; **Sync all sheets (no questions)** skips the question). You can tick only the sheets you want (the incentive data is one unit; every report tab can be chosen alone). Choosing only report tabs saves just those and leaves the rest of the dashboard, and the "data last updated" bar, untouched. The daily trigger always syncs all sheets without asking.
3. When prompted, review and grant the required permissions (Spreadsheets and External Connections).
4. Verify the dialog shows success with the count of rows and agents processed.

### 7. Install Daily Trigger
1. Click **Incentive App** > **Install daily trigger**.
2. This configures an automatic trigger that runs daily at about 1:30 PM IST (Apps Script may start it up to 15 minutes early or late).
3. Open the **Triggers** page (clock icon in the Apps Script sidebar), click the trigger, and set **Failure notification settings** to **Notify me immediately**. When the daily sync fails (wrong key, server down, headers changed), the run is marked as Failed and you get an email. A successful daily run is now marked as successful (before this fix, every daily run ended with an error, because a trigger cannot open a dialog, so a real failure looked like a good run).
