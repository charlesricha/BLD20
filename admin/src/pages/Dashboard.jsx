import React, { useState, useEffect } from 'react';
import { collection, query, where, onSnapshot } from 'firebase/firestore';
import { db } from '../firebase';

function Dashboard() {
  const [stats, setStats] = useState({
    todayRevenue: 0,
    activeSessions: 0,
    vouchersSoldToday: 0,
  });
  const [recentPayments, setRecentPayments] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // 1. Real-time listener for today's revenue (successful payments)
    const paymentsQuery = query(
      collection(db, 'payments'),
      where('status', '==', 'success'),
      where('confirmed_at', '>=', startOfDay)
    );

    const unsubscribePayments = onSnapshot(paymentsQuery, (snapshot) => {
      let revenueSum = 0;
      snapshot.forEach(doc => {
        revenueSum += doc.data().amount || 0;
      });
      setStats(prev => ({ ...prev, todayRevenue: revenueSum }));
    }, (error) => console.error("Error listening to payments:", error));

    // 2. Real-time listener for active sessions
    const sessionsQuery = query(
      collection(db, 'sessions'),
      where('status', '==', 'active')
    );

    const unsubscribeSessions = onSnapshot(sessionsQuery, (snapshot) => {
      const now = new Date();
      let activeCount = 0;
      snapshot.forEach(doc => {
        const session = doc.data();
        if (session.expires_at.toDate() > now) {
          activeCount++;
        }
      });
      setStats(prev => ({ ...prev, activeSessions: activeCount }));
    }, (error) => console.error("Error listening to sessions:", error));

    // 3. Real-time listener for vouchers used/sold today
    const vouchersQuery = query(
      collection(db, 'vouchers'),
      where('status', '==', 'used'),
      where('used_at', '>=', startOfDay)
    );

    const unsubscribeVouchers = onSnapshot(vouchersQuery, (snapshot) => {
      setStats(prev => ({ ...prev, vouchersSoldToday: snapshot.size }));
    }, (error) => console.error("Error listening to vouchers:", error));

    // 4. Real-time listener for 5 most recent payments (all statuses)
    const recentPaymentsQuery = query(
      collection(db, 'payments')
    );

    const unsubscribeRecent = onSnapshot(recentPaymentsQuery, (snapshot) => {
      const sorted = snapshot.docs
        .map(doc => ({ id: doc.id, ...doc.data() }))
        .sort((a, b) => {
          const dateA = a.created_at ? a.created_at.toDate() : new Date(0);
          const dateB = b.created_at ? b.created_at.toDate() : new Date(0);
          return dateB - dateA;
        })
        .slice(0, 5);
      
      setRecentPayments(sorted);
      setLoading(false);
    }, (error) => console.error("Error listening to recent payments:", error));

    return () => {
      unsubscribePayments();
      unsubscribeSessions();
      unsubscribeVouchers();
      unsubscribeRecent();
    };
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
          <h1>Operator Console</h1>
          <p>Real-time system overview and activity stream.</p>
        </div>
      </div>

      {/* Grid of Key Metrics */}
      <div className="stats-grid">
        <div className="stat-card success">
          <span className="stat-label">Revenue Today</span>
          <span className="stat-val">KES {stats.todayRevenue.toLocaleString()}</span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Active Users</span>
          <span className="stat-val">{stats.activeSessions}</span>
        </div>
        <div className="stat-card warning">
          <span className="stat-label">Vouchers Redeemed Today</span>
          <span className="stat-val">{stats.vouchersSoldToday}</span>
        </div>
      </div>

      {/* Recent Payments Feed */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Recent Activity Log</span>
        </div>
        <div className="table-container">
          {recentPayments.length === 0 ? (
            <p className="text-center" style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No transactions recorded yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Phone / Ref</th>
                  <th>Amount</th>
                  <th>MAC Address</th>
                  <th>Date</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {recentPayments.map((payment) => {
                  const dateStr = payment.created_at 
                    ? payment.created_at.toDate().toLocaleString() 
                    : 'Pending';
                  
                  return (
                    <tr key={payment.id}>
                      <td>
                        <div style={{ fontWeight: 700 }}>{payment.phone_number || 'Voucher Redeem'}</div>
                        <div style={{ fontSize: '11px', color: 'var(--text-muted)' }}>{payment.mpesa_ref || payment.payment_id}</div>
                      </td>
                      <td style={{ fontWeight: 700, color: 'var(--primary)' }}>KES {payment.amount}</td>
                      <td style={{ fontFamily: 'monospace' }}>{payment.mac_address}</td>
                      <td>{dateStr}</td>
                      <td>
                        <span className={`badge ${
                          payment.status === 'success' ? 'badge-success' :
                          payment.status === 'pending' ? 'badge-pending' : 'badge-danger'
                        }`}>
                          {payment.status}
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

export default Dashboard;
