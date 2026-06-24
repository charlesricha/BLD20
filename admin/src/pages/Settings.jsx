import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db, auth } from '../firebase';

function Settings() {
  const [hotspots, setHotspots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);

  // Form State
  const [formName, setFormName] = useState('');
  const [formLocation, setFormLocation] = useState('');
  const [formMikrotikIp, setFormMikrotikIp] = useState('');
  const [formRadiusSecret, setFormRadiusSecret] = useState('');
  const [formInterface, setFormInterface] = useState('bridge');
  const [formActive, setFormActive] = useState(true);

  // Setup Script State
  const [selectedScriptId, setSelectedScriptId] = useState(null);
  const [setupScript, setSetupScript] = useState('');
  const [fetchingScript, setFetchingScript] = useState(false);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'hotspots'), (snapshot) => {
      const list = [];
      snapshot.forEach(doc => {
        list.push({ id: doc.id, ...doc.data() });
      });
      setHotspots(list);
      setLoading(false);
    }, (error) => console.error("Error loading hotspots:", error));

    return () => unsubscribe();
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setFormName('');
    setFormLocation('');
    setFormMikrotikIp('');
    // Generate a secure cryptographically strong random key by default for secret
    const randomSecret = Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8) + Math.random().toString(36).slice(-8);
    setFormRadiusSecret(randomSecret.toUpperCase().slice(0, 32));
    setFormInterface('bridge');
    setFormActive(true);
    setShowModal(true);
  };

  const openEditModal = (h) => {
    setEditingId(h.id);
    setFormName(h.name);
    setFormLocation(h.location || '');
    setFormMikrotikIp(h.mikrotik_ip || '');
    setFormRadiusSecret(h.radius_secret || '');
    setFormInterface(h.interface || 'bridge');
    setFormActive(h.active !== false);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formName.trim() || !formMikrotikIp.trim()) return;

    // Validate IP structure simply
    const ipRegex = /^(?:[0-9]{1,3}\.){3}[0-9]{1,3}$/;
    if (!ipRegex.test(formMikrotikIp.trim())) {
      alert("Please enter a valid IP address.");
      return;
    }

    const data = {
      name: formName.trim(),
      location: formLocation.trim(),
      mikrotik_ip: formMikrotikIp.trim(),
      radius_secret: formRadiusSecret.trim(),
      interface: formInterface.trim(),
      active: Boolean(formActive)
    };

    try {
      if (editingId) {
        const docRef = doc(db, 'hotspots', editingId);
        await updateDoc(docRef, {
          ...data,
          updated_at: serverTimestamp()
        });
      } else {
        const colRef = collection(db, 'hotspots');
        const docRef = await addDoc(colRef, {
          ...data,
          created_at: serverTimestamp()
        });
        await updateDoc(docRef, { hotspot_id: docRef.id });
      }
      setShowModal(false);
    } catch (err) {
      console.error(err);
      alert("Failed to save hotspot: " + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Delete this hotspot configuration? RADIUS requests from this router IP will be ignored.")) return;
    try {
      await deleteDoc(doc(db, 'hotspots', id));
      if (selectedScriptId === id) {
        setSelectedScriptId(null);
        setSetupScript('');
      }
    } catch (err) {
      console.error(err);
      alert("Failed to delete: " + err.message);
    }
  };

  const handleFetchScript = async (id) => {
    setSelectedScriptId(id);
    setFetchingScript(true);
    setSetupScript('');
    
    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Operator not logged in");
      
      const token = await user.getIdToken();
      
      // Request RouterOS Setup Script from backend
      const response = await fetch(`/api/mikrotik/config/${id}`, {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      });

      if (response.ok) {
        const text = await response.text();
        setSetupScript(text);
      } else {
        const result = await response.json();
        throw new Error(result.error || 'Failed to generate setup script');
      }
    } catch (err) {
      console.error(err);
      alert("Script retrieval failed: " + err.message);
      setSelectedScriptId(null);
    } finally {
      setFetchingScript(false);
    }
  };

  const handleCopyScript = () => {
    navigator.clipboard.writeText(setupScript);
    alert("One-Paste setup script copied to clipboard!");
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
          <h1>Hotspot Settings</h1>
          <p>Register Router gateways, manage credentials, and generate setup scripts.</p>
        </div>
        <button onClick={openCreateModal} className="btn btn-primary">
          <span>➕ Add Hotspot</span>
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '32px', alignItems: 'start' }}>
        
        {/* Left column: Hotspots table */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Registered MikroTik Hotspots</span>
          </div>
          
          <div className="table-container">
            {hotspots.length === 0 ? (
              <p className="text-center" style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No hotspots defined yet. Click "Add Hotspot" to begin.</p>
            ) : (
              <table style={{ fontSize: '13px' }}>
                <thead>
                  <tr>
                    <th>Hotspot Name</th>
                    <th>Router IP</th>
                    <th>Status</th>
                    <th className="text-right">Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {hotspots.map((h) => (
                    <tr key={h.id} style={{ backgroundColor: selectedScriptId === h.id ? 'rgba(99, 102, 241, 0.05)' : '' }}>
                      <td>
                        <strong>{h.name}</strong>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{h.location || 'No location'}</div>
                      </td>
                      <td style={{ fontFamily: 'monospace' }}>{h.mikrotik_ip}</td>
                      <td>
                        <span className={`badge ${h.active !== false ? 'badge-success' : 'badge-danger'}`}>
                          {h.active !== false ? 'Active' : 'Inactive'}
                        </span>
                      </td>
                      <td className="text-right" style={{ display: 'flex', justifyContent: 'flex-end', gap: '6px' }}>
                        <button onClick={() => handleFetchScript(h.id)} className="btn btn-secondary btn-sm" style={{ padding: '4px 8px' }}>
                          📜 Script
                        </button>
                        <button onClick={() => openEditModal(h)} className="btn btn-secondary btn-sm" style={{ padding: '4px 8px' }}>
                          ✏️
                        </button>
                        <button onClick={() => handleDelete(h.id)} className="btn btn-danger btn-sm" style={{ padding: '4px 8px' }}>
                          🗑️
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Right column: RouterOS setup script display */}
        <div className="panel">
          <div className="panel-header">
            <div>
              <span className="panel-title">One-Paste RouterOS Script</span>
              {selectedScriptId && (
                <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>
                  Hotspot Profile Config Code for target device
                </div>
              )}
            </div>
            {setupScript && (
              <button onClick={handleCopyScript} className="btn btn-primary btn-sm">
                📋 Copy Script
              </button>
            )}
          </div>

          <div style={{ minHeight: '200px', backgroundColor: 'var(--bg-app)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', overflow: 'auto' }}>
            {fetchingScript ? (
              <div style={{ display: 'flex', height: '180px', alignItems: 'center', justifyContent: 'center' }}>
                <div style={{ width: '24px', height: '24px', borderRadius: '50%', border: '2px solid rgba(99,102,241,0.1)', borderTopColor: '#6366f1', animation: 'spin 1s infinite linear' }}></div>
              </div>
            ) : setupScript ? (
              <pre style={{ margin: 0, fontFamily: 'monospace', fontSize: '12px', color: '#a7f3d0', whiteSpace: 'pre-wrap' }}>
                {setupScript}
              </pre>
            ) : (
              <p style={{ color: 'var(--text-muted)', fontSize: '13px', textAlign: 'center', marginTop: '70px' }}>
                {selectedScriptId ? 'Generating Script...' : 'Select a hotspot using the "📜 Script" button to view RouterOS profile configuration code.'}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Hotspot Form Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal-title">{editingId ? 'Modify Hotspot' : 'Add Hotspot'}</h2>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Hotspot / Shop Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. Mwamba Cyber hAP Lite" 
                  required 
                  value={formName} 
                  onChange={(e) => setFormName(e.target.value)} 
                />
              </div>

              <div className="form-group">
                <label>Location / Description</label>
                <input 
                  type="text" 
                  placeholder="e.g. Block 4, First Floor" 
                  value={formLocation} 
                  onChange={(e) => setFormLocation(e.target.value)} 
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>MikroTik IP Address</label>
                  <input 
                    type="text" 
                    placeholder="e.g. 197.248.55.12" 
                    required 
                    value={formMikrotikIp} 
                    onChange={(e) => setFormMikrotikIp(e.target.value)} 
                  />
                </div>
                <div className="form-group">
                  <label>Local Interface</label>
                  <select 
                    value={formInterface} 
                    onChange={(e) => setFormInterface(e.target.value)}
                  >
                    <option value="bridge">bridge (recommended)</option>
                    <option value="ether2">ether2</option>
                    <option value="ether3">ether3</option>
                    <option value="ether4">ether4</option>
                    <option value="wlan1">wlan1</option>
                  </select>
                </div>
              </div>

              <div className="form-group">
                <label>RADIUS Shared Secret</label>
                <input 
                  type="text" 
                  required 
                  value={formRadiusSecret} 
                  onChange={(e) => setFormRadiusSecret(e.target.value)} 
                />
                <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Must match RADIUS config exactly. 32 char key recommended.</span>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <input 
                  type="checkbox" 
                  id="hotspot-active" 
                  checked={formActive} 
                  onChange={(e) => setFormActive(e.target.checked)} 
                  style={{ width: 'auto' }}
                />
                <label htmlFor="hotspot-active" style={{ marginBottom: 0, cursor: 'pointer' }}>Active (Accept RADIUS queries)</label>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Hotspot
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Settings;
