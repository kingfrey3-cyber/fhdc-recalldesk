import { NextResponse } from 'next/server';
import * as XLSX from 'xlsx';
import { requireUser } from '@/lib/auth';
import { extractVisit, recallPriority } from '@/lib/recallLogic';
import { updateStore, newId, nowIso } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function asArray(value: any): any[] {
  return Array.isArray(value) ? value : [];
}

function cleanString(value: any) {
  return String(value || '').trim();
}

function laterOrEqual(a: any, b: any) {
  const left = String(a || '');
  const right = String(b || '');
  if (!left) return false;
  if (!right) return true;
  return left >= right;
}

function uniqueSorted(values: any[]) {
  return Array.from(new Set(values.filter((v) => v !== null && v !== undefined && String(v).trim() !== '').map((v) => String(v).trim()))).sort();
}

function ensurePatientShape(existing: any, phone: string, firstVisit: any) {
  const allNames = uniqueSorted([...(asArray(existing.all_names)), existing.display_name].filter(Boolean));
  const originalPhones = uniqueSorted(asArray(existing.original_phones));
  const yearsVisited = uniqueSorted(asArray(existing.years_visited)).map((y) => Number(y)).filter((y) => !Number.isNaN(y)).sort((a, b) => a - b);
  const nameKeys = uniqueSorted([...(asArray(existing.patient_name_keys)), existing.patient_name_key].filter(Boolean));

  return {
    id: existing.id || newId('patient_'),
    standard_phone: existing.standard_phone || phone,
    display_name: existing.display_name || 'Unknown patient',
    patient_name_key: existing.patient_name_key || '',
    patient_name_keys: nameKeys,
    all_names: allNames,
    original_phones: originalPhones,
    first_visit_date: existing.first_visit_date || firstVisit || null,
    last_visit_date: existing.last_visit_date || firstVisit || null,
    visit_count: Number(existing.visit_count || 0),
    years_visited: yearsVisited,
    last_doctor: existing.last_doctor || '',
    last_company: existing.last_company || '',
    duplicate_risk_level: existing.duplicate_risk_level || 'low',
    duplicate_risk_notes: existing.duplicate_risk_notes || '',
    recall_priority: existing.recall_priority || recallPriority(existing.last_visit_date || firstVisit),
    assignment_status: existing.assignment_status || (existing.assigned_to ? 'assigned' : 'unassigned'),
    assigned_to: existing.assigned_to || null,
    do_not_call: Boolean(existing.do_not_call),
    updated_at: nowIso()
  };
}

function mergeVisitIntoPatient(existing: any, visit: any) {
  const phone = visit.standard_phone;
  const patient = ensurePatientShape(existing || {}, phone, visit.visit_date);

  const name = cleanString(visit.patient_name);
  const nameKey = cleanString(visit.patient_name_key);
  const originalPhone = cleanString(visit.original_phone);
  const year = Number(visit.visit_year || 0);

  if (name) {
    patient.all_names = uniqueSorted([...asArray(patient.all_names), name]);
    if (!patient.display_name || patient.display_name === 'Unknown patient') patient.display_name = name;
  }
  if (nameKey) {
    patient.patient_name_keys = uniqueSorted([...asArray(patient.patient_name_keys), nameKey]);
    if (!patient.patient_name_key) patient.patient_name_key = nameKey;
  }
  if (originalPhone) patient.original_phones = uniqueSorted([...asArray(patient.original_phones), originalPhone]);
  if (year && !Number.isNaN(year)) patient.years_visited = uniqueSorted([...asArray(patient.years_visited), year]).map((y) => Number(y)).sort((a, b) => a - b);

  const visitDate = cleanString(visit.visit_date);
  if (visitDate) {
    if (!patient.first_visit_date || visitDate < String(patient.first_visit_date)) patient.first_visit_date = visitDate;
    if (laterOrEqual(visitDate, patient.last_visit_date)) {
      patient.last_visit_date = visitDate;
      if (cleanString(visit.doctor)) patient.last_doctor = cleanString(visit.doctor);
      if (cleanString(visit.company)) patient.last_company = cleanString(visit.company);
    }
  }

  patient.visit_count = Number(patient.visit_count || 0) + 1;
  patient.recall_priority = recallPriority(patient.last_visit_date);
  patient.updated_at = nowIso();
  return patient;
}

function rebuildDuplicateFlags(store: any, batchId: string) {
  const patients = asArray(store.patient_master);
  const nameToPhones = new Map<string, Set<string>>();

  for (const p of patients) {
    for (const key of uniqueSorted([...(asArray(p.patient_name_keys)), p.patient_name_key])) {
      if (!key || !p.standard_phone) continue;
      if (!nameToPhones.has(key)) nameToPhones.set(key, new Set());
      nameToPhones.get(key)!.add(p.standard_phone);
    }
  }

  const flags: any[] = [];
  for (const p of patients) {
    const samePhoneManyNames = asArray(p.all_names).filter(Boolean).length > 1;
    const sameNameManyPhones = uniqueSorted([...(asArray(p.patient_name_keys)), p.patient_name_key]).some((key) => (nameToPhones.get(key)?.size || 0) > 1);
    const notes = [
      samePhoneManyNames ? 'Same phone linked to multiple patient names' : '',
      sameNameManyPhones ? 'Same or similar patient name appears with multiple phone numbers' : ''
    ].filter(Boolean).join('; ');

    p.duplicate_risk_level = notes ? 'review' : 'low';
    p.duplicate_risk_notes = notes;
    p.updated_at = nowIso();

    if (notes) {
      flags.push({
        id: newId('flag_'),
        batch_id: batchId,
        patient_id: p.id,
        staff_id: null,
        flag_type: 'potential_duplicate_patient',
        severity: 'medium',
        status: 'open',
        description: `${p.display_name || 'Patient'} ${p.standard_phone}: ${notes}`,
        created_at: nowIso()
      });
    }
  }

  // Rebuild duplicate flags so repeated uploads do not multiply the same warnings.
  store.data_quality_flags = asArray(store.data_quality_flags).filter((f: any) => f.flag_type !== 'potential_duplicate_patient');
  store.data_quality_flags.push(...flags);
}

function conciseErrorMessage(error: any) {
  const msg = String(error?.message || error || 'Upload failed');
  if (msg.includes('520') || msg.toLowerCase().includes('bad gateway') || msg.includes('<!DOCTYPE')) {
    return 'Supabase rejected a large save request. This upload patch stores only the operational recall dataset; please restart and try again in smaller batches first.';
  }
  return msg.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').slice(0, 700);
}

export async function POST(req: Request) {
  try {
    const user = await requireUser(['admin','manager']);
    const form = await req.formData();
    const files = form.getAll('files') as File[];
    if (!files.length) return NextResponse.json({ error: 'Upload at least one Excel file' }, { status: 400 });

    const batchId = newId('batch_');
    const createdAt = nowIso();
    const batch: any = {
      id: batchId,
      filename_summary: files.map((f) => f.name).join(', '),
      uploaded_by: user.id,
      raw_row_count: 0,
      unique_visit_count: 0,
      clean_patient_count: 0,
      duplicate_row_count: 0,
      notes: '',
      storage_mode: 'operational_clean_recall_dataset',
      created_at: createdAt
    };

    const visitCandidates: any[] = [];
    let rawRowCount = 0;
    let invalidPhoneCount = 0;

    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const wb = XLSX.read(buffer, { type: 'buffer', cellDates: true });
      for (const sheetName of wb.SheetNames) {
        const sheet = wb.Sheets[sheetName];
        const rows = XLSX.utils.sheet_to_json<Record<string, any>>(sheet, { defval: '' });
        rows.forEach((row, idx) => {
          rawRowCount += 1;
          const parsed = extractVisit(row, file.name, sheetName, idx + 2);
          if (!parsed.standard_phone) {
            invalidPhoneCount += 1;
            return;
          }
          visitCandidates.push({
            visit_hash: parsed.visit_hash,
            batch_id: batch.id,
            source_file_name: parsed.source_file_name,
            source_sheet_name: parsed.source_sheet_name,
            raw_row_number: parsed.raw_row_number,
            patient_name: parsed.patient_name,
            patient_name_key: parsed.patient_name_key,
            original_phone: parsed.original_phone,
            standard_phone: parsed.standard_phone,
            visit_date: parsed.visit_date,
            visit_year: parsed.visit_year,
            doctor: parsed.doctor,
            company: parsed.company,
            visit_status: parsed.visit_status,
            created_at: createdAt
          });
        });
      }
    }

    const result = await updateStore(store => {
      // Compact any older bridge data so Supabase is not asked to save very large raw rows.
      const oldHashes = new Set<string>([
        ...asArray((store as any).visit_hashes),
        ...asArray(store.unique_visits).map((v: any) => String(v.visit_hash || '')).filter(Boolean)
      ]);

      store.raw_visits = [];
      store.unique_visits = [];
      (store as any).visit_hashes = Array.from(oldHashes);

      const patientsByPhone = new Map<string, any>();
      for (const existing of asArray(store.patient_master)) {
        if (existing.standard_phone) patientsByPhone.set(existing.standard_phone, ensurePatientShape(existing, existing.standard_phone, existing.first_visit_date));
      }

      let addedUnique = 0;
      for (const visit of visitCandidates) {
        if (!visit.visit_hash || oldHashes.has(visit.visit_hash)) continue;
        oldHashes.add(visit.visit_hash);
        addedUnique += 1;
        const existing = patientsByPhone.get(visit.standard_phone) || {};
        const merged = mergeVisitIntoPatient(existing, visit);
        patientsByPhone.set(visit.standard_phone, merged);
      }

      store.patient_master = Array.from(patientsByPhone.values()).sort((a: any, b: any) => String(a.last_visit_date || '9999').localeCompare(String(b.last_visit_date || '9999')));
      (store as any).visit_hashes = Array.from(oldHashes);

      if (invalidPhoneCount > 0) {
        store.data_quality_flags.push({
          id: newId('flag_'),
          batch_id: batch.id,
          patient_id: null,
          staff_id: null,
          flag_type: 'invalid_or_missing_phone',
          severity: 'high',
          status: 'open',
          description: `${invalidPhoneCount} uploaded visit rows had invalid or missing phone numbers and were excluded from the clean calling list.`,
          created_at: nowIso()
        });
      }

      rebuildDuplicateFlags(store, batch.id);

      batch.raw_row_count = rawRowCount;
      batch.unique_visit_count = addedUnique;
      batch.clean_patient_count = store.patient_master.length;
      batch.duplicate_row_count = Math.max(0, rawRowCount - invalidPhoneCount - addedUnique);
      batch.notes = `Operational upload mode. Raw rows counted but not stored in Supabase to keep uploads fast and reliable. Invalid or missing phones: ${invalidPhoneCount}. Patient master updated from unique visit hashes.`;
      store.upload_batches.push(batch);

      return { rawRows: rawRowCount, uniqueRows: addedUnique, cleanPatientCount: store.patient_master.length };
    });

    await writeAudit(user.id, 'UPLOAD_VISIT_EXPORTS', 'upload_batch', batch.id, {
      files: files.map((f) => f.name), rawRows: rawRowCount, uniqueRows: result.uniqueRows, cleanPatientCount: result.cleanPatientCount, storageMode: batch.storage_mode
    });

    return NextResponse.json({
      batchId: batch.id,
      rawRows: rawRowCount,
      uniqueRows: result.uniqueRows,
      cleanPatients: result.cleanPatientCount,
      invalidPhoneCount,
      storageMode: batch.storage_mode
    });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: conciseErrorMessage(error) }, { status });
  }
}
