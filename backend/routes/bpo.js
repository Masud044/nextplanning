const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

const dateOrNull = (v) => (v ? new Date(v) : null);

// GET /api/bpo/poc/:pocId - all BPO rows for a POC's lines, plus the line list (for the add-form dropdown)
router.get('/poc/:pocId', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();

    const lines = await conn.execute(
      `SELECT FOB_ID, WASH_NAME, COLOR FROM XX_OM_POC_L_T WHERE POC_ID = :pocId ORDER BY FOB_ID`,
      { pocId: req.params.pocId }
    );

    const bpos = await conn.execute(
      `SELECT b.BPO_ID, b.FOB_ID, b.BPO, b.QTY, b.SHIPDATE, b.CLASSIFICATION, b.PO_TYPE,
              b.STATUS, b.INCOTERMS, b.ENDDATE, b.SHIPMODE, b.COUNTRY,
              l.WASH_NAME, l.COLOR
         FROM XX_OM_BPO_INFO_T b
         JOIN XX_OM_POC_L_T l ON l.FOB_ID = b.FOB_ID
        WHERE l.POC_ID = :pocId
        ORDER BY b.BPO_ID`,
      { pocId: req.params.pocId }
    );

    res.json({ lines: lines.rows, bpos: bpos.rows });
  } catch (err) {
    console.error('List BPO error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/bpo - create a BPO row
router.post('/', async (req, res) => {
  const { fobId, bpo, qty, shipDate, classification, poType, status, incoterms, endDate, shipMode, country } =
    req.body;

  if (!fobId) {
    return res.status(400).json({ message: 'fobId is required' });
  }

  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `INSERT INTO XX_OM_BPO_INFO_T
         (BPO_ID, FOB_ID, BPO, QTY, SHIPDATE, CLASSIFICATION, PO_TYPE, STATUS,
          INCOTERMS, ENDDATE, SHIPMODE, COUNTRY, CREATED_BY, CREATION_DATE)
       VALUES
         (XX_OM_BPO_INFO_S.NEXTVAL, :fobId, :bpo, :qty, :shipDate, :classification, :poType, :status,
          :incoterms, :endDate, :shipMode, :country, :createdBy, SYSDATE)
       RETURNING BPO_ID INTO :outBpoId`,
      {
        fobId,
        bpo: bpo ?? null,
        qty: qty ?? null,
        shipDate: dateOrNull(shipDate),
        classification: classification ?? null,
        poType: poType ?? null,
        status: status ?? 1,
        incoterms: incoterms ?? null,
        endDate: dateOrNull(endDate),
        shipMode: shipMode ?? null,
        country: country ?? null,
        createdBy: req.user.id,
        outBpoId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
      { autoCommit: true }
    );

    res.status(201).json({ bpoId: result.outBinds.outBpoId[0] });
  } catch (err) {
    console.error('Create BPO error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/bpo/:id - update a BPO row
router.put('/:id', async (req, res) => {
  const { bpo, qty, shipDate, classification, poType, status, incoterms, endDate, shipMode, country } = req.body;

  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `UPDATE XX_OM_BPO_INFO_T SET
         BPO = :bpo, QTY = :qty, SHIPDATE = :shipDate, CLASSIFICATION = :classification,
         PO_TYPE = :poType, STATUS = :status, INCOTERMS = :incoterms, ENDDATE = :endDate,
         SHIPMODE = :shipMode, COUNTRY = :country,
         LAST_UPDATED_BY = :updatedBy, LAST_UPDATION_DATE = SYSDATE
       WHERE BPO_ID = :id`,
      {
        bpo: bpo ?? null,
        qty: qty ?? null,
        shipDate: dateOrNull(shipDate),
        classification: classification ?? null,
        poType: poType ?? null,
        status: status ?? 1,
        incoterms: incoterms ?? null,
        endDate: dateOrNull(endDate),
        shipMode: shipMode ?? null,
        country: country ?? null,
        updatedBy: req.user.id,
        id: req.params.id,
      },
      { autoCommit: true }
    );

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Update BPO error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/bpo/:id
router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `DELETE FROM XX_OM_BPO_INFO_T WHERE BPO_ID = :id`,
      { id: req.params.id },
      { autoCommit: true }
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete BPO error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
