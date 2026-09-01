// PostgreSQL database connection and schema for 7 Seasons
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is not set — cannot connect to PostgreSQL");
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

async function initSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS couples (
      id TEXT PRIMARY KEY,
      invite_code TEXT UNIQUE NOT NULL,
      status TEXT DEFAULT 'waiting_partner',
      couple_track TEXT DEFAULT 'standard',
      season_track TEXT DEFAULT 'standard',
      season_current INTEGER,
      season_next INTEGER,
      season_progress REAL DEFAULT 0.0,
      season_updated TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS individuals (
      id TEXT PRIMARY KEY,
      couple_id TEXT NOT NULL,
      role TEXT NOT NULL,
      name TEXT NOT NULL,
      current_domain INTEGER DEFAULT 0,
      onboarding_complete INTEGER DEFAULT 0,
      dimensions TEXT DEFAULT '{}',
      domain_summaries TEXT DEFAULT '{}',
      email TEXT,
      password_hash TEXT,
      bio TEXT DEFAULT '{}',
      bio_complete INTEGER DEFAULT 0,
      total_time_seconds INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id SERIAL PRIMARY KEY,
      individual_id TEXT NOT NULL,
      domain_index INTEGER NOT NULL,
      messages TEXT DEFAULT '[]',
      completed INTEGER DEFAULT 0,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      updated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS marriage_models (
      id SERIAL PRIMARY KEY,
      couple_id TEXT UNIQUE NOT NULL,
      model TEXT DEFAULT '{}',
      report TEXT DEFAULT '{}',
      generated_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS arguments (
      id TEXT PRIMARY KEY,
      couple_id TEXT NOT NULL,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS argument_responses (
      id TEXT PRIMARY KEY,
      argument_id TEXT NOT NULL,
      individual_id TEXT NOT NULL,
      messages TEXT DEFAULT '[]',
      snap_s TEXT DEFAULT '',
      snap_n TEXT DEFAULT '',
      snap_a TEXT DEFAULT '',
      snap_p TEXT DEFAULT '',
      ownership_level TEXT DEFAULT '',
      completed INTEGER DEFAULT 0,
      submitted_at TIMESTAMPTZ,
      UNIQUE(argument_id, individual_id)
    );

    CREATE TABLE IF NOT EXISTS argument_synthesis (
      id SERIAL PRIMARY KEY,
      argument_id TEXT UNIQUE NOT NULL,
      couple_view TEXT DEFAULT '{}',
      counselor_view TEXT DEFAULT '{}',
      generated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS timeline_entries (
      id SERIAL PRIMARY KEY,
      couple_id TEXT NOT NULL,
      entry_type TEXT NOT NULL,
      title TEXT NOT NULL,
      description TEXT DEFAULT '',
      entry_date TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS premarital_sessions (
      id SERIAL PRIMARY KEY,
      couple_id TEXT NOT NULL,
      session_num INTEGER NOT NULL,
      messages TEXT DEFAULT '[]',
      completed INTEGER DEFAULT 0,
      completed_at TIMESTAMPTZ,
      UNIQUE(couple_id, session_num)
    );

    -- Joint session, both spouses present, after individual discovery is done
    -- but before the Marriage Model/Trajectory Report is generated. Seven
    -- reviews both profiles ahead of time (briefing) then facilitates live.
    CREATE TABLE IF NOT EXISTS final_interviews (
      id SERIAL PRIMARY KEY,
      couple_id TEXT UNIQUE NOT NULL,
      briefing TEXT DEFAULT '{}',
      messages TEXT DEFAULT '[]',
      completed INTEGER DEFAULT 0,
      completed_at TIMESTAMPTZ,
      generated_at TIMESTAMPTZ
    );

    -- Big Decision Advisor, step 1: the MOC (Multitude of Counselors) Board.
    -- owner_key is either an individual_id (that person's own board) or the
    -- literal string 'shared' (the couple's joint board) -- kept as a plain
    -- text key rather than a nullable individual_id column so the unique
    -- constraint below actually enforces one row per slot (Postgres treats
    -- NULLs as distinct from each other, which would defeat that).
    CREATE TABLE IF NOT EXISTS moc_board_entries (
      id TEXT PRIMARY KEY,
      couple_id TEXT NOT NULL,
      owner_key TEXT NOT NULL,
      category TEXT NOT NULL,
      slot INTEGER NOT NULL,
      name TEXT DEFAULT '',
      contact TEXT DEFAULT '',
      notes TEXT DEFAULT '',
      updated_at TIMESTAMPTZ DEFAULT NOW(),
      UNIQUE(couple_id, owner_key, category, slot)
    );

    -- Big Decision Advisor, step 2: the SMIC decision flow itself. Mirrors
    -- arguments/argument_responses/argument_synthesis exactly (separate
    -- processing, then synthesis), but a decision has a title/category and
    -- couples can have more than one over time, browsable as history.
    CREATE TABLE IF NOT EXISTS decisions (
      id TEXT PRIMARY KEY,
      couple_id TEXT NOT NULL,
      title TEXT NOT NULL,
      category TEXT,
      status TEXT DEFAULT 'open',
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS decision_responses (
      id TEXT PRIMARY KEY,
      decision_id TEXT NOT NULL,
      individual_id TEXT NOT NULL,
      messages TEXT DEFAULT '[]',
      smic_s TEXT DEFAULT '',
      smic_m TEXT DEFAULT '',
      smic_i TEXT DEFAULT '',
      smic_c TEXT DEFAULT '',
      leaning TEXT DEFAULT '',
      completed INTEGER DEFAULT 0,
      submitted_at TIMESTAMPTZ,
      UNIQUE(decision_id, individual_id)
    );

    CREATE TABLE IF NOT EXISTS decision_synthesis (
      id SERIAL PRIMARY KEY,
      decision_id TEXT UNIQUE NOT NULL,
      couple_view TEXT DEFAULT '{}',
      generated_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS shared_insights (
      id TEXT PRIMARY KEY,
      couple_id TEXT NOT NULL,
      shared_by TEXT NOT NULL,
      domain_index INTEGER,
      insight_text TEXT NOT NULL,
      season_tags TEXT DEFAULT '[]',
      discussion_status TEXT DEFAULT 'shared',
      coffee_date TEXT,
      shared_at TIMESTAMPTZ DEFAULT NOW(),
      read_at TIMESTAMPTZ
    );
  `);

  await pool.query(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_individuals_email
    ON individuals(email) WHERE email IS NOT NULL;
  `);

  // Existing deployments already have an individuals table without these
  // columns -- CREATE TABLE IF NOT EXISTS above is a no-op for them.
  await pool.query(`
    ALTER TABLE individuals ADD COLUMN IF NOT EXISTS bio TEXT DEFAULT '{}';
    ALTER TABLE individuals ADD COLUMN IF NOT EXISTS bio_complete INTEGER DEFAULT 0;
    ALTER TABLE individuals ADD COLUMN IF NOT EXISTS total_time_seconds INTEGER DEFAULT 0;
  `);
}

module.exports = {
  pool,
  initSchema,

  async getOne(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows[0] || null;
  },

  async getAll(text, params = []) {
    const result = await pool.query(text, params);
    return result.rows;
  },

  async run(text, params = []) {
    return await pool.query(text, params);
  },

  async transaction(fn) {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
  }
};
