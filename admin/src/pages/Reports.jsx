import React, { useState, useEffect } from 'react';
import { auth } from '../firebase';
import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
} from 'chart.js';
import { Line } from 'react-chartjs-2';

// Register Chart.js components
ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Title,
  Tooltip,
  Legend,
  Filler
);

function Reports() {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    async function fetchReports() {
      try {
        const user = auth.currentUser;
        if (!user) throw new Error("Operator not authenticated");

        const token = await user.getIdToken();
        const response = await fetch('/api/reports/daily', {
          headers: {
            'Authorization': `Bearer ${token}`
          }
        });

        const result = await response.json();

        if (result.success) {
          setReportData(result.data);
        } else {
          throw new Error(result.error || 'Failed to fetch daily reports');
        }
      } catch (err) {
        console.error("Reports Load Error:", err);
        setError(err.message);
      } finally {
        setLoading(false);
      }
    }

    fetchReports();
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', height: '60vh', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ width: '32px', height: '32px', borderRadius: '50%', border: '3px solid rgba(99,102,241,0.1)', borderTopColor: '#6366f1', animation: 'spin 1s infinite linear' }}></div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="panel" style={{ color: 'var(--error)', backgroundColor: 'var(--error-glow)', border: '1px solid rgba(239,68,68,0.2)' }}>
        <h3>Error Loading Reports</h3>
        <p>{error}</p>
        <button onClick={() => window.location.reload()} className="btn btn-secondary btn-sm" style={{ marginTop: '12px' }}>Retry</button>
      </div>
    );
  }

  // Set up chart data configurations
  const labels = reportData?.daily_breakdown?.map(item => item.date) || [];
  const revenues = reportData?.daily_breakdown?.map(item => item.revenue) || [];
  const counts = reportData?.daily_breakdown?.map(item => item.count) || [];

  const chartData = {
    labels: labels.length > 0 ? labels : ['No Data'],
    datasets: [
      {
        fill: true,
        label: 'Daily Revenue (KES)',
        data: revenues.length > 0 ? revenues : [0],
        borderColor: '#6366f1',
        backgroundColor: 'rgba(99, 102, 241, 0.1)',
        tension: 0.3,
        borderWidth: 3,
        pointBackgroundColor: '#6366f1',
        pointHoverRadius: 6
      }
    ]
  };

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: {
        display: false // Hide legend to keep layout minimal
      },
      tooltip: {
        padding: 12,
        backgroundColor: '#111827',
        titleFont: { size: 14, weight: 'bold', family: 'Plus Jakarta Sans' },
        bodyFont: { size: 13, family: 'Plus Jakarta Sans' },
        borderColor: '#374151',
        borderWidth: 1,
        callbacks: {
          label: function(context) {
            return `Revenue: KES ${context.parsed.y.toLocaleString()}`;
          }
        }
      }
    },
    scales: {
      x: {
        grid: {
          color: '#1f2937'
        },
        ticks: {
          color: '#9ca3af',
          font: { family: 'Plus Jakarta Sans', size: 11 }
        }
      },
      y: {
        grid: {
          color: '#1f2937'
        },
        ticks: {
          color: '#9ca3af',
          font: { family: 'Plus Jakarta Sans', size: 11 },
          callback: function(value) {
            return 'KES ' + value.toLocaleString();
          }
        }
      }
    }
  };

  const summary = reportData?.summary || {
    total_revenue_30_days: 0,
    total_payments_30_days: 0,
    active_sessions: 0,
    unused_vouchers: 0
  };

  return (
    <div>
      <div className="page-header">
        <div>
          <h1>Daily Reports</h1>
          <p>Analyze performance metrics, revenue growth, and asset utilization.</p>
        </div>
      </div>

      {/* Stats Summary Panel */}
      <div className="stats-grid">
        <div className="stat-card">
          <span className="stat-label">Total Revenue (30 Days)</span>
          <span className="stat-val" style={{ color: 'var(--success)' }}>
            KES {summary.total_revenue_30_days.toLocaleString()}
          </span>
        </div>
        <div className="stat-card">
          <span className="stat-label">Total Checkout volume</span>
          <span className="stat-val">{summary.total_payments_30_days}</span>
        </div>
        <div className="stat-card warning">
          <span className="stat-label">Unused Vouchers (Asset stock)</span>
          <span className="stat-val">{summary.unused_vouchers}</span>
        </div>
      </div>

      {/* Chart Panel */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Revenue Trend Graph (Last 30 Days)</span>
        </div>
        <div className="chart-container">
          <Line data={chartData} options={chartOptions} />
        </div>
      </div>

      {/* Detailed Aggregation List */}
      <div className="panel">
        <div className="panel-header">
          <span className="panel-title">Daily Statistics Audit Table</span>
        </div>
        <div className="table-container">
          {labels.length === 0 ? (
            <p className="text-center" style={{ color: 'var(--text-muted)', padding: '24px 0' }}>No transactional trends to aggregate yet.</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Successful Payments Volume</th>
                  <th>Revenue (KES)</th>
                </tr>
              </thead>
              <tbody>
                {[...reportData.daily_breakdown].reverse().map((day) => (
                  <tr key={day.date}>
                    <td><strong>{day.date}</strong></td>
                    <td>{day.count} checkouts</td>
                    <td style={{ fontWeight: 700, color: 'var(--success)' }}>
                      KES {day.revenue.toLocaleString()}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

export default Reports;
