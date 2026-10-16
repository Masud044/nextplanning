// Line capacity per day and the strip length that follows from it.
// Working hour of (line, date), first match wins:
//   1. day value from Line Master > Monthwise   (XX_OM_LINE_DAILY_T)
//   2. working-hour range covering the date     (XX_OM_LINE_CAPACITY_T; the most recently entered range wins)
//   3. the unit's Default Working Hour          (XX_OM_PLANNING_SETTING_T, unit row or unit 0)
// Output of a day = productivity (pcs/hour) x working hour; holidays produce nothing.
const { nextWorkingDay } = require('./calendar');

const FALLBACK_WORKING_HOUR = 8;

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function getDefaultWorkingHour(conn, unit) {
  try {
    const r = await conn.execute(
      `SELECT SETTING_VALUE FROM XX_OM_PLANNING_SETTING_T
        WHERE SETTING_KEY = 'DEFAULT_WORKING_HOUR' AND UNIT_ID IN (0, :u)
        ORDER BY UNIT_ID DESC FETCH FIRST 1 ROW ONLY`,
      { u: Number(unit) }
    );
    const v = r.rows.length ? Number(r.rows[0].SETTING_VALUE) : NaN;
    return Number.isFinite(v) && v >= 0 ? v : FALLBACK_WORKING_HOUR;
  } catch (e) {
    return FALLBACK_WORKING_HOUR; // settings table not created yet
  }
}

async function loadCapacity(conn, unit) {
  const defaultWorkingHour = await getDefaultWorkingHour(conn, unit);
  // Overlapping ranges: the most recently entered one wins (an "Update line" for a period overrides what was there).
  const ranges = await conn.execute(
    `SELECT LINE_CAPACITY_ID, LINE_NO, WORKING_HOUR, MANPOWER,
            TO_CHAR(START_DATE,'YYYY-MM-DD') AS S, TO_CHAR(END_DATE,'YYYY-MM-DD') AS E
       FROM XX_OM_LINE_CAPACITY_T WHERE UNIT = :u
      ORDER BY LINE_CAPACITY_ID DESC`,
    { u: Number(unit) }
  );
  const daily = await conn.execute(
    `SELECT LINE_NO, TO_CHAR(CALENDAR_DATE,'YYYY-MM-DD') AS D, WORKING_HOUR
       FROM XX_OM_LINE_DAILY_T WHERE UNIT = :u AND WORKING_HOUR IS NOT NULL`,
    { u: Number(unit) }
  );
  const rangesByLine = {};
  ranges.rows.forEach((r) => { (rangesByLine[r.LINE_NO] ||= []).push(r); });
  const dailyMap = {};
  daily.rows.forEach((r) => { dailyMap[`${r.LINE_NO}|${r.D}`] = Number(r.WORKING_HOUR); });

  const workingHour = (lineNo, dateStr) => {
    const d = dailyMap[`${lineNo}|${dateStr}`];
    if (d !== undefined) return d;
    const r = (rangesByLine[lineNo] || []).find((x) => x.S <= dateStr && (!x.E || x.E >= dateStr));
    return r ? Number(r.WORKING_HOUR) : defaultWorkingHour;
  };
  return { unit: String(unit), defaultWorkingHour, workingHour };
}

/**
 * Plan `qty` pieces on a line from `start`: day by day, working days only, output = productivity x working hour of that day.
 * `curve` (optional) = hourly productivity for the first production days (build-up / learning curve); full productivity after it.
 * Returns { start, end, days, avgDailyOutput, buildUpDays } or { missing: 'YYYY-MM' } when it runs into a month without a
 * holiday plan, or { error } when the line never produces (e.g. working hour 0 everywhere).
 */
function planStrip(cal, cap, { lineNo, start, qty, productivity, curve = [] }) {
  const first = nextWorkingDay(cal, start);
  if (!first) return { missing: start.slice(0, 7) };
  let d = first;
  let made = 0;
  let days = 0;
  let idle = 0;
  for (let guard = 0; guard < 3650; guard += 1) {
    if (!cal.months.has(d.slice(0, 7))) return { missing: d.slice(0, 7) };
    if (!cal.holidays.has(d)) {
      const wh = cap.workingHour(lineNo, d);
      // build-up day N (N = production days so far + 1) uses the curve's hourly productivity
      const perHour = days < curve.length ? Number(curve[days]) : Number(productivity);
      const out = perHour * wh;
      if (wh > 0 && perHour > 0) { made += out; days += 1; idle = 0; } else { idle += 1; }
      if (made >= Number(qty)) {
        return { start: first, end: d, days, avgDailyOutput: Math.round(made / days), buildUpDays: Math.min(curve.length, days) };
      }
      if (idle > 366) return { error: `Line ${lineNo} has no working hours from ${first}` };
    }
    d = addDays(d, 1);
  }
  return { error: 'Strip longer than 10 years' };
}

module.exports = { loadCapacity, planStrip, getDefaultWorkingHour, addDays, FALLBACK_WORKING_HOUR };
