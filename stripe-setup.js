#!/usr/bin/env node
// ==========================================
// VoteTerminal — Stripe Product & Price Setup
// ==========================================
// Run this ONCE to create products and prices in your Stripe account.
// It will print the price IDs to paste into your .env file.
//
// Usage:
//   STRIPE_SECRET_KEY=sk_live_xxx node stripe-setup.js
//   # or for testing:
//   STRIPE_SECRET_KEY=sk_test_xxx node stripe-setup.js
//
// After running, copy the STRIPE_PRICE_xxx lines into your .env.
// ==========================================

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

if (!process.env.STRIPE_SECRET_KEY) {
  console.error('Error: STRIPE_SECRET_KEY environment variable is required.');
  console.error('Usage: STRIPE_SECRET_KEY=sk_live_xxx node stripe-setup.js');
  process.exit(1);
}

const isTest = process.env.STRIPE_SECRET_KEY.startsWith('sk_test_');
console.log(`\nUsing ${isTest ? '🧪 TEST' : '🔴 LIVE'} Stripe key\n`);

// ── Plan definitions ──────────────────────────────────────────────────────────
const PLANS = [
  {
    id: 'community',
    name: 'VoteTerminal Community',
    description: 'Up to 10 elections/month, 500 voters per election, email confirmations',
    price: 1900, // $19.00
    features: [
      '10 elections per month',
      '500 voters per election',
      'Email confirmations',
      'Voter roll (CSV upload)',
      'Custom branding',
      'Email support'
    ]
  },
  {
    id: 'pro',
    name: 'VoteTerminal Pro',
    description: 'Unlimited elections, 2,000 voters per election, priority support',
    price: 7500, // $75.00
    features: [
      'Unlimited elections',
      '2,000 voters per election',
      'Everything in Community',
      'Priority support',
      'Advanced audit logs'
    ]
  },
  {
    id: 'enterprise',
    name: 'VoteTerminal Enterprise',
    description: 'Unlimited everything, white-label, SLA, dedicated support',
    price: 9900, // $99.00
    features: [
      'Unlimited elections',
      'Unlimited voters',
      'White-label (remove VoteTerminal branding)',
      'Custom subdomain CNAME',
      'SLA guarantee',
      'Dedicated support',
      'Priority feature requests'
    ]
  }
];

// ── Customer portal configuration ─────────────────────────────────────────────
async function configureCustomerPortal() {
  try {
    await stripe.billingPortal.configurations.create({
      business_profile: {
        headline: 'VoteTerminal — Manage your subscription',
      },
      features: {
        subscription_cancel: {
          enabled: true,
          mode: 'at_period_end',
          cancellation_reason: {
            enabled: true,
            options: ['too_expensive', 'missing_features', 'switched_service', 'unused', 'other']
          }
        },
        subscription_update: {
          enabled: true,
          default_allowed_updates: ['price'],
          proration_behavior: 'create_prorations'
        },
        payment_method_update: { enabled: true },
        invoice_history: { enabled: true }
      }
    });
    console.log('  ✅ Customer portal configured');
  } catch (err) {
    // Portal may already be configured — not a fatal error
    console.log(`  ℹ️  Customer portal: ${err.message}`);
  }
}

// ── Main setup ────────────────────────────────────────────────────────────────
async function setup() {
  console.log('Setting up VoteTerminal Stripe products and prices...\n');

  const envLines = [];
  const priceIds = {};

  for (const plan of PLANS) {
    process.stdout.write(`Creating product: ${plan.name}...`);

    // Create or find existing product
    let product;
    const existing = await stripe.products.search({
      query: `name:"${plan.name}" AND active:"true"`
    });

    if (existing.data.length > 0) {
      product = existing.data[0];
      process.stdout.write(` (found existing) `);
    } else {
      product = await stripe.products.create({
        name: plan.name,
        description: plan.description,
        metadata: {
          voterterminal_plan: plan.id,
          features: plan.features.join(' | ')
        }
      });
    }

    // Create monthly recurring price
    const price = await stripe.prices.create({
      product: product.id,
      unit_amount: plan.price,
      currency: 'usd',
      recurring: {
        interval: 'month',
        interval_count: 1
      },
      metadata: {
        voterterminal_plan: plan.id
      },
      nickname: `VoteTerminal ${plan.id.charAt(0).toUpperCase() + plan.id.slice(1)} Monthly`
    });

    priceIds[plan.id] = price.id;
    envLines.push(`STRIPE_PRICE_${plan.id.toUpperCase()}=${price.id}`);
    console.log(` ✅  $${plan.price / 100}/mo → ${price.id}`);
  }

  // Set up customer portal
  process.stdout.write('Configuring customer portal...');
  await configureCustomerPortal();

  // Print .env lines
  console.log('\n' + '─'.repeat(60));
  console.log('Add these to your .env file:\n');
  envLines.forEach(line => console.log(line));
  console.log('─'.repeat(60));

  // Print webhook setup reminder
  console.log(`
Next steps:
  1. Add the STRIPE_PRICE_xxx lines above to your .env
  2. Set up a webhook in the Stripe dashboard:
       Endpoint URL: https://voterterminal.com/api/stripe/webhook
       Events to listen for:
         - checkout.session.completed
         - customer.subscription.updated
         - customer.subscription.deleted
         - invoice.payment_failed
         - invoice.payment_succeeded
  3. Copy the webhook signing secret into your .env:
       STRIPE_WEBHOOK_SECRET=whsec_xxx
  4. Restart your server: pm2 restart voterterminal
`);

  if (isTest) {
    console.log('⚠️  You used a TEST key. Run again with your LIVE key before going to production.\n');
  }
}

setup().catch(err => {
  console.error('\nSetup failed:', err.message);
  process.exit(1);
});
