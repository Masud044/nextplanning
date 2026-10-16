const express = require('express');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');
const { getDefaultWorkingHour } = require('../lib/capacity');
const { replanLines, replanText } = require('../lib/replan');

const router = express.Router();
router.use(requireAuth);

const today = () => new Date().toISOString().slice(0, 10);

// GET /api/planning-settings?unit=341 -> { unit, defaultWorkingHour }
router.get('/', async (req, res) => {
  const { unit } = req.query;
  if (!unit) return res.status(400).json({ message: 'unit is required' });
  let conn;
  try {
    conn = await getConnection();
    res.json({ unit: Number(unit), defaultWorkingHour: await getDefaultWorkingHour(conn, unit) });
  } catch (err) {
    console.error('Get planning settings error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/planning-settings { unit, defaultWorkingHour }
// The default hour is used on days without a working-hour range or day value, so every line of the unit is re-planned from today.
router.put('/', requireRole('ADMIN', 'PLANNER'), async (req, res) => {
  const { unit, defaultWorkingHour } = req.body;
  const wh = Number(defaultWorkingHour);
  if (!unit) return res.status(400).json({ message: 'unit is required' });
  if (defaultWorkingHour === '' || !Number.isFinite(wh) || wh < 0 || wh > 24) {
    return res.status(400).json({ message: 'Default Working Hour must be between 0 and 24' });
  }
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `MERGE INTO XX_OM_PLANNING_SETTING_T t
       USING (SELECT :u AS U FROM dual) s ON (t.UNIT_ID = s.U AND t.SETTING_KEY = 'DEFAULT_WORKING_HOUR')
       WHEN MATCHED THEN UPDATE SET SETTING_VALUE = :v, LAST_UPDATED_BY = :userId, LAST_UPDATED_DATE = SYSDATE
       WHEN NOT MATCHED THEN INSERT (UNIT_ID, SETTING_KEY, SETTING_VALUE, LAST_UPDATED_BY, LAST_UPDATED_DATE)
         VALUES (:u, 'DEFAULT_WORKING_HOUR', :v, :userId, SYSDATE)`,
      { u: Number(unit), v: String(wh), userId: req.user.id },
      { autoCommit: false }
    );
    const lines = (await conn.execute(
      `SELECT DISTINCT LINE_NO FROM XX_OM_PLANNING_STRIP_T WHERE UNIT = :u AND LINE_NO IS NOT NULL`,
      { u: Number(unit) }
    )).rows.map((r) => r.LINE_NO);
    const replan = await replanLines(conn, unit, lines, today(), req.user.id);
    await conn.commit();
    res.json({ unit: Number(unit), defaultWorkingHour: wh, replan, replanMessage: replanText(replan) });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Save planning settings error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
