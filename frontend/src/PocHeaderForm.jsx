import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './PocForm.css';
import UnitSelect from './UnitSelect';

const API_URL = 'http://localhost:5000/api';

const emptyHeader = {
  lcUnit: '',
  buyerId: '',
  season: '',
  style: '',
  styleDescription: '',
  brand: '',
  fit: '',
  endUser: '',
  itemDescription: '',
  orderQty: '',
  gmApproval: 'N',
  status: 1,
};

export default function PocHeaderForm() {
  const [header, setHeader] = useState(emptyHeader);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const navigate = useNavigate();

  const updateHeader = (field, value) => setHeader((h) => ({ ...h, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSaving(true);

    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/poc`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ header, lines: [] }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.message || 'Save failed');
        return;
      }

      navigate(`/poc/${data.pocId}/edit`);
    } catch (err) {
      setError('Cannot reach server.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="poc-form" onSubmit={handleSubmit}>
      <h2>New POC — Header</h2>

      {error && <div className="poc-error">{error}</div>}

      <div className="poc-grid">
        <div className="field">
          <label>LC Unit</label>
          <UnitSelect value={header.lcUnit} onChange={(v) => updateHeader('lcUnit', v)} />
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

      <button type="submit" className="save-btn" disabled={saving}>
        {saving ? 'Saving...' : 'Save & Continue'}
      </button>
    </form>
  );
}
