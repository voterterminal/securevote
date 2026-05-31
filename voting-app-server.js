// ==========================================
// VOTERTERMINAL — COMMUNITY EDITION
// ==========================================
// Single-org, self-hosted, no email required.
// Voters enter a shared ballot code to access the ballot.
//
// Install:  curl -fsSL https://raw.githubusercontent.com/voterterminal/securevote/community/install.sh | bash
// Docker:   docker-compose up -d
//
// Need voter rolls, email invites, ranked choice, unlimited
// elections, or multiple admins? → https://voterterminal.com
// ==========================================

'use strict';

require('dotenv').config({ path: require('path').join(__dirname, '.env') });

const express   = require('express');
const cors      = require('cors');
const helmet    = require('helmet');
const bcrypt    = require('bcryptjs');
const jwt       = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { randomBytes } = require('crypto');
const { db } = require('./db');

const app = express();
app.set('trust proxy', 1);

const JWT_SECRET  = process.env.JWT_SECRET  || 'change-this-to-a-long-random-secret';
const PORT        = process.env.PORT        || 3001;
const ADMIN_LIMIT = 2;

// ── Middleware ───────────────────────────────────────────
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: true }));
app.use(express.json({ limit: '1mb' }));

// Single-tenant: always scope to the default tenant
app.use((req, res, next) => {
  req.tdb = db.forTenant(process.env.TENANT_ID || 'default');
  next();
});

// ── Rate limiters ────────────────────────────────────────
const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, max: 10,
  message: { error: 'Too many login attempts. Wait 15 minutes and try again.' }
});
const voteLimiter = rateLimit({
  windowMs: 60 * 1000, max: 10,
  message: { error: 'Too many attempts. Wait a moment and try again.' }
});

// ── Auth middleware ──────────────────────────────────────
function verifyAdmin(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.admin = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Session expired — please log in again' }); }
}

function verifyVoter(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'Not authenticated' });
  try { req.voterSession = jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Voting session expired' }); }
}

// ── Health / config ──────────────────────────────────────
app.get('/api/health', (req, res) => res.json({ status: 'ok', edition: 'community' }));

app.get('/api/config', async (req, res) => {
  try {
    const s = await req.tdb.settings?.getOrgSettings?.() || {};
    res.json({ orgName: s.orgName || process.env.ORG_NAME || 'VoterTerminal', edition: 'community' });
  } catch { res.json({ orgName: process.env.ORG_NAME || 'VoterTerminal', edition: 'community' }); }
});

// ── Public: active election ──────────────────────────────
// Returns minimal info (no ballot code) for the voter landing page
app.get('/api/elections', async (req, res) => {
  try {
    const all = await req.tdb.elections.getAll();
    const now = new Date();
    const active = all
      .filter(e => e.status === 'active' && new Date(e.endTime) > now)
      .map(e => ({ id: e.id, name: e.name, type: e.type, candidates: e.candidates, endTime: e.endTime }));
    res.json(active);
  } catch { res.status(500).json({ error: 'Failed to load elections' }); }
});

// ── Admin: login ─────────────────────────────────────────
app.post('/api/admin/login', loginLimiter, async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    const admin = await req.tdb.admins.getByEmail(email.toLowerCase().trim());
    if (!admin || !bcrypt.compareSync(password, admin.passwordHash))
      return res.status(401).json({ error: 'Invalid email or password' });
    const token = jwt.sign({ id: admin.id, email: admin.email, role: admin.role }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ token, email: admin.email, role: admin.role });
  } catch { res.status(500).json({ error: 'Login failed' }); }
});

// ── Admin: change password ───────────────────────────────
app.put('/api/admin/change-password', verifyAdmin, async (req, res) => {
  try {
    const { currentPassword, newPassword } = req.body;
    if (!newPassword || newPassword.length < 8)
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    const admin = await req.tdb.admins.getByEmail(req.admin.email);
    if (!bcrypt.compareSync(currentPassword, admin.passwordHash))
      return res.status(401).json({ error: 'Current password is incorrect' });
    await req.tdb.admins.update(admin.id, { passwordHash: bcrypt.hashSync(newPassword, 10) });
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to change password' }); }
});

// ── Admin: manage admins (max 2) ─────────────────────────
app.get('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const admins = await req.tdb.admins.getAll();
    res.json(admins.map(a => ({ id: a.id, email: a.email, role: a.role, createdAt: a.createdAt })));
  } catch { res.status(500).json({ error: 'Failed to load admins' }); }
});

app.post('/api/admin/users', verifyAdmin, async (req, res) => {
  try {
    const all = await req.tdb.admins.getAll();
    if (all.length >= ADMIN_LIMIT)
      return res.status(403).json({
        error: `Community Edition supports up to ${ADMIN_LIMIT} admin accounts. Upgrade to VoterTerminal SaaS for unlimited team members — voterterminal.com`
      });
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'Email and password required' });
    if (password.length < 8) return res.status(400).json({ error: 'Password must be at least 8 characters' });
    const exists = await req.tdb.admins.getByEmail(email.toLowerCase().trim());
    if (exists) return res.status(409).json({ error: 'An admin with that email already exists' });
    const admin = {
      id: `admin_${Date.now()}`,
      email: email.toLowerCase().trim(),
      passwordHash: bcrypt.hashSync(password, 10),
      role: 'admin', createdAt: new Date()
    };
    await req.tdb.admins.create(admin);
    res.status(201).json({ id: admin.id, email: admin.email, role: admin.role });
  } catch { res.status(500).json({ error: 'Failed to create admin' }); }
});

app.delete('/api/admin/users/:id', verifyAdmin, async (req, res) => {
  try {
    if (req.params.id === req.admin.id)
      return res.status(400).json({ error: "You can't delete your own account" });
    await req.tdb.admins.delete(req.params.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete admin' }); }
});

// ── Admin: org settings ──────────────────────────────────
app.put('/api/admin/settings/org', verifyAdmin, async (req, res) => {
  try {
    if (req.tdb.settings?.updateOrgSettings) await req.tdb.settings.updateOrgSettings(req.body);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to save settings' }); }
});

// ── Admin: elections ─────────────────────────────────────
app.post('/api/admin/elections', verifyAdmin, async (req, res) => {
  try {
    const { name, candidates, ballotCode, endTime } = req.body;
    if (!name?.trim())      return res.status(400).json({ error: 'Election name is required' });
    if (!ballotCode?.trim()) return res.status(400).json({ error: 'Ballot code is required' });
    if (!endTime)            return res.status(400).json({ error: 'End time is required' });
    if (!Array.isArray(candidates) || candidates.filter(c => c.name?.trim()).length < 2)
      return res.status(400).json({ error: 'At least 2 candidates are required' });

    // Enforce 1 active election limit
    const all = await req.tdb.elections.getAll();
    const hasActive = all.some(e => e.status === 'active' && new Date(e.endTime) > new Date());
    if (hasActive)
      return res.status(403).json({
        error: 'Community Edition supports one active election at a time. End the current election first. Upgrade to VoterTerminal SaaS for unlimited simultaneous elections — voterterminal.com'
      });

    const election = {
      id:            `election_${Date.now()}`,
      name:          name.trim(),
      type:          'plurality',
      candidates:    candidates.filter(c => c.name?.trim()),
      ballotCode:    ballotCode.trim().toUpperCase(),
      votedSessions: [],
      endTime:       new Date(endTime),
      createdBy:     req.admin.email,
      createdAt:     new Date(),
      status:        'active',
      voterCount:    0,
    };
    res.status(201).json(await req.tdb.elections.create(election));
  } catch (err) {
    console.error('[create election]', err);
    res.status(500).json({ error: 'Failed to create election' });
  }
});

app.get('/api/admin/elections', verifyAdmin, async (req, res) => {
  try { res.json(await req.tdb.elections.getAll()); }
  catch { res.status(500).json({ error: 'Failed to load elections' }); }
});

app.delete('/api/admin/elections/:id', verifyAdmin, async (req, res) => {
  try {
    if (!(await req.tdb.elections.getById(req.params.id)))
      return res.status(404).json({ error: 'Election not found' });
    await req.tdb.elections.delete(req.params.id);
    res.json({ success: true });
  } catch { res.status(500).json({ error: 'Failed to delete election' }); }
});

app.post('/api/admin/elections/:id/end', verifyAdmin, async (req, res) => {
  try {
    const election = await req.tdb.elections.getById(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });
    await req.tdb.elections.update(req.params.id, { status: 'ended', endedAt: new Date() });
    const votes   = await req.tdb.votes.getByElection(req.params.id);
    const results = calculateResults(votes, election);
    await req.tdb.results.save({ electionId: req.params.id, results, calculatedAt: new Date(), totalVotes: votes.length });
    res.json({ success: true, results });
  } catch { res.status(500).json({ error: 'Failed to end election' }); }
});

app.get('/api/admin/elections/:id/results', verifyAdmin, async (req, res) => {
  try {
    const election = await req.tdb.elections.getById(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });
    const votes = await req.tdb.votes.getByElection(req.params.id);
    res.json({ election, results: calculateResults(votes, election), totalVotes: votes.length });
  } catch { res.status(500).json({ error: 'Failed to load results' }); }
});

app.get('/api/admin/elections/:id/participants', verifyAdmin, async (req, res) => {
  try {
    const election = await req.tdb.elections.getById(req.params.id);
    if (!election) return res.status(404).json({ error: 'Election not found' });
    res.json({ votedCount: election.votedSessions?.length || 0 });
  } catch { res.status(500).json({ error: 'Failed to load participants' }); }
});

// ── Voter: enter ballot code → get session token ─────────
app.post('/api/voter/access', voteLimiter, async (req, res) => {
  try {
    const { electionId, ballotCode } = req.body;
    if (!electionId || !ballotCode)
      return res.status(400).json({ error: 'electionId and ballotCode are required' });

    const election = await req.tdb.elections.getById(electionId);
    if (!election) return res.status(404).json({ error: 'Election not found' });
    if (election.status !== 'active' || new Date(election.endTime) < new Date())
      return res.status(400).json({ error: 'This election is not currently open for voting' });
    if (election.ballotCode !== ballotCode.trim().toUpperCase())
      return res.status(403).json({ error: 'Incorrect ballot code' });

    const sessionId   = randomBytes(16).toString('hex');
    const votingToken = jwt.sign({ sessionId, electionId }, JWT_SECRET, { expiresIn: '2h' });
    res.json({
      votingToken,
      election: { id: election.id, name: election.name, type: election.type, candidates: election.candidates }
    });
  } catch { res.status(500).json({ error: 'Failed to process ballot code' }); }
});

// ── Voter: submit ballot ─────────────────────────────────
app.post('/api/voter/vote', verifyVoter, async (req, res) => {
  try {
    const { choices } = req.body;
    const { sessionId, electionId } = req.voterSession;

    const election = await req.tdb.elections.getById(electionId);
    if (!election) return res.status(404).json({ error: 'Election not found' });
    if (election.status !== 'active' || new Date(election.endTime) < new Date())
      return res.status(400).json({ error: 'Voting period has ended' });
    if ((election.votedSessions || []).includes(sessionId))
      return res.status(400).json({ error: 'This device has already voted in this election' });
    if (!choices || Object.keys(choices).length === 0)
      return res.status(400).json({ error: 'No choices submitted' });

    await req.tdb.votes.create({
      id:        `vote_${Date.now()}_${randomBytes(4).toString('hex')}`,
      electionId,
      choices,
      createdAt: new Date(),
    });

    await req.tdb.elections.update(electionId, {
      votedSessions: [...(election.votedSessions || []), sessionId],
      voterCount:    (election.voterCount || 0) + 1,
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[voter/vote]', err);
    res.status(500).json({ error: 'Failed to submit vote' });
  }
});

// ── Results calculation (plurality) ─────────────────────
function calculateResults(votes, election) {
  const tally = {};
  (election.candidates || []).forEach(c => {
    tally[c.id || c.name] = { name: c.name, votes: 0 };
  });
  votes.forEach(v => {
    const choice = v.choices?.candidate || v.choices?.['0'];
    if (choice && tally[choice]) tally[choice].votes++;
  });
  const ranked = Object.values(tally).sort((a, b) => b.votes - a.votes);
  const total  = ranked.reduce((s, c) => s + c.votes, 0);
  return ranked.map(c => ({
    ...c,
    percentage: total > 0 ? Math.round((c.votes / total) * 100) : 0
  }));
}

// ── Global error handler ─────────────────────────────────
app.use((err, req, res, next) => { // eslint-disable-line no-unused-vars
  console.error('[error]', req.method, req.path, err.message);
  res.status(500).json({ error: 'Something went wrong. Please reload and try again.' });
});

process.on('uncaughtException',  err    => console.error('[uncaughtException]', err.message, err.stack));
process.on('unhandledRejection', reason => console.error('[unhandledRejection]', reason));

// ── Start ────────────────────────────────────────────────
async function startServer() {
  await db.init();
  const PORT = process.env.PORT || 3001;
  app.listen(PORT, () => {
    console.log(`\nVoterTerminal Community Edition — port ${PORT}`);
    console.log(`Storage: ${process.env.DATABASE_URL ? 'PostgreSQL' : 'in-memory (set DATABASE_URL for persistence)'}`);
    console.log(`Upgrade: https://voterterminal.com\n`);
  });
}

startServer().catch(err => {
  console.error('Failed to start:', err.message);
  process.exit(1);
});
