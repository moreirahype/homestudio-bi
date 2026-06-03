(function () {
  "use strict";

  const config = Object.assign(
    { apiUrl: "", metaTaxRate: 0.1383, rowsPerPage: 10, autoRefreshMinutes: 15, retentionDays: 730, currencyRates: { BRL: 1 } },
    window.HSBI_CONFIG || {}
  );

  const standardPeriods = ["today", "yesterday", "last7", "month", "lastMonth"];

  const state = {
    page: "dashboard",
    period: "today",
    appliedPeriod: "today",
    customRange: null,
    transactions: [],
    metaByPeriod: {},
    customMeta: null,
    meta: { spend: 0, leads: 0 },
    filteredTransactions: [],
    loadedTransactionRange: null,
    metrics: {},
    pageIndex: 1,
    lastUpdated: null,
    notifications: loadNotificationPrefs()
  };

  const els = {
    pages: document.querySelectorAll(".page"),
    navItems: document.querySelectorAll(".nav-item, .bottom-item"),
    periodButtons: document.querySelectorAll(".period-button"),
    customFields: document.getElementById("customFields"),
    startDate: document.getElementById("startDate"),
    endDate: document.getElementById("endDate"),
    refreshButton: document.getElementById("refreshButton"),
    syncStatus: document.getElementById("syncStatus"),
    desktopSyncStatus: document.getElementById("desktopSyncStatus"),
    transactionSearch: document.getElementById("transactionSearch"),
    prevPage: document.getElementById("prevPage"),
    nextPage: document.getElementById("nextPage"),
    pageInfo: document.getElementById("pageInfo"),
    chart: document.getElementById("salesChart"),
    tooltip: document.getElementById("chartTooltip"),
    notificationList: document.getElementById("notificationList"),
    enableAllNotifications: document.getElementById("enableAllNotifications"),
    testNotification: document.getElementById("testNotification")
  };

  const metricIds = {
    revenue: "metricRevenue",
    ads: "metricAds",
    tax: "metricTax",
    profit: "metricProfit",
    margin: "metricMargin",
    roas: "metricRoas",
    sales: "metricSales",
    cpa: "metricCpa",
    arpu: "metricArpu",
    leads: "metricLeads",
    cpl: "metricCpl"
  };

  const notificationTimes = ["08:00", "12:00", "18:00", "23:00"];

  document.addEventListener("DOMContentLoaded", init);

  function init() {
    setDefaultDates();
    bindEvents();
    setPage(location.hash.replace("#", "") || "dashboard");
    renderNotifications();
    registerServiceWorker();
    refreshData();
    window.setInterval(() => refreshData(), config.autoRefreshMinutes * 60 * 1000);
    window.setInterval(checkScheduledNotifications, 60 * 1000);
  }

  function bindEvents() {
    els.navItems.forEach((button) => {
      button.addEventListener("click", () => setPage(button.dataset.page));
    });

    els.periodButtons.forEach((button) => {
      button.addEventListener("click", () => {
        state.period = button.dataset.period;
        state.pageIndex = 1;
        if (state.period !== "custom") state.appliedPeriod = state.period;
        render();
      });
    });

    [els.startDate, els.endDate].forEach((input) => {
      input.addEventListener("change", () => {
        state.pageIndex = 1;
        updateDateDisplays();
        render();
      });
    });

    els.refreshButton.addEventListener("click", () => refreshData({ applySelection: true }));
    els.transactionSearch.addEventListener("input", () => {
      state.pageIndex = 1;
      renderTransactions();
    });

    els.prevPage.addEventListener("click", () => {
      state.pageIndex = Math.max(1, state.pageIndex - 1);
      renderTransactions();
    });

    els.nextPage.addEventListener("click", () => {
      const totalPages = getTotalPages();
      state.pageIndex = Math.min(totalPages, state.pageIndex + 1);
      renderTransactions();
    });

    els.enableAllNotifications.addEventListener("click", async () => {
      const shouldEnable = !areAllNotificationsEnabled();
      if (shouldEnable) {
        const granted = await ensureNotificationPermission();
        if (!granted) return;
      }
      notificationTimes.forEach((time) => {
        state.notifications[time] = shouldEnable;
      });
      saveNotificationPrefs();
      renderNotifications();
    });

    els.testNotification.addEventListener("click", async () => {
      const granted = await ensureNotificationPermission();
      if (granted) sendNotification("Resumo das Campanhas!", buildNotificationText());
    });

    document.addEventListener("pointerdown", (event) => {
      if (!els.tooltip.hidden && !event.target.closest(".chart-point")) hideTooltip();
    });

    window.addEventListener("resize", debounce(() => {
      if (state.metrics) renderSalesChart();
    }, 120));

    window.addEventListener("hashchange", () => {
      const page = location.hash.replace("#", "");
      if (page) setPage(page);
    });
  }

  async function refreshData(options = {}) {
    if (options.applySelection) {
      state.pageIndex = 1;
      state.appliedPeriod = state.period;
      if (state.period === "custom") state.customRange = readCustomInputRange();
    }
    setSyncText("Atualizando");
    els.refreshButton.disabled = true;
    try {
      const range = getPreloadRange();
      const payload = await fetchTransactionsPayload(range);
      const metaEntries = await Promise.all(
        standardPeriods.map(async (period) => [period, await fetchMetaPayload(getDateRange(period))])
      );
      state.transactions = payload.transactions.map(normalizeTransaction);
      state.loadedTransactionRange = range;
      state.metaByPeriod = Object.fromEntries(metaEntries);
      if (state.appliedPeriod === "custom") await loadCustomPeriodData();
      state.lastUpdated = new Date();
      render();
      setSyncText(`Atualizado ${formatTime(state.lastUpdated)}`);
    } catch (error) {
      console.error(error);
      const fallback = buildEmptyPayload();
      state.transactions = fallback.transactions.map(normalizeTransaction);
      state.loadedTransactionRange = getPreloadRange();
      state.metaByPeriod = Object.fromEntries(standardPeriods.map((period) => [period, fallback.meta]));
      state.customMeta = null;
      state.lastUpdated = new Date();
      render();
      setSyncText("Sem dados");
    } finally {
      els.refreshButton.disabled = false;
    }
  }

  async function fetchTransactionsPayload(range) {
    if (!config.apiUrl) return buildEmptyPayload();
    const url = new URL(config.apiUrl);
    url.searchParams.set("action", "data");
    url.searchParams.set("from", toIsoDate(range.start));
    url.searchParams.set("to", toIsoDate(range.end));
    try {
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error(`API respondeu ${response.status}`);
      return response.json();
    } catch (error) {
      return fetchJsonp(url);
    }
  }

  async function fetchMetaPayload(range) {
    if (!config.apiUrl) return buildEmptyPayload().meta;
    const url = new URL(config.apiUrl);
    url.searchParams.set("action", "meta");
    url.searchParams.set("from", toIsoDate(range.start));
    url.searchParams.set("to", toIsoDate(range.end));
    try {
      const response = await fetch(url.toString(), { cache: "no-store" });
      if (!response.ok) throw new Error(`API respondeu ${response.status}`);
      return response.json();
    } catch (error) {
      return fetchJsonp(url);
    }
  }

  async function loadCustomPeriodData() {
    if (state.appliedPeriod !== "custom") return;
    const range = state.customRange || readCustomInputRange();
    try {
      let payload = null;
      if (!isRangeLoaded(range)) {
        payload = await fetchTransactionsPayload(range);
        mergeTransactions(payload.transactions.map(normalizeTransaction));
      }
      state.customMeta = payload && payload.meta ? payload.meta : await fetchMetaPayload(range);
    } catch (error) {
      console.error(error);
      state.customMeta = { spend: 0, leads: 0 };
    }
  }

  function isRangeLoaded(range) {
    if (!state.loadedTransactionRange) return false;
    return startOfDay(range.start) >= startOfDay(state.loadedTransactionRange.start) &&
      endOfDay(range.end) <= endOfDay(state.loadedTransactionRange.end);
  }

  function mergeTransactions(transactions) {
    const map = new Map(state.transactions.map((item) => [item.id, item]));
    transactions.forEach((item) => map.set(item.id, item));
    state.transactions = Array.from(map.values());
  }

  function fetchJsonp(url) {
    return new Promise((resolve, reject) => {
      const callback = `hsbiJsonp${Date.now()}${Math.floor(Math.random() * 1000)}`;
      const script = document.createElement("script");
      const timeout = window.setTimeout(() => {
        cleanup();
        reject(new Error("Tempo esgotado ao buscar dados"));
      }, 15000);

      function cleanup() {
        window.clearTimeout(timeout);
        script.remove();
        delete window[callback];
      }

      window[callback] = (payload) => {
        cleanup();
        resolve(payload);
      };

      url.searchParams.set("callback", callback);
      script.onerror = () => {
        cleanup();
        reject(new Error("Falha ao carregar dados"));
      };
      script.src = url.toString();
      document.head.append(script);
    });
  }

  function buildEmptyPayload() {
    return { transactions: [], meta: { spend: 0, leads: 0 } };
  }

  function normalizeTransaction(item) {
    const displayDate = normalizeDateValue(item.data);
    const displayTime = normalizeTimeValue(item.hora);
    const timestamp = parseLocalDateTime(displayDate, displayTime) || parseDate(item.timestamp || item.dataHora || "");
    const originalCurrency = normalizeCurrency(item.moeda_original || item.originalCurrency || item.moeda || item.currency || "BRL");
    const originalValue = parseMoneyValue(item.valor_original || item.originalValue || item.valor || item.value || 0);
    const displayCurrency = normalizeCurrency(item.moeda || item.currency || "BRL");
    const baseValue = parseMoneyValue(item.valor_brl || item.value_brl || item.valor || item.value || 0);
    const convertedValue = displayCurrency === "BRL" ? baseValue : convertToBrl(baseValue, displayCurrency);
    return {
      id: item.id || `${timestamp.getTime()}-${item.pagador || ""}-${item.valor || ""}`,
      timestamp,
      data: displayDate || toIsoDate(timestamp),
      hora: displayTime || formatTime(timestamp),
      pagador: item.pagador || item.payer || "Sem pagador",
      telefone: item.telefone || item.phone || "",
      moeda: "BRL",
      moedaOriginal: originalCurrency,
      valorOriginal: originalValue,
      valor: convertedValue,
      atendente: item.atendente || item.attendant || "Sem atendente"
    };
  }

  function normalizeCurrency(value) {
    return String(value || "BRL").trim().toUpperCase();
  }

  function convertToBrl(value, currency) {
    const normalizedCurrency = normalizeCurrency(currency);
    const rate = Number((config.currencyRates || {})[normalizedCurrency] || 0);
    return rate > 0 ? value * rate : value;
  }

  function parseMoneyValue(value) {
    if (typeof value === "number") return value;
    const text = String(value || "0").trim().replace(/[^\d,.-]/g, "");
    const lastComma = text.lastIndexOf(",");
    const lastDot = text.lastIndexOf(".");
    let normalized = text;
    if (lastComma > -1 && lastDot > -1) {
      normalized = lastComma > lastDot ? text.replace(/\./g, "").replace(",", ".") : text.replace(/,/g, "");
    } else if (lastComma > -1) {
      normalized = text.replace(/\./g, "").replace(",", ".");
    }
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function render() {
    renderPeriodControls();
    state.filteredTransactions = getFilteredTransactions();
    state.meta = getMetaForCurrentPeriod();
    state.metrics = computeMetrics(state.filteredTransactions);
    renderMetrics();
    renderSalesChart();
    renderAttendants();
    renderTransactions();
    renderNotificationSummary();
  }

  function renderPeriodControls() {
    els.periodButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.period === state.period);
    });
    els.customFields.classList.toggle("is-visible", state.period === "custom");
    document.getElementById("salesChartPeriod").textContent = getPeriodName(state.appliedPeriod);
    document.getElementById("attendantsPeriod").textContent = getPeriodName(state.appliedPeriod);
    updateDateDisplays();
  }

  function updateDateDisplays() {
    [els.startDate, els.endDate].forEach((input) => {
      const label = input.closest("label");
      if (label) label.dataset.display = formatDateInputValue(input.value);
    });
  }

  function setPage(page) {
    if (!["dashboard", "attendants", "transactions", "notifications"].includes(page)) return;
    state.page = page;
    els.pages.forEach((section) => section.classList.toggle("is-active", section.dataset.page === page));
    els.navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.page === page));
    document.body.dataset.currentPage = page;
    if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
    if (page === "dashboard" && state.metrics) requestAnimationFrame(renderSalesChart);
  }

  function getFilteredTransactions() {
    const range = getDateRange();
    return state.transactions
      .filter((item) => item.timestamp >= startOfDay(range.start) && item.timestamp <= endOfDay(range.end))
      .sort((a, b) => b.timestamp - a.timestamp);
  }

  function computeMetrics(transactions) {
    const revenue = sum(transactions.map((item) => item.valor));
    const sales = transactions.length;
    const ads = Number(state.meta.spend || 0);
    const tax = ads * Number(config.metaTaxRate || 0);
    const totalSpend = ads + tax;
    const profit = revenue - totalSpend;
    const leads = Number(state.meta.leads || 0);
    return {
      revenue,
      ads,
      tax,
      totalSpend,
      profit,
      margin: revenue > 0 ? profit / revenue : null,
      roas: totalSpend > 0 ? revenue / totalSpend : null,
      sales,
      cpa: sales > 0 ? totalSpend / sales : null,
      arpu: sales > 0 ? revenue / sales : null,
      leads,
      cpl: leads > 0 ? totalSpend / leads : null
    };
  }

  function renderMetrics() {
    setMetric("revenue", money(state.metrics.revenue));
    setMetric("ads", money(state.metrics.ads));
    setMetric("tax", money(state.metrics.tax));
    setMetric("profit", money(state.metrics.profit), signedTone(state.metrics.profit));
    setMetric("margin", state.metrics.margin == null ? "N/A" : percent(state.metrics.margin), signedTone(state.metrics.margin));
    setMetric("roas", state.metrics.roas == null ? "N/A" : decimal(state.metrics.roas), signedTone(state.metrics.roas));
    setMetric("sales", integer(state.metrics.sales));
    setMetric("cpa", state.metrics.cpa == null ? "N/A" : money(state.metrics.cpa));
    setMetric("arpu", state.metrics.arpu == null ? "N/A" : money(state.metrics.arpu));
    setMetric("leads", integer(state.metrics.leads));
    setMetric("cpl", state.metrics.cpl == null ? "N/A" : money(state.metrics.cpl));
  }

  function setMetric(key, value, tone) {
    const el = document.getElementById(metricIds[key]);
    el.textContent = value;
    el.classList.toggle("is-positive", tone === "positive");
    el.classList.toggle("is-negative", tone === "negative");
    el.classList.toggle("is-alert", tone === "negative");
  }

  function signedTone(value) {
    if (value == null || Number.isNaN(Number(value)) || Number(value) === 0) return null;
    return Number(value) > 0 ? "positive" : "negative";
  }

  function renderSalesChart() {
    const grouped = buildSeries();
    els.chart.setAttribute("preserveAspectRatio", "xMidYMid meet");
    const chartBox = els.chart.parentElement.getBoundingClientRect();
    const highestSales = Math.max(0, ...grouped.map((point) => point.sales));
    const maxSales = Math.max(1, Math.ceil(highestSales * 1.2));
    const left = 34;
    const right = 10;
    const top = 12;
    const bottom = 32;
    const canvasWidth = 980;
    const canvasHeight = Math.max(300, Math.round(canvasWidth * (chartBox.height / Math.max(chartBox.width, 1))));
    els.chart.setAttribute("viewBox", `0 0 ${canvasWidth} ${canvasHeight}`);
    const width = canvasWidth - left - right;
    const height = canvasHeight - top - bottom;
    const step = grouped.length > 1 ? width / (grouped.length - 1) : width;
    const points = grouped.map((point, index) => {
      const x = left + index * step;
      const y = top + height - (point.sales / maxSales) * height;
      return Object.assign({ x, y }, point);
    });
    const path = makeSmoothPath(points);
    const areaPath = `${path} L ${points[points.length - 1].x},${top + height} L ${points[0].x},${top + height} Z`;
    const gridYTop = top;
    const gridYMid = top + height / 2;
    const gridYBottom = top + height;
    const title = state.period === "today" || state.period === "yesterday" ? "Vendas por horário" : "Vendas por dia";

    document.getElementById("salesChartTitle").textContent = title;
    els.chart.innerHTML = `
      <defs>
        <linearGradient id="salesAreaGradient" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stop-color="#9fe870" stop-opacity="0.16"></stop>
          <stop offset="100%" stop-color="#9fe870" stop-opacity="0"></stop>
        </linearGradient>
      </defs>
      <rect x="${left}" y="${top}" width="${width}" height="${height}" rx="4" class="chart-plot-bg"></rect>
      <line x1="${left}" y1="${gridYTop}" x2="${canvasWidth - right}" y2="${gridYTop}" class="grid-line"></line>
      <line x1="${left}" y1="${gridYMid}" x2="${canvasWidth - right}" y2="${gridYMid}" class="grid-line is-soft"></line>
      <line x1="${left}" y1="${gridYBottom}" x2="${canvasWidth - right}" y2="${gridYBottom}" class="axis-line"></line>
      <text x="${left - 18}" y="${gridYTop + 5}" class="axis-text">${maxSales}</text>
      <text x="${left - 18}" y="${gridYMid + 5}" class="axis-text">${Math.round(maxSales / 2)}</text>
      <text x="${left - 18}" y="${gridYBottom + 5}" class="axis-text">0</text>
      <path d="${areaPath}" class="sales-area"></path>
      <path d="${path}" class="sales-line"></path>
      ${points
        .map(
          (point) => `
            <g class="chart-point" data-index="${point.index}">
              <circle class="point-hit" cx="${point.x}" cy="${point.y}" r="13"></circle>
              <circle class="point-dot" cx="${point.x}" cy="${point.y}" r="${point.sales || point.revenue ? 4.8 : 3.8}"></circle>
              <text x="${point.x}" y="${canvasHeight - 12}" class="x-label">${shouldShowAxisLabel(point.index, grouped.length) ? point.label : ""}</text>
            </g>`
        )
        .join("")}
    `;

    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .chart-plot-bg{fill:rgba(255,255,255,.012)}
      .grid-line,.axis-line{stroke:rgba(159,232,112,.18);stroke-width:1}
      .grid-line.is-soft{stroke:rgba(159,232,112,.1)}
      .sales-area{fill:url(#salesAreaGradient)}
      .sales-line{fill:none;stroke:#9fe870;stroke-width:2.8;stroke-linecap:round;stroke-linejoin:round;filter:drop-shadow(0 0 3px rgba(159,232,112,.16))}
      .chart-point,.chart-point *{pointer-events:all;cursor:pointer;outline:none}
      .point-hit{fill:transparent;stroke:transparent}
      .point-dot{fill:#1b241a;stroke:#9fe870;stroke-width:2.5}
      .chart-point:hover .point-dot,.chart-point:focus .point-dot{fill:#9fe870;stroke:#071009;stroke-width:2.2}
      .axis-text,.x-label{fill:#b8c0b4;font-size:var(--text-xs)}
      .axis-text{text-anchor:end}
      .x-label{text-anchor:middle}
    `;
    els.chart.prepend(style);

    els.chart.querySelectorAll(".chart-point").forEach((node) => {
      const point = points[Number(node.dataset.index)];
      node.addEventListener("mouseenter", (event) => showTooltip(event, point));
      node.addEventListener("mousemove", (event) => showTooltip(event, point));
      node.addEventListener("mouseleave", hideTooltip);
    });
  }

  function shouldShowAxisLabel(index, total) {
    if (window.innerWidth <= 720) return total <= 12 || index % 2 === 0;
    return total <= 16 || index % 2 === 0;
  }

  function makeSmoothPath(points) {
    if (points.length < 2) return points.map((point) => `M${point.x},${point.y}`).join(" ");
    const commands = [`M${points[0].x},${points[0].y}`];
    for (let index = 1; index < points.length; index += 1) {
      const previous = points[index - 1];
      const current = points[index];
      const controlDistance = (current.x - previous.x) * 0.42;
      commands.push(`C${previous.x + controlDistance},${previous.y} ${current.x - controlDistance},${current.y} ${current.x},${current.y}`);
    }
    return commands.join(" ");
  }

  function buildSeries() {
    const range = getDateRange();
    const byHour = state.period === "today" || state.period === "yesterday";
    const labels = byHour ? buildHourLabels() : buildDayLabels(range.start, range.end);
    return labels.map((label, index) => {
      const sales = state.filteredTransactions.filter((item) => {
        if (byHour) return item.timestamp.getHours() === index;
        return toIsoDate(item.timestamp) === label.key;
      });
      return {
        index,
        label: label.short,
        fullLabel: label.full,
        sales: sales.length,
        revenue: sum(sales.map((item) => item.valor))
      };
    });
  }

  function showTooltip(event, point) {
    const rect = event.currentTarget.ownerSVGElement.getBoundingClientRect();
    const wrap = els.chart.parentElement.getBoundingClientRect();
    const viewBox = event.currentTarget.ownerSVGElement.viewBox.baseVal;
    const pointX = ((point.x / viewBox.width) * rect.width) + rect.left - wrap.left;
    const pointY = ((point.y / viewBox.height) * rect.height) + rect.top - wrap.top;
    const x = event.clientX ? event.clientX - wrap.left : pointX;
    const y = event.clientY ? event.clientY - wrap.top : pointY;
    els.tooltip.hidden = false;
    els.tooltip.style.left = `${Math.max(72, Math.min(wrap.width - 72, x))}px`;
    els.tooltip.style.top = `${Math.max(52, y - 8)}px`;
    els.tooltip.innerHTML = `<strong>${point.fullLabel}</strong>Vendas: ${point.sales}<br>Faturamento: ${money(point.revenue)}`;
  }

  function hideTooltip() {
    els.tooltip.hidden = true;
  }

  function renderAttendants() {
    const rows = getAttendantRows();
    const tbody = document.getElementById("attendantsBody");
    const empty = document.getElementById("attendantsEmpty");
    const totalSales = sum(rows.map((row) => row.sales));
    const totalRevenue = sum(rows.map((row) => row.revenue));
    tbody.innerHTML = "";
    rows.forEach((row) => {
      const tr = document.createElement("tr");
      tr.innerHTML = `
        <td>${escapeHtml(row.name)}</td>
        <td>${integer(row.sales)}</td>
        <td>${money(row.revenue)}</td>
        <td>${row.sales ? money(row.revenue / row.sales) : "N/A"}</td>
      `;
      tbody.append(tr);
    });
    if (rows.length) {
      const totalRow = document.createElement("tr");
      totalRow.className = "attendants-total-row";
      totalRow.innerHTML = `
        <td>Total</td>
        <td>${integer(totalSales)}</td>
        <td>${money(totalRevenue)}</td>
        <td>${totalSales ? money(totalRevenue / totalSales) : "N/A"}</td>
      `;
      tbody.append(totalRow);
    }
    empty.classList.toggle("is-visible", rows.length === 0);
    renderAttendantChart(rows);
  }

  function getAttendantRows() {
    const range = getDateRange();
    const transactions = state.transactions.filter(
      (item) => item.timestamp >= startOfDay(range.start) && item.timestamp <= endOfDay(range.end)
    );
    const map = new Map();
    transactions.forEach((item) => {
      const name = item.atendente || "Sem atendente";
      const row = map.get(name) || { name, sales: 0, revenue: 0 };
      row.sales += 1;
      row.revenue += item.valor;
      map.set(name, row);
    });
    return Array.from(map.values()).sort((a, b) => b.revenue - a.revenue);
  }

  function renderAttendantChart(rows) {
    const chart = document.getElementById("attendantsChart");
    const max = Math.max(1, ...rows.map((row) => row.revenue));
    const totalRevenue = sum(rows.map((row) => row.revenue));
    chart.innerHTML = rows
      .map(
        (row) => {
          const revenueShare = totalRevenue > 0 ? row.revenue / totalRevenue : 0;
          return `
          <div class="bar-row">
            <strong>${escapeHtml(row.name)}</strong>
            <div class="bar-track"><div class="bar-fill" style="--bar-width:${Math.max(4, (row.revenue / max) * 100)}%"></div></div>
            <span>${money(row.revenue)} · ${integer(row.sales)} vendas</span>
          </div>`;
        }
      )
      .join("");
    chart.querySelectorAll(".bar-row").forEach((node, index) => {
      const row = rows[index];
      const revenueShare = totalRevenue > 0 ? row.revenue / totalRevenue : 0;
      node.querySelector("span").textContent = `${percent(revenueShare)} da receita · ${money(row.revenue)} · ${integer(row.sales)} vendas`;
    });
  }

  function renderTransactions() {
    const query = els.transactionSearch.value.trim().toLowerCase();
    const rows = state.filteredTransactions.filter((item) => {
      const haystack = `${item.pagador} ${item.atendente} ${item.valor} ${money(item.valor)} ${item.moedaOriginal} ${formatOriginalValue(item)}`.toLowerCase();
      return haystack.includes(query);
    });
    const tbody = document.getElementById("transactionsBody");
    const totalPages = Math.max(1, Math.ceil(rows.length / config.rowsPerPage));
    state.pageIndex = Math.min(state.pageIndex, totalPages);
    const start = (state.pageIndex - 1) * config.rowsPerPage;
    const visible = rows.slice(start, start + config.rowsPerPage);
    tbody.innerHTML = "";

    if (!visible.length) {
      const tr = document.createElement("tr");
      tr.innerHTML = `<td colspan="6">Nenhuma transação encontrada.</td>`;
      tbody.append(tr);
    } else {
      visible.forEach((item) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${formatIsoDateBr(item.data)}</td>
          <td>${escapeHtml(item.hora)}</td>
          <td class="payer-cell">${escapeHtml(item.pagador)}<small>${escapeHtml(item.atendente)}</small></td>
          <td>${escapeHtml(item.atendente)}</td>
          <td>${escapeHtml(item.moedaOriginal)}</td>
          <td>${formatOriginalValue(item)}</td>
        `;
        tbody.append(tr);
      });
    }

    els.pageInfo.textContent = `Página ${state.pageIndex} de ${totalPages}`;
    els.prevPage.disabled = state.pageIndex <= 1;
    els.nextPage.disabled = state.pageIndex >= totalPages;
  }

  function getTotalPages() {
    const query = els.transactionSearch.value.trim().toLowerCase();
    const rows = state.filteredTransactions.filter((item) =>
      `${item.pagador} ${item.atendente} ${item.valor} ${money(item.valor)} ${item.moedaOriginal} ${formatOriginalValue(item)}`.toLowerCase().includes(query)
    );
    return Math.max(1, Math.ceil(rows.length / config.rowsPerPage));
  }

  function renderNotificationSummary() {
    const summary = document.getElementById("notificationSummary");
    if (!summary) return;
    summary.textContent = buildNotificationText();
  }

  function renderNotifications() {
    els.enableAllNotifications.textContent = areAllNotificationsEnabled() ? "Desativar todos" : "Ativar todos";
    els.notificationList.innerHTML = notificationTimes
      .map(
        (time) => `
          <label class="notification-row">
            <span>Notificação das ${time}</span>
            <span class="switch">
              <input type="checkbox" data-time="${time}" ${state.notifications[time] ? "checked" : ""}>
              <span class="slider"></span>
            </span>
          </label>`
      )
      .join("");

    els.notificationList.querySelectorAll("input").forEach((input) => {
      input.addEventListener("change", async () => {
        if (input.checked) {
          const granted = await ensureNotificationPermission();
          if (!granted) input.checked = false;
        }
        state.notifications[input.dataset.time] = input.checked;
        saveNotificationPrefs();
        renderNotifications();
      });
    });
  }

  function areAllNotificationsEnabled() {
    return notificationTimes.every((time) => state.notifications[time]);
  }

  async function ensureNotificationPermission() {
    if (!("Notification" in window)) {
      alert("Este navegador não suporta notificações.");
      return false;
    }
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      alert("As notificações estão bloqueadas nas configurações do navegador.");
      return false;
    }
    return (await Notification.requestPermission()) === "granted";
  }

  function checkScheduledNotifications() {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const now = new Date();
    const current = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
    if (!state.notifications[current]) return;
    const key = `hsbi-sent-${toIsoDate(now)}-${current}`;
    if (localStorage.getItem(key)) return;
    localStorage.setItem(key, "1");
    sendNotification("Resumo das Campanhas!", buildNotificationText());
  }

  function sendNotification(title, body) {
    const iconUrl = new URL("../assets/icon-192.png", location.href).href;
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((registration) => registration.showNotification(title, {
        body,
        icon: iconUrl,
        badge: iconUrl
      }));
      return;
    }
    new Notification(title, { body, icon: iconUrl });
  }

  function buildNotificationText() {
    return `Seu investimento está em ${money(state.metrics.totalSpend || 0)}, com faturamento em ${money(state.metrics.revenue || 0)}, com um CPA de ${state.metrics.cpa == null ? "N/A" : money(state.metrics.cpa)} e um ROI de ${state.metrics.roas == null ? "0,00" : decimal(state.metrics.roas)}.`;
  }

  function loadNotificationPrefs() {
    try {
      return Object.assign({}, JSON.parse(localStorage.getItem("hsbi-notifications") || "{}"));
    } catch {
      return {};
    }
  }

  function saveNotificationPrefs() {
    localStorage.setItem("hsbi-notifications", JSON.stringify(state.notifications));
  }

  function registerServiceWorker() {
    if ("serviceWorker" in navigator) {
      navigator.serviceWorker.register("../sw.js?v=24").then((registration) => registration.update()).catch(console.error);
    }
  }

  function getMetaForCurrentPeriod() {
    if (state.appliedPeriod === "custom") return Object.assign({ spend: 0, leads: 0 }, state.customMeta || {});
    return Object.assign({ spend: 0, leads: 0 }, state.metaByPeriod[state.appliedPeriod] || {});
  }

  function getPreloadRange() {
    const today = new Date();
    return { start: new Date(today.getFullYear(), today.getMonth() - 1, 1), end: today };
  }

  function getDateRange(periodName) {
    const period = periodName || state.appliedPeriod;
    const today = new Date();
    if (period === "yesterday") {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    if (period === "last7") return { start: addDays(today, -7), end: addDays(today, -1) };
    if (period === "month") return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today };
    if (period === "lastMonth") {
      return {
        start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        end: new Date(today.getFullYear(), today.getMonth(), 0)
      };
    }
    if (period === "custom") {
      return periodName ? readCustomInputRange() : state.customRange || readCustomInputRange();
    }
    return { start: today, end: today };
  }

  function readCustomInputRange() {
    return { start: parseLocalDate(els.startDate.value), end: parseLocalDate(els.endDate.value) };
  }

  function getPeriodName(periodName) {
    return {
      today: "Hoje",
      yesterday: "Ontem",
      last7: "Últimos 7 dias",
      month: "Este mês",
      lastMonth: "Mês passado",
      custom: "Personalizado"
    }[periodName || state.appliedPeriod];
  }

  function setDefaultDates() {
    const today = new Date();
    els.endDate.value = toIsoDate(today);
    els.startDate.value = toIsoDate(addDays(today, -6));
    updateDateDisplays();
  }

  function formatDateInputValue(value) {
    const date = parseLocalDate(value);
    return date.toLocaleDateString("pt-BR", { day: "numeric", month: "short", year: "numeric" }).replace(".", "");
  }

  function buildHourLabels() {
    return Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      short: String(hour).padStart(2, "0"),
      full: `${String(hour).padStart(2, "0")}h`
    }));
  }

  function buildDayLabels(start, end) {
    const labels = [];
    for (let cursor = startOfDay(start); cursor <= endOfDay(end); cursor = addDays(cursor, 1)) {
      labels.push({
        key: toIsoDate(cursor),
        short: `${String(cursor.getDate()).padStart(2, "0")}/${String(cursor.getMonth() + 1).padStart(2, "0")}`,
        full: cursor.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" }).replace(".", "").toUpperCase()
      });
    }
    return labels;
  }

  function parseDate(value) {
    if (value instanceof Date) return value;
    const parsed = new Date(value);
    return Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  }

  function parseLocalDateTime(dateValue, timeValue) {
    if (!dateValue) return null;
    const [year, month, day] = String(dateValue).slice(0, 10).split("-").map(Number);
    if (!year || !month || !day) return null;
    const [hour, minute] = String(timeValue || "00:00").split(":").map(Number);
    return new Date(year, month - 1, day, hour || 0, minute || 0, 0, 0);
  }

  function parseLocalDate(value) {
    if (!value) return new Date();
    const [year, month, day] = value.split("-").map(Number);
    return new Date(year, month - 1, day);
  }

  function startOfDay(date) {
    const copy = new Date(date);
    copy.setHours(0, 0, 0, 0);
    return copy;
  }

  function endOfDay(date) {
    const copy = new Date(date);
    copy.setHours(23, 59, 59, 999);
    return copy;
  }

  function addDays(date, amount) {
    const copy = new Date(date);
    copy.setDate(copy.getDate() + amount);
    return copy;
  }

  function toIsoDate(date) {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  }

  function normalizeDateValue(value) {
    if (!value) return "";
    if (value instanceof Date) return toIsoDate(value);
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? "" : toIsoDate(parsed);
  }

  function normalizeTimeValue(value) {
    if (!value) return "";
    if (value instanceof Date) return formatTime(value);
    const text = String(value).trim();
    const match = text.match(/(\d{1,2}):(\d{2})/);
    return match ? `${String(match[1]).padStart(2, "0")}:${match[2]}` : "";
  }

  function formatIsoDateBr(value) {
    const normalized = normalizeDateValue(value);
    if (!normalized) return "";
    const [year, month, day] = normalized.split("-");
    return `${day}/${month}/${year}`;
  }

  function formatDateBr(date) {
    return date.toLocaleDateString("pt-BR");
  }

  function formatTime(date) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function money(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
  }

  function formatOriginalValue(item) {
    const currency = normalizeCurrency(item.moedaOriginal || item.moeda || "BRL");
    const value = Number(item.valorOriginal || 0);
    try {
      return value.toLocaleString("pt-BR", { style: "currency", currency });
    } catch {
      return `${currency} ${decimal(value)}`;
    }
  }

  function decimal(value) {
    return Number(value || 0).toLocaleString("pt-BR", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }

  function integer(value) {
    return Number(value || 0).toLocaleString("pt-BR", { maximumFractionDigits: 0 });
  }

  function percent(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 });
  }

  function sum(values) {
    return values.reduce((total, value) => total + Number(value || 0), 0);
  }

  function debounce(callback, wait) {
    let timeout;
    return (...args) => {
      window.clearTimeout(timeout);
      timeout = window.setTimeout(() => callback(...args), wait);
    };
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function setSyncText(text) {
    els.syncStatus.textContent = text;
    els.desktopSyncStatus.textContent = text;
  }
})();

