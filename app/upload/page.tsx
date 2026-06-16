'use client';

import { useState } from 'react';
import { parseJsonResponse } from '@/lib/apiClient';

export default function UploadPage() {
  const [files, setFiles] = useState<FileList | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState('');

  async function upload(e: React.FormEvent) {
    e.preventDefault();
    if (!files?.length) return setError('Choose one or more Excel files');
    setBusy(true); setError(''); setResult(null);
    const form = new FormData();
    Array.from(files).forEach(file => form.append('files', file));
    try {
      const res = await fetch('/api/upload', { method: 'POST', body: form });
      const data = await parseJsonResponse(res);
      setResult(data);
    } catch (error: any) {
      setError(error.message || 'Upload failed');
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="hero">
        <h1 style={{ marginTop: 0, color: 'var(--fhdc-blue-dark)' }}>Upload Patient Visit Exports</h1>
        <p className="note">Upload raw Excel exports as they come from the clinic system. The tool preserves raw rows, standardises phone numbers, removes repeated visit duplicates and rebuilds the clean calling list.</p>
      </div>
      <div className="card" style={{ marginTop: 18 }}>
        <form onSubmit={upload} className="form-grid">
          <div className="form-field full">
            <label>Excel visit export files</label>
            <input type="file" accept=".xls,.xlsx,.csv" multiple onChange={e => setFiles(e.target.files)} />
          </div>
          {error && <div className="form-field full error">{error}</div>}
          <div className="form-field full"><button disabled={busy}>{busy ? 'Processing uploads...' : 'Upload and Process'}</button></div>
        </form>
        {result && <div className="alert success">
          Upload processed. Raw rows: {Number(result.rawRows || 0).toLocaleString()}, unique visit candidates: {Number(result.uniqueRows || 0).toLocaleString()}, clean patients: {Number(result.cleanPatients || 0).toLocaleString()}, invalid or missing phones: {Number(result.invalidPhoneCount || 0).toLocaleString()}.
        </div>}
      </div>
    </>
  );
}
