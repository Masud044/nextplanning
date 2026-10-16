const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');
const { getSetting } = require('../lib/buildup');

const router = express.Router();
router.use(requireAuth);

// Stitching Planning - Order Setup. Only orders populated here can be stripped and planned on the planning board.

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isoOrNull = (v) => (v && ISO.test(String(v)) ? String(v) : null);
const numOrNull = (v) => (v === '' || v === null || v === undefined || !Number.isFinite(Number(v)) ? null : Number(v));
const inList = (ids, prefix = 'id') => ({
  sql: ids.map((_, i) => `:${prefix}${i}`).join(','),
  binds: Object.fromEntries(ids.map((id, i) => [`${prefix}${i}`, Number(id)])),
});

// New sewing orders start in the default Production Unit (XX_OM_PRODUCTION_UNIT_T.IS_DEFAULT = 'Y', e.g. AMS 341).
const DEFAULT_UNIT_ID = `SELECT MAX(UNIT_ID) FROM XX_OM_PRODUCTION_UNIT_T WHERE IS_DEFAULT = 'Y'`;

// columns that exist only in some schemas (the server's POC line table is smaller)
const columnCache = {};
const hasColumn = async (conn, table, column) => {
  const key = `${table}.${column}`;
  if (columnCache[key] === undefined) {
    const r = await conn.execute(`SELECT COUNT(*) AS N FROM user_tab_columns WHERE table_name = :t AND column_name = :c`, { t: table, c: column });
    columnCache[key] = r.rows[0].N > 0;
  }
  return columnCache[key];
};

// strips of an order, or of its whole combined group (a combined group has one strip on its lowest order id)
const GROUP_ORDERS = `SELECT m.ORDER_SETUP_ID FROM XX_OM_SEWING_ORDER_T m
                       WHERE m.ORDER_SETUP_ID = so.ORDER_SETUP_ID OR (so.COMBINE_ID IS NOT NULL AND m.COMBINE_ID = so.COMBINE_ID)`;

const LIST_QUERY = (where) => `
  SELECT so.ORDER_SETUP_ID, so.COMBINE_ID, so.LEARNING_CURVE_FLAG, so.ORDER_TYPE, so.UNIT,
         so.BPO_ID, bpo.BPO AS BPO_NUMBER, h.POC_ID, so.ORDER_QTY, so.BUYER_QTY, so.EXTRA_PCT,
         b.BUYER_NAME, h.SEASON, h.STYLE, l.COLOR, l.WASH_NAME, h.ITEM_DESCRIPTION,
         TO_CHAR(so.SHIP_DATE,'YYYY-MM-DD') AS SHIP_DATE,
         so.PRODUCTION_UNIT, so.PRODUCTIVITY,
         TO_CHAR(so.SEWING_START_DATE,'YYYY-MM-DD') AS SEWING_START_DATE,
         TO_CHAR(so.SEWING_END_DATE,'YYYY-MM-DD') AS SEWING_END_DATE,
         (SELECT COUNT(*) FROM XX_OM_LEARNING_CURVE_T lc WHERE lc.ORDER_SETUP_ID = so.ORDER_SETUP_ID) AS LC_ROWS,
         (SELECT COUNT(*) FROM XX_OM_PLANNING_STRIP_T st WHERE st.ORDER_SETUP_ID IN (${GROUP_ORDERS})) AS STRIPS,
         (SELECT COUNT(*) FROM XX_OM_PLANNING_STRIP_T st WHERE st.ORDER_SETUP_ID IN (${GROUP_ORDERS}) AND st.LINE_NO IS NOT NULL) AS STRIPS_ON_LINE
    FROM XX_OM_SEWING_ORDER_T so
    JOIN XX_OM_POC_L_T l ON l.FOB_ID = so.FOB_ID
    JOIN XX_OM_POC_H_T h ON h.POC_ID = l.POC_ID
    LEFT JOIN XX_OM_BUYER_T b ON b.BUYER_ID = h.BUYER_ID
    LEFT JOIN XX_OM_BPO_INFO_T bpo ON bpo.BPO_ID = so.BPO_ID
   ${where}
   ORDER BY so.ORDER_SETUP_ID DESC`;

// GET /api/sewing-orders[?unit=341 | ?unit=none] - the Order Setup grid
router.get('/', async (req, res) => {
  const { unit } = req.query;
  let where = '';
  const binds = {};
  if (unit === 'none') where = 'WHERE so.UNIT IS NULL';
  else if (unit) { where = 'WHERE so.UNIT = :unit'; binds.unit = Number(unit); }
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(LIST_QUERY(where), binds);
    res.json(result.rows);
  } catch (err) {
    console.error('List sewing orders error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// GET /api/sewing-orders/populate-options - buyers and seasons for the Populate filters, plus the build-up default
router.get('/populate-options', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const buyers = (await conn.execute(`SELECT BUYER_ID, BUYER_NAME FROM XX_OM_BUYER_T ORDER BY BUYER_NAME`)).rows;
    const seasons = (await conn.execute(
      `SELECT DISTINCT h.SEASON FROM XX_OM_POC_H_T h JOIN XX_OM_POC_L_T l ON l.POC_ID = h.POC_ID
         JOIN XX_OM_BPO_INFO_T b ON b.FOB_ID = l.FOB_ID WHERE h.SEASON IS NOT NULL ORDER BY 1`
    )).rows.map((r) => r.SEASON);
    const lcRequired = (await getSetting(conn, req.query.unit || 0, 'LC_DEFAULT_REQUIRED', 'N')) === 'Y';
    res.json({ buyers, seasons, lcRequired });
  } catch (err) {
    console.error('Populate options error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// Which BPOs a populate request covers. Confirmed = BPO classification other than TBA; Unconfirmed = TBA (projection).
const populateSource = (f) => {
  const cond = [
    'b.FOB_ID IS NOT NULL',
    'NVL(b.QTY, 0) > 0',
    'NOT EXISTS (SELECT 1 FROM XX_OM_SEWING_ORDER_T so WHERE so.BPO_ID = b.BPO_ID)',
  ];
  const binds = {};
  if (f.orderType === 'Confirmed') cond.push(`NVL(UPPER(b.CLASSIFICATION), 'BPO') <> 'TBA'`);
  else if (f.orderType === 'Unconfirmed') cond.push(`UPPER(b.CLASSIFICATION) = 'TBA'`);
  if (isoOrNull(f.shipFrom)) { cond.push(`b.SHIPDATE >= TO_DATE(:shipFrom,'YYYY-MM-DD')`); binds.shipFrom = f.shipFrom; }
  if (isoOrNull(f.shipTo)) { cond.push(`b.SHIPDATE < TO_DATE(:shipTo,'YYYY-MM-DD') + 1`); binds.shipTo = f.shipTo; }
  if (numOrNull(f.buyerId) !== null) { cond.push('h.BUYER_ID = :buyerId'); binds.buyerId = Number(f.buyerId); }
  if (f.season) { cond.push('h.SEASON = :season'); binds.season = String(f.season); }
  if (f.style && String(f.style).trim()) { cond.push('UPPER(h.STYLE) LIKE :style'); binds.style = `%${String(f.style).trim().toUpperCase()}%`; }
  return {
    from: `FROM XX_OM_BPO_INFO_T b JOIN XX_OM_POC_L_T l ON l.FOB_ID = b.FOB_ID JOIN XX_OM_POC_H_T h ON h.POC_ID = l.POC_ID
           WHERE ${cond.join(' AND ')}`,
    binds,
  };
};

const validatePopulate = (f) => {
  if (!['Confirmed', 'Unconfirmed', 'Both'].includes(f.orderType)) return 'Choose Confirmed, Unconfirmed or Both';
  if (numOrNull(f.unit) === null) return 'Choose the stitching unit';
  const pct = numOrNull(f.extraPct) ?? 0;
  if (pct < 0 || pct > 100) return 'Extra % must be between 0 and 100';
  if (f.productivity !== '' && f.productivity != null && (numOrNull(f.productivity) === null || Number(f.productivity) <= 0)) return 'Productivity must be a positive number';
  if (f.startMode === 'fixed' && !isoOrNull(f.startDate)) return 'Enter the production start date';
  if (f.startMode === 'beforeShip' && (numOrNull(f.daysBeforeShip) === null || Number(f.daysBeforeShip) < 0)) return 'Enter the days before ship date';
  if (isoOrNull(f.shipFrom) && isoOrNull(f.shipTo) && f.shipTo < f.shipFrom) return 'Ship date "to" is before "from"';
  return null;
};

// POST /api/sewing-orders/populate { preview, orderType, unit, extraPct, productivity, startMode, startDate, daysBeforeShip,
//                                    learningCurve, shipFrom, shipTo, buyerId, season, style }
// preview = true only counts; otherwise one set-based insert of all matching BPOs.
router.post('/populate', (req, res) => populate(req, res, req.body || {}));

async function populate(req, res, f) {
  const invalid = validatePopulate(f);
  if (invalid) return res.status(400).json({ message: invalid });

  const pct = numOrNull(f.extraPct) ?? 0;
  let conn;
  try {
    conn = await getConnection();
    const src = populateSource(f);
    const pocProductivity = (await hasColumn(conn, 'XX_OM_POC_L_T', 'PROD_PER_LINE_PER_H')) ? 'l.PROD_PER_LINE_PER_H' : 'NULL';
    const productivityExpr = numOrNull(f.productivity) !== null ? ':productivity' : pocProductivity;

    const summary = (await conn.execute(
      `SELECT COUNT(*) AS N, NVL(SUM(b.QTY), 0) AS BUYER_QTY, NVL(SUM(CEIL(b.QTY * (1 + :pct / 100))), 0) AS ORDER_QTY,
              SUM(CASE WHEN UPPER(b.CLASSIFICATION) = 'TBA' THEN 1 ELSE 0 END) AS UNCONFIRMED,
              SUM(CASE WHEN ${productivityExpr} IS NULL THEN 1 ELSE 0 END) AS NO_PRODUCTIVITY,
              TO_CHAR(MIN(b.SHIPDATE),'YYYY-MM-DD') AS FIRST_SHIP, TO_CHAR(MAX(b.SHIPDATE),'YYYY-MM-DD') AS LAST_SHIP
         ${src.from}`,
      { ...src.binds, pct, ...(productivityExpr === ':productivity' ? { productivity: Number(f.productivity) } : {}) }
    )).rows[0];

    if (f.preview) return res.json({ preview: true, ...summary });
    if (!summary.N) return res.json({ inserted: 0, ...summary });

    const startExpr = f.startMode === 'fixed' ? `TO_DATE(:startDate,'YYYY-MM-DD')`
      : f.startMode === 'beforeShip' ? 'TRUNC(b.SHIPDATE) - :daysBeforeShip' : 'NULL';
    const binds = {
      ...src.binds,
      pct,
      unit: Number(f.unit),
      lcFlag: f.learningCurve === true || f.learningCurve === 'Y' ? 'Y' : 'N',
      createdBy: req.user.id,
    };
    if (productivityExpr === ':productivity') binds.productivity = Number(f.productivity);
    if (f.startMode === 'fixed') binds.startDate = f.startDate;
    if (f.startMode === 'beforeShip') binds.daysBeforeShip = Number(f.daysBeforeShip);

    const result = await conn.execute(
      `INSERT INTO XX_OM_SEWING_ORDER_T
         (ORDER_SETUP_ID, ORDER_TYPE, BPO_ID, FOB_ID, BUYER_QTY, EXTRA_PCT, ORDER_QTY, SHIP_DATE, UNIT, PRODUCTION_UNIT,
          PRODUCTIVITY, SEWING_START_DATE, LEARNING_CURVE_FLAG, CREATED_BY, CREATION_DATE)
       SELECT XX_OM_SEWING_ORDER_S.NEXTVAL,
              CASE WHEN UPPER(b.CLASSIFICATION) = 'TBA' THEN 'Projection' ELSE 'Confirmed' END,
              b.BPO_ID, b.FOB_ID, b.QTY, :pct, CEIL(b.QTY * (1 + :pct / 100)), b.SHIPDATE, :unit, TO_CHAR(:unit),
              ${productivityExpr}, ${startExpr}, :lcFlag, :createdBy, SYSDATE
         ${src.from}`,
      binds,
      { autoCommit: false }
    );
    await conn.commit();
    res.json({ inserted: result.rowsAffected, ...summary });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Populate orders error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
}

// POST /api/sewing-orders/populate-confirmed - older button: all confirmed BPOs into the default unit, no extra %
router.post('/populate-confirmed', async (req, res) => {
  let unit = 341;
  let conn;
  try {
    conn = await getConnection();
    const r = await conn.execute(`SELECT MAX(UNIT_ID) AS U FROM XX_OM_PRODUCTION_UNIT_T WHERE IS_DEFAULT = 'Y'`);
    if (r.rows[0].U) unit = r.rows[0].U;
  } catch (e) {
    // keep 341
  } finally {
    if (conn) await conn.close();
  }
  return populate(req, res, { orderType: 'Confirmed', unit, extraPct: 0, startMode: 'none' });
});

// GET /api/sewing-orders/fob-options - FOB lines available to add as a manual (unconfirmed) order
router.get('/fob-options', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT l.FOB_ID, h.STYLE, l.WASH_NAME, l.COLOR
         FROM XX_OM_POC_L_T l
         JOIN XX_OM_POC_H_T h ON h.POC_ID = l.POC_ID
        ORDER BY l.FOB_ID`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List FOB options error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/sewing-orders - add an unconfirmed (manual/Projection) order
router.post('/', async (req, res) => {
  const { fobId, orderQty, shipDate, extraPct, unit } = req.body;
  if (!fobId) return res.status(400).json({ message: 'fobId is required' });
  const buyerQty = numOrNull(orderQty);
  const pct = numOrNull(extraPct) ?? 0;

  let conn;
  try {
    conn = await getConnection();
    const lcFlag = (await getSetting(conn, unit || 0, 'LC_DEFAULT_REQUIRED', 'N')) === 'Y' ? 'Y' : 'N';
    const result = await conn.execute(
      `INSERT INTO XX_OM_SEWING_ORDER_T
         (ORDER_SETUP_ID, ORDER_TYPE, FOB_ID, BUYER_QTY, EXTRA_PCT, ORDER_QTY, SHIP_DATE, UNIT, PRODUCTION_UNIT,
          LEARNING_CURVE_FLAG, CREATED_BY, CREATION_DATE)
       VALUES
         (XX_OM_SEWING_ORDER_S.NEXTVAL, 'Projection', :fobId, :buyerQty, :pct, CEIL(:buyerQty * (1 + :pct / 100)),
          TO_DATE(:shipDate,'YYYY-MM-DD'),
          NVL(:unit, (${DEFAULT_UNIT_ID})), TO_CHAR(NVL(:unit, (${DEFAULT_UNIT_ID}))), :lcFlag, :createdBy, SYSDATE)
       RETURNING ORDER_SETUP_ID INTO :outId`,
      {
        fobId: Number(fobId),
        buyerQty,
        pct,
        shipDate: isoOrNull(shipDate),
        unit: numOrNull(unit),
        lcFlag,
        createdBy: req.user.id,
        outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
      { autoCommit: true }
    );
    res.status(201).json({ id: result.outBinds.outId[0] });
  } catch (err) {
    console.error('Add unconfirmed order error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/sewing-orders/:id - update the setup of one order.
// Extra % recalculates Order Qty from Buyer Qty. The sewing start date only seeds a new strip: strips already made keep their dates.
router.put('/:id', async (req, res) => {
  const b = req.body;
  const extraPct = numOrNull(b.extraPct);
  const productivity = numOrNull(b.productivity);
  if (extraPct !== null && (extraPct < 0 || extraPct > 100)) return res.status(400).json({ message: 'Extra % must be between 0 and 100' });
  if (productivity !== null && productivity < 0) return res.status(400).json({ message: 'Productivity cannot be negative' });
  const start = isoOrNull(b.sewingStartDate);
  const end = isoOrNull(b.sewingEndDate);
  if (start && end && end < start) return res.status(400).json({ message: 'Sewing End Date is before Sewing Start Date' });

  let conn;
  try {
    conn = await getConnection();
    const cur = (await conn.execute(
      `SELECT so.UNIT, so.BUYER_QTY, so.ORDER_QTY,
              (SELECT COUNT(*) FROM XX_OM_PLANNING_STRIP_T st WHERE st.ORDER_SETUP_ID IN (${GROUP_ORDERS})) AS STRIPS
         FROM XX_OM_SEWING_ORDER_T so WHERE so.ORDER_SETUP_ID = :id`,
      { id: req.params.id }
    )).rows[0];
    if (!cur) return res.status(404).json({ message: 'Order not found' });

    const unit = numOrNull(b.unit ?? b.productionUnit);
    if (cur.STRIPS > 0 && unit !== null && cur.UNIT !== null && unit !== Number(cur.UNIT)) {
      return res.status(409).json({ message: 'This order already has strips on the planning board of its unit. Delete the strips before moving it to another unit.' });
    }

    const buyerQty = numOrNull(b.buyerQty) ?? (cur.BUYER_QTY !== null ? Number(cur.BUYER_QTY) : numOrNull(b.orderQty));
    let orderQty = numOrNull(b.orderQty);
    if (extraPct !== null && buyerQty !== null && (b.orderQty === undefined || b.recalcQty)) orderQty = Math.ceil(buyerQty * (1 + extraPct / 100));

    await conn.execute(
      `UPDATE XX_OM_SEWING_ORDER_T SET
         ORDER_QTY = :orderQty, BUYER_QTY = :buyerQty, EXTRA_PCT = NVL(:extraPct, EXTRA_PCT),
         PRODUCTION_UNIT = :productionUnit, UNIT = :unit, PRODUCTIVITY = :productivity,
         SEWING_START_DATE = TO_DATE(:startDate,'YYYY-MM-DD'), SEWING_END_DATE = TO_DATE(:endDate,'YYYY-MM-DD'),
         LEARNING_CURVE_FLAG = :lcFlag,
         LAST_UPDATED_BY = :updatedBy, LAST_UPDATED_DATE = SYSDATE
       WHERE ORDER_SETUP_ID = :id`,
      {
        orderQty: orderQty ?? (cur.ORDER_QTY !== null ? Number(cur.ORDER_QTY) : null),
        buyerQty,
        extraPct,
        productionUnit: unit !== null ? String(unit) : null,
        unit,
        productivity,
        startDate: start,
        endDate: end,
        lcFlag: b.learningCurveFlag === 'Y' ? 'Y' : 'N',
        updatedBy: req.user.id,
        id: req.params.id,
      },
      { autoCommit: true }
    );
    res.json({ message: 'Updated', orderQty });
  } catch (err) {
    console.error('Update sewing order error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/sewing-orders/:id  (its strips and learning curve go with it)
router.delete('/:id', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    await conn.execute(`DELETE FROM XX_OM_SEWING_ORDER_T WHERE ORDER_SETUP_ID = :id`, { id: req.params.id }, { autoCommit: true });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete sewing order error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/sewing-orders/combine - join orders into one production batch (one strip on the planning board).
// Orders must be in the same unit, not already joined, and not stripped yet.
router.post('/combine', async (req, res) => {
  const { ids, productionUnit, sewingStartDate, sewingEndDate } = req.body;
  if (!Array.isArray(ids) || ids.length < 2) return res.status(400).json({ message: 'Select at least two rows to combine' });

  let conn;
  try {
    conn = await getConnection();
    const list = inList(ids);
    const rows = (await conn.execute(
      `SELECT so.ORDER_SETUP_ID, so.UNIT, so.COMBINE_ID,
              (SELECT COUNT(*) FROM XX_OM_PLANNING_STRIP_T st WHERE st.ORDER_SETUP_ID = so.ORDER_SETUP_ID) AS STRIPS
         FROM XX_OM_SEWING_ORDER_T so WHERE so.ORDER_SETUP_ID IN (${list.sql})`,
      list.binds
    )).rows;
    if (rows.length !== ids.length) return res.status(404).json({ message: 'Some selected orders no longer exist; reload the list' });
    const joined = rows.filter((r) => r.COMBINE_ID);
    if (joined.length) return res.status(409).json({ message: `Order(s) ${joined.map((r) => r.ORDER_SETUP_ID).join(', ')} are already joined. De-combine them first.` });
    const stripped = rows.filter((r) => r.STRIPS > 0);
    if (stripped.length) return res.status(409).json({ message: `Order(s) ${stripped.map((r) => r.ORDER_SETUP_ID).join(', ')} already have strips. Delete those strips on the planning board first.` });
    const targetUnit = numOrNull(productionUnit);
    const units = [...new Set(rows.map((r) => (targetUnit !== null ? targetUnit : r.UNIT)))];
    if (units.length > 1 || units[0] === null) return res.status(400).json({ message: 'Joined orders must be in one stitching unit. Choose the Production Unit.' });

    const combineId = (await conn.execute(`SELECT XX_OM_COMBINE_S.NEXTVAL AS ID FROM DUAL`)).rows[0].ID;
    await conn.execute(
      `UPDATE XX_OM_SEWING_ORDER_T SET
         COMBINE_ID = :combineId,
         UNIT = NVL(:unit, UNIT), PRODUCTION_UNIT = NVL(TO_CHAR(:unit), PRODUCTION_UNIT),
         SEWING_START_DATE = NVL(TO_DATE(:startDate,'YYYY-MM-DD'), SEWING_START_DATE),
         SEWING_END_DATE = NVL(TO_DATE(:endDate,'YYYY-MM-DD'), SEWING_END_DATE),
         LAST_UPDATED_BY = :updatedBy, LAST_UPDATED_DATE = SYSDATE
       WHERE ORDER_SETUP_ID IN (${list.sql})`,
      { ...list.binds, combineId, unit: targetUnit, startDate: isoOrNull(sewingStartDate), endDate: isoOrNull(sewingEndDate), updatedBy: req.user.id },
      { autoCommit: true }
    );
    res.json({ combineId });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Combine error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/sewing-orders/decombine - un-join: the whole group of each selected order is released.
// Refused while the joined strip exists, because that one strip carries the qty of all joined orders.
router.post('/decombine', async (req, res) => {
  const { ids } = req.body;
  if (!Array.isArray(ids) || ids.length === 0) return res.status(400).json({ message: 'Select rows to de-combine' });

  let conn;
  try {
    conn = await getConnection();
    const list = inList(ids);
    const groups = (await conn.execute(
      `SELECT DISTINCT COMBINE_ID FROM XX_OM_SEWING_ORDER_T WHERE ORDER_SETUP_ID IN (${list.sql}) AND COMBINE_ID IS NOT NULL`,
      list.binds
    )).rows.map((r) => r.COMBINE_ID);
    if (!groups.length) return res.status(400).json({ message: 'The selected orders are not joined' });
    const g = inList(groups, 'g');
    const strips = (await conn.execute(
      `SELECT COUNT(*) AS N FROM XX_OM_PLANNING_STRIP_T st JOIN XX_OM_SEWING_ORDER_T so ON so.ORDER_SETUP_ID = st.ORDER_SETUP_ID
        WHERE so.COMBINE_ID IN (${g.sql})`,
      g.binds
    )).rows[0].N;
    if (strips > 0) {
      return res.status(409).json({ message: 'The joined orders already have a strip on the planning board. Delete that strip first, then de-combine.' });
    }
    const r = await conn.execute(`UPDATE XX_OM_SEWING_ORDER_T SET COMBINE_ID = NULL WHERE COMBINE_ID IN (${g.sql})`, g.binds, { autoCommit: true });
    res.json({ message: 'De-combined', released: r.rowsAffected, groups: groups.length });
  } catch (err) {
    console.error('De-combine error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
