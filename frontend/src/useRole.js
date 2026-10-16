import { useEffect, useState } from 'react';

const API_URL = 'http://localhost:5000/api';

// Current user's role (ADMIN / PLANNER / USER), read from the server so a role change applies on the next page load.
// Cached per login token, so logging in as another user never reuses the previous user's role.
let cache = { token: null, promise: null };
const fetchRole = () => {
  const token = localStorage.getItem('token');
  if (cache.token !== token || !cache.promise) {
    const promise = fetch(`${API_URL}/auth/me`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .catch(() => null)
      .then((me) => {
        if (!me) { if (cache.promise === promise) cache = { token: null, promise: null }; return null; }
        return me.role || 'USER';
      });
    cache = { token, promise };
  }
  return cache.promise;
};

export const clearRoleCache = () => { cache = { token: null, promise: null }; };

// { role, loaded, known, isAdmin, canPlan }
// When the role cannot be determined (e.g. an older backend without /auth/me) the screens stay editable:
// the server still checks the role on every save, so nobody gains rights, but planners are never locked out.
export default function useRole() {
  const stored = (() => { try { return JSON.parse(localStorage.getItem('user'))?.role || null; } catch { return null; } })();
  const [role, setRole] = useState(stored);
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    let alive = true;
    fetchRole().then((r) => { if (alive) { if (r) setRole(r); setLoaded(true); } });
    return () => { alive = false; };
  }, []);
  const known = Boolean(role);
  return {
    role,
    loaded,
    known,
    isAdmin: role === 'ADMIN',
    canPlan: !known || role === 'ADMIN' || role === 'PLANNER',
  };
}
