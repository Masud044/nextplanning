const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();
router.use(requireAuth);

// Holiday plans are maintained by planners; everyone else sees them read-only.
const canEdit = requireRole('ADMIN', 'PLANNER');

const computeTotals = (lines) => {
  const totalDays = lines.length;
  const holidaysCount = lines.filter((l) => l.workingStatus === 'Holiday').length;
  return { totalDays, workingDays: totalDays - holidaysCount, holidaysCount };
};

// Guards against saving a header (Month/Year) whose day grid doesn't actually belong to it —
// exactly how one plan ended up labeled one month but full of another month's dates.
const linesMatchHeaderMonth = (planMonth, planYear, lines) => {
  const prefix = `${planYear}-${String(planMonth).padStart(2, '0')}`;
  return lines.every((l) => typeof l.calendarDate === 'string' && l.calendarDate.startsWith(prefix));
};

const loadTypes = async (conn) => {
  const r = await conn.execute(`SELECT TYPE_CODE, TYPE_NAME, IS_WORKING, ACTIVE FROM XX_OM_HOLIDAY_TYPE_T`);
  return Object.fromEntries(r.rows.map((t) => [t.TYPE_CODE, t]));
};

// Each day carries a holiday type (Working Day, Weekly Holiday, Festival Holiday, ...).
// WORKING_STATUS ('Workingday' / 'Holiday') is derived from the type, so planning keeps reading it as before.
// Older clients that only send workingStatus are mapped to WORKING / GENERAL.
const normaliseLines = (lines, types) => {
  const out = [];
  for (const l of lines) {
    let code = l.holidayType || (l.workingStatus === 'Holiday' ? 'GENERAL' : 'WORKING');
    const t = types[code];
    if (!t) return { error: `Unknown holiday type "${code}" on ${l.calendarDate}.` };
    out.push({
      calendarDate: l.calendarDate,
      dayName: l.dayName,
      holidayType: code,
      workingStatus: t.IS_WORKING === 'Y' ? 'Workingday' : 'Holiday',
      description: (l.description || '').trim() || (t.IS_WORKING === 'Y' ? null : t.TYPE_NAME),
    });
  }
  return { lines: out };
};

const insertLines = async (conn, planId, lines) => {
  await conn.executeMany(
    `INSERT INTO XX_OM_HOLIDAY_L_T
       (HOLIDAY_DETAIL_ID, HOLIDAY_PLAN_ID, CALENDAR_DATE, DAY_NAME, WORKING_STATUS, HOLIDAY_TYPE, HOLIDAY_DESCRIPTION)
     VALUES
       (XX_OM_HOLIDAY_L_S.NEXTVAL, :planId, TO_DATE(:calendarDate,'YYYY-MM-DD'), :dayName, :workingStatus, :holidayType, :description)`,
    lines.map((l) => ({
      planId,
      calendarDate: l.calendarDate,
      dayName: l.dayName,
      workingStatus: l.workingStatus,
      holidayType: l.holidayType,
      description: l.description,
    })),
    {
      autoCommit: false,
      bindDefs: {
        planId: { type: oracledb.NUMBER },
        calendarDate: { type: oracledb.STRING, maxSize: 10 },
        dayName: { type: oracledb.STRING, maxSize: 20 },
        workingStatus: { type: oracledb.STRING, maxSize: 20 },
        holidayType: { type: oracledb.STRING, maxSize: 30 },
        description: { type: oracledb.STRING, maxSize: 400 },
      },
    }
  );
};

// ---------- holiday types (the Working Status LOV) ----------

// GET /api/holiday/types            active types
// GET /api/holiday/types?all=1      all types, for maintenance
router.get('/types', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT TYPE_CODE, TYPE_NAME, IS_WORKING, POLICY_NOTE, SORT_ORDER, ACTIVE
         FROM XX_OM_HOLIDAY_TYPE_T
        ${req.query.all ? '' : "WHERE ACTIVE = 'Y'"}
        ORDER BY CASE IS_WORKING WHEN 'Y' THEN 0 ELSE 1 END, NVL(SORT_ORDER, 9999), TYPE_NAME`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List holiday types error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/holiday/types
router.post('/types', requireRole('ADMIN'), async (req, res) => {
  const { typeCode, typeName, isWorking, policyNote, sortOrder } = req.body;
  const code = String(typeCode || '').trim().toUpperCase().replace(/\s+/g, '_');
  if (!code || !String(typeName || '').trim()) return res.status(400).json({ message: 'Type code and name are required' });
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `INSERT INTO XX_OM_HOLIDAY_TYPE_T (TYPE_CODE, TYPE_NAME, IS_WORKING, POLICY_NOTE, SORT_ORDER, ACTIVE, CREATED_BY, CREATION_DATE)
       VALUES (:code, :name, :isWorking, :note, :sortOrder, 'Y', :userId, SYSDATE)`,
      {
        code,
        name: String(typeName).trim(),
        isWorking: isWorking === true || isWorking === 'Y' ? 'Y' : 'N',
        note: policyNote || null,
        sortOrder: sortOrder === '' || sortOrder == null ? null : Number(sortOrder),
        userId: req.user.id,
      },
      { autoCommit: true }
    );
    res.status(201).json({ typeCode: code });
  } catch (err) {
    if (err.errorNum === 1) return res.status(409).json({ message: 'That type code or name already exists' });
    console.error('Create holiday type error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/holiday/types/:code   (the code and the working/holiday nature are fixed once used in a calendar)
router.put('/types/:code', requireRole('ADMIN'), async (req, res) => {
  const { typeName, policyNote, sortOrder, active } = req.body;
  if (!String(typeName || '').trim()) return res.status(400).json({ message: 'Type name is required' });
  if (req.params.code === 'WORKING' && active === 'N') return res.status(400).json({ message: 'Working Day cannot be deactivated' });
  let conn;
  try {
    conn = await getConnection();
    const r = await conn.execute(
      `UPDATE XX_OM_HOLIDAY_TYPE_T
          SET TYPE_NAME = :name, POLICY_NOTE = :note, SORT_ORDER = :sortOrder, ACTIVE = :active,
              LAST_UPDATED_BY = :userId, LAST_UPDATED_DATE = SYSDATE
        WHERE TYPE_CODE = :code`,
      {
        name: String(typeName).trim(),
        note: policyNote || null,
        sortOrder: sortOrder === '' || sortOrder == null ? null : Number(sortOrder),
        active: active === 'N' ? 'N' : 'Y',
        userId: req.user.id,
        code: req.params.code,
      },
      { autoCommit: true }
    );
    if (!r.rowsAffected) return res.status(404).json({ message: 'Type not found' });
    res.json({ message: 'Updated' });
  } catch (err) {
    if (err.errorNum === 1) return res.status(409).json({ message: 'That type name already exists' });
    console.error('Update holiday type error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// ---------- calendar days used by the planning screens ----------

// GET /api/holiday/days?operationUnit=341 - flat list of Holiday-status calendar dates for a unit (any plan/month)
router.get('/days', async (req, res) => {
  const { operationUnit } = req.query;
  if (!operationUnit) return res.status(400).json({ message: 'operationUnit is required' });

  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT TO_CHAR(l.CALENDAR_DATE,'YYYY-MM-DD') AS CALENDAR_DATE, l.HOLIDAY_DESCRIPTION,
              l.HOLIDAY_TYPE, t.TYPE_NAME
         FROM XX_OM_HOLIDAY_L_T l
         JOIN XX_OM_HOLIDAY_H_T h ON h.HOLIDAY_PLAN_ID = l.HOLIDAY_PLAN_ID
         LEFT JOIN XX_OM_HOLIDAY_TYPE_T t ON t.TYPE_CODE = l.HOLIDAY_TYPE
        WHERE UPPER(h.OPERATION_UNIT) = UPPER(:operationUnit)
          AND l.WORKING_STATUS = 'Holiday'
        ORDER BY l.CALENDAR_DATE`,
      { operationUnit }
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List holiday days error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// GET /api/holiday/months?operationUnit=341 - months that have a holiday plan (working days defined)
router.get('/months', async (req, res) => {
  const { operationUnit } = req.query;
  if (!operationUnit) return res.status(400).json({ message: 'operationUnit is required' });
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT PLAN_YEAR || '-' || LPAD(PLAN_MONTH, 2, '0') AS YM, WORKING_DAYS, HOLIDAYS_COUNT
         FROM XX_OM_HOLIDAY_H_T WHERE UPPER(OPERATION_UNIT) = UPPER(:operationUnit) ORDER BY 1`,
      { operationUnit }
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List holiday months error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// ---------- holiday plans ----------

// GET /api/holiday - search plans
router.get('/', async (req, res) => {
  const { operationUnit, month, year } = req.query;
  const conditions = [];
  const binds = {};

  if (operationUnit) {
    conditions.push('UPPER(OPERATION_UNIT) LIKE UPPER(:operationUnit)');
    binds.operationUnit = `%${operationUnit}%`;
  }
  if (month) {
    conditions.push('PLAN_MONTH = :month');
    binds.month = month;
  }
  if (year) {
    conditions.push('PLAN_YEAR = :year');
    binds.year = year;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT HOLIDAY_PLAN_ID, OPERATION_UNIT, PLAN_MONTH, PLAN_YEAR, WEEKLY_HOLIDAY_DAY,
              TOTAL_DAYS, WORKING_DAYS, HOLIDAYS_COUNT, STATUS, CREATION_DATE
         FROM XX_OM_HOLIDAY_H_T
         ${whereClause}
        ORDER BY PLAN_YEAR DESC, PLAN_MONTH DESC`,
      binds
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List holiday plans error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// GET /api/holiday/:id - header + day lines
router.get('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const header = await conn.execute(
      `SELECT * FROM XX_OM_HOLIDAY_H_T WHERE HOLIDAY_PLAN_ID = :id`,
      { id: req.params.id }
    );
    if (header.rows.length === 0) {
      return res.status(404).json({ message: 'Plan not found' });
    }
    const lines = await conn.execute(
      `SELECT HOLIDAY_DETAIL_ID, HOLIDAY_PLAN_ID,
              TO_CHAR(CALENDAR_DATE,'YYYY-MM-DD') AS CALENDAR_DATE,
              DAY_NAME, WORKING_STATUS, HOLIDAY_TYPE, HOLIDAY_DESCRIPTION
         FROM XX_OM_HOLIDAY_L_T WHERE HOLIDAY_PLAN_ID = :id ORDER BY CALENDAR_DATE`,
      { id: req.params.id }
    );
    res.json({ header: header.rows[0], lines: lines.rows });
  } catch (err) {
    console.error('Get holiday plan error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/holiday - create header + day lines
router.post('/', canEdit, async (req, res) => {
  const { header } = req.body;
  if (!header || !Array.isArray(req.body.lines) || req.body.lines.length === 0) {
    return res.status(400).json({ message: 'header and lines are required' });
  }
  if (!header.operationUnit) return res.status(400).json({ message: 'Operation Unit is required' });
  if (!linesMatchHeaderMonth(header.planMonth, header.planYear, req.body.lines)) {
    return res.status(400).json({
      message: 'Day grid does not match the selected Month/Year — click Generate again before saving.',
    });
  }

  let conn;
  try {
    conn = await getConnection();
    const norm = normaliseLines(req.body.lines, await loadTypes(conn));
    if (norm.error) return res.status(400).json({ message: norm.error });
    const { lines } = norm;
    const totals = computeTotals(lines);

    const headerResult = await conn.execute(
      `INSERT INTO XX_OM_HOLIDAY_H_T
         (HOLIDAY_PLAN_ID, OPERATION_UNIT, PLAN_MONTH, PLAN_YEAR, WEEKLY_HOLIDAY_DAY,
          TOTAL_DAYS, WORKING_DAYS, HOLIDAYS_COUNT, CREATED_BY, CREATION_DATE)
       VALUES
         (XX_OM_HOLIDAY_H_S.NEXTVAL, :operationUnit, :planMonth, :planYear, :weeklyHolidayDay,
          :totalDays, :workingDays, :holidaysCount, :createdBy, SYSDATE)
       RETURNING HOLIDAY_PLAN_ID INTO :outId`,
      {
        operationUnit: String(header.operationUnit),
        planMonth: header.planMonth,
        planYear: header.planYear,
        weeklyHolidayDay: header.weeklyHolidayDay,
        totalDays: totals.totalDays,
        workingDays: totals.workingDays,
        holidaysCount: totals.holidaysCount,
        createdBy: req.user.id,
        outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
      { autoCommit: false }
    );

    const planId = headerResult.outBinds.outId[0];
    await insertLines(conn, planId, lines);

    await conn.commit();
    res.status(201).json({ planId, ...totals });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        console.error('Rollback error:', e);
      }
    }
    if (err.errorNum === 1) {
      return res.status(409).json({ message: 'A plan already exists for this Operation Unit / Month / Year' });
    }
    console.error('Create holiday plan error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/holiday/:id - update header stats + replace lines
router.put('/:id', canEdit, async (req, res) => {
  const planId = req.params.id;
  const { header } = req.body;
  if (!Array.isArray(req.body.lines) || req.body.lines.length === 0) {
    return res.status(400).json({ message: 'lines are required' });
  }
  if (header?.planMonth && header?.planYear && !linesMatchHeaderMonth(header.planMonth, header.planYear, req.body.lines)) {
    return res.status(400).json({
      message: 'Day grid does not match the selected Month/Year — click Regenerate Grid again before saving.',
    });
  }

  let conn;
  try {
    conn = await getConnection();
    const norm = normaliseLines(req.body.lines, await loadTypes(conn));
    if (norm.error) return res.status(400).json({ message: norm.error });
    const { lines } = norm;
    const totals = computeTotals(lines);

    await conn.execute(
      `UPDATE XX_OM_HOLIDAY_H_T SET
         WEEKLY_HOLIDAY_DAY = :weeklyHolidayDay,
         TOTAL_DAYS = :totalDays, WORKING_DAYS = :workingDays, HOLIDAYS_COUNT = :holidaysCount,
         LAST_UPDATED_BY = :updatedBy, LAST_UPDATED_DATE = SYSDATE
       WHERE HOLIDAY_PLAN_ID = :planId`,
      {
        weeklyHolidayDay: header.weeklyHolidayDay,
        totalDays: totals.totalDays,
        workingDays: totals.workingDays,
        holidaysCount: totals.holidaysCount,
        updatedBy: req.user.id,
        planId,
      },
      { autoCommit: false }
    );

    await conn.execute(
      `DELETE FROM XX_OM_HOLIDAY_L_T WHERE HOLIDAY_PLAN_ID = :planId`,
      { planId },
      { autoCommit: false }
    );
    await insertLines(conn, Number(planId), lines);

    await conn.commit();
    res.json({ planId: Number(planId), ...totals });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        console.error('Rollback error:', e);
      }
    }
    console.error('Update holiday plan error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/holiday/:id
router.delete('/:id', canEdit, async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `DELETE FROM XX_OM_HOLIDAY_H_T WHERE HOLIDAY_PLAN_ID = :id`,
      { id: req.params.id },
      { autoCommit: true }
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete holiday plan error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
