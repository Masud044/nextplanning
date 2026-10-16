const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');
const { replanLines, replanText } = require('../lib/replan');

const router = express.Router();
router.use(requireAuth);

const ISO = /^\d{4}-\d{2}-\d{2}$/;

// Working hour / manpower ranges per line. Every change re-plans the strips of the affected lines
// from the earliest changed date, in the same transaction (see lib/replan.js).
const validate = ({ workingHour, manpower, startDate, endDate }) => {
  const wh = Number(workingHour);
  if (workingHour === '' || workingHour == null || !Number.isFinite(wh) || wh < 0 || wh > 24) return 'Working Hour must be between 0 and 24';
  if (manpower !== '' && manpower != null && (!Number.isFinite(Number(manpower)) || Number(manpower) < 0)) return 'Manpower must be a positive number';
  if (!ISO.test(String(startDate || ''))) return 'Start Date is required';
  if (endDate && !ISO.test(String(endDate))) return 'End Date is not a valid date';
  if (endDate && endDate < startDate) return 'End Date must be on or after Start Date';
  return null;
};

// GET /api/line-capacity?unit=340 - list capacity records for a unit
router.get('/', async (req, res) => {
  const { unit } = req.query;
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT LINE_CAPACITY_ID, UNIT, LINE_NO, WORKING_HOUR, MANPOWER,
              TO_CHAR(START_DATE,'YYYY-MM-DD') AS START_DATE,
              TO_CHAR(END_DATE,'YYYY-MM-DD') AS END_DATE
         FROM XX_OM_LINE_CAPACITY_T
        ${unit ? 'WHERE UNIT = :unit' : ''}
        ORDER BY LINE_NO, START_DATE DESC`,
      unit ? { unit } : {}
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List line capacity error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/line-capacity - apply working hour/manpower for a date range to one or more lines
router.post('/', async (req, res) => {
  const { unit, lineNos, workingHour, manpower, startDate, endDate } = req.body;

  if (!unit || !Array.isArray(lineNos) || lineNos.length === 0) {
    return res.status(400).json({ message: 'unit and at least one line are required' });
  }
  const invalid = validate(req.body);
  if (invalid) return res.status(400).json({ message: invalid });

  let conn;
  try {
    conn = await getConnection();
    const createdIds = [];

    for (const lineNo of lineNos) {
      const result = await conn.execute(
        `INSERT INTO XX_OM_LINE_CAPACITY_T
           (LINE_CAPACITY_ID, UNIT, LINE_NO, WORKING_HOUR, MANPOWER, START_DATE, END_DATE, CREATED_BY, CREATION_DATE)
         VALUES
           (XX_OM_LINE_CAPACITY_S.NEXTVAL, :unit, :lineNo, :workingHour, :manpower,
            TO_DATE(:startDate,'YYYY-MM-DD'), TO_DATE(:endDate,'YYYY-MM-DD'), :createdBy, SYSDATE)
         RETURNING LINE_CAPACITY_ID INTO :outId`,
        {
          unit,
          lineNo,
          workingHour: Number(workingHour),
          manpower: manpower === '' || manpower == null ? null : Number(manpower),
          startDate,
          endDate: endDate || null,
          createdBy: req.user.id,
          outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        },
        { autoCommit: false }
      );
      createdIds.push(result.outBinds.outId[0]);
    }

    const replan = await replanLines(conn, unit, lineNos, startDate, req.user.id);
    await conn.commit();
    res.status(201).json({ ids: createdIds, replan, replanMessage: replanText(replan) });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        console.error('Rollback error:', e);
      }
    }
    console.error('Create line capacity error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/line-capacity/:id - update a single record
router.put('/:id', async (req, res) => {
  const { workingHour, manpower, startDate, endDate } = req.body;
  const invalid = validate(req.body);
  if (invalid) return res.status(400).json({ message: invalid });

  let conn;
  try {
    conn = await getConnection();
    const old = await conn.execute(
      `SELECT UNIT, LINE_NO, TO_CHAR(START_DATE,'YYYY-MM-DD') AS S FROM XX_OM_LINE_CAPACITY_T WHERE LINE_CAPACITY_ID = :id`,
      { id: req.params.id }
    );
    if (!old.rows.length) return res.status(404).json({ message: 'Capacity record not found' });
    const { UNIT, LINE_NO, S } = old.rows[0];

    await conn.execute(
      `UPDATE XX_OM_LINE_CAPACITY_T SET
         WORKING_HOUR = :workingHour, MANPOWER = :manpower,
         START_DATE = TO_DATE(:startDate,'YYYY-MM-DD'), END_DATE = TO_DATE(:endDate,'YYYY-MM-DD'),
         LAST_UPDATED_BY = :updatedBy, LAST_UPDATED_DATE = SYSDATE
       WHERE LINE_CAPACITY_ID = :id`,
      {
        workingHour: Number(workingHour),
        manpower: manpower === '' || manpower == null ? null : Number(manpower),
        startDate,
        endDate: endDate || null,
        updatedBy: req.user.id,
        id: req.params.id,
      },
      { autoCommit: false }
    );
    const from = S && S < startDate ? S : startDate;
    const replan = await replanLines(conn, UNIT, [LINE_NO], from, req.user.id);
    await conn.commit();
    res.json({ message: 'Updated', replan, replanMessage: replanText(replan) });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Update line capacity error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/line-capacity/:id
router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const old = await conn.execute(
      `SELECT UNIT, LINE_NO, TO_CHAR(START_DATE,'YYYY-MM-DD') AS S FROM XX_OM_LINE_CAPACITY_T WHERE LINE_CAPACITY_ID = :id`,
      { id: req.params.id }
    );
    if (!old.rows.length) return res.status(404).json({ message: 'Capacity record not found' });
    const { UNIT, LINE_NO, S } = old.rows[0];
    await conn.execute(`DELETE FROM XX_OM_LINE_CAPACITY_T WHERE LINE_CAPACITY_ID = :id`, { id: req.params.id }, { autoCommit: false });
    const replan = await replanLines(conn, UNIT, [LINE_NO], S, req.user.id);
    await conn.commit();
    res.json({ message: 'Deleted', replan, replanMessage: replanText(replan) });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Delete line capacity error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
