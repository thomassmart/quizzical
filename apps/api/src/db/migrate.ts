import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './client.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function migrationsDir(): string {
  return path.resolve(__dirname, '../../migrations');
}

/** List migration filenames that have not been applied yet. */
export async function pendingMigrations(): Promise<string[]> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);
  const files = (await fs.readdir(migrationsDir()))
    .filter((f) => f.endsWith('.sql'))
    .sort();
  const pending: string[] = [];
  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE id = $1',
      [file],
    );
    if (!rows.length) pending.push(file);
  }
  return pending;
}

/**
 * Apply all pending SQL migrations.
 * @param endPool - when true (CLI), close the pool; when false (app boot), leave it open.
 */
export async function runMigrations(opts?: {
  endPool?: boolean;
}): Promise<{ applied: string[] }> {
  const endPool = opts?.endPool ?? false;
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  const dir = migrationsDir();
  const files = (await fs.readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];

  for (const file of files) {
    const { rows } = await pool.query(
      'SELECT 1 FROM schema_migrations WHERE id = $1',
      [file],
    );
    if (rows.length) {
      console.log(`skip ${file}`);
      continue;
    }
    const sql = await fs.readFile(path.join(dir, file), 'utf8');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [
        file,
      ]);
      await client.query('COMMIT');
      console.log(`applied ${file}`);
      applied.push(file);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error(`FAILED migration ${file}:`, e);
      throw e;
    } finally {
      client.release();
    }
  }

  if (endPool) await pool.end();
  return { applied };
}

async function migrateCli() {
  await runMigrations({ endPool: true });
}

const isMain = process.argv[1]?.includes('migrate');
if (isMain) {
  migrateCli().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
