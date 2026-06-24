import React, { useState, useEffect } from 'react';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db, auth } from '../firebase';

function Vouchers() {
  const [packages, setPackages] = useState([]);
  const [vouchers, setVouchers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);

  // Form State
  const [selectedPackageId, setSelectedPackageId] = useState('');
  const [generateCount, setGenerateCount] = useState(10);
  const [newBatch, setNewBatch] = useState(null); // Keep track of latest generated batch to show and print

  useEffect(() => {
    // 1. Fetch active packages for the dropdown selection
    const unsubscribePkgs = onSnapshot(collection(db, 'packages'), (snapshot) => {
      const pkgs = [];
      snapshot.forEach(doc => {
        const d = doc.data();
        if (d.active !== false) {
          pkgs.push({ id: doc.id, ...d });
        }
      });
      setPackages(pkgs);
      if (pkgs.length > 0) setSelectedPackageId(pkgs[0].id);
    });

    // 2. Fetch recent vouchers (last 100)
    const unsubscribeVouchers = onSnapshot(query(collection(db, 'vouchers')), (snapshot) => {
      const vchs = [];
      snapshot.forEach(doc => {
        vchs.push({ id: doc.id, ...doc.data() });
      });
      // Sort by created_at descending
      vchs.sort((a, b) => {
        const dateA = a.created_at ? a.created_at.toDate() : new Date(0);
        const dateB = b.created_at ? b.created_at.toDate() : new Date(0);
        return dateB - dateA;
      });
      setVouchers(vchs.slice(0, 100));
      setLoading(false);
    });

    return () => {
      unsubscribePkgs();
      unsubscribeVouchers();
    };
  }, []);

  const handleGenerate = async (e) => {
    e.preventDefault();
    if (!selectedPackageId || generateCount <= 0) return;

    setGenerating(true);
    setNewBatch(null);

    try {
      const user = auth.currentUser;
      if (!user) throw new Error("Operator user not logged in");
      
      const token = await user.getIdToken();
      
      // Call Admin Cloud Function endpoint to generate batch securely
      const response = await fetch('/api/vouchers/generate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({
          package_id: selectedPackageId,
          count: Number(generateCount)
        })
      });

      const result = await response.json();

      if (result.success) {
        const selectedPkg = packages.find(p => p.id === selectedPackageId);
        setNewBatch({
          vouchers: result.data.vouchers,
          package: selectedPkg
        });
        alert(`Successfully generated ${result.data.count} vouchers!`);
      } else {
        throw new Error(result.error || 'Failed to generate batch');
      }
    } catch (err) {
      console.error(err);
      alert("Error generating vouchers: " + err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handlePrint = () => {
    window.print();
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
          <h1>Vouchers Manager</h1>
          <p>Generate, monitor, and print physical access voucher codes.</p>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '32px', alignItems: 'start' }}>
        
        {/* Left Side: Generator Form */}
        <div className="panel">
          <div className="panel-header">
            <span className="panel-title">Batch Generator</span>
          </div>
          
          <form onSubmit={handleGenerate}>
            <div className="form-group">
              <label>Select WiFi Package</label>
              <select 
                value={selectedPackageId} 
                onChange={(e) => setSelectedPackageId(e.target.value)}
                disabled={packages.length === 0}
              >
                {packages.length === 0 ? (
                  <option>No active packages</option>
                ) : (
                  packages.map(p => (
                    <option key={p.id} value={p.id}>{p.name} - KES {p.price_kes}</option>
                  ))
                )}
              </select>
            </div>

            <div className="form-group">
              <label>Number of Vouchers</label>
              <input 
                type="number" 
                min="1" 
                max="500" 
                value={generateCount} 
                onChange={(e) => setGenerateCount(Number(e.target.value))} 
              />
              <span style={{ fontSize: '11px', color: 'var(--text-muted)' }}>Max 500 per batch execution</span>
            </div>

            <button 
              type="submit" 
              className="btn btn-primary w-full"
              disabled={generating || packages.length === 0}
              style={{ marginTop: '8px' }}
            >
              {generating ? 'Generating...' : '⚡ Generate Batch'}
            </button>
          </form>
        </div>

        {/* Right Side: Print preview of newly generated batch or list of active ones */}
        <div className="panel">
          {newBatch ? (
            <div className="printable-area">
              <div className="panel-header" style={{ borderBottom: '1px solid var(--border)', paddingBottom: '12px' }}>
                <div>
                  <span className="panel-title">Batch Print Preview</span>
                  <div style={{ fontSize: '12px', color: 'var(--text-muted)' }}>WiFi Profile: {newBatch.package.name} (KES {newBatch.package.price_kes})</div>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button onClick={() => setNewBatch(null)} className="btn btn-secondary btn-sm">
                    Clear View
                  </button>
                  <button onClick={handlePrint} className="btn btn-primary btn-sm">
                    🖨️ Print Vouchers
                  </button>
                </div>
              </div>

              {/* Printable Grid */}
              <div className="voucher-print-grid">
                {newBatch.vouchers.map((code) => (
                  <div className="voucher-tag" key={code}>
                    {/* Add visual dash format for easier typing: XXXX-XXXX-XXXX */}
                    {code.replace(/(.{4})/g, '$1-').slice(0, -1)}
                    <div className="voucher-tag-price">
                      VelocityWiFi | KES {newBatch.package.price_kes}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div>
              <div className="panel-header">
                <span className="panel-title">Recent Vouchers log (Last 100)</span>
              </div>
              <div className="table-container">
                {vouchers.length === 0 ? (
                  <p className="text-center" style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No vouchers generated in the system yet.</p>
                ) : (
                  <table style={{ fontSize: '13px' }}>
                    <thead>
                      <tr>
                        <th>Code</th>
                        <th>Package</th>
                        <th>Created</th>
                        <th>Status</th>
                        <th>Redeemed By</th>
                      </tr>
                    </thead>
                    <tbody>
                      {vouchers.map((v) => {
                        const dateStr = v.created_at ? v.created_at.toDate().toLocaleDateString() : 'N/A';
                        const redeemedPkg = packages.find(p => p.id === v.package_id);
                        
                        return (
                          <tr key={v.code}>
                            <td style={{ fontFamily: 'monospace', fontWeight: 'bold' }}>
                              {v.code.replace(/(.{4})/g, '$1-').slice(0, -1)}
                            </td>
                            <td>{redeemedPkg ? redeemedPkg.name : 'Unknown'}</td>
                            <td>{dateStr}</td>
                            <td>
                              <span className={`badge ${v.status === 'unused' ? 'badge-success' : 'badge-danger'}`}>
                                {v.status}
                              </span>
                            </td>
                            <td style={{ fontFamily: 'monospace', fontSize: '12px' }}>
                              {v.used_by_mac || '-'}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

export default Vouchers;
