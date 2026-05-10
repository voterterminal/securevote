// ==========================================
// SECUREVOTE — EMAIL SERVICE
// ==========================================
// Provider-agnostic email abstraction.
// Supports: SMTP (generic), SendGrid, AWS SES, Resend, and console (dev).
//
// Select a provider via EMAIL_PROVIDER in your .env:
//   EMAIL_PROVIDER=smtp        — any SMTP server (Mailgun, Postmark, etc.)
//   EMAIL_PROVIDER=sendgrid    — SendGrid HTTP API
//   EMAIL_PROVIDER=ses         — Amazon SES SMTP
//   EMAIL_PROVIDER=resend      — Resend SMTP
//   EMAIL_PROVIDER=console     — logs emails to stdout, no actual sending (dev/test)
//
// For SaaS multi-tenant deployments, pass a tenantConfig object when constructing
// EmailService to override platform defaults with per-tenant credentials.
// ==========================================

'use strict';

const nodemailer = require('nodemailer');

// ---------------------------------------------------------------------------
// EmailService
// ---------------------------------------------------------------------------

class EmailService {
  /**
   * @param {object|null} tenantConfig  Optional per-tenant override. When provided
   *   and it contains a `provider` key, it takes full precedence over env vars.
   *   Shape mirrors the env var names but camelCased:
   *   {
   *     provider: 'smtp' | 'sendgrid' | 'ses' | 'resend' | 'console',
   *     fromAddress: 'votes@acme.org',
   *     fromName:    'Acme Elections',
   *     // SMTP
   *     smtpHost, smtpPort, smtpSecure, smtpUser, smtpPass,
   *     // SendGrid
   *     sendgridApiKey,
   *     // AWS SES SMTP
   *     sesSmtpUser, sesSmtpPass, sesRegion,
   *     // Resend
   *     resendApiKey,
   *   }
   */
  constructor(tenantConfig = null) {
    this.config = resolveConfig(tenantConfig);
    this.transporter = createTransporter(this.config);
  }

  /** Formatted "From" string, e.g. "SecureVote <votes@example.com>" */
  get from() {
    const { fromName, fromAddress } = this.config;
    return fromName ? `"${fromName}" <${fromAddress}>` : fromAddress;
  }

  /**
   * Send an email. Never throws — failures are logged but won't crash the vote flow.
   * @param {{ to: string, subject: string, html: string, text?: string }} opts
   * @returns {Promise<object|null>} nodemailer info object, or null on failure
   */
  async send({ to, subject, html, text }) {
    if (!this.transporter) {
      console.warn(`[EmailService] No transporter configured — skipping email to ${to}`);
      return null;
    }

    if (this.config.provider === 'console') {
      logToConsole({ to, subject, html, text });
      return { messageId: 'console-dev-mode' };
    }

    try {
      const info = await this.transporter.sendMail({
        from: this.from,
        to,
        subject,
        html,
        text: text || htmlToPlainText(html),
      });
      console.log(`[EmailService:${this.config.provider}] Sent to ${to} — ${info.messageId || info.response}`);
      return info;
    } catch (err) {
      console.error(`[EmailService:${this.config.provider}] Failed to send to ${to}:`, err.message);
      return null;
    }
  }
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

function resolveConfig(tenantConfig) {
  // Tenant config wins if it specifies a provider
  if (tenantConfig && tenantConfig.provider) {
    return {
      fromAddress: tenantConfig.fromAddress || process.env.EMAIL_FROM || 'noreply@example.com',
      fromName:    tenantConfig.fromName    || process.env.EMAIL_FROM_NAME || 'SecureVote',
      ...tenantConfig,
    };
  }

  const provider = (process.env.EMAIL_PROVIDER || 'console').toLowerCase();

  return {
    provider,
    fromAddress:    process.env.EMAIL_FROM      || process.env.EMAIL_USER || 'noreply@example.com',
    fromName:       process.env.EMAIL_FROM_NAME || 'SecureVote',
    // SMTP (generic)
    smtpHost:       process.env.SMTP_HOST,
    smtpPort:       parseInt(process.env.SMTP_PORT || '587', 10),
    smtpSecure:     process.env.SMTP_SECURE === 'true',
    smtpUser:       process.env.SMTP_USER  || process.env.EMAIL_USER,
    smtpPass:       process.env.SMTP_PASS  || process.env.EMAIL_PASSWORD,
    // SendGrid
    sendgridApiKey: process.env.SENDGRID_API_KEY,
    // AWS SES SMTP
    sesSmtpUser:    process.env.SES_SMTP_USER,
    sesSmtpPass:    process.env.SES_SMTP_PASS,
    sesRegion:      process.env.SES_REGION || process.env.AWS_REGION || 'us-east-1',
    // Resend
    resendApiKey:   process.env.RESEND_API_KEY,
  };
}

function createTransporter(config) {
  switch (config.provider) {
    // ------------------------------------------------------------------
    // Generic SMTP
    // Works with: Mailgun, Postmark, Brevo, Zoho, self-hosted Postfix, etc.
    // ------------------------------------------------------------------
    case 'smtp': {
      if (!config.smtpHost) {
        console.warn('[EmailService] EMAIL_PROVIDER=smtp but SMTP_HOST is not set. Emails will not send.');
        return null;
      }
      return nodemailer.createTransport({
        host:   config.smtpHost,
        port:   config.smtpPort,
        secure: config.smtpSecure, // true = port 465 TLS, false = STARTTLS on 587
        auth: config.smtpUser ? {
          user: config.smtpUser,
          pass: config.smtpPass,
        } : undefined,
      });
    }

    // ------------------------------------------------------------------
    // SendGrid (via SMTP relay — no extra SDK needed)
    // Docs: https://docs.sendgrid.com/for-developers/sending-email/integrating-with-the-smtp-api
    // ------------------------------------------------------------------
    case 'sendgrid': {
      if (!config.sendgridApiKey) {
        console.warn('[EmailService] EMAIL_PROVIDER=sendgrid but SENDGRID_API_KEY is not set.');
        return null;
      }
      return nodemailer.createTransport({
        host:   'smtp.sendgrid.net',
        port:   587,
        secure: false,
        auth: {
          user: 'apikey',
          pass: config.sendgridApiKey,
        },
      });
    }

    // ------------------------------------------------------------------
    // Amazon SES (via SES SMTP endpoint)
    // Docs: https://docs.aws.amazon.com/ses/latest/dg/send-email-smtp.html
    // Note: SES SMTP credentials are separate from IAM keys.
    //       Generate them in: AWS Console → SES → SMTP settings → Create SMTP credentials
    // ------------------------------------------------------------------
    case 'ses': {
      if (!config.sesSmtpUser || !config.sesSmtpPass) {
        console.warn('[EmailService] EMAIL_PROVIDER=ses but SES_SMTP_USER or SES_SMTP_PASS is not set.');
        return null;
      }
      return nodemailer.createTransport({
        host:   `email-smtp.${config.sesRegion}.amazonaws.com`,
        port:   587,
        secure: false,
        auth: {
          user: config.sesSmtpUser,
          pass: config.sesSmtpPass,
        },
      });
    }

    // ------------------------------------------------------------------
    // Resend (via SMTP relay)
    // Docs: https://resend.com/docs/send-with-smtp
    // ------------------------------------------------------------------
    case 'resend': {
      if (!config.resendApiKey) {
        console.warn('[EmailService] EMAIL_PROVIDER=resend but RESEND_API_KEY is not set.');
        return null;
      }
      return nodemailer.createTransport({
        host:   'smtp.resend.com',
        port:   465,
        secure: true,
        auth: {
          user: 'resend',
          pass: config.resendApiKey,
        },
      });
    }

    // ------------------------------------------------------------------
    // Console / dev mode — logs email content to stdout, nothing is sent
    // ------------------------------------------------------------------
    case 'console':
      return nodemailer.createTransport({ jsonTransport: true });

    default:
      console.warn(`[EmailService] Unknown EMAIL_PROVIDER "${config.provider}". Defaulting to console mode.`);
      config.provider = 'console';
      return nodemailer.createTransport({ jsonTransport: true });
  }
}

/** Pretty-print email to console for dev/test */
function logToConsole({ to, subject, html, text }) {
  const divider = '─'.repeat(60);
  console.log(`\n[EmailService:console]\n${divider}`);
  console.log(`To:      ${to}`);
  console.log(`Subject: ${subject}`);
  console.log(divider);
  console.log(text || htmlToPlainText(html));
  console.log(`${divider}\n`);
}

/** Very basic HTML → plain text for the text fallback */
function htmlToPlainText(html) {
  if (!html) return '';
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// ---------------------------------------------------------------------------
// Pre-built email templates
// (Call these from your server instead of building HTML inline)
// ---------------------------------------------------------------------------

const templates = {
  /**
   * Vote confirmation receipt sent after a successful ballot submission.
   */
  voteConfirmation({ electionName, voteId, fromName = 'SecureVote' }) {
    return {
      subject: `Your vote in "${electionName}" has been recorded`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#1a1a2e;">Vote Confirmed ✓</h2>
          <p>Thank you for voting in <strong>${electionName}</strong>.</p>
          <div style="background:#f5f5f5;border-radius:6px;padding:16px;margin:16px 0;">
            <p style="margin:0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.05em;">Confirmation ID</p>
            <p style="margin:4px 0 0;font-family:monospace;font-size:18px;">${voteId}</p>
          </div>
          <p>Keep this ID for your records. Your vote is completely anonymous and cannot be traced back to you.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="font-size:12px;color:#999;">
            Sent by ${fromName}. If you did not vote in this election, please contact the election administrator immediately.
          </p>
        </div>
      `,
    };
  },

  /**
   * Notification when an admin invalidates a voter's ballot.
   */
  voteInvalidated({ electionName, reason, fromName = 'SecureVote' }) {
    return {
      subject: `Notice: Your vote in "${electionName}" has been invalidated`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#c0392b;">Vote Invalidation Notice</h2>
          <p>Your vote in <strong>${electionName}</strong> has been <strong>invalidated</strong> by an election administrator.</p>
          <div style="background:#fff3f3;border-left:4px solid #c0392b;padding:12px 16px;margin:16px 0;">
            <p style="margin:0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.05em;">Reason provided</p>
            <p style="margin:4px 0 0;">${reason}</p>
          </div>
          <p>If you believe this action was made in error, contact the election administrator immediately.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="font-size:12px;color:#999;">Official notice from ${fromName}. Do not reply to this email.</p>
        </div>
      `,
    };
  },

  /**
   * Notification when an admin reinstates a previously invalidated ballot.
   */
  voteReinstated({ electionName, reason, fromName = 'SecureVote' }) {
    return {
      subject: `Notice: Your vote in "${electionName}" has been reinstated`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#27ae60;">Vote Reinstated ✓</h2>
          <p>Your vote in <strong>${electionName}</strong> has been <strong>reinstated</strong> by an election administrator.</p>
          <div style="background:#f0fff4;border-left:4px solid #27ae60;padding:12px 16px;margin:16px 0;">
            <p style="margin:0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.05em;">Reason provided</p>
            <p style="margin:4px 0 0;">${reason}</p>
          </div>
          <p>Your vote is once again included in the official tally.</p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="font-size:12px;color:#999;">Official notice from ${fromName}. Do not reply to this email.</p>
        </div>
      `,
    };
  },

  /**
   * Invitation email for invite-only elections.
   * Delivers the voter's personal access code.
   */
  inviteCode({ recipientName, electionName, accessCode, electionUrl = null, fromName = 'SecureVote' }) {
    const urlLine = electionUrl
      ? `<p style="margin:16px 0;"><a href="${electionUrl}" style="background:#1a1a2e;color:#fff;padding:10px 20px;border-radius:5px;text-decoration:none;font-weight:bold;">Go to Ballot →</a></p>`
      : '';
    return {
      subject: `You're invited to vote: ${electionName}`,
      html: `
        <div style="font-family:sans-serif;max-width:520px;margin:0 auto;padding:24px;">
          <h2 style="color:#1a1a2e;">You're invited to vote</h2>
          <p>Hi ${recipientName},</p>
          <p>You have been invited to participate in <strong>${electionName}</strong>.</p>
          <p>Use the access code below when you go to cast your ballot. Keep it safe — this code is personal to you.</p>
          <div style="background:#f5f5f5;border-radius:6px;padding:20px;margin:20px 0;text-align:center;">
            <p style="margin:0;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.05em;">Your Access Code</p>
            <p style="margin:8px 0 0;font-family:monospace;font-size:32px;font-weight:bold;letter-spacing:4px;color:#1a1a2e;">${accessCode}</p>
          </div>
          ${urlLine}
          <p style="font-size:14px;color:#555;">
            If you lose your code, contact your election administrator for assistance.
            Your vote will be completely anonymous once cast.
          </p>
          <hr style="border:none;border-top:1px solid #eee;margin:24px 0;">
          <p style="font-size:12px;color:#999;">
            Sent by ${fromName}. If you were not expecting this invitation, you can safely ignore this email.
          </p>
        </div>
      `,
    };
  },
};

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

module.exports = { EmailService, templates };
