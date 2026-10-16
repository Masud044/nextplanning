const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { getConnection } = require('../config/db');
const requireAuth = require('../middleware/auth');

const router = express.Router();

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  if (!username || !password) {
    return res.status(400).json({ message: 'Username and password required' });
  }

  let conn;
  try {
    conn = await getConnection();
    const result = await conn.execute(
      `SELECT ID, USERNAME, PASSWORD_HASH, FULL_NAME, ROLE FROM APP_USERS WHERE USERNAME = :username`,
      { username }
    );

    if (result.rows.length === 0) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const user = result.rows[0];
    const match = await bcrypt.compare(password, user.PASSWORD_HASH);

    if (!match) {
      return res.status(401).json({ message: 'Invalid username or password' });
    }

    const token = jwt.sign(
      { id: user.ID, username: user.USERNAME },
      process.env.JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      token,
      user: { id: user.ID, username: user.USERNAME, fullName: user.FULL_NAME, role: user.ROLE },
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) {
      try {
        await conn.close();
      } catch (e) {
        console.error('Error closing connection:', e);
      }
    }
  }
});

// GET /api/auth/me - the logged-in user with their current role (screens use it to switch to view-only)
router.get('/me', requireAuth, async (req, res) => {
  let conn;
  try {
    conn = await getConnection();
    const r = await conn.execute(`SELECT ID, USERNAME, FULL_NAME, ROLE FROM APP_USERS WHERE ID = :id`, { id: req.user.id });
    if (!r.rows.length) return res.status(404).json({ message: 'User not found' });
    const u = r.rows[0];
    res.json({ id: u.ID, username: u.USERNAME, fullName: u.FULL_NAME, role: u.ROLE });
  } catch (err) {
    console.error('Me error:', err);
    res.status(500).json({ message: 'Server error' });
  } finally {
    if (conn) await conn.close();
  }
});

module.exports = router;
