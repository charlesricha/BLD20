import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';
import { WifiOff } from 'lucide-react';

function Sessions() {
  const [sessions, setSessions] = useState([]);
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [currentTime, setCurrentTime] = useState(Date.now());
  const [disconnectingId, setDisconnectingId] = useState(null);

  useEffect(() => {
    // 1. Load packages for looking up package name
    const unsubscribePkgs = onSnapshot(collection(db, 'packages'), (snapshot) => {
      const pkgs = [];
      snapshot.forEach(doc => {
        pkgs.push({ id: doc.id, ...doc.data() });
      });
      setPackages(pkgs);
    });

    // 2. Real-time active sessions listener
    const sessionsQuery = query(
      collection(db, 'sessions'),
      where('status', '==', 'active')
    );

    const unsubscribeSessions = onSnapshot(sessionsQuery, (snapshot) => {
      const active = [];
      snapshot.forEach(doc => {
        active.push({ id: doc.id, ...doc.data() });
      });
      setSessions(active);
      setLoading(false);
    }, (error) => {
      console.error("Error loading active sessions:", error);
    });

    // 3. Set interval to update timer countdowns every second
    const interval = setInterval(() => {
      setCurrentTime(Date.now());
    }, 1000);

    return () => {
      unsubscribePkgs();
      unsubscribeSessions();
      clearInterval(interval);
    };
  }, []);

  const handleDisconnect = async (macAddress) => {
    if (!window.confirm(`Disconnect device ${macAddress} from hotspot network? This will send a RADIUS CoA disconnect.`)) {
      return;
    }

    setDisconnectingId(macAddress);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Operator user not logged in");
      
      const token = await user.getIdToken();
      
      // Call Cloud Function API to trigger disconnect and send CoA packet
      const response = await fetch(`/api/sessions/${macAddress}`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      const result = await response.json();
      
      if (result.success) {
        alert(`Successfully sent disconnect command for ${macAddress}`);
      } else {
        throw new Error(result.error || 'Failed to terminate session');
      }
    } catch (err) {
      console.error(err);
      alert("Disconnect failed: " + err.message);
    } finally {
      setDisconnectingId(null);
    }
  };

  // Helper: Format bytes to human readable form
  const formatBytes = (bytes) => {
    if (!bytes || bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  // Helper: Get formatted remaining time
  const getRemainingTime = (expiresAt) => {
    if (!expiresAt) return '00:00:00';
    const diff = expiresAt.toDate().getTime() - currentTime;
    if (diff <= 0) return 'Expired';

    const hours = Math.floor(diff / 3600000);
    const minutes = Math.floor((diff % 3600000) / 60000);
    const seconds = Math.floor((diff % 60000) / 1000);

    const pad = (num) => String(num).padStart(2, '0');
    return `${pad(hours)}:${pad(minutes)}:${pad(seconds)}`;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '60vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', border: '3px solid rgba(99,102,241,0.1)', borderTopColor: '#6366f1', animation: 'spin 1s infinite linear' }}></div>
      </div>
    );
  }

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Active Sessions</h1>
          <p>Real-time list of users currently authenticated and browsing.</p>
        </div>
      </div>

      <div className="panel">
        <div className="table-container">
          {sessions.length === 0 ? (
            <p className="text-center" style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No active user sessions found.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>MAC / User</th>
                  <th>IP Address</th>
                  <th>WiFi Profile</th>
                  <th>Time Remaining</th>
                  <th>Uploaded (Tx)</th>
                  <th>Downloaded (Rx)</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {sessions.map((session) => {
                  const matchingPkg = packages.find(p => p.id === session.package_id);
                  const pkgName = matchingPkg ? matchingPkg.name : 'Unknown Package';
                  
                  return (
                    <tr key={session.id}>
                      <td>
                        <strong style={{ fontFamily: 'monospace' }}>{session.mac_address.toUpperCase()}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{session.username}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{session.ip_address || 'Dynamic'}</td>
                      <td>
                        <span style={{ fontWeight: 600 }}>{pkgName}</span>
                      </td>
                      <td style={{ 
                        fontFamily: 'monospace', 
                        fontWeight: 'bold', 
                        color: getRemainingTime(session.expires_at) === 'Expired' ? 'var(--error)' : 'var(--success)'
                      }}>
                        {getRemainingTime(session.expires_at)}
                      </td>
                      <td>{formatBytes(session.bytes_in)}</td>
                      <td>{formatBytes(session.bytes_out)}</td>
                      <td className="text-right">
                        <button 
                          onClick={() => handleDisconnect(session.mac_address)} 
                          className="btn btn-danger btn-sm"
                          disabled={disconnectingId === session.mac_address}
                          style={{ display: 'inline-flex', gap: '4px', alignItems: 'center' }}
                        >
                          {disconnectingId === session.mac_address ? 'Disconnecting...' : <><WifiOff size={12} /> Kick Out</>}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default Sessions;
