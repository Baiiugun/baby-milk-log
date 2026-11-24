import { WavRecorder } from "./audio-recorder.js";

// 仅包含公开云函数地址与匿名公开密钥（不含任何 API Key 或管理密钥）
const API_URL = "https://br-cute-tahr-8eff7472.supabase.aidap-global.cn-beijing.volces.com/functions/v1/milk-log-api";
const PUBLIC_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1wbGF0Zm9ybSIsInJvbGUiOiJhbm9uIiwiZXhwIjozNjg2OTI1NzYzfQ.y45vSsbxFjV9k-psYujSR2YMtDOeZW_IDZS6eBlbRFc";
const TOKEN_STORAGE_KEY = "baby_milk_family_token_v1";

const el = {
  authGate: document.getElementById("authGate"),
  authForm: document.getElementById("authForm"),
  authInput: document.getElementById("authInput"),
  authError: document.getElementById("authError"),
  todayLabel: document.getElementById("todayLabel"),
  btnRefresh: document.getElementById("btnRefresh"),
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

function saveToken(token) {
  familyToken = token.trim();
  try {
    localStorage.setItem(TOKEN_STORAGE_KEY, familyToken);
  } catch {
    // ignore
  }
  // 保留 #k=... 在地址栏中，便于添加到手机主屏幕后依然自动免登录
  if (familyToken && !window.location.hash.includes(`k=${encodeURIComponent(familyToken)}`)) {
    try {
      window.history.replaceState(null, "", `#k=${encodeURIComponent(familyToken)}`);
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

function renderAll() {
  updateTopDateLabel();
  renderStats();
  renderDailySummary();
  renderTable();
}

async function loadRecords({ silent = false } = {}) {
  if (!familyToken) {
    showAuthGate();
    return;
  }
  el.btnRefresh.classList.add("spinning");
  try {
    const { data } = await apiCall({ action: "list", limit: 300 });
    if (!data.ok) {
      if (!silent) showToast("读取失败", data.error || "请稍后重试", { isError: true });
      return;
    }
    hideAuthGate();
    allRecords = Array.isArray(data.records) ? data.records : [];
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

// 监听链接变化（比如在已打开的标签页粘贴新的专属链接）
window.addEventListener("hashchange", () => {
  const next = readTokenFromUrlOrStorage();
  if (next && next !== familyToken) {
    saveToken(next);
    loadRecords();
  }
});

// 每 60 秒自动刷新“距上次喂奶”的显示
window.setInterval(() => {
  if (allRecords.length) renderStats();
}, 60000);

// 初始化
updateTopDateLabel();
familyToken = readTokenFromUrlOrStorage();
if (familyToken) {
  saveToken(familyToken);
  loadRecords();
} else {
  showAuthGate();
}
