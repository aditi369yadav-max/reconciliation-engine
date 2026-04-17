import { Pool, PoolClient } from 'pg';
import { config } from '../../config';
import { logger } from '../../utils/logger';

let pool: Pool | null = null;

export const getPool = (): Pool => {
  if (!pool) {
    pool = new Pool({
      connectionString: process.env.DATABASE_URL,
      host:     process.env.DATABASE_URL ? undefined : config.db.host,
      port:     process.env.DATABASE_URL ? undefined : config.db.port,
      database: process.env.DATABASE_URL ? undefined : config.db.database,
      user:     process.env.DATABASE_URL ? undefined : config.db.user,
      password: process.env.DATABASE_URL ? undefined : config.db.password,
      ssl:      process.env.DATABASE_URL ? { rejectUnauthorized: false } : false,
      max: 10, idleTimeoutMillis: 30000, connectionTimeoutMillis: 5000,
    });
    pool.on('error', (err) => logger.error('PG pool error', { error: err.message }));
  }
  return pool;
};

export const withTransaction = async <T>(cb: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await cb(client);
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

export const query = async <T = unknown>(sql: string, params?: unknown[]): Promise<T[]> => {
  const r = await getPool().query(sql, params);
  return r.rows as T[];
};

export const queryOne = async <T = unknown>(sql: string, params?: unknown[]): Promise<T | null> => {
  const rows = await query<T>(sql, params);
  return rows[0] ?? null;
};

export const closePool = async () => { if (pool) { await pool.end(); pool = null; } };
