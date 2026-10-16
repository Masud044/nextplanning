import { useEffect, useMemo, useState } from 'react';
import './PocSearch.css';
import './PocForm.css';
import './CapacityBuilding.css';
import UnitSelect, { useUnits, unitLabel } from './UnitSelect';
import useRole from './useRole';

const API_URL = 'http://localhost:5000/api';
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` });

const PROCESSES = [
  { key: 'CUTTING', label: 'Cutting', scope: 'unit-wise', lineWise: false },
  { key: 'SEWING', label: 'Sewing', scope: 'line-wise', lineWise: true },
  { key: 'FINISHING', label: 'Finishing', scope: 'line-wise', lineWise: true },
];
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

const fmt = (n, d = 0) => (n == null || n === '' || !Number.isFinite(Number(n)) ? '—' : Number(n).toLocaleString(undefined, { maximumFractionDigits: d }));
const eff = (v) => { const n = Number(v); return n > 1.5 ? n / 100 : n; };
// same formulas as the database (virtual columns of XX_OM_PROCESS_CAPACITY_T)
const calc = (wh, mp, e, smv) => {
  const hours = Number(wh) * Number(mp) * eff(e);
  if (!Number.isFinite(hours)) return { hours: null, minutes: null, pcs: null };
  const minutes = hours * 60;
  return { hours, minutes, pcs: Number(smv) > 0 ? Math.floor(minutes / Number(smv)) : null };
};

const emptyForm = { startDate: '', endDate: '', workingHour: '', operatorCount: '', efficiency: '0.6', smv: '', remarks: '' };

// A 404 here means the backend process is older than this screen (it has no /process-capacity yet).
const OUTDATED = 'The server does not have Capacity Building yet: restart the backend (pm2 restart nexplanning-backend) and reload this page.';
const readJson = async (res) => {
  if (res.status === 404 && !(res.headers.get('content-type') || '').includes('json')) throw new Error(OUTDATED);
  return res.json();
};
const errText = (err) => (err && err.message === OUTDATED ? OUTDATED : 'Cannot reach server.');

export default function CapacityBuilding() {
  const [unit, setUnit] = useState('');
  const [process, setProcess] = useState('SEWING');
  const proc = PROCESSES.find((p) => p.key === process);
  const { units } = useUnits();
  const unitText = unitLabel(units.find((u) => String(u.UNIT_ID) === String(unit))) || unit;
  const { canPlan } = useRole();

  const [rows, setRows] = useState([]);
  const [form, setForm] = useState(emptyForm);
  const [lineCount, setLineCount] = useState(0);
  const [lines, setLines] = useState(new Set());
  const [lineFilter, setLineFilter] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [show, setShow] = useState('pcs'); // 'pcs' | 'minutes'
  const [daily, setDaily] = useState(null);

  const loadRows = async () => {
    if (!unit) return;
    setError('');
    try {
      const res = await fetch(`${API_URL}/process-capacity?unit=${unit}&process=${process}`, { headers: authHeaders() });
      const data = await readJson(res);
      if (!res.ok) { setError(data.message || 'Failed to load'); return; }
      setRows(data.map((r) => ({ ...r, _dirty: false })));
    } catch (err) {
      setError(errText(err));
    }
  };
  const loadDaily = async () => {
    if (!unit) return;
    try {
      const res = await fetch(`${API_URL}/process-capacity/daily?unit=${unit}&process=${process}&month=${month}&year=${year}`, { headers: authHeaders() });
      const data = await readJson(res);
      setDaily(res.ok ? data : null);
    } catch (err) {
      setDaily(null);
    }
  };

  // line choices: sewing lines from Line Master, finishing lines from its records (at least 3)
  const loadLineCount = async () => {
    if (!unit || !proc.lineWise) { setLineCount(0); return; }
    if (process === 'SEWING') {
      try {
        const res = await fetch(`${API_URL}/line-setup?unit=${unit}`, { headers: authHeaders() });
        const data = await readJson(res);
        const latest = (Array.isArray(data) ? data : []).sort((a, b) => (b.EFF_START_DATE || '').localeCompare(a.EFF_START_DATE || ''))[0];
        setLineCount(latest ? Number(latest.NO_OF_LINE) || 0 : 0);
      } catch (err) {
        setLineCount(0);
      }
    }
  };

  useEffect(() => { loadRows(); loadLineCount(); setLines(new Set()); setLineFilter(''); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [unit, process]);
  useEffect(() => { loadDaily(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [unit, process, month, year]);

  const maxRecordLine = rows.reduce((m, r) => Math.max(m, Number(r.LINE_NO) || 0), 0);
  const lineChoices = proc.lineWise
    ? Array.from({ length: Math.max(process === 'SEWING' ? lineCount : 3, maxRecordLine) }, (_, i) => i + 1)
    : [];
  const preview = calc(form.workingHour, form.operatorCount, form.efficiency, form.smv);

  const toggleLine = (n) => setLines((prev) => { const s = new Set(prev); if (s.has(n)) s.delete(n); else s.add(n); return s; });
  const allLines = lineChoices.length > 0 && lineChoices.every((n) => lines.has(n));

  const addRecord = async (e) => {
    e.preventDefault();
    setError(''); setMessage('');
    try {
      const res = await fetch(`${API_URL}/process-capacity`, {
        method: 'POST', headers: authHeaders(),
        body: JSON.stringify({ ...form, unit, process, lineNos: [...lines] }),
      });
      const data = await readJson(res);
      if (!res.ok) { setError(data.message || 'Save failed'); return; }
      setMessage(`${proc.label} capacity added${proc.lineWise ? ` for line(s) ${[...lines].sort((a, b) => a - b).join(', ')}` : ` for ${unitText}`}: `
        + `${fmt(preview.hours, 2)} h = ${fmt(preview.minutes)} min${preview.pcs != null ? ` = ${fmt(preview.pcs)} pcs` : ''} per day.`);
      setForm(emptyForm);
      setLines(new Set());
      loadRows();
      loadDaily();
    } catch (err) {
      setError(errText(err));
    }
  };

  const updateRow = (id, field, value) => setRows((prev) => prev.map((r) => (r.CAPACITY_ID === id ? { ...r, [field]: value, _dirty: true } : r)));
  const saveRow = async (r) => {
    setError(''); setMessage('');
    try {
      const res = await fetch(`${API_URL}/process-capacity/${r.CAPACITY_ID}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({
          startDate: r.START_DATE, endDate: r.END_DATE || '', workingHour: r.WORKING_HOUR, operatorCount: r.OPERATOR_COUNT,
          efficiency: r.EFFICIENCY, smv: r.SMV ?? '', remarks: r.REMARKS || '',
        }),
      });
      const data = await readJson(res);
      if (!res.ok) { setError(data.message || 'Save failed'); return; }
      setRows((prev) => prev.map((x) => (x.CAPACITY_ID === r.CAPACITY_ID ? { ...data.row, _dirty: false } : x)));
      setMessage('Saved.');
      loadDaily();
    } catch (err) {
      setError(errText(err));
    }
  };
  const deleteRow = async (r) => {
    setError(''); setMessage('');
    try {
      const res = await fetch(`${API_URL}/process-capacity/${r.CAPACITY_ID}`, { method: 'DELETE', headers: authHeaders() });
      const data = await readJson(res);
      if (!res.ok) { setError(data.message || 'Delete failed'); return; }
      setRows((prev) => prev.filter((x) => x.CAPACITY_ID !== r.CAPACITY_ID));
      setMessage('Deleted.');
      loadDaily();
    } catch (err) {
      setError(errText(err));
    }
  };

  const shownRows = useMemo(
    () => rows.filter((r) => !lineFilter || String(r.LINE_NO) === lineFilter),
    [rows, lineFilter]
  );
  const today = new Date().toISOString().slice(0, 10);
  const isCurrent = (r) => r.START_DATE <= today && (!r.END_DATE || r.END_DATE >= today);

  const changeMonth = (d) => {
    let m = month + d;
    let y = year;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMonth(m); setYear(y);
  };

  return (
    <div className="poc-search cb-page">
      <div className="cb-header">
        <div className="cb-title">
          <h2>Capacity Building</h2>
          <div className="field">
            <label>Unit</label>
            <UnitSelect value={unit} onChange={setUnit} />
          </div>
        </div>
        <div className="cb-tabs" role="tablist" aria-label="Process">
          {PROCESSES.map((p) => (
            <button key={p.key} type="button" role="tab" aria-selected={process === p.key} onClick={() => setProcess(p.key)}>
              {p.label} <span>{p.scope}</span>
            </button>
          ))}
        </div>
      </div>

      <p className="cb-formula">
        Capacity (Hour) = Working Hour × MC/MP × Efficiency · Capacity (Minutes) = Hour × 60 · Capacity (Pcs) = Minutes ÷ SMV.
        Example: 22 h × 30 × 0.6 = 396 h = 23,760 min a day; at SMV 1.8 = 13,200 pcs.
      </p>

      {error && <div className="search-error">{error}</div>}
      {message && <div className="poc-success">{message}</div>}

      {canPlan && (
        <form className="cb-form" onSubmit={addRecord}>
          <div className="cb-form-fields">
            <div className="field"><label>Start Date</label><input type="date" required value={form.startDate} onChange={(e) => setForm((f) => ({ ...f, startDate: e.target.value }))} /></div>
            <div className="field"><label>End Date <span className="cb-hint">(empty = open)</span></label><input type="date" value={form.endDate} onChange={(e) => setForm((f) => ({ ...f, endDate: e.target.value }))} /></div>
            <div className="field"><label>Working Hour</label><input type="number" min="0" max="24" step="0.5" required value={form.workingHour} onChange={(e) => setForm((f) => ({ ...f, workingHour: e.target.value }))} /></div>
            <div className="field"><label>{process === 'CUTTING' ? 'MC / MP (cutters)' : 'Machine / Operator count'}</label><input type="number" min="0" required value={form.operatorCount} onChange={(e) => setForm((f) => ({ ...f, operatorCount: e.target.value }))} /></div>
            <div className="field"><label>Efficiency <span className="cb-hint">(0.6 or 60)</span></label><input type="number" min="0.01" max="150" step="0.01" required value={form.efficiency} onChange={(e) => setForm((f) => ({ ...f, efficiency: e.target.value }))} /></div>
            <div className="field"><label>SMV <span className="cb-hint">(min / pc)</span></label><input type="number" min="0.01" step="0.01" value={form.smv} onChange={(e) => setForm((f) => ({ ...f, smv: e.target.value }))} /></div>
            <div className="field cb-wide"><label>Remarks</label><input maxLength={200} value={form.remarks} onChange={(e) => setForm((f) => ({ ...f, remarks: e.target.value }))} /></div>
          </div>
          {proc.lineWise && (
            <div className="cb-lines">
              <span className="cb-lines-label">{proc.label} lines</span>
              <label><input type="checkbox" checked={allLines} onChange={() => setLines(allLines ? new Set() : new Set(lineChoices))} /> All</label>
              {lineChoices.map((n) => (
                <label key={n}><input type="checkbox" checked={lines.has(n)} onChange={() => toggleLine(n)} /> {n}</label>
              ))}
              {process === 'FINISHING' && (
                <button type="button" className="edit-btn" onClick={() => toggleLine(lineChoices.length + 1)} title="Add the next finishing line number">+ line {lineChoices.length + 1}</button>
              )}
              {lineChoices.length === 0 && <span className="cb-hint">No lines defined for this unit in Line Master</span>}
            </div>
          )}
          <div className="cb-form-actions">
            <span className="cb-preview">
              Per day{proc.lineWise ? ' per line' : ''}: <b>{fmt(preview.hours, 2)}</b> h · <b>{fmt(preview.minutes)}</b> min · <b>{fmt(preview.pcs)}</b> pcs
              {Number(form.smv) > 60 && (
                <span className="cb-warn"> · SMV is minutes per piece: {form.smv} min looks too high. If it is seconds, enter {fmt(Number(form.smv) / 60, 2)}.</span>
              )}
            </span>
            <button type="submit" className="save-btn" disabled={!unit || (proc.lineWise && lines.size === 0)}>
              Add {proc.label} capacity
            </button>
          </div>
        </form>
      )}

      <div className="table-scroll">
        <table className="search-table cb-table">
          <thead>
            {proc.lineWise && (
              <tr className="cb-filter-row">
                <th>
                  <select value={lineFilter} onChange={(e) => setLineFilter(e.target.value)} aria-label="Filter line">
                    <option value="">All lines</option>
                    {[...new Set(rows.map((r) => r.LINE_NO))].sort((a, b) => a - b).map((n) => <option key={n} value={n}>Line {n}</option>)}
                  </select>
                </th>
                <th colSpan={12}></th>
              </tr>
            )}
            <tr>
              {proc.lineWise && <th>Line</th>}
              <th>Start Date</th>
              <th>End Date</th>
              <th>Working Hour</th>
              <th>{process === 'CUTTING' ? 'MC / MP' : 'Machine Operator Count'}</th>
              <th>Efficiency</th>
              <th>SMV</th>
              <th className="cb-num">Capacity (Hour)</th>
              <th className="cb-num">Capacity (Minutes)</th>
              <th className="cb-num">Capacity (Pcs)</th>
              <th>Remarks</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {shownRows.map((r) => {
              const c = r._dirty ? calc(r.WORKING_HOUR, r.OPERATOR_COUNT, r.EFFICIENCY, r.SMV) : { hours: r.CAPACITY_HOURS, minutes: r.CAPACITY_MINUTES, pcs: r.CAPACITY_PCS };
              return (
                <tr key={r.CAPACITY_ID} className={[isCurrent(r) ? 'cb-current' : '', r._dirty ? 'cb-dirty' : ''].filter(Boolean).join(' ')}>
                  {proc.lineWise && <td><b>{r.LINE_NO}</b></td>}
                  <td><input type="date" disabled={!canPlan} value={r.START_DATE || ''} onChange={(e) => updateRow(r.CAPACITY_ID, 'START_DATE', e.target.value)} /></td>
                  <td><input type="date" disabled={!canPlan} value={r.END_DATE || ''} onChange={(e) => updateRow(r.CAPACITY_ID, 'END_DATE', e.target.value)} /></td>
                  <td><input type="number" disabled={!canPlan} className="cb-sm" value={r.WORKING_HOUR ?? ''} onChange={(e) => updateRow(r.CAPACITY_ID, 'WORKING_HOUR', e.target.value)} /></td>
                  <td><input type="number" disabled={!canPlan} className="cb-sm" value={r.OPERATOR_COUNT ?? ''} onChange={(e) => updateRow(r.CAPACITY_ID, 'OPERATOR_COUNT', e.target.value)} /></td>
                  <td><input type="number" disabled={!canPlan} className="cb-sm" step="0.01" value={r.EFFICIENCY ?? ''} onChange={(e) => updateRow(r.CAPACITY_ID, 'EFFICIENCY', e.target.value)} /></td>
                  <td><input type="number" disabled={!canPlan} className="cb-sm" step="0.01" value={r.SMV ?? ''} onChange={(e) => updateRow(r.CAPACITY_ID, 'SMV', e.target.value)} /></td>
                  <td className="cb-num">{fmt(c.hours, 2)}</td>
                  <td className="cb-num"><b>{fmt(c.minutes)}</b></td>
                  <td className="cb-num">{fmt(c.pcs)}</td>
                  <td><input disabled={!canPlan} className="cb-remarks" value={r.REMARKS || ''} onChange={(e) => updateRow(r.CAPACITY_ID, 'REMARKS', e.target.value)} /></td>
                  <td className="cb-actions">
                    {isCurrent(r) && <span className="cb-badge">current</span>}
                    {canPlan && <button type="button" className="edit-btn" onClick={() => saveRow(r)} disabled={!r._dirty}>Save</button>}
                    {canPlan && <button type="button" className="remove-btn" onClick={() => deleteRow(r)} aria-label="Delete record">&times;</button>}
                  </td>
                </tr>
              );
            })}
            {shownRows.length === 0 && (
              <tr><td colSpan={13} className="no-results">No {proc.label.toLowerCase()} capacity defined for {unitText || 'this unit'} yet</td></tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="cb-daily">
        <div className="cb-daily-head">
          <h3>Daily {proc.label} capacity – {MONTHS[month - 1]} {year}</h3>
          <div className="cb-daily-controls">
            <button type="button" className="edit-btn" onClick={() => changeMonth(-1)} aria-label="Previous month">‹</button>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} aria-label="Month">
              {MONTHS.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} style={{ width: 80 }} aria-label="Year" />
            <button type="button" className="edit-btn" onClick={() => changeMonth(1)} aria-label="Next month">›</button>
            <div className="cb-toggle" role="group" aria-label="Show">
              <button type="button" aria-pressed={show === 'pcs'} onClick={() => setShow('pcs')}>Pcs</button>
              <button type="button" aria-pressed={show === 'minutes'} onClick={() => setShow('minutes')}>Minutes</button>
            </div>
          </div>
        </div>
        {daily && !daily.calendarDefined && (
          <div className="search-error">No Holiday Plan for {MONTHS[month - 1]} {year}: every day is counted as a working day.</div>
        )}
        {daily && (
          <>
            <p className="cb-summary">
              {daily.workingDays} working days · month total <b>{fmt(show === 'pcs' ? daily.totals.pcs : daily.totals.minutes)}</b> {show === 'pcs' ? 'pcs' : 'min'}
              {proc.lineWise ? ` over ${daily.rows.length} line(s)` : ''}
            </p>
            <div className="table-scroll">
              <table className="cb-matrix">
                <thead>
                  <tr>
                    <th className="cb-sticky">{proc.lineWise ? 'Line' : 'Unit'}</th>
                    {daily.calendar.map((c) => (
                      <th key={c.day} className={c.isHoliday ? 'cb-hol' : ''} title={c.holidayName || ''}>{c.day}</th>
                    ))}
                    <th className="cb-total">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.rows.map((r) => (
                    <tr key={r.lineNo ?? 'unit'}>
                      <td className="cb-sticky"><b>{proc.lineWise ? `Line ${r.lineNo}` : unitText}</b></td>
                      {r.days.map((d, i) => (
                        <td key={d.date} className={daily.calendar[i].isHoliday ? 'cb-hol' : d[show] == null ? 'cb-none' : ''}>
                          {daily.calendar[i].isHoliday ? '' : fmt(d[show])}
                        </td>
                      ))}
                      <td className="cb-total">{fmt(show === 'pcs' ? r.totals.pcs : r.totals.minutes)}</td>
                    </tr>
                  ))}
                </tbody>
                {proc.lineWise && daily.rows.length > 1 && (
                  <tfoot>
                    <tr>
                      <td className="cb-sticky">Total</td>
                      {daily.dayTotals.map((d, i) => <td key={d.date} className={daily.calendar[i].isHoliday ? 'cb-hol' : ''}>{daily.calendar[i].isHoliday ? '' : fmt(d[show])}</td>)}
                      <td className="cb-total">{fmt(show === 'pcs' ? daily.totals.pcs : daily.totals.minutes)}</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
            <p className="cb-legend"><i className="cb-hol-chip" /> holiday (no capacity) · <i className="cb-none-chip" /> no capacity record for that day</p>
          </>
        )}
      </div>
    </div>
  );
}
