import type { TestCaseDefinition } from './incentive.testcases';
import {
  bookingOutcome,
  canChangeDay,
  cutoffMs,
  dayProblem,
  defaultWeekdayLimit,
  effectiveLimit,
  feasibilityWarning,
  firstChangeableDay,
  istDay,
  lastBookableDay,
  sameWeek,
  swapEligible,
  swapExpiryMs,
  teamKeyOf,
  weekEnd,
  weekStart,
} from './roster';

/** An IST wall-clock moment as a UTC timestamp: ist('2026-11-18', 9, 30) is Wed 18 Nov 2026, 09:30 IST. */
const ist = (day: string, h = 0, m = 0) => Date.parse(day + 'T00:00:00Z') + (h * 60 + m) * 60000 - 330 * 60000;

const same = (actual: string, expected: string) => ({ passed: actual === expected, expected, actual });

/**
 * Rostering rules (src/shared/roster.ts). Run by `npm test` next to the incentive cases.
 * 2026-11-18 is a Wednesday; 2026-11-21/22 are Saturday/Sunday.
 */
export const rosterTestCases: TestCaseDefinition[] = [
  {
    id: 101,
    description: 'IST dates: 23:30 UTC on 17 Nov is already 18 Nov in India; weeks run Monday to Sunday',
    run: () =>
      same(
        [istDay(Date.parse('2026-11-17T23:30:00Z')), weekStart('2026-11-18'), weekEnd('2026-11-18'), weekStart('2026-11-22'), weekStart('2026-11-23')].join(' '),
        '2026-11-18 2026-11-16 2026-11-22 2026-11-16 2026-11-23'
      ),
  },
  {
    id: 102,
    description: 'Booking window: WOs up to the Sunday two weeks after this week (Wed 18 Nov -> Sun 6 Dec); PL 60 days from today',
    run: () => same(`${lastBookableDay('WO', '2026-11-18')} ${lastBookableDay('PL', '2026-11-18')} ${lastBookableDay('WO', '2026-11-22')}`, '2026-12-06 2027-01-17 2026-12-06'),
  },
  {
    id: 103,
    description: 'Cut-off: an agent may change Thu 19 Nov until Wed 18 Nov 18:00 IST; a TL until Thu 00:00 IST; a manager any time but not past days',
    run: () => {
      const day = '2026-11-19';
      const agent = [ist('2026-11-18', 17, 59), ist('2026-11-18', 18, 0)].map((t) => canChangeDay(day, 'agent', t));
      const tl = [ist('2026-11-18', 23, 59), ist('2026-11-19', 0, 0)].map((t) => canChangeDay(day, 'tl', t));
      const manager = [ist('2026-11-19', 14, 0), ist('2026-11-20', 0, 1)].map((t) => canChangeDay(day, 'manager', t));
      return same([...agent, ...tl, ...manager].join(), 'true,false,true,false,true,false');
    },
  },
  {
    id: 104,
    description: 'The first day an agent can still change: Thu 19 Nov at 17:59 on Wed, Fri 20 Nov at 18:01; a TL Thu 19; a manager today',
    run: () =>
      same(
        [firstChangeableDay('agent', ist('2026-11-18', 17, 59)), firstChangeableDay('agent', ist('2026-11-18', 18, 1)), firstChangeableDay('tl', ist('2026-11-18', 20, 0)), firstChangeableDay('manager', ist('2026-11-18', 20, 0))].join(' '),
        '2026-11-19 2026-11-20 2026-11-19 2026-11-18'
      ),
  },
  {
    id: 105,
    description: 'Day problems: past day, after the window, past the agent cut-off; a valid weekday has none',
    run: () => {
      const now = ist('2026-11-18', 10, 0);
      const out = [
        dayProblem('WO', '2026-11-17', 'agent', now),
        dayProblem('WO', '2026-12-07', 'agent', now),
        dayProblem('PL', '2026-12-07', 'agent', now),
        dayProblem('WO', '2026-11-18', 'agent', now),
        dayProblem('WO', '2026-11-19', 'agent', now),
      ].map((p) => (p === null ? 'ok' : p.slice(0, 22)));
      return same(out.join('|'), 'That day has already p|Weekly offs can only b|ok|Changes for Wed 18 Nov|ok');
    },
  },
  {
    id: 106,
    description: 'Default weekday limit is team size / 5 rounded up (17 -> 4, 15 -> 3, 1 -> 1, 0 -> 0); weekends have none',
    run: () => {
      const wed = effectiveLimit('2026-11-18', null, null, 17);
      const sat = effectiveLimit('2026-11-21', null, null, 17);
      return same(`${[17, 15, 1, 0, 16].map(defaultWeekdayLimit).join()} ${wed.limit}/${wed.source} ${sat.limit}/${sat.source}`, '4,3,1,0,4 4/default null/none');
    },
  },
  {
    id: 107,
    description: 'Limit precedence: a date limit beats the all-days limit, which beats the default; a weekend with only an all-days limit uses it',
    run: () => {
      const a = effectiveLimit('2026-11-18', 2, 5, 17);
      const b = effectiveLimit('2026-11-18', null, 5, 17);
      const c = effectiveLimit('2026-11-21', null, 3, 17);
      const d = effectiveLimit('2026-11-18', 0, null, 17);
      return same(`${a.limit}/${a.source} ${b.limit}/${b.source} ${c.limit}/${c.source} ${d.limit}/${d.source}`, '2/date 5/all 3/all 0/date');
    },
  },
  {
    id: 108,
    description: 'Booking outcome: first weekday WO approved at once; 2nd WO in the week, any weekend WO and every PL wait for the TL; weekends skip the limit check',
    run: () => {
      const o = (kind: 'WO' | 'PL', day: string, n: number) => {
        const x = bookingOutcome(kind, day, n);
        return `${x.status}${x.enforceLimit ? '+limit' : ''}`;
      };
      return same(
        [o('WO', '2026-11-18', 0), o('WO', '2026-11-19', 1), o('WO', '2026-11-21', 0), o('WO', '2026-11-22', 0), o('PL', '2026-11-18', 0), o('PL', '2026-11-21', 0)].join(' '),
        'approved+limit pending+limit pending pending pending+limit pending'
      );
    },
  },
  {
    id: 109,
    description: 'Team key: the TL official email, else the TL personal email, else the location; the weekly feasibility warning appears only when the weekday limits cannot fit the team',
    run: () => {
      const keys = [teamKeyOf({ tlOfficialEmail: ' TL@x.in ', tlPersonalEmail: 'a@b.c', location: 'Dighe' }), teamKeyOf({ tlPersonalEmail: 'A@B.c' }), teamKeyOf({ location: 'Dighe (Pre Sales)' })];
      const warn = [feasibilityWarning(17, [4, 4, 4, 4, 4]), feasibilityWarning(17, [3, 3, 3, 3, 3]), feasibilityWarning(0, [0, 0, 0, 0, 0])].map((w) => (w ? 'warn' : 'ok'));
      return same(`${keys.join()} ${warn.join()} ${cutoffMs('2026-11-19', 'superAdmin')}`, 'tl@x.in,a@b.c,loc:dighe (pre sales) ok,warn,ok Infinity');
    },
  },
  {
    id: 110,
    description: 'Swap eligibility: same type, location and TL only (Dighe HO with Dighe HO yes; with Dighe Pre Sales no; Andheri Store with Bangalore Store no; a different TL no; case and spacing in the location do not matter)',
    run: () => {
      const ho = { agentType: 'HO', location: 'Dighe', tlOfficialEmail: 'tl@x.in' };
      const rows = [
        swapEligible(ho, { agentType: 'HO', location: ' dighe ', tlOfficialEmail: 'TL@x.in' }),
        swapEligible(ho, { agentType: 'PRE_SALES', location: 'Dighe (Pre Sales)', tlOfficialEmail: 'tl@x.in' }),
        swapEligible({ agentType: 'STORE', location: 'Andheri', tlOfficialEmail: 't@x.in' }, { agentType: 'STORE', location: 'Bangalore', tlOfficialEmail: 't@x.in' }),
        swapEligible(ho, { agentType: 'HO', location: 'Dighe', tlOfficialEmail: 'other@x.in' }),
        swapEligible({ location: 'Dighe' }, { location: 'Dighe' }),
      ];
      return same(rows.join(), 'true,false,false,false,false');
    },
  },
  {
    id: 111,
    description: 'Swaps stay inside one week (Mon-Sun): Thu 19 and Sat 21 Nov yes; Sun 22 and Mon 23 Nov no',
    run: () => same([sameWeek('2026-11-19', '2026-11-21'), sameWeek('2026-11-22', '2026-11-23'), sameWeek('2026-11-16', '2026-11-22')].join(), 'true,false,true'),
  },
  {
    id: 112,
    description: 'A swap request lapses at the earlier agent cut-off of its two days, or after 72 hours',
    run: () => {
      const now = ist('2026-11-18', 10, 0);
      const soon = swapExpiryMs('2026-11-19', '2026-11-21', now); // Thu 19 cut-off: Wed 18:00
      const later = swapExpiryMs('2026-11-27', '2026-11-28', now); // 72 hours from now wins
      return same(`${soon === ist('2026-11-18', 18, 0)} ${later === now + 72 * 3600000}`, 'true true');
    },
  },
];
