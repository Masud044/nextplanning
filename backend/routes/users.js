const express = require('express');
const bcrypt = require('bcryptjs');
const oracledb = require('oracledb');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');
const { requireRole } = require('../middleware/role');

const router = express.Router();
router.use(requireAuth);

const ROLES = ['ADMIN', 'PLANNER', 'USER'];

// GET /api/users - list
router.get('/', async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT ID, USERNAME, FULL_NAME, ROLE, CREATED_AT FROM APP_USERS ORDER BY ID`
    );
    res.json(result.rows);
  } catch (err) {
    console.error('List users error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// POST /api/users - create (new users start as USER; ADMIN only)
router.post('/', requireRole('ADMIN'), async (req, res) => {
  const { username, password, fullName } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' });
  }

  let conn;
  try {
    const hash = await bcrypt.hash(password, 10);
    conn = await getConnection();
    const result = await conn.execute(
      `INSERT INTO APP_USERS (USERNAME, PASSWORD_HASH, FULL_NAME)
       VALUES (:username, :hash, :fullName)
       RETURNING ID INTO :outId`,
      {
        username,
        hash,
        fullName: fullName ?? null,
        outId: { type: oracledb.NUMBER, dir: oracledb.BIND_OUT },
      },
      { autoCommit: true }
    );
    res.status(201).json({ id: result.outBinds.outId[0] });
  } catch (err) {
    if (err.errorNum === 1) {
      return res.status(409).json({ message: 'Username already exists' });
    }
    console.error('Create user error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// PUT /api/users/:id - update full name and/or reset password; role changes need ADMIN
router.put('/:id', async (req, res) => {
  const { fullName, password, role } = req.body;

  let conn;
  try {
    conn = await getConnection();

    if (role !== undefined) {
      if (!ROLES.includes(role)) return res.status(400).json({ message: `Role must be one of ${ROLES.join(', ')}` });
      const current = await conn.execute(`SELECT ID, ROLE FROM APP_USERS`);
      const me = current.rows.find((u) => String(u.ID) === String(req.user.id));
      const target = current.rows.find((u) => String(u.ID) === String(req.params.id));
      if (!target) return res.status(404).json({ message: 'User not found' });
      if (target.ROLE !== role) {
        if (!me || me.ROLE !== 'ADMIN') return res.status(403).json({ message: 'Only ADMIN users can change roles' });
        if (target.ROLE === 'ADMIN' && current.rows.filter((u) => u.ROLE === 'ADMIN').length === 1) {
          return res.status(400).json({ message: 'At least one ADMIN user is required' });
        }
        await conn.execute(`UPDATE APP_USERS SET ROLE = :role WHERE ID = :id`, { role, id: req.params.id }, { autoCommit: true });
      }
    }

    if (password) {
      const hash = await bcrypt.hash(password, 10);
      await conn.execute(
        `UPDATE APP_USERS SET FULL_NAME = :fullName, PASSWORD_HASH = :hash WHERE ID = :id`,
        { fullName: fullName ?? null, hash, id: req.params.id },
        { autoCommit: true }
      );
    } else {
      await conn.execute(
        `UPDATE APP_USERS SET FULL_NAME = :fullName WHERE ID = :id`,
        { fullName: fullName ?? null, id: req.params.id },
        { autoCommit: true }
      );
    }

    res.json({ message: 'Updated' });
  } catch (err) {
    console.error('Update user error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

// DELETE /api/users/:id (ADMIN only)
router.delete('/:id', requireRole('ADMIN'), async (req, res) => {
  if (String(req.user.id) === String(req.params.id)) {
    return res.status(400).json({ message: 'Cannot delete your own account' });
  }

  let conn;
  try {
    conn = await getConnection();
    await conn.execute(
      `DELETE FROM APP_USERS WHERE ID = :id`,
      { id: req.params.id },
      { autoCommit: true }
    );
    res.json({ message: 'Deleted' });
  } catch (err) {
    console.error('Delete user error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
