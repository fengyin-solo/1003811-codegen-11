import { SEED_ROWS } from './seed'
import type { EntryRow, ReconcileState } from './types'

// 本地持久化：数据放在 localStorage 里，刷新、关掉再打开都还在。
const STORAGE_KEY = 'field-archaeology-digital:entries'
// 对账包台账与遗迹待核验清单与业务记录放在同一个 localStorage 项里，
// 这样导入时所有写入可以一次 setItem 完成：中途任何一步失败都不会落下半份结果。
const RECONCILE_KEY = '__reconcile__'

type StoredState = {
  [key: string]: EntryRow[] | ReconcileState
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

function defaultReconcileState(): ReconcileState {
  return { importedPackages: [], featureChecklist: [] }
}

function normalize(raw: StoredState): StoredState {
  const reconciled = (raw[RECONCILE_KEY] as ReconcileState | undefined) ?? defaultReconcileState()
  const next: StoredState = { ...raw, [RECONCILE_KEY]: reconciled }
  // 清掉历史上可能按业务模块写进来的对账残留，避免被当成模块数据。
  for (const junk of ['survey_imports', 'feature_checklist']) {
    if (junk !== RECONCILE_KEY && junk in next) {
      delete next[junk]
    }
  }
  return next
}

function readStorage(): StoredState {
  const fallback: StoredState = { ...clone(SEED_ROWS), [RECONCILE_KEY]: defaultReconcileState() }
  if (typeof window === 'undefined' || !window.localStorage) {
    return fallback
  }
  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
  try {
    const parsed = JSON.parse(raw) as StoredState
    return { ...fallback, ...normalize(parsed) }
  } catch {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(fallback))
    return fallback
  }
}

let cache: StoredState | null = null

export function allRows(): Record<string, EntryRow[]> {
  if (cache === null) {
    cache = readStorage()
  }
  const { [RECONCILE_KEY]: _reconcile, ...modules } = cache
  return modules as Record<string, EntryRow[]>
}

export function listRows(key: string): EntryRow[] {
  return allRows()[key] ?? []
}

export function getReconcileState(): ReconcileState {
  if (cache === null) {
    cache = readStorage()
  }
  return clone(cache[RECONCILE_KEY] as ReconcileState)
}

// 一次性提交整个状态：业务行与对账台账、待核验清单在同一次写入里落库，
// localStorage 的 setItem 本身是同步原子的，因此不会出现只写进去半份的情况。
export function commitAll(next: StoredState): void {
  const normalized = normalize(next)
  cache = normalized
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(normalized))
  }
}

export function buildNextState(
  changes: Record<string, EntryRow[]>,
  reconcile: ReconcileState,
): StoredState {
  return { ...allRows(), ...changes, [RECONCILE_KEY]: reconcile }
}

export function saveRows(key: string, rows: EntryRow[]): void {
  commitAll({ ...allRows(), [key]: rows })
}

export function resetRows(key: string): EntryRow[] {
  const rows = clone(SEED_ROWS[key] ?? [])
  // 重置单个业务模块不影响对账台账与待核验清单。
  commitAll({ ...allRows(), [key]: rows, [RECONCILE_KEY]: getReconcileState() })
  return rows
}

export function storageKey(): string {
  return STORAGE_KEY
}
