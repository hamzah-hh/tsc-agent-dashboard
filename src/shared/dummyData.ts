import { RawMainRow, RawQualityRow } from './types';

/**
 * Demo data for the Super Admin Test Center: exactly 3 demo users, one for each Agent Type.
 * Every row is flagged isTest = true, so "Clear Test Data" removes them and, once test mode is off,
 * they stay out of leaderboards and team totals.
 *
 * A blank login email gets a placeholder that nobody can sign in with. The demo user can still be
 * opened by a Super Admin from the Team view.
 */
export interface DemoLogins {
  hoEmail?: string; // personal Gmail that logs in as the demo HO Caller
  storeEmail?: string; // ... as the demo Store Caller
  preSalesEmail?: string; // ... as the demo Pre Sales agent
  tlDigheEmail?: string; // TL for the two Dighe demo users
  tlAndheriEmail?: string; // TL for the Andheri demo user
}

interface DemoAgent {
  kind: 'HO' | 'STORE' | 'PRE_SALES';
  name: string;
  official: string;
  personal: string;
  location: string;
  tier: string; // Agent_Tier text exactly as the sheet writes it
  tlOfficial: string;
  tlPersonal: string;
  perDay: {
    sales: number;
    orders: number;
    connects: number;
    talkSeconds: number;
    visitsBooked: number;
    visitsAttributed: number;
    inboundCalls: number; // Pre Sales
    avgTalkSeconds: number; // Pre Sales (a daily average, not a total)
  };
  audits: number;
  qualityScore: number;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

function clean(email?: string): string {
  return (email || '').trim().toLowerCase();
}

function listDates(start: string, end: string): string[] {
  const dates: string[] = [];
  const cur = new Date(start + 'T00:00:00Z');
  const last = new Date(end + 'T00:00:00Z');
  while (cur <= last) {
    dates.push(cur.toISOString().split('T')[0]);
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return dates;
}

function monthLabel(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  return `${MONTHS[d.getUTCMonth()]}-${String(d.getUTCFullYear()).slice(2)}`;
}

function demoAgents(logins: DemoLogins): DemoAgent[] {
  const tlDighe = clean(logins.tlDigheEmail) || 'tl.dighe@test.local';
  const tlAndheri = clean(logins.tlAndheriEmail) || 'tl.andheri@test.local';

  return [
    {
      // By mid November: Class B (about 107% of the HO target), High bands, Tier 1 rider (6 visits short of Tier 2)
      kind: 'HO',
      name: 'Demo HO Caller',
      official: 'demo.ho@test.local',
      personal: clean(logins.hoEmail) || 'demo.ho.login@test.local',
      location: 'Dighe',
      tier: 'HO Callers',
      tlOfficial: 'tl.dighe@test.local',
      tlPersonal: tlDighe,
      perDay: {
        sales: 250000,
        orders: 5,
        connects: 148,
        talkSeconds: 11100,
        visitsBooked: 5,
        visitsAttributed: 4,
        inboundCalls: 0,
        avgTalkSeconds: 0,
      },
      audits: 12,
      qualityScore: 92,
    },
    {
      // By mid November: Class A (about 95% of the Store target), Mid bands, Tier 2 rider.
      // Leaves room to show "what if" in the Simulator.
      kind: 'STORE',
      name: 'Demo Store Caller',
      official: 'demo.store@test.local',
      personal: clean(logins.storeEmail) || 'demo.store.login@test.local',
      location: 'Andheri',
      tier: 'Store Callers',
      tlOfficial: 'tl.andheri@test.local',
      tlPersonal: tlAndheri,
      perDay: {
        sales: 320000,
        orders: 6,
        connects: 142,
        talkSeconds: 10100,
        visitsBooked: 0,
        visitsAttributed: 8,
        inboundCalls: 0,
        avgTalkSeconds: 0,
      },
      audits: 10,
      qualityScore: 88,
    },
    {
      // Quality gate met (90 >= 85): calls tier 2 (118/day) + talk time tier 2 (195 s)
      kind: 'PRE_SALES',
      name: 'Demo Pre Sales',
      official: 'demo.presales@test.local',
      personal: clean(logins.preSalesEmail) || 'demo.presales.login@test.local',
      location: 'Dighe (Pre Sales)',
      tier: 'PreSales',
      tlOfficial: 'tl.dighe@test.local',
      tlPersonal: tlDighe,
      perDay: {
        sales: 0,
        orders: 0,
        connects: 0,
        talkSeconds: 0,
        visitsBooked: 0,
        visitsAttributed: 0,
        inboundCalls: 118,
        avgTalkSeconds: 195,
      },
      audits: 8,
      qualityScore: 90,
    },
  ];
}

export function generateDummyData(
  startDate = '2026-10-01',
  dataUpTo = '2026-11-15',
  logins: DemoLogins = {}
): { mainRows: RawMainRow[]; qualityRows: RawQualityRow[] } {
  const agents = demoAgents(logins);
  const dates = listDates(startDate, dataUpTo);

  const mainRows: RawMainRow[] = [];
  const qualityRows: RawQualityRow[] = [];

  agents.forEach((agent, agentIdx) => {
    qualityRows.push({
      Agent_Email_Official: agent.official,
      Total_Audits: agent.audits,
      Average_Audit_Score: agent.qualityScore,
    });

    dates.forEach((date, dayIdx) => {
      const isSunday = new Date(date + 'T00:00:00Z').getUTCDay() === 0;
      // Sundays are off (Day 0). Each demo user also has one half day (Day 0.5).
      let day = 1;
      if (isSunday) day = 0;
      else if (dayIdx === 4 + agentIdx) day = 0.5;

      const p = agent.perDay;
      const scale = (n: number) => Math.round(n * day);

      const row: RawMainRow = {
        Date: date,
        Month: monthLabel(date),
        Agent_Name: agent.name,
        Agent_Email_Official: agent.official,
        Agent_Email_Personal: agent.personal,
        Agent_Location: agent.location,
        Agent_Tier: agent.tier,
        TL_Official_Email: agent.tlOfficial,
        TL_Personal_Email: agent.tlPersonal,
        Day: day,
        isTest: true,
      };

      if (agent.kind === 'PRE_SALES') {
        // Pre Sales rows only carry calls and the daily average talk time; revenue columns stay blank.
        Object.assign(row, {
          Count_of_Orders: '',
          Sales: '',
          Average_Order_Value: '',
          Unique_Connects: '',
          'Talk_Time_(seconds)': '',
          Store_Visits_Booked: '',
          Store_Visits_Attributed: '',
          Inbound_Calls: scale(p.inboundCalls),
          Avg_TT_per_day: day > 0 ? p.avgTalkSeconds : '',
        });
      } else {
        const orders = scale(p.orders);
        const sales = scale(p.sales);
        Object.assign(row, {
          Count_of_Orders: orders,
          Sales: sales,
          Average_Order_Value: orders > 0 ? Math.round(sales / orders) : 0,
          Unique_Connects: scale(p.connects),
          'Talk_Time_(seconds)': scale(p.talkSeconds),
          // Store Callers do not have Visits Booked (blank in the sheet)
          Store_Visits_Booked: agent.kind === 'HO' ? scale(p.visitsBooked) : '',
          Store_Visits_Attributed: scale(p.visitsAttributed),
          Inbound_Calls: '',
          Avg_TT_per_day: '',
        });
      }

      mainRows.push(row);
    });
  });

  return { mainRows, qualityRows };
}
