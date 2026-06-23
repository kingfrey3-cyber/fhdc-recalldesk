"use client";

import { useEffect, useMemo, useState } from 'react';
import { parseJsonResponse } from '@/lib/apiClient';

const outcomes = ['Booked appointment','Interested but not booked','Call back later','No answer','Switched off','Wrong number','Number not in service','Patient declined','Already visited recently','Not reachable after final attempt','Data correction needed','Do not call'];
const blankCall = { outcome: '', appointmentDate: '', patientFeedback: '', notes: '', nextAction: '', nextActionDate: '' };

function roleLabel(role?: string) {
  return String(role || '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

function toCallForm(call: any) {
  return {
    outcome: call?.outcome || '',
    appointmentDate: call?.appointment_date || '',
    patientFeedback: call?.patient_feedback || '',
    notes: call?.notes || '',
    nextAction: call?.next_action || '',
    nextActionDate: call?.next_action_date || ''
  };
}

function todayIso() { return new Date().toISOString().slice(0, 10); }
function thirtyDaysAgoIso() { const d = new Date(); d.setDate(d.getDate() - 30); return d.toISOString().slice(0, 10); }
function fmtDate(value: any) { return String(value || '').slice(0, 19).replace('T', ' '); }

export default function CallingPage() {
  const [me, setMe] = useState<any>(null);
  const [patients, setPatients] = useState<any[]>([]);
  const [users, setUsers] = useState<any[]>([]);
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('active_queue');
  const [viewMode, setViewMode] = useState<'queue' | 'called' | 'monitor'>('queue');
  const [staffFilter, setStaffFilter] = useState('');
  const [selected, setSelected] = useState<any>(null);
  const [patientCalls, setPatientCalls] = useState<any[]>([]);
  const [editingCall, setEditingCall] = useState<any>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [assigning, setAssigning] = useState(false);
  const [assign, setAssign] = useState<{ staffId: string; staffIds: string[]; count: number; method: 'balanced_round_robin' | 'sequential_block' }>({ staffId: '', staffIds: [], count: 100, method: 'balanced_round_robin' });
  const [call, setCall] = useState(blankCall);
  const [monitor, setMonitor] = useState<any>(null);
  const [monitorDates, setMonitorDates] = useState({ startDate: thirtyDaysAgoIso(), endDate: todayIso() });

  const canManage = useMemo(() => ['admin','manager'].includes(me?.role), [me]);
  const canMonitor = useMemo(() => ['admin','manager','finance'].includes(me?.role), [me]);
  const maxDailyCalls = useMemo(() => Math.max(1, ...(monitor?.dailyTotals || []).map((d: any) => Number(d.calls || 0))), [monitor]);
  const assignmentStaffOptions = useMemo(() => users.filter(u => ['recall_staff','manager'].includes(u.role) && u.is_active !== false), [users]);

  function statusForMode(mode = viewMode) {
    if (mode === 'called') return ['logged', 'called', 'follow_up', 'booked', 'do_not_call'].includes(status) ? status : 'logged';
    if (mode === 'queue') return status && status !== 'logged' ? status : 'active_queue';
    return status && status !== 'logged' ? status : 'active_queue';
  }

  async function load(searchOverride?: string, modeOverride?: 'queue' | 'called' | 'monitor') {
    const activeSearch = searchOverride ?? search;
    const mode = modeOverride ?? viewMode;
    setError('');
    setLoading(true);
    try {
      const meData = await fetch('/api/me', { cache: 'no-store', credentials: 'same-origin' }).then(parseJsonResponse);
      const currentUser = meData.user;
      setMe(currentUser);
      if (!currentUser) throw new Error('You are not logged in. Please log in again.');

      const params = new URLSearchParams();
      params.set('search', activeSearch);
      params.set('status', statusForMode(mode));
      params.set('limit', mode === 'called' ? '500' : '250');
      if (['admin','manager'].includes(currentUser.role) && staffFilter) params.set('staffId', staffFilter);

      const [p, u] = await Promise.all([
        fetch(`/api/patients?${params.toString()}`, { cache: 'no-store', credentials: 'same-origin' }).then(parseJsonResponse),
        fetch('/api/users', { cache: 'no-store', credentials: 'same-origin' }).then(parseJsonResponse)
      ]);
      setPatients(p.patients || []);
      setUsers(u.users || []);
      if (mode === 'monitor' && ['admin','manager','finance'].includes(currentUser.role)) await loadMonitor(currentUser);
    } catch (error: any) {
      setError(error.message || 'Failed to load calling list');
    } finally {
      setLoading(false);
    }
  }

  async function loadMonitor(currentUser = me) {
    if (!currentUser) return;
    const params = new URLSearchParams();
    if (staffFilter && ['admin','manager','finance'].includes(currentUser.role)) params.set('staffId', staffFilter);
    if (monitorDates.startDate) params.set('startDate', monitorDates.startDate);
    if (monitorDates.endDate) params.set('endDate', monitorDates.endDate);
    params.set('limit', '5000');
    const data = await fetch(`/api/calls/summary?${params.toString()}`, { cache: 'no-store', credentials: 'same-origin' }).then(parseJsonResponse);
    setMonitor(data);
  }

  useEffect(() => { load('', 'queue'); }, []);
  useEffect(() => { if (me && viewMode === 'monitor') loadMonitor(); }, [monitorDates.startDate, monitorDates.endDate]);

  function switchMode(mode: 'queue' | 'called' | 'monitor') {
    setViewMode(mode);
    setMessage(''); setError(''); setPatients([]); setSelected(null); setPatientCalls([]); setEditingCall(null);
    if (mode === 'queue') setStatus(status && status !== 'logged' ? status : 'active_queue');
    if (mode === 'called') setStatus('logged');
    load(search, mode);
  }

  function clearSearch() {
    setSearch('');
    load('', viewMode);
  }


  function updateAssignmentCount(rawValue: string) {
    const digitsOnly = rawValue.replace(/\D/g, '');
    const normalized = digitsOnly.replace(/^0+(?=\d)/, '');
    setAssign(current => ({ ...current, count: normalized ? Number(normalized) : 0 }));
  }

  function toggleAssignmentStaff(staffId: string) {
    setAssign(current => {
      const exists = current.staffIds.includes(staffId);
      return {
        ...current,
        staffIds: exists ? current.staffIds.filter(id => id !== staffId) : [...current.staffIds, staffId]
      };
    });
  }

  async function assignBatch(e: React.FormEvent) {
    e.preventDefault();
    if (assigning) return;

    setMessage('');
    setError('');

    const count = Number(assign.count || 0);

    try {
      if (!count || count < 1) {
        setError('Enter the total number of patients to distribute.');
        return;
      }
      if (assign.method === 'balanced_round_robin' && assign.staffIds.length < 2) {
        setError('Balanced round-robin needs at least two selected recall staff.');
        return;
      }
      if (assign.method === 'sequential_block' && !assign.staffId) {
        setError('Select one staff member for sequential block assignment.');
        return;
      }

      setAssigning(true);
      setMessage(assign.method === 'balanced_round_robin' ? 'Assigning balanced batch...' : 'Assigning batch...');

      const payload = {
        method: assign.method,
        staffId: assign.staffId,
        staffIds: assign.staffIds,
        count
      };
      const res = await fetch('/api/patients/assign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) });
      const data = await parseJsonResponse(res);
      const detail = Array.isArray(data.byStaff) && data.byStaff.length
        ? ` (${data.byStaff.map((x: any) => `${x.staff_name || x.staffId}: ${x.assigned}`).join(', ')})`
        : '';
      setMessage(`${data.assigned} patients assigned${detail}. Refreshing assignment view...`);
      setStatus('active_queue'); setViewMode('queue'); await load('', 'queue');
    } catch (error: any) {
      setError(error.message || 'Assignment failed');
    } finally {
      setAssigning(false);
    }
  }

  async function unassignPendingForStaff() {
    setMessage(''); setError('');
    if (!assign.staffId) { setError('Select a staff member first.'); return; }
    if (!confirm('Unassign all pending, unworked patients assigned to this staff member? Worked records remain protected.')) return;
    try {
      const res = await fetch('/api/patients/unassign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ staffId: assign.staffId }) });
      const data = await parseJsonResponse(res);
      setMessage(`${data.unassigned} patients unassigned. ${data.skippedWorked ? `${data.skippedWorked} worked records were protected and skipped.` : ''}`);
      load('', 'queue');
    } catch (error: any) {
      setError(error.message || 'Unassignment failed');
    }
  }

  async function unassignPatient(patient: any) {
    setMessage(''); setError('');
    if (!confirm(`Unassign ${patient.display_name}? This is allowed only if no call has been logged for this patient.`)) return;
    try {
      const res = await fetch('/api/patients/unassign', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ patientIds: [patient.id] }) });
      const data = await parseJsonResponse(res);
      if (data.unassigned) setMessage('Patient unassigned.');
      else setMessage(`No patient was unassigned. ${data.skippedWorked ? 'This patient already has call or booking history and is protected.' : ''}`);
      load(search, viewMode);
    } catch (error: any) {
      setError(error.message || 'Unassignment failed');
    }
  }

  async function openPatient(patient: any) {
    setSelected(patient);
    setEditingCall(null);
    setCall(blankCall);
    setError('');
    try {
      const data = await fetch(`/api/calls?patientId=${encodeURIComponent(patient.id)}&limit=100`, { cache: 'no-store', credentials: 'same-origin' }).then(parseJsonResponse);
      setPatientCalls(data.calls || []);
    } catch (error: any) {
      setPatientCalls([]);
      setError(error.message || 'Failed to load call history');
    }
  }

  async function refreshPatientCalls(patientId = selected?.id) {
    if (!patientId) return;
    const data = await fetch(`/api/calls?patientId=${encodeURIComponent(patientId)}&limit=100`, { cache: 'no-store', credentials: 'same-origin' }).then(parseJsonResponse);
    setPatientCalls(data.calls || []);
  }

  async function saveCall(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setMessage(''); setError('');
    try {
      const url = editingCall ? `/api/calls/${editingCall.id}` : '/api/calls';
      const method = editingCall ? 'PUT' : 'POST';
      const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...call, patientId: selected.id }) });
      await parseJsonResponse(res);
      setMessage(editingCall ? 'Call log updated.' : 'Call saved. Patient moved from active queue to logged calls.');
      setCall(blankCall);
      setEditingCall(null);
      setSelected(null);
      setPatientCalls([]);
      await load(search, viewMode);
      if (viewMode === 'monitor') await loadMonitor();
    } catch (error: any) {
      setError(error.message || 'Failed to save call');
    }
  }

  async function unlogCall(callRow: any) {
    setMessage(''); setError('');
    if (!confirm('Unlog this specific call? If it is the patient’s only call, the patient will return to the active queue.')) return;
    try {
      const patientId = callRow.patient_id || selected?.id;
      const res = await fetch(`/api/calls/${callRow.id}`, { method: 'DELETE', cache: 'no-store' });
      await parseJsonResponse(res);
      const latest = patientId ? await fetch(`/api/calls?patientId=${encodeURIComponent(patientId)}&limit=100`, { cache: 'no-store', credentials: 'same-origin' }).then(parseJsonResponse) : { calls: [] };
      const remaining = latest.calls || [];
      setEditingCall(null);
      setCall(blankCall);
      setPatientCalls(remaining);
      if (remaining.length === 0) {
        setSelected(null);
        setViewMode('queue');
        setStatus('active_queue');
        setMessage('Call log removed. Patient returned to the active queue.');
        await load('', 'queue');
      } else {
        setMessage('Call log removed and patient status recalculated.');
        await load(search, viewMode);
      }
    } catch (error: any) {
      setError(error.message || 'Failed to unlog call');
    }
  }

  async function requeuePatient(patient: any) {
    setMessage(''); setError('');
    if (!confirm(`Return ${patient.display_name} to the active queue? This works only where no call history remains.`)) return;
    try {
      const res = await fetch('/api/patients/requeue', { method: 'POST', headers: { 'Content-Type': 'application/json' }, cache: 'no-store', body: JSON.stringify({ patientId: patient.id }) });
      await parseJsonResponse(res);
      setMessage('Patient returned to the active queue.');
      setViewMode('queue');
      setStatus('active_queue');
      await load('', 'queue');
    } catch (error: any) {
      setError(error.message || 'Failed to return patient to active queue');
    }
  }

  function startEdit(callRow: any) {
    setEditingCall(callRow);
    setCall(toCallForm(callRow));
  }

  function exportCalls() {
    const params = new URLSearchParams();
    if (staffFilter && canMonitor) params.set('staffId', staffFilter);
    if (monitorDates.startDate) params.set('startDate', monitorDates.startDate);
    if (monitorDates.endDate) params.set('endDate', monitorDates.endDate);
    window.location.href = `/api/calls/export?${params.toString()}`;
  }

  return (
    <>
      <div className="hero">
        <h1 style={{ marginTop: 0, color: 'var(--fhdc-blue-dark)' }}>Calling List and Task Allocation</h1>
        <p className="note">Active calling keeps pending patients at the top. Logged patients move to the called view and remain available for monitoring, export, edit and correction.</p>
        {me && <p className="note"><strong>Signed in as:</strong> {me.name} ({roleLabel(me.role)})</p>}
      </div>

      <div className="card" style={{ marginTop: 18 }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'center' }}>
          <button type="button" className={viewMode === 'queue' ? '' : 'ghost'} onClick={() => switchMode('queue')}>Active Calling Queue</button>
          <button type="button" className={viewMode === 'called' ? '' : 'ghost'} onClick={() => switchMode('called')}>Called / Logged Patients</button>
          {canMonitor && <button type="button" className={viewMode === 'monitor' ? '' : 'ghost'} onClick={() => switchMode('monitor')}>Call Monitoring & Export</button>}
          {loading && <span className="note">Loading...</span>}
        </div>
      </div>

      <div className="grid" style={{ marginTop: 18 }}>
        {canManage && viewMode === 'queue' && <div className="card third">
          <h3>Assign Oldest Unassigned Patients</h3>
          <form onSubmit={assignBatch} className="form-grid">
            <div className="form-field full">
              <label>Assignment method</label>
              <select value={assign.method} onChange={e => setAssign({ ...assign, method: e.target.value as any })}>
                <option value="balanced_round_robin">Balanced round-robin — recommended</option>
                <option value="sequential_block">Sequential block assignment</option>
              </select>
              <p className="note" style={{ marginTop: 8 }}>
                Balanced round-robin sorts by oldest last visit first, then alternates patients between selected staff so recall batches are comparable.
              </p>
            </div>

            {assign.method === 'balanced_round_robin' && <div className="form-field full">
              <label>Select recall staff for balanced distribution</label>
              <div className="assignment-staff-grid">
                {assignmentStaffOptions.map(u => {
                  const checked = assign.staffIds.includes(u.id);
                  return <label key={u.id} className={`assignment-staff-option ${checked ? 'selected' : ''}`}>
                    <input type="checkbox" checked={checked} onChange={() => toggleAssignmentStaff(u.id)} />
                    <span>{u.name}</span>
                  </label>;
                })}
              </div>
              <p className="note" style={{ marginTop: 8 }}>{assign.staffIds.length} staff selected. Select at least 2 for balanced round-robin.</p>
            </div>}

            {assign.method === 'sequential_block' && <div className="form-field full">
              <label>Recall staff</label>
              <select value={assign.staffId} onChange={e => setAssign({ ...assign, staffId: e.target.value })}>
                <option value="">Select staff</option>{assignmentStaffOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
              </select>
            </div>}

            <div className="form-field full">
              <label>{assign.method === 'balanced_round_robin' ? 'Total patients to distribute' : 'Number of patients'}</label>
              <input
                type="text"
                inputMode="numeric"
                pattern="[0-9]*"
                value={assign.count ? String(assign.count) : ''}
                onFocus={e => e.currentTarget.select()}
                onChange={e => updateAssignmentCount(e.target.value)}
                placeholder="Enter number, e.g. 100"
              />
            </div>
            <div className="form-field full"><button disabled={assigning}>{assigning ? 'Assigning...' : assign.method === 'balanced_round_robin' ? 'Assign Balanced Batch' : 'Assign Batch'}</button></div>

            <div className="form-field full"><label>Staff for unassignment cleanup</label><select value={assign.staffId} onChange={e => setAssign({ ...assign, staffId: e.target.value })}><option value="">Select staff</option>{assignmentStaffOptions.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <div className="form-field full"><button type="button" className="ghost" onClick={unassignPendingForStaff}>Unassign Pending for Staff</button></div>
            <p className="note full" style={{ marginTop: 0 }}>Unassignment protects patients who already have call, booking or follow-up history.</p>
          </form>
        </div>}

        {viewMode !== 'monitor' && <div className="card" style={{ gridColumn: canManage && viewMode === 'queue' ? 'span 8' : 'span 12' }}>
          <h3>{viewMode === 'called' ? 'Search Called / Logged Patients' : canManage ? 'Search Active Calling Queue' : 'My Active Calling Queue'}</h3>
          <div className="form-grid">
            <div className="form-field"><label>Search name or phone</label><input value={search} onChange={e => setSearch(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') load(); }} /></div>
            {canManage && <div className="form-field"><label>Filter by staff</label><select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}><option value="">All staff / all patients</option>{users.filter(u => ['recall_staff','manager'].includes(u.role)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>}
            {viewMode === 'queue' && <div className="form-field"><label>Status</label><select value={status} onChange={e => setStatus(e.target.value)}><option value="active_queue">Active queue</option>{canManage && <option value="unassigned">Unassigned only</option>}<option value="assigned">Assigned / pending only</option></select></div>}
            {viewMode === 'called' && <div className="form-field"><label>Logged status</label><select value={status} onChange={e => setStatus(e.target.value)}><option value="logged">All logged statuses</option><option value="called">Called</option><option value="follow_up">Follow up</option><option value="booked">Booked</option><option value="do_not_call">Do not call</option></select></div>}
            <div className="form-field" style={{ alignSelf: 'end' }}><button onClick={() => load()}>Search</button></div>
            <div className="form-field" style={{ alignSelf: 'end' }}><button type="button" className="ghost" onClick={clearSearch}>Clear Search</button></div>
          </div>
          {message && <div className="alert success">{message}</div>}
          {error && <div className="alert error">{error}</div>}
        </div>}

        {viewMode !== 'monitor' && <div className="card full">
          <h3 style={{ marginTop: 0 }}>{viewMode === 'called' ? 'Called / Logged Patients' : 'Active Patients to Call'}</h3>
          <p className="note">{viewMode === 'called' ? 'These patients have call history and are not lost. Use this view for checking, edit/unlog corrections and verification.' : 'When a call is saved, the patient leaves this active queue so the next pending patient moves up.'}</p>
          <div className="table-wrap">
            <table className="calling-table"><thead><tr><th>Patient</th><th>Phone</th><th>Last Visit</th><th>Last Doctor</th><th>Visits</th><th>Priority</th><th>Assigned To</th><th>{viewMode === 'called' ? 'Last Caller' : 'Status'}</th><th>Calls</th><th>Action</th></tr></thead><tbody>
              {patients.length === 0 && <tr><td colSpan={10}>{viewMode === 'called' ? 'No called/logged patients match this view yet.' : canManage ? 'No active patients loaded yet. Upload visit exports first or adjust the search.' : 'No active patients assigned to this login yet. Ask admin to assign patients to this user account.'}</td></tr>}
              {patients.map(p => <tr key={p.id}>
                <td>{p.display_name}<br />{p.duplicate_risk_level === 'review' && <span className="badge orange">duplicate review</span>}</td>
                <td>{p.standard_phone}</td>
                <td>{p.last_visit_date || '-'}</td>
                <td>{p.last_doctor || '-'}</td>
                <td>{p.visit_count}</td>
                <td>{p.recall_priority}</td>
                <td>{p.assigned_user?.name || '-'}</td>
                <td>{viewMode === 'called' ? (p.latest_call?.staff?.name || '-') : p.assignment_status}{viewMode === 'called' && p.latest_call?.outcome && <><br /><span className="note">{p.latest_call.outcome}</span></>}</td>
                <td>{p.call_count || 0}</td>
                <td>
                  <button onClick={() => openPatient(p)}>{viewMode === 'called' ? 'View / Correct' : p.call_count ? 'View / Log' : 'Log Call'}</button>
                  {canManage && p.assigned_to && p.assignment_status === 'assigned' && <button type="button" className="ghost" style={{ marginLeft: 8 }} onClick={() => unassignPatient(p)}>Unassign</button>}
                  {canManage && viewMode === 'called' && !(p.call_count || 0) && <button type="button" className="ghost" style={{ marginLeft: 8 }} onClick={() => requeuePatient(p)}>Return to Queue</button>}
                </td>
              </tr>)}
            </tbody></table>
          </div>
        </div>}

        {viewMode === 'monitor' && canMonitor && <div className="card full">
          <h3 style={{ marginTop: 0 }}>Call Monitoring and Export</h3>
          <div className="form-grid">
            <div className="form-field"><label>Start date</label><input type="date" value={monitorDates.startDate} onChange={e => setMonitorDates({ ...monitorDates, startDate: e.target.value })} /></div>
            <div className="form-field"><label>End date</label><input type="date" value={monitorDates.endDate} onChange={e => setMonitorDates({ ...monitorDates, endDate: e.target.value })} /></div>
            <div className="form-field"><label>Staff</label><select value={staffFilter} onChange={e => setStaffFilter(e.target.value)}><option value="">All staff</option>{users.filter(u => ['recall_staff','manager'].includes(u.role)).map(u => <option key={u.id} value={u.id}>{u.name}</option>)}</select></div>
            <div className="form-field" style={{ alignSelf: 'end' }}><button type="button" onClick={() => loadMonitor()}>Refresh Monitoring</button></div>
            <div className="form-field" style={{ alignSelf: 'end' }}><button type="button" className="ghost" onClick={exportCalls}>Export Logged Calls CSV</button></div>
          </div>
          {message && <div className="alert success">{message}</div>}
          {error && <div className="alert error">{error}</div>}

          <div className="kpi-grid" style={{ marginTop: 18 }}>
            <div className="metric"><strong>{monitor?.summary?.totalCalls || 0}</strong><span>Total Calls Logged</span></div>
            <div className="metric"><strong>{monitor?.summary?.uniquePatients || 0}</strong><span>Unique Patients Called</span></div>
            <div className="metric"><strong>{monitor?.summary?.bookings || 0}</strong><span>Self-Reported Bookings</span></div>
            <div className="metric"><strong>{monitor?.summary?.reached || 0}</strong><span>Reached Outcomes</span></div>
          </div>

          <h3>Daily Call Trend</h3>
          <div style={{ display: 'flex', gap: 8, alignItems: 'end', height: 170, padding: 16, background: '#f4f9fe', borderRadius: 18, overflowX: 'auto' }}>
            {(monitor?.dailyTotals || []).length === 0 && <p className="note">No calls in the selected period yet.</p>}
            {(monitor?.dailyTotals || []).map((d: any) => <div key={d.date} title={`${d.date}: ${d.calls} calls`} style={{ minWidth: 34, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'end', gap: 6 }}>
              <div style={{ width: 26, borderRadius: '8px 8px 0 0', background: 'var(--fhdc-orange)', height: `${Math.max(8, (Number(d.calls || 0) / maxDailyCalls) * 120)}px` }} />
              <small style={{ transform: 'rotate(-45deg)', transformOrigin: 'top left', whiteSpace: 'nowrap' }}>{String(d.date).slice(5)}</small>
            </div>)}
          </div>

          <h3>Calls by Staff</h3>
          <div className="table-wrap"><table><thead><tr><th>Staff</th><th>Calls</th><th>Unique Patients</th><th>Bookings</th><th>Reached</th></tr></thead><tbody>
            {(monitor?.staffTotals || []).length === 0 && <tr><td colSpan={5}>No staff calls in selected period.</td></tr>}
            {(monitor?.staffTotals || []).map((s: any) => <tr key={s.staff_id}><td>{s.staff_name}</td><td>{s.calls}</td><td>{s.uniquePatients}</td><td>{s.bookings}</td><td>{s.reached}</td></tr>)}
          </tbody></table></div>

          <h3>Daily Calls by Caller</h3>
          <div className="table-wrap"><table><thead><tr><th>Date</th><th>Caller</th><th>Calls</th><th>Bookings</th><th>Reached</th></tr></thead><tbody>
            {(monitor?.staffDaily || []).length === 0 && <tr><td colSpan={5}>No daily staff trend yet.</td></tr>}
            {(monitor?.staffDaily || []).slice(-100).reverse().map((r: any) => <tr key={`${r.date}-${r.staff_id}`}><td>{r.date}</td><td>{r.staff_name}</td><td>{r.calls}</td><td>{r.bookings}</td><td>{r.reached}</td></tr>)}
          </tbody></table></div>
        </div>}
      </div>

      {selected && <div className="card" style={{ position: 'fixed', right: 24, top: 92, width: 520, maxWidth: 'calc(100vw - 48px)', maxHeight: 'calc(100vh - 120px)', overflow: 'auto', zIndex: 20, boxShadow: '0 20px 60px rgba(0,0,0,.2)' }}>
        <h3 style={{ marginBottom: 4 }}>{editingCall ? 'Edit Call Log' : 'Log Call'}: {selected.display_name}</h3>
        <p className="note">{selected.standard_phone} · Assigned to {selected.assigned_user?.name || 'unassigned'} · Status: {selected.assignment_status}</p>

        <form onSubmit={saveCall} className="form-grid">
          <div className="form-field full"><label>Outcome</label><select required value={call.outcome} onChange={e => setCall({ ...call, outcome: e.target.value })}><option value="">Select outcome</option>{outcomes.map(o => <option key={o}>{o}</option>)}</select></div>
          <div className="form-field full"><label>Appointment date, if booked</label><input type="date" value={call.appointmentDate} onChange={e => setCall({ ...call, appointmentDate: e.target.value })} /></div>
          <div className="form-field full"><label>Patient feedback</label><textarea value={call.patientFeedback} onChange={e => setCall({ ...call, patientFeedback: e.target.value })} /></div>
          <div className="form-field"><label>Next action</label><input value={call.nextAction} onChange={e => setCall({ ...call, nextAction: e.target.value })} /></div>
          <div className="form-field"><label>Next action date</label><input type="date" value={call.nextActionDate} onChange={e => setCall({ ...call, nextActionDate: e.target.value })} /></div>
          <div className="form-field full"><label>Notes</label><textarea value={call.notes} onChange={e => setCall({ ...call, notes: e.target.value })} /></div>
          <div className="form-field"><button>{editingCall ? 'Save Changes' : 'Save Call'}</button></div>
          <div className="form-field"><button type="button" className="ghost" onClick={() => { setEditingCall(null); setCall(blankCall); }}>Clear Form</button></div>
          <div className="form-field full"><button type="button" className="ghost" onClick={() => { setSelected(null); setEditingCall(null); setPatientCalls([]); setCall(blankCall); }}>Close</button></div>
        </form>

        <h3 style={{ marginTop: 18 }}>Call History</h3>
        <div className="table-wrap">
          <table><thead><tr><th>Date</th><th>Outcome</th><th>Staff</th><th>Booking</th><th>Action</th></tr></thead><tbody>
            {patientCalls.length === 0 && <tr><td colSpan={5}>No calls logged for this patient yet.</td></tr>}
            {patientCalls.map(c => <tr key={c.id}>
              <td>{fmtDate(c.attempt_at || c.created_at)}</td>
              <td>{c.outcome}<br />{c.next_action && <span className="note">Next: {c.next_action}</span>}</td>
              <td>{c.staff?.name || '-'}</td>
              <td>{c.booking_made ? `Yes · ${c.appointment_date || ''}` : 'No'}</td>
              <td><button type="button" className="ghost" onClick={() => startEdit(c)}>Edit</button><button type="button" className="ghost" style={{ marginLeft: 8 }} onClick={() => unlogCall(c)}>Unlog</button></td>
            </tr>)}
          </tbody></table>
        </div>
      </div>}
    </>
  );
}
