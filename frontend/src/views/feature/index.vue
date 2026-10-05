<template>
  <section class="page" data-module="feature">
    <header class="page-head">
      <div>
        <h2>遗迹单位管理</h2>
        <p class="page-desc">维护遗迹，围绕遗迹编号、所属探方、遗迹类型、开口层位做登记、筛选与状态流转。</p>
      </div>
      <div class="page-actions">
        <button class="btn primary" type="button" @click="openCreate">登记遗迹</button>
        <button class="btn" type="button" @click="exportRows">导出遗迹单位清单</button>
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
          <td :colspan="columns.length + 2" class="empty-state">暂无遗迹单位数据，可先登记遗迹</td>
        </tr>
      </tbody>
    </table>

    <section class="checklist">
      <h3>调查对账待核验清单（{{ checklist.length }}）</h3>
      <p class="page-desc">
        来自考古调查资料对账包：包内遗迹编号与平台记录不一致时以平台记录为准，下列编号查无对应遗迹，待现场核对原件后勾销。
      </p>
      <table class="data-table">
        <thead>
          <tr>
            <th>来源调查编号</th>
            <th>调查区域</th>
            <th>包内遗迹编号</th>
            <th>关联地表发现</th>
            <th>核验原因</th>
            <th>来源资料包</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="item in checklist" :key="item.id">
            <td>{{ item.surveyNo }}</td>
            <td>{{ item.area || '—' }}</td>
            <td>{{ item.relicId }}</td>
            <td>{{ item.findDescription || '—' }}</td>
            <td>{{ item.reason }}</td>
            <td>{{ item.packageNo }}</td>
            <td class="row-actions">
              <button class="link" type="button" @click="resolveItem(item.id)">现场核验完成</button>
            </td>
          </tr>
          <tr v-if="!checklist.length">
            <td colspan="7" class="empty-state">暂无待核验遗迹，调查对账记录均已与平台对上</td>
          </tr>
        </tbody>
      </table>
    </section>

    <footer class="page-foot">
      <span>共 {{ total }} 条遗迹单位记录</span>
      <span v-if="errorMessage" class="error-text">{{ errorMessage }}</span>
    </footer>
  </section>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'

import {
  downloadEntries,
  listEntries,
  listFeatureChecklist,
  moduleMeta,
  resolveFeatureChecklist,
  runAction as applyAction,
} from '@/api/local-service'
import type { EntryRow, FeatureChecklistItem } from '@/data/types'

const meta = moduleMeta('feature')
const columns = ["遗迹编号", "所属探方", "遗迹类型", "开口层位", "打破关系", "平面形状", "填土特征", "记录状态"]
const actions = ["开始清理", "完成测绘", "执行解剖"]
const statuses = ["已揭露", "清理中", "已完绘", "已解剖", "已归档"]
const stats = [{"label": "遗迹总数", "value": 0}, {"label": "清理中遗迹", "value": 0}, {"label": "已完绘遗迹", "value": 0}]

const rows = ref<EntryRow[]>([])
const total = ref(0)
const errorMessage = ref('')
const filters = ref<Record<string, string>>({})
const filterFields = columns.slice(0, 3)
const checklist = ref<FeatureChecklistItem[]>([])
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

function resolveItem(id: number) {
  errorMessage.value = ''
  const result = resolveFeatureChecklist(id)
  if (!result.ok) {
    errorMessage.value = result.message
    return
  }
  reload()
}

function openCreate() {
  errorMessage.value = '遗迹登记入口尚未接入审批流'
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
    checklist.value = listFeatureChecklist(false)
  } catch (error) {
    errorMessage.value = error instanceof Error ? error.message : '遗迹单位列表读取失败'
  }
}

onMounted(reload)
</script>

<style scoped>
.checklist {
  margin-top: 18px;
}
.checklist h3 {
  font-size: 15px;
  margin: 0 0 4px;
}
</style>
