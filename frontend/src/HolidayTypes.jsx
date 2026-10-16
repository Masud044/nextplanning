import { useEffect, useState } from 'react';

const API_URL = 'http://localhost:5000/api';
const authHeaders = () => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('token')}` });
const emptyNew = { typeCode: '', typeName: '', isWorking: false, policyNote: '', sortOrder: '' };

// ADMIN maintenance of the Working Status LOV (holiday kinds per HR policy).
export default function HolidayTypes() {
  const [rows, setRows] = useState([]);
  const [newType, setNewType] = useState(emptyNew);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = async () => {
    try {
      const res = await fetch(`${API_URL}/holiday/types?all=1`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Failed to load holiday types'); return; }
      setRows(data);
    } catch (err) {
      setError('Cannot reach server.');
    }
  };
  useEffect(() => { load(); }, []);

  const send = async (url, method, body, okText) => {
    setError(''); setMessage('');
    try {
      const res = await fetch(url, { method, headers: authHeaders(), body: JSON.stringify(body) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Save failed'); return false; }
      setMessage(okText);
      load();
      return true;
    } catch (err) {
      setError('Cannot reach server.');
      return false;
    }
  };

  const update = (code, field, value) => setRows((prev) => prev.map((r) => (r.TYPE_CODE === code ? { ...r, [field]: value } : r)));

  return (
    <div style={{ margin: '0 0 1.5rem', padding: '1rem', border: '1px solid #e2e8f0', borderRadius: 10, background: '#f8fafc' }}>
      <h3 style={{ margin: '0 0 0.75rem', fontSize: '1rem' }}>
        Holiday Types <span style={{ color: '#64748b', fontWeight: 400 }}>(Working Status list)</span>
      </h3>
      {error && <div className="search-error">{error}</div>}
      {message && <div className="poc-success">{message}</div>}
      <div className="table-scroll">
        <table className="search-table">
          <thead>
            <tr><th>Code</th><th>Name</th><th>Kind</th><th>HR policy note</th><th>Sort</th><th>Active</th><th></th></tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.TYPE_CODE} style={r.ACTIVE === 'N' ? { opacity: 0.55 } : undefined}>
                <td><code>{r.TYPE_CODE}</code></td>
                <td><input value={r.TYPE_NAME ?? ''} maxLength={100} onChange={(e) => update(r.TYPE_CODE, 'TYPE_NAME', e.target.value)} /></td>
                <td>{r.IS_WORKING === 'Y' ? 'Working day' : 'Holiday'}</td>
                <td><input value={r.POLICY_NOTE ?? ''} maxLength={300} onChange={(e) => update(r.TYPE_CODE, 'POLICY_NOTE', e.target.value)} /></td>
                <td><input type="number" style={{ width: 64 }} value={r.SORT_ORDER ?? ''} onChange={(e) => update(r.TYPE_CODE, 'SORT_ORDER', e.target.value)} /></td>
                <td>
                  <input
                    type="checkbox"
                    style={{ width: 'auto' }}
                    aria-label={`${r.TYPE_NAME} active`}
                    checked={r.ACTIVE === 'Y'}
                    disabled={r.TYPE_CODE === 'WORKING'}
                    onChange={(e) => update(r.TYPE_CODE, 'ACTIVE', e.target.checked ? 'Y' : 'N')}
                  />
                </td>
                <td>
                  <button
                    type="button"
                    className="edit-btn"
                    onClick={() => send(`${API_URL}/holiday/types/${r.TYPE_CODE}`, 'PUT',
                      { typeName: r.TYPE_NAME, policyNote: r.POLICY_NOTE, sortOrder: r.SORT_ORDER, active: r.ACTIVE }, `${r.TYPE_NAME} saved.`)}
                  >
                    Save
                  </button>
                </td>
              </tr>
            ))}
            <tr>
              <td><input placeholder="CODE" value={newType.typeCode} maxLength={30} onChange={(e) => setNewType((n) => ({ ...n, typeCode: e.target.value }))} /></td>
              <td><input placeholder="New type name" value={newType.typeName} maxLength={100} onChange={(e) => setNewType((n) => ({ ...n, typeName: e.target.value }))} /></td>
              <td>
                <select value={newType.isWorking ? 'Y' : 'N'} onChange={(e) => setNewType((n) => ({ ...n, isWorking: e.target.value === 'Y' }))}>
                  <option value="N">Holiday</option>
                  <option value="Y">Working day</option>
                </select>
              </td>
              <td><input placeholder="Policy note" value={newType.policyNote} maxLength={300} onChange={(e) => setNewType((n) => ({ ...n, policyNote: e.target.value }))} /></td>
              <td><input type="number" style={{ width: 64 }} value={newType.sortOrder} onChange={(e) => setNewType((n) => ({ ...n, sortOrder: e.target.value }))} /></td>
              <td></td>
              <td>
                <button
                  type="button"
                  className="save-btn"
                  onClick={async () => { if (await send(`${API_URL}/holiday/types`, 'POST', newType, `${newType.typeName} added.`)) setNewType(emptyNew); }}
                >
                  Add
                </button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p style={{ fontSize: '0.8rem', color: '#64748b', marginBottom: 0 }}>
        A type's code and whether it is a working day or a holiday are fixed once created; deactivate a type to stop offering it.
      </p>
    </div>
  );
}
