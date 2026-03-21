const { Pool } = require('pg');

// Single connection pool shared across all requests
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
  max: 10,           // max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  console.error('Unexpected database pool error:', err);
});

// Simple wrapper so routes can do: const { rows } = await db.query(...)
const db = {
  query: (text, params) => pool.query(text, params),
  pool,
};

module.exports = db;
