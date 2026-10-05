import { MODULE_BY_KEY } from '@/data/modules'
import {
  allRows,
  buildNextState,
  commitAll,
  getReconcileState,
  listRows,
  resetRows,
  saveRows,
} from '@/data/local-store'
import type {
  ActionResult,
  EntryRow,
  FeatureChecklistItem,
  ImportReconcileResult,
  ImportedPackageRecord,
  ModuleMeta,
  OverviewResult,
  PageResult,
  ReconcileState,
  SurveyPackageRecord,
  SurveyReconcilePackage,
  SurveySurfaceFind,
} from '@/data/types'

// 会写进数据的「往回走」动作：命中就把这条记录标成异常态，看板上能一眼看出来。
const NEGATIVE_ACTIONS = ['撤销', '作废', '拒绝', '驳回', '停用', '忽略', '下线', '回滚']

export function moduleMeta(key: string): ModuleMeta {
  const meta = MODULE_BY_KEY.get(key)
  if (!meta) {
    throw new Error(`没有登记名为 ${key} 的业务模块`)
  }
  return meta
}

export function filterRows(rows: EntryRow[], filters: Record<string, string>): EntryRow[] {
  const pairs = Object.entries(filters).filter(([, value]) => value.trim() !== '')
  if (pairs.length === 0) {
    return rows
  }
  return rows.filter((row) =>
    pairs.every(([field, value]) => String(row[field] ?? '').includes(value.trim())),
  )
}

export function listEntries(key: string, filters: Record<string, string> = {}): PageResult {
  const matched = filterRows(listRows(key), filters)
  return { items: matched, total: matched.length, page: 1, size: matched.length }
}

export function runAction(key: string, id: number, action: string): ActionResult {
  const meta = moduleMeta(key)
  const target = meta.actionTargets[action]
  if (!target) {
    return { ok: false, message: `${meta.entity}没有登记「${action}」这个动作` }
  }
  const rows = listRows(key)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: `没有找到编号为 ${id} 的${meta.entity}` }
  }
  const current = String(rows[index].status)
  if (current === target) {
    return { ok: false, message: `${meta.entity}已经是「${target}」，不用重复操作` }
  }
  const lastStatus = meta.statuses[meta.statuses.length - 1]
  const updated: EntryRow = {
    ...rows[index],
    status: target,
    pending: target !== lastStatus,
    abnormal: NEGATIVE_ACTIONS.some((verb) => action.startsWith(verb)),
  }
  const next = [...rows]
  next[index] = updated
  saveRows(key, next)
  return { ok: true, message: `${meta.entity}已${action}，当前状态「${target}」` }
}

export function resetModule(key: string): PageResult {
  resetRows(key)
  return listEntries(key)
}

export function exportEntries(key: string): { filename: string; content: string } {
  const meta = moduleMeta(key)
  const header = ['编号', ...meta.fields, '当前状态']
  const lines = [header.join(',')]
  for (const row of listRows(key)) {
    lines.push([row.id, ...meta.fields.map((field) => row[field] ?? ''), row.status].join(','))
  }
  return { filename: `${meta.name}-清单.csv`, content: `\uFEFF${lines.join('\n')}` }
}

export function downloadEntries(key: string): void {
  const { filename, content } = exportEntries(key)
  const blob = new Blob([content], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

export function loadOverview(): OverviewResult {
  const rows = allRows()
  const modules = [...MODULE_BY_KEY.values()].map((meta) => {
    const entries = rows[meta.key] ?? []
    return {
      name: meta.name,
      created: entries.length,
      pending: entries.filter((row) => row.pending).length,
      abnormal: entries.filter((row) => row.abnormal).length,
    }
  })
  const cards = [
    { label: '业务模块', value: modules.length },
    { label: '登记总量', value: modules.reduce((sum, item) => sum + item.created, 0) },
    { label: '待处理', value: modules.reduce((sum, item) => sum + item.pending, 0) },
    { label: '异常量', value: modules.reduce((sum, item) => sum + item.abnormal, 0) },
  ]
  return { cards, modules }
}

// ── 考古调查资料对账包 ────────────────────────────────────────────

const SURVEY_KEY = 'survey'
const SURVEY_NO = '调查编号'
const SURVEY_AREA = '调查区域'
const SURVEY_METHOD = '调查方法'
const SURVEY_FINDS = '地表发现'
const SURVEY_SECTION = '断面观察'
const SURVEY_DATING = '初步断代'
const SURVEYOR = '调查人'
const FEATURE_KEY = 'feature'
const FEATURE_NO = '遗迹编号'

// 同一条地表发现里「遗迹编号」与描述之间允许的分隔写法。
const FIND_SPLIT = /[：:\s，,；;]+/

// 解析「地表发现」文本：按行/顿号拆条，条内若能识别出遗迹编号则关联到该编号。
export function parseSurfaceFinds(text: string): SurveySurfaceFind[] {
  return text
    .split(/[\n、;；]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const relic = part.match(/[A-Za-z]{2,6}-?\d{3,}/)
      if (!relic) {
        return { relicId: '', description: part }
      }
      const relicId = relic[0].toUpperCase()
      const description = part.replace(relic[0], '').split(FIND_SPLIT).filter(Boolean).join('')
      return { relicId, description: description || part }
    })
}

function findToText(find: SurveySurfaceFind): string {
  if (find.relicId && find.description) {
    return `${find.relicId}：${find.description}`
  }
  return find.description || find.relicId
}

export function exportSurveyPackage(
  filters: Record<string, string> = {},
): { filename: string; content: string } {
  const rows = filterRows(listRows(SURVEY_KEY), filters)
  const stamp = new Date()
  const exportedAt = stamp.toISOString()
  const packageNo = `SURV-PKG-${stamp.getFullYear()}${String(stamp.getMonth() + 1).padStart(2, '0')}${String(
    stamp.getDate(),
  ).padStart(2, '0')}-${String(stamp.getHours()).padStart(2, '0')}${String(stamp.getMinutes()).padStart(2, '0')}${String(
    stamp.getSeconds(),
  ).padStart(2, '0')}`
  const pkg: SurveyReconcilePackage = {
    packageKind: 'survey-reconcile',
    packageNo,
    exportedAt,
    records: rows.map((row) => ({
      surveyNo: String(row[SURVEY_NO] ?? ''),
      area: String(row[SURVEY_AREA] ?? ''),
      // 旧记录可能没有调查方法：按空白兼容，导出/导入都不因此报错。
      method: String(row[SURVEY_METHOD] ?? ''),
      surveyor: String(row[SURVEYOR] ?? ''),
      surfaceFinds: parseSurfaceFinds(String(row[SURVEY_FINDS] ?? '')),
      sectionObservation: String(row[SURVEY_SECTION] ?? ''),
      preliminaryDating: String(row[SURVEY_DATING] ?? ''),
    })),
  }
  return { filename: `${packageNo}.json`, content: JSON.stringify(pkg, null, 2) }
}

export function downloadSurveyPackage(filters: Record<string, string> = {}): void {
  const { filename, content } = exportSurveyPackage(filters)
  const blob = new Blob([content], { type: 'application/json;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.appendChild(anchor)
  anchor.click()
  document.body.removeChild(anchor)
  URL.revokeObjectURL(url)
}

// 确定性哈希：同一资料包（不论文件名）内容一致即视为重复导入。
async function hashContent(content: string): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(content))
    return Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')
  }
  // 非安全上下文（如 http 内网）下退化为简单字符串哈希，去重语义不变。
  let hash = 5381
  for (let i = 0; i < content.length; i += 1) {
    hash = ((hash << 5) + hash + content.charCodeAt(i)) | 0
  }
  return `fallback-${(hash >>> 0).toString(16)}`
}

function nextId(items: { id: number }[]): number {
  return items.reduce((max, item) => Math.max(max, item.id), 0) + 1
}

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {}
}

// 结构校验：任何不满足资料包约定的输入都直接判失败，由调用方整包退回。
function parsePackage(content: string): SurveyReconcilePackage {
  let parsed: unknown
  try {
    parsed = JSON.parse(content)
  } catch {
    throw new Error('资料包不是合法的 JSON 文件，已整包退回')
  }
  const root = asRecord(parsed)
  if (root.packageKind !== 'survey-reconcile') {
    throw new Error('资料包标识不是考古调查对账包（packageKind 不符），已整包退回')
  }
  if (!Array.isArray(root.records)) {
    throw new Error('资料包缺少调查记录列表 records，已整包退回')
  }
  const records: SurveyPackageRecord[] = root.records.map((item, index) => {
    const rec = asRecord(item)
    if (typeof rec.surveyNo !== 'string' || rec.surveyNo.trim() === '') {
      throw new Error(`第 ${index + 1} 条记录缺少调查编号，已整包退回`)
    }
    if (!Array.isArray(rec.surfaceFinds)) {
      throw new Error(`调查记录 ${rec.surveyNo} 缺少关联地表发现列表，已整包退回`)
    }
    const surfaceFinds: SurveySurfaceFind[] = rec.surfaceFinds.map((find, findIndex) => {
      const f = asRecord(find)
      const relicId = typeof f.relicId === 'string' ? f.relicId.trim() : ''
      const description = typeof f.description === 'string' ? f.description.trim() : ''
      if (!relicId && !description) {
        throw new Error(`调查记录 ${rec.surveyNo} 第 ${findIndex + 1} 条地表发现内容为空，已整包退回`)
      }
      return { relicId, description }
    })
    return {
      surveyNo: rec.surveyNo.trim(),
      area: typeof rec.area === 'string' ? rec.area : '',
      method: typeof rec.method === 'string' ? rec.method : '',
      surveyor: typeof rec.surveyor === 'string' ? rec.surveyor : '',
      surfaceFinds,
      sectionObservation: typeof rec.sectionObservation === 'string' ? rec.sectionObservation : '',
      preliminaryDating: typeof rec.preliminaryDating === 'string' ? rec.preliminaryDating : '',
    }
  })
  const seen = new Set<string>()
  for (const rec of records) {
    if (seen.has(rec.surveyNo)) {
      throw new Error(`资料包内调查编号 ${rec.surveyNo} 重复，已整包退回`)
    }
    seen.add(rec.surveyNo)
  }
  return {
    packageKind: 'survey-reconcile',
    packageNo: typeof root.packageNo === 'string' && root.packageNo ? root.packageNo : '未命名资料包',
    exportedAt: typeof root.exportedAt === 'string' ? root.exportedAt : '',
    records,
  }
}

// 只有包内字段非空时才回填，空白不覆盖平台已有内容；返回这条记录是否真的发生了更新。
function mergeSupplement(row: EntryRow, field: string, incoming: string): boolean {
  const value = incoming.trim()
  if (!value) {
    return false
  }
  if (String(row[field] ?? '').trim() === value) {
    return false
  }
  row[field] = value
  return true
}

export async function importSurveyPackage(content: string): Promise<ImportReconcileResult> {
  let pkg: SurveyReconcilePackage
  let contentHash: string
  try {
    pkg = parsePackage(content)
    contentHash = await hashContent(content)
  } catch (error) {
    return { ok: false, message: error instanceof Error ? error.message : '资料包解析失败，已整包退回' }
  }

  const reconcile = getReconcileState()

  if (reconcile.importedPackages.some((item) => item.contentHash === contentHash)) {
    // 同一资料包重复导入只更新一次：直接跳过，不动任何数据。
    return {
      ok: true,
      duplicate: true,
      packageNo: pkg.packageNo,
      message: `资料包 ${pkg.packageNo} 此前已导入过，本次不重复更新`,
      recordCount: pkg.records.length,
      updatedCount: 0,
      checklistCount: 0,
    }
  }

  // 先在内存里把整包跑完、校验完：调查编号必须能在平台对上，否则整包退回。
  const surveyRows = listRows(SURVEY_KEY).map((row) => ({ ...row }))
  const surveyByNo = new Map(surveyRows.map((row) => [String(row[SURVEY_NO] ?? ''), row]))
  for (const rec of pkg.records) {
    if (!surveyByNo.has(rec.surveyNo)) {
      return {
        ok: false,
        message: `调查编号 ${rec.surveyNo} 在平台调查记录中不存在，无法补充，已整包退回（未写入任何数据）`,
      }
    }
  }

  let updatedCount = 0
  for (const rec of pkg.records) {
    const row = surveyByNo.get(rec.surveyNo)!
    const touchedSection = mergeSupplement(row, SURVEY_SECTION, rec.sectionObservation)
    const touchedDating = mergeSupplement(row, SURVEY_DATING, rec.preliminaryDating)
    if (touchedSection || touchedDating) {
      // 同一条记录两个字段都回填也只计一条。
      updatedCount += 1
    }
    // 关联地表发现：平台字段为空时用包内内容补齐，平台已有内容则以平台为准。
    if (String(row[SURVEY_FINDS] ?? '').trim() === '' && rec.surfaceFinds.length) {
      row[SURVEY_FINDS] = rec.surfaceFinds.map(findToText).join('；')
    }
  }

  // 跨模块对账：遗迹编号以平台记录为准，查无对应编号只进待核验清单，绝不凭空建遗迹。
  const featureRows = listRows(FEATURE_KEY)
  const featureNos = new Set(featureRows.map((row) => String(row[FEATURE_NO] ?? '').toUpperCase()))
  const importedAt = new Date().toISOString()
  const newChecklist: FeatureChecklistItem[] = []
  let checklistId = nextId(reconcile.featureChecklist)
  const existingOpen = new Set(
    reconcile.featureChecklist
      .filter((item) => !item.resolved)
      .map((item) => `${item.surveyNo}@@${item.relicId}`),
  )
  for (const rec of pkg.records) {
    for (const find of rec.surfaceFinds) {
      if (!find.relicId || featureNos.has(find.relicId.toUpperCase())) {
        continue
      }
      const dedupeKey = `${rec.surveyNo}@@${find.relicId.toUpperCase()}`
      if (existingOpen.has(dedupeKey)) {
        continue
      }
      existingOpen.add(dedupeKey)
      newChecklist.push({
        id: checklistId,
        surveyNo: rec.surveyNo,
        area: rec.area,
        relicId: find.relicId.toUpperCase(),
        findDescription: find.description,
        reason: '包内遗迹编号在平台遗迹单位中查无对应，以平台记录为准，待现场核验',
        resolved: false,
        packageNo: pkg.packageNo,
        importedAt,
      })
      checklistId += 1
    }
  }

  const ledgerEntry: ImportedPackageRecord = {
    id: nextId(reconcile.importedPackages),
    packageNo: pkg.packageNo,
    contentHash,
    importedAt,
    recordCount: pkg.records.length,
    updatedCount,
    checklistCount: newChecklist.length,
  }

  const nextReconcile: ReconcileState = {
    importedPackages: [...reconcile.importedPackages, ledgerEntry],
    featureChecklist: [...reconcile.featureChecklist, ...newChecklist],
  }

  // 唯一一次落库：调查行、台账、待核验清单一起提交，任何写入异常都不会产生半份结果。
  try {
    commitAll(buildNextState({ [SURVEY_KEY]: surveyRows }, nextReconcile))
  } catch (error) {
    return {
      ok: false,
      message: error instanceof Error ? `资料包写入失败：${error.message}，已整包退回` : '资料包写入失败，已整包退回',
    }
  }

  return {
    ok: true,
    packageNo: pkg.packageNo,
    recordCount: pkg.records.length,
    updatedCount,
    checklistCount: newChecklist.length,
    message: `资料包 ${pkg.packageNo} 导入成功：共 ${pkg.records.length} 条调查记录，补充断面观察/初步断代 ${updatedCount} 条，新增待核验遗迹 ${newChecklist.length} 项`,
  }
}

export function listImportedPackages(): ImportedPackageRecord[] {
  return getReconcileState().importedPackages
}

export function listFeatureChecklist(includeResolved = false): FeatureChecklistItem[] {
  const items = getReconcileState().featureChecklist
  return includeResolved ? items : items.filter((item) => !item.resolved)
}

export function pendingFeatureChecklistCount(): number {
  return listFeatureChecklist(false).length
}

// 现场核验完成后勾销一条待核验项。
export function resolveFeatureChecklist(id: number): ActionResult {
  const reconcile = getReconcileState()
  const index = reconcile.featureChecklist.findIndex((item) => item.id === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条待核验项' }
  }
  if (reconcile.featureChecklist[index].resolved) {
    return { ok: false, message: '该待核验项已核验，无需重复操作' }
  }
  reconcile.featureChecklist[index] = { ...reconcile.featureChecklist[index], resolved: true }
  commitAll(buildNextState({}, reconcile))
  return { ok: true, message: '已标记为现场核验完成' }
}
