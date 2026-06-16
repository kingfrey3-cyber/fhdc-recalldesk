'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { parseJsonResponse } from '@/lib/apiClient';

type Dashboard = { metrics: any; recentUploads: any[]; flags: any[] };

export default function DashboardPage() {
  const router = useRouter();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    fetch('/api/dashboard').then(async res => {
      if (res.status === 401) { router.push('/login'); return null; }
      return parseJsonResponse(res);
    }).then(json => { if (json) setData(json); }).catch(e => setError(e.message));
  }, [router]);

  if (error) return <div className="alert error">{error}</div>;
  if (!data) return <div className="alert">Loading FHDC RecallDesk dashboard...</div>;

  const m = data.metrics;
  return (
    <>
      <div className="hero">
        <h1 style={{ marginTop: 0, color: 'var(--fhdc-blue-dark)' }}>Recall Management Dashboard</h1>
        <p className="note">A live view of the clean recall base, assignment progress, call activity, booking verification and data quality controls.</p>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <Metric label="Clean Recall Patients" value={m.patients} />
        <Metric label="Assigned Patients" value={m.assigned} />
        <Metric label="Unassigned Patients" value={m.unassigned} />
        <Metric label="Unique Patients Called" value={m.uniqueCalled} />
        <Metric label="Self Reported Bookings" value={m.selfReportedBookings} />
        <Metric label="Verified Bookings" value={m.verifiedBookings} />
        <Metric label="Attended Patients" value={m.attended} />
        <Metric label="Open Data Flags" value={m.openFlags} />

        <div className="card half">
          <h3>Recent Upload Batches</h3>
          <div className="table-wrap">
            <table><thead><tr><th>Date</th><th>Files</th><th>Raw Rows</th><th>Clean Patients</th></tr></thead><tbody>
              {data.recentUploads.length === 0 && <tr><td colSpan={4}>No upload batches yet.</td></tr>}
              {data.recentUploads.map((u: any) => <tr key={u.id}><td>{new Date(u.created_at).toLocaleString()}</td><td>{u.filename_summary}</td><td>{Number(u.raw_row_count || 0).toLocaleString()}</td><td>{Number(u.clean_patient_count || 0).toLocaleString()}</td></tr>)}
            </tbody></table>
          </div>
        </div>

        <div className="card half">
          <h3>Open Data Quality Flags</h3>
          <div className="table-wrap">
            <table><thead><tr><th>Severity</th><th>Status</th><th>Flag ID</th></tr></thead><tbody>
              {data.flags.length === 0 && <tr><td colSpan={3}>No open flags.</td></tr>}
              {data.flags.slice(0, 10).map((f: any) => <tr key={f.id}><td><span className={`badge ${f.severity === 'critical' || f.severity === 'high' ? 'red' : 'orange'}`}>{f.severity}</span></td><td>{f.status}</td><td>{String(f.id).slice(0, 8)}</td></tr>)}
            </tbody></table>
          </div>
        </div>
      </div>
    </>
  );
}

function Metric({ label, value }: { label: string; value: any }) {
  return <div className="card metric"><div className="value">{Number(value || 0).toLocaleString()}</div><div className="label">{label}</div></div>;
}
