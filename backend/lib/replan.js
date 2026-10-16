// Re-plan the strips of some lines after their capacity changed (working hour range, day value, default hour).
// For each line, strips that end on or after `fromDate` are recalculated in start order:
//  - the strip length follows the new working hours (longer / shorter);
//  - when a strip would now overlap the one before it, it is pushed to the next working day after it;
//  - frozen strips (inside a freeze window) and strips of orders without productivity keep their dates;
//  - a strip that would run into a month without a holiday plan keeps its dates and is reported.
// Runs inside the caller's transaction (no commit here).
const { loadCalendar, nextWorkingDay, monthLabel } = require('./calendar');
const { loadCapacity, planStrip, addDays } = require('./capacity');
const { loadBuildUps } = require('./buildup');

const spanDays = (a, b) => Math.round((new Date(`${b}T00:00:00Z`) - new Date(`${a}T00:00:00Z`)) / 86400000);

async function replanLines(conn, unit, lineNos, fromDate, userId) {
  const summary = { checked: 0, updated: 0, longer: 0, shorter: 0, pushed: 0, unchanged: 0, frozen: 0, noProductivity: 0, notDefined: [], conflicts: [] };
  const lines = [...new Set((lineNos || []).map(Number).filter(Boolean))];
  if (!lines.length) return summary;

  const cal = await loadCalendar(conn, unit);
  const cap = await loadCapacity(conn, unit);
  const bu = await loadBuildUps(conn, unit);
  const freezes = (await conn.execute(
    `SELECT TO_CHAR(FREEZE_START_DATE,'YYYY-MM-DD') AS S, TO_CHAR(FREEZE_END_DATE,'YYYY-MM-DD') AS E FROM XX_OM_FREEZE_PLAN_T WHERE UNIT = :u`,
    { u: Number(unit) }
  )).rows;
  const isFrozen = (s, e) => freezes.some((f) => s <= f.E && (e || s) >= f.S);

  for (const lineNo of lines) {
    const strips = (await conn.execute(
      `SELECT s.STRIP_ID, s.PLANNED_QTY, TO_CHAR(s.STRIP_START_DATE,'YYYY-MM-DD') AS S, TO_CHAR(s.STRIP_END_DATE,'YYYY-MM-DD') AS E,
              so.PRODUCTIVITY, so.ORDER_SETUP_ID, so.LEARNING_CURVE_FLAG, h.STYLE
         FROM XX_OM_PLANNING_STRIP_T s
         JOIN XX_OM_SEWING_ORDER_T so ON so.ORDER_SETUP_ID = s.ORDER_SETUP_ID
         LEFT JOIN XX_OM_POC_L_T l ON l.FOB_ID = so.FOB_ID
         LEFT JOIN XX_OM_POC_H_T h ON h.POC_ID = l.POC_ID
        WHERE s.UNIT = :u AND s.LINE_NO = :line AND s.STRIP_START_DATE IS NOT NULL
        ORDER BY s.STRIP_START_DATE, s.STRIP_ID`,
      { u: Number(unit), line: lineNo }
    )).rows;

    let prevEnd = null; // end of the previous strip on this line, after re-planning
    for (const s of strips) {
      const origEnd = s.E || s.S;
      if (origEnd < fromDate) { prevEnd = prevEnd && prevEnd > origEnd ? prevEnd : origEnd; continue; } // before the change: untouched
      summary.checked += 1;

      if (isFrozen(s.S, origEnd)) {
        summary.frozen += 1;
        if (prevEnd && s.S <= prevEnd) summary.conflicts.push(`Line ${lineNo}: frozen ${s.STYLE || `strip ${s.STRIP_ID}`} (${s.S}) overlaps the strip before it`);
        prevEnd = prevEnd && prevEnd > origEnd ? prevEnd : origEnd;
        continue;
      }

      // pushed when the previous strip now ends on/after this one's start
      let start = s.S;
      if (prevEnd && start <= prevEnd) start = nextWorkingDay(cal, addDays(prevEnd, 1)) || addDays(prevEnd, 1);

      let end;
      if (!s.PRODUCTIVITY) {
        summary.noProductivity += 1;
        end = addDays(start, spanDays(s.S, origEnd)); // keep its calendar length
      } else {
        const plan = planStrip(cal, cap, { lineNo, start, qty: s.PLANNED_QTY, productivity: s.PRODUCTIVITY, curve: bu.curveFor(s) });
        if (plan.missing || plan.error) {
          if (plan.missing && !summary.notDefined.includes(monthLabel(plan.missing))) summary.notDefined.push(monthLabel(plan.missing));
          if (plan.error) summary.conflicts.push(`Line ${lineNo}: ${s.STYLE || `strip ${s.STRIP_ID}`}: ${plan.error}`);
          prevEnd = prevEnd && prevEnd > origEnd ? prevEnd : origEnd;
          continue;
        }
        start = plan.start;
        end = plan.end;
      }

      if (start === s.S && end === origEnd) {
        summary.unchanged += 1;
      } else {
        summary.updated += 1;
        if (start !== s.S) summary.pushed += 1;
        const oldLen = spanDays(s.S, origEnd);
        const newLen = spanDays(start, end);
        if (newLen > oldLen) summary.longer += 1;
        else if (newLen < oldLen) summary.shorter += 1;
        await conn.execute(
          `UPDATE XX_OM_PLANNING_STRIP_T
              SET STRIP_START_DATE = TO_DATE(:s,'YYYY-MM-DD'), STRIP_END_DATE = TO_DATE(:e,'YYYY-MM-DD'),
                  LAST_UPDATED_BY = :userId, LAST_UPDATED_DATE = SYSDATE
            WHERE STRIP_ID = :id`,
          { s: start, e: end, userId: userId ?? null, id: s.STRIP_ID },
          { autoCommit: false }
        );
      }
      prevEnd = end;
    }
  }
  return summary;
}

// "12 strips re-planned: 3 longer, 2 shorter, 1 pushed later" for messages
function replanText(r) {
  if (!r || !r.checked) return 'No planned strips affected.';
  const changed = r.updated;
  const parts = [];
  if (r.longer) parts.push(`${r.longer} longer`);
  if (r.shorter) parts.push(`${r.shorter} shorter`);
  if (r.pushed) parts.push(`${r.pushed} pushed later`);
  let text = changed > 0 ? `${changed} strip(s) re-planned${parts.length ? `: ${parts.join(', ')}` : ''}.` : 'Planning board already matches.';
  if (r.frozen) text += ` ${r.frozen} frozen strip(s) kept.`;
  if (r.noProductivity) text += ` ${r.noProductivity} without order productivity kept their length.`;
  if (r.notDefined.length) text += ` Not re-planned past: ${r.notDefined.join(', ')} (no holiday plan).`;
  if (r.conflicts.length) text += ` Check: ${r.conflicts.join('; ')}.`;
  return text;
}

module.exports = { replanLines, replanText };
