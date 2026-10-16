const express = require('express');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');
const { replanLines, replanText } = require('../lib/replan');
const { getDefaultWorkingHour } = require('../lib/capacity');

const router = express.Router();
router.use(requireAuth);

const pad2 = (n) => String(n).padStart(2, '0');

// GET /api/line-daily?unit=340&month=9&year=2026 - monthwise matrix (Working Hour + Manpower) per line/day
router.get('/', async (req, res) => {
  const { unit, month, year } = req.query;
  if (!unit || !month || !year) {
    return res.status(400).json({ message: 'unit, month and year are required' });
  }

  const daysInMonth = new Date(Number(year), Number(month), 0).getDate();
  const monthStr = pad2(month);

  let conn;
  try {
    conn = await getConnection();

    const setupResult = await conn.execute(
      `SELECT NO_OF_LINE FROM XX_OM_LINE_H_T
        WHERE UNIT = :unit
        ORDER BY EFF_START_DATE DESC
        FETCH FIRST 1 ROW ONLY`,
      { unit }
    );
    const noOfLine = setupResult.rows.length ? Number(setupResult.rows[0].NO_OF_LINE) : 0;
    const lineNumbers = Array.from({ length: noOfLine }, (_, i) => i + 1);

    const overridesResult = await conn.execute(
      `SELECT LINE_NO, TO_CHAR(CALENDAR_DATE,'YYYY-MM-DD') AS D, WORKING_HOUR, MANPOWER
         FROM XX_OM_LINE_DAILY_T
        WHERE UNIT = :unit
          AND CALENDAR_DATE >= TO_DATE(:year || '-' || :month || '-01','YYYY-MM-DD')
          AND CALENDAR_DATE < ADD_MONTHS(TO_DATE(:year || '-' || :month || '-01','YYYY-MM-DD'), 1)`,
      { unit, year, month: monthStr }
    );

    const rangesResult = await conn.execute(
      `SELECT LINE_CAPACITY_ID, LINE_NO, WORKING_HOUR, MANPOWER,
              TO_CHAR(START_DATE,'YYYY-MM-DD') AS START_DATE,
              TO_CHAR(NVL(END_DATE, DATE '9999-12-31'),'YYYY-MM-DD') AS END_DATE
         FROM XX_OM_LINE_CAPACITY_T
        WHERE UNIT = :unit`,
      { unit }
    );

    // the unit's Holiday Plan for this month: same calendar as Holiday Planning and the planning board
    const holidaysResult = await conn.execute(
      `SELECT TO_CHAR(l.CALENDAR_DATE,'YYYY-MM-DD') AS D, l.WORKING_STATUS,
              NVL(l.HOLIDAY_DESCRIPTION, t.TYPE_NAME) AS NAME
         FROM XX_OM_HOLIDAY_L_T l
         JOIN XX_OM_HOLIDAY_H_T h ON h.HOLIDAY_PLAN_ID = l.HOLIDAY_PLAN_ID
         LEFT JOIN XX_OM_HOLIDAY_TYPE_T t ON t.TYPE_CODE = l.HOLIDAY_TYPE
        WHERE UPPER(h.OPERATION_UNIT) = UPPER(:unit) AND h.PLAN_YEAR = :year AND h.PLAN_MONTH = :month`,
      { unit: String(unit), year: Number(year), month: Number(month) }
    );
    const calendarDefined = holidaysResult.rows.length > 0;
    const holidayMap = {};
    holidaysResult.rows.forEach((r) => { if (r.WORKING_STATUS === 'Holiday') holidayMap[r.D] = r.NAME || 'Holiday'; });
    const calendar = Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${year}-${monthStr}-${pad2(i + 1)}`;
      return { day: i + 1, date, isHoliday: Boolean(holidayMap[date]), holidayName: holidayMap[date] || null };
    });

    const defaultWorkingHour = await getDefaultWorkingHour(conn, unit);

    const overrideMap = {}; // lineNo -> { 'YYYY-MM-DD': {workingHour, manpower} }
    overridesResult.rows.forEach((r) => {
      overrideMap[r.LINE_NO] = overrideMap[r.LINE_NO] || {};
      overrideMap[r.LINE_NO][r.D] = { workingHour: r.WORKING_HOUR, manpower: r.MANPOWER };
    });

    const rangesByLine = {}; // lineNo -> [{startDate, endDate, workingHour, manpower}]
    rangesResult.rows.forEach((r) => {
      rangesByLine[r.LINE_NO] = rangesByLine[r.LINE_NO] || [];
      rangesByLine[r.LINE_NO].push({
        id: r.LINE_CAPACITY_ID,
        startDate: r.START_DATE,
        endDate: r.END_DATE,
        workingHour: r.WORKING_HOUR,
        manpower: r.MANPOWER,
      });
    });
    // overlapping ranges: the most recently entered one wins (same rule as planning, lib/capacity.js)
    Object.values(rangesByLine).forEach((ranges) => ranges.sort((a, b) => b.id - a.id));

    const lines = lineNumbers.map((lineNo) => {
      const days = [];
      for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${monthStr}-${pad2(d)}`;
        const override = overrideMap[lineNo]?.[dateStr];
        // same order as planning (lib/capacity.js): day value, then range, then the unit's default hour
        const match = (rangesByLine[lineNo] || []).find((r) => r.startDate <= dateStr && r.endDate >= dateStr);
        let workingHour = match ? match.workingHour : defaultWorkingHour;
        let manpower = match ? match.manpower : null;
        const isDefault = !match;
        const isOverride = Boolean(override);
        if (override) {
          if (override.workingHour != null) workingHour = override.workingHour;
          if (override.manpower != null) manpower = override.manpower;
        }

        days.push({
          day: d, date: dateStr, workingHour, manpower, isOverride,
          isDefault: isDefault && !(override && override.workingHour != null),
          isHoliday: Boolean(holidayMap[dateStr]),
        });
      }
      return { lineNo, days };
    });

    res.json({ daysInMonth, lines, calendar, calendarDefined, defaultWorkingHour });
  } catch (err) {
    console.error('Get line-daily error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/line-daily - upsert a single day cell for a line (creates an override)
router.put('/', async (req, res) => {
  const { unit, lineNo, calendarDate, workingHour, manpower } = req.body;
  if (!unit || !lineNo || !calendarDate) {
    return res.status(400).json({ message: 'unit, lineNo and calendarDate are required' });
  }

  if (workingHour != null && workingHour !== '' && (!Number.isFinite(Number(workingHour)) || Number(workingHour) < 0 || Number(workingHour) > 24)) {
    return res.status(400).json({ message: 'Working Hour must be between 0 and 24' });
  }

  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `MERGE INTO XX_OM_LINE_DAILY_T d
       USING (SELECT :unit AS UNIT, :lineNo AS LINE_NO, TO_DATE(:calendarDate,'YYYY-MM-DD') AS CALENDAR_DATE FROM DUAL) src
       ON (d.UNIT = src.UNIT AND d.LINE_NO = src.LINE_NO AND d.CALENDAR_DATE = src.CALENDAR_DATE)
       WHEN MATCHED THEN UPDATE SET
         WORKING_HOUR = :workingHour, MANPOWER = :manpower,
         LAST_UPDATED_BY = :userId, LAST_UPDATED_DATE = SYSDATE
       WHEN NOT MATCHED THEN INSERT
         (DAILY_ID, UNIT, LINE_NO, CALENDAR_DATE, WORKING_HOUR, MANPOWER, CREATED_BY, CREATION_DATE)
       VALUES
         (XX_OM_LINE_DAILY_S.NEXTVAL, :unit, :lineNo, TO_DATE(:calendarDate,'YYYY-MM-DD'), :workingHour, :manpower, :userId, SYSDATE)`,
      {
        unit,
        lineNo,
        calendarDate,
        workingHour: workingHour === '' ? null : workingHour ?? null,
        manpower: manpower === '' ? null : manpower ?? null,
        userId: req.user.id,
      },
      { autoCommit: false }
    );
    // a different working hour on this day changes the output of the strip running on it
    const replan = await replanLines(conn, unit, [lineNo], calendarDate, req.user.id);
    await conn.commit();
    res.json({ message: 'Updated', replan, replanMessage: replanText(replan) });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Update line-daily error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
