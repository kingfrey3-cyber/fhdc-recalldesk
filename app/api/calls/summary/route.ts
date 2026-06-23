import { NextResponse } from 'next/server';
import { requireUser } from '@/lib/auth';
import { getCallMonitoring, useTableStorage } from '@/lib/tableDb';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  try {
    const user = await requireUser(['admin', 'manager', 'finance', 'recall_staff']);
    if (!useTableStorage()) return NextResponse.json({ error: 'Call monitoring requires relational Supabase tables.' }, { status: 400 });
    const url = new URL(req.url);
    const staffId = (url.searchParams.get('staffId') || '').trim();
    const startDate = (url.searchParams.get('startDate') || '').trim();
    const endDate = (url.searchParams.get('endDate') || '').trim();
    const limit = Math.min(Number(url.searchParams.get('limit') || 2000), 10000);
    const data = await getCallMonitoring(user, { staffId, startDate, endDate, limit });
    return NextResponse.json(data);
  } catch (error: any) {
    const status = error.message === 'UNAUTHENTICATED' ? 401 : error.message === 'FORBIDDEN' ? 403 : 500;
    return NextResponse.json({ error: error.message || 'Failed to load call monitoring' }, { status });
  }
}
