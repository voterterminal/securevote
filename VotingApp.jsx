import React, { useState, useEffect } from 'react';
import './VotingApp.css';

const API_URL = process.env.REACT_APP_API_URL || 'http://localhost:3001/api';

// ==========================================
// MAIN APP COMPONENT
// ==========================================

export default function VotingApp() {
  const [currentUser, setCurrentUser] = useState(null);
  const isAdminRoute = window.location.pathname.startsWith('/admin');

  return (
    <div className="voting-app">
      {isAdminRoute ? (
        <AdminPanel setUserType={() => {}} setCurrentUser={setCurrentUser} />
      ) : (
        <VoterPortal setUserType={() => {}} />
      )}
    </div>
  );
}

// ==========================================
// ORG LANDING PAGE
// ==========================================

function OrgLandingPage({ orgConfig, onEnter }) {
  const orgName   = (orgConfig && orgConfig.orgName)    || 'Gwinnett Democratic Party';
  const orgTagline = (orgConfig && orgConfig.orgTagline) || 'Official Ballot';
  const logoUrl   = (orgConfig && orgConfig.logoUrl)    || null;

  return (
    <div className="org-landing-page">
      <div className="org-landing-card">
        {logoUrl ? (
          <img src={logoUrl} alt={orgName} className="org-logo" />
        ) : (
          <div className="county-map-container">
            {/* Gwinnett County, GA — stylised outline */}
            <svg viewBox="0 0 200 200" className="county-map-svg" xmlns="http://www.w3.org/2000/svg">
              <defs>
                <filter id="glow">
                  <feGaussianBlur stdDeviation="3" result="blur"/>
                  <feMerge><feMergeNode in="blur"/><feMergeNode in="SourceGraphic"/></feMerge>
                </filter>
              </defs>
              {/* County body */}
              <path
                d="M 62,14 L 105,8 L 150,14 L 186,48 L 190,92 L 178,138 L 148,170 L 100,180 L 58,172 L 22,148 L 8,106 L 10,60 L 28,28 Z"
                fill="rgba(255,255,255,0.12)"
                stroke="rgba(255,255,255,0.85)"
                strokeWidth="2.5"
                strokeLinejoin="round"
                filter="url(#glow)"
              />
              {/* Location pin */}
              <circle cx="100" cy="96" r="10" fill="rgba(255,255,255,0.9)"/>
              <circle cx="100" cy="96" r="5"  fill="#003087"/>
              {/* Subtle inner grid lines */}
              <line x1="60" y1="95" x2="140" y2="95" stroke="rgba(255,255,255,0.15)" strokeWidth="1"/>
              <line x1="100" y1="55" x2="100" y2="155" stroke="rgba(255,255,255,0.15)" strokeWidth="1"/>
            </svg>
          </div>
        )}

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
        <h1 className="main-title">SecureVote</h1>
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
  const [activeTab, setActiveTab] = useState('elections');
  const [elections, setElections] = useState([]);
  const [loading, setLoading] = useState(false);

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
      const response = await fetch(`${API_URL}/admin/elections`, {
        headers: { 'Authorization': `Bearer ${adminToken}` }
      });
      const data = await response.json();
      setElections(data);
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

  if (!adminToken) {
    return (
      <div className="admin-login">
        <div className="login-form-container">
          <h2>Admin Login</h2>
          <form onSubmit={handleAdminLogin}>
            <div className="form-group">
              <label>Email</label>
              <input
                type="email"
                value={adminEmail}
                onChange={(e) => setAdminEmail(e.target.value)}
                placeholder="admin@voting.com"
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input
                type="password"
                value={adminPassword}
                onChange={(e) => setAdminPassword(e.target.value)}
                placeholder="••••••••"
              />
            </div>
            {loginError && <div className="error-message">{loginError}</div>}
            <button type="submit" disabled={loading} className="submit-btn">
              {loading ? 'Logging in...' : 'Login'}
            </button>
          </form>
          <button className="back-btn" onClick={() => setUserType(null)}>
            ← Back
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="admin-dashboard">
      <header className="admin-header">
        <h1>Admin Dashboard</h1>
        <button className="logout-btn" onClick={handleLogout}>Logout</button>
      </header>

      <nav className="admin-tabs">
        <button 
          className={`tab ${activeTab === 'elections' ? 'active' : ''}`}
          onClick={() => setActiveTab('elections')}
        >
          Elections
        </button>
        <button 
          className={`tab ${activeTab === 'create' ? 'active' : ''}`}
          onClick={() => setActiveTab('create')}
        >
          Create Election
        </button>
        <button 
          className={`tab ${activeTab === 'results' ? 'active' : ''}`}
          onClick={() => setActiveTab('results')}
        >
          Results
        </button>
        <button
          className={`tab emergency-tab ${activeTab === 'emergency' ? 'active' : ''}`}
          onClick={() => setActiveTab('emergency')}
        >
          🔐 Emergency Actions
        </button>
        <button
          className={`tab ${activeTab === 'settings' ? 'active' : ''}`}
          onClick={() => setActiveTab('settings')}
        >
          ⚙️ Settings
        </button>
      </nav>

      <div className="admin-content">
        {activeTab === 'elections' && (
          <ElectionsList elections={elections} token={adminToken} />
        )}
        {activeTab === 'create' && (
          <CreateElection token={adminToken} onElectionCreated={fetchElections} />
        )}
        {activeTab === 'results' && (
          <ResultsViewer elections={elections} token={adminToken} />
        )}
        {activeTab === 'emergency' && (
          <EmergencyActions elections={elections} token={adminToken} />
        )}
        {activeTab === 'settings' && (
          <AdminSettings token={adminToken} />
        )}
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

  // Billing state
  const [billing, setBilling] = useState(null);
  const [billingLoading, setBillingLoading] = useState(true);
  const [checkoutLoading, setCheckoutLoading] = useState(null); // plan id being clicked
  const [portalLoading, setPortalLoading] = useState(false);

  useEffect(() => {
    fetch(`${API_URL}/admin/billing`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.ok ? r.json() : null)
      .then(data => { if (data) setBilling(data); })
      .catch(() => {})
      .finally(() => setBillingLoading(false));
  }, [token]);

  useEffect(() => {
    fetch(`${API_URL}/admin/users`, { headers: { Authorization: `Bearer ${token}` } })
      .then(r => r.json())
      .then(setAdmins)
      .catch(() => {});
  }, [token]);

  const handleUpgrade = async (planId) => {
    setCheckoutLoading(planId);
    try {
      const res = await fetch(`${API_URL}/stripe/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ planId, successUrl: window.location.href, cancelUrl: window.location.href })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Checkout failed');
      window.location.href = data.url;
    } catch (err) {
      alert(err.message);
    } finally {
      setCheckoutLoading(null);
    }
  };

  const handleBillingPortal = async () => {
    setPortalLoading(true);
    try {
      const res = await fetch(`${API_URL}/admin/billing/portal`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ returnUrl: window.location.href })
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Could not open billing portal');
      window.location.href = data.url;
    } catch (err) {
      alert(err.message);
    } finally {
      setPortalLoading(false);
    }
  };

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

  // Billing helpers
  const PLAN_LABELS = { free: 'Free', community: 'Community', pro: 'Pro', enterprise: 'Enterprise', grandfathered: 'Grandfathered' };
  const PLAN_PRICES = { free: '$0', community: '$19/mo', pro: '$75/mo', enterprise: 'Custom', grandfathered: 'Free' };

  const planBadgeClass = (plan) => {
    if (plan === 'grandfathered') return 'plan-badge grandfathered';
    if (plan === 'enterprise') return 'plan-badge enterprise';
    if (plan === 'pro') return 'plan-badge pro';
    if (plan === 'community') return 'plan-badge community';
    return 'plan-badge free';
  };

  return (
    <div className="admin-settings">

      {/* Billing & Subscription */}
      {!billingLoading && (
        <div className="settings-card billing-card">
          <h2>Subscription &amp; Billing</h2>

          {!billing ? (
            <p className="settings-msg error">Billing information unavailable — this feature requires the SaaS tenant server.</p>
          ) : billing.plan === 'grandfathered' ? (
            <div className="billing-status-row">
              <span className={planBadgeClass(billing.plan)}>
                ⭐ {PLAN_LABELS[billing.plan]}
              </span>
              <p className="billing-note">Your account has complimentary access — no payment required.</p>
            </div>
          ) : (
            <>
              <div className="billing-status-row">
                <span className={planBadgeClass(billing.plan)}>
                  {PLAN_LABELS[billing.plan] || billing.plan} — {PLAN_PRICES[billing.plan] || ''}
                </span>
                {billing.status === 'trialing' && billing.trialDaysLeft != null && (
                  <span className="trial-badge">
                    🕐 Trial: {billing.trialDaysLeft} day{billing.trialDaysLeft !== 1 ? 's' : ''} left
                  </span>
                )}
                {billing.status === 'past_due' && (
                  <span className="trial-badge past-due">⚠️ Payment past due</span>
                )}
                {billing.status === 'canceled' && (
                  <span className="trial-badge past-due">❌ Subscription canceled</span>
                )}
                {billing.status === 'active' && (
                  <span className="trial-badge active">✅ Active</span>
                )}
              </div>

              {/* Available upgrade plans */}
              {billing.availablePlans && billing.availablePlans.length > 0 && (
                <div className="billing-upgrade-section">
                  <p className="billing-upgrade-label">
                    {billing.plan === 'free' || billing.status === 'trialing'
                      ? 'Choose a plan to unlock full access:'
                      : 'Upgrade your plan:'}
                  </p>
                  <div className="billing-plans-row">
                    {billing.availablePlans.map(p => (
                      <div key={p.id} className={`billing-plan-option ${p.id === 'pro' ? 'featured' : ''}`}>
                        {p.id === 'pro' && <div className="plan-popular-badge">Most Popular</div>}
                        <div className="plan-option-name">{p.name}</div>
                        <div className="plan-option-price">${p.price / 100}<span>/mo</span></div>
                        <ul className="plan-option-features">
                          {p.features.slice(0, 3).map((f, i) => (
                            <li key={i}>✓ {f}</li>
                          ))}
                        </ul>
                        <button
                          className="plan-upgrade-btn"
                          onClick={() => handleUpgrade(p.id)}
                          disabled={checkoutLoading === p.id}
                        >
                          {checkoutLoading === p.id ? 'Redirecting...' : `Get ${p.name}`}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Billing portal for active subscribers */}
              {(billing.status === 'active' || billing.status === 'past_due') && billing.plan !== 'free' && (
                <div className="billing-portal-row">
                  <button className="billing-portal-btn" onClick={handleBillingPortal} disabled={portalLoading}>
                    {portalLoading ? 'Opening...' : '💳 Manage Billing & Invoices'}
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}

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
    </div>
  );
}

// ==========================================
// ELECTIONS LIST
// ==========================================

function ElectionsList({ elections, token }) {
  return (
    <div className="elections-list">
      <h2>Elections</h2>
      {elections.length === 0 ? (
        <p className="empty-state">No elections yet. Create one to get started.</p>
      ) : (
        <div className="elections-grid">
          {elections.map(election => (
            <div key={election.id} className="election-card">
              <h3>{election.name}</h3>
              <p className="election-desc">{election.description}</p>
              <div className="election-details">
                <span className="type-badge">{election.type}</span>
                <span className="status-badge" style={{
                  backgroundColor: election.status === 'active' ? '#10b981' : '#6b7280'
                }}>
                  {election.status}
                </span>
              </div>
              <div className="election-meta">
                <p>Candidates: {election.candidates.length}</p>
                <p>Voters: {election.voterCount}</p>
                <p>Ends: {new Date(election.endTime).toLocaleDateString()}</p>
              </div>
              <button className="view-btn">View Details</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ==========================================
// CREATE ELECTION
// ==========================================

function CreateElection({ token, onElectionCreated }) {
  const [formData, setFormData] = useState({
    name: '',
    description: '',
    type: 'plurality',
    candidates: ['', ''],
    startTime: '',
    endTime: '',
    requiresAffidavit: true
  });
  const [saving, setSaving] = useState(false);

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleCandidateChange = (index, value) => {
    const newCandidates = [...formData.candidates];
    newCandidates[index] = value;
    setFormData(prev => ({ ...prev, candidates: newCandidates }));
  };

  const addCandidate = () => {
    setFormData(prev => ({
      ...prev,
      candidates: [...prev.candidates, '']
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSaving(true);

    try {
      const response = await fetch(`${API_URL}/admin/elections`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify(formData)
      });

      if (!response.ok) throw new Error('Failed to create election');
      
      alert('Election created successfully!');
      setFormData({
        name: '',
        description: '',
        type: 'plurality',
        candidates: ['', ''],
        startTime: '',
        endTime: '',
        requiresAffidavit: true
      });
      onElectionCreated();
    } catch (err) {
      alert('Error: ' + err.message);
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
            name="name"
            value={formData.name}
            onChange={handleChange}
            placeholder="e.g., City Council Election 2024"
            required
          />
        </div>

        <div className="form-group">
          <label>Description</label>
          <textarea
            name="description"
            value={formData.description}
            onChange={handleChange}
            placeholder="Brief description of the election"
            rows="3"
          />
        </div>

        <div className="form-group">
          <label>Election Type *</label>
          <select name="type" value={formData.type} onChange={handleChange}>
            <option value="plurality">Plurality (50% + 1)</option>
            <option value="majority">Majority Required</option>
            <option value="ranked-choice">Ranked Choice Voting</option>
          </select>
        </div>

        <div className="form-group">
          <label>Candidates/Options *</label>
          {formData.candidates.map((candidate, index) => (
            <div key={index} className="candidate-input">
              <input
                type="text"
                value={candidate}
                onChange={(e) => handleCandidateChange(index, e.target.value)}
                placeholder={`Candidate ${index + 1}`}
              />
            </div>
          ))}
          <button type="button" onClick={addCandidate} className="add-btn">
            + Add Candidate
          </button>
        </div>

        <div className="form-row">
          <div className="form-group">
            <label>Start Time *</label>
            <input
              type="datetime-local"
              name="startTime"
              value={formData.startTime}
              onChange={handleChange}
              required
            />
          </div>
          <div className="form-group">
            <label>End Time *</label>
            <input
              type="datetime-local"
              name="endTime"
              value={formData.endTime}
              onChange={handleChange}
              required
            />
          </div>
        </div>

        <div className="form-group checkbox">
          <label>
            <input
              type="checkbox"
              name="requiresAffidavit"
              checked={formData.requiresAffidavit}
              onChange={handleChange}
            />
            Require voter affidavit
          </label>
        </div>

        <button type="submit" disabled={saving} className="submit-btn">
          {saving ? 'Creating...' : 'Create Election'}
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
            <h3>{results.election.name}</h3>
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
            </div>
          </div>

          <div className="results-breakdown">
            <h4>Vote Tally</h4>
            {results.results.results?.map((result, index) => (
              <div key={index} className="result-bar">
                <span className="candidate-name">{result.candidate}</span>
                <div className="bar-container">
                  <div 
                    className="bar" 
                    style={{
                      width: `${(result.votes / results.election.totalVotes) * 100}%`
                    }}
                  />
                </div>
                <span className="vote-count">{result.votes} votes</span>
              </div>
            ))}
            
            {results.results.winner && (
              <div className="winner-announcement">
                <p className="winner-text">
                  🏆 Winner: <strong>{results.results.winner}</strong>
                </p>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ==========================================
// EMERGENCY ACTIONS
// ==========================================

function EmergencyActions({ elections, token }) {
  const [emergencyPassword, setEmergencyPassword] = useState('');
  const [authenticated, setAuthenticated] = useState(false);
  const [authError, setAuthError] = useState('');

  const [selectedElectionId, setSelectedElectionId] = useState('');
  const [auditVoters, setAuditVoters] = useState(null);
  const [invalidationLog, setInvalidationLog] = useState(null);
  const [retally, setRetally] = useState(null);

  // Per-voter action state
  const [activeAction, setActiveAction] = useState(null); // { type: 'invalidate'|'reinstate', voterId, email }
  const [actionReason, setActionReason] = useState('');
  const [actionLoading, setActionLoading] = useState(false);
  const [actionFeedback, setActionFeedback] = useState(null);
  const [loadingAudit, setLoadingAudit] = useState(false);

  const selectedElection = elections.find(e => e.id === selectedElectionId);

  // Step 1: authenticate with emergency password
  const handleAuth = (e) => {
    e.preventDefault();
    if (!emergencyPassword.trim()) {
      setAuthError('Emergency password is required.');
      return;
    }
    // We don't verify locally — the server will reject if wrong
    setAuthenticated(true);
    setAuthError('');
  };

  // Load audit log + invalidation history for selected election
  const loadElectionData = async (electionId) => {
    setAuditVoters(null);
    setInvalidationLog(null);
    setRetally(null);
    setActionFeedback(null);
    setLoadingAudit(true);

    try {
      const [auditRes, logRes] = await Promise.all([
        fetch(`${API_URL}/admin/elections/${electionId}/audit-log?emergencyPassword=${encodeURIComponent(emergencyPassword)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        }),
        fetch(`${API_URL}/admin/elections/${electionId}/invalidation-log?emergencyPassword=${encodeURIComponent(emergencyPassword)}`, {
          headers: { 'Authorization': `Bearer ${token}` }
        })
      ]);

      if (!auditRes.ok) {
        const err = await auditRes.json();
        throw new Error(err.error || 'Incorrect emergency password');
      }

      const auditData = await auditRes.json();
      const logData = await logRes.json();

      setAuditVoters(auditData.voters);
      setInvalidationLog(logData);
    } catch (err) {
      setAuthError(err.message);
      setAuthenticated(false);
    } finally {
      setLoadingAudit(false);
    }
  };

  const handleElectionSelect = (e) => {
    const id = e.target.value;
    setSelectedElectionId(id);
    setActiveAction(null);
    setActionFeedback(null);
    if (id) loadElectionData(id);
  };

  // Invalidate or reinstate a voter
  const handleAction = async () => {
    if (!actionReason.trim() || actionReason.trim().length < 10) {
      alert('Please provide a reason of at least 10 characters.');
      return;
    }
    setActionLoading(true);
    setActionFeedback(null);

    const endpoint = activeAction.type === 'invalidate'
      ? `/admin/elections/${selectedElectionId}/invalidate-voter`
      : `/admin/elections/${selectedElectionId}/reinstate-voter`;

    try {
      const response = await fetch(`${API_URL}${endpoint}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          voterId: activeAction.voterId,
          reason: actionReason,
          emergencyPassword
        })
      });

      const data = await response.json();
      if (!response.ok) throw new Error(data.error);

      setRetally(data.retally);
      setActionFeedback({ success: true, message: data.message });
      setActiveAction(null);
      setActionReason('');
      loadElectionData(selectedElectionId); // refresh list
    } catch (err) {
      setActionFeedback({ success: false, message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  // Manual re-tally
  const handleRetally = async () => {
    setActionLoading(true);
    try {
      const response = await fetch(`${API_URL}/admin/elections/${selectedElectionId}/retally`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ emergencyPassword })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRetally(data.results);
      setActionFeedback({ success: true, message: 'Re-tally complete.' });
    } catch (err) {
      setActionFeedback({ success: false, message: err.message });
    } finally {
      setActionLoading(false);
    }
  };

  // ── Render: auth gate ──
  if (!authenticated) {
    return (
      <div className="emergency-panel">
        <div className="emergency-header">
          <span className="emergency-icon">🔐</span>
          <div>
            <h2>Emergency Actions</h2>
            <p>Voter invalidation, reinstatement, and re-tally. Requires the emergency password. All actions are permanently logged.</p>
          </div>
        </div>

        <div className="emergency-auth-box">
          <form onSubmit={handleAuth}>
            <div className="form-group">
              <label>Emergency Password</label>
              <input
                type="password"
                value={emergencyPassword}
                onChange={(e) => setEmergencyPassword(e.target.value)}
                placeholder="Enter emergency password"
                autoComplete="off"
              />
            </div>
            {authError && <div className="error-message">{authError}</div>}
            <button type="submit" className="emergency-auth-btn">
              Unlock Emergency Access
            </button>
          </form>
        </div>

        <div className="emergency-warning">
          <p>⚠️ Emergency access is audited. Every action — including failed login attempts — is permanently logged with your admin ID and timestamp.</p>
        </div>
      </div>
    );
  }

  // ── Render: main emergency panel ──
  return (
    <div className="emergency-panel unlocked">

      <div className="emergency-header">
        <span className="emergency-icon">🔐</span>
        <div>
          <h2>Emergency Actions</h2>
          <p>Session active. All actions are permanently logged.</p>
        </div>
        <button className="lock-btn" onClick={() => { setAuthenticated(false); setEmergencyPassword(''); setAuditVoters(null); }}>
          🔒 Lock
        </button>
      </div>

      {/* Election Selector */}
      <div className="emergency-section">
        <div className="form-group">
          <label>Select Election</label>
          <select value={selectedElectionId} onChange={handleElectionSelect}>
            <option value="">-- Choose an election --</option>
            {elections.map(e => (
              <option key={e.id} value={e.id}>{e.name} ({e.status})</option>
            ))}
          </select>
        </div>
      </div>

      {loadingAudit && <p className="loading-text">Loading voter data…</p>}

      {selectedElectionId && auditVoters && (
        <>
          {/* Summary bar */}
          <div className="emergency-stats">
            <div className="estat">
              <span className="estat-val">{auditVoters.length}</span>
              <span className="estat-lbl">Total Voters</span>
            </div>
            <div className="estat">
              <span className="estat-val estat-red">
                {auditVoters.filter(v => v.invalidated).length}
              </span>
              <span className="estat-lbl">Invalidated</span>
            </div>
            <div className="estat">
              <span className="estat-val estat-green">
                {auditVoters.filter(v => !v.invalidated).length}
              </span>
              <span className="estat-lbl">Valid Votes</span>
            </div>
          </div>

          {/* Action feedback */}
          {actionFeedback && (
            <div className={`action-feedback ${actionFeedback.success ? 'success' : 'error'}`}>
              {actionFeedback.success ? '✅' : '❌'} {actionFeedback.message}
            </div>
          )}

          {/* Voter Table */}
          <div className="emergency-section">
            <div className="section-header-row">
              <h3>Voter Audit List</h3>
              <button
                className="retally-btn"
                onClick={handleRetally}
                disabled={actionLoading}
              >
                🔄 Manual Re-tally
              </button>
            </div>

            <div className="voter-table-wrapper">
              <table className="voter-table">
                <thead>
                  <tr>
                    <th>Email</th>
                    <th>Voted At</th>
                    <th>Status</th>
                    <th>Reason (if invalidated)</th>
                    <th>Action</th>
                  </tr>
                </thead>
                <tbody>
                  {auditVoters.map((voter) => (
                    <tr key={voter.voterId} className={voter.invalidated ? 'row-invalidated' : ''}>
                      <td className="voter-email">{voter.email}</td>
                      <td className="voter-time">{new Date(voter.timestamp).toLocaleString()}</td>
                      <td>
                        {voter.invalidated
                          ? <span className="badge badge-red">Invalidated</span>
                          : <span className="badge badge-green">Valid</span>
                        }
                      </td>
                      <td className="voter-reason">
                        {voter.invalidatedReason || '—'}
                      </td>
                      <td>
                        {voter.invalidated ? (
                          <button
                            className="action-btn reinstate-btn"
                            onClick={() => { setActiveAction({ type: 'reinstate', voterId: voter.voterId, email: voter.email }); setActionReason(''); setActionFeedback(null); }}
                          >
                            Reinstate
                          </button>
                        ) : (
                          <button
                            className="action-btn invalidate-btn"
                            onClick={() => { setActiveAction({ type: 'invalidate', voterId: voter.voterId, email: voter.email }); setActionReason(''); setActionFeedback(null); }}
                          >
                            Invalidate
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Action confirmation modal */}
          {activeAction && (
            <div className="action-modal-overlay">
              <div className="action-modal">
                <h3>
                  {activeAction.type === 'invalidate' ? '⚠️ Invalidate Voter' : '✅ Reinstate Voter'}
                </h3>
                <p>
                  {activeAction.type === 'invalidate'
                    ? <>You are about to <strong>remove</strong> the vote cast by <strong>{activeAction.email}</strong> from the tally. Their vote content remains anonymous.</>
                    : <>You are about to <strong>restore</strong> the vote cast by <strong>{activeAction.email}</strong> back into the tally.</>
                  }
                </p>
                <p className="modal-note">
                  This action will immediately trigger a re-tally. A notification email will be sent to the voter. This action is permanently logged.
                </p>

                <div className="form-group">
                  <label>Reason <span className="required">(min 10 characters, required)</span></label>
                  <textarea
                    value={actionReason}
                    onChange={(e) => setActionReason(e.target.value)}
                    placeholder="Provide a clear, official reason for this action…"
                    rows="3"
                  />
                  <small>{actionReason.length} / 10 minimum characters</small>
                </div>

                <div className="modal-actions">
                  <button
                    className={activeAction.type === 'invalidate' ? 'confirm-invalidate-btn' : 'confirm-reinstate-btn'}
                    onClick={handleAction}
                    disabled={actionLoading || actionReason.trim().length < 10}
                  >
                    {actionLoading ? 'Processing…' : `Confirm ${activeAction.type === 'invalidate' ? 'Invalidation' : 'Reinstatement'}`}
                  </button>
                  <button className="cancel-btn" onClick={() => setActiveAction(null)}>
                    Cancel
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* Re-tally results */}
          {retally && (
            <div className="emergency-section retally-results">
              <h3>📊 Current Tally (after changes)</h3>
              <div className="retally-meta">
                <span>Valid votes counted: <strong>{retally.totalValidVotes}</strong></span>
                <span>Invalidated & excluded: <strong>{retally.totalInvalidatedVotes}</strong></span>
                {retally.winner && <span>Current leader: <strong>{retally.winner}</strong></span>}
              </div>
              <div className="retally-bars">
                {retally.results?.map((r, i) => (
                  <div key={i} className="result-bar">
                    <span className="candidate-name">{r.candidate}</span>
                    <div className="bar-container">
                      <div className="bar" style={{ width: `${retally.totalValidVotes > 0 ? (r.votes / retally.totalValidVotes) * 100 : 0}%` }} />
                    </div>
                    <span className="vote-count">{r.votes}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Invalidation history log */}
          {invalidationLog && invalidationLog.history.length > 0 && (
            <div className="emergency-section">
              <h3>📋 Invalidation History</h3>
              <div className="voter-table-wrapper">
                <table className="voter-table">
                  <thead>
                    <tr>
                      <th>Action</th>
                      <th>Voter Email</th>
                      <th>Reason</th>
                      <th>By Admin</th>
                      <th>Timestamp</th>
                    </tr>
                  </thead>
                  <tbody>
                    {invalidationLog.history
                      .filter(h => h.action === 'voter_invalidated' || h.action === 'voter_reinstated')
                      .map((h, i) => (
                        <tr key={i}>
                          <td>
                            <span className={`badge ${h.action === 'voter_invalidated' ? 'badge-red' : 'badge-green'}`}>
                              {h.action === 'voter_invalidated' ? 'Invalidated' : 'Reinstated'}
                            </span>
                          </td>
                          <td>{h.voterEmail}</td>
                          <td>{h.reason}</td>
                          <td>{h.invalidatedBy || h.reinstatedBy}</td>
                          <td>{new Date(h.timestamp).toLocaleString()}</td>
                        </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ==========================================
// VOTER PORTAL
// ==========================================

function VoterPortal({ setUserType }) {
  const [step, setStep] = useState('landing'); // landing, select-election, register, vote, confirm, receipt
  const [orgConfig, setOrgConfig] = useState(null);
  const [elections, setElections] = useState([]);
  const [selectedElection, setSelectedElection] = useState(null);
  const [votingToken, setVotingToken] = useState(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchOrgConfig();
    fetchElections();
  }, []);

  const fetchOrgConfig = async () => {
    try {
      const response = await fetch(`${API_URL}/config`);
      if (response.ok) setOrgConfig(await response.json());
    } catch (err) {
      console.error('Error fetching org config:', err);
    }
  };

  const fetchElections = async () => {
    try {
      const response = await fetch(`${API_URL}/elections`);
      if (response.ok) setElections(await response.json());
    } catch (err) {
      console.error('Error fetching elections:', err);
    }
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
          setStep('register');
        }}
        onBack={() => setStep('landing')}
      />
    );
  }

  if (step === 'register') {
    return (
      <VoterRegistration 
        election={selectedElection}
        onRegisterSuccess={(token) => {
          setVotingToken(token);
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
        onVoteSubmitted={() => setStep('confirm')}
        onBack={() => setStep('register')}
      />
    );
  }

  if (step === 'confirm') {
    return (
      <ConfirmationScreen 
        election={selectedElection}
        onConfirm={() => setStep('receipt')}
      />
    );
  }

  if (step === 'receipt') {
    return (
      <VotingReceipt 
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
    const endTime = new Date(e.endTime);
    return endTime > now;
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
                <span>📋 {election.candidates.length} candidates</span>
                <span>⏰ Ends {new Date(election.endTime).toLocaleDateString()}</span>
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
// VOTER: REGISTRATION
// ==========================================

function VoterRegistration({ election, onRegisterSuccess, onBack }) {
  const [formData, setFormData] = useState({
    email: '',
    name: '',
    address: '',
    affidavit: false
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleChange = (e) => {
    const { name, value, type, checked } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: type === 'checkbox' ? checked : value
    }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/voter/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...formData,
          electionId: election.id
        })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Registration failed');
      }

      const data = await response.json();
      onRegisterSuccess(data.votingToken);
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
        <h1>Voter Registration</h1>
      </header>

      <div className="form-container">
        <h2>{election.name}</h2>
        <p className="form-subtitle">Complete your registration to vote</p>

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Email Address *</label>
            <input
              type="email"
              name="email"
              value={formData.email}
              onChange={handleChange}
              placeholder="your@email.com"
              required
            />
            <small>You'll receive a confirmation receipt at this address</small>
          </div>

          <div className="form-group">
            <label>Full Name *</label>
            <input
              type="text"
              name="name"
              value={formData.name}
              onChange={handleChange}
              placeholder="John Doe"
              required
            />
          </div>

          <div className="form-group">
            <label>Address *</label>
            <textarea
              name="address"
              value={formData.address}
              onChange={handleChange}
              placeholder="123 Main St, City, State ZIP"
              rows="3"
              required
            />
          </div>

          <div className="form-group checkbox">
            <label>
              <input
                type="checkbox"
                name="affidavit"
                checked={formData.affidavit}
                onChange={handleChange}
              />
              <span>I affirm that I am a registered voter and eligible to vote in this election *</span>
            </label>
          </div>

          {error && <div className="error-message">{error}</div>}

          <button type="submit" disabled={loading} className="submit-btn">
            {loading ? 'Registering...' : 'Continue to Ballot'}
          </button>
        </form>

        <div className="privacy-notice">
          <p><strong>🔒 Privacy Guarantee:</strong> Your personal information is used only for verification. Your vote will be completely anonymous and separate from your identity.</p>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// VOTER: VOTING BALLOT
// ==========================================

function VotingBallot({ election, token, onVoteSubmitted, onBack }) {
  const [choices, setChoices] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleVote = (candidate) => {
    if (election.type === 'ranked-choice') {
      if (!choices.includes(candidate)) {
        setChoices([...choices, candidate]);
      }
    } else {
      setChoices([candidate]);
    }
  };

  const removeChoice = (candidate) => {
    setChoices(choices.filter(c => c !== candidate));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setLoading(true);
    setError('');

    try {
      const response = await fetch(`${API_URL}/voter/vote`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ choices })
      });

      if (!response.ok) {
        const errData = await response.json();
        throw new Error(errData.error || 'Vote submission failed');
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
        
        {election.type === 'ranked-choice' && (
          <p className="instruction">Select candidates in order of preference</p>
        )}

        <form onSubmit={handleSubmit}>
          <div className="candidates-section">
            {election.type === 'ranked-choice' && choices.length > 0 && (
              <div className="ranked-choices">
                <h4>Your Rankings:</h4>
                <ol className="ranking-list">
                  {choices.map((choice, index) => (
                    <li key={choice}>
                      <span>{choice}</span>
                      <button 
                        type="button" 
                        onClick={() => removeChoice(choice)}
                        className="remove-btn"
                      >
                        ✕
                      </button>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            <div className="candidates-list">
              {election.candidates.map((candidate, index) => {
                const isSelected = choices.includes(candidate);
                const rankNumber = choices.indexOf(candidate) + 1;

                return (
                  <button
                    key={index}
                    type="button"
                    className={`candidate-btn ${isSelected ? 'selected' : ''}`}
                    onClick={() => handleVote(candidate)}
                  >
                    <span className="candidate-name">{candidate}</span>
                    {isSelected && election.type === 'ranked-choice' && (
                      <span className="rank-badge">#{rankNumber}</span>
                    )}
                    {isSelected && election.type !== 'ranked-choice' && (
                      <span className="checkmark">✓</span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {error && <div className="error-message">{error}</div>}

          <button 
            type="submit" 
            disabled={loading || choices.length === 0} 
            className="submit-btn"
          >
            {loading ? 'Submitting...' : 'Review & Confirm'}
          </button>
        </form>
      </div>
    </div>
  );
}

// ==========================================
// CONFIRMATION SCREEN
// ==========================================

function ConfirmationScreen({ election, onConfirm }) {
  return (
    <div className="voter-page confirmation">
      <header className="voter-header">
        <h1>Confirm Your Vote</h1>
      </header>

      <div className="confirmation-container">
        <div className="confirmation-alert">
          <span className="alert-icon">⚠️</span>
          <p>Please review your selections carefully. Once submitted, you cannot change your vote.</p>
        </div>

        <div className="confirmation-summary">
          <h3>Election: {election.name}</h3>
          <p>Voting type: {election.type}</p>
        </div>

        <div className="confirmation-actions">
          <button className="confirm-btn" onClick={onConfirm}>
            ✓ Confirm & Submit Vote
          </button>
          <button className="cancel-btn" onClick={() => window.history.back()}>
            ← Go Back
          </button>
        </div>

        <div className="privacy-note">
          <p><strong>Your vote is completely anonymous.</strong> It cannot be traced back to you.</p>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// VOTING RECEIPT
// ==========================================

function VotingReceipt({ election, onComplete }) {
  const receiptId = `VOTE-${Date.now().toString(36).toUpperCase()}`;

  return (
    <div className="voter-page receipt">
      <div className="receipt-container">
        <div className="receipt-header">
          <span className="success-icon">✓</span>
          <h1>Vote Submitted</h1>
          <p>Thank you for voting!</p>
        </div>

        <div className="receipt-body">
          <div className="receipt-item">
            <span className="label">Election:</span>
            <span className="value">{election.name}</span>
          </div>
          <div className="receipt-item">
            <span className="label">Confirmation ID:</span>
            <span className="value code">{receiptId}</span>
          </div>
          <div className="receipt-item">
            <span className="label">Time:</span>
            <span className="value">{new Date().toLocaleString()}</span>
          </div>
        </div>

        <div className="receipt-notice">
          <p>✉️ A confirmation email has been sent to your registered email address.</p>
          <p>🔒 Your vote is completely anonymous and cannot be linked to your identity.</p>
        </div>

        <div className="receipt-footer">
          <button className="done-btn" onClick={onComplete}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
