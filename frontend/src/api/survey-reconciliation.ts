import { downloadTextFile, filterRows } from '@/api/local-service'
import { listRows, saveMany, saveRows } from '@/data/local-store'
import type { ActionResult, EntryRow } from '@/data/types'

// 考古调查「资料对账包」：按调查编号、调查区域、调查方法导出调查记录及关联地表发现，
// 现场离线补充断面观察、初步断代后再导入平台对账。
//
// 冲突策略（实现者决策）：包内调查记录与平台遗迹编号不一致时，一律以平台记录为准，
// 平台数据不被包覆盖，差异写进遗迹单位页的待核验清单，由人工确认。
//
// 兼容性：旧记录缺少「调查方法」时按空白处理，不报错；平台记录该字段为空白时用包内值补齐。
//
// 幂等与原子性：每个包有唯一包编号，同一包编号重复导入只生效一次；
// 整包先校验、再一次落盘，任何一份记录写入失败整个包退回，不留半份结果。

const PACKAGE_KIND = 'survey-reconciliation'
const PACKAGE_VERSION = 1
const SURVEY_KEY = 'survey'
const FEATURE_KEY = 'feature'
const LOG_KEY = 'survey_packages'
const VERIFY_KEY = 'feature_verification'

// 对账包携带的调查记录字段；旧包可能缺「调查方法」，导入时按空白兼容。
const SURVEY_FIELDS = ['调查编号', '调查区域', '调查方法', '地表发现', '断面观察', '初步断代', '调查人'] as const
// 导入时允许继续补充的字段：只有这两列会从包内写回平台。
const SUPPLEMENT_FIELDS = ['断面观察', '初步断代'] as const
const LINK_FIELD = '关联遗迹编号'
// 导出筛选只认这三个条件：调查编号、调查区域、调查方法。
const EXPORT_FILTER_FIELDS = ['调查编号', '调查区域', '调查方法'] as const
const CONFLICT_POLICY = '平台记录为准'

// 遗迹编号形如 FEAT-0001，从地表发现描述与关联字段里识别关联遗迹。
const FEATURE_CODE_PATTERN = /FEAT-\d+/g

export type PackageImportResult = ActionResult & { imported: boolean }

type PackageSurveyEntry = Record<string, string>

type ReconciliationPackage = {
  kind: typeof PACKAGE_KIND
  version: number
  packageId: string
  exportedAt: string
  conflictPolicy: string
  filters: Record<string, string>
  surveys: PackageSurveyEntry[]
  features: PackageSurveyEntry[]
}

function nowText(): string {
  return new Date().toISOString().slice(0, 19).replace('T', ' ')
}

function makePackageId(): string {
  const day = new Date().toISOString().slice(0, 10).replace(/-/g, '')
  const suffix = Math.random().toString(36).slice(2, 8).toUpperCase()
  return `SURVP-${day}-${suffix}`
}

function fail(message: string): PackageImportResult {
  return { ok: false, imported: false, message }
}

export function extractFeatureCodes(text: string): string[] {
  return [...new Set(text.match(FEATURE_CODE_PATTERN) ?? [])]
}

// 按调查编号/调查区域/调查方法筛选，导出调查记录及关联地表发现、关联遗迹快照。
export function buildReconciliationPackage(filters: Record<string, string>): { filename: string; content: string } {
  const picked: Record<string, string> = {}
  for (const field of EXPORT_FILTER_FIELDS) {
    picked[field] = (filters[field] ?? '').trim()
  }
  const surveys: PackageSurveyEntry[] = filterRows(listRows(SURVEY_KEY), picked).map((row) => {
    const entry: PackageSurveyEntry = {}
    for (const field of SURVEY_FIELDS) {
      entry[field] = String(row[field] ?? '')
    }
    entry[LINK_FIELD] = extractFeatureCodes(entry['地表发现']).join(';')
    return entry
  })
  const linkedCodes = new Set(surveys.flatMap((entry) => extractFeatureCodes(entry[LINK_FIELD])))
  const features: PackageSurveyEntry[] = listRows(FEATURE_KEY)
    .filter((row) => linkedCodes.has(String(row['遗迹编号'] ?? '')))
    .map((row) => ({
      '遗迹编号': String(row['遗迹编号'] ?? ''),
      '所属探方': String(row['所属探方'] ?? ''),
      '遗迹类型': String(row['遗迹类型'] ?? ''),
      '开口层位': String(row['开口层位'] ?? ''),
    }))
  const pkg: ReconciliationPackage = {
    kind: PACKAGE_KIND,
    version: PACKAGE_VERSION,
    packageId: makePackageId(),
    exportedAt: new Date().toISOString(),
    conflictPolicy: CONFLICT_POLICY,
    filters: picked,
    surveys,
    features,
  }
  return { filename: `考古调查-资料对账包-${pkg.packageId}.json`, content: JSON.stringify(pkg, null, 2) }
}

export function downloadReconciliationPackage(filters: Record<string, string>): void {
  const { filename, content } = buildReconciliationPackage(filters)
  downloadTextFile(filename, content, 'application/json;charset=utf-8')
}

// 导入资料对账包：先整包校验，再一次落盘；任何一份记录失败，整个包退回。
export function importReconciliationPackage(text: string): PackageImportResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch {
    return fail('资料包不是合法的 JSON 文件，未写入任何数据')
  }
  const pkg = raw as Partial<ReconciliationPackage> | null
  if (!pkg || typeof pkg !== 'object' || Array.isArray(pkg)) {
    return fail('文件内容不是资料对账包，未写入任何数据')
  }
  if (pkg.kind !== PACKAGE_KIND) {
    return fail('文件不是考古调查资料对账包，未写入任何数据')
  }
  const packageId = typeof pkg.packageId === 'string' ? pkg.packageId.trim() : ''
  if (!packageId) {
    return fail('资料包缺少包编号，未写入任何数据')
  }
  if (!Array.isArray(pkg.surveys)) {
    return fail('资料包缺少调查记录列表，未写入任何数据')
  }

  // 幂等：同一包编号只更新一次，重复导入直接跳过。
  const logRows = listRows(LOG_KEY)
  if (logRows.some((row) => String(row['包编号']) === packageId)) {
    return { ok: true, imported: false, message: `资料包 ${packageId} 已导入过，同一资料包只更新一次，本次未重复写入` }
  }

  // 整包校验：任何一份记录不合格，整个包退回，不写半份结果。
  const entries: PackageSurveyEntry[] = []
  const seen = new Set<string>()
  for (let index = 0; index < pkg.surveys.length; index += 1) {
    const item = pkg.surveys[index] as unknown
    const label = `第 ${index + 1} 份调查记录`
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return fail(`${label}格式损坏，整个资料包已退回`)
    }
    const source = item as Record<string, unknown>
    const code = String(source['调查编号'] ?? '').trim()
    if (!code) {
      return fail(`${label}缺少调查编号，整个资料包已退回`)
    }
    if (seen.has(code)) {
      return fail(`调查编号 ${code} 在包内重复，整个资料包已退回`)
    }
    seen.add(code)
    const entry: PackageSurveyEntry = {}
    for (const field of [...SURVEY_FIELDS, LINK_FIELD]) {
      const value = source[field]
      if (value === undefined || value === null) {
        entry[field] = '' // 旧记录缺少调查方法等字段时按空白兼容
        continue
      }
      if (typeof value === 'object') {
        return fail(`${label}的「${field}」内容无法识别，整个资料包已退回`)
      }
      entry[field] = String(value)
    }
    entries.push(entry)
  }

  // 在内存里合并：断面观察、初步断代允许用包内值补充；关联遗迹编号冲突时平台记录为准。
  const nextSurveys = listRows(SURVEY_KEY).map((row) => ({ ...row }))
  const nextVerify = listRows(VERIFY_KEY).map((row) => ({ ...row }))
  const featureCodes = new Set(listRows(FEATURE_KEY).map((row) => String(row['遗迹编号'] ?? '')))
  const importedAt = nowText()
  let verifyId = nextVerify.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0)
  let created = 0
  let updated = 0
  let conflicts = 0
  let verifyAdded = 0

  const addVerification = (surveyCode: string, featureCode: string, matter: string, strategy: string): void => {
    verifyId += 1
    verifyAdded += 1
    nextVerify.push({
      id: verifyId,
      status: '待核验',
      pending: true,
      abnormal: false,
      '包编号': packageId,
      '调查编号': surveyCode,
      '遗迹编号': featureCode,
      '核验事项': matter,
      '处理策略': strategy,
      '登记时间': importedAt,
    })
  }

  const verifyLinkedFeatures = (surveyCode: string, links: string[], matter: string): void => {
    for (const featureCode of links) {
      if (featureCodes.has(featureCode)) {
        addVerification(surveyCode, featureCode, matter, '已并入平台，待人工核验')
      } else {
        conflicts += 1
        addVerification(surveyCode, featureCode, '包内关联的遗迹编号在平台不存在', CONFLICT_POLICY)
      }
    }
  }

  for (const entry of entries) {
    const code = entry['调查编号']
    const packageLinks = extractFeatureCodes(`${entry[LINK_FIELD]};${entry['地表发现']}`)
    const index = nextSurveys.findIndex((row) => String(row['调查编号'] ?? '') === code)
    if (index >= 0) {
      const merged = { ...nextSurveys[index] }
      for (const field of SUPPLEMENT_FIELDS) {
        if (entry[field].trim()) {
          merged[field] = entry[field]
        }
      }
      if (!String(merged['调查方法'] ?? '').trim() && entry['调查方法'].trim()) {
        merged['调查方法'] = entry['调查方法']
      }
      const platformLinks = extractFeatureCodes(`${String(merged[LINK_FIELD] ?? '')};${String(merged['地表发现'] ?? '')}`)
      const onlyInPackage = packageLinks.filter((item) => !platformLinks.includes(item))
      const onlyOnPlatform = platformLinks.filter((item) => !packageLinks.includes(item))
      if (onlyInPackage.length > 0 || onlyOnPlatform.length > 0) {
        // 冲突：平台记录为准，平台数据不动，只登记待核验。
        conflicts += 1
        addVerification(
          code,
          [...onlyInPackage, ...onlyOnPlatform].join(';'),
          `关联遗迹编号不一致（包内：${packageLinks.join('、') || '无'}；平台：${platformLinks.join('、') || '无'}）`,
          CONFLICT_POLICY,
        )
      } else {
        verifyLinkedFeatures(code, packageLinks, '对账包补充了断面观察/初步断代，关联遗迹需核验')
      }
      nextSurveys[index] = merged
      updated += 1
    } else {
      const nextId = nextSurveys.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1
      nextSurveys.push({
        id: nextId,
        status: '调查中',
        pending: true,
        abnormal: false,
        '调查编号': code,
        '调查区域': entry['调查区域'],
        '调查方法': entry['调查方法'],
        '地表发现': entry['地表发现'],
        '断面观察': entry['断面观察'],
        '初步断代': entry['初步断代'],
        '调查人': entry['调查人'],
        '记录状态': '对账包导入',
      })
      created += 1
      verifyLinkedFeatures(code, packageLinks, '对账包新增调查记录，关联遗迹需核验')
    }
  }

  const nextLog = [
    ...logRows,
    {
      id: logRows.reduce((max, row) => Math.max(max, Number(row.id) || 0), 0) + 1,
      status: '已导入',
      pending: false,
      abnormal: false,
      '包编号': packageId,
      '导入时间': importedAt,
      '调查记录数': entries.length,
      '新增记录': created,
      '更新记录': updated,
      '待核验条目': verifyAdded,
      '冲突条数': conflicts,
    },
  ]

  // 一次落盘：调查记录、待核验清单、导入日志一起写，任何一步失败都不会留下半份结果。
  try {
    saveMany({ [SURVEY_KEY]: nextSurveys, [VERIFY_KEY]: nextVerify, [LOG_KEY]: nextLog })
  } catch (error) {
    return fail(`写入失败，整个资料包已退回：${error instanceof Error ? error.message : '存储不可用'}`)
  }
  return {
    ok: true,
    imported: true,
    message: `资料包 ${packageId} 导入成功：新增 ${created} 份、更新 ${updated} 份调查记录，遗迹单位页新增 ${verifyAdded} 条待核验`,
  }
}

// 遗迹单位页的待核验清单：来自对账包导入，核验后标记已核验。
export function listFeatureVerifications(): EntryRow[] {
  return listRows(VERIFY_KEY)
}

export function listPackageImports(): EntryRow[] {
  return listRows(LOG_KEY)
}

export function markFeatureVerified(id: number): ActionResult {
  const rows = listRows(VERIFY_KEY)
  const index = rows.findIndex((row) => Number(row.id) === id)
  if (index < 0) {
    return { ok: false, message: '没有找到这条待核验记录' }
  }
  if (rows[index].status === '已核验') {
    return { ok: false, message: '该条目已核验，不用重复操作' }
  }
  const next = [...rows]
  next[index] = { ...rows[index], status: '已核验', pending: false }
  saveRows(VERIFY_KEY, next)
  return { ok: true, message: '已确认核验' }
}
