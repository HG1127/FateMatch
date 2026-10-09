/**
 * Per-account, per-object text drafts live only in this browser tab.
 * Never persist passwords, images or chat metadata in a draft.
 * sessionStorage is cleared with the browser tab and we expire entries after 7 days.
 */
export type DraftScope = 'chat' | 'post'
export interface SessionDraft { text: string; topic?: string }
const MAX_AGE_MS = 7 * 86400_000

function keyFor(scope: DraftScope, owner: string, objectId: string): string {
  return `sy:ux-draft:v1:${scope}:${encodeURIComponent(owner)}:${encodeURIComponent(objectId)}`
}

export function clearSessionDraft(scope: DraftScope, owner: string, objectId = ''): void {
  if (!owner || typeof sessionStorage === 'undefined') return
  try { sessionStorage.removeItem(keyFor(scope, owner, objectId)) } catch { /* Disabled storage */ }
}

export function readSessionDraft(scope: DraftScope, owner: string, objectId = ''): SessionDraft | null {
  if (!owner || typeof sessionStorage === 'undefined') return null
  try {
    const raw = sessionStorage.getItem(keyFor(scope, owner, objectId))
    if (!raw) return null
    const item: unknown = JSON.parse(raw)
    if (!item || typeof item !== 'object') return null
    const record = item as { at?: unknown; text?: unknown; topic?: unknown }
    if (typeof record.text !== 'string' || record.text.length > 5000 ||
      typeof record.at !== 'number' || record.at > Date.now() + 60_000 ||
      Date.now() - record.at > MAX_AGE_MS) {
      clearSessionDraft(scope, owner, objectId)
      return null
    }
    return { text: record.text, ...(typeof record.topic === 'string' ? { topic: record.topic } : {}) }
  } catch { return null }
}

export function saveSessionDraft(scope: DraftScope, owner: string, objectId: string, draft: SessionDraft): void {
  if (!owner || typeof sessionStorage === 'undefined') return
  if (!draft.text.trim()) { clearSessionDraft(scope, owner, objectId); return }
  try {
    sessionStorage.setItem(keyFor(scope, owner, objectId), JSON.stringify({
      at: Date.now(),
      text: draft.text.slice(0, 5000),
      ...(draft.topic ? { topic: draft.topic } : {}),
    }))
  } catch { /* Browsing without storage must not block normal editing */ }
}
