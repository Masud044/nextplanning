import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import './PocForm.css';
import UnitSelect from './UnitSelect';

const API_URL = 'http://localhost:5000/api';

const emptyLine = () => ({
  washName: '',
  color: '',
  fabricCost: '',
  trimCost: '',
  washCost: '',
  cm: '',
});

const toHeaderState = (h) => ({
  lcUnit: h.LC_UNIT ?? '',
  buyerId: h.BUYER_ID ?? '',
  season: h.SEASON ?? '',
  style: h.STYLE ?? '',
  styleDescription: h.STYLE_DESCRIPTION ?? '',
  brand: h.BRAND ?? '',
  fit: h.FIT ?? '',
  endUser: h.END_USER ?? '',
  itemDescription: h.ITEM_DESCRIPTION ?? '',
  orderQty: h.ORDER_QTY ?? '',
  gmApproval: h.GM_APPROVAL ?? 'N',
  status: h.STATUS ?? 1,
});

const toLineState = (l) => ({
  washName: l.WASH_NAME ?? '',
  color: l.COLOR ?? '',
  fabricCost: l.FABRIC_COST ?? '',
  trimCost: l.TRIM_COST ?? '',
  washCost: l.WASH_COST ?? '',
  cm: l.CM ?? '',
});

export default function PocEdit() {
  const { id } = useParams();
  const navigate = useNavigate();

  const [header, setHeader] = useState(null);
  const [lines, setLines] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    const load = async () => {
      setLoading(true);
      setError('');
      try {
        const token = localStorage.getItem('token');
        const res = await fetch(`${API_URL}/poc/${id}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        const data = await res.json();
        if (!res.ok) {
          setError(data.message || 'Failed to load POC');
          return;
        }
        setHeader(toHeaderState(data.header));
        setLines(data.lines.length ? data.lines.map(toLineState) : [emptyLine()]);
      } catch (err) {
        setError('Cannot reach server.');
      } finally {
        setLoading(false);
      }
    };
    load();
  }, [id]);

  const updateHeader = (field, value) => setHeader((h) => ({ ...h, [field]: value }));

  const updateLine = (index, field, value) => {
    setLines((prev) => prev.map((line, i) => (i === index ? { ...line, [field]: value } : line)));
  };

  const addLine = () => setLines((prev) => [...prev, emptyLine()]);

  const removeLine = (index) => setLines((prev) => prev.filter((_, i) => i !== index));

  const lineFob = (line) => {
    const total =
      (Number(line.fabricCost) || 0) +
      (Number(line.trimCost) || 0) +
      (Number(line.washCost) || 0) +
      (Number(line.cm) || 0);
    return total.toFixed(2);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    setSaving(true);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/poc/${id}`, {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ header, lines }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Save failed');
        return;
      }

      setMessage('Saved.');
    } catch (err) {
      setError('Cannot reach server.');
    } finally {
      setSaving(false);
    }
  };

  if (loading) return <div className="poc-form">Loading...</div>;
  if (error && !header) return <div className="poc-form poc-error">{error}</div>;

  return (
    <form className="poc-form" onSubmit={handleSubmit}>
      <div className="poc-lines-header">
        <h2>POC #{id} — Header</h2>
        <button type="button" onClick={() => navigate('/')}>
          Back to Search
        </button>
      </div>

      {error && <div className="poc-error">{error}</div>}
      {message && <div className="poc-success">{message}</div>}

      <div className="poc-grid">
        <div className="field">
          <label>LC Unit</label>
          {/* editing keeps the stored unit as-is; an empty one is not silently filled with the default */}
          <UnitSelect value={header.lcUnit} onChange={(v) => updateHeader('lcUnit', v)} allowBlank />
        </div>
        <div className="field">
          <label>Buyer ID</label>
          <input value={header.buyerId} onChange={(e) => updateHeader('buyerId', e.target.value)} />
        </div>
        <div className="field">
          <label>Season</label>
          <input value={header.season} onChange={(e) => updateHeader('season', e.target.value)} />
        </div>
        <div className="field">
          <label>Style</label>
          <input value={header.style} onChange={(e) => updateHeader('style', e.target.value)} required />
        </div>
        <div className="field wide">
          <label>Style Description</label>
          <input
            value={header.styleDescription}
            onChange={(e) => updateHeader('styleDescription', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Brand</label>
          <input value={header.brand} onChange={(e) => updateHeader('brand', e.target.value)} />
        </div>
        <div className="field">
          <label>Fit</label>
          <input value={header.fit} onChange={(e) => updateHeader('fit', e.target.value)} />
        </div>
        <div className="field">
          <label>End User</label>
          <input value={header.endUser} onChange={(e) => updateHeader('endUser', e.target.value)} />
        </div>
        <div className="field wide">
          <label>Item Description</label>
          <input
            value={header.itemDescription}
            onChange={(e) => updateHeader('itemDescription', e.target.value)}
          />
        </div>
        <div className="field">
          <label>Order Qty</label>
          <input
            type="number"
            value={header.orderQty}
            onChange={(e) => updateHeader('orderQty', e.target.value)}
          />
        </div>
        <div className="field">
          <label>GM Approval</label>
          <select value={header.gmApproval} onChange={(e) => updateHeader('gmApproval', e.target.value)}>
            <option value="N">No</option>
            <option value="Y">Yes</option>
          </select>
        </div>
      </div>

      <div className="poc-lines-header">
        <h2>FOB Costing — Lines</h2>
        <button type="button" onClick={addLine}>+ Add Line</button>
      </div>

      <div className="table-scroll">
        <table className="poc-lines-table">
          <thead>
            <tr>
              <th>Wash Name</th>
              <th>Color</th>
              <th>Fabric Cost</th>
              <th>Trim Cost</th>
              <th>Wash Cost</th>
              <th>CM</th>
              <th>FOB</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line, index) => (
              <tr key={index}>
                <td>
                  <input value={line.washName} onChange={(e) => updateLine(index, 'washName', e.target.value)} />
                </td>
                <td>
                  <input value={line.color} onChange={(e) => updateLine(index, 'color', e.target.value)} />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={line.fabricCost}
                    onChange={(e) => updateLine(index, 'fabricCost', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={line.trimCost}
                    onChange={(e) => updateLine(index, 'trimCost', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={line.washCost}
                    onChange={(e) => updateLine(index, 'washCost', e.target.value)}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    step="0.01"
                    value={line.cm}
                    onChange={(e) => updateLine(index, 'cm', e.target.value)}
                  />
                </td>
                <td className="fob-cell">{lineFob(line)}</td>
                <td>
                  {lines.length > 1 && (
                    <button type="button" className="remove-btn" onClick={() => removeLine(index)}>
                      &times;
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <button type="submit" className="save-btn" disabled={saving}>
        {saving ? 'Saving...' : 'Save Changes'}
      </button>
    </form>
  );
}
