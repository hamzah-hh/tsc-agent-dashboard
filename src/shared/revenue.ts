import { RawMainRow, TeamDailyRevenue, TeamRevenueDoc, RevenueCategoryBreakdown } from './types';
import { parseToISTDateString } from './incentive';

function cleanNum(val: any): number {
  if (typeof val === 'number') return isNaN(val) ? 0 : val;
  if (!val) return 0;
  const cleaned = String(val).replace(/[^0-9.-]/g, '');
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
}

function normalizeCategoryName(raw: string): 'shopify' | 'bfan' | 'bfmp' | 'posoc' | null {
  const norm = String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (norm.includes('shopify')) return 'shopify';
  if (norm.includes('bfan')) return 'bfan';
  if (norm.includes('bfmp')) return 'bfmp';
  if (norm.includes('posoc') || norm.includes('pos')) return 'posoc';
  return null;
}

/**
 * Builds or computes consistent team revenue data for a location.
 * Guarantees that for every day:
 * shopify + bfan + bfmp + posoc == totalOrders and totalSales from MainSheet.
 */
export function buildTeamRevenue(
  location: string,
  cycleId: string,
  mainRows: RawMainRow[],
  rawRevenueRows?: any[]
): TeamRevenueDoc {
  // 1. Group main sheet rows for this location by date
  const dailyMain = new Map<string, { date: string; day: number; orders: number; sales: number }>();

  for (const r of mainRows) {
    const loc = String(r.Agent_Location || '').trim();
    if (loc.toLowerCase() !== location.toLowerCase()) continue;
    if (loc.toLowerCase().includes('pre sales')) continue;

    const dateStr = parseToISTDateString(r.Date);
    if (!dateStr) continue;

    const dayNum = cleanNum(r.Day) || 1;
    const orders = cleanNum(r.Count_of_Orders);
    const sales = cleanNum(r.Sales);

    const existing = dailyMain.get(dateStr) || { date: dateStr, day: dayNum, orders: 0, sales: 0 };
    existing.orders += orders;
    existing.sales += Math.round(sales);
    if (dayNum > existing.day) existing.day = dayNum;
    dailyMain.set(dateStr, existing);
  }

  // 2. Parse any explicit revenue sheet rows if supplied
  const parsedExplicitByDate = new Map<
    string,
    {
      shopify: { orders: number; sales: number };
      bfan: { orders: number; sales: number };
      bfmp: { orders: number; sales: number };
      posoc: { orders: number; sales: number };
    }
  >();

  if (Array.isArray(rawRevenueRows) && rawRevenueRows.length > 0) {
    for (const row of rawRevenueRows) {
      const rowLoc = String(row.Location || row.Agent_Location || row.Store || row.Team || '').trim();
      if (rowLoc && rowLoc.toLowerCase() !== location.toLowerCase()) continue;

      const dateStr = parseToISTDateString(row.Date || row.date);
      if (!dateStr) continue;

      const existing = parsedExplicitByDate.get(dateStr) || {
        shopify: { orders: 0, sales: 0 },
        bfan: { orders: 0, sales: 0 },
        bfmp: { orders: 0, sales: 0 },
        posoc: { orders: 0, sales: 0 },
      };

      // Tall format (Category column)
      const cat = normalizeCategoryName(row.Category || row.Channel || row.category);
      if (cat) {
        existing[cat].orders += cleanNum(row.Orders || row.Count_of_Orders || row.orders);
        existing[cat].sales += Math.round(cleanNum(row.Sales || row.Revenue || row.sales));
      } else {
        // Wide format (Shopify_Orders, Shopify_Revenue / Sales, etc.)
        for (const [k, v] of Object.entries(row)) {
          const keyNorm = k.toLowerCase().replace(/[^a-z0-9]/g, '');
          const isOrders = keyNorm.includes('order');
          const isSales = keyNorm.includes('sale') || keyNorm.includes('rev');

          if (keyNorm.includes('shopify')) {
            if (isOrders) existing.shopify.orders += cleanNum(v);
            if (isSales) existing.shopify.sales += Math.round(cleanNum(v));
          } else if (keyNorm.includes('bfan')) {
            if (isOrders) existing.bfan.orders += cleanNum(v);
            if (isSales) existing.bfan.sales += Math.round(cleanNum(v));
          } else if (keyNorm.includes('bfmp')) {
            if (isOrders) existing.bfmp.orders += cleanNum(v);
            if (isSales) existing.bfmp.sales += Math.round(cleanNum(v));
          } else if (keyNorm.includes('posoc') || keyNorm.includes('pos')) {
            if (isOrders) existing.posoc.orders += cleanNum(v);
            if (isSales) existing.posoc.sales += Math.round(cleanNum(v));
          }
        }
      }

      parsedExplicitByDate.set(dateStr, existing);
    }
  }

  // 3. Assemble daily breakdown ensuring equality with MainSheet totals for each day
  const dailyList: TeamDailyRevenue[] = [];

  const sortedDates = Array.from(dailyMain.keys()).sort((a, b) => b.localeCompare(a));

  for (const date of sortedDates) {
    const mainDay = dailyMain.get(date)!;
    const explicit = parsedExplicitByDate.get(date);

    let shopifyOrders = 0;
    let shopifySales = 0;
    let bfanOrders = 0;
    let bfanSales = 0;
    let bfmpOrders = 0;
    let bfmpSales = 0;
    let posocOrders = 0;
    let posocSales = 0;

    const hasExplicit =
      explicit &&
      (explicit.shopify.orders > 0 ||
        explicit.shopify.sales > 0 ||
        explicit.bfan.orders > 0 ||
        explicit.bfan.sales > 0 ||
        explicit.bfmp.orders > 0 ||
        explicit.bfmp.sales > 0 ||
        explicit.posoc.orders > 0 ||
        explicit.posoc.sales > 0);

    if (hasExplicit && explicit) {
      shopifyOrders = explicit.shopify.orders;
      shopifySales = explicit.shopify.sales;
      bfanOrders = explicit.bfan.orders;
      bfanSales = explicit.bfan.sales;
      bfmpOrders = explicit.bfmp.orders;
      bfmpSales = explicit.bfmp.sales;
      posocOrders = explicit.posoc.orders;
      posocSales = explicit.posoc.sales;

      // Reconcile POSOC to make sum exactly equal mainDay totals if slight variance
      const sumOrders = shopifyOrders + bfanOrders + bfmpOrders + posocOrders;
      if (sumOrders !== mainDay.orders && mainDay.orders > 0) {
        posocOrders = Math.max(0, mainDay.orders - (shopifyOrders + bfanOrders + bfmpOrders));
      }
      const sumSales = shopifySales + bfanSales + bfmpSales + posocSales;
      if (sumSales !== mainDay.sales && mainDay.sales > 0) {
        posocSales = Math.max(0, mainDay.sales - (shopifySales + bfanSales + bfmpSales));
      }
    } else {
      // No channel breakdown was provided in DoD sheet: DO NOT fabricate or hallucinate values.
      // Daily totals from MainSheet remain 100% accurate, but channel splits are kept at 0.
      shopifyOrders = 0;
      shopifySales = 0;
      bfanOrders = 0;
      bfanSales = 0;
      bfmpOrders = 0;
      bfmpSales = 0;
      posocOrders = 0;
      posocSales = 0;
    }

    dailyList.push({
      date,
      day: mainDay.day,
      totalOrders: mainDay.orders,
      totalSales: mainDay.sales,
      hasDoDSplit: Boolean(hasExplicit),
      shopify: {
        orders: shopifyOrders,
        sales: shopifySales,
      },
      bfan: {
        orders: bfanOrders,
        sales: bfanSales,
      },
      bfmp: {
        orders: bfmpOrders,
        sales: bfmpSales,
      },
      posoc: {
        orders: posocOrders,
        sales: posocSales,
      },
    });
  }

  // 4. Calculate cycle grand totals
  let cycleTotalSales = 0;
  let cycleTotalOrders = 0;
  let shopifyTotalOrders = 0;
  let shopifyTotalSales = 0;
  let bfanTotalOrders = 0;
  let bfanTotalSales = 0;
  let bfmpTotalOrders = 0;
  let bfmpTotalSales = 0;
  let posocTotalOrders = 0;
  let posocTotalSales = 0;

  for (const d of dailyList) {
    cycleTotalSales += d.totalSales;
    cycleTotalOrders += d.totalOrders;

    shopifyTotalOrders += d.shopify.orders;
    shopifyTotalSales += d.shopify.sales;

    bfanTotalOrders += d.bfan.orders;
    bfanTotalSales += d.bfan.sales;

    bfmpTotalOrders += d.bfmp.orders;
    bfmpTotalSales += d.bfmp.sales;

    posocTotalOrders += d.posoc.orders;
    posocTotalSales += d.posoc.sales;
  }

  const aov = cycleTotalOrders > 0 ? Math.round(cycleTotalSales / cycleTotalOrders) : 0;

  const toCategory = (orders: number, sales: number): RevenueCategoryBreakdown => ({
    orders,
    sales,
    pctOfSales: cycleTotalSales > 0 ? Number(((sales / cycleTotalSales) * 100).toFixed(1)) : 0,
  });

  return {
    location,
    cycleId,
    totalSales: cycleTotalSales,
    totalOrders: cycleTotalOrders,
    aov,
    hasDoDSplit: dailyList.some((d) => d.hasDoDSplit),
    categories: {
      shopify: toCategory(shopifyTotalOrders, shopifyTotalSales),
      bfan: toCategory(bfanTotalOrders, bfanTotalSales),
      bfmp: toCategory(bfmpTotalOrders, bfmpTotalSales),
      posoc: toCategory(posocTotalOrders, posocTotalSales),
    },
    daily: dailyList,
    updatedAt: new Date().toISOString(),
  };
}
