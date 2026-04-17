import React, { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  PieChart, Pie, Cell, LineChart, Line, ResponsiveContainer
} from 'recharts';
import {
  fetchTransactions, fetchMismatches, fetchAnalytics,
  fetchRuns, triggerReconcile, simulateTransactions
} from './api/client';

// ── Colors ───────────────────────────────────────────────────
const COLORS = {
  primary:   '#6366f1',
  success:   '#22c55e',
  warning:   '#f59e0b',
  danger:    '#ef4444',
  muted:     '#94a3b8',
  bg:        '#0f172a',
  card:      '#1e293b',
  border:    '#334155',
  text:      '#f1f5f9',
  textMuted: '#94a3b8',
};

const MISMATCH_COLORS = {
  AMOUNT_MISMATCH:  '#ef4444',
  STATUS_MISMATCH:  '#f59e0b',
  MISSING_IN_BANK:  '#8b5cf6',
  MISSING_IN_UPI:   '#06b6d4',
  DUPLICATE_CHARGE: '#ec4899',
};

// ── Styles ───────────────────────────────────────────────────
const styles = {
  app: {
    backgroundColor: COLORS.bg, minHeight: '100vh', color: COLORS.text,
    fontFamily: "'Inter', -apple-system, sans-serif", padding: '0',
  },
  header: {
    backgroundColor: COLORS.card, borderBottom: `1px solid ${COLORS.border}`,
    padding: '16px 32px', display: 'flex', alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: { fontSize: '20px', fontWeight: '700', color: COLORS.text, margin: 0 },
  headerSub: { fontSize: '13px', color: COLORS.textMuted, margin: '2px 0 0 0' },
  main: { padding: '24px 32px', maxWidth: '1400px', margin: '0 auto' },
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '20px', marginBottom: '20px' },
  grid4: { display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '16px', marginBottom: '24px' },
  card: {
    backgroundColor: COLORS.card, borderRadius: '12px',
    border: `1px solid ${COLORS.border}`, padding: '20px',
  },
  cardTitle: { fontSize: '14px', color: COLORS.textMuted, margin: '0 0 8px 0', fontWeight: '500' },
  statValue: { fontSize: '32px', fontWeight: '700', color: COLORS.text, margin: 0 },
  statSub: { fontSize: '12px', color: COLORS.textMuted, marginTop: '4px' },
  sectionTitle: { fontSize: '16px', fontWeight: '600', marginBottom: '16px', color: COLORS.text },
  btn: {
    padding: '8px 16px', borderRadius: '8px', border: 'none',
    cursor: 'pointer', fontSize: '13px', fontWeight: '500',
    transition: 'opacity 0.2s',
  },
  btnPrimary: { backgroundColor: COLORS.primary, color: '#fff' },
  btnSuccess: { backgroundColor: COLORS.success, color: '#fff' },
  btnDanger:  { backgroundColor: COLORS.danger,  color: '#fff' },
  table: { width: '100%', borderCollapse: 'collapse', fontSize: '13px' },
  th: {
    textAlign: 'left', padding: '10px 12px', color: COLORS.textMuted,
    borderBottom: `1px solid ${COLORS.border}`, fontWeight: '500',
  },
  td: { padding: '10px 12px', borderBottom: `1px solid ${COLORS.border}`, color: COLORS.text },
  badge: {
    padding: '2px 8px', borderRadius: '999px', fontSize: '11px', fontWeight: '600',
  },
  tabs: { display: 'flex', gap: '4px', marginBottom: '24px' },
  tab: {
    padding: '8px 16px', borderRadius: '8px', border: 'none',
    cursor: 'pointer', fontSize: '13px', fontWeight: '500',
    backgroundColor: 'transparent', color: COLORS.textMuted,
  },
  tabActive: { backgroundColor: COLORS.primary, color: '#fff' },
};

// ── Helper Components ─────────────────────────────────────────

const Badge = ({ status }) => {
  const colors = {
    PENDING:           { bg: '#f59e0b22', color: '#f59e0b' },
    AUTO_RESOLVED:     { bg: '#22c55e22', color: '#22c55e' },
    MANUALLY_RESOLVED: { bg: '#6366f122', color: '#6366f1' },
    UNRESOLVABLE:      { bg: '#ef444422', color: '#ef4444' },
    SUCCESS:           { bg: '#22c55e22', color: '#22c55e' },
    FAILED:            { bg: '#ef444422', color: '#ef4444' },
    REVERSED:          { bg: '#8b5cf622', color: '#8b5cf6' },
    RUNNING:           { bg: '#06b6d422', color: '#06b6d4' },
    COMPLETED:         { bg: '#22c55e22', color: '#22c55e' },
  };
  const c = colors[status] || { bg: '#33415522', color: '#94a3b8' };
  return (
    <span style={{ ...styles.badge, backgroundColor: c.bg, color: c.color }}>
      {status}
    </span>
  );
};

const StatCard = ({ title, value, sub, color }) => (
  <div style={styles.card}>
    <p style={styles.cardTitle}>{title}</p>
    <p style={{ ...styles.statValue, color: color || COLORS.text }}>{value}</p>
    {sub && <p style={styles.statSub}>{sub}</p>}
  </div>
);

// ── Main App ──────────────────────────────────────────────────

export default function App() {
  const [tab, setTab] = useState('overview');
  const [transactions, setTransactions] = useState([]);
  const [mismatches, setMismatches]     = useState([]);
  const [analytics, setAnalytics]       = useState([]);
  const [runs, setRuns]                 = useState([]);
  const [loading, setLoading]           = useState(false);
  const [message, setMessage]           = useState('');
  const [stats, setStats]               = useState({
    total: 0, mismatched: 0, autoResolved: 0, pending: 0,
  });

  const loadData = useCallback(async () => {
    try {
      const [txnData, mismatchData, analyticsData, runsData] = await Promise.all([
        fetchTransactions(20),
        fetchMismatches(20),
        fetchAnalytics(),
        fetchRuns(),
      ]);
      setTransactions(txnData.data || []);
      setMismatches(mismatchData.data || []);
      setAnalytics(analyticsData.data || []);
      setRuns(runsData.data || []);

      const m = mismatchData.data || [];
      setStats({
        total:        txnData.data?.length || 0,
        mismatched:   m.length,
        autoResolved: m.filter(x => x.resolution_status === 'AUTO_RESOLVED').length,
        pending:      m.filter(x => x.resolution_status === 'PENDING').length,
      });
    } catch (e) {
      console.error('Failed to load data:', e);
    }
  }, []);

  useEffect(() => { loadData(); const t = setInterval(loadData, 10000); return () => clearInterval(t); }, [loadData]);

  const handleReconcile = async () => {
    setLoading(true);
    setMessage('');
    try {
      const result = await triggerReconcile();
      setMessage(`✅ Reconciled: ${result.result?.processed || 0} transactions, ${result.result?.mismatches || 0} mismatches found`);
      await loadData();
    } catch (e) {
      setMessage('❌ Reconciliation failed');
    } finally { setLoading(false); }
  };

  const handleSimulate = async () => {
    setLoading(true);
    setMessage('');
    try {
      const result = await simulateTransactions(10);
      setMessage(`📤 ${result.message}`);
      setTimeout(loadData, 2000);
    } catch (e) {
      setMessage('❌ Simulation failed');
    } finally { setLoading(false); }
  };

  // Build chart data from analytics
  const mismatchTypeData = analytics.reduce((acc, row) => {
    const existing = acc.find(r => r.type === row.mismatch_type);
    if (existing) existing.count += parseInt(row.total);
    else acc.push({ type: row.mismatch_type, count: parseInt(row.total) });
    return acc;
  }, []);

  const resolutionData = [
    { name: 'Auto Resolved', value: stats.autoResolved, color: COLORS.success },
    { name: 'Pending',       value: stats.pending,      color: COLORS.warning },
    { name: 'Clean',         value: Math.max(0, stats.total - stats.mismatched), color: COLORS.primary },
  ].filter(d => d.value > 0);

  return (
    <div style={styles.app}>
      {/* Header */}
      <div style={styles.header}>
        <div>
          <h1 style={styles.headerTitle}>⚡ Reconciliation Engine</h1>
          <p style={styles.headerSub}>Distributed Transaction Mismatch Detection & Auto-Resolution</p>
        </div>
        <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
          {message && (
            <span style={{ fontSize: '13px', color: COLORS.textMuted, maxWidth: '400px' }}>
              {message}
            </span>
          )}
          <button
            style={{ ...styles.btn, ...styles.btnSuccess }}
            onClick={handleSimulate}
            disabled={loading}
          >
            {loading ? '...' : '📤 Simulate Transactions'}
          </button>
          <button
            style={{ ...styles.btn, ...styles.btnPrimary }}
            onClick={handleReconcile}
            disabled={loading}
          >
            {loading ? 'Running...' : '⚡ Run Reconciliation'}
          </button>
        </div>
      </div>

      <div style={styles.main}>
        {/* Stat Cards */}
        <div style={styles.grid4}>
          <StatCard title="Total Transactions" value={stats.total} sub="In canonical view" />
          <StatCard title="Mismatches Detected" value={stats.mismatched} color={COLORS.warning} sub="Across all sources" />
          <StatCard title="Auto-Resolved" value={stats.autoResolved} color={COLORS.success} sub="By rule engine" />
          <StatCard title="Pending Review" value={stats.pending} color={COLORS.danger} sub="Needs attention" />
        </div>

        {/* Tabs */}
        <div style={styles.tabs}>
          {['overview', 'transactions', 'mismatches', 'runs'].map(t => (
            <button
              key={t}
              style={{ ...styles.tab, ...(tab === t ? styles.tabActive : {}) }}
              onClick={() => setTab(t)}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </div>

        {/* Overview Tab */}
        {tab === 'overview' && (
          <>
            <div style={styles.grid2}>
              {/* Mismatch Types Chart */}
              <div style={styles.card}>
                <p style={styles.sectionTitle}>Mismatches by Type</p>
                {mismatchTypeData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <BarChart data={mismatchTypeData}>
                      <CartesianGrid strokeDasharray="3 3" stroke={COLORS.border} />
                      <XAxis dataKey="type" tick={{ fill: COLORS.textMuted, fontSize: 10 }} />
                      <YAxis tick={{ fill: COLORS.textMuted, fontSize: 11 }} />
                      <Tooltip contentStyle={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}`, borderRadius: '8px' }} />
                      <Bar dataKey="count" fill={COLORS.primary} radius={[4, 4, 0, 0]}>
                        {mismatchTypeData.map((entry, i) => (
                          <Cell key={i} fill={Object.values(MISMATCH_COLORS)[i % 5]} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.textMuted }}>
                    No mismatch data yet. Click "Simulate Transactions" then "Run Reconciliation".
                  </div>
                )}
              </div>

              {/* Resolution Pie Chart */}
              <div style={styles.card}>
                <p style={styles.sectionTitle}>Resolution Status</p>
                {resolutionData.length > 0 ? (
                  <ResponsiveContainer width="100%" height={220}>
                    <PieChart>
                      <Pie data={resolutionData} cx="50%" cy="50%" outerRadius={80} dataKey="value" label={({ name, value }) => `${name}: ${value}`}>
                        {resolutionData.map((entry, i) => (
                          <Cell key={i} fill={entry.color} />
                        ))}
                      </Pie>
                      <Tooltip contentStyle={{ backgroundColor: COLORS.card, border: `1px solid ${COLORS.border}` }} />
                    </PieChart>
                  </ResponsiveContainer>
                ) : (
                  <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: COLORS.textMuted }}>
                    No data yet
                  </div>
                )}
              </div>
            </div>

            {/* Recent Runs */}
            <div style={styles.card}>
              <p style={styles.sectionTitle}>Recent Reconciliation Runs</p>
              <table style={styles.table}>
                <thead>
                  <tr>
                    <th style={styles.th}>Run ID</th>
                    <th style={styles.th}>Started</th>
                    <th style={styles.th}>Processed</th>
                    <th style={styles.th}>Mismatches</th>
                    <th style={styles.th}>Auto-Resolved</th>
                    <th style={styles.th}>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {runs.length === 0 ? (
                    <tr><td colSpan={6} style={{ ...styles.td, textAlign: 'center', color: COLORS.textMuted }}>No runs yet</td></tr>
                  ) : runs.map(run => (
                    <tr key={run.id}>
                      <td style={styles.td}>{run.id.slice(0, 8)}...</td>
                      <td style={styles.td}>{new Date(run.started_at).toLocaleTimeString()}</td>
                      <td style={styles.td}>{run.transactions_processed}</td>
                      <td style={styles.td}>{run.mismatches_found}</td>
                      <td style={styles.td}>{run.auto_resolved}</td>
                      <td style={styles.td}><Badge status={run.status} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </>
        )}

        {/* Transactions Tab */}
        {tab === 'transactions' && (
          <div style={styles.card}>
            <p style={styles.sectionTitle}>Canonical Transactions</p>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Transaction ID</th>
                  <th style={styles.th}>App Status</th>
                  <th style={styles.th}>Bank Status</th>
                  <th style={styles.th}>UPI Status</th>
                  <th style={styles.th}>App Amount</th>
                  <th style={styles.th}>Bank Amount</th>
                  <th style={styles.th}>Reconciled</th>
                </tr>
              </thead>
              <tbody>
                {transactions.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: COLORS.textMuted }}>No transactions yet — click Simulate</td></tr>
                ) : transactions.map(txn => (
                  <tr key={txn.id}>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '11px' }}>{txn.transactionId}</td>
                    <td style={styles.td}>{txn.appStatus ? <Badge status={txn.appStatus} /> : '—'}</td>
                    <td style={styles.td}>{txn.bankStatus ? <Badge status={txn.bankStatus} /> : <span style={{ color: COLORS.danger }}>MISSING</span>}</td>
                    <td style={styles.td}>{txn.upiStatus ? <Badge status={txn.upiStatus} /> : <span style={{ color: COLORS.warning }}>MISSING</span>}</td>
                    <td style={styles.td}>₹{txn.appAmount || '—'}</td>
                    <td style={styles.td}>{txn.bankAmount ? `₹${txn.bankAmount}` : '—'}</td>
                    <td style={styles.td}>
                      <span style={{ color: txn.isReconciled ? COLORS.success : COLORS.warning }}>
                        {txn.isReconciled ? '✓ Yes' : '○ No'}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Mismatches Tab */}
        {tab === 'mismatches' && (
          <div style={styles.card}>
            <p style={styles.sectionTitle}>Detected Mismatches</p>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>Transaction ID</th>
                  <th style={styles.th}>Type</th>
                  <th style={styles.th}>Source A</th>
                  <th style={styles.th}>Source B</th>
                  <th style={styles.th}>Value A</th>
                  <th style={styles.th}>Value B</th>
                  <th style={styles.th}>Resolution</th>
                  <th style={styles.th}>Detected</th>
                </tr>
              </thead>
              <tbody>
                {mismatches.length === 0 ? (
                  <tr><td colSpan={8} style={{ ...styles.td, textAlign: 'center', color: COLORS.textMuted }}>No mismatches detected yet</td></tr>
                ) : mismatches.map(m => (
                  <tr key={m.id}>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '11px' }}>{m.transaction_id?.slice(0, 20)}...</td>
                    <td style={styles.td}>
                      <span style={{ ...styles.badge, backgroundColor: `${MISMATCH_COLORS[m.mismatch_type] || '#666'}22`, color: MISMATCH_COLORS[m.mismatch_type] || '#666' }}>
                        {m.mismatch_type}
                      </span>
                    </td>
                    <td style={styles.td}>{m.source_a || '—'}</td>
                    <td style={styles.td}>{m.source_b || '—'}</td>
                    <td style={styles.td}>{m.value_a || '—'}</td>
                    <td style={styles.td}>{m.value_b || '—'}</td>
                    <td style={styles.td}><Badge status={m.resolution_status} /></td>
                    <td style={styles.td}>{new Date(m.detected_at).toLocaleTimeString()}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Runs Tab */}
        {tab === 'runs' && (
          <div style={styles.card}>
            <p style={styles.sectionTitle}>Reconciliation Run History</p>
            <table style={styles.table}>
              <thead>
                <tr>
                  <th style={styles.th}>ID</th>
                  <th style={styles.th}>Started</th>
                  <th style={styles.th}>Completed</th>
                  <th style={styles.th}>Processed</th>
                  <th style={styles.th}>Mismatches</th>
                  <th style={styles.th}>Auto-Resolved</th>
                  <th style={styles.th}>Status</th>
                </tr>
              </thead>
              <tbody>
                {runs.length === 0 ? (
                  <tr><td colSpan={7} style={{ ...styles.td, textAlign: 'center', color: COLORS.textMuted }}>No runs yet</td></tr>
                ) : runs.map(run => (
                  <tr key={run.id}>
                    <td style={{ ...styles.td, fontFamily: 'monospace', fontSize: '11px' }}>{run.id.slice(0, 8)}...</td>
                    <td style={styles.td}>{new Date(run.started_at).toLocaleString()}</td>
                    <td style={styles.td}>{run.completed_at ? new Date(run.completed_at).toLocaleTimeString() : '—'}</td>
                    <td style={styles.td}>{run.transactions_processed}</td>
                    <td style={styles.td}>{run.mismatches_found}</td>
                    <td style={styles.td}>{run.auto_resolved}</td>
                    <td style={styles.td}><Badge status={run.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
