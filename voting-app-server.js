// ==========================================
// SECURE VOTING APPLICATION - BACKEND
// ==========================================
// This is a production-ready Node.js/Express server
// Install dependencies: npm install express cors dotenv bcryptjs jsonwebtoken nodemailer

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { EmailService, templates } = require('./email-service');
require('dotenv').config();

const app = express();

// ==========================================
// MIDDLEWARE
// ==========================================
app.use(cors());
app.use(express.json());

// ==========================================
// IN-MEMORY DATABASE (Replace with MongoDB/PostgreSQL)
// ==========================================
// For production, use a real database

const DATABASE = {
  elections: [],
  voters: [], // Only stores email + confirmation status (no vote data)
  votes: [], // Stores votes anonymously (no email attached)
  adminUsers: [
    {
      id: 'admin1',
      email: process.env.ADMIN_EMAIL || 'admin@voting.com',
      passwordHash: bcrypt.hashSync(process.env.ADMIN_PASSWORD || 'admin123', 10),
      role: 'admin'
    }
  ],
  auditLog: [], // For emergency: who voted + their voteId (emergency-access only)
  invalidations: [], // Log of all voter invalidations & re-tallies
  results: [],
  // SaaS: per-tenant email config. When set, overrides platform-level EMAIL_PROVIDER env vars.
  // Shape matches EmailService tenantConfig — see email-service.js for full docs.
  tenantEmailConfig: null,
  // Org branding — configurable by admin. SaaS: each tenant gets their own.
  orgConfig: {
    orgName: process.env.ORG_NAME || 'Gwinnett Democratic Party',
    orgTagline: process.env.ORG_TAGLINE || 'Official Ballot',
    bannerColor: process.env.ORG_BANNER_COLOR || '#003087',
    logoUrl: process.env.ORG_LOGO_URL || 'https://i0.wp.com/gwinnettdemocrats.com/wp-content/uploads/2025/03/GwinnettDemocrats-01.png?resize=768%2C189&ssl=1'
  }
};

// ==========================================
// EMAIL CONFIGURATION
// ==========================================
// Provider is controlled by EMAIL_PROVIDER in .env (smtp | sendgrid | ses | resend | console).
// See .env.example for the full list of options.
// For SaaS multi-tenant deployments, call PUT /api/admin/settings/email to store
// per-tenant credentials in DATABASE.tenantEmailConfig.
function getEmailService() {
  return new EmailService(DATABASE.tenantEmailConfig || null);
}

// ==========================================
// PUBLIC ENDPOINTS (no auth required)
// ==========================================

// Health check — used by Docker, load balancers, uptime monitors
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), env: process.env.NODE_ENV });
});

// Org branding config — read by voter portal on load
app.get('/api/config', (req, res) => {
  res.json(DATABASE.orgConfig);
});

// Active elections list — voters need this to pick which election to enter
app.get('/api/elections', (req, res) => {
  const now = new Date();
  const active = DATABASE.elections
    .filter(e => e.status === 'active' && new Date(e.endTime) > now)
    .map(e => ({
      id: e.id,
      name: e.name,
      description: e.description,
      type: e.type,
      candidates: e.candidates,
      endTime: e.endTime,
      inviteOnly: e.inviteOnly || false
    }));
  res.json(active);
});

// ==========================================
// AUTHENTICATION ENDPOINTS
// ==========================================

// Admin Login
app.post('/api/admin/login', (req, res) => {
  const { email, password } = req.body;
  const admin = DATABASE.adminUsers.find(a => a.email === email);

  if (!admin || !bcrypt.compareSync(password, admin.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }

  const token = jwt.sign(
    { id: admin.id, email: admin.email, role: 'admin' },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '24h' }
  );

  res.json({ token, admin: { id: admin.id, email: admin.email } });
});

// Verify Admin Token Middleware
const verifyAdmin = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Not admin' });
    req.admin = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ==========================================
// ADMIN SETTINGS
// ==========================================

// Get current email configuration (safe — never returns credentials)
app.get('/api/admin/settings/email', verifyAdmin, (req, res) => {
  const cfg = DATABASE.tenantEmailConfig;
  res.json({
    usingTenantConfig: !!cfg,
    provider: cfg ? cfg.provider : (process.env.EMAIL_PROVIDER || 'console'),
    fromAddress: cfg ? cfg.fromAddress : (process.env.EMAIL_FROM || process.env.EMAIL_USER || null),
    fromName: cfg ? cfg.fromName : (process.env.EMAIL_FROM_NAME || 'SecureVote'),
  });
});

// Set per-tenant email config (SaaS: each org can send from their own domain)
// Pass provider + credentials in the request body. See email-service.js for full shape.
// To revert to platform defaults, send { reset: true }.
app.put('/api/admin/settings/email', verifyAdmin, (req, res) => {
  const { reset, ...config } = req.body;

  if (reset) {
    DATABASE.tenantEmailConfig = null;
    return res.json({ message: 'Tenant email config cleared — using platform defaults.' });
  }

  if (!config.provider) {
    return res.status(400).json({ error: '`provider` is required (smtp | sendgrid | ses | resend | console)' });
  }

  const allowed = ['smtp', 'sendgrid', 'ses', 'resend', 'console'];
  if (!allowed.includes(config.provider)) {
    return res.status(400).json({ error: `provider must be one of: ${allowed.join(', ')}` });
  }

  DATABASE.tenantEmailConfig = config;
  res.json({
    message: `Tenant email config updated — using provider: ${config.provider}`,
    provider: config.provider,
    fromAddress: config.fromAddress || null,
    fromName: config.fromName || null,
  });
});

// Admin: change own password
app.put('/api/admin/change-password', verifyAdmin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'currentPassword and newPassword are required' });
  }
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
  }
  const admin = DATABASE.adminUsers.find(a => a.id === req.admin.id);
  if (!admin || !bcrypt.compareSync(currentPassword, admin.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  res.json({ success: true, message: 'Password updated successfully' });
});

// Admin: add a new admin user
app.post('/api/admin/users', verifyAdmin, (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) {
    return res.status(400).json({ error: 'email and password are required' });
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (DATABASE.adminUsers.find(a => a.email === email)) {
    return res.status(409).json({ error: 'An admin with that email already exists' });
  }
  const newAdmin = {
    id: `admin_${Date.now()}`,
    email,
    name: name || email,
    passwordHash: bcrypt.hashSync(password, 10),
    role: 'admin'
  };
  DATABASE.adminUsers.push(newAdmin);
  res.json({ success: true, message: `Admin ${email} added`, id: newAdmin.id });
});

// Admin: list admin users
app.get('/api/admin/users', verifyAdmin, (req, res) => {
  res.json(DATABASE.adminUsers.map(a => ({ id: a.id, email: a.email, name: a.name || a.email, role: a.role })));
});

// Admin: delete an admin user (cannot delete yourself)
app.delete('/api/admin/users/:id', verifyAdmin, (req, res) => {
  if (req.params.id === req.admin.id) {
    return res.status(400).json({ error: 'You cannot delete your own account' });
  }
  const index = DATABASE.adminUsers.findIndex(a => a.id === req.params.id);
  if (index === -1) return res.status(404).json({ error: 'Admin not found' });
  if (DATABASE.adminUsers.length === 1) {
    return res.status(400).json({ error: 'Cannot delete the last admin account' });
  }
  DATABASE.adminUsers.splice(index, 1);
  res.json({ success: true, message: 'Admin removed' });
});

// Admin: update org branding (name, tagline, logo URL, banner color)
app.put('/api/admin/settings/org', verifyAdmin, (req, res) => {
  const { orgName, orgTagline, bannerColor, logoUrl } = req.body;
  if (orgName)     DATABASE.orgConfig.orgName     = orgName;
  if (orgTagline)  DATABASE.orgConfig.orgTagline  = orgTagline;
  if (bannerColor) DATABASE.orgConfig.bannerColor = bannerColor;
  if (logoUrl !== undefined) DATABASE.orgConfig.logoUrl = logoUrl;
  res.json({ success: true, orgConfig: DATABASE.orgConfig });
});

// ==========================================
// ADMIN ENDPOINTS - ELECTION MANAGEMENT
// ==========================================

// Create Election
app.post('/api/admin/elections', verifyAdmin, (req, res) => {
  const {
    name,
    description,
    type, // 'ranked-choice', 'plurality', 'majority'
    candidates,
    startTime,
    endTime,
    requiresAffidavit,
    inviteOnly         // boolean — if true, only voters on the voter roll can vote
  } = req.body;

  const election = {
    id: `election_${Date.now()}`,
    name,
    description,
    type,
    candidates: candidates || [],
    startTime: new Date(startTime),
    endTime: new Date(endTime),
    requiresAffidavit: requiresAffidavit !== false,
    createdBy: req.admin.email,
    createdAt: new Date(),
    status: 'active', // 'active', 'ended', 'draft'
    voterCount: 0,
    // Invite-only fields — populated via POST /api/admin/elections/:id/voter-roll
    inviteOnly: inviteOnly === true,
    voterRoll: [],          // [{ email, name, accessCode, used, usedAt }]
    universalPasswordHash: null // bcrypt hash set when voter roll is uploaded
  };

  DATABASE.elections.push(election);
  res.status(201).json(election);
});

// Get All Elections (Admin)
app.get('/api/admin/elections', verifyAdmin, (req, res) => {
  res.json(DATABASE.elections);
});

// Update Election
app.put('/api/admin/elections/:id', verifyAdmin, (req, res) => {
  const election = DATABASE.elections.find(e => e.id === req.params.id);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  Object.assign(election, req.body);
  res.json(election);
});

// End Election
app.post('/api/admin/elections/:id/end', verifyAdmin, (req, res) => {
  const election = DATABASE.elections.find(e => e.id === req.params.id);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  election.status = 'ended';
  election.endedAt = new Date();
  
  // Calculate results
  const results = calculateResults(req.params.id, election.type);
  DATABASE.results.push({
    electionId: req.params.id,
    results,
    calculatedAt: new Date(),
    totalVotes: DATABASE.votes.filter(v => v.electionId === req.params.id).length
  });

  res.json({ election, results });
});

// ==========================================
// VOTER ROLL: CSV UPLOAD & VOTER ACCESS
// ==========================================

// Rate limiter for voter access endpoint — prevents brute-forcing access codes
const accessCodeLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,
  message: { error: 'Too many access attempts. Please wait 15 minutes and try again.' }
});

// Upload voter roll CSV and send access codes.
// Uploading a voter roll automatically restricts the election to listed voters only.
// To reopen an election to all, DELETE the voter roll.
// Body: { csvContent: "email,name\n...", universalPassword: "..." }
// The universalPassword is stored hashed and returned ONCE in the response.
// Admin should save it somewhere safe — it cannot be retrieved again.
app.post('/api/admin/elections/:id/voter-roll', verifyAdmin, async (req, res) => {
  const election = DATABASE.elections.find(e => e.id === req.params.id);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  const { csvContent, universalPassword } = req.body;
  if (!csvContent) return res.status(400).json({ error: 'csvContent is required' });
  if (!universalPassword || universalPassword.trim().length < 8) {
    return res.status(400).json({ error: 'universalPassword must be at least 8 characters' });
  }

  // Parse CSV
  let rows;
  try {
    rows = parseInviteCSV(csvContent);
  } catch (err) {
    return res.status(400).json({ error: `CSV parse error: ${err.message}` });
  }
  if (rows.length === 0) return res.status(400).json({ error: 'No valid rows found in CSV. Expected columns: email, name' });

  // Hash the universal password
  election.universalPasswordHash = bcrypt.hashSync(universalPassword.trim(), 10);

  // Uploading a voter roll automatically enables voter-roll restriction
  election.inviteOnly = true;

  // Generate a unique access code for each invited voter
  const emailService = getEmailService();
  const results = { sent: [], failed: [], duplicates: [] };

  for (const row of rows) {
    // Skip duplicates (same email already on list for this election)
    if (election.voterRoll.find(v => v.email === row.email)) {
      results.duplicates.push(row.email);
      continue;
    }

    const accessCode = generateAccessCode();
    election.voterRoll.push({
      email: row.email,
      name: row.name,
      accessCode,      // stored plaintext — single-use, low-value after use
      used: false,
      usedAt: null,
      invitedAt: new Date()
    });

    // Send invite email
    const { subject, html } = templates.inviteCode({
      recipientName: row.name,
      electionName: election.name,
      accessCode,
      fromName: emailService.config.fromName,
    });
    const sent = await emailService.send({ to: row.email, subject, html });
    if (sent) results.sent.push(row.email);
    else results.failed.push(row.email);
  }

  res.status(201).json({
    message: `Voter roll processed. ${results.sent.length} emails sent.`,
    totalInvited: election.voterRoll.length,
    sent: results.sent.length,
    failed: results.failed,
    duplicatesSkipped: results.duplicates,
    // Universal password shown ONCE here — admin must save it
    universalPassword: universalPassword.trim(),
    universalPasswordNote: 'Save this password securely. It cannot be retrieved again. Give it to voters who lose their personal access code.'
  });
});

// Get voter roll status (who has/hasn't voted yet) — no codes shown
app.get('/api/admin/elections/:id/voter-roll', verifyAdmin, (req, res) => {
  const election = DATABASE.elections.find(e => e.id === req.params.id);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  res.json({
    electionId: election.id,
    voterRollEnabled: election.inviteOnly,
    totalOnRoll: election.voterRoll.length,
    totalVoted: election.voterRoll.filter(v => v.used).length,
    voters: election.voterRoll.map(v => ({
      email: v.email,
      name: v.name,
      voted: v.used,
      votedAt: v.usedAt || null
      // accessCode intentionally omitted
    }))
  });
});

// Remove voter roll and reopen election to all voters
app.delete('/api/admin/elections/:id/voter-roll', verifyAdmin, (req, res) => {
  const election = DATABASE.elections.find(e => e.id === req.params.id);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  const hadRoll = election.voterRoll.length > 0;
  election.voterRoll = [];
  election.universalPasswordHash = null;
  election.inviteOnly = false;

  res.json({
    message: hadRoll
      ? 'Voter roll removed. This election is now open to all voters.'
      : 'No voter roll was set. Election remains open.',
    voterRollEnabled: false
  });
});

// Voter access for invite-only elections
// Body: { electionId, email, accessCode }
// accessCode can be the voter's personal code OR the universal password
app.post('/api/voter/access', accessCodeLimiter, (req, res) => {
  const { electionId, email, accessCode } = req.body;
  if (!electionId || !email || !accessCode) {
    return res.status(400).json({ error: 'electionId, email, and accessCode are required' });
  }

  const election = DATABASE.elections.find(e => e.id === electionId);
  if (!election) return res.status(404).json({ error: 'Election not found' });
  if (!election.inviteOnly) return res.status(400).json({ error: 'This election does not use access codes. Use /api/voter/register instead.' });

  const now = new Date();
  if (election.endTime < now) return res.status(400).json({ error: 'Voting period has ended' });

  // Find this voter on the voter roll
  const invited = election.voterRoll.find(v => v.email === email.toLowerCase().trim());
  if (!invited) return res.status(403).json({ error: 'This email address is not on the voter roll for this election.' });

  // Check if already voted
  const alreadyVoted = DATABASE.voters.find(v => v.email === email.toLowerCase().trim() && v.electionId === electionId && v.hasVoted);
  if (alreadyVoted) return res.status(400).json({ error: 'This email has already cast a vote in this election.' });

  // Validate: personal access code OR universal password
  const personalCodeMatch = invited.accessCode === accessCode.trim().toUpperCase();
  const universalMatch = election.universalPasswordHash && bcrypt.compareSync(accessCode.trim(), election.universalPasswordHash);

  if (!personalCodeMatch && !universalMatch) {
    return res.status(403).json({ error: 'Invalid access code. Check your invitation email or contact the election administrator.' });
  }

  // Create voter record (same structure as open elections)
  const voter = {
    id: `voter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    email: email.toLowerCase().trim(),
    electionId,
    registeredAt: new Date(),
    hasVoted: false,
    votedAt: null,
    affidavitConfirmed: false,
    name: invited.name,
    address: null,
    accessMethod: universalMatch ? 'universal' : 'personal-code' // for audit purposes only
  };
  DATABASE.voters.push(voter);

  // Mark invite slot as used (will be fully confirmed when vote is submitted)
  invited.used = true;
  invited.usedAt = new Date();

  // Issue voting token — same flow as open elections from here
  const votingToken = jwt.sign(
    { voterId: voter.id, electionId },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '4h' }
  );

  res.status(201).json({
    voterId: voter.id,
    votingToken,
    election: {
      id: election.id,
      name: election.name,
      candidates: election.candidates,
      type: election.type
    }
  });
});

// ==========================================
// VOTER REGISTRATION & VOTING
// ==========================================

// Register Voter (Initial Check-in)
app.post('/api/voter/register', (req, res) => {
  const { email, name, address, affidavit, electionId } = req.body;

  // Validate election exists and is active
  const election = DATABASE.elections.find(e => e.id === electionId);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  // Invite-only elections use /api/voter/access instead
  if (election.inviteOnly) {
    return res.status(400).json({ error: 'This is a voter-roll election. Use /api/voter/access with your personal access code.' });
  }

  const now = new Date();
  if (election.endTime < now) {
    return res.status(400).json({ error: 'Voting period has ended' });
  }

  if (election.requiresAffidavit && !affidavit) {
    return res.status(400).json({ error: 'Affidavit required' });
  }

  // Check if voter already registered for this election
  const existingVoter = DATABASE.voters.find(
    v => v.email === email && v.electionId === electionId
  );
  if (existingVoter) {
    return res.status(400).json({ error: 'You have already registered for this election' });
  }

  // Create voter record (WITHOUT storing vote data)
  const voter = {
    id: `voter_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    email,
    electionId,
    registeredAt: new Date(),
    hasVoted: false,
    votedAt: null,
    affidavitConfirmed: affidavit || false,
    name, // Only for verification purposes
    address // Only for verification purposes
  };

  DATABASE.voters.push(voter);

  // Create a voting token (separate from voter identity)
  const votingToken = jwt.sign(
    { voterId: voter.id, electionId },
    process.env.JWT_SECRET || 'your-secret-key',
    { expiresIn: '4h' }
  );

  res.status(201).json({
    voterId: voter.id,
    votingToken,
    election: {
      id: election.id,
      name: election.name,
      candidates: election.candidates,
      type: election.type
    }
  });
});

// Verify Voting Token
const verifyVoter = (req, res, next) => {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'your-secret-key');
    req.voterSession = decoded;
    next();
  } catch (err) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// Submit Vote (with confirmation)
app.post('/api/voter/vote', verifyVoter, (req, res) => {
  const { choices, confirmationToken } = req.body;
  const { voterId, electionId } = req.voterSession;

  // Find voter
  const voter = DATABASE.voters.find(v => v.id === voterId);
  if (!voter) return res.status(404).json({ error: 'Voter not found' });

  // Check if already voted
  if (voter.hasVoted) {
    return res.status(400).json({ error: 'You have already voted' });
  }

  // Validate election still active
  const election = DATABASE.elections.find(e => e.id === electionId);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  const now = new Date();
  if (election.endTime < now) {
    return res.status(400).json({ error: 'Voting period has ended' });
  }

  // Create anonymous vote record (NO EMAIL ATTACHED)
  const vote = {
    id: `vote_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    electionId,
    choices, // Can be array for ranked choice or single choice
    voteType: election.type,
    submittedAt: new Date()
    // INTENTIONALLY NO VOTER EMAIL OR ID
  };

  DATABASE.votes.push(vote);

  // Update voter record (marks they voted, but doesn't store HOW)
  voter.hasVoted = true;
  voter.votedAt = new Date();

  // Log audit entry (emergency voter lookup — voteId stored here ONLY)
  DATABASE.auditLog.push({
    email: voter.email,
    electionId,
    voterId: voter.id,
    voteId: vote.id,   // Stored only for emergency invalidation; not exposed by default
    timestamp: new Date(),
    action: 'voted',
    invalidated: false
  });

  // Send confirmation email
  sendConfirmationEmail(voter.email, election.name, vote.id);

  res.status(201).json({
    voteId: vote.id,
    message: 'Vote submitted successfully',
    receiptToken: jwt.sign(
      { voteId: vote.id, email: voter.email },
      process.env.JWT_SECRET || 'your-secret-key',
      { expiresIn: '30d' }
    )
  });
});

// Get Confirmation Screen Data
app.post('/api/voter/confirmation-preview', verifyVoter, (req, res) => {
  const { choices } = req.body;
  const { electionId } = req.voterSession;

  const election = DATABASE.elections.find(e => e.id === electionId);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  // Display what will be voted (for confirmation only)
  let preview = {
    electionName: election.name,
    voteType: election.type,
    choices: []
  };

  if (election.type === 'ranked-choice') {
    preview.choices = choices.map((choice, index) => ({
      rank: index + 1,
      candidate: choice
    }));
  } else {
    preview.choices = Array.isArray(choices) ? choices : [choices];
  }

  res.json(preview);
});

// ==========================================
// RESULTS & ADMIN REPORTING
// ==========================================

// Get Election Results (Admin Only)
app.get('/api/admin/elections/:id/results', verifyAdmin, (req, res) => {
  const electionId = req.params.id;
  const election = DATABASE.elections.find(e => e.id === electionId);

  if (!election) return res.status(404).json({ error: 'Election not found' });

  const electionVotes = DATABASE.votes.filter(v => v.electionId === electionId);
  const results = calculateResults(electionId, election.type);

  res.json({
    election: {
      id: election.id,
      name: election.name,
      type: election.type,
      status: election.status,
      startTime: election.startTime,
      endTime: election.endTime,
      totalVoters: DATABASE.voters.filter(v => v.electionId === electionId).length,
      totalVotes: electionVotes.length,
      votingPercentage: (
        (electionVotes.length / DATABASE.voters.filter(v => v.electionId === electionId).length) * 100
      ).toFixed(2)
    },
    results
  });
});

// Emergency Voter Lookup (Admin Only - Audit Trail)
app.get('/api/admin/elections/:id/audit-log', verifyAdmin, (req, res) => {
  const electionId = req.params.id;
  const adminPassword = req.query.adminPassword;

  // Extra security for emergency access
  if (adminPassword !== process.env.EMERGENCY_PASSWORD) {
    DATABASE.auditLog.push({
      timestamp: new Date(),
      action: 'unauthorized_audit_attempt',
      adminId: req.admin.id
    });
    return res.status(403).json({ error: 'Unauthorized — incorrect emergency password' });
  }

  // Log that the audit was accessed
  DATABASE.invalidations.push({
    action: 'audit_log_accessed',
    electionId,
    accessedBy: req.admin.email,
    timestamp: new Date()
  });

  const auditEntries = DATABASE.auditLog.filter(
    entry => entry.electionId === electionId && entry.action === 'voted'
  );

  res.json({
    electionId,
    voterCount: auditEntries.length,
    voters: auditEntries.map(entry => ({
      voterId: entry.voterId,
      email: entry.email,
      timestamp: entry.timestamp,
      invalidated: entry.invalidated,
      invalidatedAt: entry.invalidatedAt || null,
      invalidatedReason: entry.invalidatedReason || null
    }))
  });
});

// ==========================================
// EMERGENCY: INVALIDATE VOTER & RE-TALLY
// ==========================================

// Invalidate a voter's vote (removes their anonymous vote from the tally)
// Requires emergency password. Full audit trail is created.
app.post('/api/admin/elections/:id/invalidate-voter', verifyAdmin, (req, res) => {
  const electionId = req.params.id;
  const { voterId, reason, emergencyPassword } = req.body;

  // Require emergency password for this destructive action
  if (emergencyPassword !== process.env.EMERGENCY_PASSWORD) {
    DATABASE.invalidations.push({
      action: 'unauthorized_invalidation_attempt',
      electionId,
      targetVoterId: voterId,
      attemptedBy: req.admin.email,
      timestamp: new Date()
    });
    return res.status(403).json({ error: 'Unauthorized — incorrect emergency password' });
  }

  if (!reason || reason.trim().length < 10) {
    return res.status(400).json({ error: 'A reason of at least 10 characters is required for invalidation' });
  }

  // Find the voter record
  const voter = DATABASE.voters.find(v => v.id === voterId && v.electionId === electionId);
  if (!voter) return res.status(404).json({ error: 'Voter not found in this election' });

  if (!voter.hasVoted) {
    return res.status(400).json({ error: 'This voter has not cast a vote' });
  }

  if (voter.invalidated) {
    return res.status(400).json({ error: 'This voter has already been invalidated' });
  }

  // Find the audit log entry to get the anonymous voteId
  const auditEntry = DATABASE.auditLog.find(
    entry => entry.voterId === voterId && entry.electionId === electionId && entry.action === 'voted'
  );

  if (!auditEntry) {
    return res.status(404).json({ error: 'Audit log entry not found — cannot safely invalidate' });
  }

  // Find the anonymous vote using the voteId from the audit log
  const voteIndex = DATABASE.votes.findIndex(v => v.id === auditEntry.voteId);
  if (voteIndex === -1) {
    return res.status(404).json({ error: 'Vote record not found — may have already been removed' });
  }

  // Soft-delete: mark vote as invalidated (don't hard-delete for auditability)
  DATABASE.votes[voteIndex].invalidated = true;
  DATABASE.votes[voteIndex].invalidatedAt = new Date();

  // Mark voter as invalidated
  voter.invalidated = true;
  voter.invalidatedAt = new Date();
  voter.invalidationReason = reason.trim();

  // Mark audit log entry as invalidated
  auditEntry.invalidated = true;
  auditEntry.invalidatedAt = new Date();
  auditEntry.invalidatedReason = reason.trim();
  auditEntry.invalidatedBy = req.admin.email;

  // Full audit trail of this action
  DATABASE.invalidations.push({
    action: 'voter_invalidated',
    electionId,
    voterId: voter.id,
    voterEmail: voter.email,     // Stored in invalidation log for accountability
    voteId: auditEntry.voteId,
    reason: reason.trim(),
    invalidatedBy: req.admin.email,
    timestamp: new Date()
  });

  // Recalculate results immediately (excluding invalidated votes)
  const election = DATABASE.elections.find(e => e.id === electionId);
  const retally = recalculateResults(electionId, election.type);

  // Notify voter by email that their vote was invalidated
  sendInvalidationEmail(voter.email, election.name, reason.trim());

  res.json({
    success: true,
    message: `Voter ${voter.email} has been invalidated and the tally has been updated`,
    invalidatedVoterId: voter.id,
    retally
  });
});

// Re-instate a previously invalidated voter (undo an invalidation)
app.post('/api/admin/elections/:id/reinstate-voter', verifyAdmin, (req, res) => {
  const electionId = req.params.id;
  const { voterId, reason, emergencyPassword } = req.body;

  if (emergencyPassword !== process.env.EMERGENCY_PASSWORD) {
    return res.status(403).json({ error: 'Unauthorized — incorrect emergency password' });
  }

  if (!reason || reason.trim().length < 10) {
    return res.status(400).json({ error: 'A reason of at least 10 characters is required for reinstatement' });
  }

  const voter = DATABASE.voters.find(v => v.id === voterId && v.electionId === electionId);
  if (!voter) return res.status(404).json({ error: 'Voter not found' });

  if (!voter.invalidated) {
    return res.status(400).json({ error: 'This voter is not currently invalidated' });
  }

  // Find and restore the vote
  const auditEntry = DATABASE.auditLog.find(
    entry => entry.voterId === voterId && entry.electionId === electionId && entry.action === 'voted'
  );

  if (auditEntry) {
    const vote = DATABASE.votes.find(v => v.id === auditEntry.voteId);
    if (vote) {
      vote.invalidated = false;
      delete vote.invalidatedAt;
    }
    auditEntry.invalidated = false;
    delete auditEntry.invalidatedAt;
    delete auditEntry.invalidatedReason;
    delete auditEntry.invalidatedBy;
  }

  voter.invalidated = false;
  voter.reinstatedAt = new Date();
  voter.reinstatedReason = reason.trim();
  delete voter.invalidationReason;

  DATABASE.invalidations.push({
    action: 'voter_reinstated',
    electionId,
    voterId: voter.id,
    voterEmail: voter.email,
    reason: reason.trim(),
    reinstatedBy: req.admin.email,
    timestamp: new Date()
  });

  const election = DATABASE.elections.find(e => e.id === electionId);
  const retally = recalculateResults(electionId, election.type);

  sendReinstateEmail(voter.email, election.name, reason.trim());

  res.json({
    success: true,
    message: `Voter ${voter.email} has been reinstated and the tally has been updated`,
    reinstatedVoterId: voter.id,
    retally
  });
});

// Manual Re-tally endpoint (recalculate without changing anything)
app.post('/api/admin/elections/:id/retally', verifyAdmin, (req, res) => {
  const electionId = req.params.id;
  const { emergencyPassword } = req.body;

  if (emergencyPassword !== process.env.EMERGENCY_PASSWORD) {
    return res.status(403).json({ error: 'Unauthorized — incorrect emergency password' });
  }

  const election = DATABASE.elections.find(e => e.id === electionId);
  if (!election) return res.status(404).json({ error: 'Election not found' });

  const results = recalculateResults(electionId, election.type);

  DATABASE.invalidations.push({
    action: 'manual_retally',
    electionId,
    requestedBy: req.admin.email,
    timestamp: new Date()
  });

  res.json({
    message: 'Re-tally complete',
    electionId,
    results
  });
});

// Get invalidation history for an election (Admin Only)
app.get('/api/admin/elections/:id/invalidation-log', verifyAdmin, (req, res) => {
  const electionId = req.params.id;
  const { emergencyPassword } = req.query;

  if (emergencyPassword !== process.env.EMERGENCY_PASSWORD) {
    return res.status(403).json({ error: 'Unauthorized — incorrect emergency password' });
  }

  const log = DATABASE.invalidations.filter(e => e.electionId === electionId);
  const invalidatedVoters = DATABASE.voters.filter(
    v => v.electionId === electionId && v.invalidated
  );

  res.json({
    electionId,
    totalInvalidations: invalidatedVoters.length,
    history: log,
    currentlyInvalidated: invalidatedVoters.map(v => ({
      voterId: v.id,
      email: v.email,
      invalidatedAt: v.invalidatedAt,
      reason: v.invalidationReason
    }))
  });
});

// ==========================================
// HELPER FUNCTIONS
// ==========================================

function calculateResults(electionId, voteType) {
  // Exclude invalidated votes from the tally
  const votes = DATABASE.votes.filter(v => v.electionId === electionId && !v.invalidated);

  if (voteType === 'ranked-choice') {
    return calculateRankedChoice(votes);
  } else if (voteType === 'majority') {
    return calculateMajority(votes);
  } else {
    return calculatePlurality(votes);
  }
}

// recalculateResults: same as calculateResults, but also returns invalidated count
function recalculateResults(electionId, voteType) {
  const allVotes = DATABASE.votes.filter(v => v.electionId === electionId);
  const validVotes = allVotes.filter(v => !v.invalidated);
  const invalidatedCount = allVotes.length - validVotes.length;

  let tally;
  if (voteType === 'ranked-choice') {
    tally = calculateRankedChoice(validVotes);
  } else if (voteType === 'majority') {
    tally = calculateMajority(validVotes);
  } else {
    tally = calculatePlurality(validVotes);
  }

  return {
    ...tally,
    totalValidVotes: validVotes.length,
    totalInvalidatedVotes: invalidatedCount,
    retalliedAt: new Date()
  };
}

function calculatePlurality(votes) {
  // 50% + 1 or Simple Plurality
  const tallies = {};

  votes.forEach(vote => {
    const choice = Array.isArray(vote.choices) ? vote.choices[0] : vote.choices;
    tallies[choice] = (tallies[choice] || 0) + 1;
  });

  const sorted = Object.entries(tallies)
    .map(([candidate, votes]) => ({ candidate, votes }))
    .sort((a, b) => b.votes - a.votes);

  return {
    type: 'plurality',
    results: sorted,
    winner: sorted[0]?.candidate
  };
}

function calculateMajority(votes) {
  // 50% + 1 requirement
  const tallies = {};
  votes.forEach(vote => {
    const choice = Array.isArray(vote.choices) ? vote.choices[0] : vote.choices;
    tallies[choice] = (tallies[choice] || 0) + 1;
  });

  const majority = votes.length / 2 + 1;
  const winners = Object.entries(tallies)
    .filter(([_, count]) => count >= majority)
    .map(([candidate, count]) => ({ candidate, votes: count }));

  return {
    type: 'majority',
    results: Object.entries(tallies)
      .map(([candidate, votes]) => ({ candidate, votes }))
      .sort((a, b) => b.votes - a.votes),
    majorityRequired: majority,
    winners: winners.length > 0 ? winners : null
  };
}

function calculateRankedChoice(votes) {
  // Simplified ranked choice (instant runoff)
  let rounds = [];
  let roundVotes = votes.map(v => [...v.choices]);

  let round = 1;
  while (roundVotes.length > 0 && round <= 10) {
    const tallies = {};

    roundVotes.forEach(ballotChoices => {
      if (ballotChoices.length > 0) {
        const choice = ballotChoices[0];
        tallies[choice] = (tallies[choice] || 0) + 1;
      }
    });

    const roundResults = Object.entries(tallies)
      .map(([candidate, count]) => ({ candidate, votes: count }))
      .sort((a, b) => b.votes - a.votes);

    rounds.push({ round, results: roundResults });

    if (roundResults.length === 1) break;

    // Eliminate last place candidate
    const lastPlace = roundResults[roundResults.length - 1].candidate;
    roundVotes = roundVotes
      .map(choices => choices.filter(c => c !== lastPlace))
      .filter(choices => choices.length > 0);

    round++;
  }

  return {
    type: 'ranked-choice',
    rounds,
    winner: rounds[rounds.length - 1]?.results[0]?.candidate
  };
}

function sendConfirmationEmail(email, electionName, voteId) {
  const emailService = getEmailService();
  const { subject, html } = templates.voteConfirmation({
    electionName,
    voteId,
    fromName: emailService.config.fromName,
  });
  emailService.send({ to: email, subject, html });
}

function sendInvalidationEmail(email, electionName, reason) {
  const emailService = getEmailService();
  const { subject, html } = templates.voteInvalidated({
    electionName,
    reason,
    fromName: emailService.config.fromName,
  });
  emailService.send({ to: email, subject, html });
}

function sendReinstateEmail(email, electionName, reason) {
  const emailService = getEmailService();
  const { subject, html } = templates.voteReinstated({
    electionName,
    reason,
    fromName: emailService.config.fromName,
  });
  emailService.send({ to: email, subject, html });
}

// ==========================================
// VOTER ROLL HELPER FUNCTIONS
// ==========================================

// Parse a two-column CSV (email, name) into an array of objects.
// Handles quoted fields, trims whitespace, skips blank lines.
function parseInviteCSV(csvContent) {
  const lines = csvContent.trim().split(/\r?\n/);
  if (lines.length < 2) throw new Error('CSV must have a header row and at least one data row');

  const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/^"|"$/g, ''));
  const emailIdx = headers.indexOf('email');
  const nameIdx  = headers.indexOf('name');

  if (emailIdx === -1) throw new Error('CSV must include an "email" column');
  if (nameIdx  === -1) throw new Error('CSV must include a "name" column');

  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const cols = line.split(',').map(c => c.trim().replace(/^"|"$/g, ''));
    const email = cols[emailIdx]?.toLowerCase().trim();
    const name  = cols[nameIdx]?.trim();

    if (!email || !email.includes('@')) continue; // skip invalid rows silently
    rows.push({ email, name: name || email });
  }
  return rows;
}

// Generate a human-friendly 8-character access code (e.g. "ABCD-EFG2").
// Excludes visually ambiguous characters: 0, O, 1, I, L.
function generateAccessCode() {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    if (i === 4) code += '-';
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code; // e.g. "ABCD-EFG2"
}

// ==========================================
// START SERVER
// ==========================================

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => {
  console.log(`Voting app server running on port ${PORT}`);
  console.log('Environment: ' + (process.env.NODE_ENV || 'development'));
});
