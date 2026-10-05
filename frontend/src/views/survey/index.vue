<template>
  <section class="page" data-module="survey">
    <header class="page-head">
      <div>
        <h2>考古调查管理</h2>
        <p class="page-desc">维护调查记录，围绕调查编号、调查区域、调查方法、地表发现做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记调查记录</button>
        <button class="btn" type="button" @click="exportRows">导出考古调查清单</button>
        <button class="btn" type="button" @click="exportPackage">导出资料对账包</button>
        <button class="btn" type="button" @click="pickPackageFile">导入资料对账包</button>
        <input ref="packageFileInput" type="file" accept=".json,application/json" hidden @change="importPackage" />
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

    <section class="sub-panel">
      <h3 class="sub-title">资料对账包导入记录</h3>
      <table class="data-table">
        <thead>
          <tr>
            <th>包编号</th>
            <th>导入时间</th>
            <th>调查记录数</th>
            <th>新增</th>
            <th>更新</th>
            <th>待核验条目</th>
            <th>冲突</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="log in packageLogs" :key="String(log.id)">
            <td>{{ log['包编号'] }}</td>
            <td>{{ log['导入时间'] }}</td>
            <td>{{ log['调查记录数'] }}</td>
            <td>{{ log['新增记录'] }}</td>
            <td>{{ log['更新记录'] }}</td>
            <td>{{ log['待核验条目'] }}</td>
            <td>{{ log['冲突条数'] }}</td>
          </tr>
          <tr v-if="!packageLogs.length">
            <td colspan="7" class="empty-state">尚未导入资料对账包，可按上方筛选条件导出后离线补充再导入</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条考古调查记录</span>
      <span v-if="noticeMessage" class="notice-text">{{ noticeMessage }}</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  moduleMeta,
  runAction as applyAction,
} from '@/api/local-service'
import {
  downloadReconciliationPackage,
  importReconciliationPackage,
  listPackageImports,
} from '@/api/survey-reconciliation'
import type { EntryRow } from '@/data/types'

const meta = moduleMeta('survey')
const columns = ["调查编号", "调查区域", "调查方法", "地表发现", "断面观察", "初步断代", "调查人", "记录状态"]
const actions = ["完成记录", "提交审核", "安排复查"]
const statuses = ["调查中", "已记录", "已审核", "需复查"]
const stats = [{"label": "调查次数", "value": 0}, {"label": "已审核记录", "value": 0}, {"label": "待复查记录", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const noticeMessage = ref('')
const filters = ref<Record<string, string>>({})
const packageLogs = ref<EntryRow[]>([])
const packageFileInput = ref<HTMLInputElement | null>(null)
const filterFields = columns.slice(0, 3)
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

// 资料对账包按当前筛选条件（调查编号/调查区域/调查方法）导出。
function exportPackage() {
  downloadReconciliationPackage(filters.value)
}

function pickPackageFile() {
  packageFileInput.value?.click()
}

async function importPackage(event: Event) {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file) {
    return
  }
  errorMessage.value = ''
  noticeMessage.value = ''
  try {
    const result = importReconciliationPackage(await file.text())
    if (!result.ok) {
      errorMessage.value = result.message
      return
    }
    noticeMessage.value = result.message
    reload()
  } catch {
    errorMessage.value = '资料包读取失败，未写入任何数据'
  }
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
    packageLogs.value = listPackageImports()
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '考古调查列表读取失败'
  }
}

onMounted(reload)
</script>
