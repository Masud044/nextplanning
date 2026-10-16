import { useEffect, useState } from 'react';
import './PocSearch.css';
import './PocForm.css';

const API_URL = 'http://localhost:5000/api';

const emptyNew = { username: '', password: '', fullName: '' };

export default function Users() {
  const [users, setUsers] = useState([]);
  const [newUser, setNewUser] = useState(emptyNew);
  const [resetPasswords, setResetPasswords] = useState({});
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
      const res = await fetch(`${API_URL}/users`, { headers: authHeaders() });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Failed to load users');
        return;
      }
      setUsers(data);
    } catch (err) {
      setError('Cannot reach server.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleCreate = async (e) => {
    e.preventDefault();
    setError('');
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/users`, {
        method: 'POST',
        headers: authHeaders(),
        body: JSON.stringify(newUser),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Create failed');
        return;
      }
      setMessage(`User "${newUser.username}" created.`);
      setNewUser(emptyNew);
      load();
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const updateExisting = (id, field, value) => {
    setUsers((prev) => prev.map((u) => (u.ID === id ? { ...u, [field]: value } : u)));
  };

  const handleSave = async (u) => {
    setError('');
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/users/${u.ID}`, {
        method: 'PUT',
        headers: authHeaders(),
        body: JSON.stringify({ fullName: u.FULL_NAME, password: resetPasswords[u.ID] || undefined, role: u.ROLE }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Save failed');
        return;
      }
      setMessage(`User "${u.USERNAME}" updated.`);
      setResetPasswords((prev) => ({ ...prev, [u.ID]: '' }));
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  const handleDelete = async (u) => {
    setError('');
    setMessage('');
    try {
      const res = await fetch(`${API_URL}/users/${u.ID}`, {
        method: 'DELETE',
        headers: authHeaders(),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.message || 'Delete failed');
        return;
      }
      setUsers((prev) => prev.filter((row) => row.ID !== u.ID));
    } catch (err) {
      setError('Cannot reach server.');
    }
  };

  return (
    <div className="poc-search">
      <div className="poc-search-header">
        <h2>User Administration</h2>
      </div>

      {error && <div className="search-error">{error}</div>}
      {message && <div className="poc-success">{message}</div>}

      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Add User</h2>
      <form className="poc-grid" onSubmit={handleCreate} style={{ marginBottom: '2rem' }}>
        <div className="field">
          <label>Username</label>
          <input
            value={newUser.username}
            onChange={(e) => setNewUser((n) => ({ ...n, username: e.target.value }))}
            required
          />
        </div>
        <div className="field">
          <label>Password</label>
          <input
            type="password"
            value={newUser.password}
            onChange={(e) => setNewUser((n) => ({ ...n, password: e.target.value }))}
            required
          />
        </div>
        <div className="field">
          <label>Full Name</label>
          <input
            value={newUser.fullName}
            onChange={(e) => setNewUser((n) => ({ ...n, fullName: e.target.value }))}
          />
        </div>
        <div className="field" style={{ justifyContent: 'flex-end' }}>
          <button type="submit" className="save-btn">Add User</button>
        </div>
      </form>

      <h2 style={{ fontSize: '1rem', marginBottom: '0.75rem' }}>Existing Users</h2>
      <div className="table-scroll">
        <table className="search-table">
          <thead>
            <tr>
              <th>ID</th>
              <th>Username</th>
              <th>Full Name</th>
              <th title="ADMIN: everything, incl. users and holiday types · PLANNER: may edit holiday plans · USER: holiday plans read-only">Role</th>
              <th>Reset Password</th>
              <th>Created</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.ID}>
                <td>{u.ID}</td>
                <td>{u.USERNAME}</td>
                <td>
                  <input
                    value={u.FULL_NAME ?? ''}
                    onChange={(e) => updateExisting(u.ID, 'FULL_NAME', e.target.value)}
                  />
                </td>
                <td>
                  <select value={u.ROLE || 'USER'} onChange={(e) => updateExisting(u.ID, 'ROLE', e.target.value)} aria-label={`Role of ${u.USERNAME}`}>
                    <option value="ADMIN">ADMIN</option>
                    <option value="PLANNER">PLANNER</option>
                    <option value="USER">USER</option>
                  </select>
                </td>
                <td>
                  <input
                    type="password"
                    placeholder="leave blank to keep"
                    value={resetPasswords[u.ID] || ''}
                    onChange={(e) => setResetPasswords((prev) => ({ ...prev, [u.ID]: e.target.value }))}
                  />
                </td>
                <td>{u.CREATED_AT ? String(u.CREATED_AT).slice(0, 10) : ''}</td>
                <td style={{ display: 'flex', gap: '0.4rem' }}>
                  <button type="button" className="edit-btn" onClick={() => handleSave(u)}>Save</button>
                  <button type="button" className="remove-btn" onClick={() => handleDelete(u)}>&times;</button>
                </td>
              </tr>
            ))}
            {!loading && users.length === 0 && (
              <tr>
                <td colSpan="7" className="no-results">No users found</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
