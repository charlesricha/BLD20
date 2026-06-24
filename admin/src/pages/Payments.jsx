import React, { useState, useEffect } from 'react';
import { collection, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

function Payments() {
  const [payments, setPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // Listen to payments collection
    const unsubscribe = onSnapshot(collection(db, 'payments'), (snapshot) => {
      const payList = [];
      snapshot.forEach(doc => {
        payList.push({ id: doc.id, ...doc.data() });
      });
      
      // Sort payments by created_at descending
      payList.sort((a, b) => {
        const dateA = a.created_at ? a.created_at.toDate() : new Date(0);
        const dateB = b.created_at ? b.created_at.toDate() : new Date(0);
        return dateB - dateA;
      });

      // Keep only last 150 payments for performance
      setPayments(payList.slice(0, 150));
      setLoading(false);
    }, (error) => {
      console.error("Error loading payments:", error);
    });

    return () => unsubscribe();
  }, []);

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
          <h1>Payments Log</h1>
          <p>Historical audit log of M-Pesa STK push checkouts and voucher activations.</p>
        </div>
      </div>

      <div className="panel">
        <div className="table-container">
          {payments.length === 0 ? (
            <p className="text-center" style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No transactions found in the database.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Payment ID (Checkout Ref)</th>
                  <th>M-Pesa Receipt</th>
                  <th>Phone Number</th>
                  <th>Amount</th>
                  <th>MAC Address</th>
                  <th>Date Initiated</th>
                  <th>Confirmed Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => {
                  const createdDate = p.created_at ? p.created_at.toDate().toLocaleString() : 'N/A';
                  const confirmedDate = p.confirmed_at ? p.confirmed_at.toDate().toLocaleString() : '-';
                  
                  return (
                    <tr key={p.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: '11px', fontWeight: 600 }}>{p.payment_id}</td>
                      <td style={{ fontFamily: 'monospace', fontWeight: 'bold', color: 'var(--success)' }}>
                        {p.mpesa_ref || '-'}
                      </td>
                      <td>{p.phone_number || 'Voucher Redeemed'}</td>
                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>KES {p.amount}</td>
                      <td style={{ fontFamily: 'monospace' }}>{p.mac_address.toUpperCase()}</td>
                      <td style={{ fontSize: '13px' }}>{createdDate}</td>
                      <td style={{ fontSize: '13px' }}>{confirmedDate}</td>
                      <td>
                        <span className={`badge ${
                          p.status === 'success' ? 'badge-success' :
                          p.status === 'pending' ? 'badge-pending' : 'badge-danger'
                        }`}>
                          {p.status}
                        </span>
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

export default Payments;
