const CONFIG = window.HOMESTUDIO_BI_CONFIG || {};
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: CONFIG.currency || 'BRL' });
const NUMBER = new Intl.NumberFormat('pt-BR');
const DECIMAL = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 1 });
const PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });
const SNAPSHOT_PERIODS = ['today', 'yesterday', '7d', 'this_month', 'last_month'];
const CACHE_PREFIX = 'homestudio.bi.snapshot.v16';
const ATTENDANTS_CACHE_KEY = 'homestudio.bi.attendants.v1';
const NOTIFICATIONS_CACHE_KEY = 'homestudio.bi.notifications.v1';
const TRANSACTIONS_PAGE_SIZE = 50;
const AUTO_REFRESH_MS = 15 * 60 * 1000;
const NOTIFICATION_TIMES = ['08:00', '12:00', '18:00', '23:00'];

const state = {
  period: CONFIG.defaultPeriod || 'today',
  view: 'dashboard',
  payload: null,
  attendants: [],
  transactions: [],
  transactionPage: 1,
  attendantDetailPage: 1,
  attendantDetails: [],
  insightsStart: '',
  insightsEnd: '',
  hourlyStart: '',
  hourlyEnd: '',
  isRefreshing: false,
  lastAutoRefreshAt: 0,
  warmInsightsTimer: null,
  notificationSettings: {},
  notificationTimer: null,
  notificationLastSent: {}
};

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => Array.from(document.querySelectorAll(selector));

const els = {
  status: $('#statusText'),
  customRange: $('#customRange'),
  startDate: $('#startDate'),
  endDate: $('#endDate'),
  attendantSelect: $('#attendantSelect'),
  refresh: $('#refreshButton'),
  refreshSide: $('#refreshButtonSide'),
  periodLabel: $('#periodLabel'),
  chart: $('#weeklyChart'),
  tooltip: $('#chartTooltip'),
  weeklyRows: $('#weeklyRows'),
  transactionRows: $('#transactionRows'),
  transactionSearch: $('#transactionSearch'),
  transactionPrevPage: $('#transactionPrevPage'),
  transactionNextPage: $('#transactionNextPage'),
  transactionPageInfo: $('#transactionPageInfo'),
  attendantSalesPeriod: $('#attendantSalesPeriod'),
  attendantSalesRows: $('#attendantSalesRows'),
  attendantSalesDetailRows: $('#attendantSalesDetailRows'),
  attendantDetailPrevPage: $('#attendantDetailPrevPage'),
  attendantDetailNextPage: $('#attendantDetailNextPage'),
  attendantDetailPageInfo: $('#attendantDetailPageInfo'),
  attendantAnalyticsPeriod: $('#attendantAnalyticsPeriod'),
  salesMixChart: $('#salesMixChart'),
  salesMixLegend: $('#salesMixLegend'),
  revenueMixChart: $('#revenueMixChart'),
  revenueMixLegend: $('#revenueMixLegend'),
  attendantBarChart: $('#attendantBarChart'),
  insightConversations: $('#insightConversationsValue'),
  insightCostPerConversation: $('#insightCostPerConversationValue'),
  insightCpm: $('#insightCpmValue'),
  insightCtr: $('#insightCtrValue'),
  insightsPeriodLabel: $('#insightsPeriodLabel'),
  conversionChart: $('#conversionChart'),
  insightsRows: $('#insightsRows'),
  hourlyPeriodLabel: $('#hourlyPeriodLabel'),
  hourlyAverage: $('#hourlyAverageLabel'),
  hourlyChart: $('#hourlyChart'),
  hourlyPrevDay: $('#hourlyPrevDay'),
  hourlyToday: $('#hourlyToday'),
  hourlyNextDay: $('#hourlyNextDay'),
  hourlyDate: $('#hourlyDate'),
  insightsPrevWeek: $('#insightsPrevWeek'),
  insightsCurrentWeek: $('#insightsCurrentWeek'),
  insightsNextWeek: $('#insightsNextWeek'),
  insightsStartDate: $('#insightsStartDate'),
  insightsEndDate: $('#insightsEndDate'),
  insightsConversionAverage: $('#insightsConversionAverage'),
  clicksPerSale: $('#clicksPerSaleValue'),
  conversationsPerSale: $('#conversationsPerSaleValue'),
  attendantEditor: $('#attendantEditor'),
  addAttendant: $('#addAttendantButton'),
  saveAttendants: $('#saveAttendantsButton'),
  adminKey: $('#adminKey'),
  notifyAll: $('#notifyAllToggle'),
  notificationStatus: $('#notificationStatus'),
  testNotification: $('#testNotificationButton'),
  revenue: $('#revenueValue'),
  sales: $('#salesValue'),
  attendantRevenue: $('#attendantRevenueValue'),
  attendantSales: $('#attendantSalesValue'),
  metaSpendValue: $('#metaSpendValue'),
  metaTax: $('#metaTaxValue'),
  profit: $('#profitValue'),
  margin: $('#marginValue'),
  cpa: $('#cpaValue'),
  roas: $('#roasValue'),
  avgTicket: $('#avgTicketValue')
};

function init() {
  const today = new Date();
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  els.startDate.value = toInputDate(weekAgo);
  els.endDate.value = toInputDate(today);
  setInsightsRange(currentWeekRange(today), { render: false });
  setHourlyRange({ start: today, end: today }, { render: false });

  $$('.period-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.period = button.dataset.period;
      updatePeriodButtons();
      renderCachedDashboard();
      ensureCurrentSnapshot();
    });
  });

  $$('[data-view]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      setView(button.dataset.view);
    });
  });

  [els.startDate, els.endDate].forEach((input) => input.addEventListener('change', renderCachedDashboard));
  els.attendantSelect.addEventListener('change', () => {
    localStorage.setItem('homestudio.attendant', els.attendantSelect.value);
    renderCachedDashboard();
    ensureCurrentSnapshot();
  });
  els.transactionSearch.addEventListener('input', () => {
    state.transactionPage = 1;
    renderTransactions(state.transactions);
  });
  if (els.transactionPrevPage) {
    els.transactionPrevPage.addEventListener('click', () => {
      state.transactionPage = Math.max(1, state.transactionPage - 1);
      renderTransactions(state.transactions);
    });
  }
  if (els.transactionNextPage) {
    els.transactionNextPage.addEventListener('click', () => {
      state.transactionPage += 1;
      renderTransactions(state.transactions);
    });
  }
  if (els.attendantDetailPrevPage) {
    els.attendantDetailPrevPage.addEventListener('click', () => {
      state.attendantDetailPage = Math.max(1, state.attendantDetailPage - 1);
      renderAttendantSalesDetails(state.attendantDetails);
    });
  }
  if (els.attendantDetailNextPage) {
    els.attendantDetailNextPage.addEventListener('click', () => {
      state.attendantDetailPage += 1;
      renderAttendantSalesDetails(state.attendantDetails);
    });
  }
  if (els.insightsPrevWeek) {
    els.insightsPrevWeek.addEventListener('click', () => shiftInsightsWeek(-7));
  }
  if (els.insightsCurrentWeek) {
    els.insightsCurrentWeek.addEventListener('click', () => setInsightsRange(currentWeekRange(new Date())));
  }
  if (els.insightsNextWeek) {
    els.insightsNextWeek.addEventListener('click', () => shiftInsightsWeek(7));
  }
  [els.insightsStartDate, els.insightsEndDate].filter(Boolean).forEach((input) => {
    input.addEventListener('change', () => {
      setInsightsRangeFromInputs();
      renderCurrentInsights();
    });
  });
  if (els.hourlyPrevDay) {
    els.hourlyPrevDay.addEventListener('click', () => shiftHourlyPeriod(-1));
  }
  if (els.hourlyToday) {
    els.hourlyToday.addEventListener('click', () => setHourlyDate(new Date()));
  }
  if (els.hourlyNextDay) {
    els.hourlyNextDay.addEventListener('click', () => shiftHourlyPeriod(1));
  }
  if (els.hourlyDate) {
    els.hourlyDate.addEventListener('change', () => setHourlyDateFromInput());
  }
  els.addAttendant.addEventListener('click', () => {
    state.attendants.push({ name: '', cents: '', note: '' });
    renderAttendantEditor(state.attendants);
  });
  els.saveAttendants.addEventListener('click', saveAttendants);
  bindNotificationControls();
  els.refresh.addEventListener('click', () => refreshDashboardSnapshots());
  if (els.refreshSide) els.refreshSide.addEventListener('click', () => refreshDashboardSnapshots());

  updatePeriodButtons();
  setView('dashboard');
  renderCachedDashboard();
  startAutoRefresh();
  startNotificationScheduler();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js?v=16')
      .then((registration) => registration.update())
      .catch(() => {});
  }
}

function setView(view) {
  state.view = view;
  document.body.dataset.currentView = view;
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
  if (view === 'insights') {
    renderInsightMetrics(resolvePeriodInsights(state.payload || emptyPayload()));
    renderCurrentHourly();
    renderCurrentInsights();
  }
}

function updatePeriodButtons() {
  $$('.period-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.period === state.period);
  });
  els.customRange.hidden = state.period !== 'custom';
}

function setInsightsRange(range, options = {}) {
  state.insightsStart = toInputDate(range.start);
  state.insightsEnd = toInputDate(range.end);
  if (els.insightsStartDate) els.insightsStartDate.value = state.insightsStart;
  if (els.insightsEndDate) els.insightsEndDate.value = state.insightsEnd;
  if (options.render !== false) renderCurrentInsights();
}

function setInsightsRangeFromInputs() {
  const start = parseInputDate(els.insightsStartDate?.value) || parseInputDate(state.insightsStart) || currentWeekRange(new Date()).start;
  let end = parseInputDate(els.insightsEndDate?.value) || parseInputDate(state.insightsEnd) || currentWeekRange(new Date()).end;
  const maxEnd = new Date(start);
  maxEnd.setDate(maxEnd.getDate() + 6);
  if (end < start) end = new Date(start);
  if (end > maxEnd) end = maxEnd;
  setInsightsRange({ start, end }, { render: false });
}

function shiftInsightsWeek(days) {
  const start = parseInputDate(state.insightsStart) || currentWeekRange(new Date()).start;
  const end = parseInputDate(state.insightsEnd) || currentWeekRange(new Date()).end;
  start.setDate(start.getDate() + days);
  end.setDate(end.getDate() + days);
  setInsightsRange({ start, end });
}

function setHourlyRange(range, options = {}) {
  const day = parseInputDate(toInputDate(range.start)) || new Date();
  state.hourlyStart = toInputDate(day);
  state.hourlyEnd = state.hourlyStart;
  if (els.hourlyDate) els.hourlyDate.value = state.hourlyStart;
  if (options.render !== false) renderCurrentHourly();
}

function setHourlyDate(date) {
  const day = parseInputDate(toInputDate(date)) || new Date();
  setHourlyRange({ start: day, end: day });
}

function setHourlyDateFromInput() {
  const day = parseInputDate(els.hourlyDate?.value) || parseInputDate(state.hourlyStart) || new Date();
  setHourlyDate(day);
}

function shiftHourlyPeriod(days) {
  const day = parseInputDate(state.hourlyStart) || new Date();
  day.setDate(day.getDate() + days);
  setHourlyDate(day);
}

function currentWeekRange(reference) {
  const start = new Date(reference);
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  const end = new Date(start);
  end.setDate(end.getDate() + 6);
  return { start, end };
}

function currentAttendantName() {
  return els.attendantSelect.value ||
    localStorage.getItem('homestudio.attendant') ||
    state.payload?.attendant?.name ||
    state.attendants[0]?.name ||
    'Sheila';
}

function snapshotKey(options = {}) {
  const period = options.period || state.period;
  const attendant = normalizeText(options.attendant || currentAttendantName()) || 'geral';
  const start = period === 'custom' ? (options.start || els.startDate.value || '') : '';
  const end = period === 'custom' ? (options.end || els.endDate.value || '') : '';
  return `${CACHE_PREFIX}:${apiCachePart()}:${period}:${attendant}:${start}:${end}`;
}

function insightsKey(options = {}) {
  const start = options.start || state.insightsStart || '';
  const end = options.end || state.insightsEnd || '';
  return `${CACHE_PREFIX}:insights:${apiCachePart()}:${start}:${end}`;
}

function hourlyKey(options = {}) {
  const start = options.start || state.hourlyStart || '';
  const end = options.end || state.hourlyEnd || '';
  return `${CACHE_PREFIX}:hourly:${apiCachePart()}:${start}:${end}`;
}

function apiCachePart() {
  return String(CONFIG.apiUrl || 'demo').replace(/[^\w.-]/g, '_').slice(-96);
}

function scopedCacheKey(name) {
  return `${CACHE_PREFIX}:${name}:${apiCachePart()}`;
}

function readSnapshot(options = {}) {
  try {
    const raw = localStorage.getItem(snapshotKey(options));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readHourlySnapshot(options = {}) {
  try {
    const raw = localStorage.getItem(hourlyKey(options));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function readInsightsSnapshot(options = {}) {
  try {
    const raw = localStorage.getItem(insightsKey(options));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function storeSnapshot(payload, options = {}) {
  const record = {
    cachedAt: Date.now(),
    payload
  };
  localStorage.setItem(snapshotKey(options), JSON.stringify(record));
  storeTransactionsFromPayload(payload);
  storeInsightsSnapshot(payload && payload.insights);
  storeHourlySnapshot(payload && payload.hourly);
}

function storeTransactionsFromPayload(payload) {
  const incoming = Array.isArray(payload?.transactions) ? payload.transactions : [];
  if (!incoming.length) return;
  const merged = new Map(readCachedTransactions().map((tx) => [transactionIdentity(tx), tx]));
  incoming.forEach((tx) => {
    const normalized = normalizeCachedTransaction(tx);
    if (normalized.date && transactionIdentity(normalized)) merged.set(transactionIdentity(normalized), normalized);
  });
  const rows = Array.from(merged.values())
    .sort((a, b) => transactionSortValue(b) - transactionSortValue(a))
    .slice(0, 5000);
  try {
    localStorage.setItem(scopedCacheKey('transactions'), JSON.stringify(rows));
  } catch {
    localStorage.setItem(scopedCacheKey('transactions'), JSON.stringify(rows.slice(0, 2500)));
  }
}

function readCachedTransactions() {
  try {
    const rows = JSON.parse(localStorage.getItem(scopedCacheKey('transactions')) || '[]');
    return Array.isArray(rows) ? rows : [];
  } catch {
    return [];
  }
}

function normalizeCachedTransaction(tx) {
  return {
    date: String(tx.date || ''),
    time: String(tx.time || ''),
    weekday: tx.weekday || '',
    currency: tx.currency || '',
    amount: Number(tx.amount) || 0,
    originalAmount: Number(tx.originalAmount) || Number(tx.amount) || 0,
    fxRate: Number(tx.fxRate) || 1,
    payer: tx.payer || '',
    manualAttendant: tx.manualAttendant || '',
    id: tx.id || '',
    description: tx.description || ''
  };
}

function transactionIdentity(tx) {
  return String(tx.id || `${tx.date}|${tx.time}|${tx.payer}|${tx.currency}|${tx.amount}`);
}

function transactionSortValue(tx) {
  const date = tx.date || '1970-01-01';
  const time = tx.time || '00:00';
  const parsed = new Date(`${date}T${time}:00`);
  return Number.isNaN(parsed.getTime()) ? 0 : parsed.getTime();
}

function storeInsightsSnapshot(insights) {
  if (!insights || !insights.period || !insights.period.start || !insights.period.end) return;
  const record = {
    cachedAt: Date.now(),
    insights
  };
  localStorage.setItem(insightsKey({
    start: insights.period.start,
    end: insights.period.end
  }), JSON.stringify(record));
}

function storeHourlySnapshot(hourly) {
  if (!hourly || !hourly.period || !hourly.period.start || !hourly.period.end) return;
  const record = {
    cachedAt: Date.now(),
    hourly
  };
  localStorage.setItem(hourlyKey({
    start: hourly.period.start,
    end: hourly.period.end
  }), JSON.stringify(record));
}

function cacheAttendants(attendants) {
  const clean = (attendants || []).filter(Boolean);
  if (clean.length) localStorage.setItem(ATTENDANTS_CACHE_KEY, JSON.stringify(clean));
}

function readCachedAttendants() {
  try {
    const attendants = JSON.parse(localStorage.getItem(ATTENDANTS_CACHE_KEY) || '[]');
    return Array.isArray(attendants) ? attendants : [];
  } catch {
    return [];
  }
}

async function loadDashboard() {
  return refreshDashboardSnapshots();
}

function startAutoRefresh() {
  if (!CONFIG.apiUrl) return;
  window.HOMESTUDIO_BI_NATIVE_AUTO_REFRESH = true;
  window.setTimeout(() => refreshDashboardSnapshots({ silent: false, reason: 'startup' }), 250);

  window.setInterval(() => {
    if (!document.hidden) refreshDashboardSnapshots({ silent: true, reason: 'timer' });
  }, AUTO_REFRESH_MS);

  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const age = Date.now() - state.lastAutoRefreshAt;
    if (age >= AUTO_REFRESH_MS) refreshDashboardSnapshots({ silent: true, reason: 'resume' });
  });
}

function bindNotificationControls() {
  window.HOMESTUDIO_BI_NATIVE_NOTIFICATIONS = true;
  state.notificationSettings = readNotificationSettings();
  $$('[data-notification-time]').forEach((input) => {
    input.checked = Boolean(state.notificationSettings[input.dataset.notificationTime]);
    input.addEventListener('change', async () => {
      const allowed = await ensureNotificationPermission();
      if (!allowed) input.checked = false;
      state.notificationSettings[input.dataset.notificationTime] = input.checked;
      saveNotificationSettings();
      updateNotificationControls();
    });
  });

  if (els.notifyAll) {
    els.notifyAll.addEventListener('change', async () => {
      const enabled = els.notifyAll.checked;
      const allowed = enabled ? await ensureNotificationPermission() : true;
      NOTIFICATION_TIMES.forEach((time) => {
        state.notificationSettings[time] = allowed ? enabled : false;
      });
      saveNotificationSettings();
      updateNotificationControls();
    });
  }

  if (els.testNotification) {
    els.testNotification.addEventListener('click', async () => {
      if (await ensureNotificationPermission()) sendCampaignNotification();
      updateNotificationControls();
    });
  }

  updateNotificationControls();
}

function readNotificationSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(NOTIFICATIONS_CACHE_KEY) || '{}');
    return NOTIFICATION_TIMES.reduce((settings, time) => {
      settings[time] = Boolean(saved[time]);
      return settings;
    }, {});
  } catch {
    return NOTIFICATION_TIMES.reduce((settings, time) => ({ ...settings, [time]: false }), {});
  }
}

function saveNotificationSettings() {
  localStorage.setItem(NOTIFICATIONS_CACHE_KEY, JSON.stringify(state.notificationSettings));
}

function updateNotificationControls() {
  $$('[data-notification-time]').forEach((input) => {
    input.checked = Boolean(state.notificationSettings[input.dataset.notificationTime]);
  });
  const enabledCount = NOTIFICATION_TIMES.filter((time) => state.notificationSettings[time]).length;
  if (els.notifyAll) els.notifyAll.checked = enabledCount === NOTIFICATION_TIMES.length;
  if (els.notificationStatus) {
    const permission = notificationPermission();
    if (!enabledCount) {
      els.notificationStatus.textContent = 'Desativadas';
    } else if (permission === 'denied') {
      els.notificationStatus.textContent = 'Bloqueadas';
    } else {
      els.notificationStatus.textContent = `${enabledCount} ativas`;
    }
  }
}

function startNotificationScheduler() {
  if (!('Notification' in window)) {
    updateNotificationControls();
    return;
  }
  window.clearInterval(state.notificationTimer);
  state.notificationTimer = window.setInterval(checkScheduledNotifications, 30000);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) checkScheduledNotifications();
  });
  checkScheduledNotifications();
}

function checkScheduledNotifications() {
  if (document.hidden || notificationPermission() !== 'granted') return;
  const now = new Date();
  const currentTime = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
  if (!state.notificationSettings[currentTime]) return;
  const dayKey = `${toInputDate(now)}:${currentTime}`;
  if (state.notificationLastSent[dayKey]) return;
  state.notificationLastSent[dayKey] = true;
  sendCampaignNotification();
}

async function ensureNotificationPermission() {
  if (!('Notification' in window)) {
    alert('Este navegador ainda nao liberou notificacoes para este tipo de app.');
    return false;
  }
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') {
    alert('As notificacoes estao bloqueadas no navegador. Libere nas configuracoes do site/app.');
    return false;
  }
  const permission = await Notification.requestPermission();
  return permission === 'granted';
}

function notificationPermission() {
  return 'Notification' in window ? Notification.permission : 'unsupported';
}

function sendCampaignNotification() {
  const payload = normalizeFinancialMetrics(state.payload || emptyPayload());
  const metrics = payload.metrics || {};
  const body = `Seu investimento está em ${BRL.format(metrics.metaSpend)}, com faturamento em ${BRL.format(metrics.revenue)}, com um CPA de ${BRL.format(metrics.cpa)} e um ROI de ${formatDecimal(metrics.roas)}.`;
  try {
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.ready
        .then((registration) => registration.showNotification('Resumo das Campanhas!', {
          body,
          icon: 'assets/icon-192.png',
          badge: 'assets/icon-192.png',
          tag: 'homestudio-bi-summary',
          renotify: true
        }))
        .catch(() => new Notification('Resumo das Campanhas!', { body, icon: 'assets/icon-192.png' }));
      return;
    }
    new Notification('Resumo das Campanhas!', { body, icon: 'assets/icon-192.png' });
  } catch {
    alert(body);
  }
}

function renderCachedDashboard() {
  const record = readSnapshot();
  if (record && record.payload) {
    state.payload = record.payload;
    render(normalizeFinancialMetrics(record.payload));
    setStatus(formatCachedStatus(record));
    return;
  }

  if (!CONFIG.apiUrl) {
    const payload = demoPayload();
    state.payload = payload;
    render(normalizeFinancialMetrics(payload));
    setStatus('Demo local');
    return;
  }

  const payload = emptyPayload();
  state.payload = payload;
  render(normalizeFinancialMetrics(payload));
  setStatus('Carregando');
}

function ensureCurrentSnapshot() {
  if (!CONFIG.apiUrl || state.isRefreshing || readSnapshot()?.payload) return;
  refreshDashboardSnapshots({ silent: true, reason: 'cache-miss' });
}

async function refreshDashboardSnapshots(options = {}) {
  if (state.isRefreshing) return;
  state.isRefreshing = true;
  if (!options.silent) setStatus('Atualizando');
  const attendant = currentAttendantName();

  try {
    if (!CONFIG.apiUrl) {
      const payload = demoPayload();
      state.payload = payload;
      render(normalizeFinancialMetrics(payload));
      setStatus('Demo local');
      return;
    }

    const periods = state.period === 'custom'
      ? [...SNAPSHOT_PERIODS, 'custom']
      : SNAPSHOT_PERIODS;
    let payloadsByPeriod = {};
    try {
      payloadsByPeriod = await fetchBatchPayload({ periods, attendant });
    } catch (error) {
      console.warn('Batch indisponivel, usando fallback por periodo.', error);
      payloadsByPeriod = await fetchPayloadsIndividually(periods, attendant);
    }

    let successCount = 0;
    Object.keys(payloadsByPeriod).forEach((period) => {
      const payload = payloadsByPeriod[period];
      if (!payload || !payload.ok) return;
      storeSnapshot(payload, {
        period,
        attendant,
        start: period === 'custom' ? els.startDate.value : '',
        end: period === 'custom' ? els.endDate.value : ''
      });
      cacheAttendants(payload.attendants || [payload.attendant].filter(Boolean));
      successCount += 1;
    });

    if (!successCount) throw new Error('Nenhum periodo foi atualizado.');
    state.lastAutoRefreshAt = Date.now();
    renderCachedDashboard();
    warmNearbyInsightCaches();
    setStatus(`Atualizado ${new Date().toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`);
  } catch (error) {
    console.error(error);
    renderCachedDashboard();
    if (!options.silent) setStatus('Erro ao atualizar');
  } finally {
    state.isRefreshing = false;
  }
}

async function fetchBatchPayload({ periods, attendant }) {
  const url = new URL(CONFIG.apiUrl);
  url.searchParams.set('action', 'batch');
  url.searchParams.set('periods', periods.join(','));
  url.searchParams.set('_', String(Date.now()));
  if (attendant) url.searchParams.set('attendant', attendant);
  url.searchParams.set('insightsStart', state.insightsStart);
  url.searchParams.set('insightsEnd', state.insightsEnd);
  url.searchParams.set('hourlyStart', state.hourlyStart);
  url.searchParams.set('hourlyEnd', state.hourlyEnd);
  if (periods.includes('custom')) {
    url.searchParams.set('start', els.startDate.value);
    url.searchParams.set('end', els.endDate.value);
  }

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'API em lote sem retorno valido');
  return payload.payloads || {};
}

async function fetchPayloadsIndividually(periods, attendant) {
  const results = await Promise.allSettled(
    periods.map((period) => fetchPayload({
      period,
      attendant,
      start: period === 'custom' ? els.startDate.value : '',
      end: period === 'custom' ? els.endDate.value : ''
    }))
  );
  return results.reduce((payloads, result, index) => {
    if (result.status === 'fulfilled') payloads[periods[index]] = result.value;
    return payloads;
  }, {});
}

async function fetchPayload(options = {}) {
  const url = new URL(CONFIG.apiUrl);
  const period = options.period || state.period;
  url.searchParams.set('period', period);
  url.searchParams.set('_', String(Date.now()));
  if (options.attendant) url.searchParams.set('attendant', options.attendant);
  url.searchParams.set('insightsStart', options.insightsStart || state.insightsStart);
  url.searchParams.set('insightsEnd', options.insightsEnd || state.insightsEnd);
  url.searchParams.set('hourlyStart', options.hourlyStart || state.hourlyStart);
  url.searchParams.set('hourlyEnd', options.hourlyEnd || state.hourlyEnd);
  if (period === 'custom') {
    url.searchParams.set('start', options.start || els.startDate.value);
    url.searchParams.set('end', options.end || els.endDate.value);
  }

  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload.ok) throw new Error(payload.error || 'API sem retorno valido');
  return payload;
}

function normalizeFinancialMetrics(payload) {
  const metaSpend = Number(payload.metrics.metaSpend) || 0;
  const metaTax = Number(payload.metrics.metaTax) || roundMoney(metaSpend * 0.1383);
  const revenue = Number(payload.metrics.revenue) || 0;
  const sales = Number(payload.metrics.sales) || 0;
  const investment = metaSpend + metaTax;
  const profit = roundMoney(revenue - investment);
  const weekly = (payload.weekly || []).map((day) => ({
    ...day,
    revenue: Number(day.revenue) || 0,
    profit: Number(day.profit) || 0,
    sales: Number(day.sales) || 0
  }));

  return {
    ...payload,
    weekly,
    metrics: {
      ...payload.metrics,
      metaSpend,
      metaTax,
      investment,
      profit,
      avgTicket: sales ? roundMoney(revenue / sales) : 0,
      margin: revenue ? profit / revenue : 0,
      cpa: sales ? roundMoney(investment / sales) : 0,
      roas: investment ? revenue / investment : 0,
      adjustedRoas: investment ? revenue / investment : 0
    }
  };
}

function render(payload) {
  const metrics = payload.metrics;
  state.transactions = payload.transactions || [];
  updateAttendants(payload.attendants || [payload.attendant].filter(Boolean), payload.attendant);

  els.revenue.textContent = BRL.format(metrics.revenue);
  els.sales.textContent = NUMBER.format(metrics.sales);
  els.attendantRevenue.textContent = BRL.format(metrics.attendantRevenue);
  els.attendantSales.textContent = NUMBER.format(metrics.attendantSales);
  els.metaSpendValue.textContent = BRL.format(metrics.metaSpend);
  els.metaTax.textContent = BRL.format(metrics.metaTax);
  els.profit.textContent = BRL.format(metrics.profit);
  els.margin.textContent = PERCENT.format(metrics.margin);
  els.cpa.textContent = BRL.format(metrics.cpa);
  els.avgTicket.textContent = BRL.format(metrics.avgTicket);
  els.roas.textContent = formatDecimal(metrics.roas);
  els.periodLabel.textContent = payload.period.label;
  els.metaSpendValue.title = {
    api: 'Valor gasto vindo automaticamente da API da Meta.',
    sheet: 'Valor gasto vindo da planilha.',
    not_configured: 'Meta Ads ainda nao configurado no Apps Script.',
    api_error: metrics.metaSpendError || 'Nao foi possivel ler o valor gasto da Meta.'
  }[metrics.metaSpendSource] || 'Valor gasto';

  const toneValue = metrics.profit;
  setTone(els.profit.closest('.metric-card'), toneValue);
  setTone(els.margin.closest('.metric-card'), toneValue);
  setTone(els.roas.closest('.metric-card'), toneValue);
  const attendantSales = payload.attendantSales || buildAttendantSalesFromTransactions(state.transactions, state.attendants);
  renderTable(payload.weekly);
  renderChart(payload.weekly);
  renderTransactions(state.transactions);
  renderHourly(resolveHourly(payload));
  renderInsightMetrics(resolvePeriodInsights(payload));
  renderInsights(resolveInsights(payload));
  renderAttendantSales(attendantSales, payload.period);
  renderAttendantAnalytics(attendantSales, metrics, payload.period);
  renderAttendantEditor(state.attendants);
}

function updateAttendants(attendants, selectedAttendant) {
  const clean = attendants
    .map((attendant) => ({
      name: String(attendant.name || '').trim(),
      cents: attendant.cents === null || attendant.cents === undefined ? '' : String(attendant.cents).padStart(2, '0'),
      note: attendant.note || attendant.observation || ''
    }))
    .filter((attendant) => attendant.name || attendant.cents);
  state.attendants = clean.length ? clean : [{ name: 'Sheila', cents: '97', note: 'Vendas com final ,97' }];

  const previous = localStorage.getItem('homestudio.attendant') || selectedAttendant?.name || '';
  els.attendantSelect.innerHTML = '';
  state.attendants.forEach((attendant) => {
    const option = document.createElement('option');
    option.value = attendant.name;
    option.textContent = attendant.name || `Final ,${attendant.cents}`;
    els.attendantSelect.append(option);
  });
  const nextValue = state.attendants.some((attendant) => attendant.name === previous)
    ? previous
    : state.attendants[0].name;
  els.attendantSelect.value = nextValue;
}

function renderTable(days) {
  els.weeklyRows.innerHTML = '';
  days.forEach((day) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${day.label}</td>
      <td>${BRL.format(day.revenue)}</td>
      <td>${BRL.format(day.profit)}</td>
      <td>${NUMBER.format(day.sales)}</td>
    `;
    els.weeklyRows.appendChild(row);
  });
}

function renderTransactions(transactions) {
  const query = normalizeText(els.transactionSearch.value);
  const filteredRows = transactions
    .filter((tx) => {
      const haystack = normalizeText(`${tx.date} ${tx.payer} ${tx.currency} ${tx.amount} ${tx.description}`);
      return !query || haystack.includes(query);
    });
  const totalPages = Math.max(1, Math.ceil(filteredRows.length / TRANSACTIONS_PAGE_SIZE));
  state.transactionPage = Math.min(Math.max(1, state.transactionPage), totalPages);
  const start = (state.transactionPage - 1) * TRANSACTIONS_PAGE_SIZE;
  const rows = filteredRows.slice(start, start + TRANSACTIONS_PAGE_SIZE);

  els.transactionRows.innerHTML = '';
  if (!rows.length) {
    els.transactionRows.innerHTML = '<tr><td colspan="5">Nenhuma transação encontrada.</td></tr>';
    updateTransactionPagination(0, 1);
    return;
  }
  rows.forEach((tx) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatDateDisplay(tx.date)}</td>
      <td>${escapeHtml(tx.time || '')}</td>
      <td>${escapeHtml(tx.payer || '')}</td>
      <td>${escapeHtml(tx.currency || '')}</td>
      <td>${BRL.format(Number(tx.amount) || 0)}</td>
    `;
    els.transactionRows.appendChild(row);
  });
  updateTransactionPagination(filteredRows.length, totalPages);
}

function updateTransactionPagination(totalRows, totalPages) {
  if (!els.transactionPageInfo) return;
  const first = totalRows ? ((state.transactionPage - 1) * TRANSACTIONS_PAGE_SIZE) + 1 : 0;
  const last = Math.min(totalRows, state.transactionPage * TRANSACTIONS_PAGE_SIZE);
  els.transactionPageInfo.textContent = totalRows
    ? `Página ${state.transactionPage} de ${totalPages} · ${first}-${last} de ${totalRows}`
    : 'Página 1 de 1';
  if (els.transactionPrevPage) els.transactionPrevPage.disabled = state.transactionPage <= 1;
  if (els.transactionNextPage) els.transactionNextPage.disabled = state.transactionPage >= totalPages;
}

function renderAttendantSales(attendantSales, period) {
  els.attendantSalesPeriod.textContent = period?.label || 'Período atual';
  els.attendantSalesRows.innerHTML = '';

  if (!attendantSales.length) {
    els.attendantSalesRows.innerHTML = '<tr><td colspan="5">Nenhuma venda atribuída no período.</td></tr>';
    state.attendantDetails = [];
    renderAttendantSalesDetails([]);
    return;
  }

  attendantSales.forEach((item) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(item.name)}</td>
      <td>${escapeHtml(item.centsLabel || '')}</td>
      <td>${NUMBER.format(item.sales || 0)}</td>
      <td>${BRL.format(item.revenue || 0)}</td>
      <td>${BRL.format(item.avgTicket || 0)}</td>
    `;
    els.attendantSalesRows.appendChild(row);
  });

  const details = attendantSales
    .flatMap((item) => (item.transactions || []).map((tx) => ({ ...tx, attendant: item.name })))
    .sort((a, b) => String(b.date).localeCompare(String(a.date)));
  state.attendantDetails = details;
  state.attendantDetailPage = Math.min(state.attendantDetailPage, Math.max(1, Math.ceil(details.length / TRANSACTIONS_PAGE_SIZE)));
  renderAttendantSalesDetails(details);
}

function renderAttendantSalesDetails(details) {
  els.attendantSalesDetailRows.innerHTML = '';
  if (!details.length) {
    els.attendantSalesDetailRows.innerHTML = '<tr><td colspan="4">Nenhuma venda atribuída no período.</td></tr>';
    updateAttendantDetailPagination(0, 1);
    return;
  }

  const totalPages = Math.max(1, Math.ceil(details.length / TRANSACTIONS_PAGE_SIZE));
  state.attendantDetailPage = Math.min(Math.max(1, state.attendantDetailPage), totalPages);
  const start = (state.attendantDetailPage - 1) * TRANSACTIONS_PAGE_SIZE;
  const rows = details.slice(start, start + TRANSACTIONS_PAGE_SIZE);

  rows.forEach((tx) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(tx.attendant || '')}</td>
      <td>${formatDateDisplay(tx.date)}</td>
      <td>${escapeHtml(tx.payer || '')}</td>
      <td>${BRL.format(Number(tx.amount) || 0)}</td>
    `;
    els.attendantSalesDetailRows.appendChild(row);
  });
  updateAttendantDetailPagination(details.length, totalPages);
}

function updateAttendantDetailPagination(totalRows, totalPages) {
  if (!els.attendantDetailPageInfo) return;
  const first = totalRows ? ((state.attendantDetailPage - 1) * TRANSACTIONS_PAGE_SIZE) + 1 : 0;
  const last = Math.min(totalRows, state.attendantDetailPage * TRANSACTIONS_PAGE_SIZE);
  els.attendantDetailPageInfo.textContent = totalRows
    ? `Página ${state.attendantDetailPage} de ${totalPages} · ${first}-${last} de ${totalRows}`
    : 'Página 1 de 1';
  if (els.attendantDetailPrevPage) els.attendantDetailPrevPage.disabled = state.attendantDetailPage <= 1;
  if (els.attendantDetailNextPage) els.attendantDetailNextPage.disabled = state.attendantDetailPage >= totalPages;
}

function renderAttendantAnalytics(attendantSales, metrics, period) {
  if (!els.salesMixChart || !els.revenueMixChart || !els.attendantBarChart) return;

  const rows = completeAttendantSales(attendantSales);
  const totalSales = Math.max(Number(metrics.sales) || 0, 0);
  const totalRevenue = Math.max(Number(metrics.revenue) || 0, 0);
  const rawAttendantSales = rows.reduce((total, item) => total + (Number(item.sales) || 0), 0);
  const rawAttendantRevenue = rows.reduce((total, item) => total + (Number(item.revenue) || 0), 0);
  const attendantSalesTotal = totalSales ? Math.min(totalSales, rawAttendantSales) : rawAttendantSales;
  const attendantRevenueTotal = totalRevenue ? Math.min(totalRevenue, rawAttendantRevenue) : rawAttendantRevenue;
  const automaticSales = Math.max(0, totalSales - attendantSalesTotal);
  const automaticRevenue = Math.max(0, totalRevenue - attendantRevenueTotal);

  if (els.attendantAnalyticsPeriod) {
    els.attendantAnalyticsPeriod.textContent = period?.label || 'Período atual';
  }

  renderDonutChart(els.salesMixChart, els.salesMixLegend, [
    { label: 'Automático', value: automaticSales, color: '#566151' },
    { label: 'Atendentes', value: attendantSalesTotal, color: '#9FE870' }
  ], (value) => NUMBER.format(value));

  renderDonutChart(els.revenueMixChart, els.revenueMixLegend, [
    { label: 'Automático', value: automaticRevenue, color: '#566151' },
    { label: 'Atendentes', value: attendantRevenueTotal, color: '#9FE870' }
  ], (value) => compactMoney(value));

  renderAttendantBarChart(rows);
}

function renderCurrentInsights() {
  renderInsightMetrics(resolvePeriodInsights(state.payload || emptyPayload()));
  renderInsights(resolveInsights(state.payload || emptyPayload()));
  requestInsightsRefreshIfMissing();
}

function renderCurrentHourly() {
  renderHourly(resolveHourly(state.payload || emptyPayload()));
  requestHourlyRefreshIfMissing();
}

function resolveHourly(payload) {
  const cached = readHourlySnapshot();
  if (cached && cached.hourly) return cached.hourly;
  const payloadHourly = payload && payload.hourly;
  if (
    payloadHourly &&
    payloadHourly.period &&
    payloadHourly.period.start === state.hourlyStart &&
    payloadHourly.period.end === state.hourlyEnd
  ) {
    return payloadHourly;
  }
  return buildHourlyFromTransactions(readCachedTransactions().length ? readCachedTransactions() : (state.transactions || []));
}

function renderHourly(hourly) {
  if (!els.hourlyChart) return;
  const hours = Array.isArray(hourly.hours) ? hourly.hours : [];
  if (els.hourlyPeriodLabel) {
    els.hourlyPeriodLabel.textContent = hourly.period?.label || formatHourlyPeriodLabel();
  }
  if (els.hourlyAverage) {
    const totalSales = hours.reduce((total, item) => total + (Number(item.sales) || 0), 0);
    const average = totalSales / Math.max(hours.length || 24, 1);
    els.hourlyAverage.textContent = `${DECIMAL.format(average)} vendas/hora`;
  }
  renderHourlyChart(hours);
}

function resolvePeriodInsights(payload) {
  const candidate = payload && (payload.periodInsights || payload.insights);
  if (candidate && candidate.metrics) {
    return {
      ...candidate,
      metrics: {
        ...buildInsightMetricsFallback(payload),
        ...candidate.metrics
      }
    };
  }
  return {
    source: 'local_cache',
    error: '',
    period: payload?.period || buildLocalPeriod(),
    metrics: buildInsightMetricsFallback(payload)
  };
}

function renderInsightMetrics(insights) {
  if (!els.insightConversations) return;
  const metrics = insights?.metrics || {};
  els.insightConversations.textContent = NUMBER.format(Number(metrics.conversations) || 0);
  els.insightCostPerConversation.textContent = BRL.format(Number(metrics.costPerConversation) || 0);
  els.insightCpm.textContent = BRL.format(Number(metrics.cpm) || 0);
  els.insightCtr.textContent = PERCENT.format(Number(metrics.ctr) || 0);
}

function buildInsightMetricsFallback(payload) {
  const period = payload?.period || buildLocalPeriod();
  const transactions = getTransactionsForPeriod(period);
  const sales = transactions.length;
  const weekly = payload?.insights?.weekly || [];
  const totals = weekly.reduce((sum, day) => ({
    clicks: sum.clicks + (Number(day.clicks) || 0),
    conversations: sum.conversations + (Number(day.conversations) || 0),
    spend: sum.spend + (Number(day.spend) || 0),
    impressions: sum.impressions + (Number(day.impressions) || 0)
  }), { clicks: 0, conversations: 0, spend: 0, impressions: 0 });
  return {
    conversations: totals.conversations,
    costPerConversation: totals.conversations ? roundMoney(totals.spend / totals.conversations) : 0,
    cpm: totals.impressions ? roundMoney((totals.spend / totals.impressions) * 1000) : 0,
    ctr: totals.impressions ? totals.clicks / totals.impressions : 0,
    conversionRate: totals.conversations ? sales / totals.conversations : 0
  };
}

function getTransactionsForPeriod(period) {
  const start = parseInputDate(period?.start);
  const end = parseInputDate(period?.end);
  const rows = readCachedTransactions().length ? readCachedTransactions() : (state.transactions || []);
  return rows.filter((tx) => {
    const date = parseInputDate(tx.date);
    return date && (!start || date >= start) && (!end || date <= end) && Number(tx.amount) > 0;
  });
}

function resolveInsights(payload) {
  const cached = readInsightsSnapshot();
  if (cached && cached.insights) return cached.insights;
  const payloadInsights = payload && payload.insights;
  if (
    payloadInsights &&
    payloadInsights.period &&
    payloadInsights.period.start === state.insightsStart &&
    payloadInsights.period.end === state.insightsEnd
  ) {
    return payloadInsights;
  }
  return buildEmptyInsightsForRange();
}

function requestHourlyRefreshIfMissing() {
  if (!CONFIG.apiUrl) return;
  if (readHourlySnapshot()?.hourly) return;
  const payloadHourly = state.payload && state.payload.hourly;
  if (payloadHourly?.period?.start === state.hourlyStart && payloadHourly?.period?.end === state.hourlyEnd) return;
  const requestedStart = state.hourlyStart;
  const requestedEnd = state.hourlyEnd;
  fetchPayload({
    period: state.period,
    attendant: currentAttendantName(),
    start: els.startDate.value,
    end: els.endDate.value,
    hourlyStart: requestedStart,
    hourlyEnd: requestedEnd
  })
    .then((payload) => {
      if (!payload || !payload.ok) return;
      storeSnapshot(payload, {
        period: payload.period?.key || state.period,
        attendant: payload.attendant?.name || currentAttendantName(),
        start: payload.period?.key === 'custom' ? payload.period.start : '',
        end: payload.period?.key === 'custom' ? payload.period.end : ''
      });
      storeHourlySnapshot(payload.hourly);
      if (state.payload && payload.period?.key === state.payload.period?.key) {
        state.payload.hourly = payload.hourly;
      }
      if (state.hourlyStart !== requestedStart || state.hourlyEnd !== requestedEnd) return;
      renderHourly(resolveHourly(state.payload || payload));
    })
    .catch(() => {});
}

function requestInsightsRefreshIfMissing() {
  if (!CONFIG.apiUrl) return;
  if (readInsightsSnapshot()?.insights) return;
  const payloadInsights = state.payload && state.payload.insights;
  if (payloadInsights?.period?.start === state.insightsStart && payloadInsights?.period?.end === state.insightsEnd) return;
  const requestedStart = state.insightsStart;
  const requestedEnd = state.insightsEnd;
  fetchPayload({
    period: state.period,
    attendant: currentAttendantName(),
    start: els.startDate.value,
    end: els.endDate.value,
    insightsStart: requestedStart,
    insightsEnd: requestedEnd
  })
    .then((payload) => {
      if (!payload || !payload.ok) return;
      storeSnapshot(payload, {
        period: payload.period?.key || state.period,
        attendant: payload.attendant?.name || currentAttendantName(),
        start: payload.period?.key === 'custom' ? payload.period.start : '',
        end: payload.period?.key === 'custom' ? payload.period.end : ''
      });
      storeInsightsSnapshot(payload.insights);
      if (state.payload && payload.period?.key === state.payload.period?.key) {
        state.payload.insights = payload.insights;
      }
      if (state.insightsStart !== requestedStart || state.insightsEnd !== requestedEnd) return;
      renderInsights(resolveInsights(state.payload || payload));
    })
    .catch(() => {});
}

function warmNearbyInsightCaches() {
  if (!CONFIG.apiUrl) return;
  window.clearTimeout(state.warmInsightsTimer);
  state.warmInsightsTimer = window.setTimeout(() => {
    const start = parseInputDate(state.insightsStart);
    const end = parseInputDate(state.insightsEnd);
    if (!start || !end) return;
    const previousStart = new Date(start);
    const previousEnd = new Date(end);
    previousStart.setDate(previousStart.getDate() - 7);
    previousEnd.setDate(previousEnd.getDate() - 7);
    warmInsightRange(previousStart, previousEnd);
  }, 900);
}

function warmInsightRange(startDate, endDate) {
  const start = toInputDate(startDate);
  const end = toInputDate(endDate);
  if (readInsightsSnapshot({ start, end })?.insights) return;
  fetchPayload({
    period: state.period,
    attendant: currentAttendantName(),
    start: els.startDate.value,
    end: els.endDate.value,
    insightsStart: start,
    insightsEnd: end
  })
    .then((payload) => {
      if (!payload || !payload.ok) return;
      storeInsightsSnapshot(payload.insights);
      storeTransactionsFromPayload(payload);
    })
    .catch(() => {});
}

function renderHourlyChart(hours) {
  const width = 720;
  const height = 280;
  const left = 34;
  const right = 16;
  const top = 18;
  const bottom = 42;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const maxSales = Math.max(1, ...hours.map((item) => Number(item.sales) || 0));
  const barGap = 4;
  const barW = Math.max(6, (innerW / 24) - barGap);

  els.hourlyChart.innerHTML = '';
  [0, 0.5, 1].forEach((ratio) => {
    const y = top + innerH - (innerH * ratio);
    els.hourlyChart.append(svg('line', { x1: left, x2: width - right, y1: y, y2: y, class: 'chart-grid' }));
    els.hourlyChart.append(svg('text', { x: 4, y: y + 4, class: 'chart-label' }, NUMBER.format(Math.round(maxSales * ratio))));
  });

  hours.forEach((item, index) => {
    const sales = Number(item.sales) || 0;
    const revenue = Number(item.revenue) || 0;
    const x = left + (innerW / 24) * index + (barGap / 2);
    const barH = (sales / maxSales) * innerH;
    const y = top + innerH - barH;
    const bar = svg('rect', {
      x,
      y,
      width: barW,
      height: Math.max(1, barH),
      rx: 4,
      class: 'hourly-bar'
    });
    bindTooltip(bar, `${item.label}\nVendas: ${NUMBER.format(sales)}\nFaturamento: ${BRL.format(revenue)}`);
    els.hourlyChart.append(bar);
    els.hourlyChart.append(svg('text', {
      x: x + (barW / 2),
      y: height - 12,
      'text-anchor': 'middle',
      class: 'hourly-axis-label'
    }, String(item.hour).padStart(2, '0')));
  });
}

function renderInsights(insights) {
  if (!els.insightConversations || !els.conversionChart || !els.insightsRows) return;
  const weekly = Array.isArray(insights.weekly) ? insights.weekly : [];
  const periodLabel = insights.period?.label || formatInsightPeriodLabel();
  els.insightsPeriodLabel.textContent = insights.source === 'api'
    ? periodLabel
    : (insights.error ? 'Meta indisponível' : periodLabel);
  const totals = weekly.reduce((sum, day) => ({
    clicks: sum.clicks + (Number(day.clicks) || 0),
    conversations: sum.conversations + (Number(day.conversations) || 0),
    sales: sum.sales + (Number(day.sales) || 0)
  }), { clicks: 0, conversations: 0, sales: 0 });
  if (els.clicksPerSale) els.clicksPerSale.textContent = formatRatio(totals.sales ? totals.clicks / totals.sales : 0);
  if (els.conversationsPerSale) els.conversationsPerSale.textContent = formatRatio(totals.sales ? totals.conversations / totals.sales : 0);
  if (els.insightsConversionAverage) {
    const conversion = totals.conversations ? totals.sales / totals.conversations : 0;
    els.insightsConversionAverage.textContent = `${PERCENT.format(conversion)} de conv.`;
  }

  renderConversionChart(weekly);
  renderInsightsTable(weekly);
}

function renderInsightsTable(days) {
  els.insightsRows.innerHTML = '';
  if (!days.length) {
    els.insightsRows.innerHTML = '<tr><td colspan="4">Sem dados na semana atual.</td></tr>';
    return;
  }
  days.forEach((day) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(day.label || '')}</td>
      <td>${NUMBER.format(Number(day.clicks) || 0)} <span class="subpercent">(100%)</span></td>
      <td>${NUMBER.format(Number(day.conversations) || 0)} <span class="subpercent">(${PERCENT.format(Number(day.conversationClickRate) || 0)})</span></td>
      <td>${NUMBER.format(Number(day.sales) || 0)} <span class="subpercent">(${PERCENT.format(Number(day.salesClickRate) || 0)})</span></td>
    `;
    els.insightsRows.appendChild(row);
  });
}

function renderConversionChart(days) {
  const width = 720;
  const height = 280;
  const left = 58;
  const right = 22;
  const top = 22;
  const bottom = 42;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const values = days.map((day) => Number(day.conversionRate) || 0);
  const max = Math.max(0.01, ...values);
  const paddedMax = max < 0.1 ? 0.1 : max * 1.2;
  const x = (index) => left + (innerW / Math.max(days.length - 1, 1)) * index;
  const y = (value) => top + innerH - ((value / paddedMax) * innerH);
  const points = days.map((day, index) => `${x(index)},${y(Number(day.conversionRate) || 0)}`).join(' ');
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => paddedMax * ratio);

  els.conversionChart.innerHTML = '';
  yTicks.forEach((value) => {
    const yy = y(value);
    els.conversionChart.append(svg('line', { x1: left, x2: width - right, y1: yy, y2: yy, class: 'chart-grid' }));
    els.conversionChart.append(svg('text', { x: 8, y: yy + 4, class: 'chart-label' }, PERCENT.format(value)));
  });
  els.conversionChart.append(svg('polyline', { points, class: 'chart-line-conversion' }));

  days.forEach((day, index) => {
    const xx = x(index);
    const rate = Number(day.conversionRate) || 0;
    const dot = svg('circle', { cx: xx, cy: y(rate), r: 4, class: 'chart-dot' });
    bindTooltip(dot, `${day.label}\nConversao: ${PERCENT.format(rate)}\nVendas: ${NUMBER.format(Number(day.sales) || 0)}\nConversas: ${NUMBER.format(Number(day.conversations) || 0)}`);
    els.conversionChart.append(dot);
    els.conversionChart.append(svg('text', { x: xx, y: height - 10, 'text-anchor': 'middle', class: 'chart-label' }, String(day.label || '').split(' ')[0]));
  });
}

function buildEmptyInsights(weekly) {
  return {
    source: 'cache_empty',
    error: '',
    period: {
      start: state.insightsStart,
      end: state.insightsEnd,
      label: formatInsightPeriodLabel()
    },
    metrics: {
      conversations: 0,
      costPerConversation: 0,
      cpm: 0,
      ctr: 0
    },
    weekly: (weekly || []).map((day) => ({
      label: day.label,
      date: day.date,
      clicks: 0,
      conversations: 0,
      sales: Number(day.sales) || 0,
      conversionRate: 0,
      conversationClickRate: 0,
      salesClickRate: 0
    }))
  };
}

function buildEmptyInsightMetrics() {
  return {
    source: 'cache_empty',
    error: '',
    metrics: {
      conversations: 0,
      costPerConversation: 0,
      cpm: 0,
      ctr: 0
    }
  };
}

function buildEmptyInsightsForRange() {
  const cachedTransactions = readCachedTransactions();
  return buildEmptyInsights(buildInsightDaysForRange().map((day) => ({
    ...day,
    sales: cachedTransactions.filter((tx) => tx.date === day.date && Number(tx.amount) > 0).length
  })));
}

function buildEmptyHourlyForRange() {
  return {
    period: {
      start: state.hourlyStart,
      end: state.hourlyEnd,
      label: formatHourlyPeriodLabel()
    },
    hours: buildHourlyRows([])
  };
}

function buildHourlyFromTransactions(transactions) {
  return {
    period: {
      start: state.hourlyStart,
      end: state.hourlyEnd,
      label: formatHourlyPeriodLabel()
    },
    hours: buildHourlyRows(transactions || [])
  };
}

function buildDemoHourly(transactions) {
  return {
    period: {
      start: state.hourlyStart,
      end: state.hourlyEnd,
      label: formatHourlyPeriodLabel()
    },
    hours: buildHourlyRows(transactions)
  };
}

function buildHourlyRows(transactions) {
  const start = parseInputDate(state.hourlyStart);
  const end = parseInputDate(state.hourlyEnd);
  const rows = Array.from({ length: 24 }, (_, hour) => ({
    hour,
    label: `${String(hour).padStart(2, '0')}h`,
    sales: 0,
    revenue: 0
  }));
  (transactions || []).forEach((tx) => {
    const date = parseInputDate(tx.date);
    if (!date || (start && date < start) || (end && date > end) || Number(tx.amount) <= 0) return;
    const hour = parseHour(tx.time);
    rows[hour].sales += 1;
    rows[hour].revenue = roundMoney(rows[hour].revenue + (Number(tx.amount) || 0));
  });
  return rows;
}

function buildDemoInsights(transactions) {
  const days = buildInsightDaysForRange().map((day, index) => {
    const sales = transactions.filter((tx) => tx.date === day.date && Number(tx.amount) > 0).length;
    const clicks = 80 + (index * 17);
    const conversations = Math.max(0, Math.round(clicks * (0.32 + (index % 3) * 0.04)));
    return {
      ...day,
      clicks,
      conversations,
      sales,
      spend: 0,
      impressions: clicks * 9,
      conversionRate: conversations ? sales / conversations : 0,
      conversationClickRate: clicks ? conversations / clicks : 0,
      salesClickRate: clicks ? sales / clicks : 0
    };
  });
  const totals = days.reduce((sum, day) => ({
    clicks: sum.clicks + day.clicks,
    conversations: sum.conversations + day.conversations,
    impressions: sum.impressions + day.impressions
  }), { clicks: 0, conversations: 0, impressions: 0 });
  return {
    source: 'demo',
    error: '',
    period: {
      start: state.insightsStart,
      end: state.insightsEnd,
      label: formatInsightPeriodLabel()
    },
    metrics: {
      conversations: totals.conversations,
      costPerConversation: 0,
      cpm: 0,
      ctr: totals.impressions ? totals.clicks / totals.impressions : 0
    },
    weekly: days
  };
}

function buildInsightDaysForRange() {
  const start = parseInputDate(state.insightsStart) || currentWeekRange(new Date()).start;
  const end = parseInputDate(state.insightsEnd) || currentWeekRange(new Date()).end;
  const days = [];
  const cursor = new Date(start);
  while (cursor <= end && days.length < 7) {
    days.push({
      label: `${weekdayShort(cursor)} (${cursor.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`,
      date: toInputDate(cursor),
      clicks: 0,
      conversations: 0,
      sales: 0,
      conversionRate: 0,
      conversationClickRate: 0,
      salesClickRate: 0
    });
    cursor.setDate(cursor.getDate() + 1);
  }
  return days;
}

function completeAttendantSales(attendantSales) {
  const byName = new Map((attendantSales || []).map((item) => [normalizeText(item.name), item]));
  const seen = new Set();
  const configured = state.attendants.map((attendant) => {
    const key = normalizeText(attendant.name);
    const item = byName.get(key) || {};
    seen.add(key);
    return {
      name: attendant.name || item.name || '',
      centsLabel: item.centsLabel || (attendant.cents !== '' && attendant.cents !== null && attendant.cents !== undefined ? `,${String(attendant.cents).padStart(2, '0')}` : ''),
      sales: Number(item.sales) || 0,
      revenue: Number(item.revenue) || 0,
      avgTicket: Number(item.avgTicket) || 0
    };
  });

  const extras = (attendantSales || [])
    .filter((item) => !seen.has(normalizeText(item.name)))
    .map((item) => ({
      name: item.name || '',
      centsLabel: item.centsLabel || '',
      sales: Number(item.sales) || 0,
      revenue: Number(item.revenue) || 0,
      avgTicket: Number(item.avgTicket) || 0
    }));

  return [...configured, ...extras].filter((item) => item.name || item.sales || item.revenue);
}

function renderDonutChart(svg, legend, values, formatValue) {
  const total = values.reduce((sum, item) => sum + Math.max(0, Number(item.value) || 0), 0);
  const highlight = values[1] || { value: 0, label: 'Atendentes', color: '#9FE870' };
  const pct = total ? Math.max(0, Math.min(1, Number(highlight.value) / total)) : 0;
  const radius = 48;
  const circumference = 2 * Math.PI * radius;
  const activeLength = pct * circumference;
  const percentLabel = total ? `${Math.round(pct * 100)}%` : '0%';

  svg.innerHTML = `
    <circle class="donut-track" cx="72" cy="78" r="${radius}"></circle>
    <circle class="donut-segment" cx="72" cy="78" r="${radius}"
      stroke="${highlight.color}" stroke-dasharray="${activeLength} ${circumference - activeLength}"
      stroke-dashoffset="0"></circle>
    <text class="donut-percent" x="72" y="72" text-anchor="middle">${percentLabel}</text>
    <text class="donut-label" x="72" y="94" text-anchor="middle">atendentes</text>
    <text class="donut-total" x="142" y="70">${escapeHtml(formatValue(total))}</text>
    <text class="donut-total-label" x="142" y="92">total</text>
  `;

  legend.innerHTML = values.map((item) => {
    const value = Math.max(0, Number(item.value) || 0);
    const itemPct = total ? value / total : 0;
    return `
      <div class="mix-legend-row">
        <span class="legend-dot" style="background:${item.color}"></span>
        <span>${escapeHtml(item.label)}</span>
        <strong>${escapeHtml(formatValue(value))} - ${PERCENT.format(itemPct)}</strong>
      </div>
    `;
  }).join('');
}

function renderAttendantBarChart(rows) {
  const sorted = [...rows]
    .sort((a, b) => (Number(b.revenue) || 0) - (Number(a.revenue) || 0) || (Number(b.sales) || 0) - (Number(a.sales) || 0));
  const width = 720;
  const left = 150;
  const right = 170;
  const top = 24;
  const rowH = 42;
  const height = Math.max(190, top + (Math.max(sorted.length, 1) * rowH) + 24);
  const innerW = width - left - right;
  const maxRevenue = Math.max(1, ...sorted.map((item) => Number(item.revenue) || 0));
  els.attendantBarChart.setAttribute('viewBox', `0 0 ${width} ${height}`);

  if (!sorted.length) {
    els.attendantBarChart.innerHTML = '<text class="bar-empty" x="24" y="72">Nenhuma atendente configurada.</text>';
    return;
  }

  els.attendantBarChart.innerHTML = sorted.map((item, index) => {
    const y = top + index * rowH;
    const revenue = Number(item.revenue) || 0;
    const sales = Number(item.sales) || 0;
    const barW = Math.max(0, (revenue / maxRevenue) * innerW);
    return `
      <text class="bar-name" x="0" y="${y + 18}">${escapeHtml(item.name || 'Sem nome')}</text>
      <rect class="bar-track" x="${left}" y="${y}" width="${innerW}" height="18" rx="6"></rect>
      <rect class="bar-fill" x="${left}" y="${y}" width="${barW}" height="18" rx="6"></rect>
      <text class="bar-value" x="${left + innerW + 14}" y="${y + 14}">${escapeHtml(BRL.format(revenue))}</text>
      <text class="bar-sales" x="${left}" y="${y + 35}">${NUMBER.format(sales)} vendas - ticket médio ${escapeHtml(BRL.format(sales ? revenue / sales : 0))}</text>
    `;
  }).join('');
}

function buildAttendantSalesFromTransactions(transactions, attendants) {
  return attendants.map((attendant) => {
    const cents = Number(attendant.cents);
    const rows = transactions.filter((tx) => {
      const manual = normalizeText(tx.manualAttendant);
      if (manual) return manual === normalizeText(attendant.name);
      return amountMatchesCents(Number(tx.amount) || 0, cents);
    });
    const revenue = roundMoney(rows.reduce((total, tx) => total + (Number(tx.amount) || 0), 0));
    return {
      name: attendant.name,
      cents,
      centsLabel: `,${String(cents).padStart(2, '0')}`,
      sales: rows.length,
      revenue,
      avgTicket: rows.length ? roundMoney(revenue / rows.length) : 0,
      transactions: rows
    };
  }).filter((item) => item.sales || item.revenue);
}

function amountMatchesCents(amount, cents) {
  return Math.round(Math.abs(Number(amount) || 0) * 100) % 100 === Number(cents);
}

function renderAttendantEditor(attendants) {
  els.attendantEditor.innerHTML = '';
  attendants.forEach((attendant, index) => {
    const row = document.createElement('div');
    row.className = 'attendant-row';
    row.innerHTML = `
      <input data-attendant-name="${index}" value="${escapeHtml(attendant.name || '')}" placeholder="Nome">
      <input data-attendant-cents="${index}" value="${escapeHtml(String(attendant.cents || ''))}" inputmode="numeric" maxlength="2" placeholder="Final">
      <button class="icon-button" type="button" data-remove-attendant="${index}" aria-label="Remover">×</button>
    `;
    els.attendantEditor.append(row);
  });

  $$('[data-attendant-name]').forEach((input) => {
    input.addEventListener('input', () => {
      state.attendants[Number(input.dataset.attendantName)].name = input.value;
    });
  });
  $$('[data-attendant-cents]').forEach((input) => {
    input.addEventListener('input', () => {
      input.value = input.value.replace(/\D/g, '').slice(0, 2);
      state.attendants[Number(input.dataset.attendantCents)].cents = input.value;
    });
  });
  $$('[data-remove-attendant]').forEach((button) => {
    button.addEventListener('click', () => {
      state.attendants.splice(Number(button.dataset.removeAttendant), 1);
      renderAttendantEditor(state.attendants);
    });
  });
}

async function saveAttendants() {
  const attendants = state.attendants
    .map((attendant) => ({
      name: String(attendant.name || '').trim(),
      cents: String(attendant.cents || '').padStart(2, '0').slice(-2)
    }))
    .filter((attendant) => attendant.name && attendant.cents);

  if (!attendants.length) {
    alert('Adicione pelo menos uma atendente com nome e final de centavos.');
    return;
  }

  if (!CONFIG.apiUrl) {
    localStorage.setItem('homestudio.attendantsDraft', JSON.stringify(attendants));
    alert('Rascunho salvo neste navegador. Quando ligar a API, esse botao salva na planilha.');
    return;
  }

  const adminKey = els.adminKey.value.trim();
  if (!adminKey) {
    alert('Informe o PIN admin antes de salvar.');
    return;
  }

  try {
    const response = await fetch(CONFIG.apiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action: 'saveAttendants', adminKey, attendants })
    });
    const payload = await response.json();
    if (!payload.ok) throw new Error(payload.error || 'Nao foi possivel salvar.');
    alert('Atendentes salvos na planilha.');
    await refreshDashboardSnapshots();
  } catch (error) {
    alert(error.message || 'Nao foi possivel salvar os atendentes.');
  }
}

function renderChart(days) {
  const width = 720;
  const height = 280;
  const left = 58;
  const right = 22;
  const top = 22;
  const bottom = 42;
  const innerW = width - left - right;
  const innerH = height - top - bottom;
  const values = days.flatMap((day) => [Number(day.revenue) || 0, Number(day.profit) || 0]);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const range = max - min || 1;
  const x = (index) => left + (innerW / Math.max(days.length - 1, 1)) * index;
  const y = (value) => top + innerH - (((value - min) / range) * innerH);

  const revenuePoints = days.map((day, index) => `${x(index)},${y(day.revenue)}`).join(' ');
  const profitPoints = days.map((day, index) => `${x(index)},${y(day.profit)}`).join(' ');
  const yTicks = [0, 0.25, 0.5, 0.75, 1].map((ratio) => min + range * ratio);

  els.chart.innerHTML = '';
  yTicks.forEach((value) => {
    const yy = y(value);
    els.chart.append(svg('line', { x1: left, x2: width - right, y1: yy, y2: yy, class: 'chart-grid' }));
    els.chart.append(svg('text', { x: 8, y: yy + 4, class: 'chart-label' }, compactMoney(value)));
  });

  els.chart.append(svg('polyline', { points: revenuePoints, class: 'chart-line-revenue' }));
  els.chart.append(svg('polyline', { points: profitPoints, class: 'chart-line-profit' }));

  days.forEach((day, index) => {
    const xx = x(index);
    const revenueDot = svg('circle', { cx: xx, cy: y(day.revenue), r: 5, class: 'chart-dot' });
    const profitDot = svg('circle', { cx: xx, cy: y(day.profit), r: 4, class: 'chart-dot-profit' });
    bindTooltip(revenueDot, `${day.label}\nFaturamento: ${BRL.format(day.revenue)}`);
    bindTooltip(profitDot, `${day.label}\nLucro: ${BRL.format(day.profit)}`);
    els.chart.append(revenueDot);
    els.chart.append(profitDot);
    els.chart.append(svg('text', { x: xx, y: height - 10, 'text-anchor': 'middle', class: 'chart-label' }, day.label.split(' ')[0]));
  });
}

function bindTooltip(node, text) {
  node.addEventListener('mouseenter', (event) => showTooltip(event, text));
  node.addEventListener('mousemove', (event) => showTooltip(event, text));
  node.addEventListener('mouseleave', hideTooltip);
}

function showTooltip(event, text) {
  els.tooltip.hidden = false;
  els.tooltip.innerHTML = escapeHtml(text).replace(/\n/g, '<br>');
  els.tooltip.style.left = `${event.clientX + 12}px`;
  els.tooltip.style.top = `${event.clientY + 12}px`;
}

function hideTooltip() {
  els.tooltip.hidden = true;
}

function svg(tag, attrs, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value));
  if (text !== undefined) node.textContent = text;
  return node;
}

function setTone(card, value) {
  card.classList.add('tone-enabled');
  card.classList.toggle('negative', Number(value) < 0);
  card.classList.toggle('positive', Number(value) >= 0);
}

function setStatus(text) {
  els.status.textContent = text;
}

function formatCachedStatus(record) {
  if (!record || !record.cachedAt) return 'Salvo';
  const date = new Date(record.cachedAt);
  if (Number.isNaN(date.getTime())) return 'Salvo';
  return `Salvo ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function formatStatus(payload) {
  if (!CONFIG.apiUrl) return 'Demo local';
  if (!payload.lastSync || !payload.lastSync.when) return 'Atualizado';
  const date = new Date(payload.lastSync.when);
  if (Number.isNaN(date.getTime())) return 'Atualizado';
  return `Atualizado ${date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`;
}

function parseMoney(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '').replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
  return Number(text) || 0;
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function formatDecimal(value) {
  return new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value) || 0);
}

function formatRatio(value) {
  return NUMBER.format(Math.ceil(Number(value) || 0));
}

function compactMoney(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1000) return `R$ ${(number / 1000).toFixed(1).replace('.', ',')}k`;
  return `R$ ${Math.round(number)}`;
}

function toInputDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function formatDateDisplay(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}

function parseInputDate(value) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function parseHour(value) {
  const match = String(value || '').match(/^(\d{1,2})/);
  const hour = match ? Number(match[1]) : 0;
  return Math.max(0, Math.min(23, Number.isFinite(hour) ? hour : 0));
}

function weekdayShort(date) {
  return ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'][date.getDay()];
}

function formatInsightPeriodLabel() {
  const start = parseInputDate(state.insightsStart);
  const end = parseInputDate(state.insightsEnd);
  if (!start || !end) return 'Semana atual';
  return `${start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${end.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

function formatHourlyPeriodLabel() {
  const start = parseInputDate(state.hourlyStart);
  const end = parseInputDate(state.hourlyEnd);
  if (!start || !end) return 'Hoje';
  if (state.hourlyStart === state.hourlyEnd) {
    return start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  }
  return `${start.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} a ${end.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}`;
}

function normalizeText(value) {
  return String(value || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function demoPayload() {
  const today = new Date();
  const weekStart = new Date(today);
  weekStart.setHours(0, 0, 0, 0);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const base = [89.9, 129.9, 358.4, 281.7, 198.8, 64.5, 0];
  const sales = [6, 8, 24, 17, 12, 4, 0];
  const labels = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];
  const weekly = labels.map((label, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return {
      label: `${label} (${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`,
      date: toInputDate(date),
      revenue: base[index],
      profit: base[index],
      sales: sales[index]
    };
  });
  const selected = selectDemoPeriod(weekly);
  const revenue = roundMoney(selected.days.reduce((total, day) => total + day.revenue, 0));
  const totalSales = selected.days.reduce((total, day) => total + day.sales, 0);
  const periodMultiplier = selected.multiplier || 1;
  const displayedRevenue = roundMoney(revenue * periodMultiplier);
  const displayedSales = Math.round(totalSales * periodMultiplier);
  const demoTransactions = buildDemoTransactions(selected.days, periodMultiplier);
  return {
    ok: true,
    app: 'HOMESTUDIO BI',
    generatedAt: today.toISOString(),
    period: {
      key: state.period,
      label: periodName(state.period),
      start: selected.start,
      end: selected.end,
      referenceDate: toInputDate(today)
    },
    attendant: { name: 'Sheila', cents: 97, centsLabel: ',97' },
    attendants: [{ name: 'Sheila', cents: 97, note: 'Vendas com final ,97' }],
    metrics: {
      revenue: displayedRevenue,
      sales: displayedSales,
      attendantRevenue: roundMoney(demoTransactions.filter((tx) => amountMatchesCents(tx.amount, 97)).reduce((total, tx) => total + tx.amount, 0)),
      attendantSales: demoTransactions.filter((tx) => amountMatchesCents(tx.amount, 97)).length,
      metaSpend: 0,
      metaTax: 0,
      investment: 0,
      profit: displayedRevenue,
      margin: displayedRevenue ? 1 : 0,
      avgTicket: displayedSales ? roundMoney(displayedRevenue / displayedSales) : 0,
      cpa: 0,
      roas: 0,
      adjustedRoas: 0
    },
    weekly,
    transactions: demoTransactions,
    attendantSales: [{
      name: 'Sheila',
      cents: 97,
      centsLabel: ',97',
      sales: demoTransactions.filter((tx) => amountMatchesCents(tx.amount, 97)).length,
      revenue: roundMoney(demoTransactions.filter((tx) => amountMatchesCents(tx.amount, 97)).reduce((total, tx) => total + tx.amount, 0)),
      avgTicket: 12.97,
      transactions: demoTransactions.filter((tx) => amountMatchesCents(tx.amount, 97))
    }],
    lastSync: null,
    currencies: [{ currency: 'BRL', revenue: displayedRevenue, sales: displayedSales }],
    hourly: buildDemoHourly(demoTransactions),
    periodInsights: buildDemoInsights(demoTransactions),
    insights: buildDemoInsights(demoTransactions)
  };
}

function emptyPayload() {
  const today = new Date();
  const attendants = readCachedAttendants();
  const attendantName = currentAttendantName();
  const selected = attendants.find((attendant) => normalizeText(attendant.name) === normalizeText(attendantName)) ||
    attendants[0] ||
    { name: attendantName || 'Sheila', cents: 97, note: 'Vendas com final ,97' };
  const period = buildLocalPeriod();
  const weekStart = new Date(today);
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const labels = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];
  const weekly = labels.map((label, index) => {
    const date = new Date(weekStart);
    date.setDate(date.getDate() + index);
    return {
      label: `${label} (${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`,
      date: toInputDate(date),
      revenue: 0,
      profit: 0,
      sales: 0
    };
  });

  return {
    ok: true,
    app: 'HOMESTUDIO BI',
    generatedAt: today.toISOString(),
    period,
    attendant: selected,
    attendants: attendants.length ? attendants : [selected],
    metrics: {
      revenue: 0,
      sales: 0,
      attendantRevenue: 0,
      attendantSales: 0,
      metaSpend: 0,
      metaTax: 0,
      investment: 0,
      profit: 0,
      margin: 0,
      avgTicket: 0,
      cpa: 0,
      roas: 0,
      adjustedRoas: 0,
      metaSpendSource: 'cache_empty'
    },
    weekly,
    transactions: [],
    attendantSales: [],
    lastSync: null,
    currencies: [],
    hourly: buildEmptyHourlyForRange(),
    periodInsights: buildEmptyInsightMetrics(),
    insights: buildEmptyInsightsForRange()
  };
}

function buildLocalPeriod() {
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (state.period === 'yesterday') {
    return { key: 'yesterday', label: 'Ontem', start: toInputDate(yesterday), end: toInputDate(yesterday), referenceDate: toInputDate(today) };
  }
  if (state.period === '7d') {
    const start = new Date(today);
    start.setDate(start.getDate() - 7);
    return { key: '7d', label: 'Últimos 7 dias', start: toInputDate(start), end: toInputDate(yesterday), referenceDate: toInputDate(today) };
  }
  if (state.period === 'this_month') {
    return { key: 'this_month', label: 'Este mês', start: startOfMonthInput(today), end: toInputDate(today), referenceDate: toInputDate(today) };
  }
  if (state.period === 'last_month') {
    const lastMonth = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    return { key: 'last_month', label: 'Mês passado', start: startOfMonthInput(lastMonth), end: endOfMonthInput(lastMonth), referenceDate: toInputDate(today) };
  }
  if (state.period === 'custom') {
    return { key: 'custom', label: 'Personalizado', start: els.startDate.value, end: els.endDate.value, referenceDate: toInputDate(today) };
  }
  return { key: 'today', label: 'Hoje', start: toInputDate(today), end: toInputDate(today), referenceDate: toInputDate(today) };
}

function selectDemoPeriod(weekly) {
  const todayInput = toInputDate(new Date());
  const todayIndex = weekly.findIndex((day) => day.date === todayInput);
  const safeTodayIndex = todayIndex >= 0 ? todayIndex : Math.min(weekly.length - 1, Math.max(0, new Date().getDay() - 1));
  const yesterdayIndex = Math.max(0, safeTodayIndex - 1);

  if (state.period === 'today') {
    return { days: [weekly[safeTodayIndex]], start: weekly[safeTodayIndex].date, end: weekly[safeTodayIndex].date };
  }
  if (state.period === 'yesterday') {
    return { days: [weekly[yesterdayIndex]], start: weekly[yesterdayIndex].date, end: weekly[yesterdayIndex].date };
  }
  if (state.period === '7d') {
    const labels = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB'];
    const amounts = [112.9, 148.7, 212.5, 176.4, 198.8, 164.5, 96.9];
    const days = Array.from({ length: 7 }, (_, index) => {
      const date = new Date();
      date.setDate(date.getDate() - (7 - index));
      const weekday = labels[date.getDay()];
      return {
        label: `${weekday} (${date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })})`,
        date: toInputDate(date),
        revenue: amounts[index],
        profit: amounts[index],
        sales: Math.max(1, Math.round(amounts[index] / 12.9))
      };
    });
    return { days, start: days[0].date, end: days[6].date };
  }
  if (state.period === 'this_month') {
    return { days: weekly, start: startOfMonthInput(new Date()), end: todayInput, multiplier: 4.2 };
  }
  if (state.period === 'last_month') {
    const lastMonth = new Date();
    lastMonth.setMonth(lastMonth.getMonth() - 1);
    return { days: weekly, start: startOfMonthInput(lastMonth), end: endOfMonthInput(lastMonth), multiplier: 3.8 };
  }
  if (state.period === 'custom') {
    return { days: weekly.slice(1, 5), start: els.startDate.value || weekly[1].date, end: els.endDate.value || weekly[4].date, multiplier: 1.4 };
  }
  const endIndex = Math.max(0, safeTodayIndex - 1);
  const startIndex = Math.max(0, endIndex - 6);
  return { days: weekly.slice(startIndex, endIndex + 1), start: weekly[startIndex].date, end: weekly[endIndex].date };
}

function buildDemoTransactions(days, multiplier) {
  const repeat = Math.max(1, Math.round(multiplier || 1));
  return days.flatMap((day) => {
    const visibleSales = Math.min(day.sales * repeat, 60);
    return Array.from({ length: visibleSales }, (_, index) => ({
      date: day.date,
      payer: index % 5 === 0 ? `Cliente Sheila ${index + 1}` : `Cliente ${index + 1}`,
      currency: 'BRL',
      amount: index % 5 === 0 ? 12.97 : (index % 3 === 0 ? 24.9 : 12.9),
      time: `${String((8 + index) % 24).padStart(2, '0')}:${String((index * 7) % 60).padStart(2, '0')}`,
      description: 'Transferencia Wise'
    }));
  });
}

function periodName(period) {
  const names = {};
  names.today = 'Hoje';
  names.yesterday = 'Ontem';
  names['7d'] = 'Últimos 7 dias';
  names.this_month = 'Este mês';
  names.last_month = 'Mês passado';
  names.custom = 'Personalizado';
  return names[period] || 'Hoje';
}

function startOfMonthInput(date) {
  return toInputDate(new Date(date.getFullYear(), date.getMonth(), 1));
}

function endOfMonthInput(date) {
  return toInputDate(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

init();
