import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './PocForm.css';
import './PocSearch.css';

const API_URL = 'http://localhost:5000/api';

const emptyNew = {
  fobId: '',
  bpo: '',
  qty: '',
  shipDate: '',
  classification: '',
  poType: '',
  incoterms: '',
  endDate: '',
  shipMode: '',
  country: '',
  status: 1,
};

const toDateInput = (v) => (v ? String(v).slice(0, 10) : '');

export default function BpoForm() {
  const { id } = useParams(); // POC_ID
  const navigate = useNavigate();

  const [lines, setLines] = useState([]);
  const [bpos, setBpos] = useState([]);
  const [newBpo, setNewBpo] = useState(emptyNew);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/bpo/poc/${id}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Failed to load BPO data');
        return;
      }
      setLines(data.lines);
      setBpos(data.bpos.map((b) => ({ ...b, SHIPDATE: toDateInput(b.SHIPDATE), ENDDATE: toDateInput(b.ENDDATE) })));
      if (data.lines.length && !newBpo.fobId) {
        setNewBpo((n) => ({ ...n, fobId: data.lines[0].FOB_ID }));
      }
    } catch (err) {
      setError('Cannot reach server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const updateNew = (field, value) => setNewBpo((n) => ({ ...n, [field]: value }));

  const updateExisting = (bpoId, field, value) => {
    setBpos((prev) => prev.map((b) => (b.BPO_ID === bpoId ? { ...b, [field]: value } : b)));
  };

  const authHeaders = () => ({
    'Content-Type': 'application/json',
    Authorization: `Bearer ${localStorage.getItem('token')}`,
  });

  const handleAdd = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/bpo`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(newBpo),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Add failed');
        return;
      }
      setMessage('BPO added.');
      setNewBpo({ ...emptyNew, fobId: newBpo.fobId });
      load();
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const handleSaveRow = async (row) => {
    setError('');
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/bpo/${row.BPO_ID}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify(row),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Save failed');
        return;
      }
      setMessage(`BPO #${row.BPO_ID} saved.`);
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const handleDeleteRow = async (bpoId) => {
    setError('');
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/bpo/${bpoId}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Delete failed');
        return;
      }
      setBpos((prev) => prev.filter((b) => b.BPO_ID !== bpoId));
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  if (loading) return <div className="poc-form">Loading...</div>;

  return (
    <div className="poc-form">
      <div className="poc-lines-header">
        <h2>BPO Info — POC #{id}</h2>
        <button type="button" onClick={() => navigate('/')}>
          Back to Search
        </button>
      </div>

      {error && <div className="poc-error">{error}</div>}
      {message && <div className="poc-success">{message}</div>}

      {lines.length === 0 ? (
        <p>This POC has no costing lines yet — add lines first before creating a BPO.</p>
      ) : (
        <>
          <h2>Add BPO</h2>
          <form className="poc-grid" onSubmit={handleAdd}>
            <div className="field">
              <label>Line (Wash / Color)</label>
              <select value={newBpo.fobId} onChange={(e) => updateNew('fobId', e.target.value)}>
                {lines.map((l) => (
                  <option key={l.FOB_ID} value={l.FOB_ID}>
                    {l.WASH_NAME} / {l.COLOR}
                  </option>
                ))}
              </select>
            </div>
            <div className="field">
              <label>BPO Number</label>
              <input value={newBpo.bpo} onChange={(e) => updateNew('bpo', e.target.value)} />
            </div>
            <div className="field">
              <label>Qty</label>
              <input type="number" value={newBpo.qty} onChange={(e) => updateNew('qty', e.target.value)} />
            </div>
            <div className="field">
              <label>Ship Date</label>
              <input type="date" value={newBpo.shipDate} onChange={(e) => updateNew('shipDate', e.target.value)} />
            </div>
            <div className="field">
              <label>End Date</label>
              <input type="date" value={newBpo.endDate} onChange={(e) => updateNew('endDate', e.target.value)} />
            </div>
            <div className="field">
              <label>Classification</label>
              <input value={newBpo.classification} onChange={(e) => updateNew('classification', e.target.value)} />
            </div>
            <div className="field">
              <label>PO Type</label>
              <input value={newBpo.poType} onChange={(e) => updateNew('poType', e.target.value)} />
            </div>
            <div className="field">
              <label>Incoterms</label>
              <input value={newBpo.incoterms} onChange={(e) => updateNew('incoterms', e.target.value)} />
            </div>
            <div className="field">
              <label>Ship Mode</label>
              <input value={newBpo.shipMode} onChange={(e) => updateNew('shipMode', e.target.value)} />
            </div>
            <div className="field">
              <label>Country</label>
              <input value={newBpo.country} onChange={(e) => updateNew('country', e.target.value)} />
            </div>
            <div className="field" style={{ justifyContent: 'flex-end' }}>
              <button type="submit" className="save-btn">Add BPO</button>
            </div>
          </form>

          <h2>Existing BPOs</h2>
          <div className="table-scroll">
            <table className="search-table">
              <thead>
                <tr>
                  <th>BPO ID</th>
                  <th>Line</th>
                  <th>BPO Number</th>
                  <th>Qty</th>
                  <th>Ship Date</th>
                  <th>End Date</th>
                  <th>Classification</th>
                  <th>PO Type</th>
                  <th>Incoterms</th>
                  <th>Ship Mode</th>
                  <th>Country</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {bpos.map((row) => (
                  <tr key={row.BPO_ID}>
                    <td>{row.BPO_ID}</td>
                    <td>{row.WASH_NAME} / {row.COLOR}</td>
                    <td>
                      <input value={row.BPO ?? ''} onChange={(e) => updateExisting(row.BPO_ID, 'BPO', e.target.value)} />
                    </td>
                    <td>
                      <input type="number" value={row.QTY ?? ''} onChange={(e) => updateExisting(row.BPO_ID, 'QTY', e.target.value)} />
                    </td>
                    <td>
                      <input type="date" value={row.SHIPDATE ?? ''} onChange={(e) => updateExisting(row.BPO_ID, 'SHIPDATE', e.target.value)} />
                    </td>
                    <td>
                      <input type="date" value={row.ENDDATE ?? ''} onChange={(e) => updateExisting(row.BPO_ID, 'ENDDATE', e.target.value)} />
                    </td>
                    <td>
                      <input value={row.CLASSIFICATION ?? ''} onChange={(e) => updateExisting(row.BPO_ID, 'CLASSIFICATION', e.target.value)} />
                    </td>
                    <td>
                      <input value={row.PO_TYPE ?? ''} onChange={(e) => updateExisting(row.BPO_ID, 'PO_TYPE', e.target.value)} />
                    </td>
                    <td>
                      <input value={row.INCOTERMS ?? ''} onChange={(e) => updateExisting(row.BPO_ID, 'INCOTERMS', e.target.value)} />
                    </td>
                    <td>
                      <input value={row.SHIPMODE ?? ''} onChange={(e) => updateExisting(row.BPO_ID, 'SHIPMODE', e.target.value)} />
                    </td>
                    <td>
                      <input value={row.COUNTRY ?? ''} onChange={(e) => updateExisting(row.BPO_ID, 'COUNTRY', e.target.value)} />
                    </td>
                    <td style={{ display: 'flex', gap: '0.3rem' }}>
                      <button type="button" className="edit-btn" onClick={() => handleSaveRow(row)}>Save</button>
                      <button type="button" className="remove-btn" onClick={() => handleDeleteRow(row.BPO_ID)}>&times;</button>
                    </td>
                  </tr>
                ))}
                {bpos.length === 0 && (
                  <tr>
                    <td colSpan="12" className="no-results">No BPO records yet</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
