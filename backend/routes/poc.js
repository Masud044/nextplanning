const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');

const router = express.Router();
router.use(requireAuth);

// GET /api/poc - list/search headers (summary)
router.get('/', async (req, res) => {
  const { style, season, brand, pocId } = req.query;
  const conditions = [];
  const binds = {};

  if (pocId) {
    conditions.push('POC_ID = :pocId');
    binds.pocId = pocId;
  }
  if (style) {
    conditions.push('UPPER(STYLE) LIKE UPPER(:style)');
    binds.style = `%${style}%`;
  }
  if (season) {
    conditions.push('UPPER(SEASON) LIKE UPPER(:season)');
    binds.season = `%${season}%`;
  }
  if (brand) {
    conditions.push('UPPER(BRAND) LIKE UPPER(:brand)');
    binds.brand = `%${brand}%`;
  }

  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT POC_ID, SEASON, STYLE, STYLE_DESCRIPTION, BRAND, BUYER_ID,
              ORDER_QTY, GM_APPROVAL, STATUS, CREATION_DATE
         FROM XX_OM_POC_H_T
         ${whereClause}
        ORDER BY POC_ID DESC`,
      binds
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List POC error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// GET /api/poc/:id - header + lines
router.get('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const header = await conn.execute(
      `SELECT * FROM XX_OM_POC_H_T WHERE POC_ID = :id`,
      { id: req.params.id }
    );
    if (header.rows.length === 0) {
      return res.status(404).json({ message: 'POC not found' });
    }
    const lines = await conn.execute(
      `SELECT * FROM XX_OM_POC_L_T WHERE POC_ID = :id ORDER BY FOB_ID`,
      { id: req.params.id }
    );
    res.json({ header: header.rows[0], lines: lines.rows });
  } catch (err) {
    console.error('Get POC error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/poc - create header + lines
router.post('/', async (req, res) => {
  const { header, lines } = req.body;
  if (!header) {
    return res.status(400).json({ message: 'header is required' });
  }

  let conn;
  try {
    conn = await getConnection();

    const headerResult = await conn.execute(
      `INSERT INTO XX_OM_POC_H_T
         (POC_ID, LC_UNIT, BUYER_ID, SEASON, STYLE, STYLE_DESCRIPTION, BRAND, FIT,
          END_USER, ITEM_DESCRIPTION, ORDER_QTY, CREATED_BY, CREATION_DATE, GM_APPROVAL, STATUS)
       VALUES
         (XX_OM_POC_H_S.NEXTVAL, :lcUnit, :buyerId, :season, :style, :styleDescription, :brand, :fit,
          :endUser, :itemDescription, :orderQty, :createdBy, SYSDATE, :gmApproval, :status)
       RETURNING POC_ID INTO :outPocId`,
      {
        lcUnit: header.lcUnit ?? null,
        buyerId: header.buyerId ?? null,
        season: header.season ?? null,
        style: header.style ?? null,
        styleDescription: header.styleDescription ?? null,
        brand: header.brand ?? null,
        fit: header.fit ?? null,
        endUser: header.endUser ?? null,
        itemDescription: header.itemDescription ?? null,
        orderQty: header.orderQty ?? null,
        createdBy: req.user.id,
        gmApproval: header.gmApproval ?? 'N',
        status: header.status ?? 1,
        outPocId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
      { autoCommit: false }
    );

    const pocId = headerResult.outBinds.outPocId[0];

    if (Array.isArray(lines) && lines.length > 0) {
      for (const line of lines) {
        const fabricCost = Number(line.fabricCost) || 0;
        const trimCost = Number(line.trimCost) || 0;
        const washCost = Number(line.washCost) || 0;
        const cm = Number(line.cm) || 0;
        const fob = fabricCost + trimCost + washCost + cm;

        await conn.execute(
          `INSERT INTO XX_OM_POC_L_T
             (FOB_ID, POC_ID, WASH_NAME, COLOR, FABRIC_COST, TRIM_COST, WASH_COST, CM, FOB)
           VALUES
             (XX_OM_POC_L_S.NEXTVAL, :pocId, :washName, :color, :fabricCost, :trimCost, :washCost, :cm, :fob)`,
          {
            pocId,
            washName: line.washName ?? null,
            color: line.color ?? null,
            fabricCost,
            trimCost,
            washCost,
            cm,
            fob,
          },
          { autoCommit: false }
        );
      }
    }

    await conn.commit();
    res.status(201).json({ pocId });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        console.error('Rollback error:', e);
      }
    }
    console.error('Create POC error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/poc/:id - update header, replace lines
router.put('/:id', async (req, res) => {
  const pocId = req.params.id;
  const { header, lines } = req.body;

  let conn;
  try {
    conn = await getConnection();

    await conn.execute(
      `UPDATE XX_OM_POC_H_T SET
         LC_UNIT = :lcUnit, BUYER_ID = :buyerId, SEASON = :season, STYLE = :style,
         STYLE_DESCRIPTION = :styleDescription, BRAND = :brand, FIT = :fit,
         END_USER = :endUser, ITEM_DESCRIPTION = :itemDescription, ORDER_QTY = :orderQty,
         GM_APPROVAL = :gmApproval, STATUS = :status,
         LAST_UPDATED_BY = :updatedBy, LAST_UPDATED_DATE = SYSDATE
       WHERE POC_ID = :pocId`,
      {
        lcUnit: header.lcUnit ?? null,
        buyerId: header.buyerId ?? null,
        season: header.season ?? null,
        style: header.style ?? null,
        styleDescription: header.styleDescription ?? null,
        brand: header.brand ?? null,
        fit: header.fit ?? null,
        endUser: header.endUser ?? null,
        itemDescription: header.itemDescription ?? null,
        orderQty: header.orderQty ?? null,
        gmApproval: header.gmApproval ?? 'N',
        status: header.status ?? 1,
        updatedBy: req.user.id,
        pocId,
      },
      { autoCommit: false }
    );

    await conn.execute(`DELETE FROM XX_OM_POC_L_T WHERE POC_ID = :pocId`, { pocId }, { autoCommit: false });

    if (Array.isArray(lines) && lines.length > 0) {
      for (const line of lines) {
        const fabricCost = Number(line.fabricCost) || 0;
        const trimCost = Number(line.trimCost) || 0;
        const washCost = Number(line.washCost) || 0;
        const cm = Number(line.cm) || 0;
        const fob = fabricCost + trimCost + washCost + cm;

        await conn.execute(
          `INSERT INTO XX_OM_POC_L_T
             (FOB_ID, POC_ID, WASH_NAME, COLOR, FABRIC_COST, TRIM_COST, WASH_COST, CM, FOB)
           VALUES
             (XX_OM_POC_L_S.NEXTVAL, :pocId, :washName, :color, :fabricCost, :trimCost, :washCost, :cm, :fob)`,
          {
            pocId,
            washName: line.washName ?? null,
            color: line.color ?? null,
            fabricCost,
            trimCost,
            washCost,
            cm,
            fob,
          },
          { autoCommit: false }
        );
      }
    }

    await conn.commit();
    res.json({ pocId: Number(pocId) });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        console.error('Rollback error:', e);
      }
    }
    console.error('Update POC error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/poc/:id
router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(`DELETE FROM XX_OM_POC_L_T WHERE POC_ID = :id`, { id: req.params.id }, { autoCommit: false });
    await conn.execute(`DELETE FROM XX_OM_POC_H_T WHERE POC_ID = :id`, { id: req.params.id }, { autoCommit: false });
    await conn.commit();
    res.json({ message: 'Deleted' });
  } catch (err) {
    if (conn) {
      try {
        await conn.rollback();
      } catch (e) {
        console.error('Rollback error:', e);
      }
    }
    console.error('Delete POC error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
