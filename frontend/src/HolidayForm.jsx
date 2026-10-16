import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './HolidayForm.css';
import UnitSelect from './UnitSelect';
import useRole from './useRole';

const API_URL = 'http://localhost:5000/api';
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];
const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// Used until the holiday types load (or if the server is older); codes match XX_OM_HOLIDAY_TYPE_T.
const FALLBACK_TYPES = [
  { TYPE_CODE: 'WORKING', TYPE_NAME: 'Working Day', IS_WORKING: 'Y' },
  { TYPE_CODE: 'WEEKLY', TYPE_NAME: 'Weekly Holiday', IS_WORKING: 'N' },
  { TYPE_CODE: 'GENERAL', TYPE_NAME: 'General Holiday', IS_WORKING: 'N' },
];

const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` });
const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');
const fmtDate = (iso) => new Date(`${iso}T00:00:00`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });

function generateDays(month, year, weeklyHolidayDay, weeklyName = 'Weekly Holiday') {
  const days = [];
  const daysInMonth = new Date(year, month, 0).getDate();
  for (let d = 1; d <= daysInMonth; d++) {
    const date = new Date(year, month - 1, d);
    const dayName = WEEKDAYS[date.getDay()];
    const isWeekly = dayName === weeklyHolidayDay;
    days.push({
      calendarDate: `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`,
      dayName,
      holidayType: isWeekly ? 'WEEKLY' : 'WORKING',
      description: isWeekly ? weeklyName : '',
    });
  }
  return days;
}

export default function HolidayForm() {
  const { id } = useParams();
  const navigate = useNavigate();
  const isEdit = Boolean(id);
  const { canPlan, loaded: roleLoaded, role } = useRole();
  const readOnly = roleLoaded && !canPlan;

  const now = new Date();
  const [operationUnit, setOperationUnit] = useState('');
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [weeklyHolidayDay, setWeeklyHolidayDay] = useState('Friday');
  const [lines, setLines] = useState([]);
  const [types, setTypes] = useState(FALLBACK_TYPES);
  const [statusFilter, setStatusFilter] = useState('');
  const [descFilter, setDescFilter] = useState('');
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(isEdit);

  const typeMap = useMemo(() => Object.fromEntries(types.map((t) => [t.TYPE_CODE, t])), [types]);
  const isHolidayType = (code) => (typeMap[code] ? typeMap[code].IS_WORKING !== 'Y' : code !== 'WORKING');
  const typeName = (code) => typeMap[code]?.TYPE_NAME || code;

  useEffect(() => {
    fetch(`${API_URL}/holiday/types`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((rows) => { if (Array.isArray(rows) && rows.length) setTypes(rows); })
      .catch(() => {});
  }, []);

  // Create mode: Month / Year build a fresh calendar.
  useEffect(() => {
    if (isEdit) return;
    setLines(generateDays(month, year, weeklyHolidayDay, typeName('WEEKLY')));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isEdit, month, year]);

  useEffect(() => {
    if (!isEdit) return;
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const res = await fetch(`${API_URL}/holiday/${id}`, { headers: authHeaders() });
        const data = await res.json();
        if (!res.ok) { setError(data.message || 'Failed to load plan'); return; }
        setOperationUnit(data.header.OPERATION_UNIT);
        setMonth(data.header.PLAN_MONTH);
        setYear(data.header.PLAN_YEAR);
        setWeeklyHolidayDay(data.header.WEEKLY_HOLIDAY_DAY);
        setLines(data.lines.map((l) => ({
          calendarDate: toDateInput(l.CALENDAR_DATE),
          dayName: l.DAY_NAME,
          holidayType: l.HOLIDAY_TYPE || (l.WORKING_STATUS === 'Holiday' ? 'GENERAL' : 'WORKING'),
          description: l.HOLIDAY_DESCRIPTION || '',
        })));
      } catch (err) {
        setError('Cannot reach server.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id, isEdit]);

  // Weekly Holiday: re-mark only the weekly days; other holidays already set (Eid, Victory Day, ...) are kept.
  const changeWeekly = (newDay) => {
    const oldDay = weeklyHolidayDay;
    setWeeklyHolidayDay(newDay);
    setLines((prev) => prev.map((l) => {
      if (l.dayName === oldDay && l.holidayType === 'WEEKLY') return { ...l, holidayType: 'WORKING', description: '' };
      if (l.dayName === newDay && l.holidayType === 'WORKING') return { ...l, holidayType: 'WEEKLY', description: typeName('WEEKLY') };
      return l;
    }));
  };

  const regenerate = () => {
    setLines(generateDays(month, year, weeklyHolidayDay, typeName('WEEKLY')));
    setMessage('Calendar rebuilt from Month / Year / Weekly Holiday. Other holidays were cleared.');
  };

  // Changing a day's type keeps a custom description; a description that was just the old type name follows the new type.
  const setDayType = (date, code) => {
    setLines((prev) => prev.map((l) => {
      if (l.calendarDate !== date) return l;
      const autoDesc = !l.description || l.description === typeName(l.holidayType);
      return { ...l, holidayType: code, description: autoDesc ? (isHolidayType(code) ? typeName(code) : '') : l.description };
    }));
  };
  const setDayDesc = (date, value) => setLines((prev) => prev.map((l) => (l.calendarDate === date ? { ...l, description: value } : l)));

  const totals = {
    totalDays: lines.length,
    holidaysCount: lines.filter((l) => isHolidayType(l.holidayType)).length,
  };
  totals.workingDays = totals.totalDays - totals.holidaysCount;
  const byType = types
    .map((t) => ({ ...t, n: lines.filter((l) => l.holidayType === t.TYPE_CODE).length }))
    .filter((t) => t.n > 0);

  const shown = lines.filter((l) => {
    if (statusFilter === '__WORK' && isHolidayType(l.holidayType)) return false;
    if (statusFilter === '__HOL' && !isHolidayType(l.holidayType)) return false;
    if (statusFilter && !statusFilter.startsWith('__') && l.holidayType !== statusFilter) return false;
    if (descFilter && !(l.description || '').toLowerCase().includes(descFilter.toLowerCase())) return false;
    return true;
  });

  const handleSave = async (e) => {
    e.preventDefault();
    if (readOnly) return;
    setError('');
    setMessage('');
    setSaving(true);
    try {
      const header = { operationUnit, planMonth: Number(month), planYear: Number(year), weeklyHolidayDay };
      const res = await fetch(isEdit ? `${API_URL}/holiday/${id}` : `${API_URL}/holiday`, {
        method: isEdit ? 'PUT' : 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          header,
          lines: lines.map((l) => ({
            ...l,
            workingStatus: isHolidayType(l.holidayType) ? 'Holiday' : 'Workingday', // for older servers
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Save failed'); return; }
      if (!isEdit) navigate(`/holiday/${data.planId}/edit`);
      else setMessage(`Saved: ${data.workingDays} working days, ${data.holidaysCount} holidays.`);
    } catch (err) {
      setError('Cannot reach server.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="holiday-form">Loading...</div>;

  const workingTypes = types.filter((t) => t.IS_WORKING === 'Y');
  const holidayTypes = types.filter((t) => t.IS_WORKING !== 'Y');
  const TypeOptions = () => (
    <>
      <optgroup label="Working">
        {workingTypes.map((t) => <option key={t.TYPE_CODE} value={t.TYPE_CODE}>{t.TYPE_NAME}</option>)}
      </optgroup>
      <optgroup label="Holiday">
        {holidayTypes.map((t) => <option key={t.TYPE_CODE} value={t.TYPE_CODE}>{t.TYPE_NAME}</option>)}
      </optgroup>
    </>
  );

  return (
    <form className="holiday-form" onSubmit={handleSave}>
      <div className="holiday-topbar">
        <div className="holiday-topbar-left">
          <div className="field">
            <label>Operation Unit</label>
            <UnitSelect value={operationUnit} onChange={setOperationUnit} autoDefault={!isEdit} disabled={isEdit || readOnly} required />
          </div>
          <div className="field">
            <label>Month</label>
            <select value={month} onChange={(e) => setMonth(Number(e.target.value))} disabled={isEdit || readOnly}>
              {MONTH_NAMES.map((m, i) => <option key={m} value={i + 1}>{m}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Year</label>
            <input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} disabled={isEdit || readOnly} />
          </div>
          <div className="field">
            <label>Weekly Holiday</label>
            <select value={weeklyHolidayDay} onChange={(e) => changeWeekly(e.target.value)} disabled={readOnly}>
              {WEEKDAYS.map((d) => <option key={d} value={d}>{d}</option>)}
            </select>
          </div>
          {!readOnly && (
            <button type="button" className="regen-btn" onClick={regenerate} title="Rebuild the calendar; clears holidays other than the weekly one">
              {isEdit ? 'Regenerate Grid' : 'Generate'}
            </button>
          )}
        </div>

        <h1 className="holiday-title">Holiday Planning</h1>

        <div className="holiday-stats">
          <div><span>Total Days</span><strong>{totals.totalDays}</strong></div>
          <div><span>Working Days</span><strong>{totals.workingDays}</strong></div>
          <div><span>Holidays</span><strong>{totals.holidaysCount}</strong></div>
          {!readOnly && (
            <button type="submit" className="save-btn" disabled={saving || !operationUnit}>
              {saving ? 'Saving...' : 'Save'}
            </button>
          )}
        </div>
      </div>

      {readOnly && (
        <div className="holiday-readonly" role="status">
          View only. Holiday plans are maintained by planners (your role: {role || 'USER'}).
        </div>
      )}
      {error && <div className="poc-error">{error}</div>}
      {message && <div className="poc-success">{message}</div>}

      <div className="holiday-body">
        <div className="table-scroll">
          <table className="holiday-table">
            <thead>
              <tr className="holiday-filter-row">
                <th colSpan={2}>{shown.length !== lines.length ? `${shown.length} of ${lines.length} days` : ''}</th>
                <th>
                  <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} aria-label="Filter by working status">
                    <option value="">All days</option>
                    <option value="__WORK">Working days</option>
                    <option value="__HOL">Holidays</option>
                    <TypeOptions />
                  </select>
                </th>
                <th>
                  <input value={descFilter} onChange={(e) => setDescFilter(e.target.value)} placeholder="Filter description…" aria-label="Filter by holiday description" />
                </th>
              </tr>
              <tr>
                <th>Day</th>
                <th>Date</th>
                <th>Working Status</th>
                <th>Holiday Description</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((line) => {
                const hol = isHolidayType(line.holidayType);
                return (
                  <tr key={line.calendarDate} className={hol ? `holiday-row holiday-row-${line.holidayType.toLowerCase()}` : ''}>
                    <td>{line.dayName}</td>
                    <td>{fmtDate(line.calendarDate)}</td>
                    <td>
                      <select value={line.holidayType} onChange={(e) => setDayType(line.calendarDate, e.target.value)} disabled={readOnly}>
                        {!typeMap[line.holidayType] && <option value={line.holidayType}>{line.holidayType}</option>}
                        <TypeOptions />
                      </select>
                    </td>
                    <td>
                      <input
                        value={line.description}
                        onChange={(e) => setDayDesc(line.calendarDate, e.target.value)}
                        placeholder={hol ? 'e.g. Eid-ul-Fitr, Victory Day' : ''}
                        maxLength={400}
                        disabled={readOnly}
                      />
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && <tr><td colSpan={4} className="no-results">No day matches the filter</td></tr>}
            </tbody>
          </table>
        </div>

        <aside className="holiday-side">
          <h3>This month</h3>
          <ul className="holiday-counts">
            {byType.map((t) => (
              <li key={t.TYPE_CODE} className={t.IS_WORKING === 'Y' ? 'is-working' : 'is-holiday'}>
                <span>{t.TYPE_NAME}</span><b>{t.n}</b>
              </li>
            ))}
          </ul>
          <h3>Rules</h3>
          <ul className="holiday-rules">
            <li>Quantity is allocated only on working days.</li>
            <li>Working days must be defined before any quantity is planned in this month.</li>
            <li>These days apply to every stitching line of the unit.</li>
            <li>The calendar is shared by all planning screens (planning board, line capacity).</li>
            <li>A holiday plan belongs to a single operation unit.</li>
            <li>Only planners can change it; other users see it as a report.</li>
          </ul>
        </aside>
      </div>
    </form>
  );
}
