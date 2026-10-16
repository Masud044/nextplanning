import { useEffect, useState } from 'react';
import { reloadUnits } from './UnitSelect';
import './PocSearch.css';
import './PocForm.css';

const API_URL = 'http://localhost:5000/api';

const emptyNew = { unitId: '', unitCode: '', unitName: '', sortOrder: '', isDefault: false };

// Setup screen for the Production Unit LOV used across the app.
export default function ProductionUnits() {
  const [units, setUnits] = useState([]);
  const [newUnit, setNewUnit] = useState(emptyNew);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  });

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch(`${API_URL}/production-units?all=1`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Failed to load units'); return; }
      setUnits(data);
    } catch (err) {
      setError('Cannot reach server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { load(); }, []);

  const afterChange = (msg) => {
    setMessage(msg);
    load();
    reloadUnits(); // refresh every unit dropdown already on screen
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setError(''); setMessage('');
    try {
      const res = await fetch(`${API_URL}/production-units`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify(newUnit),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Create failed'); return; }
      setNewUnit(emptyNew);
      afterChange(`Unit ${newUnit.unitCode.toUpperCase()} (${newUnit.unitId}) added.`);
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const updateRow = (id, field, value) => {
    setUnits((prev) => prev.map((u) => (u.UNIT_ID === id ? { ...u, [field]: value } : u)));
  };

  const save = async (u, overrides = {}) => {
    setError(''); setMessage('');
    const row = { ...u, ...overrides };
    try {
      const res = await fetch(`${API_URL}/production-units/${row.UNIT_ID}`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({
          unitCode: row.UNIT_CODE, unitName: row.UNIT_NAME, isDefault: row.IS_DEFAULT,
          active: row.ACTIVE, sortOrder: row.SORT_ORDER,
        }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Save failed'); load(); return; }
      afterChange(`Unit ${row.UNIT_CODE} (${row.UNIT_ID}) saved.`);
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  return (
    <div className="poc-search">
      <div className="poc-search-header">
        <h2>Production Units</h2>
      </div>
      <p style={{ marginTop: 0, color: '#64748b', fontSize: '0.9rem' }}>
        The units offered in every Unit / Production Unit dropdown. The <b>default</b> unit is pre-selected in new records.
        Unit IDs are stored in POC, line, holiday, sewing-order and planning data, so they cannot be changed once created;
        set a unit inactive to hide it from new entries.
      </p>

      {error && <div className="search-error">{error}</div>}
      {message && <div className="poc-success">{message}</div>}

      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Add Unit</h2>
      <form className="poc-grid" onSubmit={handleCreate} style={{ marginBottom: '2rem' }}>
        <div className="field">
          <label>Unit ID</label>
          <input type="number" value={newUnit.unitId} onChange={(e) => setNewUnit((n) => ({ ...n, unitId: e.target.value }))} required placeholder="e.g. 342" />
        </div>
        <div className="field">
          <label>Unit Code</label>
          <input value={newUnit.unitCode} onChange={(e) => setNewUnit((n) => ({ ...n, unitCode: e.target.value }))} required maxLength={30} placeholder="e.g. AMS-2" />
        </div>
        <div className="field">
          <label>Unit Name</label>
          <input value={newUnit.unitName} onChange={(e) => setNewUnit((n) => ({ ...n, unitName: e.target.value }))} maxLength={100} />
        </div>
        <div className="field">
          <label>Sort Order</label>
          <input type="number" value={newUnit.sortOrder} onChange={(e) => setNewUnit((n) => ({ ...n, sortOrder: e.target.value }))} />
        </div>
        <div className="field" style={{ flexDirection: 'row', alignItems: 'center', gap: '0.4rem' }}>
          <input id="nu-def" type="checkbox" style={{ width: 'auto' }} checked={newUnit.isDefault} onChange={(e) => setNewUnit((n) => ({ ...n, isDefault: e.target.checked }))} />
          <label htmlFor="nu-def" style={{ margin: 0 }}>Make default</label>
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="save-btn">Add Unit</button>
        </div>
      </form>

      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Units</h2>
      <div className="table-scroll">
        <table className="search-table">
          <thead>
            <tr>
              <th>Unit ID</th>
              <th>Unit Code</th>
              <th>Unit Name</th>
              <th>Sort</th>
              <th>Default</th>
              <th>Active</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {units.map((u) => (
              <tr key={u.UNIT_ID} style={u.ACTIVE === 'N' ? { opacity: 0.55 } : undefined}>
                <td><b>{u.UNIT_ID}</b></td>
                <td><input value={u.UNIT_CODE ?? ''} maxLength={30} onChange={(e) => updateRow(u.UNIT_ID, 'UNIT_CODE', e.target.value)} /></td>
                <td><input value={u.UNIT_NAME ?? ''} maxLength={100} onChange={(e) => updateRow(u.UNIT_ID, 'UNIT_NAME', e.target.value)} /></td>
                <td><input type="number" style={{ width: 70 }} value={u.SORT_ORDER ?? ''} onChange={(e) => updateRow(u.UNIT_ID, 'SORT_ORDER', e.target.value)} /></td>
                <td>
                  {u.IS_DEFAULT === 'Y'
                    ? <span style={{ fontWeight: 700, color: '#15803d' }}>★ Default</span>
                    : <button type="button" className="edit-btn" disabled={u.ACTIVE === 'N'} onClick={() => save(u, { IS_DEFAULT: 'Y' })}>Make default</button>}
                </td>
                <td>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    aria-label={`Unit ${u.UNIT_CODE} active`}
                    checked={u.ACTIVE === 'Y'}
                    disabled={u.IS_DEFAULT === 'Y'}
                    title={u.IS_DEFAULT === 'Y' ? 'The default unit must stay active' : ''}
                    onChange={(e) => updateRow(u.UNIT_ID, 'ACTIVE', e.target.checked ? 'Y' : 'N')}
                  />
                </td>
                <td><button type="button" className="edit-btn" onClick={() => save(u)}>Save</button></td>
              </tr>
            ))}
            {!loading && units.length === 0 && (
              <tr><td colSpan="7" className="no-results">No units defined yet</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
