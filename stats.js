const WEEKDAY_LABELS = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function pad2(n) {
  return String(n).padStart(2, "0");
}

export function isValidDateStr(s) {
  return typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s);
}

export function parseDateUTC(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(Date.UTC(y, (m || 1) - 1, d || 1));
}

export function formatDateUTC(utcDate) {
  return `${utcDate.getUTCFullYear()}-${pad2(utcDate.getUTCMonth() + 1)}-${pad2(utcDate.getUTCDate())}`;
}

export function addDays(dateStr, delta) {
  const dt = parseDateUTC(dateStr);
  dt.setUTCDate(dt.getUTCDate() + delta);
  return formatDateUTC(dt);
}

export function diffDays(dateStrA, dateStrB) {
  const ms = parseDateUTC(dateStrA).getTime() - parseDateUTC(dateStrB).getTime();
  return Math.round(ms / 86400000);
}

export function getMondayOfWeek(dateStr) {
  const dt = parseDateUTC(dateStr);
  const offsetFromMonday = (dt.getUTCDay() + 6) % 7;
  return addDays(dateStr, -offsetFromMonday);
}

export function formatShortDate(dateStr, refYear) {
  const [y, m, d] = dateStr.split("-");
  if (refYear && y !== refYear) {
    return `${y.slice(2)}/${m}/${d}`;
  }
  return `${m}/${d}`;
}

export function formatRangeLabel(startStr, endStr, refYear) {
  const crossYear = startStr.slice(0, 4) !== endStr.slice(0, 4);
  const useShortYear = crossYear || (refYear && startStr.slice(0, 4) !== refYear);
  if (useShortYear) {
    return `${startStr.slice(2, 4)}/${startStr.slice(5, 7)}/${startStr.slice(8, 10)} - ${endStr.slice(2, 4)}/${endStr.slice(5, 7)}/${endStr.slice(8, 10)}`;
  }
  return `${startStr.slice(5, 7)}/${startStr.slice(8, 10)} - ${endStr.slice(5, 7)}/${endStr.slice(8, 10)}`;
}

export function formatMonthLabel(monthKey) {
  const [y, m] = monthKey.split("-");
  return `${y}年${Number(m)}月`;
}

export function buildDailyFromRecords(records) {
  const byDate = new Map();
  if (!Array.isArray(records)) return [];
  for (const r of records) {
    if (!r || !isValidDateStr(r.feeding_date)) continue;
    const ml = Number(r.amount_ml) || 0;
    if (ml <= 0) continue;
    const cur = byDate.get(r.feeding_date) || {
      feeding_date: r.feeding_date,
      total_ml: 0,
      feeding_count: 0,
    };
    cur.total_ml += ml;
    cur.feeding_count += 1;
    byDate.set(r.feeding_date, cur);
  }
  return Array.from(byDate.values()).sort((a, b) =>
    b.feeding_date.localeCompare(a.feeding_date)
  );
}

function summarizeEntries(entries) {
  const recordedDays = entries.length;
  let totalMl = 0;
  let totalCount = 0;
  for (const item of entries) {
    totalMl += item.total_ml;
    totalCount += item.feeding_count;
  }
  return {
    recordedDays,
    totalMl,
    totalCount,
    dailyAvgMl: recordedDays > 0 ? Math.round(totalMl / recordedDays) : null,
    avgFeedsPerDay: recordedDays > 0 ? Number((totalCount / recordedDays).toFixed(1)) : null,
    avgPerFeedMl: totalCount > 0 ? Math.round(totalMl / totalCount) : null,
  };
}

function attachDeltas(periods) {
  for (let i = 0; i < periods.length; i++) {
    const cur = periods[i];
    const prev = periods[i + 1];
    if (cur.dailyAvgMl !== null && prev && prev.dailyAvgMl !== null) {
      cur.deltaMl = cur.dailyAvgMl - prev.dailyAvgMl;
    } else {
      cur.deltaMl = null;
    }
  }
  return periods;
}

export function computeMilkStats(dailyRows, { today, excludeToday = false } = {}) {
  const refToday = isValidDateStr(today) ? today : formatDateUTC(new Date());
  const refYear = refToday.slice(0, 4);

  // Normalize all daily rows
  const rawMap = new Map();
  if (Array.isArray(dailyRows)) {
    for (const row of dailyRows) {
      if (!row || !isValidDateStr(row.feeding_date)) continue;
      const ml = Number(row.total_ml) || 0;
      const cnt = Number(row.feeding_count) || 0;
      if (ml <= 0) continue;
      const existing = rawMap.get(row.feeding_date);
      if (existing) {
        existing.total_ml += ml;
        existing.feeding_count += cnt;
      } else {
        rawMap.set(row.feeding_date, {
          feeding_date: row.feeding_date,
          total_ml: ml,
          feeding_count: cnt,
        });
      }
    }
  }

  const allDaily = Array.from(rawMap.values()).sort((a, b) =>
    b.feeding_date.localeCompare(a.feeding_date)
  );
  const includedDaily = excludeToday
    ? allDaily.filter((d) => d.feeding_date !== refToday)
    : allDaily;

  const includedMap = new Map(includedDaily.map((d) => [d.feeding_date, d]));

  const hasAnyData = allDaily.length > 0;
  const hasIncludedData = includedDaily.length > 0;
  const onlyTodayExists = hasAnyData && !hasIncludedData && excludeToday;

  // 1. 本周（周一至周日）与历史每周统计
  const currentWeekStart = getMondayOfWeek(refToday);
  const currentWeekEnd = addDays(currentWeekStart, 6);

  const thisWeekDays = [];
  for (let i = 0; i < 7; i++) {
    const date = addDays(currentWeekStart, i);
    const raw = rawMap.get(date);
    const isToday = date === refToday;
    const isFuture = date > refToday;
    const isExcluded = excludeToday && isToday;
    thisWeekDays.push({
      date,
      shortDate: `${date.slice(5, 7)}/${date.slice(8, 10)}`,
      weekdayLabel: WEEKDAY_LABELS[i],
      isToday,
      isFuture,
      isExcluded,
      totalMl: raw ? raw.total_ml : 0,
      feedingCount: raw ? raw.feeding_count : 0,
    });
  }

  const weekGroups = new Map();
  weekGroups.set(currentWeekStart, []);
  for (const item of includedDaily) {
    const ws = getMondayOfWeek(item.feeding_date);
    if (!weekGroups.has(ws)) weekGroups.set(ws, []);
    weekGroups.get(ws).push(item);
  }

  const weeklyPeriods = attachDeltas(
    Array.from(weekGroups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([weekStart, entries]) => {
        const weekEnd = addDays(weekStart, 6);
        const stats = summarizeEntries(entries);
        return {
          weekStart,
          weekEnd,
          rangeLabel: formatRangeLabel(weekStart, weekEnd, refYear),
          isCurrentWeek: weekStart === currentWeekStart,
          ...stats,
          deltaMl: null,
        };
      })
  );

  const thisWeekSummary = weeklyPeriods.find((w) => w.isCurrentWeek) || {
    weekStart: currentWeekStart,
    weekEnd: currentWeekEnd,
    rangeLabel: formatRangeLabel(currentWeekStart, currentWeekEnd, refYear),
    isCurrentWeek: true,
    ...summarizeEntries([]),
    deltaMl: null,
  };

  // 2. 以 5 日为标准的周期平均（严格每 5 个自然日一段，从锚点日向前滚动）
  const anchorEnd = excludeToday ? addDays(refToday, -1) : refToday;
  const eligibleForFiveDay = includedDaily.filter((d) => d.feeding_date <= anchorEnd);

  const fiveDayBuckets = new Map();
  fiveDayBuckets.set(0, []);
  for (const item of eligibleForFiveDay) {
    const daysAgo = diffDays(anchorEnd, item.feeding_date);
    if (daysAgo < 0) continue;
    const bucketIndex = Math.floor(daysAgo / 5);
    if (!fiveDayBuckets.has(bucketIndex)) fiveDayBuckets.set(bucketIndex, []);
    fiveDayBuckets.get(bucketIndex).push(item);
  }

  const fiveDayPeriods = attachDeltas(
    Array.from(fiveDayBuckets.entries())
      .sort((a, b) => a[0] - b[0])
      .map(([bucketIndex, entries]) => {
        const end = addDays(anchorEnd, -bucketIndex * 5);
        const start = addDays(end, -4);
        const stats = summarizeEntries(entries);
        return {
          index: bucketIndex,
          start,
          end,
          rangeLabel: formatRangeLabel(start, end, refYear),
          isLatest: bucketIndex === 0,
          windowDays: 5,
          ...stats,
          deltaMl: null,
        };
      })
  );

  const latestFiveDaySummary = fiveDayPeriods[0];

  // 3. 每月平均统计（按自然月 YYYY-MM）
  const currentMonthKey = refToday.slice(0, 7);
  const monthGroups = new Map();
  monthGroups.set(currentMonthKey, []);
  for (const item of includedDaily) {
    const mk = item.feeding_date.slice(0, 7);
    if (!monthGroups.has(mk)) monthGroups.set(mk, []);
    monthGroups.get(mk).push(item);
  }

  const monthlyPeriods = attachDeltas(
    Array.from(monthGroups.entries())
      .sort((a, b) => b[0].localeCompare(a[0]))
      .map(([monthKey, entries]) => {
        const stats = summarizeEntries(entries);
        return {
          monthKey,
          monthLabel: formatMonthLabel(monthKey),
          isCurrentMonth: monthKey === currentMonthKey,
          ...stats,
          deltaMl: null,
        };
      })
  );

  const thisMonthSummary = monthlyPeriods.find((m) => m.isCurrentMonth) || {
    monthKey: currentMonthKey,
    monthLabel: formatMonthLabel(currentMonthKey),
    isCurrentMonth: true,
    ...summarizeEntries([]),
    deltaMl: null,
  };

  return {
    today: refToday,
    anchorEnd,
    excludeToday,
    hasAnyData,
    hasIncludedData,
    onlyTodayExists,
    totalRecordedDays: includedMap.size,
    summary: {
      thisWeek: thisWeekSummary,
      latestFiveDay: latestFiveDaySummary,
      thisMonth: thisMonthSummary,
    },
    thisWeekDays,
    weeklyPeriods,
    fiveDayPeriods,
    monthlyPeriods,
  };
}
