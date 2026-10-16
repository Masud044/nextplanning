const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const dateOrNull = (v) => (v ? new Date(v) : null);
const addDays = (dateStr, days) => {
  const d = new Date(dateStr);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
};

const { loadCalendar, missingMonths, calendarMessage, nextWorkingDay, addWorkingDays } = require('../lib/calendar');

// "AMS (341)" for messages; falls back to the bare id
const unitText = async (conn, unit) => {
  try {
    const r = await conn.execute(`SELECT UNIT_CODE FROM XX_OM_PRODUCTION_UNIT_T WHERE UNIT_ID = :u`, { u: Number(unit) });
    return r.rows.length ? `${r.rows[0].UNIT_CODE} (${unit})` : `unit ${unit}`;
  } catch (e) {
    return `unit ${unit}`;
  }
};

// message when [start, end] touches a month without a holiday plan for the unit, else null
const calendarBlock = async (conn, unit, startDate, endDate) => {
  const cal = await loadCalendar(conn, unit);
  const missing = missingMonths(cal, startDate, endDate);
  return missing.length ? calendarMessage(cal, missing, await unitText(conn, unit)) : null;
};

const { loadCapacity, planStrip } = require('../lib/capacity');
const { replanLines, replanText } = require('../lib/replan');
const { loadBuildUps } = require('../lib/buildup');

// A line can only run one strip at a time — finds any OTHER strip on the same
// line whose date range overlaps the one being placed.
const findOverlap = async (conn, { unit, lineNo, startDate, endDate, excludeStripId }) => {
  if (!lineNo || !startDate) return null;
  const result = await conn.execute(
    `SELECT s.STRIP_ID, h.STYLE
       FROM XX_OM_PLANNING_STRIP_T s
       JOIN XX_OM_SEWING_ORDER_T so ON so.ORDER_SETUP_ID = s.ORDER_SETUP_ID
       JOIN XX_OM_POC_L_T l ON l.FOB_ID = so.FOB_ID
       JOIN XX_OM_POC_H_T h ON h.POC_ID = l.POC_ID
      WHERE s.UNIT = :unit AND s.LINE_NO = :lineNo
        AND s.STRIP_ID != :excludeStripId
        AND s.STRIP_START_DATE <= TO_DATE(:endDate,'YYYY-MM-DD')
        AND NVL(s.STRIP_END_DATE, s.STRIP_START_DATE) >= TO_DATE(:startDate,'YYYY-MM-DD')
        AND ROWNUM = 1`,
    { unit, lineNo, excludeStripId: excludeStripId ?? -1, startDate, endDate: endDate || startDate }
  );
  return result.rows.length ? result.rows[0] : null;
};

const computeDaysNeeded = (plannedQty, productivity, workingHour) => {
  if (!plannedQty || !productivity || !workingHour) return null;
  const dailyOutput = Number(productivity) * Number(workingHour);
  if (dailyOutput <= 0) return null;
  return Math.max(1, Math.ceil(Number(plannedQty) / dailyOutput));
};

const STRIP_QUERY = `
  SELECT s.STRIP_ID, s.ORDER_SETUP_ID, s.UNIT, s.LINE_NO, s.PLANNED_QTY,
         TO_CHAR(s.STRIP_START_DATE,'YYYY-MM-DD') AS STRIP_START_DATE,
         TO_CHAR(s.STRIP_END_DATE,'YYYY-MM-DD') AS STRIP_END_DATE,
         s.COLOR_OVERRIDE, s.IS_MANUAL,
         so.ORDER_QTY, so.PRODUCTIVITY, so.BPO_ID, bpo.BPO AS BPO_NUMBER,
         TO_CHAR(so.SHIP_DATE,'YYYY-MM-DD') AS SHIP_DATE,
         so.LEARNING_CURVE_FLAG, so.COMBINE_ID, so.ORDER_TYPE,
         TO_CHAR(so.SEWING_START_DATE,'YYYY-MM-DD') AS ORDER_START_DATE,
         CASE WHEN so.COMBINE_ID IS NULL THEN 1
              ELSE (SELECT COUNT(*) FROM XX_OM_SEWING_ORDER_T c WHERE c.COMBINE_ID = so.COMBINE_ID) END AS COMBINED_ORDERS,
         h.POC_ID, h.SEASON, h.STYLE, h.BRAND, h.ITEM_DESCRIPTION, l.COLOR, l.WASH_NAME, b.BUYER_NAME
    FROM XX_OM_PLANNING_STRIP_T s
    JOIN XX_OM_SEWING_ORDER_T so ON so.ORDER_SETUP_ID = s.ORDER_SETUP_ID
    JOIN XX_OM_POC_L_T l ON l.FOB_ID = so.FOB_ID
    JOIN XX_OM_POC_H_T h ON h.POC_ID = l.POC_ID
    LEFT JOIN XX_OM_BUYER_T b ON b.BUYER_ID = h.BUYER_ID
    LEFT JOIN XX_OM_BPO_INFO_T bpo ON bpo.BPO_ID = so.BPO_ID
   WHERE s.UNIT = :unit
   ORDER BY s.LINE_NO NULLS FIRST, s.STRIP_START_DATE`;

// GET /api/strips?unit=341
router.get('/', async (req, res) => {
  const { unit } = req.query;
  if (!unit) return res.status(400).json({ message: 'unit is required' });

  let conn;
  try {
    conn = await getConnection();
    const strips = await conn.execute(STRIP_QUERY, { unit });

    const freezes = await conn.execute(
      `SELECT TO_CHAR(FREEZE_START_DATE,'YYYY-MM-DD') AS S, TO_CHAR(FREEZE_END_DATE,'YYYY-MM-DD') AS E
         FROM XX_OM_FREEZE_PLAN_T WHERE UNIT = :unit`,
      { unit }
    );

    // per-day capacity (day value > range > default hour) and the holiday calendar, as used when strips are planned
    const cal = await loadCalendar(conn, unit);
    const cap = await loadCapacity(conn, unit);
    const bu = await loadBuildUps(conn, unit);

    const isFrozen = (start, end) => {
      if (!start) return false;
      const s = start;
      const e = end || start;
      return freezes.rows.some((f) => s <= f.E && e >= f.S);
    };

    const rows = strips.rows.map((r) => {
      const workingHour = r.LINE_NO && r.STRIP_START_DATE ? cap.workingHour(r.LINE_NO, r.STRIP_START_DATE) : cap.defaultWorkingHour;
      let daysNeeded = null;
      let avgDailyOutput = null;
      const curve = bu.curveFor(r);
      if (r.PRODUCTIVITY && r.PLANNED_QTY) {
        // a waiting strip is estimated on the unit's default hour (lineNo null has no ranges)
        const plan = r.STRIP_START_DATE
          ? planStrip(cal, cap, { lineNo: r.LINE_NO || null, start: r.STRIP_START_DATE, qty: r.PLANNED_QTY, productivity: r.PRODUCTIVITY, curve })
          : null;
        if (plan && plan.end) {
          daysNeeded = plan.days;
          avgDailyOutput = plan.avgDailyOutput;
        } else {
          // calendar not defined yet: rough estimate on the default hour
          daysNeeded = computeDaysNeeded(r.PLANNED_QTY, r.PRODUCTIVITY, workingHour);
          avgDailyOutput = Math.round(Number(r.PRODUCTIVITY) * workingHour);
        }
      }
      return {
        ...r,
        IS_FROZEN: isFrozen(r.STRIP_START_DATE, r.STRIP_END_DATE),
        WORKING_HOUR_USED: workingHour,
        DAYS_NEEDED: daysNeeded,
        AVG_DAILY_OUTPUT: avgDailyOutput,
        BUILD_UP_DAYS: curve.length,
        BUILD_UP: curve.join('/'),
      };
    });

    res.json(rows);
  } catch (err) {
    console.error('List strips error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/strips/populate - create strips for any unallocated balance qty on orders assigned to this unit
router.post('/populate', async (req, res) => {
  const { unit } = req.body;
  if (!unit) return res.status(400).json({ message: 'unit is required' });

  // Strips are prepared only from populated orders of this unit (Order Setup), from their setup data:
  //  - qty = order qty (buyer qty + extra %) not yet on a strip; combined orders (same COMBINE_ID) make ONE strip,
  //    attached to the lowest order id of the group;
  //  - start = the order's Sewing Start Date (later moves on the board never change the order);
  //  - length = productivity x the unit's default working hour per working day, including the build-up.
  // Orders without productivity or start date are skipped and reported.
  let conn;
  try {
    conn = await getConnection();
    const orders = (await conn.execute(
      `SELECT so.ORDER_SETUP_ID, so.COMBINE_ID, so.ORDER_QTY, so.PRODUCTIVITY, so.LEARNING_CURVE_FLAG,
              TO_CHAR(so.SEWING_START_DATE,'YYYY-MM-DD') AS SEWING_START_DATE,
              NVL((SELECT SUM(PLANNED_QTY) FROM XX_OM_PLANNING_STRIP_T st WHERE st.ORDER_SETUP_ID = so.ORDER_SETUP_ID), 0) AS ALLOCATED
         FROM XX_OM_SEWING_ORDER_T so
        WHERE so.UNIT = :unit
        ORDER BY so.ORDER_SETUP_ID`,
      { unit }
    )).rows;

    const groups = new Map();
    for (const o of orders) {
      const key = o.COMBINE_ID ? `c${o.COMBINE_ID}` : `o${o.ORDER_SETUP_ID}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(o);
    }

    const cal = await loadCalendar(conn, unit);
    const cap = await loadCapacity(conn, unit);
    const bu = await loadBuildUps(conn, unit);
    const out = { created: 0, combinedStrips: 0, skippedNoProductivity: 0, skippedNoStartDate: 0, alreadyOnBoard: 0 };

    for (const members of groups.values()) {
      const lead = members[0]; // lowest order id
      const balance = members.reduce((sum, m) => sum + (Number(m.ORDER_QTY) || 0) - Number(m.ALLOCATED), 0);
      if (balance <= 0) { out.alreadyOnBoard += 1; continue; }
      const start = members.map((m) => m.SEWING_START_DATE).filter(Boolean).sort()[0];
      if (!lead.PRODUCTIVITY) { out.skippedNoProductivity += 1; continue; }
      if (!start) { out.skippedNoStartDate += 1; continue; }

      const plan = planStrip(cal, cap, { lineNo: null, start, qty: balance, productivity: lead.PRODUCTIVITY, curve: bu.curveFor(lead) });
      let stripStart = start;
      let stripEnd;
      if (plan.end) {
        stripStart = plan.start;
        stripEnd = plan.end;
      } else {
        // calendar not defined for that month yet: calendar-day estimate; placing it on a line will ask for the holiday plan
        const days = computeDaysNeeded(balance, lead.PRODUCTIVITY, cap.defaultWorkingHour) || 1;
        const d = new Date(`${start}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days - 1);
        stripEnd = d.toISOString().slice(0, 10);
      }

      await conn.execute(
        `INSERT INTO XX_OM_PLANNING_STRIP_T
           (STRIP_ID, ORDER_SETUP_ID, UNIT, PLANNED_QTY, STRIP_START_DATE, STRIP_END_DATE, CREATED_BY, CREATION_DATE)
         VALUES
           (XX_OM_STRIP_S.NEXTVAL, :orderSetupId, :unit, :qty,
            TO_DATE(:startDate,'YYYY-MM-DD'), TO_DATE(:endDate,'YYYY-MM-DD'), :createdBy, SYSDATE)`,
        { orderSetupId: lead.ORDER_SETUP_ID, unit, qty: balance, startDate: stripStart, endDate: stripEnd, createdBy: req.user.id },
        { autoCommit: false }
      );
      out.created += 1;
      if (members.length > 1) out.combinedStrips += 1;
    }

    await conn.commit();
    res.json(out);
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Populate strips error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/strips - manually add a strip
router.post('/', async (req, res) => {
  const { orderSetupId, unit, plannedQty, lineNo, stripStartDate, stripEndDate } = req.body;
  if (!orderSetupId || !unit || !plannedQty) {
    return res.status(400).json({ message: 'orderSetupId, unit and plannedQty are required' });
  }

  let conn;
  try {
    conn = await getConnection();

    if (lineNo && stripStartDate) {
      const blocked = await calendarBlock(conn, unit, stripStartDate, stripEndDate || stripStartDate);
      if (blocked) return res.status(409).json({ message: blocked });
    }

    const overlap = await findOverlap(conn, {
      unit, lineNo, startDate: stripStartDate, endDate: stripEndDate, excludeStripId: -1,
    });
    if (overlap) {
      return res.status(409).json({ message: `Line already has a strip (${overlap.STYLE}) in that date range` });
    }

    const result = await conn.execute(
      `INSERT INTO XX_OM_PLANNING_STRIP_T
         (STRIP_ID, ORDER_SETUP_ID, UNIT, LINE_NO, PLANNED_QTY, STRIP_START_DATE, STRIP_END_DATE, IS_MANUAL, CREATED_BY, CREATION_DATE)
       VALUES
         (XX_OM_STRIP_S.NEXTVAL, :orderSetupId, :unit, :lineNo, :plannedQty,
          TO_DATE(:stripStartDate,'YYYY-MM-DD'), TO_DATE(:stripEndDate,'YYYY-MM-DD'), 'Y', :createdBy, SYSDATE)
       RETURNING STRIP_ID INTO :outId`,
      {
        orderSetupId, unit, lineNo: lineNo ?? null, plannedQty,
        stripStartDate: stripStartDate || null, stripEndDate: stripEndDate || null,
        createdBy: req.user.id,
        outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
      { autoCommit: true }
    );
    res.status(201).json({ id: result.outBinds.outId[0] });
  } catch (err) {
    console.error('Add strip error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/strips/:id - move/resize/edit a strip (drag-and-drop lands here)
router.put('/:id', async (req, res) => {
  const { lineNo, plannedQty, colorOverride } = req.body;
  let { stripStartDate, stripEndDate } = req.body;

  let conn;
  try {
    conn = await getConnection();

    if (lineNo) {
      const unitResult = await conn.execute(
        `SELECT UNIT FROM XX_OM_PLANNING_STRIP_T WHERE STRIP_ID = :id`,
        { id: req.params.id }
      );
      if (unitResult.rows.length === 0) return res.status(404).json({ message: 'Strip not found' });

      // working days must be defined for every month the strip covers, and it cannot start on a holiday
      if (stripStartDate) {
        const blocked = await calendarBlock(conn, unitResult.rows[0].UNIT, stripStartDate, stripEndDate || stripStartDate);
        if (blocked) return res.status(409).json({ message: blocked });
        const cal = await loadCalendar(conn, unitResult.rows[0].UNIT);
        const firstWorking = nextWorkingDay(cal, stripStartDate);
        if (!firstWorking) {
          // the rest of the start month is holidays and the next month has no plan yet
          const [y, m] = stripStartDate.slice(0, 7).split('-').map(Number);
          const nextYm = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
          return res.status(409).json({ message: calendarMessage(cal, [nextYm], await unitText(conn, unitResult.rows[0].UNIT)) });
        }
        if (firstWorking !== stripStartDate) {
          stripStartDate = firstWorking;
          if (!stripEndDate || stripEndDate < stripStartDate) stripEndDate = stripStartDate;
        }
      }

      const overlap = await findOverlap(conn, {
        unit: unitResult.rows[0].UNIT, lineNo, startDate: stripStartDate, endDate: stripEndDate,
        excludeStripId: req.params.id,
      });
      if (overlap) {
        return res.status(409).json({ message: `Line already has a strip (${overlap.STYLE}) in that date range` });
      }
    }

    await conn.execute(
      `UPDATE XX_OM_PLANNING_STRIP_T SET
         LINE_NO = :lineNo, PLANNED_QTY = :plannedQty,
         STRIP_START_DATE = TO_DATE(:stripStartDate,'YYYY-MM-DD'),
         STRIP_END_DATE = TO_DATE(:stripEndDate,'YYYY-MM-DD'),
         COLOR_OVERRIDE = :colorOverride,
         LAST_UPDATED_BY = :updatedBy, LAST_UPDATED_DATE = SYSDATE
       WHERE STRIP_ID = :id`,
      {
        lineNo: lineNo ?? null,
        plannedQty,
        stripStartDate: stripStartDate || null,
        stripEndDate: stripEndDate || null,
        colorOverride: colorOverride || null,
        updatedBy: req.user.id,
        id: req.params.id,
      },
      { autoCommit: true }
    );
    res.json({ message: 'Updated', stripStartDate, stripEndDate });
  } catch (err) {
    console.error('Update strip error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/strips/:id/recompute - recalc end date from planned qty, productivity and the line's working hour
router.post('/:id/recompute', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const stripResult = await conn.execute(
      `SELECT s.PLANNED_QTY, s.LINE_NO, s.UNIT,
              TO_CHAR(s.STRIP_START_DATE,'YYYY-MM-DD') AS STRIP_START_DATE, so.PRODUCTIVITY,
              so.ORDER_SETUP_ID, so.LEARNING_CURVE_FLAG
         FROM XX_OM_PLANNING_STRIP_T s
         JOIN XX_OM_SEWING_ORDER_T so ON so.ORDER_SETUP_ID = s.ORDER_SETUP_ID
        WHERE s.STRIP_ID = :id`,
      { id: req.params.id }
    );
    if (stripResult.rows.length === 0) return res.status(404).json({ message: 'Strip not found' });

    const strip = stripResult.rows[0];
    if (!strip.LINE_NO || !strip.STRIP_START_DATE || !strip.PRODUCTIVITY) {
      return res.status(400).json({ message: 'Strip needs a Line, Start Date and the order needs Productivity set to recompute' });
    }

    // Quantity is allocated day by day on working days only: output of a day = productivity x that day's working hour
    // (day value > range > default hour). It starts on the first working day, and every month it touches
    // must have a holiday plan (working days defined).
    const cal = await loadCalendar(conn, strip.UNIT);
    const cap = await loadCapacity(conn, strip.UNIT);
    const bu = await loadBuildUps(conn, strip.UNIT);
    const plan = planStrip(cal, cap, {
      lineNo: strip.LINE_NO, start: strip.STRIP_START_DATE, qty: strip.PLANNED_QTY, productivity: strip.PRODUCTIVITY, curve: bu.curveFor(strip),
    });
    if (plan.missing) {
      return res.status(409).json({ message: calendarMessage(cal, [plan.missing], await unitText(conn, strip.UNIT)) });
    }
    if (plan.error) return res.status(409).json({ message: plan.error });

    await conn.execute(
      `UPDATE XX_OM_PLANNING_STRIP_T
          SET STRIP_START_DATE = TO_DATE(:startDate,'YYYY-MM-DD'), STRIP_END_DATE = TO_DATE(:endDate,'YYYY-MM-DD')
        WHERE STRIP_ID = :id`,
      { startDate: plan.start, endDate: plan.end, id: req.params.id },
      { autoCommit: false }
    );
    // a longer strip pushes the strips after it on the same line
    const replan = await replanLines(conn, strip.UNIT, [strip.LINE_NO], plan.end, req.user.id);
    await conn.commit();

    res.json({
      stripStartDate: plan.start, stripEndDate: plan.end, days: plan.days,
      workingHour: cap.workingHour(strip.LINE_NO, plan.start), avgDailyOutput: plan.avgDailyOutput,
      replan, replanMessage: replan.pushed ? replanText(replan) : '',
    });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Recompute strip error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/strips/:id
router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `DELETE FROM XX_OM_PLANNING_STRIP_T WHERE STRIP_ID = :id`,
      { id: req.params.id },
      { autoCommit: true }
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete strip error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
