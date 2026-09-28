import { RawMainRow, RawQualityRow } from './types';

export interface DummyAgentConfig {
  name: string;
  official: string;
  personal: string;
  location: string;
  tier: string;
  tlOfficial: string;
  tlPersonal: string;
  profileRate: {
    salesPerDay: number;
    ordersPerDay: number;
    connectsPerDay: number;
    talkSecPerDay: number;
    visitsBooked: number;
    visitsAttributed: number;
    audits: number;
    qualityScore: number;
  };
}

export function generateDummyData(
  startDate = '2026-10-01',
  dataUpTo = '2026-10-20',
  customEmails: {
    digheEmail?: string;
    tlDigheEmail?: string;
    andheriEmail?: string;
    bangaloreEmail?: string;
  } = {}
): { mainRows: RawMainRow[]; qualityRows: RawQualityRow[] } {
  const agentConfigs: DummyAgentConfig[] = [
    // Dighe (HO Callers)
    {
      name: 'Dighe Agent One (D-Tier)',
      official: 'dighe.agent1@test.local',
      personal: customEmails.digheEmail || 'agent1.dighe@test.local',
      location: 'Dighe',
      tier: 'HO Callers',
      tlOfficial: 'tl.dighe@test.local',
      tlPersonal: customEmails.tlDigheEmail || 'tl.dighe@test.local',
      profileRate: {
        salesPerDay: 850000,
        ordersPerDay: 18,
        connectsPerDay: 155,
        talkSecPerDay: 11500,
        visitsBooked: 14,
        visitsAttributed: 13,
        audits: 12,
        qualityScore: 94,
      },
    },
    {
      name: 'Dighe Agent Two (B-Tier)',
      official: 'dighe.agent2@test.local',
      personal: 'dummy2.dighe@example.com',
      location: 'Dighe',
      tier: 'HO Callers',
      tlOfficial: 'tl.dighe@test.local',
      tlPersonal: customEmails.tlDigheEmail || 'tl.dighe@test.local',
      profileRate: {
        salesPerDay: 580000,
        ordersPerDay: 12,
        connectsPerDay: 142,
        talkSecPerDay: 10200,
        visitsBooked: 10,
        visitsAttributed: 9,
        audits: 10,
        qualityScore: 88,
      },
    },
    {
      name: 'Dighe Agent Three (NQ-Tier)',
      official: 'dighe.agent3@test.local',
      personal: 'dummy3.dighe@example.com',
      location: 'Dighe',
      tier: 'HO Callers',
      tlOfficial: 'tl.dighe@test.local',
      tlPersonal: customEmails.tlDigheEmail || 'tl.dighe@test.local',
      profileRate: {
        salesPerDay: 200000,
        ordersPerDay: 4,
        connectsPerDay: 110,
        talkSecPerDay: 6000,
        visitsBooked: 2,
        visitsAttributed: 2,
        audits: 0,
        qualityScore: 0,
      },
    },

    // Andheri (Store Callers)
    {
      name: 'Andheri Agent One (C-Tier)',
      official: 'andheri.agent1@test.local',
      personal: customEmails.andheriEmail || 'agent1.andheri@test.local',
      location: 'Andheri',
      tier: 'Store Callers',
      tlOfficial: 'tl.andheri@test.local',
      tlPersonal: 'tl.andheri@test.local',
      profileRate: {
        salesPerDay: 950000,
        ordersPerDay: 15,
        connectsPerDay: 147,
        talkSecPerDay: 11000,
        visitsBooked: 22,
        visitsAttributed: 20,
        audits: 15,
        qualityScore: 91,
      },
    },
    {
      name: 'Andheri Agent Two (A-Tier)',
      official: 'andheri.agent2@test.local',
      personal: 'dummy5.andheri@example.com',
      location: 'Andheri',
      tier: 'Store Callers',
      tlOfficial: 'tl.andheri@test.local',
      tlPersonal: 'tl.andheri@test.local',
      profileRate: {
        salesPerDay: 680000,
        ordersPerDay: 11,
        connectsPerDay: 135,
        talkSecPerDay: 9600,
        visitsBooked: 18,
        visitsAttributed: 16,
        audits: 10,
        qualityScore: 86,
      },
    },
    {
      name: 'Andheri Agent Three (NQ-Tier)',
      official: 'andheri.agent3@test.local',
      personal: 'dummy6.andheri@example.com',
      location: 'Andheri',
      tier: 'Store Callers',
      tlOfficial: 'tl.andheri@test.local',
      tlPersonal: 'tl.andheri@test.local',
      profileRate: {
        salesPerDay: 300000,
        ordersPerDay: 5,
        connectsPerDay: 115,
        talkSecPerDay: 7000,
        visitsBooked: 5,
        visitsAttributed: 4,
        audits: 5,
        qualityScore: 78,
      },
    },

    // Bangalore (Store Callers)
    {
      name: 'Bangalore Agent One (D-Tier)',
      official: 'bangalore.agent1@test.local',
      personal: customEmails.bangaloreEmail || 'agent1.bangalore@test.local',
      location: 'Bangalore',
      tier: 'Store Callers',
      tlOfficial: 'tl.bangalore@test.local',
      tlPersonal: 'tl.bangalore@test.local',
      profileRate: {
        salesPerDay: 1250000,
        ordersPerDay: 20,
        connectsPerDay: 158,
        talkSecPerDay: 12000,
        visitsBooked: 26,
        visitsAttributed: 24,
        audits: 16,
        qualityScore: 96,
      },
    },
    {
      name: 'Bangalore Agent Two (C-Tier)',
      official: 'bangalore.agent2@test.local',
      personal: 'dummy8.bangalore@example.com',
      location: 'Bangalore',
      tier: 'Store Callers',
      tlOfficial: 'tl.bangalore@test.local',
      tlPersonal: 'tl.bangalore@test.local',
      profileRate: {
        salesPerDay: 960000,
        ordersPerDay: 16,
        connectsPerDay: 148,
        talkSecPerDay: 11400,
        visitsBooked: 21,
        visitsAttributed: 20,
        audits: 15,
        qualityScore: 95,
      },
    },
    {
      name: 'Bangalore Agent Three (NQ-Tier)',
      official: 'bangalore.agent3@test.local',
      personal: 'dummy9.bangalore@example.com',
      location: 'Bangalore',
      tier: 'Store Callers',
      tlOfficial: 'tl.bangalore@test.local',
      tlPersonal: 'tl.bangalore@test.local',
      profileRate: {
        salesPerDay: 350000,
        ordersPerDay: 6,
        connectsPerDay: 120,
        talkSecPerDay: 7500,
        visitsBooked: 8,
        visitsAttributed: 7,
        audits: 6,
        qualityScore: 82,
      },
    },
  ];

  const cur = new Date(startDate);
  const end = new Date(dataUpTo);
  const dateStrings: string[] = [];

  while (cur <= end) {
    dateStrings.push(cur.toISOString().split('T')[0]);
    cur.setDate(cur.getDate() + 1);
  }

  const generatedMainRows: RawMainRow[] = [];
  const generatedQualityRows: RawQualityRow[] = [];

  agentConfigs.forEach((agent, agentIdx) => {
    generatedQualityRows.push({
      Agent_Email_Official: agent.official,
      Total_Audits: agent.profileRate.audits,
      Average_Audit_Score: agent.profileRate.qualityScore,
    });

    dateStrings.forEach((dStr, dayIdx) => {
      let dayVal = 1;
      if (dayIdx % 7 === 6) {
        dayVal = 0;
      } else if (dayIdx === (agentIdx % 5) + 2) {
        dayVal = 0.5;
      }

      const multiplier = dayVal;
      const sales = Math.round(agent.profileRate.salesPerDay * multiplier);
      const orders = Math.round(agent.profileRate.ordersPerDay * multiplier);
      const connects = Math.round(agent.profileRate.connectsPerDay * multiplier);
      const talkSeconds = Math.round(agent.profileRate.talkSecPerDay * multiplier);
      const visitsBooked = Math.round(agent.profileRate.visitsBooked * multiplier);
      const visitsAttributed = Math.round(agent.profileRate.visitsAttributed * multiplier);
      const aov = orders > 0 ? Math.round(sales / orders) : 0;

      generatedMainRows.push({
        Date: dStr,
        Month: 'October',
        Agent_Name: agent.name,
        Agent_Email_Official: agent.official,
        Agent_Email_Personal: agent.personal,
        Agent_Location: agent.location,
        Agent_Tier: agent.tier,
        Count_of_Orders: orders,
        Sales: sales,
        Average_Order_Value: aov,
        Unique_Connects: connects,
        'Talk_Time_(seconds)': talkSeconds,
        TL_Official_Email: agent.tlOfficial,
        TL_Personal_Email: agent.tlPersonal,
        Store_Visits_Booked: visitsBooked,
        Store_Visits_Attributed: visitsAttributed,
        Day: dayVal,
        isTest: true,
      });
    });
  });

  return { mainRows: generatedMainRows, qualityRows: generatedQualityRows };
}
