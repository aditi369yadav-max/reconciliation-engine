import fs from 'fs';
import path from 'path';
import { Pool } from 'pg';
import dotenv from 'dotenv';
dotenv.config({ path: path.join(process.cwd(), '.env') });

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  host:     process.env.DATABASE_URL ? undefined : (process.env.DB_HOST ?? 'localhost'),
  port:     process.env.DATABASE_URL ? undefined : parseInt(process.env.DB_PORT ?? '5432'),
  database: process.env.DATABASE_URL ? undefined : (process.env.DB_NAME ?? 'reconciliation_engine'),
  user:     process.env.DATABASE_URL ? undefined : (process.env.DB_USER ?? 'postgres'),
  password: process.env.DATABASE_URL ? undefined : (process.env.DB_PASSWORD ?? 'postgres'),
  ssl:      process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
});

const migrate = async () => {
  const client = await pool.connect();
  try {
    await client.query(`CREATE TABLE IF NOT EXISTS schema_migrations (version VARCHAR(255) PRIMARY KEY, applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`);
    const dir   = path.join(process.cwd(), 'db', 'migrations');
    const files = fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort();
    for (const file of files) {
      const version = file.replace('.sql', '');
      const { rows } = await client.query('SELECT version FROM schema_migrations WHERE version=$1', [version]);
      if (rows.length > 0) { console.log(`  ✓ ${file} (already applied)`); continue; }
      console.log(`  → Applying ${file}...`);
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (version) VALUES ($1)', [version]);
        await client.query('COMMIT');
        console.log(`  ✓ ${file} applied`);
      } catch (e) { await client.query('ROLLBACK'); throw e; }
    }
    console.log('\n✅ All migrations applied\n');
  } finally { client.release(); await pool.end(); }
};

migrate().catch(e => { console.error('Migration failed:', e.message); process.exit(1); });
