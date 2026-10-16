const oracledb = require('oracledb');
require('dotenv').config();

oracledb.outFormat = oracledb.OUT_FORMAT_OBJECT;

let pool;

async function initPool() {
  if (pool) return pool;
  pool = await oracledb.createPool({
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    connectString: process.env.DB_CONNECT_STRING,
    poolMin: 1,
    poolMax: 10,
    poolIncrement: 1,
  });
  console.log('Oracle connection pool created');
  return pool;
}

async function getConnection() {
  if (!pool) await initPool();
  return pool.getConnection();
}

module.exports = { initPool, getConnection };
