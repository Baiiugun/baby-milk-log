import { WavRecorder } from "./audio-recorder.js";
import { buildDailyFromRecords, computeMilkStats } from "./stats.js";

// 仅包含公开云函数地址与匿名公开密钥（不含任何 API Key 或管理密钥）
const API_URL = "https://br-cute-tahr-8eff7472.supabase.aidap-global.cn-beijing.volces.com/functions/v1/milk-log-api";
const PUBLIC_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1wbGF0Zm9ybSIsInJvbGUiOiJhbm9uIiwiZXhwIjozNjg2OTI1NzYzfQ.y45vSsbxFjV9k-psYujSR2YMtDOeZW_IDZS6eBlbRFc";
const TOKEN_STORAGE_KEY = "baby_milk_family_token_v1";

const ICON_STATS_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M4 20h16"/>
    <rect x="6" y="12" width="3" height="8" rx="1"/>
    <rect x="11" y="7" width="3" height="13" rx="1"/>
    <rect x="16" y="4" width="3" height="16" rx="1"/>
  </svg>
`;

const ICON_HOME_SVG = `
  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M9 5H7a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2"/>
    <rect x="9" y="3" width="6" height="4" rx="1"/>
    <path d="M9 12h6"/>
    <path d="M9 16h4"/>
  </svg>
`;

const el = {
  authGate: document.getElementById("authGate"),
  authForm: document.getElementById("authForm"),
  authInput: document.getElementById("authInput"),
  authError: document.getElementById("authError"),
  topbarBrand: document.getElementById("topbarBrand"),
  todayLabel: document.getElementById("todayLabel"),
  btnTabStats: document.getElementById("btnTabStats"),
  tabNavIcon: document.getElementById("tabNavIcon"),
  tabNavLabel: document.getElementById("tabNavLabel"),
  btnRefresh: document.getElementById("btnRefresh"),
  homeView: document.getElementById("homeView"),
  statsView: document.getElementById("statsView"),
  btnBackHome: document.getElementById("btnBackHome"),
  btnScopeIncludeToday: document.getElementById("btnScopeIncludeToday"),
  btnScopeExcludeToday: document.getElementById("btnScopeExcludeToday"),
  statsNotice: document.getElementById("statsNotice"),
  statsSummaryCards: document.getElementById("statsSummaryCards"),
  weeklyCardSub: document.getElementById("weeklyCardSub"),
  weeklyBarChart: document.getElementById("weeklyBarChart"),
  weeklyPeriodsList: document.getElementById("weeklyPeriodsList"),
  fiveDayCardSub: document.getElementById("fiveDayCardSub"),
  fiveDayPeriodsList: document.getElementById("fiveDayPeriodsList"),
  monthlyPeriodsList: document.getElementById("monthlyPeriodsList"),
  statTodayTotal: document.getElementById("statTodayTotal"),
  statTodayCount: document.getElementById("statTodayCount"),
  statSinceLast: document.getElementById("statSinceLast"),
  statLastDetail: document.getElementById("statLastDetail"),
  btnMic: document.getElementById("btnMic"),
  micIcon: document.getElementById("micIcon"),
  micTitle: document.getElementById("micTitle"),
  micSub: document.getElementById("micSub"),
  micLiveBar: document.getElementById("micLiveBar"),
  micMeterFill: document.getElementById("micMeterFill"),
  micTimer: document.getElementById("micTimer"),
  btnMicCancel: document.getElementById("btnMicCancel"),
  textForm: document.getElementById("textForm"),
  textInput: document.getElementById("textInput"),
  btnSubmitText: document.getElementById("btnSubmitText"),
  btnOpenManual: document.getElementById("btnOpenManual"),
  toast: document.getElementById("toast"),
  toastTitle: document.getElementById("toastTitle"),
  toastDetail: document.getElementById("toastDetail"),
  btnUndo: document.getElementById("btnUndo"),
  dateFilter: document.getElementById("dateFilter"),
  btnExportCsv: document.getElementById("btnExportCsv"),
  dailySummaryBar: document.getElementById("dailySummaryBar"),
  recordsTbody: document.getElementById("recordsTbody"),
  editModal: document.getElementById("editModal"),
  modalTitle: document.getElementById("modalTitle"),
  btnCloseModal: document.getElementById("btnCloseModal"),
  btnCancelModal: document.getElementById("btnCancelModal"),
  editForm: document.getElementById("editForm"),
  editId: document.getElementById("editId"),
  editDate: document.getElementById("editDate"),
  editTime: document.getElementById("editTime"),
  editAmount: document.getElementById("editAmount"),
  editNote: document.getElementById("editNote"),
  editRawPreview: document.getElementById("editRawPreview"),
  btnSaveModal: document.getElementById("btnSaveModal"),
};

let familyToken = "";
let allRecords = [];
let dailyStatsRows = [];
let statsLoaded = false;
let activeTab = "home";
let excludeToday = false;
let expandState = { weekly: false, fiveDay: false, monthly: false };
let busy = false;
let lastInsertedIds = [];
let toastTimer = null;

function pad2(n) {
  return String(n).padStart(2, "0");
}

function getLocalNow() {
  const d = new Date();
  const date = `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
  const time = `${pad2(d.getHours())}:${pad2(d.getMinutes())}`;
  let tz = "Asia/Shanghai";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || tz;
  } catch {
    // fallback
  }
  return { date, time, tz, rawDate: d };
}

function getYesterdayStr() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function readTokenFromUrlOrStorage() {
  const hash = window.location.hash || "";
  const match = hash.match(/(?:^#|&)k=([^&]+)/);
  if (match && match[1]) {
    const token = decodeURIComponent(match[1]).trim();
    if (token) {
      try {
        localStorage.setItem(TOKEN_STORAGE_KEY, token);
      } catch {
        // ignore storage errors
      }
      return token;
    }
  }
  try {
    return (localStorage.getItem(TOKEN_STORAGE_KEY) || "").trim();
  } catch {
    return "";
  }
}

function readTabFromHash() {
  const hash = window.location.hash || "";
  const match = hash.match(/(?:^#|&)tab=([^&]+)/);
  return match && decodeURIComponent(match[1]) === "stats" ? "stats" : "home";
}

function buildHash(token, tab) {
  const parts = [];
  if (token) parts.push(`k=${encodeURIComponent(token)}`);
  if (tab === "stats") parts.push("tab=stats");
  return parts.length ? `#${parts.join("&")}` : "";
}

function saveToken(token) {
  familyToken = token.trim();
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, familyToken);
  } catch {
    // ignore
  }
  // 保留 #k=... 在地址栏中，便于添加到手机主屏幕后依然自动免登录
  const targetHash = buildHash(familyToken, activeTab);
  if (familyToken && window.location.hash !== targetHash) {
    try {
      window.history.replaceState(null, "", targetHash);
    } catch {
      // ignore
    }
  }
}

function showAuthGate(errMsg = "") {
  el.authGate.classList.remove("hidden");
  if (errMsg) {
    el.authError.textContent = errMsg;
    el.authError.classList.remove("hidden");
  } else {
    el.authError.classList.add("hidden");
  }
  el.authInput.focus();
}

function hideAuthGate() {
  el.authGate.classList.add("hidden");
  el.authError.classList.add("hidden");
}

function showToast(title, detail = "", { isError = false, undoIds = [] } = {}) {
  if (toastTimer) {
    clearTimeout(toastTimer);
    toastTimer = null;
  }
  el.toast.classList.remove("hidden", "error");
  if (isError) el.toast.classList.add("error");
  el.toastTitle.textContent = title;
  el.toastDetail.textContent = detail;
  el.toastDetail.classList.toggle("hidden", !detail);

  lastInsertedIds = undoIds;
  el.btnUndo.classList.toggle("hidden", !undoIds.length);

  toastTimer = window.setTimeout(() => {
    el.toast.classList.add("hidden");
  }, undoIds.length ? 12000 : 6000);
}

async function apiCall(payload) {
  const now = getLocalNow();
  const body = {
    client_date: now.date,
    client_time: now.time,
    client_tz: now.tz,
    ...payload,
  };
  const resp = await fetch(API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: PUBLIC_ANON_KEY,
      "X-Family-Token": familyToken,
    },
    body: JSON.stringify(body),
  });

  const data = await resp.json().catch(() => ({ ok: false, error: `服务返回异常 (${resp.status})` }));
  if (resp.status === 401) {
    showAuthGate(data.error || "家庭口令无效，请重新输入");
    throw new Error(data.error || "口令无效");
  }
  return { status: resp.status, data };
}

function formatTimeHHMM(timeStr) {
  if (!timeStr) return "--:--";
  return String(timeStr).slice(0, 5);
}

function formatFriendlyDate(dateStr) {
  const today = getLocalNow().date;
  const yesterday = getYesterdayStr();
  const short = dateStr.slice(5); // MM-DD
  if (dateStr === today) return { short, tag: "今天" };
  if (dateStr === yesterday) return { short, tag: "昨天" };
  return { short, tag: "" };
}

function parseLocalDateTime(dateStr, timeStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const parts = String(timeStr || "00:00").split(":").map(Number);
  return new Date(y, (m || 1) - 1, d || 1, parts[0] || 0, parts[1] || 0, parts[2] || 0);
}

function formatDurationSince(record) {
  if (!record) return { main: "暂无", sub: "还没有喂奶记录" };
  const recDate = parseLocalDateTime(record.feeding_date, record.feeding_time);
  const diffMin = Math.floor((Date.now() - recDate.getTime()) / 60000);
  const hhmm = formatTimeHHMM(record.feeding_time);
  const friendly = formatFriendlyDate(record.feeding_date);
  const sub = `${friendly.tag || friendly.short} ${hhmm} · ${record.amount_ml} ml`;

  if (diffMin < 0) return { main: "刚预约", sub };
  if (diffMin < 1) return { main: "刚刚", sub };
  if (diffMin < 60) return { main: `${diffMin} 分钟前`, sub };
  const h = Math.floor(diffMin / 60);
  const m = diffMin % 60;
  if (h < 24) return { main: m ? `${h}小时${m}分` : `${h} 小时`, sub };
  const days = Math.floor(h / 24);
  return { main: `${days} 天前`, sub };
}

function updateTopDateLabel() {
  const d = new Date();
  const weekdays = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  el.todayLabel.textContent = `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日 ${weekdays[d.getDay()]}`;
}

function renderStats() {
  const today = getLocalNow().date;
  const todayList = allRecords.filter((r) => r.feeding_date === today);
  const todayTotal = todayList.reduce((sum, r) => sum + (Number(r.amount_ml) || 0), 0);
  el.statTodayTotal.textContent = String(todayTotal);
  el.statTodayCount.textContent = `今日共 ${todayList.length} 次`;

  const latest = allRecords[0] || null;
  const since = formatDurationSince(latest);
  el.statSinceLast.textContent = since.main;
  el.statLastDetail.textContent = since.sub;
}

function renderDailySummary() {
  const map = new Map();
  for (const r of allRecords) {
    const cur = map.get(r.feeding_date) || { total: 0, count: 0 };
    cur.total += Number(r.amount_ml) || 0;
    cur.count += 1;
    map.set(r.feeding_date, cur);
  }
  const entries = Array.from(map.entries()).slice(0, 7);
  if (entries.length === 0) {
    el.dailySummaryBar.classList.add("hidden");
    return;
  }
  el.dailySummaryBar.classList.remove("hidden");
  el.dailySummaryBar.innerHTML = entries
    .map(([dateStr, info]) => {
      const f = formatFriendlyDate(dateStr);
      const label = f.tag ? `${f.tag}(${f.short})` : f.short;
      return `<div class="day-chip">${escapeHtml(label)} · <strong>${info.total} ml</strong> (${info.count}次)</div>`;
    })
    .join("");
}

function escapeHtml(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function getFilteredRecords() {
  const mode = el.dateFilter.value;
  if (mode === "today") {
    const t = getLocalNow().date;
    return allRecords.filter((r) => r.feeding_date === t);
  }
  if (mode === "yesterday") {
    const y = getYesterdayStr();
    return allRecords.filter((r) => r.feeding_date === y);
  }
  return allRecords;
}

function renderTable() {
  const rows = getFilteredRecords();
  if (!rows.length) {
    el.recordsTbody.innerHTML = `<tr><td colspan="4" class="empty-cell">暂无喂奶记录，点击上方大按钮直接说话即可登记</td></tr>`;
    return;
  }

  el.recordsTbody.innerHTML = rows
    .map((r) => {
      const f = formatFriendlyDate(r.feeding_date);
      const noteHtml = r.note ? `<div class="row-note">${escapeHtml(r.note)}</div>` : "";
      return `
        <tr data-id="${escapeHtml(r.id)}">
          <td>
            <div class="date-main">${escapeHtml(f.short)}</div>
            ${f.tag ? `<span class="date-tag">${escapeHtml(f.tag)}</span>` : ""}
          </td>
          <td class="time-cell">${escapeHtml(formatTimeHHMM(r.feeding_time))}</td>
          <td>
            <div class="amount-main">${escapeHtml(r.amount_ml)}<span class="amount-unit">ml</span></div>
            ${noteHtml}
          </td>
          <td>
            <div class="row-actions">
              <button class="btn-row" type="button" data-action="edit" data-id="${escapeHtml(r.id)}">改</button>
              <button class="btn-row btn-row-del" type="button" data-action="delete" data-id="${escapeHtml(r.id)}">删</button>
            </div>
          </td>
        </tr>
      `;
    })
    .join("");
}

function formatNumber(n) {
  return Number(n || 0).toLocaleString("zh-CN");
}

function renderDeltaPill(deltaMl, prefix = "较上期") {
  if (deltaMl === null || deltaMl === undefined) return "";
  if (deltaMl > 0) {
    return `<span class="delta-pill delta-up">${escapeHtml(prefix)} ↑ +${deltaMl}</span>`;
  }
  if (deltaMl < 0) {
    return `<span class="delta-pill delta-down">${escapeHtml(prefix)} ↓ ${deltaMl}</span>`;
  }
  return `<span class="delta-pill delta-flat">${escapeHtml(prefix)} 持平</span>`;
}

function renderPeriodRows(items, {
  container,
  typeKey,
  defaultLimit,
  accentBar = false,
  getName,
  getTag,
  getDaysText,
  deltaPrefix = "较上期",
}) {
  if (!items.length || (items.length === 1 && items[0].recordedDays === 0)) {
    container.innerHTML = `<div class="stats-empty">暂无足够记录，记入喂奶数据后自动生成统计</div>`;
    return;
  }

  const expanded = Boolean(expandState[typeKey]);
  const visible = expanded ? items : items.slice(0, defaultLimit);
  const maxAvg = Math.max(
    1,
    ...items.map((item) => (item.dailyAvgMl !== null ? item.dailyAvgMl : 0))
  );

  const html = visible
    .map((item, idx) => {
      const tag = getTag(item, idx);
      const hasVal = item.dailyAvgMl !== null;
      const pct = hasVal ? Math.max(6, Math.round((item.dailyAvgMl / maxAvg) * 100)) : 0;
      const valHtml = hasVal
        ? `${formatNumber(item.dailyAvgMl)}<small>ml/天</small>`
        : `--<small>ml/天</small>`;
      const metaParts = hasVal
        ? [
            `总计 ${formatNumber(item.totalMl)} ml`,
            getDaysText(item),
            `日均 ${item.avgFeedsPerDay} 次`,
            item.avgPerFeedMl !== null ? `次均 ${item.avgPerFeedMl} ml` : "",
          ].filter(Boolean)
        : [getDaysText(item), "暂无记录"];

      return `
        <div class="period-row${idx === 0 ? " highlight" : ""}">
          <div class="period-head">
            <div class="period-name">
              <span>${escapeHtml(getName(item))}</span>
              ${tag ? `<span class="period-tag">${escapeHtml(tag)}</span>` : ""}
            </div>
            <div class="period-val-wrap">
              ${renderDeltaPill(item.deltaMl, deltaPrefix)}
              <div class="period-val">${valHtml}</div>
            </div>
          </div>
          <div class="period-bar-track">
            <div class="period-bar-fill${accentBar ? " accent" : ""}" style="width:${pct}%"></div>
          </div>
          <div class="period-meta">${escapeHtml(metaParts.join(" · "))}</div>
        </div>
      `;
    })
    .join("");

  const moreBtn =
    items.length > defaultLimit
      ? `<button class="btn-expand" type="button" data-expand-key="${typeKey}">${
          expanded ? "收起部分历史" : `展开全部 ${items.length} 条记录`
        }</button>`
      : "";

  container.innerHTML = html + moreBtn;
}

function renderWeeklyChart(thisWeekDays, weekAvgMl) {
  const maxDayMl = Math.max(
    1,
    weekAvgMl || 0,
    ...thisWeekDays.map((d) => d.totalMl || 0)
  );
  const maxBarPx = 92;

  const avgLineHtml =
    weekAvgMl !== null && weekAvgMl > 0
      ? (() => {
          const bottomPx = Math.max(6, Math.min(maxBarPx - 2, Math.round((weekAvgMl / maxDayMl) * maxBarPx)));
          return `<div class="week-avg-line" style="bottom:${bottomPx}px"></div>`;
        })()
      : "";

  const legendAvgHtml =
    weekAvgMl !== null && weekAvgMl > 0
      ? `<span class="legend-avg">周均 ${formatNumber(weekAvgMl)} ml/天</span>`
      : `<span class="legend-avg">本周暂无均值</span>`;

  const colsHtml = thisWeekDays
    .map((day) => {
      const hasMl = day.totalMl > 0;
      const heightPx = hasMl ? Math.max(6, Math.round((day.totalMl / maxDayMl) * maxBarPx)) : 4;
      const barClasses = ["week-bar-fill"];
      if (!hasMl) barClasses.push("empty");
      else if (day.isExcluded) barClasses.push("excluded");
      else if (day.isToday) barClasses.push("today");

      const valText = hasMl ? String(day.totalMl) : day.isFuture ? "" : "—";
      return `
        <div class="week-bar-col" title="${escapeHtml(`${day.date} ${day.weekdayLabel}：${day.totalMl} ml（${day.feedingCount}次）`)}">
          <div class="week-bar-val${hasMl ? "" : " muted"}">${escapeHtml(valText)}</div>
          <div class="week-bar-track">
            <div class="${barClasses.join(" ")}" style="height:${heightPx}px"></div>
          </div>
        </div>
      `;
    })
    .join("");

  const labelsHtml = thisWeekDays
    .map((day) => {
      const lbl = day.isToday ? "今天" : day.weekdayLabel;
      return `
        <div>
          <div class="week-day-lbl${day.isToday ? " today" : ""}">${escapeHtml(lbl)}</div>
          <div class="week-day-sub">${escapeHtml(day.shortDate)}</div>
        </div>
      `;
    })
    .join("");

  el.weeklyBarChart.innerHTML = `
    <div class="week-chart-legend">
      <div class="legend-items">
        <span class="legend-dot">日奶量</span>
        <span class="legend-dot today">今天</span>
      </div>
      ${legendAvgHtml}
    </div>
    <div class="week-chart-plot">
      ${avgLineHtml}
      ${colsHtml}
    </div>
    <div class="week-chart-labels">
      ${labelsHtml}
    </div>
  `;
}

function renderStatsView() {
  if (!statsLoaded) {
    el.statsSummaryCards.innerHTML = `<div class="stats-empty">正在加载云端统计数据…</div>`;
    return;
  }

  const today = getLocalNow().date;
  const stats = computeMilkStats(dailyStatsRows, { today, excludeToday });
  const { thisWeek, latestFiveDay, thisMonth } = stats.summary;

  el.btnScopeIncludeToday.classList.toggle("active", !excludeToday);
  el.btnScopeExcludeToday.classList.toggle("active", excludeToday);

  if (stats.onlyTodayExists) {
    el.statsNotice.textContent = "目前只有今天的记录，已开启「不含今日」口径，可点右上角切回「含今日」查看当天均值。";
    el.statsNotice.classList.remove("hidden");
  } else {
    el.statsNotice.classList.add("hidden");
  }

  const kpiCards = [
    {
      target: "sectionWeekly",
      cls: "kpi-card kpi-card-primary",
      title: "本周平均",
      badge: "周一至周日",
      range: thisWeek.rangeLabel,
      avg: thisWeek.dailyAvgMl,
      delta: thisWeek.deltaMl,
      deltaPrefix: "较上周",
      meta:
        thisWeek.recordedDays > 0
          ? `已记录 ${thisWeek.recordedDays} 天 · 总计 ${formatNumber(thisWeek.totalMl)} ml · 日均 ${thisWeek.avgFeedsPerDay} 次`
          : "本周暂无记录",
    },
    {
      target: "sectionFiveDay",
      cls: "kpi-card kpi-card-accent",
      title: "5 日标准平均",
      badge: excludeToday ? "近 5 完整日" : "最近 5 日",
      range: latestFiveDay.rangeLabel,
      avg: latestFiveDay.dailyAvgMl,
      delta: latestFiveDay.deltaMl,
      deltaPrefix: "较前5日",
      meta:
        latestFiveDay.recordedDays > 0
          ? `记录 ${latestFiveDay.recordedDays}/5 天 · 总计 ${formatNumber(latestFiveDay.totalMl)} ml · 日均 ${latestFiveDay.avgFeedsPerDay} 次`
          : "最近 5 日暂无记录",
    },
    {
      target: "sectionMonthly",
      cls: "kpi-card",
      title: "每月平均（本月）",
      badge: thisMonth.monthLabel,
      range: "按自然月",
      avg: thisMonth.dailyAvgMl,
      delta: thisMonth.deltaMl,
      deltaPrefix: "较上月",
      meta:
        thisMonth.recordedDays > 0
          ? `已记录 ${thisMonth.recordedDays} 天 · 总计 ${formatNumber(thisMonth.totalMl)} ml · 日均 ${thisMonth.avgFeedsPerDay} 次`
          : "本月暂无记录",
    },
  ];

  el.statsSummaryCards.innerHTML = kpiCards
    .map((c) => {
      const valHtml =
        c.avg !== null ? `${formatNumber(c.avg)}<small>ml/天</small>` : `--<small>ml/天</small>`;
      return `
        <button class="${c.cls}" type="button" data-scroll-target="${c.target}">
          <div class="kpi-top">
            <div class="kpi-title-wrap">
              <span class="kpi-title">${escapeHtml(c.title)}</span>
              <span class="kpi-badge">${escapeHtml(c.badge)}</span>
            </div>
            <span class="kpi-range">${escapeHtml(c.range)}</span>
          </div>
          <div class="kpi-main">
            <div class="kpi-value">${valHtml}</div>
            ${renderDeltaPill(c.delta, c.deltaPrefix)}
          </div>
          <div class="kpi-meta">${escapeHtml(c.meta)}</div>
        </button>
      `;
    })
    .join("");

  el.weeklyCardSub.textContent = excludeToday
    ? `本周 ${thisWeek.rangeLabel} · 虚线为本周日均（不含今日）`
    : `本周 ${thisWeek.rangeLabel} · 虚线为本周日均`;
  renderWeeklyChart(stats.thisWeekDays, thisWeek.dailyAvgMl);

  renderPeriodRows(stats.weeklyPeriods, {
    container: el.weeklyPeriodsList,
    typeKey: "weekly",
    defaultLimit: 6,
    accentBar: false,
    getName: (w) => w.rangeLabel,
    getTag: (w) => (w.isCurrentWeek ? "本周" : ""),
    getDaysText: (w) => `记录 ${w.recordedDays} 天`,
    deltaPrefix: "较上周",
  });

  el.fiveDayCardSub.textContent = excludeToday
    ? "每连续 5 个自然日为一个周期（截至昨日），按有记录天数计算日均"
    : "每连续 5 个自然日为一个周期（截至今日），按有记录天数计算日均";
  renderPeriodRows(stats.fiveDayPeriods, {
    container: el.fiveDayPeriodsList,
    typeKey: "fiveDay",
    defaultLimit: 6,
    accentBar: true,
    getName: (p) => p.rangeLabel,
    getTag: (p) => (p.isLatest ? "近5日" : ""),
    getDaysText: (p) => `记录 ${p.recordedDays}/${p.windowDays} 天`,
    deltaPrefix: "较前5日",
  });

  renderPeriodRows(stats.monthlyPeriods, {
    container: el.monthlyPeriodsList,
    typeKey: "monthly",
    defaultLimit: 12,
    accentBar: false,
    getName: (m) => m.monthLabel,
    getTag: (m) => (m.isCurrentMonth ? "本月" : ""),
    getDaysText: (m) => `记录 ${m.recordedDays} 天`,
    deltaPrefix: "较上月",
  });
}

function applyTabVisuals() {
  const isStats = activeTab === "stats";
  el.homeView.classList.toggle("hidden", isStats);
  el.statsView.classList.toggle("hidden", !isStats);

  el.btnTabStats.classList.toggle("active", isStats);
  el.btnTabStats.setAttribute("aria-pressed", isStats ? "true" : "false");
  el.btnTabStats.title = isStats ? "返回喂奶登记页" : "切换到奶量统计页面";
  el.tabNavIcon.innerHTML = isStats ? ICON_HOME_SVG : ICON_STATS_SVG;
  el.tabNavLabel.textContent = isStats ? "登记" : "统计";

  if (isStats) {
    renderStatsView();
  }
}

function setActiveTab(nextTab, { pushHistory = true } = {}) {
  const normalized = nextTab === "stats" ? "stats" : "home";
  if (normalized === "stats" && recorder.recording) {
    showToast("正在录音中", "请先结束或取消当前录音后再切换页面", { isError: true });
    return;
  }
  const changed = activeTab !== normalized;
  activeTab = normalized;
  applyTabVisuals();

  if (changed) {
    window.scrollTo({ top: 0, behavior: "instant" });
  }

  const targetHash = buildHash(familyToken, activeTab);
  if (window.location.hash !== targetHash) {
    try {
      if (pushHistory && changed) {
        window.history.pushState(null, "", targetHash || "#");
      } else {
        window.history.replaceState(null, "", targetHash || "#");
      }
    } catch {
      // ignore
    }
  }
}

function renderAll() {
  updateTopDateLabel();
  renderStats();
  renderDailySummary();
  renderTable();
  if (activeTab === "stats") {
    renderStatsView();
  }
}

async function loadRecords({ silent = false } = {}) {
  if (!familyToken) {
    showAuthGate();
    return;
  }
  el.btnRefresh.classList.add("spinning");
  try {
    const [listRes, statsRes] = await Promise.all([
      apiCall({ action: "list", limit: 300 }),
      apiCall({ action: "daily_stats" }).catch(() => null),
    ]);

    const { data } = listRes;
    if (!data.ok) {
      if (!silent) showToast("读取失败", data.error || "请稍后重试", { isError: true });
      return;
    }
    hideAuthGate();
    allRecords = Array.isArray(data.records) ? data.records : [];

    if (statsRes && statsRes.data && statsRes.data.ok && Array.isArray(statsRes.data.daily)) {
      dailyStatsRows = statsRes.data.daily;
    } else {
      dailyStatsRows = buildDailyFromRecords(allRecords);
    }
    statsLoaded = true;
    renderAll();
  } catch (err) {
    if (!silent) showToast("网络异常", err.message || "无法连接云端", { isError: true });
  } finally {
    el.btnRefresh.classList.remove("spinning");
  }
}

function formatRecordsSummary(records) {
  return records
    .map((r) => {
      const f = formatFriendlyDate(r.feeding_date);
      const day = f.tag || f.short;
      const notePart = r.note ? `（${r.note}）` : "";
      return `${day} ${formatTimeHHMM(r.feeding_time)} · ${r.amount_ml} ml${notePart}`;
    })
    .join("；");
}

function setMicVisual(state) {
  el.btnMic.classList.remove("recording", "processing");
  el.btnMic.setAttribute("aria-pressed", state === "recording" ? "true" : "false");
  el.micLiveBar.classList.toggle("hidden", state !== "recording");

  if (state === "recording") {
    el.btnMic.classList.add("recording");
    el.micIcon.textContent = "⏹️";
    el.micTitle.textContent = "正在听，说完点这里结束";
    el.micSub.textContent = "比如：“刚才喝了 130” 或 “上午十点喝了 150”";
  } else if (state === "processing") {
    el.btnMic.classList.add("processing");
    el.micIcon.textContent = "⏳";
    el.micTitle.textContent = "正在识别并记入表格…";
    el.micSub.textContent = "请稍等 1～2 秒";
  } else {
    el.micIcon.textContent = "🎙️";
    el.micTitle.textContent = "点一下直接说话";
    el.micSub.textContent = "自动识别时间与毫升数，无需切换输入法";
    el.micMeterFill.style.width = "8%";
    el.micTimer.textContent = "00:00";
  }
}

const recorder = new WavRecorder({
  onLevel(lvl) {
    const pct = Math.max(8, Math.min(100, Math.round(lvl * 100)));
    el.micMeterFill.style.width = `${pct}%`;
  },
  onTick(ms) {
    const sec = Math.floor(ms / 1000);
    el.micTimer.textContent = `${pad2(Math.floor(sec / 60))}:${pad2(sec % 60)}`;
  },
  onAutoStop() {
    finishVoiceRecording();
  },
});

async function finishVoiceRecording({ cancel = false } = {}) {
  if (!recorder.recording) return;
  if (cancel) {
    await recorder.stop({ cancel: true });
    setMicVisual("idle");
    return;
  }

  setMicVisual("processing");
  busy = true;
  try {
    const clip = await recorder.stop({ cancel: false });
    if (!clip || clip.durationMs < 350) {
      showToast("说话时间太短", "请点一下麦克风，说完后再点一下结束", { isError: true });
      return;
    }

    const { data } = await apiCall({
      action: "voice_and_save",
      audio_wav_base64: clip.wavBase64,
    });

    if (!data.ok) {
      if (data.transcript) {
        el.textInput.value = data.transcript;
      }
      showToast("未能自动登记", data.error || "请再说一次或修改下方文字后提交", { isError: true });
      return;
    }

    const saved = Array.isArray(data.records) ? data.records : [];
    showToast(
      `✅ 已登记：${formatRecordsSummary(saved)}`,
      data.transcript ? `听到的内容：「${data.transcript}」` : "",
      { undoIds: saved.map((r) => r.id) }
    );
    await loadRecords({ silent: true });
  } catch (err) {
    showToast("语音识别失败", err.message || "请重试或改用下方文字输入", { isError: true });
  } finally {
    busy = false;
    setMicVisual("idle");
  }
}

el.btnMic.addEventListener("click", async () => {
  if (busy) return;
  if (recorder.recording) {
    await finishVoiceRecording({ cancel: false });
    return;
  }
  try {
    await recorder.start();
    setMicVisual("recording");
  } catch (err) {
    setMicVisual("idle");
    showToast("无法打开麦克风", err.message || "请在浏览器权限中允许使用麦克风", { isError: true });
  }
});

el.btnMicCancel.addEventListener("click", async () => {
  await finishVoiceRecording({ cancel: true });
});

el.textForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const text = el.textInput.value.trim();
  if (!text) {
    showToast("请先输入或说话", "例如：130，或者 上午十点半喝了150", { isError: true });
    el.textInput.focus();
    return;
  }

  busy = true;
  el.btnSubmitText.disabled = true;
  el.btnSubmitText.textContent = "正在识别并保存…";
  try {
    const { data } = await apiCall({ action: "parse_and_save", text });
    if (!data.ok) {
      showToast("未能识别奶量", data.error || "请补充毫升数后再试", { isError: true });
      return;
    }
    const saved = Array.isArray(data.records) ? data.records : [];
    el.textInput.value = "";
    showToast(
      `✅ 已登记：${formatRecordsSummary(saved)}`,
      `原话：「${text}」`,
      { undoIds: saved.map((r) => r.id) }
    );
    await loadRecords({ silent: true });
  } catch (err) {
    showToast("记录失败", err.message || "请检查网络后重试", { isError: true });
  } finally {
    busy = false;
    el.btnSubmitText.disabled = false;
    el.btnSubmitText.textContent = "✨ 自动识别并记入表格";
  }
});

el.btnUndo.addEventListener("click", async () => {
  if (!lastInsertedIds.length || busy) return;
  const ids = [...lastInsertedIds];
  lastInsertedIds = [];
  el.btnUndo.classList.add("hidden");
  busy = true;
  try {
    for (const id of ids) {
      await apiCall({ action: "delete", id });
    }
    showToast("已撤销刚才的记录");
    await loadRecords({ silent: true });
  } catch (err) {
    showToast("撤销失败", err.message || "请在表格中手动删除", { isError: true });
  } finally {
    busy = false;
  }
});

function openModal(record = null) {
  const now = getLocalNow();
  if (record) {
    el.modalTitle.textContent = "修改喂奶记录";
    el.editId.value = record.id;
    el.editDate.value = record.feeding_date;
    el.editTime.value = formatTimeHHMM(record.feeding_time);
    el.editAmount.value = String(record.amount_ml);
    el.editNote.value = record.note || "";
    if (record.raw_input) {
      el.editRawPreview.textContent = `原始输入：「${record.raw_input}」`;
      el.editRawPreview.classList.remove("hidden");
    } else {
      el.editRawPreview.classList.add("hidden");
    }
  } else {
    el.modalTitle.textContent = "手动补录喂奶";
    el.editId.value = "";
    el.editDate.value = now.date;
    el.editTime.value = now.time;
    el.editAmount.value = "";
    el.editNote.value = "";
    el.editRawPreview.classList.add("hidden");
  }
  el.editModal.classList.remove("hidden");
  if (!record) el.editAmount.focus();
}

function closeModal() {
  el.editModal.classList.add("hidden");
}

el.btnOpenManual.addEventListener("click", () => openModal(null));
el.btnCloseModal.addEventListener("click", closeModal);
el.btnCancelModal.addEventListener("click", closeModal);
el.editModal.addEventListener("click", (e) => {
  if (e.target === el.editModal) closeModal();
});

el.editForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  if (busy) return;
  const id = el.editId.value.trim();
  const payload = {
    action: id ? "update" : "create",
    feeding_date: el.editDate.value,
    feeding_time: el.editTime.value,
    amount_ml: Number(el.editAmount.value),
    note: el.editNote.value.trim(),
  };
  if (id) payload.id = id;

  busy = true;
  el.btnSaveModal.disabled = true;
  try {
    const { data } = await apiCall(payload);
    if (!data.ok) {
      showToast("保存失败", data.error || "请检查填写内容", { isError: true });
      return;
    }
    closeModal();
    showToast(id ? "✅ 已修改记录" : `✅ 已登记 ${payload.amount_ml} ml`);
    await loadRecords({ silent: true });
  } catch (err) {
    showToast("保存失败", err.message || "网络异常", { isError: true });
  } finally {
    busy = false;
    el.btnSaveModal.disabled = false;
  }
});

el.recordsTbody.addEventListener("click", async (e) => {
  const btn = e.target.closest("button[data-action]");
  if (!btn || busy) return;
  const action = btn.dataset.action;
  const id = btn.dataset.id;
  const rec = allRecords.find((r) => r.id === id);
  if (!rec) return;

  if (action === "edit") {
    openModal(rec);
    return;
  }

  if (action === "delete") {
    const ok = window.confirm(`确定删除 ${rec.feeding_date} ${formatTimeHHMM(rec.feeding_time)} 的 ${rec.amount_ml} ml 记录吗？`);
    if (!ok) return;
    busy = true;
    try {
      const { data } = await apiCall({ action: "delete", id });
      if (!data.ok) {
        showToast("删除失败", data.error || "请重试", { isError: true });
        return;
      }
      showToast("已删除该条记录");
      await loadRecords({ silent: true });
    } catch (err) {
      showToast("删除失败", err.message || "网络异常", { isError: true });
    } finally {
      busy = false;
    }
  }
});

el.dateFilter.addEventListener("change", renderTable);
el.btnRefresh.addEventListener("click", () => loadRecords());

el.btnTabStats.addEventListener("click", () => {
  setActiveTab(activeTab === "stats" ? "home" : "stats", { pushHistory: true });
});

el.btnBackHome.addEventListener("click", () => {
  setActiveTab("home", { pushHistory: true });
});

el.topbarBrand.addEventListener("click", () => {
  if (activeTab !== "home") {
    setActiveTab("home", { pushHistory: true });
  }
});

el.topbarBrand.addEventListener("keydown", (e) => {
  if ((e.key === "Enter" || e.key === " ") && activeTab !== "home") {
    e.preventDefault();
    setActiveTab("home", { pushHistory: true });
  }
});

el.btnScopeIncludeToday.addEventListener("click", () => {
  if (!excludeToday) return;
  excludeToday = false;
  renderStatsView();
});

el.btnScopeExcludeToday.addEventListener("click", () => {
  if (excludeToday) return;
  excludeToday = true;
  renderStatsView();
});

el.statsSummaryCards.addEventListener("click", (e) => {
  const card = e.target.closest("button[data-scroll-target]");
  if (!card) return;
  const target = document.getElementById(card.dataset.scrollTarget);
  if (target) {
    target.scrollIntoView({ behavior: "smooth", block: "start" });
  }
});

el.statsView.addEventListener("click", (e) => {
  const btn = e.target.closest("button[data-expand-key]");
  if (!btn) return;
  const key = btn.dataset.expandKey;
  if (key && key in expandState) {
    expandState[key] = !expandState[key];
    renderStatsView();
  }
});

el.btnExportCsv.addEventListener("click", () => {
  const rows = getFilteredRecords();
  if (!rows.length) {
    showToast("当前没有可导出的记录", "", { isError: true });
    return;
  }
  const csvEscape = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [["日期", "喂奶时间", "用量(ml)", "备注", "原始输入"].map(csvEscape).join(",")];
  for (const r of rows) {
    lines.push([r.feeding_date, formatTimeHHMM(r.feeding_time), r.amount_ml, r.note || "", r.raw_input || ""].map(csvEscape).join(","));
  }
  const blob = new Blob(["\uFEFF" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `奶粉记录_${getLocalNow().date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
});

el.authForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const val = el.authInput.value.trim();
  if (!val) return;
  saveToken(val);
  await loadRecords();
});

function syncFromUrl() {
  const nextToken = readTokenFromUrlOrStorage();
  const nextTab = readTabFromHash();
  if (nextTab !== activeTab) {
    activeTab = nextTab;
    applyTabVisuals();
  }
  if (nextToken && nextToken !== familyToken) {
    saveToken(nextToken);
    loadRecords();
  }
}

// 监听链接变化与手机/浏览器返回键
window.addEventListener("hashchange", syncFromUrl);
window.addEventListener("popstate", syncFromUrl);

// 每 60 秒自动刷新“距上次喂奶”的显示
window.setInterval(() => {
  if (allRecords.length) renderStats();
}, 60000);

// 初始化
updateTopDateLabel();
activeTab = readTabFromHash();
applyTabVisuals();
familyToken = readTokenFromUrlOrStorage();
if (familyToken) {
  saveToken(familyToken);
  loadRecords();
} else {
  showAuthGate();
}
