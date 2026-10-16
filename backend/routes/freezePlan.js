const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/freeze-plan?unit=341
router.get('/', async (req, res) => {
  const { unit } = req.query;
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT FREEZE_ID, UNIT,
              TO_CHAR(FREEZE_START_DATE,'YYYY-MM-DD') AS FREEZE_START_DATE,
              TO_CHAR(FREEZE_END_DATE,'YYYY-MM-DD') AS FREEZE_END_DATE
         FROM XX_OM_FREEZE_PLAN_T
        ${unit ? 'WHERE UNIT = :unit' : ''}
        ORDER BY FREEZE_START_DATE DESC`,
      unit ? { unit } : {}
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List freeze plan error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/freeze-plan
router.post('/', async (req, res) => {
  const { unit, freezeStartDate, freezeEndDate } = req.body;
  if (!unit || !freezeStartDate || !freezeEndDate) {
    return res.status(400).json({ message: 'unit, freezeStartDate and freezeEndDate are required' });
  }

  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `INSERT INTO XX_OM_FREEZE_PLAN_T (FREEZE_ID, UNIT, FREEZE_START_DATE, FREEZE_END_DATE, CREATED_BY, CREATION_DATE)
       VALUES (XX_OM_FREEZE_S.NEXTVAL, :unit, TO_DATE(:s,'YYYY-MM-DD'), TO_DATE(:e,'YYYY-MM-DD'), :createdBy, SYSDATE)
       RETURNING FREEZE_ID INTO :outId`,
      {
        unit, s: freezeStartDate, e: freezeEndDate, createdBy: req.user.id,
        outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
      { autoCommit: true }
    );
    res.status(201).json({ id: result.outBinds.outId[0] });
  } catch (err) {
    console.error('Add freeze plan error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/freeze-plan/:id
router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `DELETE FROM XX_OM_FREEZE_PLAN_T WHERE FREEZE_ID = :id`,
      { id: req.params.id },
      { autoCommit: true }
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete freeze plan error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
