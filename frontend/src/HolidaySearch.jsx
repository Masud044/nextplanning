import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './PocSearch.css';
import UnitSelect, { useUnits, unitLabel } from './UnitSelect';
import useRole from './useRole';
import HolidayTypes from './HolidayTypes';

const API_URL = 'http://localhost:5000/api';
const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

export default function HolidaySearch() {
  const [filters, setFilters] = useState({ operationUnit: '', month: '', year: '' });
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const updateFilter = (field, value) => setFilters((f) => ({ ...f, [field]: value }));
  const { canPlan, isAdmin } = useRole();
  const [showTypes, setShowTypes] = useState(false);

  // start filtered on the default unit (AMS); "All units" stays available
  const { units, defaultUnit } = useUnits();
  const defaultApplied = useRef(false);
  useEffect(() => {
    if (defaultUnit && !defaultApplied.current) {
      defaultApplied.current = true;
      setFilters((f) => (f.operationUnit ? f : { ...f, operationUnit: String(defaultUnit.UNIT_ID) }));
    }
  }, [defaultUnit]);
  const unitText = (id) => unitLabel(units.find((u) => String(u.UNIT_ID) === String(id))) || id;

  const runSearch = async (e) => {
    if (e) e.preventDefault();
    setError('');
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params.append(k, v);
      });
      const res = await fetch(`${API_URL}/holiday?${params.toString()}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Search failed');
        return;
      }
      setResults(data);
      setSearched(true);
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const handleDelete = async (planId) => {
    setError('');
    try {
      const token = localStorage.getItem('token');
      const res = await fetch(`${API_URL}/holiday/${planId}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` },
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Delete failed');
        return;
      }
      setResults((prev) => prev.filter((r) => r.HOLIDAY_PLAN_ID !== planId));
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  return (
    <div className="poc-search">
      <div className="poc-search-header">
        <h2>Holiday Planning</h2>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {isAdmin && (
            <button type="button" className="edit-btn" onClick={() => setShowTypes((s) => !s)}>
              {showTypes ? 'Hide Holiday Types' : 'Holiday Types'}
            </button>
          )}
          {canPlan && (
            <button className="new-btn" onClick={() => navigate('/holiday/new')}>
              + New Plan
            </button>
          )}
        </div>
      </div>
      {isAdmin && showTypes && <HolidayTypes />}

      <form className="search-bar" onSubmit={runSearch}>
        <UnitSelect
          value={filters.operationUnit}
          onChange={(v) => updateFilter('operationUnit', v)}
          allowAll="All units"
        />
        <select value={filters.month} onChange={(e) => updateFilter('month', e.target.value)}>
          <option value="">Any Month</option>
          {MONTH_NAMES.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
        <input
          placeholder="Year"
          value={filters.year}
          onChange={(e) => updateFilter('year', e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {error && <div className="search-error">{error}</div>}

      <div className="table-scroll">
        <table className="search-table">
          <thead>
            <tr>
              <th>Operation Unit</th>
              <th>Month</th>
              <th>Year</th>
              <th>Weekly Holiday</th>
              <th>Total Days</th>
              <th>Working Days</th>
              <th>Holidays</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.HOLIDAY_PLAN_ID}>
                <td>{unitText(row.OPERATION_UNIT)}</td>
                <td>{MONTH_NAMES[row.PLAN_MONTH - 1]}</td>
                <td>{row.PLAN_YEAR}</td>
                <td>{row.WEEKLY_HOLIDAY_DAY}</td>
                <td>{row.TOTAL_DAYS}</td>
                <td>{row.WORKING_DAYS}</td>
                <td>{row.HOLIDAYS_COUNT}</td>
                <td style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className="edit-btn" onClick={() => navigate(`/holiday/${row.HOLIDAY_PLAN_ID}/edit`)}>
                    {canPlan ? 'Edit' : 'View'}
                  </button>
                  {canPlan && (
                    <button className="remove-btn" onClick={() => handleDelete(row.HOLIDAY_PLAN_ID)} aria-label="Delete plan">
                      &times;
                    </button>
                  )}
                </td>
              </tr>
            ))}
            {searched && results.length === 0 && (
              <tr>
                <td colSpan="8" className="no-results">No plans found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
