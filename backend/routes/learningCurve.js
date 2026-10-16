const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { getDefaultCurve, getSetting } = require('../lib/buildup');

const router = express.Router();
router.use(requireAuth);

// ---------- Default Learning Curve (build-up) per unit ----------

// GET /api/learning-curve/default?unit=341 -> { unit, required, days: [{ day, pct }], inherited }
router.get('/default', async (req, res) => {
  const unit = Number(req.query.unit) || 0;
  let conn;
  try {
    conn = await getConnection();
    const own = (await conn.execute(`SELECT COUNT(*) AS N FROM XX_OM_DEFAULT_LC_T WHERE UNIT_ID = :u`, { u: unit })).rows[0].N;
    res.json({
      unit,
      required: (await getSetting(conn, unit, 'LC_DEFAULT_REQUIRED', 'N')) === 'Y',
      days: await getDefaultCurve(conn, unit),
      inherited: unit !== 0 && own === 0, // using the all-units default
    });
  } catch (err) {
    console.error('Get default learning curve error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/learning-curve/default { unit, required, days: [{ day, pct }] }  (ADMIN / PLANNER)
router.put('/default', requireRole('ADMIN', 'PLANNER'), async (req, res) => {
  const unit = Number(req.body.unit) || 0;
  const days = Array.isArray(req.body.days) ? req.body.days : [];
  const clean = [];
  for (const [i, d] of days.entries()) {
    const pct = Number(d.pct);
    if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return res.status(400).json({ message: `Day ${i + 1}: % must be between 1 and 100` });
    clean.push({ day: i + 1, pct });
  }
  if (clean.length > 60) return res.status(400).json({ message: 'At most 60 build-up days' });
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(`DELETE FROM XX_OM_DEFAULT_LC_T WHERE UNIT_ID = :u`, { u: unit }, { autoCommit: false });
    for (const d of clean) {
      await conn.execute(
        `INSERT INTO XX_OM_DEFAULT_LC_T (UNIT_ID, DAY_NO, PRODUCTIVITY_PCT, LAST_UPDATED_BY, LAST_UPDATED_DATE) VALUES (:u, :d, :p, :userId, SYSDATE)`,
        { u: unit, d: d.day, p: d.pct, userId: req.user.id },
        { autoCommit: false }
      );
    }
    await conn.execute(
      `MERGE INTO XX_OM_PLANNING_SETTING_T t USING (SELECT :u AS U FROM dual) s
         ON (t.UNIT_ID = s.U AND t.SETTING_KEY = 'LC_DEFAULT_REQUIRED')
       WHEN MATCHED THEN UPDATE SET SETTING_VALUE = :v, LAST_UPDATED_BY = :userId, LAST_UPDATED_DATE = SYSDATE
       WHEN NOT MATCHED THEN INSERT (UNIT_ID, SETTING_KEY, SETTING_VALUE, LAST_UPDATED_BY, LAST_UPDATED_DATE) VALUES (:u, 'LC_DEFAULT_REQUIRED', :v, :userId, SYSDATE)`,
      { u: unit, v: req.body.required ? 'Y' : 'N', userId: req.user.id },
      { autoCommit: false }
    );
    await conn.commit();
    res.json({ message: 'Saved', unit, required: Boolean(req.body.required), days: clean });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Save default learning curve error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/learning-curve/:orderSetupId/apply-default - replace the order's curve with the unit default x its productivity
router.post('/:orderSetupId/apply-default', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const o = (await conn.execute(
      `SELECT UNIT, PRODUCTIVITY FROM XX_OM_SEWING_ORDER_T WHERE ORDER_SETUP_ID = :id`, { id: req.params.orderSetupId }
    )).rows[0];
    if (!o) return res.status(404).json({ message: 'Order not found' });
    if (!o.PRODUCTIVITY) return res.status(400).json({ message: 'Set the order productivity first; the default curve is a % of it' });
    const curve = await getDefaultCurve(conn, o.UNIT || 0);
    await conn.execute(`DELETE FROM XX_OM_LEARNING_CURVE_T WHERE ORDER_SETUP_ID = :id`, { id: req.params.orderSetupId }, { autoCommit: false });
    for (const d of curve) {
      await conn.execute(
        `INSERT INTO XX_OM_LEARNING_CURVE_T (LEARNING_CURVE_ID, ORDER_SETUP_ID, DAY_NO, HOURLY_PRODUCTIVITY)
         VALUES (XX_OM_LEARNING_CURVE_S.NEXTVAL, :id, :d, :p)`,
        { id: Number(req.params.orderSetupId), d: d.day, p: Math.round((Number(o.PRODUCTIVITY) * d.pct) / 100) },
        { autoCommit: false }
      );
    }
    await conn.execute(`UPDATE XX_OM_SEWING_ORDER_T SET LEARNING_CURVE_FLAG = 'Y' WHERE ORDER_SETUP_ID = :id`, { id: req.params.orderSetupId }, { autoCommit: false });
    await conn.commit();
    res.json({ message: 'Default curve applied', days: curve.length });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Apply default learning curve error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// ---------- learning curve of one order ----------

// GET /api/learning-curve/:orderSetupId
router.get('/:orderSetupId', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT LEARNING_CURVE_ID, ORDER_SETUP_ID, DAY_NO, HOURLY_PRODUCTIVITY
         FROM XX_OM_LEARNING_CURVE_T
        WHERE ORDER_SETUP_ID = :id
        ORDER BY DAY_NO`,
      { id: req.params.orderSetupId }
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List learning curve error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/learning-curve - add a day row
router.post('/', async (req, res) => {
  const { orderSetupId, dayNo, hourlyProductivity } = req.body;
  if (!orderSetupId || !dayNo) {
    return res.status(400).json({ message: 'orderSetupId and dayNo are required' });
  }

  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `INSERT INTO XX_OM_LEARNING_CURVE_T (LEARNING_CURVE_ID, ORDER_SETUP_ID, DAY_NO, HOURLY_PRODUCTIVITY)
       VALUES (XX_OM_LEARNING_CURVE_S.NEXTVAL, :orderSetupId, :dayNo, :hourlyProductivity)
       RETURNING LEARNING_CURVE_ID INTO :outId`,
      {
        orderSetupId,
        dayNo,
        hourlyProductivity: hourlyProductivity ?? null,
        outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
      { autoCommit: true }
    );
    res.status(201).json({ id: result.outBinds.outId[0] });
  } catch (err) {
    if (err.errorNum === 1) {
      return res.status(409).json({ message: 'Day No already exists for this order' });
    }
    console.error('Add learning curve row error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/learning-curve/:id
router.put('/:id', async (req, res) => {
  const { dayNo, hourlyProductivity } = req.body;
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `UPDATE XX_OM_LEARNING_CURVE_T SET DAY_NO = :dayNo, HOURLY_PRODUCTIVITY = :hourlyProductivity
       WHERE LEARNING_CURVE_ID = :id`,
      { dayNo, hourlyProductivity: hourlyProductivity ?? null, id: req.params.id },
      { autoCommit: true }
    );
    res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Update learning curve row error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/learning-curve/:id
router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `DELETE FROM XX_OM_LEARNING_CURVE_T WHERE LEARNING_CURVE_ID = :id`,
      { id: req.params.id },
      { autoCommit: true }
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete learning curve row error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
