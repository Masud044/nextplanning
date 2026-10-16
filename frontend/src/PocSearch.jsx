import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import './PocSearch.css';

const API_URL = 'http://localhost:5000/api';

export default function PocSearch() {
  const [filters, setFilters] = useState({ style: '', season: '', brand: '' });
  const [results, setResults] = useState([]);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState('');
  const navigate = useNavigate();

  const updateFilter = (field, value) => setFilters((f) => ({ ...f, [field]: value }));

  const runSearch = async (e) => {
    if (e) e.preventDefault();
    setError('');
    try {
      const token = localStorage.getItem('token');
      const params = new URLSearchParams();
      Object.entries(filters).forEach(([k, v]) => {
        if (v) params.append(k, v);
      });
      const res = await fetch(`${API_URL}/poc?${params.toString()}`, {
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

  useEffect(() => {
    runSearch();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="poc-search">
      <div className="poc-search-header">
        <h2>POC Search</h2>
        <button className="new-btn" onClick={() => navigate('/poc/new')}>
          + New POC
        </button>
      </div>

      <form className="search-bar" onSubmit={runSearch}>
        <input
          placeholder="Style"
          value={filters.style}
          onChange={(e) => updateFilter('style', e.target.value)}
        />
        <input
          placeholder="Season"
          value={filters.season}
          onChange={(e) => updateFilter('season', e.target.value)}
        />
        <input
          placeholder="Brand"
          value={filters.brand}
          onChange={(e) => updateFilter('brand', e.target.value)}
        />
        <button type="submit">Search</button>
      </form>

      {error && <div className="search-error">{error}</div>}

      <div className="table-scroll">
        <table className="search-table">
          <thead>
            <tr>
              <th>POC ID</th>
              <th>Style</th>
              <th>Season</th>
              <th>Brand</th>
              <th>Order Qty</th>
              <th>GM Approval</th>
              <th>Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {results.map((row) => (
              <tr key={row.POC_ID}>
                <td>{row.POC_ID}</td>
                <td>{row.STYLE}</td>
                <td>{row.SEASON}</td>
                <td>{row.BRAND}</td>
                <td>{row.ORDER_QTY}</td>
                <td>{row.GM_APPROVAL}</td>
                <td>{row.STATUS}</td>
                <td style={{ display: 'flex', gap: '0.4rem' }}>
                  <button className="edit-btn" onClick={() => navigate(`/poc/${row.POC_ID}/edit`)}>
                    Edit
                  </button>
                  <button className="edit-btn" onClick={() => navigate(`/poc/${row.POC_ID}/bpo`)}>
                    BPO
                  </button>
                </td>
              </tr>
            ))}
            {searched && results.length === 0 && (
              <tr>
                <td colSpan="8" className="no-results">
                  No records found
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
