const express = require('express');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/brand-color
router.get('/', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(`SELECT BRAND, COLOR_HEX FROM XX_OM_BRAND_COLOR_T`);
    res.json(result.rows);
  } catch (err) {
    console.error('List brand colors error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/brand-color - upsert one brand's color
router.put('/', async (req, res) => {
  const { brand, colorHex } = req.body;
  if (!brand || !colorHex) {
    return res.status(400).json({ message: 'brand and colorHex are required' });
  }

  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `MERGE INTO XX_OM_BRAND_COLOR_T t
       USING (SELECT :brand AS BRAND FROM DUAL) src
       ON (t.BRAND = src.BRAND)
       WHEN MATCHED THEN UPDATE SET COLOR_HEX = :colorHex
       WHEN NOT MATCHED THEN INSERT (BRAND, COLOR_HEX) VALUES (:brand, :colorHex)`,
      { brand, colorHex },
      { autoCommit: true }
    );
    res.json({ message: 'Saved' });
  } catch (err) {
    console.error('Save brand color error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
