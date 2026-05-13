// ==========================================
// VOTERTERMINAL — MULTI-TENANT SaaS SERVER
// ==========================================
// This is the SaaS version of voting-app-server.js.
// Each tenant is identified by their subdomain (e.g. gdp.voterterminal.com → tenant "gdp").
// All data is isolated per tenant.
//
// Architecture:
//   TENANTS["gdp"] = {
//     orgConfig: { orgName, logoUrl, ... }
//     elections: []
//     voters: []
//     votes: []
//     adminUsers: []
//     auditLog: []
//     subscription: { plan, status, stripeCustomerId, stripeSubId }
//   }
//
// Endpoints:
//   Superadmin (platform owner):  /api/superadmin/*  — manage all tenants
//   Tenant admin:                 /api/admin/*        — manage their own org
//   Public:                       /api/*              — voters, config, elections

const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { EmailService } = require('./email-service');
const fs   = require('fs');
const path = require('path');
require('dotenv').config();

// ==========================================
// JSON PERSISTENCE
// ==========================================
// Tenants are saved to a JSON file on every write.
// On startup the file is loaded back into memory so
// a pm2 restart / server reboot never loses tenant data.
// Location: ./tenants.json (same dir as this file)
// Override with TENANTS_FILE env var.

const TENANTS_FILE = process.env.TENANTS_FILE || path.join(__dirname, 'tenants.json');
const TENANTS_TMP  = TENANTS_FILE + '.tmp';

function saveTenants() {
  try {
    // Atomic write: write to .tmp then rename so a crash mid-write
    // never leaves a corrupt file.
    fs.writeFileSync(TENANTS_TMP, JSON.stringify(TENANTS, null, 2), 'utf8');
    fs.renameSync(TENANTS_TMP, TENANTS_FILE);
  } catch (err) {
    console.error('[persistence] Failed to save tenants.json:', err.message);
  }
}

function loadTenants() {
  if (!fs.existsSync(TENANTS_FILE)) {
    console.log('[persistence] No tenants.json found — starting fresh.');
    return;
  }
  try {
    const raw = fs.readFileSync(TENANTS_FILE, 'utf8');
    const saved = JSON.parse(raw);
    Object.assign(TENANTS, saved);
    console.log(`[persistence] Loaded ${Object.keys(saved).length} tenant(s) from tenants.json`);
  } catch (err) {
    console.error('[persistence] Failed to load tenants.json:', err.message);
    console.error('[persistence] Starting with empty tenant store. Check the file for corruption.');
  }
}

// ── Optional: Stripe ──────────────────────────────────────────────────────────
let stripe = null;
if (process.env.STRIPE_SECRET_KEY) {
  try { stripe = require('stripe')(process.env.STRIPE_SECRET_KEY); } catch {}
}

const app = express();

// Raw body needed for Stripe webhook signature verification
app.use('/api/stripe/webhook', express.raw({ type: 'application/json' }));
app.use(express.json());
app.use(cors({
  origin: (origin, cb) => cb(null, true), // Allow all subdomains
  credentials: true
}));

// ==========================================
// PLAN DEFINITIONS
// ==========================================
// Pricing rationale: competitors (ElectionBuddy, Election Runner) charge per election.
// ElectionBuddy charges $99 for ONE election with 1,000 voters.
// VoterTerminal's monthly subscription wins for any org running 2+ elections/year.
//
// -1 = unlimited
const PLANS = {
  free: {
    name: 'Free',
    maxElectionsPerMonth: 1,
    maxVotersPerElection: 50,
    emailEnabled: false,
    voterRollEnabled: false,
    customBranding: false,
    price: 0,
    description: 'Test the platform. 1 election, 50 voters.'
  },
  starter: {
    name: 'Starter',
    maxElectionsPerMonth: 10,
    maxVotersPerElection: 500,
    emailEnabled: true,
    voterRollEnabled: true,
    customBranding: true,
    price: 2900, // $29/mo
    description: '10 elections/month, 500 voters each, email confirmations.'
  },
  pro: {
    name: 'Pro',
    maxElectionsPerMonth: -1,
    maxVotersPerElection: 2000,
    emailEnabled: true,
    voterRollEnabled: true,
    customBranding: true,
    price: 7500, // $75/mo
    description: 'Unlimited elections, 2,000 voters each, priority support.'
  },
  enterprise: {
    name: 'Enterprise',
    maxElectionsPerMonth: -1,
    maxVotersPerElection: -1,
    emailEnabled: true,
    voterRollEnabled: true,
    customBranding: true,
    whiteLabel: true,
    price: 9900, // $99/mo
    description: 'Unlimited everything, white-label, dedicated support.'
  },
  // Internal: grandfathered tenants never hit billing walls
  grandfathered: {
    name: 'Grandfathered',
    maxElectionsPerMonth: -1,
    maxVotersPerElection: -1,
    emailEnabled: true,
    voterRollEnabled: true,
    customBranding: true,
    whiteLabel: false,
    price: 0,
    description: 'Legacy account — no billing restrictions.'
  }
};

// ── Grandfathered tenants (never charged) ────────────────────────────────────
// Add subdomain strings here for accounts that should never be billed.
// GDP was our first customer and gets free access forever.
const GRANDFATHERED_TENANTS = (process.env.GRANDFATHERED_TENANTS || 'gdp').split(',').map(s => s.trim());

// ==========================================
// TENANT STORE (replace with real DB in production)
// ==========================================
const TENANTS = {};

// Superadmin store
const SUPERADMINS = [
  {
    id: 'superadmin1',
    email: process.env.SUPERADMIN_EMAIL || 'super@voterterminal.com',
    passwordHash: bcrypt.hashSync(process.env.SUPERADMIN_PASSWORD || 'changeme123', 10)
  }
];

// ── Helper: get or create tenant ──────────────────────────────────────────────
function getTenant(subdomain) {
  if (!TENANTS[subdomain]) return null;
  return TENANTS[subdomain];
}

function createTenant({ subdomain, orgName, adminEmail, adminPassword, plan = 'free', logoUrl = null }) {
  if (TENANTS[subdomain]) throw new Error('Tenant already exists');

  // Auto-grandfather known tenants
  const isGrandfathered = GRANDFATHERED_TENANTS.includes(subdomain);
  const effectivePlan = isGrandfathered ? 'grandfathered' : plan;

  TENANTS[subdomain] = {
    subdomain,
    createdAt: new Date().toISOString(),
    orgConfig: {
      orgName: orgName || subdomain,
      orgTagline: 'Official Ballot',
      bannerColor: '#003087',
      logoUrl: logoUrl || null
    },
    elections: [],
    voters: [],
    votes: [],
    adminUsers: [
      {
        id: `${subdomain}_admin1`,
        email: adminEmail,
        passwordHash: bcrypt.hashSync(adminPassword, 10),
        role: 'admin'
      }
    ],
    auditLog: [],
    invalidations: [],
    tenantEmailConfig: null,
    subscription: {
      plan: effectivePlan,
      status: 'active',
      grandfathered: isGrandfathered,
      stripeCustomerId: null,
      stripeSubscriptionId: null,
      trialEndsAt: (effectivePlan === 'free' && !isGrandfathered)
        ? new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()
        : null
    }
  };
  saveTenants();
  return TENANTS[subdomain];
}

// ==========================================
// MIDDLEWARE
// ==========================================

// Resolve tenant from Host header
function resolveTenant(req, res, next) {
  const host = (req.hostname || '').toLowerCase();
  // Strip port if present
  const hostname = host.split(':')[0];
  const baseDomain = (process.env.BASE_DOMAIN || 'voterterminal.com').toLowerCase();

  // Check if it's a subdomain
  if (hostname === baseDomain || hostname === `www.${baseDomain}`) {
    req.tenant = null; // Main marketing site
    return next();
  }

  if (hostname.endsWith(`.${baseDomain}`)) {
    const subdomain = hostname.replace(`.${baseDomain}`, '');
    req.tenantId = subdomain;
    req.tenant = getTenant(subdomain);
    if (!req.tenant) {
      return res.status(404).json({ error: 'Organisation not found. Check your URL.' });
    }
    return next();
  }

  // Fallback: allow direct IP/localhost for testing
  req.tenant = null;
  next();
}

// Require a valid tenant
function requireTenant(req, res, next) {
  if (!req.tenant) return res.status(404).json({ error: 'Tenant not found' });
  next();
}

// Require active subscription (handles trial, cancellation, grandfather)
function requireActiveSubscription(req, res, next) {
  const sub = req.tenant && req.tenant.subscription;
  if (!sub) return next();

  // Grandfathered tenants always pass
  if (sub.grandfathered) return next();

  // Cancelled
  if (sub.status === 'cancelled') {
    return res.status(402).json({
      error: 'Subscription cancelled.',
      upgradeUrl: `https://${process.env.BASE_DOMAIN || 'voterterminal.com'}/#signup`,
      code: 'SUBSCRIPTION_CANCELLED'
    });
  }

  // Trialing — Stripe is managing the trial, allow through
  if (sub.status === 'trialing') return next();

  // Trial expired (legacy local trial check)
  if (sub.trialEndsAt && new Date(sub.trialEndsAt) < new Date() && sub.plan === 'free') {
    return res.status(402).json({
      error: 'Your free trial has ended. Upgrade to continue running elections.',
      upgradeUrl: `https://${req.tenant.subdomain}.${process.env.BASE_DOMAIN || 'voterterminal.com'}/admin?upgrade=1`,
      code: 'TRIAL_EXPIRED'
    });
  }

  // Past due — allow read but block new elections
  if (sub.status === 'past_due' && req.method !== 'GET') {
    return res.status(402).json({
      error: 'Payment failed. Please update your payment method to continue.',
      portalUrl: null, // set by client after calling /api/admin/billing/portal
      code: 'PAYMENT_PAST_DUE'
    });
  }

  next();
}

app.use(resolveTenant);

// ── Auth helpers ──────────────────────────────────────────────────────────────
function signToken(payload) {
  return jwt.sign(payload, process.env.JWT_SECRET || 'dev-secret', { expiresIn: '8h' });
}

function verifyAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev-secret');
    if (decoded.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    req.admin = decoded;
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function verifySuperAdmin(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev-secret');
    if (decoded.role !== 'superadmin') return res.status(403).json({ error: 'Superadmin access required' });
    req.superadmin = decoded;
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

function verifyVoter(req, res, next) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(auth.slice(7), process.env.JWT_SECRET || 'dev-secret');
    if (decoded.role !== 'voter') return res.status(403).json({ error: 'Voter token required' });
    req.voter = decoded;
    next();
  } catch { res.status(401).json({ error: 'Invalid or expired token' }); }
}

// Rate limiters
const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });
const accessCodeLimiter = rateLimit({ windowMs: 15 * 60 * 1000, max: 10 });

// ==========================================
// HEALTH CHECK
// ==========================================
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', uptime: process.uptime(), tenants: Object.keys(TENANTS).length });
});

// ==========================================
// SUPERADMIN ENDPOINTS
// ==========================================

// Superadmin login
app.post('/api/superadmin/login', loginLimiter, (req, res) => {
  const { email, password } = req.body;
  const sa = SUPERADMINS.find(s => s.email === email);
  if (!sa || !bcrypt.compareSync(password, sa.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signToken({ id: sa.id, email: sa.email, role: 'superadmin' });
  res.json({ token });
});

// List all tenants
app.get('/api/superadmin/tenants', verifySuperAdmin, (req, res) => {
  const list = Object.values(TENANTS).map(t => ({
    subdomain: t.subdomain,
    orgName: t.orgConfig.orgName,
    plan: t.subscription.plan,
    status: t.subscription.status,
    elections: t.elections.length,
    createdAt: t.createdAt
  }));
  res.json(list);
});

// Create a tenant (manual provisioning)
app.post('/api/superadmin/tenants', verifySuperAdmin, (req, res) => {
  const { subdomain, orgName, adminEmail, adminPassword, plan, logoUrl } = req.body;
  if (!subdomain || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'subdomain, adminEmail, adminPassword are required' });
  }
  try {
    const tenant = createTenant({ subdomain, orgName, adminEmail, adminPassword, plan, logoUrl });
    res.json({ success: true, subdomain: tenant.subdomain, orgName: tenant.orgConfig.orgName });
  } catch (err) {
    res.status(409).json({ error: err.message });
  }
});

// Update a tenant's plan
app.put('/api/superadmin/tenants/:subdomain/plan', verifySuperAdmin, (req, res) => {
  const tenant = getTenant(req.params.subdomain);
  if (!tenant) return res.status(404).json({ error: 'Tenant not found' });
  const { plan, status } = req.body;
  if (plan && !PLANS[plan]) return res.status(400).json({ error: `Invalid plan. Options: ${Object.keys(PLANS).join(', ')}` });
  if (plan) tenant.subscription.plan = plan;
  if (status) tenant.subscription.status = status;
  saveTenants();
  res.json({ success: true, subscription: tenant.subscription });
});

// Delete a tenant
app.delete('/api/superadmin/tenants/:subdomain', verifySuperAdmin, (req, res) => {
  if (!TENANTS[req.params.subdomain]) return res.status(404).json({ error: 'Tenant not found' });
  delete TENANTS[req.params.subdomain];
  saveTenants();
  res.json({ success: true, message: `Tenant ${req.params.subdomain} deleted` });
});

// ==========================================
// PUBLIC SELF-SIGNUP (SaaS onboarding)
// ==========================================
app.post('/api/signup', loginLimiter, async (req, res) => {
  const { subdomain, orgName, adminEmail, adminPassword, logoUrl, plan } = req.body;

  if (!subdomain || !orgName || !adminEmail || !adminPassword) {
    return res.status(400).json({ error: 'subdomain, orgName, adminEmail, adminPassword are required' });
  }
  if (!/^[a-z0-9-]{2,32}$/.test(subdomain)) {
    return res.status(400).json({ error: 'Subdomain must be 2-32 lowercase letters, numbers, or hyphens' });
  }
  if (adminPassword.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' });
  }
  if (TENANTS[subdomain]) {
    return res.status(409).json({ error: 'That subdomain is already taken' });
  }

  try {
    const tenant = createTenant({ subdomain, orgName, adminEmail, adminPassword, plan: 'free', logoUrl });

    // Welcome email
    if (process.env.EMAIL_PROVIDER && process.env.EMAIL_PROVIDER !== 'console') {
      const emailService = new EmailService();
      await emailService.send({
        to: adminEmail,
        subject: `Welcome to VoterTerminal — ${orgName} is ready`,
        html: `
          <h2>Welcome to VoterTerminal!</h2>
          <p>Your organisation <strong>${orgName}</strong> is live at:</p>
          <p><a href="https://${subdomain}.${process.env.BASE_DOMAIN || 'voterterminal.com'}/admin">
            https://${subdomain}.${process.env.BASE_DOMAIN || 'voterterminal.com'}/admin
          </a></p>
          <p>Log in with your email and the password you set during signup.</p>
          <p>Your free plan includes 3 elections with up to 100 voters each.
          <a href="https://${process.env.BASE_DOMAIN || 'voterterminal.com'}/pricing">Upgrade anytime</a>
          to unlock unlimited elections, voter rolls, and email confirmations.</p>
        `
      }).catch(() => {});
    }

    const adminUrl = `https://${subdomain}.${process.env.BASE_DOMAIN || 'voterterminal.com'}/admin`;

    // If Stripe is configured and a paid plan was chosen, create a checkout session with 7-day trial
    let checkoutUrl = null;
    const selectedPlan = ['starter', 'pro'].includes(plan) ? plan : 'starter';
    if (stripe) {
      const priceId = process.env[`STRIPE_PRICE_${selectedPlan.toUpperCase()}`];
      if (priceId) {
        try {
          const session = await stripe.checkout.sessions.create({
            mode: 'subscription',
            payment_method_types: ['card'],
            customer_email: adminEmail,
            line_items: [{ price: priceId, quantity: 1 }],
            metadata: { subdomain, plan: selectedPlan },
            subscription_data: {
              trial_period_days: 7,
              metadata: { subdomain, plan: selectedPlan }
            },
            success_url: `${adminUrl}?upgraded=1`,
            cancel_url: `${adminUrl}?upgrade=cancelled`,
            allow_promotion_codes: true
          });
          checkoutUrl = session.url;
        } catch (e) { /* non-fatal — fall through to admin URL */ }
      }
    }

    res.json({
      success: true,
      url: `https://${subdomain}.${process.env.BASE_DOMAIN || 'voterterminal.com'}`,
      adminUrl,
      checkoutUrl,
      plan: selectedPlan
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ==========================================
// STRIPE ENDPOINTS
// ==========================================

// Create Stripe checkout session for plan upgrade (public — no auth required so trial users can upgrade)
app.post('/api/stripe/checkout', requireTenant, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe is not configured on this server. Contact support.' });

  const { plan, email } = req.body;
  const validPaidPlans = ['starter', 'pro', 'enterprise'];
  if (!validPaidPlans.includes(plan)) {
    return res.status(400).json({ error: `Invalid plan. Options: ${validPaidPlans.join(', ')}` });
  }

  const tenant = req.tenant;
  if (tenant.subscription.grandfathered) {
    return res.status(400).json({ error: 'This account does not require a subscription.' });
  }

  const priceId = process.env[`STRIPE_PRICE_${plan.toUpperCase()}`];
  if (!priceId) {
    return res.status(500).json({ error: `Billing not fully configured. Contact support.` });
  }

  try {
    const sessionParams = {
      mode: 'subscription',
      payment_method_types: ['card'],
      line_items: [{ price: priceId, quantity: 1 }],
      metadata: { subdomain: tenant.subdomain, plan },
      subscription_data: {
        metadata: { subdomain: tenant.subdomain, plan },
        trial_period_days: (!tenant.subscription.stripeSubscriptionId) ? 7 : undefined
      },
      success_url: `https://${tenant.subdomain}.${process.env.BASE_DOMAIN || 'voterterminal.com'}/admin?upgraded=1`,
      cancel_url:  `https://${tenant.subdomain}.${process.env.BASE_DOMAIN || 'voterterminal.com'}/admin?upgrade=cancelled`,
      allow_promotion_codes: true
    };

    // Pre-fill email if provided or if we have a Stripe customer
    if (tenant.subscription.stripeCustomerId) {
      sessionParams.customer = tenant.subscription.stripeCustomerId;
    } else if (email) {
      sessionParams.customer_email = email;
    }

    const session = await stripe.checkout.sessions.create(sessionParams);
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Open Stripe customer portal (manage billing, cancel, update card)
app.post('/api/admin/billing/portal', requireTenant, verifyAdmin, async (req, res) => {
  if (!stripe) return res.status(503).json({ error: 'Stripe not configured' });

  const tenant = req.tenant;
  if (!tenant.subscription.stripeCustomerId) {
    return res.status(400).json({ error: 'No billing account found. Subscribe first.' });
  }

  try {
    const session = await stripe.billingPortal.sessions.create({
      customer: tenant.subscription.stripeCustomerId,
      return_url: `https://${tenant.subdomain}.${process.env.BASE_DOMAIN || 'voterterminal.com'}/admin`
    });
    res.json({ url: session.url });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Get current subscription + available plans (used by upgrade modal in admin UI)
app.get('/api/admin/billing', requireTenant, verifyAdmin, (req, res) => {
  const sub = req.tenant.subscription;
  const currentPlan = PLANS[sub.plan] || PLANS.free;
  const availablePlans = Object.entries(PLANS)
    .filter(([key]) => !['free', 'grandfathered'].includes(key))
    .map(([key, plan]) => ({ id: key, ...plan, current: key === sub.plan }));

  res.json({
    subscription: {
      plan: sub.plan,
      status: sub.status,
      grandfathered: sub.grandfathered || false,
      trialEndsAt: sub.trialEndsAt || null,
      trialDaysRemaining: sub.trialEndsAt
        ? Math.max(0, Math.ceil((new Date(sub.trialEndsAt) - Date.now()) / 86400000))
        : null
    },
    currentPlan,
    availablePlans,
    stripeEnabled: !!stripe
  });
});

// Stripe webhook — handles subscription lifecycle events
app.post('/api/stripe/webhook', (req, res) => {
  if (!stripe) return res.status(200).send('ok');

  const sig = req.headers['stripe-signature'];
  let event;
  try {
    event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
  } catch (err) {
    return res.status(400).send(`Webhook signature verification failed: ${err.message}`);
  }

  const sub = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const subdomain = sub.metadata && sub.metadata.subdomain;
      const tenant = subdomain && getTenant(subdomain);
      if (tenant) {
        tenant.subscription.stripeCustomerId = sub.customer;
        tenant.subscription.stripeSubscriptionId = sub.subscription;
        // Status will be updated by customer.subscription.updated — set trialing for now
        tenant.subscription.status = 'trialing';
        saveTenants();
      }
      break;
    }
    case 'customer.subscription.updated': {
      const tenant = findTenantByStripeCustomer(sub.customer);
      if (tenant) {
        const planId = resolvePlanFromStripePrice(sub.items.data[0].price.id);
        if (planId) tenant.subscription.plan = planId;
        if (sub.status === 'trialing') tenant.subscription.status = 'trialing';
        else if (sub.status === 'active') tenant.subscription.status = 'active';
        else tenant.subscription.status = 'past_due';
        saveTenants();
      }
      break;
    }
    case 'customer.subscription.deleted': {
      const tenant = findTenantByStripeCustomer(sub.customer);
      if (tenant) {
        tenant.subscription.status = 'cancelled';
        tenant.subscription.plan = 'free';
        saveTenants();
      }
      break;
    }
    case 'invoice.payment_failed': {
      const tenant = findTenantByStripeCustomer(sub.customer);
      if (tenant) {
        tenant.subscription.status = 'past_due';
        saveTenants();
      }
      break;
    }
  }

  res.json({ received: true });
});

function findTenantByStripeCustomer(customerId) {
  return Object.values(TENANTS).find(t => t.subscription.stripeCustomerId === customerId) || null;
}

function resolvePlanFromStripePrice(priceId) {
  for (const plan of Object.keys(PLANS)) {
    if (process.env[`STRIPE_PRICE_${plan.toUpperCase()}`] === priceId) return plan;
  }
  return null;
}

// ==========================================
// TENANT PUBLIC ENDPOINTS
// ==========================================

app.get('/api/config', requireTenant, (req, res) => {
  res.json({
    ...req.tenant.orgConfig,
    plan: req.tenant.subscription.plan,
    planDetails: PLANS[req.tenant.subscription.plan]
  });
});

app.get('/api/elections', requireTenant, (req, res) => {
  const now = new Date();
  const active = req.tenant.elections
    .filter(e => e.status === 'active' && new Date(e.endTime) > now)
    .map(e => ({
      id: e.id, name: e.name, description: e.description,
      type: e.type, candidates: e.candidates, endTime: e.endTime,
      inviteOnly: e.inviteOnly || false
    }));
  res.json(active);
});

// ==========================================
// TENANT ADMIN ENDPOINTS
// ==========================================

app.post('/api/admin/login', loginLimiter, requireTenant, (req, res) => {
  const { email, password } = req.body;
  const admin = req.tenant.adminUsers.find(a => a.email === email);
  if (!admin || !bcrypt.compareSync(password, admin.passwordHash)) {
    return res.status(401).json({ error: 'Invalid credentials' });
  }
  const token = signToken({ id: admin.id, email: admin.email, role: 'admin', tenantId: req.tenantId });
  res.json({ token, admin: { id: admin.id, email: admin.email } });
});

// All remaining admin routes require both tenant + admin token
app.use('/api/admin', requireTenant, requireActiveSubscription, verifyAdmin, (req, res, next) => {
  // Ensure admin belongs to this tenant
  const admin = req.tenant.adminUsers.find(a => a.id === req.admin.id);
  if (!admin) return res.status(403).json({ error: 'Admin not found in this organisation' });
  next();
});

// Get tenant subscription + plan info
app.get('/api/admin/subscription', (req, res) => {
  res.json({
    subscription: req.tenant.subscription,
    plan: PLANS[req.tenant.subscription.plan],
    planName: req.tenant.subscription.plan
  });
});

// Elections CRUD
app.get('/api/admin/elections', (req, res) => res.json(req.tenant.elections));

app.post('/api/admin/elections', (req, res) => {
  const plan = PLANS[req.tenant.subscription.plan];
  if (plan.maxElections !== -1 && req.tenant.elections.length >= plan.maxElections) {
    return res.status(402).json({
      error: `Your ${plan.name} plan allows ${plan.maxElections} elections. Upgrade to create more.`,
      upgradeRequired: true
    });
  }
  const { name, description, type, candidates, endTime } = req.body;
  if (!name || !type || !candidates || !endTime) {
    return res.status(400).json({ error: 'name, type, candidates, and endTime are required' });
  }
  const election = {
    id: `election_${Date.now()}`,
    name, description, type, candidates,
    endTime, status: 'active',
    createdAt: new Date().toISOString(),
    inviteOnly: false, voterRoll: null
  };
  req.tenant.elections.push(election);
  res.json(election);
});

app.put('/api/admin/elections/:id', (req, res) => {
  const election = req.tenant.elections.find(e => e.id === req.params.id);
  if (!election) return res.status(404).json({ error: 'Election not found' });
  const allowed = ['name', 'description', 'endTime', 'status'];
  allowed.forEach(f => { if (req.body[f] !== undefined) election[f] = req.body[f]; });
  res.json(election);
});

// Admin password + user management
app.put('/api/admin/change-password', (req, res) => {
  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) return res.status(400).json({ error: 'Both passwords required' });
  if (newPassword.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
  const admin = req.tenant.adminUsers.find(a => a.id === req.admin.id);
  if (!bcrypt.compareSync(currentPassword, admin.passwordHash)) {
    return res.status(401).json({ error: 'Current password is incorrect' });
  }
  admin.passwordHash = bcrypt.hashSync(newPassword, 10);
  res.json({ success: true });
});

app.get('/api/admin/users', (req, res) => {
  res.json(req.tenant.adminUsers.map(a => ({ id: a.id, email: a.email, name: a.name || a.email })));
});

app.post('/api/admin/users', (req, res) => {
  const { email, password, name } = req.body;
  if (!email || !password) return res.status(400).json({ error: 'email and password required' });
  if (password.length < 8) return res.status(400).json({ error: 'Min 8 characters' });
  if (req.tenant.adminUsers.find(a => a.email === email)) {
    return res.status(409).json({ error: 'Admin with that email already exists' });
  }
  const newAdmin = { id: `admin_${Date.now()}`, email, name: name || email, passwordHash: bcrypt.hashSync(password, 10), role: 'admin' };
  req.tenant.adminUsers.push(newAdmin);
  res.json({ success: true, id: newAdmin.id });
});

app.delete('/api/admin/users/:id', (req, res) => {
  if (req.params.id === req.admin.id) return res.status(400).json({ error: 'Cannot delete your own account' });
  if (req.tenant.adminUsers.length === 1) return res.status(400).json({ error: 'Cannot delete last admin' });
  const idx = req.tenant.adminUsers.findIndex(a => a.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Admin not found' });
  req.tenant.adminUsers.splice(idx, 1);
  res.json({ success: true });
});

// Org settings
app.put('/api/admin/settings/org', (req, res) => {
  const { orgName, orgTagline, bannerColor, logoUrl } = req.body;
  if (orgName)     req.tenant.orgConfig.orgName     = orgName;
  if (orgTagline)  req.tenant.orgConfig.orgTagline  = orgTagline;
  if (bannerColor) req.tenant.orgConfig.bannerColor = bannerColor;
  if (logoUrl !== undefined) req.tenant.orgConfig.logoUrl = logoUrl;
  res.json({ success: true, orgConfig: req.tenant.orgConfig });
});

// ==========================================
// VOTER ENDPOINTS (tenant-scoped)
// ==========================================

app.post('/api/voter/register', requireTenant, async (req, res) => {
  const { email, electionId } = req.body;
  if (!email || !electionId) return res.status(400).json({ error: 'email and electionId required' });

  const election = req.tenant.elections.find(e => e.id === electionId && e.status === 'active');
  if (!election) return res.status(404).json({ error: 'Election not found or not active' });
  if (election.inviteOnly) return res.status(403).json({ error: 'This election requires an access code. Check your email.' });

  const plan = PLANS[req.tenant.subscription.plan];
  if (plan.maxVotersPerElection !== -1) {
    const voterCount = req.tenant.voters.filter(v => v.electionId === electionId).length;
    if (voterCount >= plan.maxVotersPerElection) {
      return res.status(402).json({ error: `Voter limit reached for your plan. Upgrade to allow more voters.` });
    }
  }

  const existingVoter = req.tenant.voters.find(v => v.email === email && v.electionId === electionId);
  if (existingVoter) {
    if (existingVoter.hasVoted) return res.status(409).json({ error: 'You have already voted in this election.' });
    const token = signToken({ voterId: existingVoter.id, electionId, role: 'voter', tenantId: req.tenantId });
    return res.json({ token, message: 'Welcome back.' });
  }

  const voter = { id: `voter_${Date.now()}_${Math.random().toString(36).slice(2)}`, email, electionId, hasVoted: false, registeredAt: new Date().toISOString() };
  req.tenant.voters.push(voter);
  const token = signToken({ voterId: voter.id, electionId, role: 'voter', tenantId: req.tenantId });
  res.json({ token, election: { name: election.name, type: election.type, candidates: election.candidates } });
});

app.post('/api/voter/vote', requireTenant, verifyVoter, (req, res) => {
  const { electionId, voterId } = req.voter;
  const { vote } = req.body;
  const election = req.tenant.elections.find(e => e.id === electionId);
  if (!election || election.status !== 'active') return res.status(400).json({ error: 'Election not active' });
  const voter = req.tenant.voters.find(v => v.id === voterId);
  if (!voter) return res.status(404).json({ error: 'Voter not found' });
  if (voter.hasVoted) return res.status(409).json({ error: 'Already voted' });

  const voteId = `vote_${Date.now()}_${Math.random().toString(36).slice(2)}`;
  req.tenant.votes.push({ id: voteId, electionId, vote, castAt: new Date().toISOString() });
  voter.hasVoted = true;
  voter.voteId = voteId;
  res.json({ success: true, voteId, message: 'Vote recorded anonymously.' });
});

app.get('/api/admin/elections/:id/results', requireTenant, verifyAdmin, (req, res) => {
  const election = req.tenant.elections.find(e => e.id === req.params.id);
  if (!election) return res.status(404).json({ error: 'Election not found' });
  const votes = req.tenant.votes.filter(v => v.electionId === req.params.id);
  const tally = {};
  election.candidates.forEach(c => tally[c] = 0);
  votes.forEach(v => {
    if (typeof v.vote === 'string' && tally[v.vote] !== undefined) tally[v.vote]++;
  });
  const totalVoters = req.tenant.voters.filter(v => v.electionId === req.params.id).length;
  res.json({ electionId: req.params.id, name: election.name, tally, totalVotes: votes.length, totalVoters, turnout: totalVoters ? Math.round(votes.length / totalVoters * 100) : 0 });
});

// ==========================================
// SERVE REACT APP (catch-all)
// ==========================================
const buildPath = path.join(__dirname, 'public');

if (fs.existsSync(buildPath)) {
  app.use(express.static(buildPath));
  app.get('*', (req, res) => {
    res.sendFile(path.join(buildPath, 'index.html'));
  });
}

// ==========================================
// START
// ==========================================
// Load persisted tenants before accepting connections
loadTenants();

// Default port 3002 — keeps tenant-server out of the way of
// voting-app-server.js which runs on 3001 (GDP single-tenant).
const PORT = process.env.PORT || 3002;
app.listen(PORT, () => {
  console.log(`VoterTerminal multi-tenant server running on port ${PORT}`);
  console.log(`Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`Base domain: ${process.env.BASE_DOMAIN || 'voterterminal.com'}`);
  console.log(`Persistence:  ${TENANTS_FILE}`);
  console.log(`Stripe: ${stripe ? 'enabled' : 'disabled (set STRIPE_SECRET_KEY to enable)'}`);
});
