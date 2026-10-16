const express = require('express');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();
router.use(requireAuth);

// Capacity Building: per unit and process, the capacity of one working day for a date range.
// CUTTING is unit-wise (no line); SEWING and FINISHING are line-wise.
// Hours = working hour x operators (MC/MP) x efficiency; minutes = hours x 60; pcs = minutes / SMV (computed in the table).

const PROCESSES = ['CUTTING', 'SEWING', 'FINISHING'];
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const canEdit = requireRole('ADMIN', 'PLANNER');
const pad2 = (n) => String(n).padStart(2, '0');

const SELECT = `
  SELECT CAPACITY_ID, UNIT, PROCESS, LINE_NO,
         TO_CHAR(START_DATE,'YYYY-MM-DD') AS START_DATE, TO_CHAR(END_DATE,'YYYY-MM-DD') AS END_DATE,
         WORKING_HOUR, OPERATOR_COUNT, EFFICIENCY, SMV, CAPACITY_HOURS, CAPACITY_MINUTES, CAPACITY_PCS, REMARKS
    FROM XX_OM_PROCESS_CAPACITY_T`;

// efficiency may be typed as 0.6 or 60 (%)
const normEff = (v) => {
  const n = Number(v);
  return n > 1.5 ? n / 100 : n;
};

const validate = (b, needLines) => {
  if (!PROCESSES.includes(b.process)) return 'Process must be Cutting, Sewing or Finishing';
  if (!b.unit) return 'Unit is required';
  if (!ISO.test(String(b.startDate || ''))) return 'Start Date is required';
  if (b.endDate && !ISO.test(String(b.endDate))) return 'End Date is not a valid date';
  if (b.endDate && b.endDate < b.startDate) return 'End Date must be on or after Start Date';
  const wh = Number(b.workingHour);
  if (b.workingHour === '' || !Number.isFinite(wh) || wh < 0 || wh > 24) return 'Working Hour must be between 0 and 24';
  const mp = Number(b.operatorCount);
  if (b.operatorCount === '' || !Number.isFinite(mp) || mp < 0) return 'MC / MP count must be 0 or more';
  const eff = normEff(b.efficiency);
  if (b.efficiency === '' || !Number.isFinite(eff) || eff <= 0 || eff > 1.5) return 'Efficiency must be between 0.01 and 1.5 (or 1-150 %)';
  if (b.smv !== '' && b.smv != null && (!Number.isFinite(Number(b.smv)) || Number(b.smv) <= 0)) return 'SMV must be a positive number of minutes';
  if (needLines && b.process !== 'CUTTING' && (!Array.isArray(b.lineNos) || !b.lineNos.length)) return 'Select at least one line';
  return null;
};

// another record of the same unit / process / line whose dates overlap [start, end]
const findOverlap = async (conn, { unit, process, lineNo, startDate, endDate, excludeId }) => {
  const r = await conn.execute(
    `SELECT LINE_NO, TO_CHAR(START_DATE,'YYYY-MM-DD') AS S, NVL(TO_CHAR(END_DATE,'YYYY-MM-DD'),'open') AS E
       FROM XX_OM_PROCESS_CAPACITY_T
      WHERE UNIT = :unit AND PROCESS = :process AND NVL(LINE_NO, -1) = NVL(:lineNo, -1) AND CAPACITY_ID <> :excludeId
        AND START_DATE <= NVL(TO_DATE(:endDate,'YYYY-MM-DD'), DATE '9999-12-31')
        AND NVL(END_DATE, DATE '9999-12-31') >= TO_DATE(:startDate,'YYYY-MM-DD')
      FETCH FIRST 1 ROW ONLY`,
    { unit: Number(unit), process, lineNo: lineNo ?? null, excludeId: excludeId ?? -1, startDate, endDate: endDate || null }
  );
  return r.rows[0] || null;
};
const overlapText = (process, o) =>
  `${process === 'CUTTING' ? 'The unit' : `Line ${o.LINE_NO}`} already has ${process.toLowerCase()} capacity from ${o.S} to ${o.E}. `
  + 'Give that record an End Date before this Start Date, or change the dates.';

// GET /api/process-capacity?unit=341&process=SEWING
router.get('/', async (req, res) => {
  const { unit, process } = req.query;
  if (!unit) return res.status(400).json({ message: 'unit is required' });
  let conn;
  try {
    conn = await getConnection();
    const where = ['UNIT = :unit'];
    const binds = { unit: Number(unit) };
    if (process) { where.push('PROCESS = :process'); binds.process = process; }
    const r = await conn.execute(`${SELECT} WHERE ${where.join(' AND ')} ORDER BY PROCESS, LINE_NO NULLS FIRST, START_DATE DESC`, binds);
    res.json(r.rows);
  } catch (err) {
    console.error('List process capacity error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// GET /api/process-capacity/daily?unit=341&process=SEWING&month=11&year=2026
// Capacity per day of the month (holidays from the Holiday Plan count as 0), per line or for the unit.
router.get('/daily', async (req, res) => {
  const { unit, process } = req.query;
  const month = Number(req.query.month);
  const year = Number(req.query.year);
  if (!unit || !PROCESSES.includes(process) || !month || !year) return res.status(400).json({ message: 'unit, process, month and year are required' });
  const daysInMonth = new Date(year, month, 0).getDate();
  const first = `${year}-${pad2(month)}-01`;
  const last = `${year}-${pad2(month)}-${pad2(daysInMonth)}`;
  let conn;
  try {
    conn = await getConnection();
    const recs = (await conn.execute(
      `${SELECT} WHERE UNIT = :unit AND PROCESS = :process
          AND START_DATE <= TO_DATE(:last,'YYYY-MM-DD') AND NVL(END_DATE, DATE '9999-12-31') >= TO_DATE(:first,'YYYY-MM-DD')
        ORDER BY CAPACITY_ID DESC`,
      { unit: Number(unit), process, first, last }
    )).rows;
    const hol = (await conn.execute(
      `SELECT TO_CHAR(l.CALENDAR_DATE,'YYYY-MM-DD') AS D, l.WORKING_STATUS, l.HOLIDAY_DESCRIPTION
         FROM XX_OM_HOLIDAY_L_T l JOIN XX_OM_HOLIDAY_H_T h ON h.HOLIDAY_PLAN_ID = l.HOLIDAY_PLAN_ID
        WHERE UPPER(h.OPERATION_UNIT) = UPPER(:u) AND h.PLAN_YEAR = :y AND h.PLAN_MONTH = :m`,
      { u: String(unit), y: year, m: month }
    )).rows;
    const holidays = Object.fromEntries(hol.filter((h) => h.WORKING_STATUS === 'Holiday').map((h) => [h.D, h.HOLIDAY_DESCRIPTION || 'Holiday']));
    const calendarDefined = hol.length > 0;

    let lines = [null];
    if (process !== 'CUTTING') {
      const setup = (await conn.execute(
        `SELECT NO_OF_LINE FROM XX_OM_LINE_H_T WHERE UNIT = :u AND EFF_START_DATE <= TO_DATE(:last,'YYYY-MM-DD')
          ORDER BY EFF_START_DATE DESC FETCH FIRST 1 ROW ONLY`, { u: Number(unit), last }
      )).rows;
      const fromSetup = process === 'SEWING' && setup.length ? Array.from({ length: Number(setup[0].NO_OF_LINE) }, (_, i) => i + 1) : [];
      lines = [...new Set([...fromSetup, ...recs.map((r) => r.LINE_NO)])].sort((a, b) => a - b);
    }

    const calendar = Array.from({ length: daysInMonth }, (_, i) => {
      const date = `${year}-${pad2(month)}-${pad2(i + 1)}`;
      return { day: i + 1, date, isHoliday: Boolean(holidays[date]), holidayName: holidays[date] || null };
    });
    const rows = lines.map((lineNo) => {
      const days = calendar.map((c) => {
        // most recently entered record covering the day wins
        const rec = recs.find((r) => (r.LINE_NO ?? null) === lineNo && r.START_DATE <= c.date && (!r.END_DATE || r.END_DATE >= c.date));
        if (!rec || c.isHoliday) return { date: c.date, minutes: rec ? 0 : null, pcs: rec ? 0 : null, hours: rec ? 0 : null };
        return { date: c.date, minutes: Number(rec.CAPACITY_MINUTES), pcs: rec.CAPACITY_PCS != null ? Number(rec.CAPACITY_PCS) : null, hours: Number(rec.CAPACITY_HOURS) };
      });
      const sum = (k) => days.reduce((t, d) => t + (d[k] || 0), 0);
      return { lineNo, days, totals: { minutes: Math.round(sum('minutes')), pcs: Math.round(sum('pcs')), hours: Math.round(sum('hours') * 100) / 100 } };
    });
    const dayTotals = calendar.map((c, i) => ({
      date: c.date,
      minutes: rows.reduce((t, r) => t + (r.days[i].minutes || 0), 0),
      pcs: rows.reduce((t, r) => t + (r.days[i].pcs || 0), 0),
    }));
    res.json({
      unit: Number(unit), process, month, year, calendarDefined, calendar, rows, dayTotals,
      workingDays: calendar.filter((c) => !c.isHoliday).length,
      totals: {
        minutes: rows.reduce((t, r) => t + r.totals.minutes, 0),
        pcs: rows.reduce((t, r) => t + r.totals.pcs, 0),
      },
    });
  } catch (err) {
    console.error('Daily process capacity error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/process-capacity { unit, process, lineNos[] (sewing / finishing), startDate, endDate, workingHour, operatorCount, efficiency, smv, remarks }
router.post('/', canEdit, async (req, res) => {
  const b = req.body;
  const invalid = validate(b, true);
  if (invalid) return res.status(400).json({ message: invalid });
  const lines = b.process === 'CUTTING' ? [null] : [...new Set(b.lineNos.map(Number))];
  let conn;
  try {
    conn = await getConnection();
    for (const lineNo of lines) {
      const o = await findOverlap(conn, { unit: b.unit, process: b.process, lineNo, startDate: b.startDate, endDate: b.endDate });
      if (o) return res.status(409).json({ message: overlapText(b.process, o) });
    }
    const ids = [];
    for (const lineNo of lines) {
      const r = await conn.execute(
        `INSERT INTO XX_OM_PROCESS_CAPACITY_T
           (CAPACITY_ID, UNIT, PROCESS, LINE_NO, START_DATE, END_DATE, WORKING_HOUR, OPERATOR_COUNT, EFFICIENCY, SMV, REMARKS, CREATED_BY, CREATION_DATE)
         VALUES (XX_OM_PROCESS_CAPACITY_S.NEXTVAL, :unit, :process, :lineNo, TO_DATE(:s,'YYYY-MM-DD'), TO_DATE(:e,'YYYY-MM-DD'),
                 :wh, :mp, :eff, :smv, :remarks, :userId, SYSDATE)
         RETURNING CAPACITY_ID INTO :outId`,
        {
          unit: Number(b.unit), process: b.process, lineNo, s: b.startDate, e: b.endDate || null,
          wh: Number(b.workingHour), mp: Number(b.operatorCount), eff: normEff(b.efficiency),
          smv: b.smv === '' || b.smv == null ? null : Number(b.smv), remarks: b.remarks || null, userId: req.user.id,
          outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
        },
        { autoCommit: false }
      );
      ids.push(r.outBinds.outId[0]);
    }
    await conn.commit();
    res.status(201).json({ ids });
  } catch (err) {
    if (conn) { try { await conn.rollback(); } catch (e) { console.error('Rollback error:', e); } }
    console.error('Create process capacity error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/process-capacity/:id
router.put('/:id', canEdit, async (req, res) => {
  const b = req.body;
  let conn;
  try {
    conn = await getConnection();
    const cur = (await conn.execute(`SELECT UNIT, PROCESS, LINE_NO FROM XX_OM_PROCESS_CAPACITY_T WHERE CAPACITY_ID = :id`, { id: req.params.id })).rows[0];
    if (!cur) return res.status(404).json({ message: 'Record not found' });
    const full = { ...b, unit: cur.UNIT, process: cur.PROCESS };
    const invalid = validate(full, false);
    if (invalid) return res.status(400).json({ message: invalid });
    const o = await findOverlap(conn, { unit: cur.UNIT, process: cur.PROCESS, lineNo: cur.LINE_NO, startDate: b.startDate, endDate: b.endDate, excludeId: Number(req.params.id) });
    if (o) return res.status(409).json({ message: overlapText(cur.PROCESS, o) });
    await conn.execute(
      `UPDATE XX_OM_PROCESS_CAPACITY_T SET START_DATE = TO_DATE(:s,'YYYY-MM-DD'), END_DATE = TO_DATE(:e,'YYYY-MM-DD'),
              WORKING_HOUR = :wh, OPERATOR_COUNT = :mp, EFFICIENCY = :eff, SMV = :smv, REMARKS = :remarks,
              LAST_UPDATED_BY = :userId, LAST_UPDATED_DATE = SYSDATE
        WHERE CAPACITY_ID = :id`,
      {
        s: b.startDate, e: b.endDate || null, wh: Number(b.workingHour), mp: Number(b.operatorCount), eff: normEff(b.efficiency),
        smv: b.smv === '' || b.smv == null ? null : Number(b.smv), remarks: b.remarks || null, userId: req.user.id, id: req.params.id,
      },
      { autoCommit: true }
    );
    const row = (await conn.execute(`${SELECT} WHERE CAPACITY_ID = :id`, { id: req.params.id })).rows[0];
    res.json({ message: 'Updated', row });
  } catch (err) {
    console.error('Update process capacity error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/process-capacity/:id
router.delete('/:id', canEdit, async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const r = await conn.execute(`DELETE FROM XX_OM_PROCESS_CAPACITY_T WHERE CAPACITY_ID = :id`, { id: req.params.id }, { autoCommit: true });
    if (!r.rowsAffected) return res.status(404).json({ message: 'Record not found' });
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete process capacity error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
