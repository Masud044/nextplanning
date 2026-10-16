// Working-day calendar of an operation unit, from its Holiday Plans (XX_OM_HOLIDAY_H_T / _L_T).
// Rules: quantity is allocated only on working days, and a date can only be planned once its month has a holiday plan.

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const monthLabel = (ym) => `${MONTHS[Number(ym.slice(5, 7)) - 1]} ${ym.slice(0, 4)}`;

const addDays = (dateStr, n) => {
  const d = new Date(`${dateStr}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

async function loadCalendar(conn, unit) {
  const u = String(unit);
  const plans = await conn.execute(
    `SELECT PLAN_YEAR || '-' || LPAD(PLAN_MONTH, 2, '0') AS YM FROM XX_OM_HOLIDAY_H_T WHERE UPPER(OPERATION_UNIT) = UPPER(:u)`,
    { u }
  );
  const hol = await conn.execute(
    `SELECT TO_CHAR(l.CALENDAR_DATE,'YYYY-MM-DD') AS D
       FROM XX_OM_HOLIDAY_L_T l JOIN XX_OM_HOLIDAY_H_T h ON h.HOLIDAY_PLAN_ID = l.HOLIDAY_PLAN_ID
      WHERE UPPER(h.OPERATION_UNIT) = UPPER(:u) AND l.WORKING_STATUS = 'Holiday'`,
    { u }
  );
  return { unit: u, months: new Set(plans.rows.map((r) => r.YM)), holidays: new Set(hol.rows.map((r) => r.D)) };
}

// months between start and end (inclusive) without a holiday plan
function missingMonths(cal, startStr, endStr) {
  const out = [];
  let ym = startStr.slice(0, 7);
  const last = (endStr || startStr).slice(0, 7);
  for (let guard = 0; ym <= last && guard < 240; guard += 1) {
    if (!cal.months.has(ym)) out.push(ym);
    const [y, m] = ym.split('-').map(Number);
    ym = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  }
  return out;
}

const calendarMessage = (cal, missing, unitText) =>
  `Working days are not defined for ${unitText || `unit ${cal.unit}`}: ${missing.map(monthLabel).join(', ')}. ` +
  'Create the Holiday Plan for that month first (Holiday Planning).';

// first working day on or after dateStr; null when it runs into a month without a plan
function nextWorkingDay(cal, dateStr) {
  let d = dateStr;
  for (let guard = 0; guard < 400; guard += 1) {
    if (!cal.months.has(d.slice(0, 7))) return null;
    if (!cal.holidays.has(d)) return d;
    d = addDays(d, 1);
  }
  return null;
}

// end date after `days` working days starting at startStr (start counted when it is a working day).
// Returns { end } or { missing: 'YYYY-MM' } when the run reaches a month without a plan.
function addWorkingDays(cal, startStr, days) {
  let d = startStr;
  let counted = 0;
  for (let guard = 0; guard < 3650; guard += 1) {
    if (!cal.months.has(d.slice(0, 7))) return { missing: d.slice(0, 7) };
    if (!cal.holidays.has(d)) counted += 1;
    if (counted >= days) return { end: d };
    d = addDays(d, 1);
  }
  return { end: d };
}

module.exports = { loadCalendar, missingMonths, calendarMessage, nextWorkingDay, addWorkingDays, monthLabel };
