import { useEffect, useMemo, useState } from 'react';
import './PocSearch.css';
import './PocForm.css';
import './LineMaster.css';
import './SewingOrderBoard.css';
import UnitSelect, { useUnits, unitLabel } from './UnitSelect';

const API_URL = 'http://localhost:5000/api';
const MAX_ROWS = 300; // rows rendered at once; filter to see others

const authHeaders = () => ({
  'Content-Type': 'application/json',
  Authorization: `Bearer ${localStorage.getItem('token')}`,
});

const fmt = (n) => (n == null || n === '' ? '' : Number(n).toLocaleString());
const withExtra = (buyerQty, pct) => (buyerQty == null || buyerQty === '' ? null : Math.ceil(Number(buyerQty) * (1 + (Number(pct) || 0) / 100)));

const emptyPopulate = {
  orderType: 'Confirmed', shipFrom: '', shipTo: '', buyerId: '', season: '', style: '',
  extraPct: '3', productivity: '', startMode: 'beforeShip', startDate: '', daysBeforeShip: '30', learningCurve: true,
};

// columns with a filter box above them (text "contains"; Order Type and Board are lists)
const FILTER_COLS = ['ORDER_TYPE', 'BPO_NUMBER', 'POC_ID', 'BUYER_NAME', 'SEASON', 'STYLE', 'COLOR', 'WASH_NAME', 'ITEM_DESCRIPTION', 'SHIP_DATE', 'BOARD'];

const boardStatus = (o) => (o.STRIPS_ON_LINE > 0 ? 'On line' : o.STRIPS > 0 ? 'Waiting' : '—');

export default function SewingOrderBoard() {
  const [unit, setUnit] = useState('');
  const { units } = useUnits();
  const unitText = unitLabel(units.find((u) => String(u.UNIT_ID) === String(unit))) || (unit ? `Unit ${unit}` : 'All units');

  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(false);
  const [selected, setSelected] = useState(new Set());
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const [panel, setPanel] = useState(null); // 'populate' | 'add' | 'combine' | 'defaultLc'
  const [pop, setPop] = useState(emptyPopulate);
  const [popOptions, setPopOptions] = useState({ buyers: [], seasons: [] });
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);

  const [fobOptions, setFobOptions] = useState([]);
  const [newOrder, setNewOrder] = useState({ fobId: '', orderQty: '', extraPct: '0', shipDate: '' });
  const [combineForm, setCombineForm] = useState({ productionUnit: '', sewingStartDate: '', sewingEndDate: '' });

  const [defaultLc, setDefaultLc] = useState({ required: false, days: [], inherited: false });

  // Learning curve sub-panel
  const [lcRows, setLcRows] = useState([]);
  const [lcSelected, setLcSelected] = useState(new Set());
  const [lcError, setLcError] = useState('');
  const selectedOrderId = selected.size === 1 ? [...selected][0] : null;
  const selectedOrder = orders.find((o) => o.ORDER_SETUP_ID === selectedOrderId);

  const [filters, setFilters] = useState({});
  const [sortField, setSortField] = useState(null);
  const [sortDir, setSortDir] = useState('asc');

  const toggleSort = (field) => {
    if (sortField === field) setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    else { setSortField(field); setSortDir('asc'); }
  };
  const sortIndicator = (field) => (sortField !== field ? '' : sortDir === 'asc' ? ' ▲' : ' ▼');

  const visibleOrders = useMemo(() => {
    const active = Object.entries(filters).filter(([, v]) => v && String(v).trim());
    return orders
      .filter((o) => active.every(([k, v]) => {
        const cell = k === 'BOARD' ? boardStatus(o) : o[k];
        return k === 'ORDER_TYPE' || k === 'BOARD' ? String(cell) === v : String(cell ?? '').toLowerCase().includes(String(v).trim().toLowerCase());
      }))
      .sort((a, b) => {
        if (!sortField) return 0;
        const av = a[sortField];
        const bv = b[sortField];
        if (av == null && bv == null) return 0;
        if (av == null) return 1;
        if (bv == null) return -1;
        const an = Number(av);
        const bn = Number(bv);
        const cmp = !Number.isNaN(an) && !Number.isNaN(bn) && av !== '' && bv !== '' ? an - bn : String(av).localeCompare(String(bv));
        return sortDir === 'asc' ? cmp : -cmp;
      });
  }, [orders, filters, sortField, sortDir]);
  const shownOrders = visibleOrders.slice(0, MAX_ROWS);

  const loadOrders = async (u = unit) => {
    setError('');
    setLoading(true);
    try {
      const res = await fetch(`${API_URL}/sewing-orders${u ? `?unit=${u}` : ''}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Failed to load'); return; }
      setOrders(data.map((r) => ({ ...r, _dirty: false })));
      setSelected(new Set());
    } catch (err) {
      setError('Cannot reach server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { if (unit) loadOrders(unit); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [unit]);

  const loadDefaultLc = async (u = unit) => {
    try {
      const res = await fetch(`${API_URL}/learning-curve/default?unit=${u || 0}`, { headers: authHeaders() });
      if (res.ok) setDefaultLc(await res.json());
    } catch (err) { /* optional */ }
  };
  useEffect(() => { if (unit) loadDefaultLc(unit); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [unit]);

  const loadLearningCurve = async (orderSetupId) => {
    if (!orderSetupId) { setLcRows([]); return; }
    setLcError('');
    try {
      const res = await fetch(`${API_URL}/learning-curve/${orderSetupId}`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) { setLcError(data.message || 'Failed to load'); return; }
      setLcRows(data);
    } catch (err) {
      setLcError('Cannot reach server.');
    }
  };
  useEffect(() => {
    loadLearningCurve(selectedOrderId);
    setLcSelected(new Set());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedOrderId]);

  const toggleSelect = (id) => setSelected((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });
  const allShownSelected = shownOrders.length > 0 && shownOrders.every((o) => selected.has(o.ORDER_SETUP_ID));
  const toggleAllShown = () => setSelected(allShownSelected ? new Set() : new Set(shownOrders.map((o) => o.ORDER_SETUP_ID)));

  const updateOrderField = (id, field, value) => {
    setOrders((prev) => prev.map((o) => {
      if (o.ORDER_SETUP_ID !== id) return o;
      const next = { ...o, [field]: value, _dirty: true };
      // Extra % / Buyer Qty drive Order Qty
      if (field === 'EXTRA_PCT' || field === 'BUYER_QTY') next.ORDER_QTY = withExtra(next.BUYER_QTY, next.EXTRA_PCT) ?? next.ORDER_QTY;
      return next;
    }));
  };

  const totals = visibleOrders.reduce((t, o) => ({
    buyer: t.buyer + (Number(o.BUYER_QTY) || 0),
    order: t.order + (Number(o.ORDER_QTY) || 0),
  }), { buyer: 0, order: 0 });
  const dirtyCount = orders.filter((o) => o._dirty).length;

  // ---- Populate ----
  const openPopulate = async () => {
    setPanel(panel === 'populate' ? null : 'populate');
    setPreview(null);
    try {
      const res = await fetch(`${API_URL}/sewing-orders/populate-options?unit=${unit || 0}`, { headers: authHeaders() });
      if (res.ok) {
        const d = await res.json();
        setPopOptions(d);
        setPop((p) => ({ ...p, learningCurve: d.lcRequired }));
      }
    } catch (err) { /* filters stay empty */ }
  };
  const runPopulate = async (isPreview) => {
    setError(''); setMessage(''); setBusy(true);
    try {
      const res = await fetch(`${API_URL}/sewing-orders/populate`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ ...pop, unit, preview: isPreview }),
      });
      const d = await res.json();
      if (!res.ok) { setError(d.message || 'Populate failed'); return; }
      if (isPreview) { setPreview(d); return; }
      setPreview(null);
      setPanel(null);
      setMessage(`Populated ${fmt(d.inserted)} order(s) into ${unitText}: buyer qty ${fmt(d.BUYER_QTY)} + ${pop.extraPct || 0}% = ${fmt(d.ORDER_QTY)} pcs.`
        + (d.NO_PRODUCTIVITY ? ` ${fmt(d.NO_PRODUCTIVITY)} without productivity: fill it before making strips.` : ''));
      loadOrders();
    } catch (err) {
      setError('Cannot reach server.');
    } finally {
      setBusy(false);
    }
  };

  // ---- other toolbar actions ----
  const handleDelete = async () => {
    if (selected.size === 0) return;
    const onBoard = orders.filter((o) => selected.has(o.ORDER_SETUP_ID) && o.STRIPS > 0).length;
    setError(''); setMessage('');
    try {
      for (const id of selected) await fetch(`${API_URL}/sewing-orders/${id}`, { method: 'DELETE', headers: authHeaders() });
      setMessage(`Deleted ${selected.size} order(s)${onBoard ? `, ${onBoard} of them with their planning strips` : ''}.`);
      loadOrders();
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const handleSave = async () => {
    setError(''); setMessage('');
    const dirtyRows = orders.filter((o) => o._dirty);
    const problems = [];
    try {
      for (const row of dirtyRows) {
        const res = await fetch(`${API_URL}/sewing-orders/${row.ORDER_SETUP_ID}`, {
          method: 'PUT',
          headers: authHeaders(),
          body: JSON.stringify({
            buyerQty: row.BUYER_QTY,
            extraPct: row.EXTRA_PCT,
            orderQty: row.ORDER_QTY,
            unit: row.UNIT,
            productionUnit: row.UNIT,
            productivity: row.PRODUCTIVITY,
            sewingStartDate: row.SEWING_START_DATE,
            sewingEndDate: row.SEWING_END_DATE,
            learningCurveFlag: row.LEARNING_CURVE_FLAG,
          }),
        });
        if (!res.ok) { const d = await res.json().catch(() => ({})); problems.push(`#${row.ORDER_SETUP_ID}: ${d.message || 'save failed'}`); }
      }
      if (problems.length) setError(`${problems.length} not saved. ${problems.slice(0, 3).join(' | ')}`);
      setMessage(`Saved ${dirtyRows.length - problems.length} order(s).`);
      loadOrders();
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const openAddForm = async () => {
    setPanel(panel === 'add' ? null : 'add');
    try {
      const res = await fetch(`${API_URL}/sewing-orders/fob-options`, { headers: authHeaders() });
      const data = await res.json();
      setFobOptions(data);
      if (data.length) setNewOrder((n) => ({ ...n, fobId: data[0].FOB_ID }));
    } catch (err) {
      setError('Cannot reach server.');
    }
  };
  const handleAddUnconfirmed = async () => {
    setError('');
    try {
      const res = await fetch(`${API_URL}/sewing-orders`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ...newOrder, unit }) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Add failed'); return; }
      setPanel(null);
      setNewOrder({ fobId: '', orderQty: '', extraPct: '0', shipDate: '' });
      setMessage(`Unconfirmed order #${data.id} added.`);
      loadOrders();
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const handleCombine = async () => {
    if (selected.size < 2) { setError('Select at least two orders to join.'); return; }
    setError('');
    try {
      const res = await fetch(`${API_URL}/sewing-orders/combine`, {
        method: 'POST', headers: authHeaders(), body: JSON.stringify({ ids: [...selected], ...combineForm, productionUnit: combineForm.productionUnit || unit }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Combine failed'); return; }
      setMessage(`Joined ${selected.size} orders into Combine Id ${data.combineId}: they become one strip on the planning board.`);
      setPanel(null);
      setCombineForm({ productionUnit: '', sewingStartDate: '', sewingEndDate: '' });
      loadOrders();
    } catch (err) {
      setError('Cannot reach server.');
    }
  };
  const handleDecombine = async () => {
    if (selected.size === 0) return;
    setError('');
    try {
      const res = await fetch(`${API_URL}/sewing-orders/decombine`, { method: 'POST', headers: authHeaders(), body: JSON.stringify({ ids: [...selected] }) });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'De-combine failed'); return; }
      setMessage(`Un-joined ${data.released} order(s).`);
      loadOrders();
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  // ---- Default Learning Curve ----
  const saveDefaultLc = async () => {
    setError(''); setMessage('');
    try {
      const res = await fetch(`${API_URL}/learning-curve/default`, {
        method: 'PUT', headers: authHeaders(),
        body: JSON.stringify({ unit, required: defaultLc.required, days: defaultLc.days.map((d) => ({ pct: d.pct })) }),
      });
      const data = await res.json();
      if (!res.ok) { setError(data.message || 'Save failed'); return; }
      setMessage(`Default learning curve for ${unitText} saved: ${data.days.map((d) => `${d.pct}%`).join(' / ') || 'no build-up'}; build-up ${data.required ? 'required' : 'not required'} for new orders.`);
      loadDefaultLc();
    } catch (err) {
      setError('Cannot reach server.');
    }
  };
  const setLcPct = (i, v) => setDefaultLc((d) => ({ ...d, days: d.days.map((x, j) => (j === i ? { ...x, pct: v } : x)) }));

  // ---- Learning curve of one order ----
  const addLcRow = () => {
    const nextDay = lcRows.length ? Math.max(...lcRows.map((r) => r.DAY_NO)) + 1 : 1;
    setLcRows((prev) => [...prev, { LEARNING_CURVE_ID: null, ORDER_SETUP_ID: selectedOrderId, DAY_NO: nextDay, HOURLY_PRODUCTIVITY: '' }]);
  };
  const copyLcRows = () => {
    const toCopy = lcRows.filter((r) => lcSelected.has(r.LEARNING_CURVE_ID));
    if (toCopy.length === 0) return;
    let nextDay = lcRows.length ? Math.max(...lcRows.map((r) => r.DAY_NO)) + 1 : 1;
    const copies = toCopy.map((r) => ({ LEARNING_CURVE_ID: null, ORDER_SETUP_ID: selectedOrderId, DAY_NO: nextDay++, HOURLY_PRODUCTIVITY: r.HOURLY_PRODUCTIVITY }));
    setLcRows((prev) => [...prev, ...copies]);
  };
  const deleteLcRows = async () => {
    const toDelete = lcRows.filter((r) => lcSelected.has(r.LEARNING_CURVE_ID) || (r.LEARNING_CURVE_ID === null && lcSelected.has(r.DAY_NO)));
    for (const row of toDelete) {
      if (row.LEARNING_CURVE_ID) await fetch(`${API_URL}/learning-curve/${row.LEARNING_CURVE_ID}`, { method: 'DELETE', headers: authHeaders() });
    }
    setLcRows((prev) => prev.filter((r) => !toDelete.includes(r)));
    setLcSelected(new Set());
  };
  const updateLcRow = (idx, field, value) => setLcRows((prev) => prev.map((r, i) => (i === idx ? { ...r, [field]: value } : r)));
  const saveLcRows = async () => {
    setLcError('');
    try {
      for (const row of lcRows) {
        if (row.LEARNING_CURVE_ID) {
          await fetch(`${API_URL}/learning-curve/${row.LEARNING_CURVE_ID}`, {
            method: 'PUT', headers: authHeaders(), body: JSON.stringify({ dayNo: row.DAY_NO, hourlyProductivity: row.HOURLY_PRODUCTIVITY }),
          });
        } else {
          await fetch(`${API_URL}/learning-curve`, {
            method: 'POST', headers: authHeaders(),
            body: JSON.stringify({ orderSetupId: selectedOrderId, dayNo: row.DAY_NO, hourlyProductivity: row.HOURLY_PRODUCTIVITY }),
          });
        }
      }
      loadLearningCurve(selectedOrderId);
      loadOrders();
    } catch (err) {
      setLcError('Cannot reach server.');
    }
  };
  const applyDefaultLc = async () => {
    setLcError('');
    const res = await fetch(`${API_URL}/learning-curve/${selectedOrderId}/apply-default`, { method: 'POST', headers: authHeaders() }).catch(() => null);
    const d = res ? await res.json().catch(() => ({})) : {};
    if (!res || !res.ok) { setLcError(d.message || 'Could not apply the default curve'); return; }
    loadLearningCurve(selectedOrderId);
    setOrders((prev) => prev.map((o) => (o.ORDER_SETUP_ID === selectedOrderId ? { ...o, LEARNING_CURVE_FLAG: 'Y', LC_ROWS: d.days } : o)));
  };
  const toggleLcSelect = (idOrDay) => setLcSelected((prev) => {
    const next = new Set(prev);
    if (next.has(idOrDay)) next.delete(idOrDay); else next.add(idOrDay);
    return next;
  });

  const buildUpText = (o) => {
    if (o.LEARNING_CURVE_FLAG !== 'Y') return 'none';
    if (o.LC_ROWS > 0) return `${o.LC_ROWS} d (own)`;
    return defaultLc.days.length ? `${defaultLc.days.length} d (default)` : 'default (empty)';
  };

  const filterInput = (col) => {
    if (col === 'ORDER_TYPE') {
      return (
        <select value={filters[col] || ''} onChange={(e) => setFilters((f) => ({ ...f, [col]: e.target.value }))} aria-label="Filter order type">
          <option value="">All</option><option value="Confirmed">Confirmed</option><option value="Projection">Projection</option>
        </select>
      );
    }
    if (col === 'BOARD') {
      return (
        <select value={filters[col] || ''} onChange={(e) => setFilters((f) => ({ ...f, [col]: e.target.value }))} aria-label="Filter board status">
          <option value="">All</option><option value="—">Not stripped</option><option value="Waiting">Waiting</option><option value="On line">On line</option>
        </select>
      );
    }
    return <input value={filters[col] || ''} onChange={(e) => setFilters((f) => ({ ...f, [col]: e.target.value }))} aria-label={`Filter ${col}`} />;
  };

  return (
    <div className="poc-search sob-page">
      <div className="sob-header">
        <div className="sob-title">
          <h2>Stitching Planning – Order Setup</h2>
          <div className="field">
            <label>Stitching Unit</label>
            <UnitSelect value={unit} onChange={setUnit} />
          </div>
        </div>
        <button type="button" className="edit-btn" onClick={() => setPanel(panel === 'defaultLc' ? null : 'defaultLc')}>Default Learning Curve</button>
      </div>

      <div className="sob-toolbar">
        <button type="button" className="save-btn" onClick={openPopulate}>Populate Orders</button>
        <button type="button" className="remove-btn-text" onClick={handleDelete} disabled={!selected.size}>Delete</button>
        <button type="button" className="edit-btn" onClick={handleSave} disabled={!dirtyCount}>Save{dirtyCount ? ` (${dirtyCount})` : ''}</button>
        <button type="button" className="regen-btn" onClick={openAddForm}>Add Unconfirmed Order</button>
        <button type="button" className="regen-btn" onClick={() => setPanel(panel === 'combine' ? null : 'combine')} disabled={selected.size < 2}>Combine</button>
        <button type="button" className="regen-btn" onClick={handleDecombine} disabled={!selected.size}>De-Combine</button>
        <span className="sob-count">{loading ? 'Loading…' : `${fmt(visibleOrders.length)} order(s) in ${unitText}${selected.size ? ` · ${selected.size} selected` : ''}`}</span>
      </div>

      {error && <div className="search-error">{error}</div>}
      {message && <div className="poc-success">{message}</div>}

      {panel === 'populate' && (
        <div className="sob-panel">
          <h3>Populate orders into {unitText}</h3>
          <div className="sob-panel-grid">
            <fieldset className="sob-radio">
              <legend>Orders</legend>
              {['Confirmed', 'Unconfirmed', 'Both'].map((t) => (
                <label key={t}><input type="radio" name="otype" checked={pop.orderType === t} onChange={() => setPop((p) => ({ ...p, orderType: t }))} />
                  {t === 'Unconfirmed' ? 'Unconfirmed (TBA)' : t}</label>
              ))}
            </fieldset>
            <div className="field"><label>Ship date from</label><input type="date" value={pop.shipFrom} onChange={(e) => setPop((p) => ({ ...p, shipFrom: e.target.value }))} /></div>
            <div className="field"><label>Ship date to</label><input type="date" value={pop.shipTo} onChange={(e) => setPop((p) => ({ ...p, shipTo: e.target.value }))} /></div>
            <div className="field">
              <label>Buyer</label>
              <select value={pop.buyerId} onChange={(e) => setPop((p) => ({ ...p, buyerId: e.target.value }))}>
                <option value="">All buyers</option>
                {popOptions.buyers.map((b) => <option key={b.BUYER_ID} value={b.BUYER_ID}>{b.BUYER_NAME}</option>)}
              </select>
            </div>
            <div className="field">
              <label>Season</label>
              <select value={pop.season} onChange={(e) => setPop((p) => ({ ...p, season: e.target.value }))}>
                <option value="">All seasons</option>
                {popOptions.seasons.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div className="field"><label>Style contains</label><input value={pop.style} onChange={(e) => setPop((p) => ({ ...p, style: e.target.value }))} /></div>
            <div className="field"><label>Extra % on buyer qty</label><input type="number" min="0" max="100" step="0.5" value={pop.extraPct} onChange={(e) => setPop((p) => ({ ...p, extraPct: e.target.value }))} /></div>
            <div className="field"><label>Productivity / hour</label><input type="number" min="1" placeholder="from POC line" value={pop.productivity} onChange={(e) => setPop((p) => ({ ...p, productivity: e.target.value }))} /></div>
            <fieldset className="sob-radio">
              <legend>Production start date</legend>
              <label><input type="radio" name="smode" checked={pop.startMode === 'beforeShip'} onChange={() => setPop((p) => ({ ...p, startMode: 'beforeShip' }))} />
                <input type="number" min="0" style={{ width: 60 }} value={pop.daysBeforeShip} onChange={(e) => setPop((p) => ({ ...p, daysBeforeShip: e.target.value, startMode: 'beforeShip' }))} /> days before ship date</label>
              <label><input type="radio" name="smode" checked={pop.startMode === 'fixed'} onChange={() => setPop((p) => ({ ...p, startMode: 'fixed' }))} />
                <input type="date" value={pop.startDate} onChange={(e) => setPop((p) => ({ ...p, startDate: e.target.value, startMode: 'fixed' }))} /></label>
              <label><input type="radio" name="smode" checked={pop.startMode === 'none'} onChange={() => setPop((p) => ({ ...p, startMode: 'none' }))} /> set later</label>
            </fieldset>
            <label className="sob-check"><input type="checkbox" checked={pop.learningCurve} onChange={(e) => setPop((p) => ({ ...p, learningCurve: e.target.checked }))} /> Build-up (learning curve) required</label>
          </div>
          <div className="sob-panel-actions">
            <button type="button" className="regen-btn" onClick={() => runPopulate(true)} disabled={busy || !unit}>Preview</button>
            <button type="button" className="save-btn" onClick={() => runPopulate(false)} disabled={busy || !unit || !preview || !preview.N}>Populate</button>
            <button type="button" className="remove-btn-text" onClick={() => setPanel(null)}>Cancel</button>
            {preview && (
              <span className="sob-preview">
                {preview.N ? <>
                  <b>{fmt(preview.N)}</b> order(s) not yet populated{preview.UNCONFIRMED ? ` (${fmt(preview.UNCONFIRMED)} unconfirmed)` : ''},
                  ship {preview.FIRST_SHIP} – {preview.LAST_SHIP}: buyer qty <b>{fmt(preview.BUYER_QTY)}</b> + {pop.extraPct || 0}% = <b>{fmt(preview.ORDER_QTY)}</b> pcs
                  {preview.NO_PRODUCTIVITY ? `; ${fmt(preview.NO_PRODUCTIVITY)} without productivity` : ''}
                </> : 'No matching orders that are not populated yet.'}
              </span>
            )}
          </div>
        </div>
      )}

      {panel === 'defaultLc' && (
        <div className="sob-panel">
          <h3>Default Learning Curve – {unitText}</h3>
          <p className="sob-note">
            Build-up of a new order on a line, as % of the order's productivity per production day. Used for orders with the
            build-up flag that have no curve of their own. {defaultLc.inherited ? 'This unit uses the all-units default until you save one for it.' : ''}
          </p>
          <label className="sob-check">
            <input type="checkbox" checked={defaultLc.required} onChange={(e) => setDefaultLc((d) => ({ ...d, required: e.target.checked }))} />
            Build-up required by default for newly populated orders
          </label>
          <table className="search-table sob-lc-table">
            <thead><tr><th>Day</th><th>% of productivity</th><th>e.g. at 260 pcs/h</th><th></th></tr></thead>
            <tbody>
              {defaultLc.days.map((d, i) => (
                <tr key={i}>
                  <td>{i + 1}</td>
                  <td><input type="number" min="1" max="100" value={d.pct} onChange={(e) => setLcPct(i, e.target.value)} /></td>
                  <td>{Math.round((260 * (Number(d.pct) || 0)) / 100)} pcs/h</td>
                  <td><button type="button" className="remove-btn" onClick={() => setDefaultLc((x) => ({ ...x, days: x.days.filter((_, j) => j !== i) }))} aria-label={`Remove day ${i + 1}`}>&times;</button></td>
                </tr>
              ))}
              {defaultLc.days.length === 0 && <tr><td colSpan="4" className="no-results">No build-up days</td></tr>}
            </tbody>
          </table>
          <div className="sob-panel-actions">
            <button type="button" className="regen-btn" onClick={() => setDefaultLc((d) => ({ ...d, days: [...d.days, { pct: 100 }] }))}>Add day</button>
            <button type="button" className="save-btn" onClick={saveDefaultLc} disabled={!unit}>Save default</button>
            <button type="button" className="remove-btn-text" onClick={() => { setPanel(null); loadDefaultLc(); }}>Close</button>
          </div>
        </div>
      )}

      {panel === 'add' && (
        <div className="sob-inline-form">
          <div className="field">
            <label>FOB Line</label>
            <select value={newOrder.fobId} onChange={(e) => setNewOrder((n) => ({ ...n, fobId: e.target.value }))}>
              {fobOptions.map((f) => <option key={f.FOB_ID} value={f.FOB_ID}>{f.STYLE} — {f.WASH_NAME}/{f.COLOR} (FOB {f.FOB_ID})</option>)}
            </select>
          </div>
          <div className="field"><label>Buyer Qty</label><input type="number" value={newOrder.orderQty} onChange={(e) => setNewOrder((n) => ({ ...n, orderQty: e.target.value }))} /></div>
          <div className="field"><label>Extra %</label><input type="number" min="0" max="100" value={newOrder.extraPct} onChange={(e) => setNewOrder((n) => ({ ...n, extraPct: e.target.value }))} /></div>
          <div className="field"><label>Ship Date</label><input type="date" value={newOrder.shipDate} onChange={(e) => setNewOrder((n) => ({ ...n, shipDate: e.target.value }))} /></div>
          <button type="button" className="save-btn" onClick={handleAddUnconfirmed}>Add</button>
          <button type="button" className="remove-btn-text" onClick={() => setPanel(null)}>Cancel</button>
        </div>
      )}

      {panel === 'combine' && (
        <div className="sob-inline-form">
          <span className="sob-note">Join {selected.size} orders into one production batch (one strip).</span>
          <div className="field">
            <label>Production Unit</label>
            <UnitSelect value={combineForm.productionUnit || unit} onChange={(v) => setCombineForm((f) => ({ ...f, productionUnit: v }))} />
          </div>
          <div className="field"><label>Sewing Start Date</label><input type="date" value={combineForm.sewingStartDate} onChange={(e) => setCombineForm((f) => ({ ...f, sewingStartDate: e.target.value }))} /></div>
          <div className="field"><label>Sewing End Date</label><input type="date" value={combineForm.sewingEndDate} onChange={(e) => setCombineForm((f) => ({ ...f, sewingEndDate: e.target.value }))} /></div>
          <button type="button" className="save-btn" onClick={handleCombine}>Confirm Combine</button>
          <button type="button" className="remove-btn-text" onClick={() => setPanel(null)}>Cancel</button>
        </div>
      )}

      <div className="table-scroll">
        <table className="search-table sob-table">
          <thead>
            <tr className="sob-filter-row">
              <th></th><th></th><th></th><th></th>
              {FILTER_COLS.slice(0, 3).map((c) => <th key={c}>{filterInput(c)}</th>)}
              <th></th><th></th><th></th>
              {FILTER_COLS.slice(3, 10).map((c) => <th key={c}>{filterInput(c)}</th>)}
              <th></th><th></th><th></th><th></th>
              <th>{filterInput('BOARD')}</th>
            </tr>
            <tr>
              <th><input type="checkbox" checked={allShownSelected} onChange={toggleAllShown} aria-label="Select all shown" /></th>
              <th className="sob-sortable" onClick={() => toggleSort('ORDER_SETUP_ID')}>OrderSetupId{sortIndicator('ORDER_SETUP_ID')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('COMBINE_ID')}>Combine Id{sortIndicator('COMBINE_ID')}</th>
              <th title="Learning curve flag: build-up required">Build-up</th>
              <th className="sob-sortable" onClick={() => toggleSort('ORDER_TYPE')}>Order Type{sortIndicator('ORDER_TYPE')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('BPO_NUMBER')}>Bpo{sortIndicator('BPO_NUMBER')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('POC_ID')}>Poc Id{sortIndicator('POC_ID')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('BUYER_QTY')}>Buyer Qty{sortIndicator('BUYER_QTY')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('EXTRA_PCT')}>Extra %{sortIndicator('EXTRA_PCT')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('ORDER_QTY')}>Order Qty{sortIndicator('ORDER_QTY')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('BUYER_NAME')}>Buyer Name{sortIndicator('BUYER_NAME')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('SEASON')}>Season{sortIndicator('SEASON')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('STYLE')}>Style{sortIndicator('STYLE')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('COLOR')}>Color{sortIndicator('COLOR')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('WASH_NAME')}>Wash Name{sortIndicator('WASH_NAME')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('ITEM_DESCRIPTION')}>Item Description{sortIndicator('ITEM_DESCRIPTION')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('SHIP_DATE')}>Ship date{sortIndicator('SHIP_DATE')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('UNIT')}>Production Unit{sortIndicator('UNIT')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('PRODUCTIVITY')}>Productivity / h{sortIndicator('PRODUCTIVITY')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('SEWING_START_DATE')}>Sewing Start Date{sortIndicator('SEWING_START_DATE')}</th>
              <th className="sob-sortable" onClick={() => toggleSort('SEWING_END_DATE')}>Sewing End Date{sortIndicator('SEWING_END_DATE')}</th>
              <th title="Strip state on the planning board">Board</th>
            </tr>
          </thead>
          <tbody>
            {shownOrders.map((o) => (
              <tr key={o.ORDER_SETUP_ID} className={[o.ORDER_TYPE === 'Confirmed' ? 'sob-confirmed' : 'sob-projection', o._dirty ? 'sob-dirty' : '', selected.has(o.ORDER_SETUP_ID) ? 'sob-selected' : ''].filter(Boolean).join(' ')}>
                <td><input type="checkbox" checked={selected.has(o.ORDER_SETUP_ID)} onChange={() => toggleSelect(o.ORDER_SETUP_ID)} aria-label={`Select order ${o.ORDER_SETUP_ID}`} /></td>
                <td>{o.ORDER_SETUP_ID}</td>
                <td>{o.COMBINE_ID ? <span className="sob-combine">#{o.COMBINE_ID}</span> : ''}</td>
                <td className="sob-nowrap">
                  <input type="checkbox" checked={o.LEARNING_CURVE_FLAG === 'Y'} onChange={(e) => updateOrderField(o.ORDER_SETUP_ID, 'LEARNING_CURVE_FLAG', e.target.checked ? 'Y' : 'N')} aria-label="Build-up required" />
                  <span className="sob-muted"> {buildUpText(o)}</span>
                </td>
                <td>{o.ORDER_TYPE}</td>
                <td>{o.BPO_NUMBER ?? ''}</td>
                <td>{o.POC_ID}</td>
                <td><input type="number" className="sob-num" value={o.BUYER_QTY ?? ''} onChange={(e) => updateOrderField(o.ORDER_SETUP_ID, 'BUYER_QTY', e.target.value)} /></td>
                <td><input type="number" className="sob-pct" min="0" max="100" step="0.5" value={o.EXTRA_PCT ?? 0} onChange={(e) => updateOrderField(o.ORDER_SETUP_ID, 'EXTRA_PCT', e.target.value)} /></td>
                <td className="sob-qty">{fmt(o.ORDER_QTY)}</td>
                <td className="sob-nowrap">{o.BUYER_NAME}</td>
                <td>{o.SEASON}</td>
                <td>{o.STYLE}</td>
                <td>{o.COLOR}</td>
                <td>{o.WASH_NAME}</td>
                <td className="sob-nowrap">{o.ITEM_DESCRIPTION}</td>
                <td>{o.SHIP_DATE}</td>
                <td><UnitSelect value={o.UNIT ?? ''} onChange={(v) => updateOrderField(o.ORDER_SETUP_ID, 'UNIT', v)} allowBlank disabled={o.STRIPS > 0} /></td>
                <td><input type="number" className="sob-num" min="0" value={o.PRODUCTIVITY ?? ''} onChange={(e) => updateOrderField(o.ORDER_SETUP_ID, 'PRODUCTIVITY', e.target.value)} /></td>
                <td><input type="date" value={o.SEWING_START_DATE ?? ''} onChange={(e) => updateOrderField(o.ORDER_SETUP_ID, 'SEWING_START_DATE', e.target.value)} /></td>
                <td><input type="date" value={o.SEWING_END_DATE ?? ''} onChange={(e) => updateOrderField(o.ORDER_SETUP_ID, 'SEWING_END_DATE', e.target.value)} /></td>
                <td><span className={`sob-board sob-board-${boardStatus(o) === 'On line' ? 'line' : boardStatus(o) === 'Waiting' ? 'wait' : 'none'}`}>{boardStatus(o)}</span></td>
              </tr>
            ))}
            {visibleOrders.length === 0 && orders.length > 0 && <tr><td colSpan="22" className="no-results">No orders match the filters</td></tr>}
            {orders.length === 0 && !loading && <tr><td colSpan="22" className="no-results">No orders in {unitText} yet — Populate Orders or Add Unconfirmed Order</td></tr>}
          </tbody>
          {orders.length > 0 && (
            <tfoot>
              <tr>
                <td colSpan="7" style={{ textAlign: 'right', fontWeight: 600 }}>
                  Total ({fmt(visibleOrders.length)}){visibleOrders.length > MAX_ROWS ? ` · first ${MAX_ROWS} shown, use the filters` : ''}
                </td>
                <td style={{ fontWeight: 700 }}>{fmt(totals.buyer)}</td>
                <td></td>
                <td style={{ fontWeight: 700 }}>{fmt(totals.order)}</td>
                <td colSpan="12"></td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {/* Learning Curve (build-up) of the selected order */}
      <div className="sob-lc-panel">
        <div className="sob-toolbar">
          <strong className="sob-lc-title">Build-up{selectedOrder ? ` – order #${selectedOrder.ORDER_SETUP_ID} ${selectedOrder.STYLE || ''}` : ''}</strong>
          <button type="button" className="regen-btn" onClick={addLcRow} disabled={!selectedOrderId}>Add</button>
          <button type="button" className="remove-btn-text" onClick={deleteLcRows} disabled={!selectedOrderId}>Delete</button>
          <button type="button" className="edit-btn" onClick={copyLcRows} disabled={!selectedOrderId}>Copy</button>
          <button type="button" className="edit-btn" onClick={applyDefaultLc} disabled={!selectedOrderId}>Apply default</button>
          <button type="button" className="save-btn" onClick={saveLcRows} disabled={!selectedOrderId}>Save</button>
        </div>
        {!selectedOrderId && <div className="no-results">Select exactly one order above to see or edit its build-up</div>}
        {lcError && <div className="search-error">{lcError}</div>}
        {selectedOrder && selectedOrder.LEARNING_CURVE_FLAG === 'Y' && lcRows.length === 0 && (
          <div className="sob-note">
            No own curve: this order uses the default {defaultLc.days.map((d) => `${d.pct}%`).join(' / ') || '(empty)'}
            {selectedOrder.PRODUCTIVITY ? ` = ${defaultLc.days.map((d) => Math.round((Number(selectedOrder.PRODUCTIVITY) * d.pct) / 100)).join(' / ')} pcs/h, then ${selectedOrder.PRODUCTIVITY} pcs/h.` : '.'}
          </div>
        )}
        {selectedOrder && selectedOrder.LEARNING_CURVE_FLAG !== 'Y' && (
          <div className="sob-note">Build-up not required for this order: it runs at full productivity from day 1. Tick Build-up to use a curve.</div>
        )}
        {selectedOrderId && (
          <table className="search-table sob-lc-table">
            <thead><tr><th>Select</th><th>Day No</th><th>Hourly productivity</th></tr></thead>
            <tbody>
              {lcRows.map((row, idx) => (
                <tr key={row.LEARNING_CURVE_ID ?? `new-${idx}`}>
                  <td><input type="checkbox" checked={lcSelected.has(row.LEARNING_CURVE_ID ?? row.DAY_NO)} onChange={() => toggleLcSelect(row.LEARNING_CURVE_ID ?? row.DAY_NO)} /></td>
                  <td><input type="number" value={row.DAY_NO} onChange={(e) => updateLcRow(idx, 'DAY_NO', Number(e.target.value))} /></td>
                  <td><input type="number" value={row.HOURLY_PRODUCTIVITY ?? ''} onChange={(e) => updateLcRow(idx, 'HOURLY_PRODUCTIVITY', e.target.value)} /></td>
                </tr>
              ))}
              {lcRows.length === 0 && <tr><td colSpan="3" className="no-results">No own build-up rows</td></tr>}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
