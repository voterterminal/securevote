// ==========================================
// SECUREVOTE — DATABASE MIGRATION (v1.4)
// ==========================================
// Creates all PostgreSQL tables. Safe to re-run — uses IF NOT EXISTS.
// v1.4 adds: tenants table + tenant_id on every table for multi-tenant SaaS.
//
// Usage:
//   node migrate.js
//
// Requires DATABASE_URL in your .env file.
// ==========================================

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });
const { Pool } = require('pg');

if (!process.env.DATABASE_URL) {
  console.error('❌  DATABASE_URL is not set. Add it to your .env file and try again.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
});

const SCHEMA = `

-- ==========================================
-- TENANTS (one row per org / customer)
-- ==========================================
CREATE TABLE IF NOT EXISTS tenants (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  slug         TEXT NOT NULL UNIQUE,   -- used for subdomain routing: slug.voterterminal.com
  plan         TEXT NOT NULL DEFAULT 'community',  -- community | pro | enterprise
  active       BOOLEAN NOT NULL DEFAULT TRUE,
  contact_email         TEXT,
  trial_ends_at         TIMESTAMPTZ,
  stripe_customer_id    TEXT,
  stripe_subscription_id TEXT,
  stripe_status         TEXT,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Seed the default tenant (used by community/self-hosted installs)
INSERT INTO tenants (id, name, slug, plan, active)
VALUES ('default', 'Default Organization', 'default', 'community', TRUE)
ON CONFLICT (id) DO NOTHING;

-- ==========================================
-- ELECTIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS elections (
  id                      TEXT NOT NULL,
  tenant_id               TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name                    TEXT NOT NULL,
  description             TEXT,
  type                    TEXT NOT NULL,
  candidates              JSONB NOT NULL DEFAULT '[]',
  start_time              TIMESTAMPTZ,
  end_time                TIMESTAMPTZ,
  requires_affidavit      BOOLEAN NOT NULL DEFAULT TRUE,
  affidavit_id            TEXT,
  affidavit_text          TEXT,
  created_by              TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  status                  TEXT NOT NULL DEFAULT 'active',
  voter_count             INTEGER NOT NULL DEFAULT 0,
  invite_only             BOOLEAN NOT NULL DEFAULT FALSE,
  universal_password_hash TEXT,
  ended_at                TIMESTAMPTZ,
  PRIMARY KEY (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_elections_tenant ON elections (tenant_id);

-- ==========================================
-- VOTER ROLL
-- ==========================================
CREATE TABLE IF NOT EXISTS voter_roll (
  id           SERIAL PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  election_id  TEXT NOT NULL,
  email        TEXT NOT NULL,
  name         TEXT,
  access_code  TEXT NOT NULL,
  used         BOOLEAN NOT NULL DEFAULT FALSE,
  used_at      TIMESTAMPTZ,
  invited_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (tenant_id, election_id, email)
);

CREATE INDEX IF NOT EXISTS idx_voter_roll_tenant    ON voter_roll (tenant_id);
CREATE INDEX IF NOT EXISTS idx_voter_roll_election  ON voter_roll (tenant_id, election_id);

-- ==========================================
-- VOTERS
-- ==========================================
CREATE TABLE IF NOT EXISTS voters (
  id                  TEXT NOT NULL,
  tenant_id           TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email               TEXT NOT NULL,
  election_id         TEXT NOT NULL,
  registered_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  has_voted           BOOLEAN NOT NULL DEFAULT FALSE,
  voted_at            TIMESTAMPTZ,
  affidavit_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  name                TEXT,
  address             TEXT,
  access_method       TEXT,
  invalidated         BOOLEAN NOT NULL DEFAULT FALSE,
  invalidated_at      TIMESTAMPTZ,
  invalidation_reason TEXT,
  reinstated_at       TIMESTAMPTZ,
  reinstated_reason   TEXT,
  PRIMARY KEY (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_voters_tenant   ON voters (tenant_id);
CREATE INDEX IF NOT EXISTS idx_voters_election ON voters (tenant_id, election_id);

-- ==========================================
-- VOTES (anonymous — no voter identity stored here)
-- ==========================================
CREATE TABLE IF NOT EXISTS votes (
  id             TEXT NOT NULL,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  election_id    TEXT NOT NULL,
  choices        JSONB NOT NULL,
  vote_type      TEXT NOT NULL,
  submitted_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  invalidated    BOOLEAN NOT NULL DEFAULT FALSE,
  invalidated_at TIMESTAMPTZ,
  PRIMARY KEY (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_votes_tenant   ON votes (tenant_id);
CREATE INDEX IF NOT EXISTS idx_votes_election ON votes (tenant_id, election_id);

-- ==========================================
-- ADMIN USERS (scoped per tenant; super-admins have is_super_admin=true)
-- ==========================================
CREATE TABLE IF NOT EXISTS admin_users (
  id             TEXT NOT NULL,
  tenant_id      TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  name           TEXT,
  password_hash  TEXT NOT NULL,
  role           TEXT NOT NULL DEFAULT 'admin',
  is_super_admin BOOLEAN NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (id, tenant_id),
  UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_admin_users_tenant ON admin_users (tenant_id);

-- ==========================================
-- AUDIT LOG
-- ==========================================
CREATE TABLE IF NOT EXISTS audit_log (
  id                 SERIAL PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email              TEXT,
  election_id        TEXT,
  voter_id           TEXT,
  vote_id            TEXT,
  timestamp          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  action             TEXT NOT NULL,
  invalidated        BOOLEAN NOT NULL DEFAULT FALSE,
  invalidated_at     TIMESTAMPTZ,
  invalidated_reason TEXT,
  invalidated_by     TEXT,
  admin_id           TEXT
);

CREATE INDEX IF NOT EXISTS idx_audit_log_tenant   ON audit_log (tenant_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_election ON audit_log (tenant_id, election_id);

-- ==========================================
-- INVALIDATIONS
-- ==========================================
CREATE TABLE IF NOT EXISTS invalidations (
  id              SERIAL PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  action          TEXT NOT NULL,
  election_id     TEXT,
  voter_id        TEXT,
  voter_email     TEXT,
  vote_id         TEXT,
  reason          TEXT,
  invalidated_by  TEXT,
  reinstated_by   TEXT,
  requested_by    TEXT,
  accessed_by     TEXT,
  attempted_by    TEXT,
  target_voter_id TEXT,
  timestamp       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_invalidations_tenant ON invalidations (tenant_id);

-- ==========================================
-- RESULTS
-- ==========================================
CREATE TABLE IF NOT EXISTS results (
  id            SERIAL PRIMARY KEY,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  election_id   TEXT NOT NULL,
  results       JSONB NOT NULL,
  calculated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  total_votes   INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_results_tenant ON results (tenant_id);

-- ==========================================
-- AFFIDAVIT TEMPLATES (per tenant)
-- ==========================================
CREATE TABLE IF NOT EXISTS affidavits (
  id         TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name       TEXT NOT NULL,
  text       TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ,
  built_in   BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY (id, tenant_id)
);

CREATE INDEX IF NOT EXISTS idx_affidavits_tenant ON affidavits (tenant_id);

-- ==========================================
-- SETTINGS (per tenant: org config, email templates, tenant email provider)
-- ==========================================
CREATE TABLE IF NOT EXISTS settings (
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key        TEXT NOT NULL,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (tenant_id, key)
);

`;

// Upgrade path: if tables exist from v1.3 (no tenant_id), add it safely
const UPGRADE_V13_TO_V14 = `
DO $$
BEGIN
  -- Add tenant_id to elections if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='elections')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='elections' AND column_name='tenant_id') THEN
    ALTER TABLE elections ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    RAISE NOTICE 'Migrated elections table to v1.4 (added tenant_id)';
  END IF;

  -- Add tenant_id to voter_roll if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='voter_roll')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='voter_roll' AND column_name='tenant_id') THEN
    ALTER TABLE voter_roll ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    RAISE NOTICE 'Migrated voter_roll table to v1.4 (added tenant_id)';
  END IF;

  -- Add tenant_id to voters if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='voters')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='voters' AND column_name='tenant_id') THEN
    ALTER TABLE voters ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    RAISE NOTICE 'Migrated voters table to v1.4 (added tenant_id)';
  END IF;

  -- Add tenant_id to votes if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='votes')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='votes' AND column_name='tenant_id') THEN
    ALTER TABLE votes ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    RAISE NOTICE 'Migrated votes table to v1.4 (added tenant_id)';
  END IF;

  -- Add tenant_id to admin_users if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='admin_users')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='admin_users' AND column_name='tenant_id') THEN
    ALTER TABLE admin_users ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    ALTER TABLE admin_users ADD COLUMN IF NOT EXISTS is_super_admin BOOLEAN NOT NULL DEFAULT FALSE;
    RAISE NOTICE 'Migrated admin_users table to v1.4 (added tenant_id, is_super_admin)';
  END IF;

  -- Add tenant_id to audit_log if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='audit_log')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='audit_log' AND column_name='tenant_id') THEN
    ALTER TABLE audit_log ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    RAISE NOTICE 'Migrated audit_log table to v1.4 (added tenant_id)';
  END IF;

  -- Add tenant_id to invalidations if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='invalidations')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='invalidations' AND column_name='tenant_id') THEN
    ALTER TABLE invalidations ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    RAISE NOTICE 'Migrated invalidations table to v1.4 (added tenant_id)';
  END IF;

  -- Add tenant_id to results if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='results')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='results' AND column_name='tenant_id') THEN
    ALTER TABLE results ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    RAISE NOTICE 'Migrated results table to v1.4 (added tenant_id)';
  END IF;

  -- Add tenant_id to affidavits if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='affidavits')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='affidavits' AND column_name='tenant_id') THEN
    ALTER TABLE affidavits ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    RAISE NOTICE 'Migrated affidavits table to v1.4 (added tenant_id)';
  END IF;

  -- Upgrade settings table: add tenant_id as part of primary key if missing
  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name='settings')
  AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name='settings' AND column_name='tenant_id') THEN
    ALTER TABLE settings ADD COLUMN tenant_id TEXT NOT NULL DEFAULT 'default';
    RAISE NOTICE 'Migrated settings table to v1.4 (added tenant_id)';
  END IF;

END $$;
`;

async function migrate() {
  const client = await pool.connect();
  try {
    console.log('🔄  Running SecureVote v1.4 database migration...\n');

    await client.query('BEGIN');

    // Run v1.3 → v1.4 upgrade for existing installs
    await client.query(UPGRADE_V13_TO_V14);

    // Create/verify all tables in v1.4 schema
    await client.query(SCHEMA);

    await client.query('COMMIT');

    console.log('✅  Migration complete — all tables ready for v1.4 multi-tenant.\n');
    console.log('Next steps:');
    console.log('  1. node voting-app-server.js');
    console.log('  2. The server seeds the default tenant, admin, and affidavit on first boot.');
    console.log('  3. Community edition (single org): set TENANT_ID=default in .env (or omit it — default is automatic).');
    console.log('  4. SaaS mode: tenants route by subdomain — slug.voterterminal.com\n');
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('❌  Migration failed:', err.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

migrate();
