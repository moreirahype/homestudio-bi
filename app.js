const CONFIG = window.HOMESTUDIO_BI_CONFIG || {};
const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: CONFIG.currency || 'BRL' });
const NUMBER = new Intl.NumberFormat('pt-BR');
const PERCENT = new Intl.NumberFormat('pt-BR', { style: 'percent', minimumFractionDigits: 1, maximumFractionDigits: 1 });

const state = {
  period: CONFIG.defaultPeriod || 'today',
  view: 'dashboard',
  payload: null,
  attendants: [],
  transactions: []
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
  attendantSalesPeriod: $('#attendantSalesPeriod'),
  attendantSalesRows: $('#attendantSalesRows'),
  attendantSalesDetailRows: $('#attendantSalesDetailRows'),
  attendantEditor: $('#attendantEditor'),
  addAttendant: $('#addAttendantButton'),
  saveAttendants: $('#saveAttendantsButton'),
  adminKey: $('#adminKey'),
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

  $$('.period-button').forEach((button) => {
    button.addEventListener('click', () => {
      state.period = button.dataset.period;
      updatePeriodButtons();
      loadDashboard();
    });
  });

  $$('[data-view]').forEach((button) => {
    button.addEventListener('click', (event) => {
      event.preventDefault();
      setView(button.dataset.view);
    });
  });

  [els.startDate, els.endDate].forEach((input) => input.addEventListener('change', loadDashboard));
  els.attendantSelect.addEventListener('change', () => {
    localStorage.setItem('homestudio.attendant', els.attendantSelect.value);
    loadDashboard();
  });
  els.transactionSearch.addEventListener('input', () => renderTransactions(state.transactions));
  els.addAttendant.addEventListener('click', () => {
    state.attendants.push({ name: '', cents: '', note: '' });
    renderAttendantEditor(state.attendants);
  });
  els.saveAttendants.addEventListener('click', saveAttendants);
  els.refresh.addEventListener('click', loadDashboard);
  els.refreshSide.addEventListener('click', loadDashboard);

  updatePeriodButtons();
  setView('dashboard');
  loadDashboard();

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

function setView(view) {
  state.view = view;
  $$('[data-view]').forEach((button) => button.classList.toggle('active', button.dataset.view === view));
  $$('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === view));
}

function updatePeriodButtons() {
  $$('.period-button').forEach((button) => {
    button.classList.toggle('active', button.dataset.period === state.period);
  });
  els.customRange.hidden = state.period !== 'custom';
}

async function loadDashboard() {
  setStatus('Atualizando');
  try {
    const payload = CONFIG.apiUrl ? await fetchPayload() : demoPayload();
    state.payload = payload;
    render(normalizeFinancialMetrics(payload));
    setStatus(formatStatus(payload));
  } catch (error) {
    console.error(error);
    const payload = demoPayload();
    state.payload = payload;
    render(normalizeFinancialMetrics(payload));
    setStatus('Demo local');
  }
}

async function fetchPayload() {
  const url = new URL(CONFIG.apiUrl);
  url.searchParams.set('period', state.period);
  if (els.attendantSelect.value) url.searchParams.set('attendant', els.attendantSelect.value);
  if (state.period === 'custom') {
    url.searchParams.set('start', els.startDate.value);
    url.searchParams.set('end', els.endDate.value);
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
  const weekly = allocateWeeklyProfit(payload.weekly || [], investment);

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

function allocateWeeklyProfit(days, totalCost) {
  const revenue = days.reduce((total, day) => total + (Number(day.revenue) || 0), 0);
  return days.map((day) => {
    const allocatedCost = revenue ? totalCost * ((Number(day.revenue) || 0) / revenue) : 0;
    return {
      ...day,
      profit: roundMoney((Number(day.revenue) || 0) - allocatedCost)
    };
  });
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
    api: 'Gasto Meta vindo automaticamente da API da Meta.',
    sheet: 'Gasto Meta vindo da planilha.',
    not_configured: 'Meta Ads ainda nao configurado no Apps Script.'
  }[metrics.metaSpendSource] || 'Gasto Meta';

  const toneValue = metrics.profit;
  setTone(els.profit.closest('.metric-card'), toneValue);
  setTone(els.margin.closest('.metric-card'), toneValue);
  setTone(els.roas.closest('.metric-card'), toneValue);
  renderTable(payload.weekly);
  renderChart(payload.weekly);
  renderTransactions(state.transactions);
  renderAttendantSales(payload.attendantSales || buildAttendantSalesFromTransactions(state.transactions, state.attendants), payload.period);
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
  const rows = transactions
    .filter((tx) => {
      const haystack = normalizeText(`${tx.date} ${tx.payer} ${tx.currency} ${tx.amount} ${tx.description}`);
      return !query || haystack.includes(query);
    })
    .slice(0, 250);

  els.transactionRows.innerHTML = '';
  if (!rows.length) {
    els.transactionRows.innerHTML = '<tr><td colspan="5">Nenhuma transação encontrada.</td></tr>';
    return;
  }
  rows.forEach((tx) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${formatDateDisplay(tx.date)}</td>
      <td>${escapeHtml(tx.payer || '')}</td>
      <td>${escapeHtml(tx.currency || '')}</td>
      <td>${BRL.format(Number(tx.amount) || 0)}</td>
      <td>${escapeHtml(tx.description || '')}</td>
    `;
    els.transactionRows.appendChild(row);
  });
}

function renderAttendantSales(attendantSales, period) {
  els.attendantSalesPeriod.textContent = period?.label || 'Período atual';
  els.attendantSalesRows.innerHTML = '';
  els.attendantSalesDetailRows.innerHTML = '';

  if (!attendantSales.length) {
    els.attendantSalesRows.innerHTML = '<tr><td colspan="5">Nenhuma venda atribuída no período.</td></tr>';
    els.attendantSalesDetailRows.innerHTML = '<tr><td colspan="4">Nenhuma venda atribuída no período.</td></tr>';
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
    .sort((a, b) => String(b.date).localeCompare(String(a.date)))
    .slice(0, 500);

  if (!details.length) {
    els.attendantSalesDetailRows.innerHTML = '<tr><td colspan="4">Nenhuma venda atribuída no período.</td></tr>';
    return;
  }

  details.forEach((tx) => {
    const row = document.createElement('tr');
    row.innerHTML = `
      <td>${escapeHtml(tx.attendant || '')}</td>
      <td>${formatDateDisplay(tx.date)}</td>
      <td>${escapeHtml(tx.payer || '')}</td>
      <td>${BRL.format(Number(tx.amount) || 0)}</td>
    `;
    els.attendantSalesDetailRows.appendChild(row);
  });
}

function buildAttendantSalesFromTransactions(transactions, attendants) {
  return attendants.map((attendant) => {
    const cents = Number(attendant.cents);
    const rows = transactions.filter((tx) => amountMatchesCents(Number(tx.amount) || 0, cents));
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
    loadDashboard();
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

function compactMoney(value) {
  const number = Number(value) || 0;
  if (Math.abs(number) >= 1000) return `R$ ${(number / 1000).toFixed(1).replace('.', ',')}k`;
  return `R$ ${Math.round(number)}`;
}

function toInputDate(date) {
  return date.toISOString().slice(0, 10);
}

function formatDateDisplay(value) {
  if (!value) return '';
  const date = new Date(`${value}T00:00:00`);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
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
    currencies: [{ currency: 'BRL', revenue: displayedRevenue, sales: displayedSales }]
  };
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
  return { days: weekly, start: weekly[0].date, end: weekly[6].date };
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
