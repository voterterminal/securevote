import React, { useState, useEffect } from 'react';
import './VotingApp.css';

function qrUrl(data, size = 220) {
  return `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&margin=10&data=${encodeURIComponent(data)}`;
}

const API_URL = process.env.REACT_APP_API_URL ||
  `${window.location.protocol}//${window.location.host}/api`;

function formatDT(dateStr) {
  return new Date(dateStr).toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric',
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short'
  });
}
const USER_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone;

// Global 401 handler — set by AdminPanel on mount, cleared on unmount
let _onAuthError = null;
async function authFetch(url, opts = {}) {
  const res = await fetch(url, opts);
  if ((res.status === 401 || res.status === 403) && _onAuthError) {
    _onAuthError();
    return null;
  }
  return res;
}

// ==========================================
// ERROR BOUNDARY
// ==========================================

class ErrorBoundary extends React.Component {
  state = { crashed: false };
  static getDerivedStateFromError() { return { crashed: true }; }
  componentDidCatch(err, info) {
    console.error('VoterTerminal render error:', err, info.componentStack);
  }
  render() {
    if (this.state.crashed) {
      return (
        <div style={{ display:'flex', alignItems:'center', justifyContent:'center', minHeight:'100vh', background:'#f1f5f9', fontFamily:'sans-serif' }}>
          <div style={{ textAlign:'center', maxWidth:'460px', padding:'2rem' }}>
            <div style={{ fontSize:'2.5rem', marginBottom:'1rem' }}>⚠️</div>
            <h2 style={{ color:'#0f172a', marginBottom:'0.5rem', fontWeight:'700', fontSize:'1.3rem' }}>Something went wrong</h2>
            <p style={{ color:'#64748b', marginBottom:'0.75rem', lineHeight:'1.6' }}>
              An unexpected error occurred in the application.
            </p>
            <p style={{ color:'#64748b', marginBottom:'1.5rem', lineHeight:'1.6', fontWeight:'500' }}>
              Close this tab completely and open VoterTerminal in a fresh browser tab. If the problem continues, try clearing your browser cache.
            </p>
            <div style={{ display:'flex', gap:'10px', justifyContent:'center', flexWrap:'wrap' }}>
              <button
                onClick={() => { window.open(window.location.href, '_blank'); window.close(); }}
                style={{ background:'#2563eb', color:'white', border:'none', borderRadius:'8px', padding:'10px 24px', cursor:'pointer', fontSize:'14px', fontWeight:'600' }}
              >
                Open Fresh Tab
              </button>
              <button
                onClick={() => window.location.reload()}
                style={{ background:'white', color:'#374151', border:'1px solid #d1d5db', borderRadius:'8px', padding:'10px 24px', cursor:'pointer', fontSize:'14px', fontWeight:'600' }}
              >
                Reload This Tab
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

// ==========================================
// MAIN APP COMPONENT
// ==========================================

export default function VotingApp() {
  const [currentUser, setCurrentUser] = useState(null);
  const isAdminRoute = window.location.pathname.startsWith('/admin');

  return (
    <ErrorBoundary>
      <div className="voting-app">
        {isAdminRoute ? (
          <AdminPanel setUserType={() => {}} setCurrentUser={setCurrentUser} />
        ) : (
          <VoterPortal setUserType={() => {}} />
        )}
      </div>
    </ErrorBoundary>
  );
}

// ==========================================
// ORG LANDING PAGE
// ==========================================

function OrgLandingPage({ orgConfig, onEnter }) {
  const orgName   = (orgConfig && orgConfig.orgName)    || 'Your Organization';
  const orgTagline = (orgConfig && orgConfig.orgTagline) || 'Official Ballot';
  const logoUrl   = (orgConfig && orgConfig.logoUrl)    || null;

  return (
    <div className="org-landing-page">
      <div className="org-landing-card">
        <img src={logoUrl || '/logo.png'} alt={orgName} className="org-logo" />

        <div className="org-stars">★ ★ ★ ★ ★</div>
        <h1 className="org-name">{orgName}</h1>
        <p className="org-tagline">{orgTagline}</p>

        <button className="enter-ballot-btn" onClick={onEnter}>
          Cast Your Vote
        </button>

        <p className="org-secure-note">🔒 Anonymous &amp; Secure</p>
      </div>
    </div>
  );
}

// ==========================================
// LOGIN SELECTOR
// ==========================================

function LoginSelector({ onSelectRole }) {
  return (
    <div className="login-selector">
      <div className="selector-container">
        <h1 className="main-title">voterterminal.com</h1>
        <p className="tagline">Anonymous Voting Platform</p>
        
        <div className="role-buttons">
          <button 
            className="role-btn voter-btn"
            onClick={() => onSelectRole('voter')}
          >
            <span className="role-icon">🗳️</span>
            <span className="role-label">Vote Now</span>
            <span className="role-desc">Participate in an election</span>
          </button>

          <button 
            className="role-btn admin-btn"
            onClick={() => onSelectRole('admin')}
          >
            <span className="role-icon">⚙️</span>
            <span className="role-label">Admin Dashboard</span>
            <span className="role-desc">Manage elections & results</span>
          </button>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// ADMIN PANEL
// ==========================================

function AdminPanel({ setUserType, setCurrentUser }) {
  const [adminToken, setAdminToken] = useState(localStorage.getItem('adminToken') || null);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminPassword, setAdminPassword] = useState('');
  const [loginError, setLoginError] = useState('');
  const [activeTab, setActiveTab] = useState('dashboard');
  const [selectedResultId, setSelectedResultId] = useState(null);
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(false);
  const [forgotMode, setForgotMode] = useState(false);
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotMsg, setForgotMsg] = useState('');
  const [resetMode, setResetMode] = useState(false);
  const [resetToken, setResetToken] = useState('');
  const [resetPassword, setResetPassword] = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetMsg, setResetMsg] = useState('');

  // Register global 401 handler — auto signs out on any expired token
  useEffect(() => {
    _onAuthError = () => {
      setAdminToken(null);
      localStorage.removeItem('adminToken');
    };
    return () => { _onAuthError = null; };
  }, []);

  // Check for ?reset_token= in URL on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tok = params.get('reset_token');
    if (tok) {
      setResetToken(tok);
      setResetMode(true);
    }
  }, []);

  // Forgot-password handler
  const handleForgotPassword = async (e) => {
    e.preventDefault();
    setLoading(true);
    setForgotMsg('');
    try {
      await fetch(`${API_URL}/admin/request-reset`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail })
      });
      setForgotMsg('If that email is registered, a reset link has been sent. Check your inbox.');
    } catch {
      setForgotMsg('Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Reset-password handler
  const handleResetPassword = async (e) => {
    e.preventDefault();
    if (resetPassword !== resetConfirm) { setResetMsg('Passwords do not match.'); return; }
    if (resetPassword.length < 8) { setResetMsg('Password must be at least 8 characters.'); return; }
    setLoading(true);
    setResetMsg('');
    try {
      const res = await fetch(`${API_URL}/admin/reset-password`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ token: resetToken, newPassword: resetPassword })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Reset failed');
      setResetMsg('Password updated! You can now log in.');
      // Clean the token out of the URL
      window.history.replaceState({}, '', window.location.pathname);
      setTimeout(() => { setResetMode(false); setForgotMode(false); }, 2000);
    } catch (err) {
      setResetMsg(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Login Handler
  const handleAdminLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setLoginError('');

    try {
      const response = await fetch(`${API_URL}/admin/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: adminEmail, password: adminPassword })
      });

      if (!response.ok) throw new Error('Invalid credentials');
      
      const data = await response.json();
      setAdminToken(data.token);
      localStorage.setItem('adminToken', data.token);
      setCurrentUser(data.admin);
    } catch (err) {
      setLoginError(err.message);
    } finally {
      setLoading(false);
    }
  };

  // Fetch Elections
  useEffect(() => {
    if (adminToken) {
      fetchElections();
    }
  }, [adminToken]);

  const fetchElections = async () => {
    try {
      const res = await authFetch(`${API_URL}/admin/elections`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      if (!res) return;
      const data = await res.json();
      setElections(Array.isArray(data) ? data : []);
    } catch (err) {
      console.error('Error fetching elections:', err);
    }
  };

  // Logout
  const handleLogout = () => {
    setAdminToken(null);
    localStorage.removeItem('adminToken');
    setUserType(null);
  };

  const LoginBrand = () => (
    <div className="login-brand">
      <div className="brand-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z"/>
        </svg>
      </div>
      <div>
        <div className="brand-name">VoterTerminal</div>
        <div className="brand-sub">Election Management Platform</div>
      </div>
    </div>
  );

  if (!adminToken) {
    if (resetMode) {
      return (
        <div className="login-page">
          <div className="login-card">
            <LoginBrand />
            <h1 className="login-heading">Set New Password</h1>
            <p className="login-sub">Enter and confirm your new password below.</p>
            <form onSubmit={handleResetPassword}>
              <div className="field-group">
                <label className="field-label">New Password</label>
                <input className="field-input" type="password" value={resetPassword}
                  onChange={e => setResetPassword(e.target.value)} placeholder="Min 8 characters" autoFocus />
              </div>
              <div className="field-group">
                <label className="field-label">Confirm Password</label>
                <input className="field-input" type="password" value={resetConfirm}
                  onChange={e => setResetConfirm(e.target.value)} placeholder="Repeat new password" />
              </div>
              {resetMsg && <div className={resetMsg.includes('updated') ? 'login-success' : 'login-error'}>{resetMsg}</div>}
              <button type="submit" disabled={loading} className="btn-login">{loading ? 'Saving…' : 'Set Password'}</button>
            </form>
            <button className="login-back-btn" onClick={() => { setResetMode(false); window.history.replaceState({}, '', window.location.pathname); }}>← Back to Sign In</button>
          </div>
        </div>
      );
    }

    if (forgotMode) {
      return (
        <div className="login-page">
          <div className="login-card">
            <LoginBrand />
            <h1 className="login-heading">Reset Password</h1>
            <p className="login-sub">Enter your admin email and we'll send a reset link to your inbox.</p>
            <form onSubmit={handleForgotPassword}>
              <div className="field-group">
                <label className="field-label">Email Address</label>
                <input className="field-input" type="email" value={forgotEmail}
                  onChange={e => setForgotEmail(e.target.value)} placeholder="admin@yourorg.com" autoFocus />
              </div>
              {forgotMsg && <div className="login-success">{forgotMsg}</div>}
              <button type="submit" disabled={loading || !!forgotMsg} className="btn-login">{loading ? 'Sending…' : 'Send Reset Link'}</button>
            </form>
            <button className="login-back-btn" onClick={() => { setForgotMode(false); setForgotMsg(''); }}>← Back to Sign In</button>
          </div>
        </div>
      );
    }

    return (
      <div className="login-page">
        <div className="login-card">
          <LoginBrand />
          <h1 className="login-heading">Admin Sign In</h1>
          <p className="login-sub">Access the administration dashboard for your organization's elections.</p>
          <form onSubmit={handleAdminLogin}>
            <div className="field-group">
              <label className="field-label">Email Address</label>
              <input className="field-input" type="email" value={adminEmail}
                onChange={e => setAdminEmail(e.target.value)} placeholder="admin@yourorg.com" autoFocus />
            </div>
            <div className="field-group">
              <label className="field-label">Password</label>
              <input className="field-input" type="password" value={adminPassword}
                onChange={e => setAdminPassword(e.target.value)} placeholder="••••••••" />
            </div>
            {loginError && <div className="login-error">{loginError}</div>}
            <button type="submit" disabled={loading} className="btn-login">{loading ? 'Signing in…' : 'Sign In to Dashboard'}</button>
          </form>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '14px' }}>
            <button className="login-back-btn" onClick={() => setUserType(null)}>← Back</button>
            <button className="login-link-btn" onClick={() => { setForgotMode(true); setLoginError(''); setForgotEmail(adminEmail); }}>Forgot password?</button>
          </div>
        </div>
      </div>
    );
  }

  const activeCount = elections.filter(e => e.status === 'active' && new Date(e.endTime) > new Date()).length;
  const totalRegistered = elections.reduce((s, e) => s + (e.voterCount || 0), 0);
  const endedCount = elections.filter(e => e.status === 'ended' || new Date(e.endTime) < new Date()).length;
  const PANEL_TITLES = {
    dashboard: 'Dashboard', results: 'Live Results', create: 'Create Election',
    settings: 'Settings', 'ballot-display': 'QR / Station Display', guide: 'Help Guide'
  };

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <div className="sidebar-brand-row">
            <div className="sb-icon">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                <path d="M12 2L4 6v6c0 5.5 3.8 10.7 8 12 4.2-1.3 8-6.5 8-12V6l-8-4z"/>
              </svg>
            </div>
            <div>
              <div className="sb-name">VoterTerminal</div>
              <div className="sb-tag">Admin Panel</div>
            </div>
          </div>
        </div>

        <nav className="sidebar-nav">
          <div className="nav-section">Main</div>
          <button className={`nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            Dashboard
          </button>
          <button className={`nav-item ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
            Live Results
          </button>
          <button className={`nav-item ${activeTab === 'create' ? 'active' : ''}`} onClick={() => setActiveTab('create')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
            Create Election
          </button>

          <div className="nav-divider"></div>
          <div className="nav-section">Tools</div>

          <button className={`nav-item ${activeTab === 'settings' ? 'active' : ''}`} onClick={() => setActiveTab('settings')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 010 2.83 2 2 0 01-2.83 0l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 01-2 2 2 2 0 01-2-2v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 01-2.83 0 2 2 0 010-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 01-2-2 2 2 0 012-2h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 010-2.83 2 2 0 012.83 0l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 012-2 2 2 0 012 2v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 012.83 0 2 2 0 010 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 012 2 2 2 0 01-2 2h-.09a1.65 1.65 0 00-1.51 1z"/></svg>
            Settings
          </button>
          <button className={`nav-item ${activeTab === 'ballot-display' ? 'active' : ''}`} onClick={() => setActiveTab('ballot-display')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="4" height="4"/></svg>
            QR / Station
          </button>
          <button className={`nav-item ${activeTab === 'guide' ? 'active' : ''}`} onClick={() => setActiveTab('guide')}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><path d="M9.09 9a3 3 0 015.83 1c0 2-3 3-3 3"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
            Help Guide
          </button>
          <a className="nav-item nav-upgrade" href="https://voterterminal.com" target="_blank" rel="noopener noreferrer">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
            Upgrade to SaaS
          </a>
        </nav>

        <div className="sidebar-footer">
          <div className="sidebar-user">
            <div className="user-avatar">A</div>
            <div>
              <div className="user-name">Administrator</div>
              <div className="user-role">Admin</div>
            </div>
          </div>
          <button className="nav-item sidebar-signout" onClick={handleLogout}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/></svg>
            Sign Out
          </button>
        </div>
      </aside>

      <div className="main-area">
        <header className="topbar">
          <div className="topbar-title">{PANEL_TITLES[activeTab] || 'Dashboard'}</div>
          {activeCount > 0 && (
            <span className="live-badge">{activeCount} active</span>
          )}
        </header>

        <main className="content-area">
          {activeTab === 'dashboard' && (
            <>
              <div className="metric-row">
                <div className="metric-card">
                  <div className="m-label">Total Elections</div>
                  <div className="m-value">{elections.length}</div>
                  <div className="m-trend neutral">{activeCount} active</div>
                </div>
                <div className="metric-card mc-success">
                  <div className="m-label">Active Now</div>
                  <div className="m-value">{activeCount}</div>
                  <div className="m-trend">{activeCount > 0 ? 'Voting open' : 'None open'}</div>
                </div>
                <div className="metric-card">
                  <div className="m-label">Registered Voters</div>
                  <div className="m-value">{totalRegistered}</div>
                  <div className="m-trend neutral">Across all elections</div>
                </div>
                <div className="metric-card mc-neutral">
                  <div className="m-label">Ended Elections</div>
                  <div className="m-value">{endedCount}</div>
                  <div className="m-trend neutral">Results available</div>
                </div>
              </div>

              <div className="quick-actions">
                <button className="qa-btn" onClick={() => setActiveTab('create')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
                  New Election
                </button>
                <button className="qa-btn" onClick={() => setActiveTab('results')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
                  Live Results
                </button>
                <button className="qa-btn" onClick={() => setActiveTab('ballot-display')}>
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="4" height="4"/></svg>
                  QR Station
                </button>
              </div>

              <ElectionsList elections={elections} token={adminToken} onElectionsChanged={fetchElections} onCreateNew={() => setActiveTab('create')} />
            </>
          )}
          {activeTab === 'create' && (
            <CreateElection token={adminToken} onElectionCreated={() => { fetchElections(); setActiveTab('dashboard'); }} />
          )}
          {activeTab === 'results' && (
            <ResultsViewer elections={elections} token={adminToken} />
          )}
          {activeTab === 'settings' && (
            <AdminSettings token={adminToken} />
          )}
          {activeTab === 'ballot-display' && (
            <BallotDisplay elections={elections} />
          )}
          {activeTab === 'guide' && (
            <HelpGuide />
          )}
        </main>
      </div>

      <nav className="mobile-nav">
        <button className={`mob-nav-item ${activeTab === 'dashboard' ? 'active' : ''}`} onClick={() => setActiveTab('dashboard')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          Dashboard
        </button>
        <button className={`mob-nav-item ${activeTab === 'results' ? 'active' : ''}`} onClick={() => setActiveTab('results')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><line x1="18" y1="20" x2="18" y2="10"/><line x1="12" y1="20" x2="12" y2="4"/><line x1="6" y1="20" x2="6" y2="14"/></svg>
          Results
        </button>
        <button className={`mob-nav-item ${activeTab === 'create' ? 'active' : ''}`} onClick={() => setActiveTab('create')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="16"/><line x1="8" y1="12" x2="16" y2="12"/></svg>
          Create
        </button>
        <button className={`mob-nav-item ${activeTab === 'ballot-display' ? 'active' : ''}`} onClick={() => setActiveTab('ballot-display')}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="4" height="4"/></svg>
          QR
        </button>
      </nav>
    </div>
  );
}

// ==========================================
// REUSABLE TOGGLE SWITCH
// ==========================================

// ==========================================
// PARTICIPATION PANEL (who voted)
// ==========================================

function ParticipationPanel({ election, token }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');

  useEffect(() => {
    if (!election) return;
    setLoading(true);
    authFetch(`${API_URL}/admin/elections/${election.id}/participants`, {
      headers: { 'Authorization': `Bearer ${token}` }
    })
      .then(r => r ? r.json() : null)
      .then(d => { if (d) setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, [election?.id]);

  if (loading) return <p style={{ padding: '1rem', color: '#6b7280' }}>Loading participation data…</p>;
  if (!data) return null;

  const filtered = (data.participants || []).filter(p =>
    !search || p.name?.toLowerCase().includes(search.toLowerCase()) || p.email?.toLowerCase().includes(search.toLowerCase())
  );
  const voted = filtered.filter(p => p.voted);
  const notVoted = filtered.filter(p => !p.voted);

  return (
    <div className="participation-panel">
      <div className="participation-header">
        <div className="participation-stats">
          <div className="pstat"><span className="pstat-val">{data.totalVoted}</span><span className="pstat-lbl">Voted</span></div>
          <div className="pstat"><span className="pstat-val">{data.totalEligible}</span><span className="pstat-lbl">Eligible</span></div>
          <div className="pstat"><span className="pstat-val">{data.turnout}%</span><span className="pstat-lbl">Turnout</span></div>
          {data.quorumRequired > 0 && (
            <div className={`pstat ${data.quorumMet ? 'pstat--good' : 'pstat--bad'}`}>
              <span className="pstat-val">{data.quorumMet ? '✅' : '❌'}</span>
              <span className="pstat-lbl">Quorum ({data.quorumRequired} req.)</span>
            </div>
          )}
        </div>
        <input className="participation-search" placeholder="Search by name or email…"
          value={search} onChange={e => setSearch(e.target.value)} />
      </div>

      {voted.length > 0 && (
        <div className="participation-group">
          <h4 className="participation-group-title">✅ Voted ({voted.length})</h4>
          <table className="participation-table">
            <thead><tr><th>Name</th><th>Email</th><th>Time</th></tr></thead>
            <tbody>
              {voted.map((p, i) => (
                <tr key={i}>
                  <td>{p.name || '—'}</td>
                  <td>{p.email}</td>
                  <td>{p.votedAt ? new Date(p.votedAt).toLocaleString() : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {notVoted.length > 0 && (
        <div className="participation-group">
          <h4 className="participation-group-title">⏳ Has Not Voted ({notVoted.length})</h4>
          <table className="participation-table">
            <thead><tr><th>Name</th><th>Email</th></tr></thead>
            <tbody>
              {notVoted.map((p, i) => (
                <tr key={i}>
                  <td>{p.name || '—'}</td>
                  <td>{p.email}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {data.totalEligible === 0 && (
        <p className="participation-empty">No participation data yet for this election.</p>
      )}
    </div>
  );
}

function Toggle({ checked, onChange, label, id }) {
  return (
    <label className="toggle-label" htmlFor={id}>
      <span
        role="switch"
        aria-checked={checked}
        id={id}
        className={`toggle-switch${checked ? ' toggle-switch--on' : ''}`}
        onClick={() => onChange(!checked)}
        onKeyDown={e => (e.key === ' ' || e.key === 'Enter') && onChange(!checked)}
        tabIndex={0}
      >
        <span className="toggle-knob" />
      </span>
      {label && <span className="toggle-text">{label}</span>}
    </label>
  );
}

// ==========================================
// BALLOT DISPLAY / QR CODE TAB
// ==========================================

function BallotDisplay({ elections }) {
  const [selectedId, setSelectedId] = useState('');
  const [showCode, setShowCode]     = useState(false);
  const [inPersonCode, setInPersonCode] = useState('');

  const election = elections.find(e => e.id === selectedId) || null;
  const ballotUrl = selectedId
    ? `${window.location.origin}/?e=${selectedId}`
    : window.location.origin;

  const openDisplayScreen = () => {
    if (!election) return;
    const imgSrc = qrUrl(ballotUrl, 300);
    const codeBlock = showCode && inPersonCode.trim()
      ? `<div class="code-block">
           <p class="code-label">In-Person Code</p>
           <p class="code-value">${inPersonCode.trim()}</p>
         </div>`
      : '';

    const win = window.open('', '_blank', 'width=960,height=720');
    win.document.write(`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>Ballot Station — ${election.name}</title>
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      background: #f8fafc;
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 2rem;
      gap: 1.5rem;
      text-align: center;
      color: #1f2937;
    }
    .org-label { font-size: 0.85rem; font-weight: 600; letter-spacing: 0.1em; text-transform: uppercase; color: #6b7280; }
    .election-name { font-size: clamp(1.5rem, 4vw, 2.5rem); font-weight: 800; color: #111827; line-height: 1.2; max-width: 600px; }
    .qr-wrap { background: white; padding: 1.5rem; border-radius: 1rem; box-shadow: 0 4px 24px rgba(0,0,0,0.08); }
    .qr-wrap img { display: block; }
    .scan-label { font-size: 1.05rem; color: #4b5563; }
    .code-block { background: white; border: 2px solid #1D4ED8; border-radius: 0.75rem; padding: 1rem 2.5rem; }
    .code-label { font-size: 0.8rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.08em; color: #1D4ED8; margin-bottom: 0.35rem; }
    .code-value { font-size: clamp(1.8rem, 5vw, 3.2rem); font-weight: 900; letter-spacing: 0.14em; color: #111827; font-family: monospace; }
    .footer-note { font-size: 0.78rem; color: #9ca3af; }
  </style>
</head>
<body>
  <p class="org-label">Official Ballot</p>
  <h1 class="election-name">${election.name}</h1>
  <div class="qr-wrap"><img src="${imgSrc}" width="300" height="300" alt="QR code" /></div>
  <p class="scan-label">📱 Scan with your phone camera to vote</p>
  ${codeBlock}
  <p class="footer-note">voterterminal.com · Your vote is anonymous &amp; secure</p>
</body>
</html>`);
    win.document.close();
  };

  return (
    <div className="ballot-display-panel">
      <h2>Ballot Station Display</h2>
      <p className="ballot-display-hint">
        Select an election to generate a QR code voters can scan with any phone camera to go straight to the ballot.
        Click <strong>Open Display Screen</strong> to pop open a clean view you can move to a monitor or projector at the polling table.
      </p>

      <div className="ballot-display-card">
        <div className="form-group">
          <label>Select Election</label>
          <select value={selectedId} onChange={e => { setSelectedId(e.target.value); setShowCode(false); setInPersonCode(''); }}>
            <option value="">— Choose an election —</option>
            {elections.map(e => (
              <option key={e.id} value={e.id}>{e.name} ({e.status})</option>
            ))}
          </select>
        </div>

        {election && (
          <>
            <div className="qr-preview-wrap">
              <img src={qrUrl(ballotUrl)} width={220} height={220} alt="QR code" />
            </div>
            <p className="qr-url">{ballotUrl}</p>

            <div className="ballot-display-options">
              <div className="ballot-option-row">
                <Toggle
                  checked={showCode}
                  onChange={setShowCode}
                  label="Show in-person code on display screen"
                  id="show-code-toggle"
                />
              </div>

              {showCode && (
                <div className="form-group" style={{ marginTop: '0.75rem' }}>
                  <label>In-Person Code</label>
                  <input
                    type="text"
                    value={inPersonCode}
                    onChange={e => setInPersonCode(e.target.value)}
                    placeholder="Enter the code set when creating the election"
                    style={{ fontFamily: 'monospace', letterSpacing: '0.1em', fontSize: '1.1rem' }}
                  />
                  <p className="field-hint">This code was shown once when the voter roll was uploaded — retrieve it from your records.</p>
                </div>
              )}
            </div>

            <button className="submit-btn" style={{ marginTop: '1.25rem' }} onClick={openDisplayScreen}>
              🖥️ Open Display Screen
            </button>
          </>
        )}
      </div>
    </div>
  );
}

// ==========================================
// HELP GUIDE
// ==========================================

function HelpGuide() {
  const [open, setOpen] = useState(null);
  const toggle = (id) => setOpen(prev => prev === id ? null : id);

  const sections = [
    {
      id: 'quickstart',
      title: '⚡ Quick Start',
      body: (
        <>
          <p>Get your first election running in three steps:</p>
          <ol className="guide-list">
            <li><strong>Create Election</strong> — click the <em>Create Election</em> tab, fill in the election name, add your positions and candidates, and set a start and end time.</li>
            <li><strong>(Optional) Upload a Voter Roll</strong> — if voting is restricted to specific members, upload a CSV with their email addresses. Each member gets a unique access code by email.</li>
            <li><strong>Share the ballot link</strong> — voters go to your subdomain (e.g., <code>gdp.voterterminal.com</code>) to cast their ballot. If there's no voter roll, anyone with the link can vote.</li>
          </ol>
        </>
      )
    },
    {
      id: 'elections',
      title: '📋 Managing Elections',
      body: (
        <>
          <p>Click <strong>View Details</strong> on any election card to open the detail panel.</p>
          <ul className="guide-list">
            <li><strong>Edit</strong> — update the election name, description, end time, candidates, or race positions. Changes take effect immediately.</li>
            <li><strong>End Election</strong> — closes voting early and locks in the final tally. Use this when you're ready to announce results before the scheduled end time.</li>
            <li><strong>Delete</strong> — permanently removes the election, all votes, and all voter records. This cannot be undone.</li>
          </ul>
          <p className="guide-note">💡 The election card shows <em>Races</em> for multi-position elections and <em>Candidates</em> for single-race elections.</p>
        </>
      )
    },
    {
      id: 'qrcode',
      title: '📱 QR Code / Polling Station Display',
      body: (
        <>
          <p>The <strong>QR Code</strong> tab lets you generate a scannable ballot link to display at a polling table or on a monitor so voters can jump straight to the ballot without typing a URL.</p>
          <ul className="guide-list">
            <li><strong>Select an election</strong> — choose the active election from the dropdown. A QR code and the direct ballot URL appear immediately.</li>
            <li><strong>Open Display Screen</strong> — pops open a clean, full-screen view sized for a monitor or projector. Move it to a second screen at the polling table.</li>
            <li><strong>Show in-person code on display screen</strong> — toggle this on to include the election's In-Person Password on the display. Useful when a poll worker needs to read it aloud or when voters need to enter it at a shared booth.</li>
          </ul>
          <p>Voters scan the QR code with any phone camera (no app required) and are taken directly to that election's ballot page.</p>
          <p className="guide-note">💡 The QR code only works while the election is open. If voting hasn't started yet or has ended, voters will see a "no active elections" message.</p>
        </>
      )
    },
    {
      id: 'create',
      title: '➕ Creating an Election',
      body: (
        <>
          <h4 className="guide-sub">Positions &amp; Candidates</h4>
          <p>Each position (President, VP, Treasurer, etc.) is its own race block. Add as many as you need. You can also <strong>upload from CSV</strong> to populate all positions at once — download the example CSV to see the required format.</p>

          <h4 className="guide-sub">Voting Methods</h4>
          <ul className="guide-list">
            <li><strong>Plurality</strong> — the candidate with the most votes wins, even without a majority.</li>
            <li><strong>Majority</strong> — the winner must receive more than 50% of votes cast.</li>
            <li><strong>Ranked Choice (IRV)</strong> — voters rank candidates in order of preference. The lowest-ranked candidate is eliminated each round until one candidate has a majority.</li>
          </ul>

          <h4 className="guide-sub">Voter Affidavit</h4>
          <p>When enabled, voters must read and check a box agreeing to the affidavit statement before their ballot is accepted. You can customize this text in the <em>Affidavits</em> tab.</p>
        </>
      )
    },
    {
      id: 'voterroll',
      title: '👥 Voter Rolls &amp; Access Codes',
      body: (
        <>
          <p>A voter roll restricts the election to a specific list of people. Without one, anyone who visits your ballot page can vote.</p>
          <ul className="guide-list">
            <li><strong>CSV format</strong> — one email per row, or a spreadsheet with <code>email</code> and <code>name</code> columns. Download the example CSV for the exact format.</li>
            <li><strong>Access codes</strong> — each person on the roll receives a unique code by email. They enter their email address and code to access the ballot.</li>
            <li><strong>In-Person Password</strong> — a shared code for walk-in voters at a polling location. Poll workers type this at the booth instead of a personal access code. Leave blank to restrict strictly to emailed codes.</li>
          </ul>
          <p className="guide-note">💡 Access codes are single-use. Once someone votes, their code cannot be used again.</p>
        </>
      )
    },
    {
      id: 'results',
      title: '📊 Results',
      body: (
        <>
          <p>Live results are available any time in the <em>Results</em> tab — you don't have to wait for the election to end.</p>
          <ul className="guide-list">
            <li><strong>Plurality &amp; Majority</strong> — shows a bar chart of vote counts for each candidate.</li>
            <li><strong>Ranked Choice</strong> — shows the result of each elimination round until a winner emerges.</li>
            <li><strong>Multi-race elections</strong> — each position gets its own results section.</li>
          </ul>
          <p>Turnout percentage is calculated as votes cast ÷ registered voters.</p>
        </>
      )
    },
    {
      id: 'emergency',
      title: '🔐 Emergency Actions',
      body: (
        <>
          <p>Emergency Actions require a separate emergency password (set in your server's <code>.env</code> file). Use these only when absolutely necessary — every action is permanently logged with a timestamp and admin ID.</p>
          <ul className="guide-list">
            <li><strong>Invalidate a voter</strong> — removes their vote from the tally. You must provide a written reason of at least 10 characters. The voter receives an email notification.</li>
            <li><strong>Reinstate a voter</strong> — restores a previously invalidated vote. Also requires a written reason.</li>
            <li><strong>Manual Re-tally</strong> — recalculates the current standings after any invalidation or reinstatement.</li>
          </ul>
          <p className="guide-note">⚠️ Votes are anonymous — you can see who voted, but not what they voted for. Invalidating a voter removes their vote without revealing its content.</p>
        </>
      )
    },
    {
      id: 'affidavits',
      title: '📝 Affidavits',
      body: (
        <>
          <p>Affidavit templates define the oath voters must agree to before casting a ballot. Each election can use a different template.</p>
          <ul className="guide-list">
            <li>The <strong>Standard Voter Affidavit</strong> is built-in and available to all elections by default. It can be edited but not deleted.</li>
            <li>Create custom templates for elections that need specific language (e.g., a membership eligibility oath for your organization).</li>
            <li>Changes to a template do <em>not</em> affect elections that have already been created — they keep the text that was in place when the election was set up.</li>
          </ul>
        </>
      )
    },
    {
      id: 'faq',
      title: '❓ FAQ',
      body: (
        <ul className="guide-list guide-faq">
          <li>
            <strong>Can a voter vote twice?</strong>
            <p>No. Each voter record and access code can only be used once. The system blocks duplicate submissions.</p>
          </li>
          <li>
            <strong>Is voting truly anonymous?</strong>
            <p>Yes. Votes are stored separately from voter identity. Admins can see <em>who</em> voted but never <em>what</em> they voted for.</p>
          </li>
          <li>
            <strong>What if I uploaded the wrong voter roll?</strong>
            <p>You can clear the voter roll from the election's edit screen and upload a replacement. Previously issued codes are invalidated when the roll is cleared.</p>
          </li>
          <li>
            <strong>Can voters see results while voting is open?</strong>
            <p>Not from the voter side — results are only visible in the admin dashboard.</p>
          </li>
          <li>
            <strong>What happens when the end time passes?</strong>
            <p>Voting closes automatically. The election status changes to ended and the final tally is locked. You can also close it early using End Election.</p>
          </li>
          <li>
            <strong>How do I contact support?</strong>
            <p>Email <strong>support@voterterminal.com</strong> or visit <strong>voterterminal.com</strong>.</p>
          </li>
        </ul>
      )
    }
  ];

  return (
    <div className="help-guide">
      <div className="help-guide-header">
        <h2>Admin Guide</h2>
        <p>Everything you need to run a secure election. Click any section to expand it.</p>
      </div>

      <div className="guide-accordion">
        {sections.map(s => (
          <div key={s.id} className={`guide-item ${open === s.id ? 'guide-item--open' : ''}`}>
            <button className="guide-toggle" onClick={() => toggle(s.id)}>
              <span>{s.title}</span>
              <span className="guide-chevron">{open === s.id ? '▲' : '▼'}</span>
            </button>
            {open === s.id && (
              <div className="guide-body">
                {s.body}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

// ==========================================
// ADMIN SETTINGS
// ==========================================

function AdminSettings({ token }) {
  const [pwForm, setPwForm] = useState({ current: '', newPw: '', confirm: '' });
  const [pwMsg, setPwMsg] = useState(null);
  const [pwLoading, setPwLoading] = useState(false);

  const [addForm, setAddForm] = useState({ email: '', name: '', password: '' });
  const [addMsg, setAddMsg] = useState(null);
  const [addLoading, setAddLoading] = useState(false);

  const [admins, setAdmins] = useState([]);

  // Email template state
  const DEFAULT_INVITE = {
    subject:     "You're invited to vote: {{electionName}}",
    intro:       "You have been invited to participate in <strong>{{electionName}}</strong>.",
    instruction: "Use the access code below when you go to cast your ballot. Keep it safe — this code is personal to you.",
    help:        "If you lose your code, contact your election administrator for assistance. Your vote will be completely anonymous once cast.",
    footnote:    "Sent by {{orgName}}. If you were not expecting this invitation, you can safely ignore this email."
  };
  const [inviteTpl, setInviteTpl] = useState(DEFAULT_INVITE);
  const [tplMsg, setTplMsg]       = useState(null);
  const [tplLoading, setTplLoading] = useState(false);
  const [tplSaving, setTplSaving]   = useState(false);

  useEffect(() => {
    setTplLoading(true);
    fetch(`${API_URL}/admin/email-templates`, {
      headers: { Authorization: `Bearer ${token}` }
    })
      .then(r => r.json())
      .then(data => { if (data.invite) setInviteTpl(data.invite); })
      .catch(() => {})
      .finally(() => setTplLoading(false));
  }, [token]);

  const handleTplChange = (field, value) => {
    setInviteTpl(prev => ({ ...prev, [field]: value }));
    setTplMsg(null);
  };

  const handleTplSave = async (e) => {
    e.preventDefault();
    setTplSaving(true);
    setTplMsg(null);
    try {
      const res = await fetch(`${API_URL}/admin/email-templates/invite`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(inviteTpl)
      });
      if (!res.ok) throw new Error('Save failed');
      setTplMsg({ type: 'success', text: 'Email template saved.' });
    } catch (err) {
      setTplMsg({ type: 'error', text: err.message });
    } finally {
      setTplSaving(false);
    }
  };

  const handleTplReset = () => {
    setInviteTpl(DEFAULT_INVITE);
    setTplMsg({ type: 'success', text: 'Defaults restored — click Save to apply.' });
  };

  // Preview helper — replaces placeholders with example values
  const prev = (str) => (str || '')
    .replace(/\{\{electionName\}\}/g, 'Sample Election 2026')
    .replace(/\{\{orgName\}\}/g, 'Your Organization');

  useEffect(() => {
    fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(setAdmins)
      .catch(() => {});
  }, [token]);

  const handleDeleteAdmin = async (id, email) => {
    if (!window.confirm(`Remove ${email} as admin?`)) return;
    try {
      const res = await fetch(`${API_URL}/admin/users/${id}`, {
        method: 'DELETE',
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to remove admin');
      setAdmins(prev => prev.filter(a => a.id !== id));
    } catch (err) {
      alert(err.message);
    }
  };

  const handleChangePassword = async (e) => {
    e.preventDefault();
    setPwMsg(null);
    if (pwForm.newPw !== pwForm.confirm) {
      return setPwMsg({ type: 'error', text: 'New passwords do not match.' });
    }
    if (pwForm.newPw.length < 8) {
      return setPwMsg({ type: 'error', text: 'New password must be at least 8 characters.' });
    }
    setPwLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/change-password`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ currentPassword: pwForm.current, newPassword: pwForm.newPw })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to update password');
      setPwMsg({ type: 'success', text: 'Password updated successfully!' });
      setPwForm({ current: '', newPw: '', confirm: '' });
    } catch (err) {
      setPwMsg({ type: 'error', text: err.message });
    } finally {
      setPwLoading(false);
    }
  };

  const handleAddAdmin = async (e) => {
    e.preventDefault();
    setAddMsg(null);
    if (addForm.password.length < 8) {
      return setAddMsg({ type: 'error', text: 'Password must be at least 8 characters.' });
    }
    setAddLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/users`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(addForm)
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Failed to add admin');
      setAddMsg({ type: 'success', text: `${addForm.email} added as admin.` });
      setAddForm({ email: '', name: '', password: '' });
      setAdmins(prev => [...prev, { id: data.id, email: addForm.email, name: addForm.name || addForm.email }]);
    } catch (err) {
      setAddMsg({ type: 'error', text: err.message });
    } finally {
      setAddLoading(false);
    }
  };

  return (
    <div className="admin-settings">

      {/* Change Password */}
      <div className="settings-card">
        <h2>Change Password</h2>
        <form onSubmit={handleChangePassword} className="settings-form">
          <div className="form-group">
            <label>Current Password</label>
            <input type="password" value={pwForm.current} placeholder="••••••••"
              onChange={e => setPwForm(p => ({ ...p, current: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>New Password</label>
            <input type="password" value={pwForm.newPw} placeholder="At least 8 characters"
              onChange={e => setPwForm(p => ({ ...p, newPw: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Confirm New Password</label>
            <input type="password" value={pwForm.confirm} placeholder="••••••••"
              onChange={e => setPwForm(p => ({ ...p, confirm: e.target.value }))} required />
          </div>
          {pwMsg && <p className={`settings-msg ${pwMsg.type}`}>{pwMsg.text}</p>}
          <button type="submit" className="submit-btn" disabled={pwLoading}>
            {pwLoading ? 'Updating...' : 'Update Password'}
          </button>
        </form>
      </div>

      {/* Add Admin */}
      <div className="settings-card">
        <h2>Add Admin User</h2>
        <form onSubmit={handleAddAdmin} className="settings-form">
          <div className="form-group">
            <label>Email</label>
            <input type="email" value={addForm.email} placeholder="admin@example.com"
              onChange={e => setAddForm(p => ({ ...p, email: e.target.value }))} required />
          </div>
          <div className="form-group">
            <label>Name <span className="optional">(optional)</span></label>
            <input type="text" value={addForm.name} placeholder="Full name"
              onChange={e => setAddForm(p => ({ ...p, name: e.target.value }))} />
          </div>
          <div className="form-group">
            <label>Password</label>
            <input type="password" value={addForm.password} placeholder="At least 8 characters"
              onChange={e => setAddForm(p => ({ ...p, password: e.target.value }))} required />
          </div>
          {addMsg && <p className={`settings-msg ${addMsg.type}`}>{addMsg.text}</p>}
          <button type="submit" className="submit-btn" disabled={addLoading}>
            {addLoading ? 'Adding...' : 'Add Admin'}
          </button>
        </form>
      </div>

      {/* Current Admins */}
      {admins.length > 0 && (
        <div className="settings-card">
          <h2>Current Admins</h2>
          <ul className="admins-list">
            {admins.map(a => (
              <li key={a.id} className="admin-list-item">
                <div>
                  <span className="admin-name">{a.name}</span>
                  <span className="admin-email">{a.email}</span>
                </div>
                <button
                  className="delete-admin-btn"
                  onClick={() => handleDeleteAdmin(a.id, a.email)}
                  title="Remove admin"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Invite Email Template */}
      <div className="settings-card email-tpl-card">
        <div className="email-tpl-header">
          <div>
            <h2>Voter Invite Email</h2>
            <p className="email-tpl-subtitle">
              Customise the email sent to members when a closed election voter roll is uploaded.
              Use <code>{'{{electionName}}'}</code> and <code>{'{{orgName}}'}</code> as placeholders.
            </p>
          </div>
          <button type="button" className="tpl-reset-btn" onClick={handleTplReset}>
            Reset to defaults
          </button>
        </div>

        {tplLoading ? <p>Loading…</p> : (
          <div className="email-tpl-layout">
            {/* Editor */}
            <form onSubmit={handleTplSave} className="email-tpl-form">
              <div className="form-group">
                <label>Subject line</label>
                <input type="text" value={inviteTpl.subject}
                  onChange={e => handleTplChange('subject', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Opening paragraph</label>
                <textarea rows="2" value={inviteTpl.intro}
                  onChange={e => handleTplChange('intro', e.target.value)} />
                <small>Appears above the access code box. HTML allowed (e.g. &lt;strong&gt;).</small>
              </div>
              <div className="form-group">
                <label>Code instructions</label>
                <textarea rows="2" value={inviteTpl.instruction}
                  onChange={e => handleTplChange('instruction', e.target.value)} />
              </div>
              <div className="form-group">
                <label>Help text</label>
                <textarea rows="2" value={inviteTpl.help}
                  onChange={e => handleTplChange('help', e.target.value)} />
                <small>Shown below the "Go to Ballot" button.</small>
              </div>
              <div className="form-group">
                <label>Footnote</label>
                <textarea rows="2" value={inviteTpl.footnote}
                  onChange={e => handleTplChange('footnote', e.target.value)} />
                <small>Appears below the divider line at the bottom of the email.</small>
              </div>
              {tplMsg && <p className={`settings-msg ${tplMsg.type}`}>{tplMsg.text}</p>}
              <button type="submit" className="submit-btn" disabled={tplSaving}>
                {tplSaving ? 'Saving…' : 'Save Email Template'}
              </button>
            </form>

            {/* Live preview */}
            <div className="email-tpl-preview">
              <p className="email-tpl-preview-label">Live preview</p>
              <div className="email-mock">
                <div className="email-mock-meta">
                  <span className="email-mock-field"><span>Subject</span>{prev(inviteTpl.subject)}</span>
                </div>
                <div className="email-mock-body">
                  <h3 style={{margin:'0 0 12px',color:'#1a1a2e'}}>You're invited to vote</h3>
                  <p style={{margin:'0 0 10px',fontSize:'14px'}}>Hi jane.smith@gmail.com,</p>
                  <p style={{margin:'0 0 10px',fontSize:'14px'}} dangerouslySetInnerHTML={{__html: prev(inviteTpl.intro)}} />
                  <p style={{margin:'0 0 14px',fontSize:'14px'}}>{prev(inviteTpl.instruction)}</p>
                  <div className="email-mock-code-box">
                    <span className="email-mock-code-label">Your Access Code</span>
                    <span className="email-mock-code">GK7P2X</span>
                  </div>
                  <div style={{margin:'12px 0',textAlign:'center'}}>
                    <span className="email-mock-btn">Go to Ballot →</span>
                  </div>
                  <p style={{margin:'0 0 16px',fontSize:'12px',color:'#555'}}>{prev(inviteTpl.help)}</p>
                  <hr style={{border:'none',borderTop:'1px solid #eee',margin:'12px 0'}} />
                  <p style={{margin:0,fontSize:'11px',color:'#999'}}>{prev(inviteTpl.footnote)}</p>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ==========================================
// ELECTIONS LIST
// ==========================================

function ElectionsList({ elections, token, onElectionsChanged, onCreateNew }) {
  const [selected, setSelected] = useState(null);
  const [editing, setEditing]   = useState(false);
  const [editForm, setEditForm] = useState({});
  const [editRaces, setEditRaces] = useState(null);
  const [editCandidates, setEditCandidates] = useState(null);
  const [saving, setSaving]     = useState(false);
  const [msg, setMsg]           = useState(null);

  const [detailTab, setDetailTab] = useState('info');
  const openDetail = (election) => { setSelected(election); setEditing(false); setMsg(null); setDetailTab('info'); };
  const closeDetail = () => { setSelected(null); setEditing(false); setMsg(null); setDetailTab('info'); };

  const quickEnd = async (election, e) => {
    e.stopPropagation();
    if (!window.confirm(`End "${election.name}" now and lock in results?`)) return;
    try {
      const res = await fetch(`${API_URL}/admin/elections/${election.id}/end`, {
        method: 'POST', headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to end election');
      onElectionsChanged();
    } catch (err) { alert(err.message); }
  };

  const quickDelete = async (election, e) => {
    e.stopPropagation();
    if (!window.confirm(`Delete "${election.name}"? This permanently removes all votes and voter records and cannot be undone.`)) return;
    try {
      const res = await fetch(`${API_URL}/admin/elections/${election.id}`, {
        method: 'DELETE', headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
      if (selected && selected.id === election.id) closeDetail();
      onElectionsChanged();
    } catch (err) { alert(err.message); }
  };

  const startEdit = () => {
    setEditForm({
      name:        selected.name,
      description: selected.description || '',
      endTime:     new Date(selected.endTime).toISOString().slice(0, 16)
    });
    if (selected.races && selected.races.length > 0) {
      setEditRaces(selected.races.map(r => ({ ...r, candidates: [...(r.candidates || [])] })));
      setEditCandidates(null);
    } else {
      setEditRaces(null);
      setEditCandidates(selected.candidates && selected.candidates.length > 0
        ? [...selected.candidates]
        : ['', '']);
    }
    setEditing(true);
    setMsg(null);
  };

  const handleSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      const res = await fetch(`${API_URL}/admin/elections/${selected.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify(
          editRaces !== null
            ? { ...editForm, races: editRaces }
            : editCandidates !== null
              ? { ...editForm, candidates: editCandidates.filter(c => c.trim()) }
              : editForm
        )
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Save failed');
      setMsg({ type: 'success', text: 'Election updated.' });
      setEditing(false);
      onElectionsChanged();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    if (!window.confirm(`Delete "${selected.name}"? This cannot be undone.`)) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/admin/elections/${selected.id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Delete failed');
      closeDetail();
      onElectionsChanged();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
      setSaving(false);
    }
  };

  const handleEnd = async () => {
    if (!window.confirm(`End "${selected.name}" now and calculate results?`)) return;
    setSaving(true);
    try {
      const res = await fetch(`${API_URL}/admin/elections/${selected.id}/end`, {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Failed to end election');
      setMsg({ type: 'success', text: 'Election ended and results calculated.' });
      onElectionsChanged();
    } catch (err) {
      setMsg({ type: 'error', text: err.message });
    } finally {
      setSaving(false);
    }
  };

  const addEditRace = () => setEditRaces(prev => [
    ...prev,
    { id: `race_${Date.now()}`, name: '', type: 'plurality', majorityThreshold: 0.5, candidates: ['', ''] }
  ]);
  const removeEditRace = (rid) => setEditRaces(prev => prev.filter(r => r.id !== rid));
  const updateEditRace = (rid, field, val) =>
    setEditRaces(prev => prev.map(r => r.id === rid ? { ...r, [field]: val } : r));
  const addEditCandidate = (rid) =>
    setEditRaces(prev => prev.map(r => r.id === rid ? { ...r, candidates: [...r.candidates, ''] } : r));
  const updateEditCandidate = (rid, idx, val) =>
    setEditRaces(prev => prev.map(r => {
      if (r.id !== rid) return r;
      const c = [...r.candidates]; c[idx] = val; return { ...r, candidates: c };
    }));
  const removeEditCandidate = (rid, idx) =>
    setEditRaces(prev => prev.map(r =>
      r.id !== rid ? r : { ...r, candidates: r.candidates.filter((_, i) => i !== idx) }
    ));

  return (
    <div className="elections-list">
      <div className="section-header">
        <div className="section-title">All Elections</div>
        {onCreateNew && (
          <button className="section-btn" onClick={onCreateNew}>+ New Election</button>
        )}
      </div>
      {elections.length === 0 ? (
        <p className="empty-state" style={{ padding: '2rem', textAlign: 'center', color: '#64748b' }}>
          No elections yet.{onCreateNew && <> <button className="section-btn" onClick={onCreateNew} style={{ fontSize: '14px' }}>Create one to get started →</button></>}
        </p>
      ) : (
        <div className="elections-card">
          <table className="el-table">
            <thead>
              <tr>
                <th>Election Name</th>
                <th>Status</th>
                <th>Type</th>
                <th>Registered</th>
                <th>Ends</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {elections.map(election => {
                const raceCount = election.races ? election.races.length : null;
                const candidateCount = election.candidates ? election.candidates.length : 0;
                const isPast = new Date(election.endTime) < new Date();
                const isEnded = election.status === 'ended' || isPast;
                const statusLabel = election.status === 'ended' ? 'Ended' : isPast ? 'Expired' : 'Live';
                return (
                  <tr key={election.id}>
                    <td>
                      <div className="el-name">{election.name}</div>
                      <div className="el-sub">
                        {raceCount ? `${raceCount} race${raceCount !== 1 ? 's' : ''}` : `${candidateCount} candidates`}
                        {' · '}{election.voterCount || 0} registered
                      </div>
                    </td>
                    <td>
                      <span className={`badge ${isEnded ? 'badge-gray' : 'badge-green badge-dot'}`}>{statusLabel}</span>
                    </td>
                    <td>
                      <span className={`badge ${election.type === 'ranked-choice' ? 'badge-gold' : 'badge-blue'}`}>
                        {election.type === 'ranked-choice' ? 'Ranked Choice' : election.type === 'majority' ? 'Majority' : 'Plurality'}
                      </span>
                    </td>
                    <td>{election.voterCount || 0}</td>
                    <td style={{ fontSize: '12px' }}>{formatDT(election.endTime)}</td>
                    <td>
                      <div className="tbl-actions">
                        <button className="tbl-btn primary" onClick={() => openDetail(election)}>Details</button>
                        {!isEnded && (
                          <button className="tbl-btn" onClick={e => quickEnd(election, e)}>End</button>
                        )}
                        <button className="tbl-btn danger" onClick={e => quickDelete(election, e)}>Delete</button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {selected && (
        <div className="modal-overlay" onClick={closeDetail}>
          <div className="modal-box election-detail-modal" onClick={e => e.stopPropagation()}>
            <button className="modal-close-btn" onClick={closeDetail}>✕</button>
            <div className="modal-header-row">
              <h3>{selected.name}</h3>
            </div>

            {!editing && (
              <div className="detail-tabs">
                <button className={`detail-tab ${detailTab === 'info' ? 'active' : ''}`} onClick={() => setDetailTab('info')}>Info</button>
                <button className={`detail-tab ${detailTab === 'participation' ? 'active' : ''}`} onClick={() => setDetailTab('participation')}>👥 Participation</button>
              </div>
            )}

            {!editing ? (
              <>
                {detailTab === 'participation' ? (
                  <ParticipationPanel election={selected} token={token} />
                ) : (
                <div className="detail-grid">
                  <span className="detail-label">Status</span>
                  <span className={`status-badge ${selected.status}`}>{selected.status}</span>
                  <span className="detail-label">Type</span>
                  <span>{selected.type}</span>
                  <span className="detail-label">Description</span>
                  <span>{selected.description || '—'}</span>
                  <span className="detail-label">Ends</span>
                  <span>{formatDT(selected.endTime)}</span>
                  <span className="detail-label">Voters</span>
                  <span>{selected.voterCount}</span>
                  {selected.races ? (
                    <>
                      <span className="detail-label">Races</span>
                      <span>{selected.races.map(r => r.name).join(', ')}</span>
                    </>
                  ) : (
                    <>
                      <span className="detail-label">Candidates</span>
                      <span>{(selected.candidates || []).join(', ')}</span>
                    </>
                  )}
                  {selected.quorumCount > 0 && (
                    <>
                      <span className="detail-label">Quorum</span>
                      <span>{selected.quorumCount} votes required</span>
                    </>
                  )}
                </div>
                )}

                {msg && <p className={`settings-msg ${msg.type}`}>{msg.text}</p>}

                <div className="modal-actions">
                  <button className="submit-btn" style={{ width: 'auto', padding: '10px 20px' }} onClick={startEdit}>
                    ✏️ Edit
                  </button>
                  {selected.status === 'active' && (
                    <button className="cancel-btn" style={{ background: '#f59e0b', color: '#fff', border: 'none' }} onClick={handleEnd} disabled={saving}>
                      🏁 End Election
                    </button>
                  )}
                  <button className="delete-btn" style={{ marginLeft: 'auto' }} onClick={handleDelete} disabled={saving}>
                    🗑️ Delete
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="form-group">
                  <label>Election Name</label>
                  <input type="text" value={editForm.name}
                    onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>Description</label>
                  <textarea rows="2" value={editForm.description}
                    onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} />
                </div>
                <div className="form-group">
                  <label>End Time</label>
                  <input type="datetime-local" value={editForm.endTime}
                    onChange={e => setEditForm(p => ({ ...p, endTime: e.target.value }))} />
                </div>

                {editCandidates && (
                  <div className="form-group">
                    <label>Candidates</label>
                    {editCandidates.map((c, i) => (
                      <div key={i} className="candidate-input">
                        <input
                          type="text"
                          value={c}
                          onChange={e => {
                            const updated = [...editCandidates];
                            updated[i] = e.target.value;
                            setEditCandidates(updated);
                          }}
                          placeholder={`Candidate ${i + 1}`}
                        />
                        {editCandidates.length > 2 && (
                          <button type="button" className="remove-candidate-btn"
                            onClick={() => setEditCandidates(editCandidates.filter((_, j) => j !== i))}>✕</button>
                        )}
                      </div>
                    ))}
                    <button type="button" className="add-btn"
                      onClick={() => setEditCandidates([...editCandidates, ''])}>
                      + Add Candidate
                    </button>
                  </div>
                )}

                {editRaces && (
                  <div className="form-group">
                    <label>Races / Positions</label>
                    {editRaces.map((race, ri) => (
                      <div key={race.id} className="race-block">
                        <div className="race-block-header">
                          <span className="race-number">Position {ri + 1}</span>
                          {editRaces.length > 1 && (
                            <button type="button" className="remove-race-btn" onClick={() => removeEditRace(race.id)}>✕ Remove</button>
                          )}
                        </div>
                        <div className="form-row">
                          <div className="form-group">
                            <label>Position Name</label>
                            <input type="text" value={race.name}
                              onChange={e => updateEditRace(race.id, 'name', e.target.value)}
                              placeholder="e.g. President" />
                          </div>
                          <div className="form-group">
                            <label>Voting Method</label>
                            <select value={race.type} onChange={e => updateEditRace(race.id, 'type', e.target.value)}>
                              <option value="plurality">Plurality (most votes wins)</option>
                              <option value="majority">Majority (configurable threshold)</option>
                              <option value="ranked-choice">Ranked Choice (IRV)</option>
                            </select>
                          </div>
                        </div>
                        {race.type === 'majority' && (
                          <div className="form-group" style={{ marginBottom: '0.75rem' }}>
                            <label>Majority Threshold</label>
                            <select value={race.majorityThreshold || 0.5}
                              onChange={e => updateEditRace(race.id, 'majorityThreshold', parseFloat(e.target.value))}>
                              <option value={0.5}>Simple majority (50%+1)</option>
                              <option value={2/3}>Two-thirds supermajority (2/3)</option>
                              <option value={0.75}>Three-quarters supermajority (3/4)</option>
                            </select>
                          </div>
                        )}
                        <label style={{ display: 'block', marginBottom: '0.4rem', fontSize: '0.875rem', fontWeight: 500 }}>Candidates</label>
                        {race.candidates.map((c, ci) => (
                          <div key={ci} className="candidate-input">
                            <input type="text" value={c}
                              onChange={e => updateEditCandidate(race.id, ci, e.target.value)}
                              placeholder={`Candidate ${ci + 1}`} />
                            {race.candidates.length > 2 && (
                              <button type="button" className="remove-candidate-btn"
                                onClick={() => removeEditCandidate(race.id, ci)}>✕</button>
                            )}
                          </div>
                        ))}
                        <button type="button" onClick={() => addEditCandidate(race.id)} className="add-btn">
                          + Add Candidate
                        </button>
                      </div>
                    ))}
                    <button type="button" onClick={addEditRace} className="add-race-btn">
                      + Add Position / Race
                    </button>
                  </div>
                )}

                {msg && <p className={`settings-msg ${msg.type}`}>{msg.text}</p>}
                <div className="modal-actions">
                  <button className="submit-btn" style={{ width: 'auto', padding: '10px 20px' }} onClick={handleSave} disabled={saving}>
                    {saving ? 'Saving…' : 'Save Changes'}
                  </button>
                  <button className="cancel-btn" onClick={() => setEditing(false)}>Cancel</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// CREATE ELECTION
// ==========================================

function CreateElection({ token, onElectionCreated }) {
  const [name, setName] = useState('');
  const [ballotCode, setBallotCode] = useState('');
  const [endTime, setEndTime] = useState('');
  const [candidates, setCandidates] = useState(['', '']);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const updateCandidate = (i, val) => setCandidates(prev => prev.map((c, idx) => idx === i ? val : c));
  const addCandidate = () => setCandidates(prev => [...prev, '']);
  const removeCandidate = (i) => setCandidates(prev => prev.filter((_, idx) => idx !== i));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);
    setError('');
    setSuccess('');

    const validCandidates = candidates.map(c => c.trim()).filter(Boolean);
    if (validCandidates.length < 2) {
      setError('At least 2 candidates are required.');
      setSaving(false);
      return;
    }

    try {
      const response = await fetch(`${API_URL}/admin/elections`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({
          name: name.trim(),
          ballotCode: ballotCode.trim(),
          endTime,
          candidates: validCandidates.map(n => ({ name: n }))
        })
      });
      if (!response.ok) {
        const err = await response.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to create election');
      }
      setSuccess('Election created successfully.');
      setName('');
      setBallotCode('');
      setEndTime('');
      setCandidates(['', '']);
      onElectionCreated();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="create-election">
      <h2>Create New Election</h2>
      <form onSubmit={handleSubmit} className="election-form">
        <div className="form-group">
          <label>Election Name *</label>
          <input
            type="text"
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="e.g., Board of Directors 2026"
            required
          />
        </div>

        <div className="form-group">
          <label>Ballot Code *</label>
          <input
            type="text"
            value={ballotCode}
            onChange={e => setBallotCode(e.target.value.toUpperCase())}
            placeholder="e.g., VOTE2026"
            required
          />
          <p className="field-hint">Voters enter this shared code to access the ballot. Share it on the day of the vote.</p>
        </div>

        <div className="form-group">
          <label>End Time *</label>
          <input
            type="datetime-local"
            value={endTime}
            onChange={e => setEndTime(e.target.value)}
            required
          />
          <p style={{ margin: '0.25rem 0 0', fontSize: '0.8rem', color: 'var(--neutral-500)' }}>
            Times are in your local timezone ({USER_TZ})
          </p>
        </div>

        <div className="form-group">
          <label>Candidates *</label>
          {candidates.map((c, i) => (
            <div key={i} className="candidate-input">
              <input
                type="text"
                value={c}
                onChange={e => updateCandidate(i, e.target.value)}
                placeholder={`Candidate ${i + 1}`}
              />
              {candidates.length > 2 && (
                <button type="button" className="remove-candidate-btn" onClick={() => removeCandidate(i)}>✕</button>
              )}
            </div>
          ))}
          <button type="button" onClick={addCandidate} className="add-btn">+ Add Candidate</button>
        </div>

        {error && <div className="error-message">{error}</div>}
        {success && <div style={{ color: 'var(--success-600)', marginBottom: '1rem', fontWeight: 600 }}>{success}</div>}

        <button type="submit" disabled={saving} className="submit-btn">
          {saving ? 'Creating…' : 'Create Election'}
        </button>
      </form>
    </div>
  );
}


// ==========================================
// RESULTS VIEWER
// ==========================================

function ResultsViewer({ elections, token }) {
  const [selectedElectionId, setSelectedElectionId] = useState('');
  const [results, setResults] = useState(null);
  const [loading, setLoading] = useState(false);

  const printResults = () => {
    const el = elections.find(e => e.id === selectedElectionId);
    const quorum = el?.quorumCount || 0;
    const totalVotes = results.election.totalVotes;
    const quorumMet = quorum === 0 || totalVotes >= quorum;
    const raceHtml = results.results.type === 'multi-race'
      ? results.results.races.map(race => `
          <h3>${race.raceName}</h3>
          ${(race.results || []).map(r => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:6px 0"><span>${r.candidate}</span><strong>${r.votes} votes</strong></div>`).join('')}
          ${race.winner ? `<p style="color:#10b981;font-weight:bold;margin-top:8px">🏆 Winner: ${race.winner}</p>` : ''}
        `).join('<hr/>')
      : (results.results.results || []).map(r => `<div style="display:flex;justify-content:space-between;border-bottom:1px solid #e5e7eb;padding:6px 0"><span>${r.candidate}</span><strong>${r.votes} votes</strong></div>`).join('') +
        (results.results.winner ? `<p style="color:#10b981;font-weight:bold;margin-top:8px">🏆 Winner: ${results.results.winner}</p>` : '');
    const w = window.open('', '_blank', 'width=760,height=900');
    w.document.write(`<!DOCTYPE html><html><head><title>Election Results — ${results.election.name}</title>
      <style>body{font-family:Georgia,serif;max-width:680px;margin:40px auto;color:#1a1a1a}h1{font-size:22px;border-bottom:2px solid #2563eb;padding-bottom:10px}h2{font-size:16px;color:#555}h3{color:#1e40af;margin-top:20px}@media print{button{display:none}}</style>
      </head><body>
      <h1>Official Election Results</h1>
      <h2>${results.election.name}</h2>
      <p style="color:#6b7280;font-size:13px">Generated ${new Date().toLocaleString()}</p>
      <table style="width:100%;border-collapse:collapse;margin:16px 0">
        <tr><td style="padding:6px 0;color:#555">Total Votes Cast</td><td style="font-weight:bold">${totalVotes}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Registered Voters</td><td style="font-weight:bold">${results.election.totalVoters}</td></tr>
        <tr><td style="padding:6px 0;color:#555">Turnout</td><td style="font-weight:bold">${results.election.votingPercentage}%</td></tr>
        ${quorum > 0 ? `<tr><td style="padding:6px 0;color:#555">Quorum Required</td><td style="font-weight:bold;color:${quorumMet ? '#10b981' : '#ef4444'}">${quorum} — ${quorumMet ? '✅ MET' : '❌ NOT MET'}</td></tr>` : ''}
      </table>
      <hr/>${raceHtml}
      <p style="margin-top:40px;font-size:12px;color:#9ca3af;border-top:1px solid #e5e7eb;padding-top:12px">Certified by VoterTerminal · ${results.election.name} · ${new Date().toLocaleDateString()}</p>
      <button onclick="window.print()" style="margin-top:16px;padding:10px 24px;background:#2563eb;color:white;border:none;border-radius:6px;cursor:pointer;font-size:15px">🖨 Print / Save as PDF</button>
      </body></html>`);
    w.document.close();
  };

  const fetchResults = async (electionId) => {
    setLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/elections/${electionId}/results`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      const data = await response.json();
      setResults(data);
    } catch (err) {
      alert('Error fetching results: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  const handleElectionSelect = (e) => {
    const electionId = e.target.value;
    setSelectedElectionId(electionId);
    if (electionId) fetchResults(electionId);
  };

  return (
    <div className="results-viewer">
      <h2>Election Results</h2>
      
      <div className="form-group">
        <label>Select Election</label>
        <select value={selectedElectionId} onChange={handleElectionSelect}>
          <option value="">-- Choose an election --</option>
          {elections.map(election => (
            <option key={election.id} value={election.id}>
              {election.name} ({election.status})
            </option>
          ))}
        </select>
      </div>

      {loading && <p>Loading results...</p>}

      {results && (
        <div className="results-display">
          <div className="election-summary">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: '8px' }}>
              <h3>{results.election.name}</h3>
              <button className="print-results-btn" onClick={printResults}>🖨 Print / Save PDF</button>
            </div>
            <div className="stats-grid">
              <div className="stat">
                <span className="stat-label">Total Votes</span>
                <span className="stat-value">{results.election.totalVotes}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Registered Voters</span>
                <span className="stat-value">{results.election.totalVoters}</span>
              </div>
              <div className="stat">
                <span className="stat-label">Turnout</span>
                <span className="stat-value">{results.election.votingPercentage}%</span>
              </div>
              {(() => {
                const q = elections.find(e => e.id === selectedElectionId)?.quorumCount || 0;
                if (!q) return null;
                const met = results.election.totalVotes >= q;
                return (
                  <div className="stat">
                    <span className="stat-label">Quorum ({q} req.)</span>
                    <span className="stat-value" style={{ color: met ? '#10b981' : '#ef4444' }}>{met ? '✅ Met' : '❌ Not Met'}</span>
                  </div>
                );
              })()}
            </div>
          </div>

          <div className="results-breakdown">
            {results.results.type === 'multi-race' ? (
              results.results.races.map(race => (
                <div key={race.raceId} className="race-results-block">
                  <h4 className="race-results-title">{race.raceName}</h4>
                  {race.results?.map((result, index) => (
                    <div key={index} className="result-bar">
                      <span className="candidate-name">{result.candidate}</span>
                      <div className="bar-container">
                        <div className="bar" style={{ width: `${results.election.totalVotes > 0 ? (result.votes / results.election.totalVotes) * 100 : 0}%` }} />
                      </div>
                      <span className="vote-count">{result.votes} votes</span>
                    </div>
                  ))}
                  {race.winner && (
                    <div className="winner-announcement">
                      <p className="winner-text">🏆 Winner: <strong>{race.winner}</strong></p>
                    </div>
                  )}
                </div>
              ))
            ) : (
              <>
                <h4>Vote Tally</h4>
                {results.results.results?.map((result, index) => (
                  <div key={index} className="result-bar">
                    <span className="candidate-name">{result.candidate}</span>
                    <div className="bar-container">
                      <div className="bar" style={{ width: `${(result.votes / results.election.totalVotes) * 100}%` }} />
                    </div>
                    <span className="vote-count">{result.votes} votes</span>
                  </div>
                ))}
                {results.results.winner && (
                  <div className="winner-announcement">
                    <p className="winner-text">🏆 Winner: <strong>{results.results.winner}</strong></p>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}


// ==========================================
// VOTER PORTAL
// ==========================================

function VoterPortal({ setUserType }) {
  const [step, setStep] = useState('landing'); // landing, select-election, enter-code, vote, done
  const [orgConfig, setOrgConfig] = useState(null);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState(null);
  const [votingToken, setVotingToken] = useState(null);

  useEffect(() => {
    fetchOrgConfig();
    fetchElections();
  }, []);

  const fetchOrgConfig = async () => {
    try {
      const response = await fetch(`${API_URL}/config`);
      if (response.ok) setOrgConfig(await response.json());
    } catch {}
  };

  const fetchElections = async () => {
    try {
      const response = await fetch(`${API_URL}/elections`);
      if (!response.ok) return;
      setElections(await response.json());
    } catch {}
  };

  if (step === 'landing') {
    return (
      <OrgLandingPage
        orgConfig={orgConfig}
        onEnter={() => setStep('select-election')}
      />
    );
  }

  if (step === 'select-election') {
    return (
      <VoterElectionSelector
        elections={elections}
        onSelectElection={(election) => {
          setSelectedElection(election);
          setStep('enter-code');
        }}
        onBack={() => setStep('landing')}
      />
    );
  }

  if (step === 'enter-code') {
    return (
      <BallotCodeEntry
        election={selectedElection}
        onAccessGranted={(token, electionDetail) => {
          setVotingToken(token);
          if (electionDetail) setSelectedElection(electionDetail);
          setStep('vote');
        }}
        onBack={() => setStep('select-election')}
      />
    );
  }

  if (step === 'vote') {
    return (
      <VotingBallot
        election={selectedElection}
        token={votingToken}
        onVoteSubmitted={() => setStep('done')}
        onBack={() => setStep('enter-code')}
      />
    );
  }

  if (step === 'done') {
    return (
      <VoteDone
        election={selectedElection}
        onComplete={() => {
          setStep('select-election');
          setSelectedElection(null);
          setVotingToken(null);
        }}
      />
    );
  }
}

// ==========================================
// VOTER: ELECTION SELECTOR
// ==========================================

function VoterElectionSelector({ elections, onSelectElection, onBack }) {
  const filteredElections = elections.filter(e => {
    const now = new Date();
    return new Date(e.endTime) > now && (!e.startTime || new Date(e.startTime) <= now);
  });

  return (
    <div className="voter-page election-selector">
      <header className="voter-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h1>Select an Election</h1>
      </header>

      {filteredElections.length === 0 ? (
        <div className="empty-state">
          <p>No active elections at this time.</p>
        </div>
      ) : (
        <div className="elections-grid voter-elections">
          {filteredElections.map(election => (
            <div 
              key={election.id} 
              className="election-card clickable"
              onClick={() => onSelectElection(election)}
            >
              <h3>{election.name}</h3>
              <p>{election.description}</p>
              <div className="election-info">
                <span>📋 {election.candidates.length} candidate{election.candidates.length !== 1 ? 's' : ''}</span>
                <span>⏰ Ends {formatDT(election.endTime)}</span>
              </div>
              <button className="vote-btn">Start Voting →</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==========================================
// VOTER: BALLOT CODE ENTRY
// ==========================================

function BallotCodeEntry({ election, onAccessGranted, onBack }) {
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/voter/access`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ electionId: election.id, ballotCode: code.trim() })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Failed to access ballot');
      }
      const data = await response.json();
      onAccessGranted(data.votingToken, data.election);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="voter-page registration">
      <header className="voter-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h1>Enter Ballot Code</h1>
      </header>
      <div className="form-container">
        <h2>{election.name}</h2>
        <p className="form-subtitle">Enter the ballot code provided by your administrator.</p>
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Ballot Code *</label>
            <input
              type="text"
              value={code}
              onChange={e => setCode(e.target.value.toUpperCase())}
              placeholder="e.g., VOTE2026"
              autoCapitalize="characters"
              required
              style={{ fontSize: '1.2rem', letterSpacing: '0.1em' }}
            />
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Verifying…' : 'Access Ballot'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// VOTER: VOTING BALLOT
// ==========================================

function VotingBallot({ election, token, onVoteSubmitted, onBack }) {
  const [selected, setSelected] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const candidates = (election.candidates || []).map(c =>
    typeof c === 'string' ? c : c.name
  );

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');
    try {
      const response = await fetch(`${API_URL}/voter/vote`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
        body: JSON.stringify({ choices: { candidate: selected } })
      });
      if (!response.ok) {
        const err = await response.json();
        throw new Error(err.error || 'Vote submission failed');
      }
      onVoteSubmitted();
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="voter-page ballot">
      <header className="voter-header">
        <button className="back-btn" onClick={onBack}>← Back</button>
        <h1>Your Ballot</h1>
      </header>
      <div className="ballot-container">
        <h2>{election.name}</h2>
        <form onSubmit={handleSubmit}>
          <div className="candidates-section">
            <div className="candidates-list">
              {candidates.map((name, i) => (
                <button
                  key={i}
                  type="button"
                  className={`candidate-btn ${selected === name ? 'selected' : ''}`}
                  onClick={() => setSelected(name)}
                >
                  <span className="candidate-name">{name}</span>
                  {selected === name && <span className="checkmark">✓</span>}
                </button>
              ))}
            </div>
          </div>
          {error && <div className="error-message">{error}</div>}
          <button type="submit" disabled={loading || !selected} className="submit-btn">
            {loading ? 'Submitting…' : 'Submit Vote'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// VOTE DONE
// ==========================================

function VoteDone({ election, onComplete }) {
  return (
    <div className="voter-page receipt">
      <div className="receipt-container">
        <div className="receipt-header">
          <span className="success-icon">✓</span>
          <h1>Vote Submitted</h1>
          <p>Your vote has been counted.</p>
        </div>
        <div className="receipt-body">
          <div className="receipt-item">
            <span className="label">Election:</span>
            <span className="value">{election.name}</span>
          </div>
          <div className="receipt-item">
            <span className="label">Time:</span>
            <span className="value">{new Date().toLocaleString()}</span>
          </div>
        </div>
        <div className="receipt-footer">
          <button className="done-btn" onClick={onComplete}>Done</button>
        </div>
      </div>
    </div>
  );
}
