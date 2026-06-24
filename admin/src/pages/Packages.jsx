import React, { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { Plus, Edit2, Trash2 } from 'lucide-react';

function Packages() {
  const [packages, setPackages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showModal, setShowModal] = useState(false);
  const [editingId, setEditingId] = useState(null);
  
  // Form State
  const [formName, setFormName] = useState('');
  const [formPrice, setFormPrice] = useState(0);
  const [formDuration, setFormDuration] = useState(1);
  const [formDataLimit, setFormDataLimit] = useState('');
  const [formSpeedUp, setFormSpeedUp] = useState(1); // default 1 Mbps
  const [formSpeedDown, setFormSpeedDown] = useState(2); // default 2 Mbps
  const [formActive, setFormActive] = useState(true);

  useEffect(() => {
    const unsubscribe = onSnapshot(collection(db, 'packages'), (snapshot) => {
      const pkgs = [];
      snapshot.forEach(doc => {
        pkgs.push({ id: doc.id, ...doc.data() });
      });
      // Sort by price KES
      pkgs.sort((a, b) => a.price_kes - b.price_kes);
      setPackages(pkgs);
      setLoading(false);
    }, (error) => {
      console.error("Error loading packages:", error);
    });

    return () => unsubscribe();
  }, []);

  const openCreateModal = () => {
    setEditingId(null);
    setFormName('');
    setFormPrice(10);
    setFormDuration(1);
    setFormDataLimit('');
    setFormSpeedUp(1);
    setFormSpeedDown(2);
    setFormActive(true);
    setShowModal(true);
  };

  const openEditModal = (pkg) => {
    setEditingId(pkg.id);
    setFormName(pkg.name);
    setFormPrice(pkg.price_kes);
    setFormDuration(pkg.duration_hours);
    setFormDataLimit(pkg.data_limit_mb || '');
    setFormSpeedUp(pkg.speed_up_kbps ? pkg.speed_up_kbps / 1024 : '');
    setFormSpeedDown(pkg.speed_down_kbps ? pkg.speed_down_kbps / 1024 : '');
    setFormActive(pkg.active !== false);
    setShowModal(true);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!formName.trim()) return;

    const data = {
      name: formName.trim(),
      price_kes: Math.round(formPrice),
      duration_hours: Number(formDuration),
      data_limit_mb: formDataLimit ? Number(formDataLimit) : null,
      speed_up_kbps: formSpeedUp ? Math.round(Number(formSpeedUp) * 1024) : null,
      speed_down_kbps: formSpeedDown ? Math.round(Number(formSpeedDown) * 1024) : null,
      active: Boolean(formActive)
    };

    try {
      if (editingId) {
        // Edit existing
        const docRef = doc(db, 'packages', editingId);
        await updateDoc(docRef, {
          ...data,
          updated_at: serverTimestamp()
        });
      } else {
        // Create new
        const colRef = collection(db, 'packages');
        const docRef = await addDoc(colRef, {
          ...data,
          created_at: serverTimestamp()
        });
        // Backfill the document ID inside the document for consistency
        await updateDoc(docRef, { id: docRef.id });
      }
      setShowModal(false);
    } catch (err) {
      console.error("Error saving package:", err);
      alert("Failed to save package: " + err.message);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm("Are you sure you want to delete this package?")) return;
    try {
      await deleteDoc(doc(db, 'packages', id));
    } catch (err) {
      console.error("Error deleting package:", err);
      alert("Failed to delete package: " + err.message);
    }
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
          <h1>WiFi Packages</h1>
          <p>Define pricing, speed throttles, and transfer quotas.</p>
        </div>
        <button onClick={openCreateModal} className="btn btn-primary" style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
          <Plus size={16} /> Add Package
        </button>
      </div>

      <div className="panel">
        <div className="table-container">
          {packages.length === 0 ? (
            <p className="text-center" style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No packages defined yet. Click "Add Package" to start.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Package Name</th>
                  <th>Price</th>
                  <th>Duration</th>
                  <th>Data Limit</th>
                  <th>Speeds (Up/Down)</th>
                  <th>Status</th>
                  <th className="text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {packages.map((pkg) => (
                  <tr key={pkg.id}>
                    <td><strong>{pkg.name}</strong></td>
                    <td style={{ fontWeight: 700, color: 'var(--primary)' }}>KES {pkg.price_kes}</td>
                    <td>{pkg.duration_hours} hrs</td>
                    <td>{pkg.data_limit_mb ? `${pkg.data_limit_mb} MB` : 'Unlimited'}</td>
                    <td>
                      {pkg.speed_up_kbps && pkg.speed_down_kbps 
                        ? `${pkg.speed_up_kbps / 1024} / ${pkg.speed_down_kbps / 1024} Mbps` 
                        : 'Unlimited'}
                    </td>
                    <td>
                      <span className={`badge ${pkg.active !== false ? 'badge-success' : 'badge-danger'}`}>
                        {pkg.active !== false ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="text-right" style={{ display: 'flex', justifyContent: 'flex-end', gap: '8px', alignItems: 'center' }}>
                      <button onClick={() => openEditModal(pkg)} className="btn btn-secondary btn-sm" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <Edit2 size={12} /> Edit
                      </button>
                      <button onClick={() => handleDelete(pkg.id)} className="btn btn-danger btn-sm" style={{ display: 'flex', gap: '4px', alignItems: 'center' }}>
                        <Trash2 size={12} /> Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Package Form Modal */}
      {showModal && (
        <div className="modal-overlay">
          <div className="modal">
            <h2 className="modal-title">{editingId ? 'Modify Package' : 'Create Package'}</h2>
            
            <form onSubmit={handleSubmit}>
              <div className="form-group">
                <label>Package Name</label>
                <input 
                  type="text" 
                  placeholder="e.g. 1 Hour Unlimited" 
                  required 
                  value={formName} 
                  onChange={(e) => setFormName(e.target.value)} 
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Price (KES)</label>
                  <input 
                    type="number" 
                    required 
                    min="1" 
                    value={formPrice} 
                    onChange={(e) => setFormPrice(Number(e.target.value))} 
                  />
                </div>
                <div className="form-group">
                  <label>Duration (Hours)</label>
                  <input 
                    type="number" 
                    required 
                    min="0.01" 
                    step="0.01" 
                    value={formDuration} 
                    onChange={(e) => setFormDuration(Number(e.target.value))} 
                  />
                </div>
              </div>

              <div className="form-group">
                <label>Data Limit (MB) — Leave blank for unlimited</label>
                <input 
                  type="number" 
                  placeholder="Unlimited" 
                  value={formDataLimit} 
                  onChange={(e) => setFormDataLimit(e.target.value === '' ? '' : Number(e.target.value))} 
                />
              </div>

              <div className="form-row">
                <div className="form-group">
                  <label>Upload Speed (Mbps)</label>
                  <input 
                    type="number" 
                    step="any"
                    placeholder="e.g. 1" 
                    value={formSpeedUp} 
                    onChange={(e) => setFormSpeedUp(e.target.value === '' ? '' : Number(e.target.value))} 
                  />
                </div>
                <div className="form-group">
                  <label>Download Speed (Mbps)</label>
                  <input 
                    type="number" 
                    step="any"
                    placeholder="e.g. 2" 
                    value={formSpeedDown} 
                    onChange={(e) => setFormSpeedDown(e.target.value === '' ? '' : Number(e.target.value))} 
                  />
                </div>
              </div>

              <div className="form-group" style={{ display: 'flex', alignItems: 'center', gap: '8px', marginTop: '12px' }}>
                <input 
                  type="checkbox" 
                  id="active-toggle" 
                  checked={formActive} 
                  onChange={(e) => setFormActive(e.target.checked)} 
                  style={{ width: 'auto' }}
                />
                <label htmlFor="active-toggle" style={{ marginBottom: 0, cursor: 'pointer' }}>Active (Show on portal)</label>
              </div>

              <div className="modal-footer">
                <button type="button" onClick={() => setShowModal(false)} className="btn btn-secondary">
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary">
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}

export default Packages;
