import React, { useState, useEffect } from 'react';
import { BrowserRouter as Router, Routes, Route, Navigate, Link, useLocation } from 'react-router-dom';
import { onAuthStateChanged, signInWithEmailAndPassword, signOut } from 'firebase/auth';
import { auth } from './firebase';

// Import Pages
import Dashboard from './pages/Dashboard';
import Packages from './pages/Packages';
import Vouchers from './pages/Vouchers';
import Sessions from './pages/Sessions';
import Payments from './pages/Payments';
import Reports from './pages/Reports';
import Settings from './pages/Settings';

// Import Icons
import { 
  LayoutDashboard, 
  Wifi, 
  Ticket, 
  Users, 
  CreditCard, 
  TrendingUp, 
  Settings as SettingsIcon, 
  LogOut 
} from 'lucide-react';

function App() {
  const [user, setUser] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState('');
  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (currentUser) => {
      if (currentUser) {
        setUser(currentUser);
        try {
          // Force refresh token to get latest custom claims
          const idTokenResult = await currentUser.getIdTokenResult(true);
          
          // Verify if user has the admin claim
          if (idTokenResult.claims.role === 'admin' || currentUser.email === 'admin@bubblenet.com') {
            setIsAdmin(true);
            setAuthError('');
          } else {
            setIsAdmin(false);
            setAuthError('Unauthorized. You do not have admin privileges. Contact developer to set the admin claim.');
            await signOut(auth);
            setUser(null);
          }
        } catch (e) {
          console.error("Error checking admin claims", e);
          setIsAdmin(false);
          setUser(null);
        }
      } else {
        setUser(null);
        setIsAdmin(false);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const handleLogin = async (e) => {
    e.preventDefault();
    setLoading(true);
    setAuthError('');
    try {
      // In a real flow, checking if email matches admin@bubblenet.com as a fail-safe helper
      const userCredential = await signInWithEmailAndPassword(auth, loginEmail, loginPassword);
      const idTokenResult = await userCredential.user.getIdTokenResult(true);
      
      // If the email is admin@bubblenet.com, bypass if claim is not written yet in sandbox
      if (idTokenResult.claims.role === 'admin' || loginEmail === 'admin@bubblenet.com') {
        setIsAdmin(true);
      } else {
        setAuthError('Access Denied. You do not have operator permissions.');
        await signOut(auth);
      }
    } catch (error) {
      console.error("Login failed:", error);
      let message = 'Invalid email or password.';
      if (error.code === 'auth/user-not-found') message = 'No admin user found with this email.';
      setAuthError(message);
    } finally {
      setLoading(false);
    }
  };

  const handleLogout = async () => {
    setLoading(true);
    await signOut(auth);
    setLoading(false);
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '100vh', alignItems: 'center', justifyContent: 'center', backgroundColor: '#0b0f19' }}>
        <div style={{ width: '40px', height: '40px', borderRadius: '50%', border: '4px solid rgba(99,102,241,0.1)', borderTopColor: '#6366f1', animation: 'spin 1s infinite linear' }}></div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (!user || !isAdmin) {
    return (
      <div className="login-container">
        <div className="login-card">
          <div className="login-header">
            <svg viewBox="0 0 24 24" width="48" height="48" fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" style={{ marginBottom: '16px' }}>
              <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
              <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
              <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
              <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3"></line>
            </svg>
            <h2>BubbleNet</h2>
            <p>Hotspot Control Panel Login</p>
          </div>

          {authError && (
            <div style={{ backgroundColor: 'rgba(239, 68, 68, 0.1)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.2)', padding: '12px', borderRadius: '8px', fontSize: '13px', marginBottom: '20px', fontWeight: 600 }}>
              {authError}
            </div>
          )}

          <form onSubmit={handleLogin} style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
            <div className="form-group">
              <label>Operator Email</label>
              <input 
                type="email" 
                placeholder="operator@domain.com" 
                required 
                value={loginEmail} 
                onChange={(e) => setLoginEmail(e.target.value)} 
              />
            </div>
            <div className="form-group">
              <label>Password</label>
              <input 
                type="password" 
                placeholder="••••••••" 
                required 
                value={loginPassword} 
                onChange={(e) => setLoginPassword(e.target.value)} 
              />
            </div>
            <button type="submit" className="btn btn-primary w-full" style={{ marginTop: '8px', padding: '12px' }}>
              Login to Console
            </button>
          </form>
        </div>
      </div>
    );
  }

  return (
    <Router basename="/admin">
      <div className="admin-layout">
        <Sidebar onLogout={handleLogout} userEmail={user.email} />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/packages" element={<Packages />} />
            <Route path="/vouchers" element={<Vouchers />} />
            <Route path="/sessions" element={<Sessions />} />
            <Route path="/payments" element={<Payments />} />
            <Route path="/reports" element={<Reports />} />
            <Route path="/settings" element={<Settings />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        </main>
      </div>
    </Router>
  );
}

// Navigation Sidebar Component
function Sidebar({ onLogout, userEmail }) {
  const location = useLocation();
  const path = location.pathname;

  const menuItems = [
    { name: 'Dashboard', path: '/', icon: <LayoutDashboard size={18} /> },
    { name: 'WiFi Packages', path: '/packages', icon: <Wifi size={18} /> },
    { name: 'Vouchers Manager', path: '/vouchers', icon: <Ticket size={18} /> },
    { name: 'Active Sessions', path: '/sessions', icon: <Users size={18} /> },
    { name: 'Payments Log', path: '/payments', icon: <CreditCard size={18} /> },
    { name: 'Daily Reports', path: '/reports', icon: <TrendingUp size={18} /> },
    { name: 'Hotspot Settings', path: '/settings', icon: <SettingsIcon size={18} /> }
  ];

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <svg viewBox="0 0 24 24" width="28" height="28" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path d="M5 12.55a11 11 0 0 1 14.08 0"></path>
          <path d="M1.42 9a16 16 0 0 1 21.16 0"></path>
          <path d="M8.53 16.11a6 6 0 0 1 6.95 0"></path>
          <line x1="12" y1="20" x2="12.01" y2="20" strokeWidth="3"></line>
        </svg>
        <span>Bubble<span style={{ color: '#6366f1' }}>Net</span></span>
      </div>

      <nav className="sidebar-menu">
        {menuItems.map((item) => (
          <Link
            key={item.path}
            to={item.path}
            className={`menu-item ${path === item.path ? 'active' : ''}`}
          >
            {item.icon}
            {item.name}
          </Link>
        ))}
      </nav>

      <div className="sidebar-footer">
        <div style={{ fontSize: '11px', color: '#9ca3af', overflow: 'hidden', textOverflow: 'ellipsis', marginBottom: '12px', fontWeight: 600 }}>
          Logged in as:<br />
          <span style={{ color: '#f9fafb' }}>{userEmail}</span>
        </div>
        <button onClick={onLogout} className="btn btn-secondary btn-sm w-full" style={{ display: 'flex', gap: '6px', alignItems: 'center', justifyContent: 'center' }}>
          <LogOut size={14} /> Logout
        </button>
      </div>
    </aside>
  );
}

export default App;
