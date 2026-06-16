import { updateStore, newId, nowIso } from './localDb';

export async function writeAudit(userId: string | null, action: string, entityType?: string, entityId?: string, details?: any) {
  await updateStore(store => {
    store.audit_logs.push({
      id: newId('audit_'),
      user_id: userId,
      action,
      entity_type: entityType || '',
      entity_id: entityId || '',
      details: details || {},
      created_at: nowIso()
    });
  });
}
