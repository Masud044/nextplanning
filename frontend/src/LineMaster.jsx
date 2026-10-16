import { useEffect, useState } from 'react';
import './PocSearch.css';
import './PocForm.css';
import './LineMaster.css';
import UnitSelect from './UnitSelect';

const API_URL = 'http://localhost:5000/api';

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const emptySetupRow = () => ({
  _key: `new-${Date.now()}-${Math.random()}`,
  LINE_SETUP_ID: null,
  UNIT: '',
  NO_OF_LINE: '',
  EFF_START_DATE: '',
  EFF_END_DATE: '',
  _dirty: true,
});

export default function LineMaster() {
  // ---- No Of Lines panel ----
  const [setupRows, setSetupRows] = useState([]);
  const [selectedSetupKeys, setSelectedSetupKeys] = useState(new Set());
  const [setupError, setSetupError] = useState('');
  const [setupMessage, setSetupMessage] = useState('');

  // ---- Working Hour / Manpower panel ----
  const [selectedUnit, setSelectedUnit] = useState('');
  const [capacityForm, setCapacityForm] = useState({
    workingHour: 8,
    manpower: '',
    startDate: '',
    endDate: '',
  });
  const [selectedLines, setSelectedLines] = useState(new Set());
  const [allLines, setAllLines] = useState(false);
  const [capacityRows, setCapacityRows] = useState([]);
  const [capError, setCapError] = useState('');
  const [capMessage, setCapMessage] = useState('');

  // ---- Monthwise panel ----
  const now = new Date();
  const [mwMonth, setMwMonth] = useState(now.getMonth() + 1);
  const [mwYear, setMwYear] = useState(now.getFullYear());
  const [mwTab, setMwTab] = useState('workingHour'); // 'workingHour' | 'manpower'
  const [mwLines, setMwLines] = useState([]);
  const [mwError, setMwError] = useState('');
  // the unit's holiday calendar for the month (same one Holiday Planning and the planning board use)
  const [mwCalendar, setMwCalendar] = useState({ days: [], defined: true });
  const [mwMessage, setMwMessage] = useState('');

  const loadSetupRows = async () => {
    setSetupError('');
    try {
      const res = await fetch(`${API_URL}/line-setup`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) {
        setSetupError(data.message || 'Failed to load');
        return;
      }
      setSetupRows(data.map((r) => ({ ...r, _key: `id-${r.LINE_SETUP_ID}`, _dirty: false })));
    } catch (err) {
      setSetupError('Cannot reach server.');
    }
  };

  useEffect(() => {
    loadSetupRows();
  }, []);

  // the Unit picker comes from the Production Unit master (UnitSelect pre-selects the default unit)
  const currentUnitSetup = setupRows
    .filter((r) => String(r.UNIT) === String(selectedUnit))
    .sort((a, b) => (b.EFF_START_DATE || '').localeCompare(a.EFF_START_DATE || ''))[0];
  const noOfLines = currentUnitSetup ? Number(currentUnitSetup.NO_OF_LINE) || 0 : 0;
  const lineNumbers = Array.from({ length: noOfLines }, (_, i) => i + 1);

  const loadCapacityRows = async (unit) => {
    if (!unit) {
      setCapacityRows([]);
      return;
    }
    setCapError('');
    try {
      const res = await fetch(`${API_URL}/line-capacity?unit=${unit}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) {
        setCapError(data.message || 'Failed to load');
        return;
      }
      setCapacityRows(data);
    } catch (err) {
      setCapError('Cannot reach server.');
    }
  };

  useEffect(() => {
    loadCapacityRows(selectedUnit);
    setSelectedLines(new Set());
    setAllLines(false);
  }, [selectedUnit]);

  const loadMonthwise = async (unit, month, year) => {
    if (!unit) {
      setMwLines([]);
      return;
    }
    setMwError('');
    try {
      const res = await fetch(`${API_URL}/line-daily?unit=${unit}&month=${month}&year=${year}`, {
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setMwError(data.message || 'Failed to load');
        return;
      }
      setMwLines(data.lines);
      setMwCalendar({ days: data.calendar || [], defined: data.calendarDefined !== false });
    } catch (err) {
      setMwError('Cannot reach server.');
    }
  };

  useEffect(() => {
    loadMonthwise(selectedUnit, mwMonth, mwYear);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUnit, mwMonth, mwYear]);

  const changeMwMonth = (delta) => {
    let m = mwMonth + delta;
    let y = mwYear;
    if (m > 12) { m = 1; y += 1; }
    if (m < 1) { m = 12; y -= 1; }
    setMwMonth(m);
    setMwYear(y);
  };

  const updateMwCell = (lineNo, day, value) => {
    setMwLines((prev) =>
      prev.map((l) =>
        l.lineNo !== lineNo
          ? l
          : { ...l, days: l.days.map((d) => (d.day !== day ? d : { ...d, [mwTab]: value, isOverride: true })) }
      )
    );
  };

  const saveMwCell = async (lineNo, dayObj) => {
    setMwError('');
    try {
      const res = await fetch(`${API_URL}/line-daily`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          unit: selectedUnit,
          lineNo,
          calendarDate: dayObj.date,
          workingHour: dayObj.workingHour,
          manpower: dayObj.manpower,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setMwError(data.message || 'Save failed');
        return;
      }
      setMwMessage(`Line ${lineNo}, ${dayObj.date}: saved. ${data.replanMessage || ''}`);
    } catch (err) {
      setMwError('Cannot reach server.');
    }
  };

  // ---- Default Working Hour for lines (used on days without a range or day value) ----
  const [defaultWH, setDefaultWH] = useState('');
  useEffect(() => {
    if (!selectedUnit) return;
    fetch(`${API_URL}/planning-settings?unit=${selectedUnit}`, { headers: authHeaders() })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => { if (d) setDefaultWH(String(d.defaultWorkingHour)); })
      .catch(() => {});
  }, [selectedUnit]);

  const saveDefaultWH = async () => {
    setCapError('');
    setCapMessage('');
    try {
      const res = await fetch(`${API_URL}/planning-settings`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ unit: selectedUnit, defaultWorkingHour: defaultWH }),
      });
      const data = await res.json();
      if (!res.ok) { setCapError(data.message || 'Save failed'); return; }
      setCapMessage(`Default working hour set to ${data.defaultWorkingHour}. ${data.replanMessage || ''}`);
      loadMonthwise(selectedUnit, mwMonth, mwYear);
    } catch (err) {
      setCapError('Cannot reach server.');
    }
  };

  const MONTH_NAMES = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];

  // --- No Of Lines handlers ---
  const addSetupRow = () => setSetupRows((prev) => [...prev, emptySetupRow()]);

  const updateSetupRow = (key, field, value) => {
    setSetupRows((prev) =>
      prev.map((r) => (r._key === key ? { ...r, [field]: value, _dirty: true } : r))
    );
  };

  const toggleSelectSetup = (key) => {
    setSelectedSetupKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const handleDeleteSetup = async () => {
    setSetupError('');
    setSetupMessage('');
    const toDelete = setupRows.filter((r) => selectedSetupKeys.has(r._key));
    try {
      for (const row of toDelete) {
        if (row.LINE_SETUP_ID) {
          const res = await fetch(`${API_URL}/line-setup/${row.LINE_SETUP_ID}`, {
            method: 'DELETE',
            headers: authHeaders(),
          });
          if (!res.ok) {
            const data = await res.json();
            setSetupError(data.message || 'Delete failed');
            return;
          }
        }
      }
      setSetupRows((prev) => prev.filter((r) => !selectedSetupKeys.has(r._key)));
      setSelectedSetupKeys(new Set());
      setSetupMessage('Deleted.');
    } catch (err) {
      setSetupError('Cannot reach server.');
    }
  };

  const handleSaveSetup = async () => {
    setSetupError('');
    setSetupMessage('');
    try {
      for (const row of setupRows) {
        if (!row._dirty) continue;
        if (!row.UNIT || !row.NO_OF_LINE || !row.EFF_START_DATE) continue;

        const payload = {
          unit: row.UNIT,
          noOfLine: row.NO_OF_LINE,
          effStartDate: row.EFF_START_DATE,
          effEndDate: row.EFF_END_DATE || null,
        };

        if (row.LINE_SETUP_ID) {
          await fetch(`${API_URL}/line-setup/${row.LINE_SETUP_ID}`, {
            method: 'PUT',
            headers: authHeaders(),
            body: JSON.stringify(payload),
          });
        } else {
          await fetch(`${API_URL}/line-setup`, {
            method: 'POST',
            headers: authHeaders(),
            body: JSON.stringify(payload),
          });
        }
      }
      setSetupMessage('Saved.');
      await loadSetupRows();
    } catch (err) {
      setSetupError('Cannot reach server.');
    }
  };

  // --- Working Hour / Manpower handlers ---
  const toggleLine = (lineNo) => {
    setSelectedLines((prev) => {
      const next = new Set(prev);
      if (next.has(lineNo)) next.delete(lineNo);
      else next.add(lineNo);
      return next;
    });
  };

  const toggleAllLines = (checked) => {
    setAllLines(checked);
    setSelectedLines(checked ? new Set(lineNumbers) : new Set());
  };

  const handleUpdateLine = async () => {
    setCapError('');
    setCapMessage('');

    if (!selectedUnit) {
      setCapError('Select a Unit first.');
      return;
    }
    if (selectedLines.size === 0) {
      setCapError('Select at least one line, or check All Lines.');
      return;
    }
    if (!capacityForm.workingHour || !capacityForm.startDate) {
      setCapError('Working Hour and Start Date are required.');
      return;
    }

    try {
      const res = await fetch(`${API_URL}/line-capacity`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify({
          unit: selectedUnit,
          lineNos: [...selectedLines],
          workingHour: capacityForm.workingHour,
          manpower: capacityForm.manpower || null,
          startDate: capacityForm.startDate,
          endDate: capacityForm.endDate || null,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCapError(data.message || 'Update failed');
        return;
      }
      setCapMessage(`Updated ${selectedLines.size} line(s). ${data.replanMessage || ''}`);
      setSelectedLines(new Set());
      setAllLines(false);
      loadCapacityRows(selectedUnit);
      loadMonthwise(selectedUnit, mwMonth, mwYear);
    } catch (err) {
      setCapError('Cannot reach server.');
    }
  };

  const updateCapacityRow = (id, field, value) => {
    setCapacityRows((prev) => prev.map((r) => (r.LINE_CAPACITY_ID === id ? { ...r, [field]: value } : r)));
  };

  const handleSaveCapacityRow = async (row) => {
    setCapError('');
    setCapMessage('');
    try {
      const res = await fetch(`${API_URL}/line-capacity/${row.LINE_CAPACITY_ID}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({
          workingHour: row.WORKING_HOUR,
          manpower: row.MANPOWER,
          startDate: row.START_DATE,
          endDate: row.END_DATE,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setCapError(data.message || 'Save failed');
        return;
      }
      setCapMessage(`Line ${row.LINE_NO} saved. ${data.replanMessage || ''}`);
      loadMonthwise(selectedUnit, mwMonth, mwYear);
    } catch (err) {
      setCapError('Cannot reach server.');
    }
  };

  const handleDeleteCapacityRow = async (id) => {
    setCapError('');
    try {
      const res = await fetch(`${API_URL}/line-capacity/${id}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setCapError(data.message || 'Delete failed');
        return;
      }
      setCapacityRows((prev) => prev.filter((r) => r.LINE_CAPACITY_ID !== id));
      setCapMessage(`Capacity record deleted. ${data.replanMessage || ''}`);
      loadMonthwise(selectedUnit, mwMonth, mwYear);
    } catch (err) {
      setCapError('Cannot reach server.');
    }
  };

  return (
    <div>
      <div className="line-master-top-grid">
      {/* No Of Lines panel */}
      <div className="poc-search" style={{ marginBottom: '1.5rem' }}>
        <div className="poc-search-header">
          <h2>No Of Lines</h2>
          <div style={{ display: 'flex', gap: '0.5rem' }}>
            <button className="new-btn" type="button" onClick={addSetupRow}>Add</button>
            <button className="remove-btn-text" type="button" onClick={handleDeleteSetup}>Delete</button>
            <button className="save-btn" type="button" onClick={handleSaveSetup}>Save</button>
          </div>
        </div>

        {setupError && <div className="search-error">{setupError}</div>}
        {setupMessage && <div className="poc-success">{setupMessage}</div>}

        <div className="table-scroll">
          <table className="search-table">
            <thead>
              <tr>
                <th></th>
                <th>Unit</th>
                <th>No Of Line</th>
                <th>Eff Start Date</th>
                <th>Eff End Date</th>
              </tr>
            </thead>
            <tbody>
              {setupRows.map((row) => (
                <tr key={row._key}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedSetupKeys.has(row._key)}
                      onChange={() => toggleSelectSetup(row._key)}
                    />
                  </td>
                  <td>
                    <UnitSelect
                      value={row.UNIT}
                      onChange={(v) => updateSetupRow(row._key, 'UNIT', v)}
                      autoDefault={!row.LINE_SETUP_ID}
                      allowBlank={Boolean(row.LINE_SETUP_ID) && !row.UNIT}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.NO_OF_LINE}
                      onChange={(e) => updateSetupRow(row._key, 'NO_OF_LINE', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={row.EFF_START_DATE || ''}
                      onChange={(e) => updateSetupRow(row._key, 'EFF_START_DATE', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={row.EFF_END_DATE || ''}
                      onChange={(e) => updateSetupRow(row._key, 'EFF_END_DATE', e.target.value)}
                    />
                  </td>
                </tr>
              ))}
              {setupRows.length === 0 && (
                <tr><td colSpan="5" className="no-results">No rows yet — click Add</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Working Hour / Manpower panel */}
      <div className="poc-search">
        <div className="poc-search-header">
          <h2>Update Working Hour / Manpower Of Line</h2>
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'flex-end', flexWrap: 'wrap' }}>
            <div className="field" style={{ minWidth: '160px' }}>
              <label>Unit</label>
              <UnitSelect value={selectedUnit} onChange={setSelectedUnit} />
            </div>
            <div className="field" title="Hours per day for a line on days without a working-hour range or a Monthwise day value">
              <label>Default Working Hour for lines</label>
              <div style={{ display: 'flex', gap: '0.3rem' }}>
                <input type="number" min="0" max="24" step="0.5" style={{ width: 70 }} value={defaultWH} onChange={(e) => setDefaultWH(e.target.value)} />
                <button type="button" className="edit-btn" onClick={saveDefaultWH} disabled={!selectedUnit || defaultWH === ''}>Set</button>
              </div>
            </div>
          </div>
        </div>
        <p className="lm-hint">
          A change here re-plans the planning board: each line's strips from the start date onward get longer or shorter
          (output per day = productivity &times; working hour), later strips move back if needed, frozen strips stay.
        </p>

        {capError && <div className="search-error">{capError}</div>}
        {capMessage && <div className="poc-success">{capMessage}</div>}

        <div className="line-capacity-layout">
          <div className="line-capacity-form">
            <div className="field">
              <label>Working Hour</label>
              <input
                type="number"
                value={capacityForm.workingHour}
                onChange={(e) => setCapacityForm((f) => ({ ...f, workingHour: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Manpower</label>
              <input
                type="number"
                value={capacityForm.manpower}
                onChange={(e) => setCapacityForm((f) => ({ ...f, manpower: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>Start Date</label>
              <input
                type="date"
                value={capacityForm.startDate}
                onChange={(e) => setCapacityForm((f) => ({ ...f, startDate: e.target.value }))}
              />
            </div>
            <div className="field">
              <label>End Date</label>
              <input
                type="date"
                value={capacityForm.endDate}
                onChange={(e) => setCapacityForm((f) => ({ ...f, endDate: e.target.value }))}
              />
            </div>
            <label className="all-lines-check">
              <input type="checkbox" checked={allLines} onChange={(e) => toggleAllLines(e.target.checked)} />
              All Lines
            </label>
            <button type="button" className="save-btn" onClick={handleUpdateLine}>Update line</button>
          </div>

          <div className="line-select-box">
            <div className="line-select-header">
              <span></span>
              <span>Line</span>
            </div>
            <div className="line-select-list">
              {lineNumbers.length === 0 && <div className="no-results">Select a Unit with lines defined</div>}
              {lineNumbers.map((n) => (
                <label key={n} className="line-select-row">
                  <input type="checkbox" checked={selectedLines.has(n)} onChange={() => toggleLine(n)} />
                  {n}
                </label>
              ))}
            </div>
          </div>
        </div>
      </div>
      </div>

      {/* Existing Capacity Records (full width, below the two-column setup) */}
      <div className="poc-search" style={{ marginTop: '1.5rem' }}>
        <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Existing Capacity Records</h2>
        <div className="table-scroll">
          <table className="search-table">
            <thead>
              <tr>
                <th>Line</th>
                <th>Working Hour</th>
                <th>Manpower</th>
                <th>Start Date</th>
                <th>End Date</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {capacityRows.map((row) => (
                <tr key={row.LINE_CAPACITY_ID}>
                  <td>{row.LINE_NO}</td>
                  <td>
                    <input
                      type="number"
                      value={row.WORKING_HOUR ?? ''}
                      onChange={(e) => updateCapacityRow(row.LINE_CAPACITY_ID, 'WORKING_HOUR', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      value={row.MANPOWER ?? ''}
                      onChange={(e) => updateCapacityRow(row.LINE_CAPACITY_ID, 'MANPOWER', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={row.START_DATE ?? ''}
                      onChange={(e) => updateCapacityRow(row.LINE_CAPACITY_ID, 'START_DATE', e.target.value)}
                    />
                  </td>
                  <td>
                    <input
                      type="date"
                      value={row.END_DATE ?? ''}
                      onChange={(e) => updateCapacityRow(row.LINE_CAPACITY_ID, 'END_DATE', e.target.value)}
                    />
                  </td>
                  <td style={{ display: 'flex', gap: '0.4rem' }}>
                    <button type="button" className="edit-btn" onClick={() => handleSaveCapacityRow(row)}>Save</button>
                    <button type="button" className="remove-btn" onClick={() => handleDeleteCapacityRow(row.LINE_CAPACITY_ID)}>&times;</button>
                  </td>
                </tr>
              ))}
              {capacityRows.length === 0 && (
                <tr><td colSpan="6" className="no-results">No capacity records yet</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Monthwise calendar grid */}
      <div className="poc-search" style={{ marginTop: '1.5rem' }}>
        <div className="poc-search-header">
          <h2>Monthwise</h2>
        </div>

        <div className="mw-toolbar">
          <div className="field">
            <label>Month Name</label>
            <select value={mwMonth} onChange={(e) => setMwMonth(Number(e.target.value))}>
              {MONTH_NAMES.map((m, i) => (
                <option key={m} value={i + 1}>{m}</option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>Year</label>
            <input type="number" value={mwYear} onChange={(e) => setMwYear(Number(e.target.value))} />
          </div>
          <button type="button" className="regen-btn" onClick={() => changeMwMonth(-1)}>Previous</button>
          <button type="button" className="regen-btn" onClick={() => changeMwMonth(1)}>Next</button>
        </div>

        {mwError && <div className="search-error">{mwError}</div>}
        {mwMessage && <div className="poc-success">{mwMessage}</div>}
        {!mwCalendar.defined && mwLines.length > 0 && (
          <div className="search-error">
            No Holiday Plan for {MONTH_NAMES[mwMonth - 1]} {mwYear}: working days are not defined, so nothing can be planned in this month yet.
          </div>
        )}

        <div className="mw-tabs">
          <button
            type="button"
            className={mwTab === 'workingHour' ? 'mw-tab active' : 'mw-tab'}
            onClick={() => setMwTab('workingHour')}
          >
            Working Hour
          </button>
          <button
            type="button"
            className={mwTab === 'manpower' ? 'mw-tab active' : 'mw-tab'}
            onClick={() => setMwTab('manpower')}
          >
            Manpower
          </button>
        </div>

        <div className="table-scroll">
          <table className="mw-table">
            <thead>
              <tr>
                <th className="mw-sticky-col">LineNo</th>
                {mwLines[0]?.days.map((d) => {
                  const cal = mwCalendar.days[d.day - 1];
                  return (
                    <th key={d.day} className={cal?.isHoliday ? 'mw-holiday' : ''} title={cal?.holidayName || ''}>
                      D{d.day}
                    </th>
                  );
                })}
              </tr>
            </thead>
            <tbody>
              {mwLines.map((line) => (
                <tr key={line.lineNo}>
                  <td className="mw-sticky-col">{line.lineNo}</td>
                  {line.days.map((d) => (
                    <td
                      key={d.day}
                      className={[d.isOverride ? 'mw-override' : '', d.isHoliday ? 'mw-holiday' : '', d.isDefault && mwTab === 'workingHour' ? 'mw-default' : ''].filter(Boolean).join(' ')}
                      title={d.isHoliday ? `${mwCalendar.days[d.day - 1]?.holidayName || 'Holiday'}: no production`
                        : d.isDefault && mwTab === 'workingHour' ? 'Default working hour (no range or day value)' : ''}
                    >
                      <input
                        type="number"
                        value={d[mwTab] ?? ''}
                        onChange={(e) => updateMwCell(line.lineNo, d.day, e.target.value === '' ? null : Number(e.target.value))}
                        onBlur={() => saveMwCell(line.lineNo, d)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
              {mwLines.length === 0 && (
                <tr><td className="no-results">Select a Unit with lines defined</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
