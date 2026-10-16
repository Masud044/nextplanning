const express = require('express');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const yn = (v, dflt) => (v === undefined || v === null ? dflt : v === true || v === 'Y' ? 'Y' : 'N');

// GET /api/production-units           active units (the LOV), default first
// GET /api/production-units?all=1     every unit, for the setup screen
router.get('/', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT UNIT_ID, UNIT_CODE, UNIT_NAME, IS_DEFAULT, ACTIVE, SORT_ORDER
         FROM XX_OM_PRODUCTION_UNIT_T
        ${req.query.all ? '' : "WHERE ACTIVE = 'Y'"}
        ORDER BY CASE IS_DEFAULT WHEN 'Y' THEN 0 ELSE 1 END, NVL(SORT_ORDER, 9999), UNIT_CODE`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List production units error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// Making a unit the default clears the flag on every other unit in the same transaction.
const clearOtherDefaults = (conn, unitId) =>
  conn.execute(`UPDATE XX_OM_PRODUCTION_UNIT_T SET IS_DEFAULT = 'N' WHERE IS_DEFAULT = 'Y' AND UNIT_ID <> :unitId`, { unitId }, { autoCommit: false });

// POST /api/production-units
router.post('/', async (req, res) => {
  const { unitId, unitCode, unitName, isDefault, active, sortOrder } = req.body;
  if (!unitId || !String(unitCode || '').trim()) {
    return res.status(400).json({ message: 'Unit ID and Unit Code are required' });
  }
  const def = yn(isDefault, 'N');
  let conn;
  try {
    conn = await getConnection();
    if (def === 'Y') await clearOtherDefaults(conn, Number(unitId));
    await conn.execute(
      `INSERT INTO XX_OM_PRODUCTION_UNIT_T (UNIT_ID, UNIT_CODE, UNIT_NAME, IS_DEFAULT, ACTIVE, SORT_ORDER, CREATED_BY, CREATION_DATE)
       VALUES (:unitId, :unitCode, :unitName, :def, :active, :sortOrder, :createdBy, SYSDATE)`,
      {
        unitId: Number(unitId),
        unitCode: String(unitCode).trim().toUpperCase(),
        unitName: unitName ?? null,
        def,
        active: def === 'Y' ? 'Y' : yn(active, 'Y'),
        sortOrder: sortOrder === '' || sortOrder == null ? null : Number(sortOrder),
        createdBy: req.user.id,
      },
      { autoCommit: false }
    );
    await conn.commit();
    res.status(201).json({ id: Number(unitId) });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    if (err.errorNum === 1) return res.status(409).json({ message: 'That Unit ID or Unit Code already exists' });
    console.error('Create production unit error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/production-units/:id  (the id itself is not editable; it is stored in the planning tables)
router.put('/:id', async (req, res) => {
  const { unitCode, unitName, isDefault, active, sortOrder } = req.body;
  if (!String(unitCode || '').trim()) return res.status(400).json({ message: 'Unit Code is required' });
  const id = Number(req.params.id);
  const def = yn(isDefault, 'N');
  const act = yn(active, 'Y');
  if (def === 'Y' && act === 'N') return res.status(400).json({ message: 'The default unit must be active' });

  let conn;
  try {
    conn = await getConnection();
    if (def === 'Y') await clearOtherDefaults(conn, id);
    const r = await conn.execute(
      `UPDATE XX_OM_PRODUCTION_UNIT_T
          SET UNIT_CODE = :unitCode, UNIT_NAME = :unitName, IS_DEFAULT = :def, ACTIVE = :act,
              SORT_ORDER = :sortOrder, LAST_UPDATED_BY = :updatedBy, LAST_UPDATED_DATE = SYSDATE
        WHERE UNIT_ID = :id`,
      {
        unitCode: String(unitCode).trim().toUpperCase(),
        unitName: unitName ?? null,
        def,
        act,
        sortOrder: sortOrder === '' || sortOrder == null ? null : Number(sortOrder),
        updatedBy: req.user.id,
        id,
      },
      { autoCommit: false }
    );
    if (!r.rowsAffected) { await conn.rollback(); return res.status(404).json({ message: 'Unit not found' }); }
    await conn.commit();
    res.json({ message: 'Updated' });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    if (err.errorNum === 1) return res.status(409).json({ message: 'That Unit Code is already used' });
    console.error('Update production unit error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
