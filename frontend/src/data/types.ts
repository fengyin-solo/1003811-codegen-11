/** 纯前端数据层的公共类型：与全栈版后端返回的结构保持一致，换回后端时页面不用改。 */

export type EntryRow = {
  id: number
  status: string
  pending: boolean
  abnormal: boolean
  [field: string]: string | number | boolean
}

export type ModuleMeta = {
  key: string
  name: string
  entity: string
  desc: string
  fields: string[]
  statuses: string[]
  actions: string[]
  actionTargets: Record<string, string>
  metrics: string[]
}

export type PageResult = {
  items: EntryRow[]
  total: number
  page: number
  size: number
}

export type ActionResult = {
  ok: boolean
  message: string
}

export type OverviewResult = {
  cards: { label: string; value: number }[]
  modules: { name: string; created: number; pending: number; abnormal: number }[]
}

// 调查资料对账包：导出调查记录及其关联地表发现，导回时允许补充断面观察、初步断代。
export type SurveySurfaceFind = {
  relicId: string
  description: string
}

export type SurveyPackageRecord = {
  surveyNo: string
  area: string
  method: string
  surveyor: string
  surfaceFinds: SurveySurfaceFind[]
  sectionObservation: string
  preliminaryDating: string
}

export type SurveyReconcilePackage = {
  packageKind: 'survey-reconcile'
  packageNo: string
  exportedAt: string
  records: SurveyPackageRecord[]
}

// 遗迹单位页的待核验清单项：包内遗迹编号与平台记录对不上时生成，平台记录保持不动。
export type FeatureChecklistItem = {
  id: number
  surveyNo: string
  area: string
  relicId: string
  findDescription: string
  reason: string
  resolved: boolean
  packageNo: string
  importedAt: string
}

// 已成功导入的资料包台账：同一资料包（以内容哈希为准）只允许导入一次。
export type ImportedPackageRecord = {
  id: number
  packageNo: string
  contentHash: string
  importedAt: string
  recordCount: number
  updatedCount: number
  checklistCount: number
}

export type ReconcileState = {
  importedPackages: ImportedPackageRecord[]
  featureChecklist: FeatureChecklistItem[]
}

export type ImportReconcileResult = {
  ok: boolean
  message: string
  duplicate?: boolean
  packageNo?: string
  recordCount?: number
  updatedCount?: number
  checklistCount?: number
}
