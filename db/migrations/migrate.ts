import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';
import { Client } from 'pg';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Load .env from repository root
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const directUrl = process.env.NEON_DATABASE_DIRECT_URL;
if (!directUrl) {
  console.error('❌ Missing NEON_DATABASE_DIRECT_URL in environment variables.');
  process.exit(1);
}

async function run() {
  const isSeedMode = process.argv.includes('--seed');

  const client = new Client({
    connectionString: directUrl,
    ssl: {
      rejectUnauthorized: true,
    },
  });

  try {
    console.log('🔌 Connecting to Neon PostgreSQL (Direct URL)...');
    await client.connect();
    console.log('✅ Connected successfully.');

    if (isSeedMode) {
      const seedPath = path.resolve(__dirname, '../seed/seed_data.sql');
      const seedSql = fs.readFileSync(seedPath, 'utf-8');
      console.log('🌱 Running seed data...');
      await client.query(seedSql);
      console.log('✅ Seed data applied.');
      return;
    }

    // Ensure schema_migrations table exists before checking applied migrations
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        filename VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    const files = fs
      .readdirSync(__dirname)
      .filter((f) => f.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const { rows } = await client.query(
        'SELECT 1 FROM schema_migrations WHERE filename = $1',
        [file]
      );

      if (rows.length > 0) {
        console.log(`⏭️  Skipping already applied migration: ${file}`);
        continue;
      }

      const sql = fs.readFileSync(path.join(__dirname, file), 'utf-8');
      console.log(`🚀 Applying migration: ${file}...`);

      await client.query('BEGIN');
      try {
        await client.query(sql);
        await client.query(
          'INSERT INTO schema_migrations (filename) VALUES ($1)',
          [file]
        );
        await client.query('COMMIT');
        console.log(`✅ Applied ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      }
    }

    console.log('🎉 All migrations completed.');
  } finally {
    await client.end();
  }
}

run().catch((err) => {
  console.error('❌ Migration failed:', err);
  process.exit(1);
});
