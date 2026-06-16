import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { readStore, updateStore, nowIso } from '@/lib/localDb';
import { writeAudit } from '@/lib/audit';

export async function GET() {
  try {
    await requireUser();
    const store = await readStore();
    const assumptions = [...store.payment_assumptions].sort((a: any, b: any) => Number(a.sort_order || 0) - Number(b.sort_order || 0));
    return NextResponse.json({ assumptions });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : 500;
    return NextResponse.json({ error: error.message || 'Failed to load assumptions' }, { status });
  }
}

export async function PUT(req: Request) {
  try {
    const user = await requireUser(['admin','manager','finance']);
    const body = await req.json();
    const rows = body.assumptions || [];
    await updateStore(store => {
      for (const row of rows) {
        const existing = store.payment_assumptions.find((a: any) => a.key === row.key);
        if (existing) {
          existing.value = String(row.value);
          existing.updated_at = nowIso();
        }
      }
    });
    await writeAudit(user.id, 'UPDATE_PAYMENT_ASSUMPTIONS', 'payment_assumptions', 'bulk', { count: rows.length });
    return NextResponse.json({ ok: true });
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to update assumptions' }, { status });
  }
}
