import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

const run = async () => {
  const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false },
  });
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const { rows } = await client.query('SELECT version FROM schema_migrations WHERE version=$1', ['001_schema']);
    if (rows.length === 0) {
      const sql = fs.readFileSync(path.join(__dirname, '..', 'db', 'migrations', '001_schema.sql'), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', ['001_schema']);
      console.log('Migration applied');
    } else {
      console.log('Migration already applied');
    }
  } finally {
    client.release();
    await pool.end();
  }
};

run().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });