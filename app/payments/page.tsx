"use client";

import { useEffect, useState } from 'react';
import { parseJsonResponse } from '@/lib/apiClient';

export default function PaymentsPage() {
  const [form, setForm] = useState({ periodName: '', startDate: '', endDate: '', workDays: 26, teamTargetAchieved: false });
  const [assumptions, setAssumptions] = useState<any[]>([]);
  const [results, setResults] = useState<any[]>([]);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const assumptionMap = Object.fromEntries(assumptions.map((a: any) => [a.key, a.value]));

  async function loadAssumptions() {
    setError('');
    try {
      const data = await fetch('/api/payments/assumptions').then(parseJsonResponse);
      setAssumptions(data.assumptions || []);
    } catch (error: any) {
      setError(error.message || 'Failed to load payment assumptions');
    }
  }
  useEffect(() => { loadAssumptions(); }, []);

  async function saveAssumptions() {
    setMessage(''); setError('');
    try {
      const res = await fetch('/api/payments/assumptions', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ assumptions }) });
      await parseJsonResponse(res);
      setMessage('Assumptions saved.');
    } catch (error: any) {
      setError(error.message || 'Failed to save assumptions');
    }
  }

  async function calculate(e: React.FormEvent) {
    e.preventDefault(); setMessage(''); setError(''); setResults([]);
    try {
      const res = await fetch('/api/payments/calculate', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const data = await parseJsonResponse(res);
      setResults(data.results || []); setMessage('Payment period calculated. Review flags before approval.');
    } catch (error: any) {
      setError(error.message || 'Failed to calculate');
    }
  }

  return (
    <>
      <div className="hero">
        <h1 style={{ marginTop: 0, color: 'var(--fhdc-blue-dark)' }}>Recall Staff Payment Engine</h1>
        <p className="note">Payments are calculated from unique patients called, verified bookings, matured bookings, attended patients, data quality controls and editable assumptions.</p>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        <div className="card half">
          <h3>Payment Assumptions</h3>
          {error && <div className="alert error">{error}</div>}
          {message && <div className="alert success">{message}</div>}
          <div className="assumption-tables">
            <div className="mini-table-block">
              <h4>Booking Conversion Bonus Table</h4>
              <div className="table-wrap compact-table"><table><thead><tr><th>Minimum conversion</th><th>Bonus</th></tr></thead><tbody>
                <tr><td>0%</td><td>0</td></tr>
                <tr><td>5%</td><td>{Number(assumptionMap.conversion_bonus_5_percent || 1000).toLocaleString()}</td></tr>
                <tr><td>8%</td><td>{Number(assumptionMap.conversion_bonus_8_percent || 2000).toLocaleString()}</td></tr>
                <tr><td>10%</td><td>{Number(assumptionMap.conversion_bonus_10_percent || 4000).toLocaleString()}</td></tr>
                <tr><td>12.5%</td><td>{Number(assumptionMap.conversion_bonus_12_5_percent || 6000).toLocaleString()}</td></tr>
              </tbody></table></div>
            </div>

            <div className="mini-table-block">
              <h4>Show Up Quality Gate</h4>
              <div className="table-wrap compact-table"><table><thead><tr><th>Minimum show up rate</th><th>Booking bonus multiplier</th></tr></thead><tbody>
                <tr><td>0%</td><td>0%</td></tr>
                <tr><td>40%</td><td>{(Number(assumptionMap.show_up_multiplier_40_percent || 0.5) * 100).toFixed(0)}%</td></tr>
                <tr><td>50%</td><td>{(Number(assumptionMap.show_up_multiplier_50_percent || 0.75) * 100).toFixed(0)}%</td></tr>
                <tr><td>60%</td><td>{(Number(assumptionMap.show_up_multiplier_60_percent || 1) * 100).toFixed(0)}%</td></tr>
              </tbody></table></div>
            </div>
          </div>
          <div className="form-grid">
            {assumptions.map((a, idx) => <div className="form-field" key={a.key}><label>{a.label}</label><input value={a.value} onChange={e => { const copy=[...assumptions]; copy[idx]={...copy[idx], value:e.target.value}; setAssumptions(copy); }} /></div>)}
            {assumptions.length === 0 && <div className="form-field full note">No assumptions loaded yet.</div>}
            <div className="form-field full"><button onClick={saveAssumptions}>Save Assumptions</button></div>
          </div>
        </div>

        <div className="card half">
          <h3>Calculate Payment Period</h3>
          <form onSubmit={calculate} className="form-grid">
            <div className="form-field full"><label>Period name</label><input value={form.periodName} onChange={e => setForm({...form, periodName:e.target.value})} required placeholder="June 2026 Recall Pay" /></div>
            <div className="form-field"><label>Start date</label><input type="date" value={form.startDate} onChange={e => setForm({...form, startDate:e.target.value})} required /></div>
            <div className="form-field"><label>End date</label><input type="date" value={form.endDate} onChange={e => setForm({...form, endDate:e.target.value})} required /></div>
            <div className="form-field"><label>Work days paid</label><input type="number" value={form.workDays} onChange={e => setForm({...form, workDays:Number(e.target.value)})} required /></div>
            <div className="form-field"><label>Team target achieved?</label><select value={form.teamTargetAchieved ? 'yes':'no'} onChange={e => setForm({...form, teamTargetAchieved:e.target.value==='yes'})}><option value="no">No</option><option value="yes">Yes</option></select></div>
            <div className="form-field full"><button>Calculate Payments</button></div>
          </form>
        </div>

        <div className="card full">
          <h3>Payment Results</h3>
          <div className="table-wrap"><table><thead><tr><th>Staff</th><th>Unique Called</th><th>Verified Bookings</th><th>Attended</th><th>Conversion</th><th>Show Up</th><th>Base</th><th>Incentive</th><th>Total Pay</th><th>Flags</th></tr></thead><tbody>
            {results.length === 0 && <tr><td colSpan={10}>No payment calculation yet.</td></tr>}
            {results.map((r: any) => <tr key={r.id}><td>{r.stats.staff.name}</td><td>{r.stats.uniquePatientsCalled}</td><td>{r.stats.verifiedBookings}</td><td>{r.stats.attendedPatients}</td><td>{(r.stats.conversionRate*100).toFixed(1)}%</td><td>{(r.stats.showUpRate*100).toFixed(1)}%</td><td>{Number(r.base_pay).toLocaleString()}</td><td>{Number(r.incentive_after_cap).toLocaleString()}</td><td><strong>{Number(r.total_pay).toLocaleString()}</strong></td><td>{(r.payment_flags || []).map((f: string) => <div key={f}><span className="badge orange">{f}</span></div>)}</td></tr>)}
          </tbody></table></div>
        </div>
      </div>
    </>
  );
}
