const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const dateOrNull = (v) => (v ? new Date(v) : null);

// GET /api/line-setup?unit=340 - list (optionally filtered by unit)
router.get('/', async (req, res) => {
  const { unit } = req.query;
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT LINE_SETUP_ID, UNIT, NO_OF_LINE,
              TO_CHAR(EFF_START_DATE,'YYYY-MM-DD') AS EFF_START_DATE,
              TO_CHAR(EFF_END_DATE,'YYYY-MM-DD') AS EFF_END_DATE
         FROM XX_OM_LINE_H_T
        ${unit ? 'WHERE UNIT = :unit' : ''}
        ORDER BY UNIT, EFF_START_DATE DESC`,
      unit ? { unit } : {}
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List line setup error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/line-setup - add a row
router.post('/', async (req, res) => {
  const { unit, noOfLine, effStartDate, effEndDate } = req.body;
  if (!unit || !noOfLine || !effStartDate) {
    return res.status(400).json({ message: 'unit, noOfLine and effStartDate are required' });
  }

  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `INSERT INTO XX_OM_LINE_H_T
         (LINE_SETUP_ID, UNIT, NO_OF_LINE, EFF_START_DATE, EFF_END_DATE, CREATED_BY, CREATION_DATE)
       VALUES
         (XX_OM_LINE_H_S.NEXTVAL, :unit, :noOfLine, :effStartDate, :effEndDate, :createdBy, SYSDATE)
       RETURNING LINE_SETUP_ID INTO :outId`,
      {
        unit,
        noOfLine,
        effStartDate: dateOrNull(effStartDate),
        effEndDate: dateOrNull(effEndDate),
        createdBy: req.user.id,
        outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
      { autoCommit: true }
    );
    res.status(201).json({ id: result.outBinds.outId[0] });
  } catch (err) {
    console.error('Create line setup error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/line-setup/:id - update a row
router.put('/:id', async (req, res) => {
  const { unit, noOfLine, effStartDate, effEndDate } = req.body;

  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `UPDATE XX_OM_LINE_H_T SET
         UNIT = :unit, NO_OF_LINE = :noOfLine, EFF_START_DATE = :effStartDate, EFF_END_DATE = :effEndDate,
         LAST_UPDATED_BY = :updatedBy, LAST_UPDATED_DATE = SYSDATE
       WHERE LINE_SETUP_ID = :id`,
      {
        unit,
        noOfLine,
        effStartDate: dateOrNull(effStartDate),
        effEndDate: dateOrNull(effEndDate),
        updatedBy: req.user.id,
        id: req.params.id,
      },
      { autoCommit: true }
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Update line setup error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/line-setup/:id
router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `DELETE FROM XX_OM_LINE_H_T WHERE LINE_SETUP_ID = :id`,
      { id: req.params.id },
      { autoCommit: true }
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete line setup error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
