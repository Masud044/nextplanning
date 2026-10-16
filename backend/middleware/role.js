const { getConnection } = require('../config/db');

// Role of the logged-in user, read from APP_USERS.ROLE (ADMIN / PLANNER / USER).
// Read on each check (not from the token) so a role change applies without logging in again.
async function getRole(userId) {
  let conn;
  try {
    conn = await getConnection();
    const r = await conn.execute(`SELECT ROLE FROM APP_USERS WHERE ID = :id`, { id: userId });
    return r.rows.length ? r.rows[0].ROLE : null;
  } finally {
    if (conn) await conn.close();
  }
}

// Use after requireAuth: router.post('/', requireRole('ADMIN', 'PLANNER'), handler)
const requireRole = (...roles) => async (req, res, next) => {
  try {
    const role = await getRole(req.user.id);
    if (!roles.includes(role)) {
      return res.status(403).json({ message: `Only ${roles.join(' / ')} users can do this. Your role: ${role || 'none'}.` });
    }
    req.user.role = role;
    next();
  } catch (err) {
    console.error('Role check error:', err);
    res.status(500).json({ message: 'Server error' });
  }
};

module.exports = { requireRole, getRole };
