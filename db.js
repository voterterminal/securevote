// ==========================================
// SECUREVOTE — DATA ACCESS LAYER (v1.4)
// ==========================================
// DEMO MODE  (no DATABASE_URL): in-memory, wipes on restart
// PRODUCTION (DATABASE_URL set): PostgreSQL, persists forever
//
// Multi-tenant: every query is scoped to a tenant_id.
// Community edition: tenant_id is always 'default'.
// SaaS: tenant_id comes from subdomain routing middleware.
//
// Usage:
//   const { db, DEMO_MODE } = require('./db');
//   await db.init();                              // once at startup
//   const tdb = db.forTenant(req.tenantId);       // per-request scope
//   const elections = await tdb.elections.getAll();
// ==========================================

'use strict';

const bcrypt = require('bcryptjs');

const DEMO_MODE   = !process.env.DATABASE_URL;
const DEFAULT_TID = 'default';

// ==========================================
// SHARED SEED DATA
// ==========================================

const DEFAULT_AFFIDAVIT = {
  id:        'affidavit_default',
  name:      'Standard Voter Affidavit',
  text:      'I affirm that I am a registered member of this organization and am eligible to vote in this election. I have not voted and will not vote more than once in this election.',
  createdAt: new Date(),
  builtIn:   true
};

const DEFAULT_EMAIL_TEMPLATES = {
  invite: {
    subject:     "You're invited to vote: {{electionName}}",
    intro:       "You have been invited to participate in <strong>{{electionName}}</strong>.",
    instruction: "Use the access code below when you go to cast your ballot. Keep it safe — this code is personal to you.",
    help:        "If you lose your code, contact your election administrator for assistance. Your vote will be completely anonymous once cast.",
    footnote:    "Sent by {{orgName}}. If you were not expecting this invitation, you can safely ignore this email."
  }
};

function defaultOrgConfig(tenantName) {
  return {
    orgName:     process.env.ORG_NAME         || tenantName || 'SecureVote',
    orgTagline:  process.env.ORG_TAGLINE      || 'Official Ballot',
    bannerColor: process.env.ORG_BANNER_COLOR || '#003087',
    logoUrl:     process.env.ORG_LOGO_URL     || ''
  };
}

// ==========================================
// DEMO MODE — IN-MEMORY STORE
// ==========================================

// keyed by tenantId
const memStore = {};

function getTenantMem(tenantId) {
  if (!memStore[tenantId]) {
    memStore[tenantId] = {
      elections:         [],
      voters:            [],
      votes:             [],
      adminUsers:        [],
      auditLog:          [],
      invalidations:     [],
      results:           [],
      affidavits:        [{ ...DEFAULT_AFFIDAVIT, createdAt: new Date() }],
      tenantEmailConfig: null,
      emailTemplates:    JSON.parse(JSON.stringify(DEFAULT_EMAIL_TEMPLATES)),
      orgConfig:         defaultOrgConfig(tenantId)
    };
  }
  return memStore[tenantId];
}

// Seed the default tenant memory on startup
if (DEMO_MODE) {
  const m = getTenantMem(DEFAULT_TID);
  m.adminUsers.push({
    id:            'admin1',
    tenantId:      DEFAULT_TID,
    email:         process.env.ADMIN_EMAIL    || 'admin@voting.com',
    passwordHash:  bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10),
    name:          process.env.ADMIN_EMAIL    || 'admin@voting.com',
    role:          'admin',
    isSuperAdmin:  true
  });
  console.log('[DB] ⚠️  DEMO MODE — in-memory storage. All data wipes on restart.');
  console.log('[DB]    Set DATABASE_URL in .env to enable PostgreSQL.');
} else {
  console.log('[DB] PostgreSQL mode — persistent multi-tenant storage.');
}

// ==========================================
// POSTGRES — CONNECTION POOL
// ==========================================

let pool;

if (!DEMO_MODE) {
  const { Pool } = require('pg');
  pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false }
  });
  pool.on('error', err => console.error('[DB] Pool error:', err.message));
}

async function q(text, params) {
  const client = await pool.connect();
  try   { return await client.query(text, params); }
  finally { client.release(); }
}

// ==========================================
// ROW MAPPERS
// ==========================================

function pgToElection(row, voterRollRows) {
  return {
    id:                   row.id,
    tenantId:             row.tenant_id,
    name:                 row.name,
    description:          row.description,
    type:                 row.type,
    candidates:           row.candidates,
    races:                row.races || null,
    startTime:            row.start_time,
    endTime:              row.end_time,
    requiresAffidavit:    row.requires_affidavit,
    affidavitId:          row.affidavit_id,
    affidavitText:        row.affidavit_text,
    createdBy:            row.created_by,
    createdAt:            row.created_at,
    status:               row.status,
    voterCount:           row.voter_count,
    quorumCount:          row.quorum_count || 0,
    inviteOnly:           row.invite_only,
    universalPasswordHash: row.universal_password_hash,
    endedAt:              row.ended_at,
    voterRoll: (row.voterRoll || []).map(v => ({
      email:      v.email,
      name:       v.name,
      accessCode: v.access_code,
      used:       v.used,
      usedAt:     v.used_at,
      invitedAt:  v.invited_at
    }))
  };
}

function pgToVoter(row) {
  return {
    id:                 row.id,
    tenantId:           row.tenant_id,
    email:              row.email,
    electionId:         row.election_id,
    registeredAt:       row.registered_at,
    hasVoted:           row.has_voted,
    votedAt:            row.voted_at,
    affidavitConfirmed: row.affidavit_confirmed,
    name:               row.name,
    address:            row.address,
    accessMethod:       row.access_method,
    invalidated:        row.invalidated,
    invalidatedAt:      row.invalidated_at,
    invalidationReason: row.invalidation_reason,
    reinstatedAt:       row.reinstated_at,
    reinstatedReason:   row.reinstated_reason
  };
}

function pgToVote(row) {
  return {
    id:           row.id,
    tenantId:     row.tenant_id,
    electionId:   row.election_id,
    choices:      row.choices,
    raceChoices:  row.race_choices || null,
    voteType:     row.vote_type,
    submittedAt:  row.submitted_at,
    invalidated:  row.invalidated,
    invalidatedAt: row.invalidated_at
  };
}

function pgToAdmin(row) {
  return {
    id:           row.id,
    tenantId:     row.tenant_id,
    email:        row.email,
    name:         row.name,
    passwordHash: row.password_hash,
    role:         row.role,
    isSuperAdmin: row.is_super_admin
  };
}

function pgToAuditEntry(row) {
  return {
    id:                row.id,
    tenantId:          row.tenant_id,
    email:             row.email,
    electionId:        row.election_id,
    voterId:           row.voter_id,
    voteId:            row.vote_id,
    timestamp:         row.timestamp,
    action:            row.action,
    invalidated:       row.invalidated,
    invalidatedAt:     row.invalidated_at,
    invalidatedReason: row.invalidated_reason,
    invalidatedBy:     row.invalidated_by,
    adminId:           row.admin_id
  };
}

function pgToInvalidation(row) {
  return {
    action:        row.action,
    tenantId:      row.tenant_id,
    electionId:    row.election_id,
    voterId:       row.voter_id,
    voterEmail:    row.voter_email,
    voteId:        row.vote_id,
    reason:        row.reason,
    invalidatedBy: row.invalidated_by,
    reinstatedBy:  row.reinstated_by,
    requestedBy:   row.requested_by,
    accessedBy:    row.accessed_by,
    attemptedBy:   row.attempted_by,
    targetVoterId: row.target_voter_id,
    timestamp:     row.timestamp
  };
}

function pgToAffidavit(row) {
  return {
    id:        row.id,
    tenantId:  row.tenant_id,
    name:      row.name,
    text:      row.text,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    builtIn:   row.built_in
  };
}

function pgToTenant(row) {
  return {
    id:                   row.id,
    name:                 row.name,
    slug:                 row.slug,
    plan:                 row.plan,
    active:               row.active,
    contactEmail:         row.contact_email,
    trialEndsAt:          row.trial_ends_at      || null,
    stripeCustomerId:     row.stripe_customer_id  || null,
    stripeSubscriptionId: row.stripe_subscription_id || null,
    stripeStatus:         row.stripe_status       || null,
    createdAt:            row.created_at
  };
}

function buildSet(fieldMap, updates) {
  const parts = [], values = [];
  let i = 1;
  for (const [key, col] of Object.entries(fieldMap)) {
    if (key in updates) { parts.push(`${col} = $${i++}`); values.push(updates[key]); }
  }
  return { clause: parts.join(', '), values, next: i };
}

// ==========================================
// TENANT-SCOPED DB FACTORY
// ==========================================
// Returns a db-like object where every method is pre-scoped to tenantId.
// This is what route handlers use — they never pass tenantId to individual methods.

function forTenant(tenantId) {
  const tid = tenantId || DEFAULT_TID;
  const mem = DEMO_MODE ? getTenantMem(tid) : null;

  // Shared election query with voter roll join
  const electionSelect = `
    SELECT e.*,
      COALESCE(
        json_agg(
          json_build_object(
            'email', vr.email, 'name', vr.name, 'access_code', vr.access_code,
            'used', vr.used, 'used_at', vr.used_at, 'invited_at', vr.invited_at
          ) ORDER BY vr.invited_at
        ) FILTER (WHERE vr.id IS NOT NULL),
        '[]'
      ) AS "voterRoll"
    FROM elections e
    LEFT JOIN voter_roll vr ON vr.election_id = e.id AND vr.tenant_id = e.tenant_id
  `;

  return {

    // ---- ELECTIONS ----

    elections: {

      async getAll() {
        if (DEMO_MODE) return mem.elections;
        const { rows } = await q(`${electionSelect} WHERE e.tenant_id=$1 GROUP BY e.id,e.tenant_id ORDER BY e.created_at DESC`, [tid]);
        return rows.map(pgToElection);
      },

      async getActive() {
        if (DEMO_MODE) {
          const now = new Date();
          return mem.elections.filter(e =>
            e.status === 'active' &&
            new Date(e.endTime) > now &&
            (!e.startTime || new Date(e.startTime) <= now)
          );
        }
        const { rows } = await q(`${electionSelect} WHERE e.tenant_id=$1 AND e.status='active' AND e.end_time > NOW() AND (e.start_time IS NULL OR e.start_time <= NOW()) GROUP BY e.id,e.tenant_id ORDER BY e.created_at DESC`, [tid]);
        return rows.map(pgToElection);
      },

      async getById(id) {
        if (DEMO_MODE) return mem.elections.find(e => e.id === id) || null;
        const { rows } = await q(`${electionSelect} WHERE e.id=$1 AND e.tenant_id=$2 GROUP BY e.id,e.tenant_id`, [id, tid]);
        return rows[0] ? pgToElection(rows[0]) : null;
      },

      async create(data) {
        if (DEMO_MODE) {
          const election = { ...data, tenantId: tid, voterRoll: [] };
          mem.elections.push(election);
          return election;
        }
        await q(`
          INSERT INTO elections
            (id, tenant_id, name, description, type, candidates, races, start_time, end_time,
             requires_affidavit, affidavit_id, affidavit_text, created_by, created_at,
             status, voter_count, invite_only, universal_password_hash, quorum_count)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
        `, [
          data.id, tid, data.name, data.description, data.type,
          JSON.stringify(data.candidates || []),
          data.races ? JSON.stringify(data.races) : null,
          data.startTime, data.endTime,
          data.requiresAffidavit !== false,
          data.affidavitId || null, data.affidavitText || null,
          data.createdBy || null, data.createdAt || new Date(),
          data.status || 'active', data.voterCount || 0,
          data.inviteOnly === true, data.universalPasswordHash || null,
          data.quorumCount || 0
        ]);
        return { ...data, tenantId: tid, voterRoll: [] };
      },

      async update(id, updates) {
        if (DEMO_MODE) {
          const election = mem.elections.find(e => e.id === id);
          if (!election) return null;
          const allowed = ['name','description','type','candidates','races','startTime','endTime',
            'requiresAffidavit','status','inviteOnly','universalPasswordHash',
            'endedAt','voterCount','affidavitId','affidavitText'];
          for (const key of allowed) { if (key in updates) election[key] = updates[key]; }
          return election;
        }
        const fieldMap = {
          name:'name', description:'description', type:'type',
          startTime:'start_time', endTime:'end_time',
          requiresAffidavit:'requires_affidavit', status:'status',
          inviteOnly:'invite_only', universalPasswordHash:'universal_password_hash',
          endedAt:'ended_at', voterCount:'voter_count', quorumCount:'quorum_count',
          affidavitId:'affidavit_id', affidavitText:'affidavit_text'
        };
        let { clause, values, next } = buildSet(fieldMap, updates);
        if ('candidates' in updates) {
          clause += (clause ? ', ' : '') + `candidates = $${next++}`;
          values.push(JSON.stringify(updates.candidates));
        }
        if ('races' in updates) {
          clause += (clause ? ', ' : '') + `races = $${next++}`;
          values.push(updates.races ? JSON.stringify(updates.races) : null);
        }
        if (!clause) return this.getById(id);
        values.push(id, tid);
        await q(`UPDATE elections SET ${clause} WHERE id=$${next} AND tenant_id=$${next+1}`, values);
        return this.getById(id);
      },

      async addToVoterRoll(electionId, entry) {
        if (DEMO_MODE) {
          const election = mem.elections.find(e => e.id === electionId);
          if (election) election.voterRoll.push(entry);
          return;
        }
        await q(`
          INSERT INTO voter_roll (tenant_id, election_id, email, name, access_code, used, used_at, invited_at)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8) ON CONFLICT (tenant_id, election_id, email) DO NOTHING
        `, [tid, electionId, entry.email, entry.name || entry.email,
            entry.accessCode, entry.used || false, entry.usedAt || null, entry.invitedAt || new Date()]);
      },

      async updateVoterRollEntry(electionId, email, updates) {
        if (DEMO_MODE) {
          const election = mem.elections.find(e => e.id === electionId);
          if (!election) return;
          const entry = election.voterRoll.find(v => v.email === email);
          if (entry) Object.assign(entry, updates);
          return;
        }
        const parts = [], values = []; let i = 1;
        if ('used'   in updates) { parts.push(`used=$${i++}`);    values.push(updates.used); }
        if ('usedAt' in updates) { parts.push(`used_at=$${i++}`); values.push(updates.usedAt); }
        if (!parts.length) return;
        values.push(tid, electionId, email);
        await q(`UPDATE voter_roll SET ${parts.join(', ')} WHERE tenant_id=$${i++} AND election_id=$${i++} AND email=$${i}`, values);
      },

      async clearVoterRoll(electionId) {
        if (DEMO_MODE) {
          const election = mem.elections.find(e => e.id === electionId);
          if (election) { election.voterRoll = []; election.universalPasswordHash = null; election.inviteOnly = false; }
          return;
        }
        await q('DELETE FROM voter_roll WHERE tenant_id=$1 AND election_id=$2', [tid, electionId]);
        await q('UPDATE elections SET universal_password_hash=NULL, invite_only=FALSE WHERE id=$1 AND tenant_id=$2', [electionId, tid]);
      },

      async delete(id) {
        if (DEMO_MODE) {
          const idx = mem.elections.findIndex(e => e.id === id);
          if (idx !== -1) mem.elections.splice(idx, 1);
          mem.votes        = mem.votes.filter(v => v.electionId !== id);
          mem.voters       = mem.voters.filter(v => v.electionId !== id);
          mem.results      = mem.results.filter(r => r.electionId !== id);
          return;
        }
        await q('DELETE FROM voter_roll WHERE election_id=$1 AND tenant_id=$2', [id, tid]);
        await q('DELETE FROM votes WHERE election_id=$1 AND tenant_id=$2', [id, tid]);
        await q('DELETE FROM voters WHERE election_id=$1 AND tenant_id=$2', [id, tid]);
        await q('DELETE FROM elections WHERE id=$1 AND tenant_id=$2', [id, tid]);
      }
    },

    // ---- VOTERS ----

    voters: {

      async getById(id) {
        if (DEMO_MODE) return mem.voters.find(v => v.id === id) || null;
        const { rows } = await q('SELECT * FROM voters WHERE id=$1 AND tenant_id=$2', [id, tid]);
        return rows[0] ? pgToVoter(rows[0]) : null;
      },

      async getByEmailAndElection(email, electionId) {
        if (DEMO_MODE) return mem.voters.find(v => v.email === email && v.electionId === electionId) || null;
        const { rows } = await q('SELECT * FROM voters WHERE email=$1 AND election_id=$2 AND tenant_id=$3', [email, electionId, tid]);
        return rows[0] ? pgToVoter(rows[0]) : null;
      },

      async getByElection(electionId) {
        if (DEMO_MODE) return mem.voters.filter(v => v.electionId === electionId);
        const { rows } = await q('SELECT * FROM voters WHERE election_id=$1 AND tenant_id=$2', [electionId, tid]);
        return rows.map(pgToVoter);
      },

      async create(data) {
        if (DEMO_MODE) { const v = { ...data, tenantId: tid }; mem.voters.push(v); return v; }
        await q(`
          INSERT INTO voters (id, tenant_id, email, election_id, registered_at, has_voted, voted_at,
            affidavit_confirmed, name, address, access_method)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
        `, [data.id, tid, data.email, data.electionId, data.registeredAt || new Date(),
            data.hasVoted || false, data.votedAt || null, data.affidavitConfirmed || false,
            data.name || null, data.address || null, data.accessMethod || null]);
        return { ...data, tenantId: tid };
      },

      async update(id, updates) {
        if (DEMO_MODE) {
          const voter = mem.voters.find(v => v.id === id);
          if (voter) Object.assign(voter, updates);
          return voter;
        }
        const fieldMap = {
          hasVoted:'has_voted', votedAt:'voted_at',
          invalidated:'invalidated', invalidatedAt:'invalidated_at',
          invalidationReason:'invalidation_reason',
          reinstatedAt:'reinstated_at', reinstatedReason:'reinstated_reason'
        };
        const { clause, values, next } = buildSet(fieldMap, updates);
        if (!clause) return this.getById(id);
        values.push(id, tid);
        await q(`UPDATE voters SET ${clause} WHERE id=$${next} AND tenant_id=$${next+1}`, values);
        return this.getById(id);
      }
    },

    // ---- VOTES ----

    votes: {

      async create(data) {
        if (DEMO_MODE) { const v = { ...data, tenantId: tid }; mem.votes.push(v); return v; }
        await q(`INSERT INTO votes (id,tenant_id,election_id,choices,race_choices,vote_type,submitted_at,invalidated)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [data.id, tid, data.electionId,
           data.choices ? JSON.stringify(data.choices) : null,
           data.raceChoices ? JSON.stringify(data.raceChoices) : null,
           data.voteType, data.submittedAt || new Date(), false]);
        return { ...data, tenantId: tid };
      },

      async getByElection(electionId) {
        if (DEMO_MODE) return mem.votes.filter(v => v.electionId === electionId);
        const { rows } = await q('SELECT * FROM votes WHERE election_id=$1 AND tenant_id=$2', [electionId, tid]);
        return rows.map(pgToVote);
      },

      async update(id, updates) {
        if (DEMO_MODE) {
          const vote = mem.votes.find(v => v.id === id);
          if (vote) Object.assign(vote, updates);
          return;
        }
        const parts = [], values = []; let i = 1;
        if ('invalidated'   in updates) { parts.push(`invalidated=$${i++}`);    values.push(updates.invalidated); }
        if ('invalidatedAt' in updates) { parts.push(`invalidated_at=$${i++}`); values.push(updates.invalidatedAt); }
        if (!parts.length) return;
        values.push(id, tid);
        await q(`UPDATE votes SET ${parts.join(', ')} WHERE id=$${i++} AND tenant_id=$${i}`, values);
      }
    },

    // ---- ADMIN USERS ----

    adminUsers: {

      async getAll() {
        if (DEMO_MODE) return mem.adminUsers;
        const { rows } = await q('SELECT * FROM admin_users WHERE tenant_id=$1 ORDER BY created_at', [tid]);
        return rows.map(pgToAdmin);
      },

      async getById(id) {
        if (DEMO_MODE) return mem.adminUsers.find(a => a.id === id) || null;
        const { rows } = await q('SELECT * FROM admin_users WHERE id=$1 AND tenant_id=$2', [id, tid]);
        return rows[0] ? pgToAdmin(rows[0]) : null;
      },

      async getByEmail(email) {
        if (DEMO_MODE) return mem.adminUsers.find(a => a.email === email) || null;
        const { rows } = await q('SELECT * FROM admin_users WHERE email=$1 AND tenant_id=$2', [email, tid]);
        return rows[0] ? pgToAdmin(rows[0]) : null;
      },

      async create(data) {
        if (DEMO_MODE) {
          const a = { ...data, tenantId: tid };
          mem.adminUsers.push(a);
          return a;
        }
        await q(`INSERT INTO admin_users (id,tenant_id,email,name,password_hash,role,is_super_admin)
          VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [data.id, tid, data.email, data.name || data.email, data.passwordHash,
           data.role || 'admin', data.isSuperAdmin || false]);
        return { ...data, tenantId: tid };
      },

      async update(id, updates) {
        if (DEMO_MODE) {
          const admin = mem.adminUsers.find(a => a.id === id);
          if (admin) Object.assign(admin, updates);
          return admin;
        }
        if ('passwordHash' in updates) {
          await q('UPDATE admin_users SET password_hash=$1 WHERE id=$2 AND tenant_id=$3', [updates.passwordHash, id, tid]);
        }
        return this.getById(id);
      },

      async delete(id) {
        if (DEMO_MODE) {
          const idx = mem.adminUsers.findIndex(a => a.id === id);
          if (idx !== -1) mem.adminUsers.splice(idx, 1);
          return;
        }
        await q('DELETE FROM admin_users WHERE id=$1 AND tenant_id=$2', [id, tid]);
      },

      async count() {
        if (DEMO_MODE) return mem.adminUsers.length;
        const { rows } = await q('SELECT COUNT(*) AS cnt FROM admin_users WHERE tenant_id=$1', [tid]);
        return parseInt(rows[0].cnt, 10);
      }
    },

    // ---- AUDIT LOG ----

    auditLog: {

      async add(entry) {
        if (DEMO_MODE) { mem.auditLog.push({ ...entry, tenantId: tid }); return; }
        await q(`INSERT INTO audit_log (tenant_id,email,election_id,voter_id,vote_id,timestamp,action,invalidated,admin_id)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
          [tid, entry.email||null, entry.electionId||null, entry.voterId||null, entry.voteId||null,
           entry.timestamp||new Date(), entry.action, entry.invalidated||false, entry.adminId||null]);
      },

      async getByElection(electionId) {
        if (DEMO_MODE) return mem.auditLog.filter(e => e.electionId === electionId && e.action === 'voted');
        const { rows } = await q(
          "SELECT * FROM audit_log WHERE tenant_id=$1 AND election_id=$2 AND action='voted' ORDER BY timestamp",
          [tid, electionId]);
        return rows.map(pgToAuditEntry);
      },

      async findEntry(voterId, electionId, action) {
        if (DEMO_MODE) return mem.auditLog.find(e => e.voterId===voterId && e.electionId===electionId && e.action===action) || null;
        const { rows } = await q(
          'SELECT * FROM audit_log WHERE tenant_id=$1 AND voter_id=$2 AND election_id=$3 AND action=$4 LIMIT 1',
          [tid, voterId, electionId, action]);
        return rows[0] ? pgToAuditEntry(rows[0]) : null;
      },

      async updateByVoter(voterId, electionId, updates) {
        if (DEMO_MODE) {
          const entry = mem.auditLog.find(e => e.voterId===voterId && e.electionId===electionId && e.action==='voted');
          if (entry) Object.assign(entry, updates);
          return;
        }
        const fieldMap = {
          invalidated:'invalidated', invalidatedAt:'invalidated_at',
          invalidatedReason:'invalidated_reason', invalidatedBy:'invalidated_by'
        };
        const { clause, values, next } = buildSet(fieldMap, updates);
        if (!clause) return;
        values.push(tid, voterId, electionId);
        await q(
          `UPDATE audit_log SET ${clause} WHERE tenant_id=$${next} AND voter_id=$${next+1} AND election_id=$${next+2} AND action='voted'`,
          values);
      }
    },

    // ---- INVALIDATIONS ----

    invalidations: {

      async add(entry) {
        if (DEMO_MODE) { mem.invalidations.push({ ...entry, tenantId: tid }); return; }
        await q(`INSERT INTO invalidations
          (tenant_id,action,election_id,voter_id,voter_email,vote_id,reason,
           invalidated_by,reinstated_by,requested_by,accessed_by,attempted_by,target_voter_id,timestamp)
          VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)`,
          [tid, entry.action, entry.electionId||null, entry.voterId||null, entry.voterEmail||null,
           entry.voteId||null, entry.reason||null, entry.invalidatedBy||null, entry.reinstatedBy||null,
           entry.requestedBy||null, entry.accessedBy||null, entry.attemptedBy||null,
           entry.targetVoterId||null, entry.timestamp||new Date()]);
      },

      async getByElection(electionId) {
        if (DEMO_MODE) return mem.invalidations.filter(e => e.electionId === electionId);
        const { rows } = await q('SELECT * FROM invalidations WHERE tenant_id=$1 AND election_id=$2 ORDER BY timestamp', [tid, electionId]);
        return rows.map(pgToInvalidation);
      }
    },

    // ---- RESULTS ----

    results: {
      async save(data) {
        if (DEMO_MODE) { mem.results.push({ ...data, tenantId: tid }); return; }
        await q('INSERT INTO results (tenant_id,election_id,results,calculated_at,total_votes) VALUES ($1,$2,$3,$4,$5)',
          [tid, data.electionId, JSON.stringify(data.results), data.calculatedAt||new Date(), data.totalVotes||0]);
      }
    },

    // ---- AFFIDAVITS ----

    affidavits: {

      async getAll() {
        if (DEMO_MODE) return mem.affidavits;
        const { rows } = await q('SELECT * FROM affidavits WHERE tenant_id=$1 ORDER BY created_at', [tid]);
        return rows.map(pgToAffidavit);
      },

      async getById(id) {
        if (DEMO_MODE) return mem.affidavits.find(a => a.id === id) || null;
        const { rows } = await q('SELECT * FROM affidavits WHERE id=$1 AND tenant_id=$2', [id, tid]);
        return rows[0] ? pgToAffidavit(rows[0]) : null;
      },

      async create(data) {
        if (DEMO_MODE) { const a = { ...data, tenantId: tid }; mem.affidavits.push(a); return a; }
        await q('INSERT INTO affidavits (id,tenant_id,name,text,created_at,built_in) VALUES ($1,$2,$3,$4,$5,$6)',
          [data.id, tid, data.name, data.text, data.createdAt||new Date(), data.builtIn||false]);
        return { ...data, tenantId: tid };
      },

      async update(id, updates) {
        if (DEMO_MODE) {
          const tpl = mem.affidavits.find(a => a.id === id);
          if (tpl) Object.assign(tpl, updates);
          return tpl;
        }
        const parts = [], values = []; let i = 1;
        if ('name' in updates) { parts.push(`name=$${i++}`); values.push(updates.name); }
        if ('text' in updates) { parts.push(`text=$${i++}`); values.push(updates.text); }
        parts.push(`updated_at=$${i++}`);
        values.push(updates.updatedAt || new Date());
        values.push(id, tid);
        await q(`UPDATE affidavits SET ${parts.join(', ')} WHERE id=$${i++} AND tenant_id=$${i}`, values);
        return this.getById(id);
      },

      async delete(id) {
        if (DEMO_MODE) {
          const idx = mem.affidavits.findIndex(a => a.id === id);
          if (idx !== -1) mem.affidavits.splice(idx, 1);
          return;
        }
        await q('DELETE FROM affidavits WHERE id=$1 AND tenant_id=$2', [id, tid]);
      },

      async bulkInsertIfMissing(templates) {
        for (const tpl of templates) {
          if (!tpl.id || !tpl.name || !tpl.text) continue;
          if (DEMO_MODE) {
            if (!mem.affidavits.find(a => a.id === tpl.id))
              mem.affidavits.push({ ...tpl, tenantId: tid, createdAt: new Date(), builtIn: true });
          } else {
            await q(`INSERT INTO affidavits (id,tenant_id,name,text,created_at,built_in) VALUES ($1,$2,$3,$4,$5,$6)
              ON CONFLICT (id,tenant_id) DO NOTHING`,
              [tpl.id, tid, tpl.name, tpl.text, new Date(), true]);
          }
        }
      }
    },

    // ---- SETTINGS ----

    settings: {

      async getTenantEmailConfig() {
        if (DEMO_MODE) return mem.tenantEmailConfig;
        const { rows } = await q("SELECT value FROM settings WHERE tenant_id=$1 AND key='tenantEmailConfig'", [tid]);
        return rows[0] ? rows[0].value : null;
      },

      async setTenantEmailConfig(config) {
        if (DEMO_MODE) { mem.tenantEmailConfig = config; return; }
        if (config === null) {
          await q("DELETE FROM settings WHERE tenant_id=$1 AND key='tenantEmailConfig'", [tid]);
        } else {
          await q(`INSERT INTO settings (tenant_id,key,value,updated_at) VALUES ($1,'tenantEmailConfig',$2,NOW())
            ON CONFLICT (tenant_id,key) DO UPDATE SET value=$2, updated_at=NOW()`, [tid, JSON.stringify(config)]);
        }
      },

      async getEmailTemplates() {
        if (DEMO_MODE) return mem.emailTemplates;
        const { rows } = await q("SELECT value FROM settings WHERE tenant_id=$1 AND key='emailTemplates'", [tid]);
        return rows[0] ? rows[0].value : JSON.parse(JSON.stringify(DEFAULT_EMAIL_TEMPLATES));
      },

      async updateEmailTemplate(templateKey, fields) {
        if (DEMO_MODE) {
          if (!mem.emailTemplates[templateKey]) mem.emailTemplates[templateKey] = {};
          Object.assign(mem.emailTemplates[templateKey], fields);
          return mem.emailTemplates;
        }
        const current = await this.getEmailTemplates();
        if (!current[templateKey]) current[templateKey] = {};
        Object.assign(current[templateKey], fields);
        await q(`INSERT INTO settings (tenant_id,key,value,updated_at) VALUES ($1,'emailTemplates',$2,NOW())
          ON CONFLICT (tenant_id,key) DO UPDATE SET value=$2, updated_at=NOW()`, [tid, JSON.stringify(current)]);
        return current;
      },

      async getOrgConfig() {
        if (DEMO_MODE) return mem.orgConfig;
        const { rows } = await q("SELECT value FROM settings WHERE tenant_id=$1 AND key='orgConfig'", [tid]);
        return rows[0] ? rows[0].value : defaultOrgConfig(tid);
      },

      async updateOrgConfig(updates) {
        if (DEMO_MODE) { Object.assign(mem.orgConfig, updates); return mem.orgConfig; }
        const current = await this.getOrgConfig();
        Object.assign(current, updates);
        await q(`INSERT INTO settings (tenant_id,key,value,updated_at) VALUES ($1,'orgConfig',$2,NOW())
          ON CONFLICT (tenant_id,key) DO UPDATE SET value=$2, updated_at=NOW()`, [tid, JSON.stringify(current)]);
        return current;
      }
    }

  }; // end forTenant return
}

// ==========================================
// TOP-LEVEL DB OBJECT (tenant management + init)
// ==========================================

const db = {

  forTenant,

  // ---- TENANTS (super-admin operations — not scoped to a single tenant) ----

  tenants: {

    async getAll() {
      if (DEMO_MODE) return Object.keys(memStore).map(id => ({
        id, name: id, slug: id, plan: 'community', active: true, createdAt: new Date()
      }));
      const { rows } = await q('SELECT * FROM tenants ORDER BY created_at');
      return rows.map(pgToTenant);
    },

    async getById(id) {
      if (DEMO_MODE) return memStore[id] ? { id, name: id, slug: id, plan: 'community', active: true } : null;
      const { rows } = await q('SELECT * FROM tenants WHERE id=$1', [id]);
      return rows[0] ? pgToTenant(rows[0]) : null;
    },

    async getBySlug(slug) {
      if (DEMO_MODE) return slug === DEFAULT_TID ? { id: DEFAULT_TID, name: DEFAULT_TID, slug: DEFAULT_TID, plan: 'community', active: true } : null;
      const { rows } = await q('SELECT * FROM tenants WHERE slug=$1', [slug]);
      return rows[0] ? pgToTenant(rows[0]) : null;
    },

    async create(data) {
      if (DEMO_MODE) {
        getTenantMem(data.id); // initialize memory for this tenant
        return data;
      }
      await q('INSERT INTO tenants (id,name,slug,plan,active,contact_email) VALUES ($1,$2,$3,$4,$5,$6)',
        [data.id, data.name, data.slug, data.plan || 'community', data.active !== false, data.contactEmail || null]);
      return data;
    },

    async update(id, updates) {
      if (DEMO_MODE) return;
      const fieldMap = { name:'name', slug:'slug', plan:'plan', active:'active', contactEmail:'contact_email' };
      const { clause, values, next } = buildSet(fieldMap, updates);
      if (!clause) return;
      values.push(id);
      await q(`UPDATE tenants SET ${clause} WHERE id=$${next}`, values);
    },

    async updateStripe(id, updates) {
      if (DEMO_MODE) return;
      const fieldMap = {
        stripeCustomerId:     'stripe_customer_id',
        stripeSubscriptionId: 'stripe_subscription_id',
        stripeStatus:         'stripe_status',
        plan:                 'plan'
      };
      const { clause, values, next } = buildSet(fieldMap, updates);
      if (!clause) return;
      values.push(id);
      await q(`UPDATE tenants SET ${clause} WHERE id=$${next}`, values);
    }
  },

  // ---- INIT (seed default tenant + admin on first PostgreSQL boot) ----

  async init() {
    if (DEMO_MODE) return;

    try {
      await q('SELECT 1');
      console.log('[DB] PostgreSQL connection verified.');
    } catch (err) {
      console.error('[DB] ❌ Cannot connect to PostgreSQL:', err.message);
      process.exit(1);
    }

    // Schema migrations (safe — IF NOT EXISTS / no-ops if column already present)
    await q('ALTER TABLE elections ADD COLUMN IF NOT EXISTS quorum_count INTEGER DEFAULT 0').catch(() => {});
    await q("ALTER TABLE votes ALTER COLUMN choices SET DEFAULT '[]'").catch(() => {});

    // Ensure default tenant exists
    const defaultTenant = await db.tenants.getById(DEFAULT_TID);
    if (!defaultTenant) {
      await db.tenants.create({ id: DEFAULT_TID, name: 'Default Organization', slug: DEFAULT_TID, plan: 'community' });
    }

    // Resolve which tenant to seed (community edition uses TENANT_ID env var, default = 'default')
    const seedTenantId = process.env.TENANT_ID || DEFAULT_TID;
    const tdb = db.forTenant(seedTenantId);

    // Seed default admin if none exist for this tenant
    const adminCount = await tdb.adminUsers.count();
    if (adminCount === 0) {
      const defaultEmail    = process.env.ADMIN_EMAIL    || 'admin@voting.com';
      const defaultPassword = process.env.ADMIN_PASSWORD || 'admin123';
      await tdb.adminUsers.create({
        id:           'admin1',
        email:        defaultEmail,
        name:         defaultEmail,
        passwordHash: bcrypt.hashSync(defaultPassword, 10),
        role:         'admin',
        isSuperAdmin: true
      });
      console.log(`[DB] Seeded default admin: ${defaultEmail}`);
    }

    // Seed default affidavit if missing
    const existing = await tdb.affidavits.getById('affidavit_default');
    if (!existing) {
      await tdb.affidavits.create({ ...DEFAULT_AFFIDAVIT, createdAt: new Date() });
    }

    console.log('[DB] Initialization complete.');
  }
};

module.exports = { db, DEMO_MODE, DEFAULT_TID };
