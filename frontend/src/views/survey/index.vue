<template>
  <section class="page" data-module="survey">
    <header class="page-head">
      <div>
        <h2>考古调查管理</h2>
        <p class="page-desc">维护调查记录，围绕调查编号、调查区域、调查方法、地表发现做登记、筛选与状态流转；支持资料对账包导出与补充导回。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记调查记录</button>
        <button class="btn" type="button" @click="exportRows">导出考古调查清单</button>
        <button class="btn" type="button" @click="exportPackage">导出资料对账包</button>
        <button class="btn" type="button" @click="triggerImport">导入资料对账包</button>
        <input
          ref="fileInput"
          type="file"
          accept="application/json,.json"
          hidden
          @change="onFileSelected"
        />
      </div>
    </header>

    <div class="stat-row">
      <article v-for="item in stats" :key="item.label" class="stat-card">
        <span class="stat-label">{{ item.label }}</span>
        <strong class="stat-value">{{ item.value }}</strong>
      </article>
    </div>

    <p class="status-legend">
      <span v-for="item in statusSummary" :key="item.status" class="legend-item">
        {{ item.status }}：{{ item.count }}
      </span>
    </p>

    <p v-if="importMessage" :class="['import-tip', importOk ? 'ok-text' : 'error-text']">
      {{ importMessage }}
    </p>

    <form class="filter-bar" @submit.prevent="reload">
      <label v-for="field in filterFields" :key="field" class="filter-item">
        <span>{{ field }}</span>
        <input v-model="filters[field]" :placeholder="`按${field}检索`" />
      </label>
      <button class="btn" type="submit">查询</button>
      <button class="btn ghost" type="button" @click="resetFilters">重置条件</button>
    </form>

    <table class="data-table">
      <thead>
        <tr>
          <th v-for="column in columns" :key="column">{{ column }}</th>
          <th>当前状态</th>
          <th>可执行动作</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="row in rows" :key="String(row.id)">
          <td v-for="column in columns" :key="column">{{ row[column] ?? '—' }}</td>
          <td>{{ row.status }}</td>
          <td class="row-actions">
            <button
              v-for="action in actions"
              :key="action"
              class="link"
              type="button"
              @click="runAction(action, row)"
            >
              {{ action }}
            </button>
          </td>
        </tr>
        <tr v-if="!rows.length">
          <td :colspan="columns.length + 2" class="empty-state">暂无考古调查数据，可先登记调查记录</td>
        </tr>
      </tbody>
    </table>

    <section class="reconcile-ledger">
      <h3>已导入资料包台账</h3>
      <p class="page-desc">同一资料包按内容判定，重复导入只更新一次。</p>
      <table class="data-table">
        <thead>
          <tr>
            <th>资料包编号</th>
            <th>导入时间</th>
            <th>调查记录数</th>
            <th>补充更新条数</th>
            <th>新增待核验遗迹</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in importedPackages" :key="item.id">
            <td>{{ item.packageNo }}</td>
            <td>{{ formatTime(item.importedAt) }}</td>
            <td>{{ item.recordCount }}</td>
            <td>{{ item.updatedCount }}</td>
            <td>{{ item.checklistCount }}</td>
          </tr>
          <tr v-if="!importedPackages.length">
            <td colspan="5" class="empty-state">尚未导入过资料对账包</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条考古调查记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  downloadSurveyPackage,
  importSurveyPackage,
  listEntries,
  listImportedPackages,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, ImportedPackageRecord } from '@/data/types'

const meta = moduleMeta('survey')
const columns = ["调查编号", "调查区域", "调查方法", "地表发现", "断面观察", "初步断代", "调查人", "记录状态"]
const actions = ["完成记录", "提交审核", "安排复查"]
const statuses = ["调查中", "已记录", "已审核", "需复查"]
const stats = [{"label": "调查次数", "value": 0}, {"label": "已审核记录", "value": 0}, {"label": "待复查记录", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const importedPackages = ref<ImportedPackageRecord[]>([])
const fileInput = ref<HTMLInputElement | null>(null)
const importMessage = ref('')
const importOk = ref(true)
const importing = ref(false)
const statusSummary = computed(() =>
  statuses.map((status: string) => ({
    status,
    count: rows.value.filter((row) => String(row.status) === status).length,
  })),
)

function resetFilters() {
  filters.value = {}
  reload()
}

function exportRows() {
  downloadEntries(meta.key)
}

// 对账包按当前筛选条件导出调查记录及关联地表发现。
function exportPackage() {
  importMessage.value = ''
  downloadSurveyPackage(filters.value)
}

function triggerImport() {
  importMessage.value = ''
  fileInput.value?.click()
}

async function onFileSelected(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || importing.value) {
    return
  }
  importing.value = true
  try {
    const content = await file.text()
    const result = await importSurveyPackage(content)
    importOk.value = result.ok
    importMessage.value = result.message
    if (result.ok) {
      reload()
    }
  } catch (error) {
    importOk.value = false
    importMessage.value = error instanceof Error ? error.message : '资料包读取失败，已整包退回'
  } finally {
    importing.value = false
  }
}

function formatTime(value: string): string {
  if (!value) {
    return '—'
  }
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString()
}

function openCreate() {
  errorMessage.value = '调查记录登记入口尚未接入审批流'
}

function runAction(action: string, row: EntryRow) {
  errorMessage.value = ''
  const result = applyAction(meta.key, Number(row.id), action)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function reload() {
  errorMessage.value = ''
  try {
    const payload = listEntries(meta.key, filters.value)
    rows.value = payload.items
    total.value = payload.total
    importedPackages.value = listImportedPackages()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '考古调查列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.page-actions {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}
.import-tip {
  margin: 0 0 10px;
  font-size: 13px;
}
.ok-text {
  color: #067647;
}
.reconcile-ledger {
  margin-top: 18px;
}
.reconcile-ledger h3 {
  font-size: 15px;
  margin: 0 0 4px;
}
</style>
