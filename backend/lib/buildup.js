// Build-up (learning curve) of sewing orders.
// An order with LEARNING_CURVE_FLAG = 'Y' ramps up over its first days on a line:
//   - its own rows in XX_OM_LEARNING_CURVE_T (hourly productivity per day) when present,
//   - otherwise the unit's Default Learning Curve (XX_OM_DEFAULT_LC_T, % of the order productivity per day).
// After the curve's last day the order runs at its full productivity.

async function getSetting(conn, unit, key, fallback) {
  try {
    const r = await conn.execute(
      `SELECT SETTING_VALUE FROM XX_OM_PLANNING_SETTING_T WHERE SETTING_KEY = :k AND UNIT_ID IN (0, :u) ORDER BY UNIT_ID DESC FETCH FIRST 1 ROW ONLY`,
      { k: key, u: Number(unit) }
    );
    return r.rows.length ? r.rows[0].SETTING_VALUE : fallback;
  } catch (e) {
    return fallback;
  }
}

// [{ day, pct }] for the unit (its own rows, else unit 0)
async function getDefaultCurve(conn, unit) {
  try {
    const r = await conn.execute(
      `SELECT UNIT_ID, DAY_NO, PRODUCTIVITY_PCT FROM XX_OM_DEFAULT_LC_T WHERE UNIT_ID IN (0, :u) ORDER BY UNIT_ID DESC, DAY_NO`,
      { u: Number(unit) }
    );
    const own = r.rows.filter((x) => x.UNIT_ID === Number(unit));
    const rows = own.length ? own : r.rows.filter((x) => x.UNIT_ID === 0);
    return rows.map((x) => ({ day: x.DAY_NO, pct: Number(x.PRODUCTIVITY_PCT) }));
  } catch (e) {
    return [];
  }
}

// Returns { defaultCurve, defaultRequired, curveFor(order) } where order = { ORDER_SETUP_ID, LEARNING_CURVE_FLAG, PRODUCTIVITY }
// and curveFor gives the hourly productivity of each build-up day ([] = no build-up).
async function loadBuildUps(conn, unit) {
  const defaultCurve = await getDefaultCurve(conn, unit);
  const defaultRequired = (await getSetting(conn, unit, 'LC_DEFAULT_REQUIRED', 'N')) === 'Y';
  const rows = (await conn.execute(
    `SELECT lc.ORDER_SETUP_ID, lc.DAY_NO, lc.HOURLY_PRODUCTIVITY
       FROM XX_OM_LEARNING_CURVE_T lc JOIN XX_OM_SEWING_ORDER_T so ON so.ORDER_SETUP_ID = lc.ORDER_SETUP_ID
      WHERE so.UNIT = :u AND lc.HOURLY_PRODUCTIVITY IS NOT NULL ORDER BY lc.ORDER_SETUP_ID, lc.DAY_NO`,
    { u: Number(unit) }
  )).rows;
  const own = {};
  rows.forEach((r) => { (own[r.ORDER_SETUP_ID] ||= [])[r.DAY_NO - 1] = Number(r.HOURLY_PRODUCTIVITY); });

  const curveFor = (o) => {
    if (!o || o.LEARNING_CURVE_FLAG !== 'Y') return [];
    const mine = own[o.ORDER_SETUP_ID];
    if (mine && mine.length) {
      // gaps in the order's own rows run at full productivity
      return Array.from({ length: mine.length }, (_, i) => (mine[i] != null ? mine[i] : Number(o.PRODUCTIVITY) || 0));
    }
    const p = Number(o.PRODUCTIVITY) || 0;
    return defaultCurve.map((d) => Math.round((p * d.pct) / 100));
  };
  return { defaultCurve, defaultRequired, curveFor };
}

module.exports = { loadBuildUps, getDefaultCurve, getSetting };
