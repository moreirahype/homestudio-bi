(function () {
  "use strict";

  const config = Object.assign(
    { apiUrl: "", metaTaxRate: 0.1383, rowsPerPage: 10, autoRefreshMinutes: 15, currencyRates: { BRL: 1 } },
    window.HSBI_CONFIG || {}
  );

  const state = {
    page: "dashboard",
    period: "today",
    transactions: [],
    meta: { spend: 0, leads: 0 },
    filteredTransactions: [],
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
    enableAllNotifications: document.getElementById("enableAllNotifications")
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
    window.setInterval(refreshData, config.autoRefreshMinutes * 60 * 1000);
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
        render();
      });
    });

    [els.startDate, els.endDate].forEach((input) => {
      input.addEventListener("change", () => {
        state.pageIndex = 1;
        render();
      });
    });

    els.refreshButton.addEventListener("click", refreshData);
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

    window.addEventListener("resize", debounce(() => {
      if (state.metrics) renderSalesChart();
    }, 120));

    window.addEventListener("hashchange", () => {
      const page = location.hash.replace("#", "");
      if (page) setPage(page);
    });
  }

  async function refreshData() {
    setSyncText("Atualizando");
    els.refreshButton.disabled = true;
    try {
      const range = getDateRange();
      const payload = await fetchPayload(range);
      state.transactions = payload.transactions.map(normalizeTransaction);
      state.meta = Object.assign({ spend: 0, leads: 0 }, payload.meta || {});
      state.lastUpdated = new Date();
      render();
      setSyncText(`Atualizado ${formatTime(state.lastUpdated)}`);
    } catch (error) {
      console.error(error);
      const fallback = buildDemoPayload();
      state.transactions = fallback.transactions.map(normalizeTransaction);
      state.meta = fallback.meta;
      state.lastUpdated = new Date();
      render();
      setSyncText("Dados locais");
    } finally {
      els.refreshButton.disabled = false;
    }
  }

  async function fetchPayload(range) {
    if (!config.apiUrl) return buildDemoPayload();
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

  function buildDemoPayload() {
    const now = new Date();
    const y = new Date(now);
    y.setDate(now.getDate() - 1);
    const transactions = [
      makeDemoSale(now, "Sheila", "Mariana Alves", 497),
      makeDemoSale(now, "Automação", "Carlos Souza", 197),
      makeDemoSale(y, "BOT", "Rafael Lima", 297),
      makeDemoSale(addDays(now, -3), "Sheila", "Fernanda Costa", 397),
      makeDemoSale(addDays(now, -4), "Automação", "João Martins", 197)
    ];
    return { transactions, meta: { spend: 241.51, leads: 213 } };
  }

  function makeDemoSale(date, attendant, payer, value) {
    const copy = new Date(date);
    copy.setHours(Math.max(8, Math.min(22, copy.getHours() - Math.floor(Math.random() * 4))), 15, 0, 0);
    return {
      timestamp: copy.toISOString(),
      data: toIsoDate(copy),
      hora: formatTime(copy),
      pagador: payer,
      telefone: "",
      moeda: "BRL",
      valor: value,
      atendente: attendant
    };
  }

  function normalizeTransaction(item) {
    const timestamp = parseDate(item.timestamp || item.dataHora || `${item.data || ""}T${item.hora || "00:00"}`);
    const originalCurrency = normalizeCurrency(item.moeda_original || item.originalCurrency || item.moeda || item.currency || "BRL");
    const originalValue = parseMoneyValue(item.valor_original || item.originalValue || item.valor || item.value || 0);
    const displayCurrency = normalizeCurrency(item.moeda || item.currency || "BRL");
    const baseValue = parseMoneyValue(item.valor_brl || item.value_brl || item.valor || item.value || 0);
    const convertedValue = displayCurrency === "BRL" ? baseValue : convertToBrl(baseValue, displayCurrency);
    return {
      id: item.id || `${timestamp.getTime()}-${item.pagador || ""}-${item.valor || ""}`,
      timestamp,
      data: item.data || toIsoDate(timestamp),
      hora: item.hora || formatTime(timestamp),
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
    const text = String(value || "0").trim();
    const normalized = text.includes(",") ? text.replace(/\./g, "").replace(",", ".") : text;
    const parsed = Number(normalized);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  function render() {
    renderPeriodControls();
    state.filteredTransactions = getFilteredTransactions();
    state.metrics = computeMetrics(state.filteredTransactions);
    renderMetrics();
    renderSalesChart();
    renderAttendants();
    renderTransactions();
  }

  function renderPeriodControls() {
    els.periodButtons.forEach((button) => {
      button.classList.toggle("is-active", button.dataset.period === state.period);
    });
    els.customFields.classList.toggle("is-visible", state.period === "custom");
    document.getElementById("salesChartPeriod").textContent = getPeriodName();
    document.getElementById("attendantsPeriod").textContent = getPeriodName();
  }

  function setPage(page) {
    if (!["dashboard", "attendants", "transactions", "notifications"].includes(page)) return;
    state.page = page;
    els.pages.forEach((section) => section.classList.toggle("is-active", section.dataset.page === page));
    els.navItems.forEach((item) => item.classList.toggle("is-active", item.dataset.page === page));
    if (location.hash !== `#${page}`) history.replaceState(null, "", `#${page}`);
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
    els.chart.setAttribute("preserveAspectRatio", window.innerWidth <= 720 ? "none" : "xMidYMid meet");
    const highestSales = Math.max(1, ...grouped.map((point) => point.sales));
    const maxSales = Math.max(1, Math.ceil(highestSales * 1.25));
    const left = 54;
    const right = 26;
    const top = 44;
    const bottom = 54;
    const width = 1000 - left - right;
    const height = 320 - top - bottom;
    const step = grouped.length > 1 ? width / (grouped.length - 1) : width;
    const points = grouped.map((point, index) => {
      const x = left + index * step;
      const y = top + height - (point.sales / maxSales) * height;
      return Object.assign({ x, y }, point);
    });
    const path = points.map((point, index) => `${index ? "L" : "M"}${point.x},${point.y}`).join(" ");
    const gridYTop = top;
    const gridYBottom = top + height;
    const title = state.period === "today" || state.period === "yesterday" ? "Vendas por horário" : "Vendas por dia";

    document.getElementById("salesChartTitle").textContent = title;
    els.chart.innerHTML = `
      <line x1="${left}" y1="${gridYTop}" x2="${1000 - right}" y2="${gridYTop}" class="grid-line"></line>
      <line x1="${left}" y1="${gridYBottom}" x2="${1000 - right}" y2="${gridYBottom}" class="axis-line"></line>
      <text x="0" y="${gridYTop + 5}" class="axis-text">${maxSales}</text>
      <text x="0" y="${gridYBottom + 5}" class="axis-text">0</text>
      <path d="${path}" class="sales-line"></path>
      ${points
        .map(
          (point) => `
            <g class="chart-point" data-index="${point.index}" tabindex="0">
              <circle cx="${point.x}" cy="${point.y}" r="7"></circle>
              <text x="${point.x}" y="302" class="x-label">${shouldShowAxisLabel(point.index, grouped.length) ? point.label : ""}</text>
            </g>`
        )
        .join("")}
    `;

    const style = document.createElementNS("http://www.w3.org/2000/svg", "style");
    style.textContent = `
      .grid-line,.axis-line{stroke:rgba(158,237,109,.22);stroke-width:1}
      .sales-line{fill:none;stroke:#9eed6d;stroke-width:5;stroke-linecap:round;stroke-linejoin:round}
      .chart-point,.chart-point *{pointer-events:all;cursor:pointer}
      .chart-point circle{fill:#122116;stroke:#9eed6d;stroke-width:5}
      .axis-text,.x-label{fill:#cfe6cb;font-size:16px}
      .x-label{text-anchor:middle}
    `;
    els.chart.prepend(style);

    els.chart.querySelectorAll(".chart-point").forEach((node) => {
      const point = points[Number(node.dataset.index)];
      node.addEventListener("mouseenter", (event) => showTooltip(event, point));
      node.addEventListener("mousemove", (event) => showTooltip(event, point));
      node.addEventListener("mouseleave", hideTooltip);
      node.addEventListener("focus", (event) => showTooltip(event, point));
      node.addEventListener("blur", hideTooltip);
    });
  }

  function shouldShowAxisLabel(index, total) {
    if (window.innerWidth <= 720) return total <= 12 || index % 2 === 0;
    return total <= 16 || index % 2 === 0;
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
    const x = ((point.x / 1000) * rect.width) + rect.left - wrap.left;
    const y = ((point.y / 320) * rect.height) + rect.top - wrap.top - 12;
    els.tooltip.hidden = false;
    els.tooltip.style.left = `${Math.max(72, Math.min(wrap.width - 72, x))}px`;
    els.tooltip.style.top = `${Math.max(52, y)}px`;
    els.tooltip.innerHTML = `<strong>${point.fullLabel}</strong>Vendas: ${point.sales}<br>Faturamento: ${money(point.revenue)}`;
  }

  function hideTooltip() {
    els.tooltip.hidden = true;
  }

  function renderAttendants() {
    const rows = getAttendantRows();
    const tbody = document.getElementById("attendantsBody");
    const empty = document.getElementById("attendantsEmpty");
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
    chart.innerHTML = rows
      .map(
        (row) => `
          <div class="bar-row">
            <strong>${escapeHtml(row.name)}</strong>
            <div class="bar-track"><div class="bar-fill" style="--bar-width:${Math.max(4, (row.revenue / max) * 100)}%"></div></div>
            <span>${money(row.revenue)} · ${integer(row.sales)} vendas</span>
          </div>`
      )
      .join("");
  }

  function renderTransactions() {
    const query = els.transactionSearch.value.trim().toLowerCase();
    const rows = state.filteredTransactions.filter((item) => {
      const haystack = `${item.pagador} ${item.atendente} ${item.valor} ${money(item.valor)} ${item.moedaOriginal}`.toLowerCase();
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
          <td>${formatDateBr(item.timestamp)}</td>
          <td>${formatTime(item.timestamp)}</td>
          <td class="payer-cell">${escapeHtml(item.pagador)}<small>${escapeHtml(item.atendente)}</small></td>
          <td>${escapeHtml(item.atendente)}</td>
          <td>${escapeHtml(item.moeda)}</td>
          <td>${money(item.valor)}</td>
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
      `${item.pagador} ${item.atendente} ${item.valor} ${money(item.valor)} ${item.moedaOriginal}`.toLowerCase().includes(query)
    );
    return Math.max(1, Math.ceil(rows.length / config.rowsPerPage));
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
    sendNotification(`Resumo das ${current}`, buildNotificationText());
  }

  function sendNotification(title, body) {
    if (navigator.serviceWorker && navigator.serviceWorker.ready) {
      navigator.serviceWorker.ready.then((registration) => registration.showNotification(title, {
        body,
        icon: "assets/icon-192.svg",
        badge: "assets/icon-192.svg"
      }));
      return;
    }
    new Notification(title, { body, icon: "assets/icon-192.svg" });
  }

  function buildNotificationText() {
    return `Faturamento: ${money(state.metrics.revenue || 0)} · Vendas: ${integer(state.metrics.sales || 0)} · ROAS: ${state.metrics.roas == null ? "N/A" : decimal(state.metrics.roas)}`;
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
      navigator.serviceWorker.register("sw.js").catch(console.error);
    }
  }

  function getDateRange() {
    const today = new Date();
    if (state.period === "yesterday") {
      const y = addDays(today, -1);
      return { start: y, end: y };
    }
    if (state.period === "last7") return { start: addDays(today, -6), end: today };
    if (state.period === "month") return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: today };
    if (state.period === "lastMonth") {
      return {
        start: new Date(today.getFullYear(), today.getMonth() - 1, 1),
        end: new Date(today.getFullYear(), today.getMonth(), 0)
      };
    }
    if (state.period === "custom") {
      return { start: parseLocalDate(els.startDate.value), end: parseLocalDate(els.endDate.value) };
    }
    return { start: today, end: today };
  }

  function getPeriodName() {
    return {
      today: "Hoje",
      yesterday: "Ontem",
      last7: "Últimos 7 dias",
      month: "Este mês",
      lastMonth: "Mês passado",
      custom: "Personalizado"
    }[state.period];
  }

  function setDefaultDates() {
    const today = new Date();
    els.endDate.value = toIsoDate(today);
    els.startDate.value = toIsoDate(addDays(today, -6));
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

  function formatDateBr(date) {
    return date.toLocaleDateString("pt-BR");
  }

  function formatTime(date) {
    return date.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });
  }

  function money(value) {
    return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
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
