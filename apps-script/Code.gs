const SHEET_NAME = 'Transações';
const ATTENDANTS_SHEET_NAME = 'Atendentes';
const GOALS_SHEET_NAME = 'Metas';
const DEBUG_SHEET_NAME = 'Debug';
const HEADERS = ['id', 'timestamp', 'data', 'hora', 'pagador', 'telefone', 'moeda', 'valor', 'atendente', 'origem', 'moeda_original', 'valor_original', 'cotacao_brl', 'comissao_percentual', 'produto'];
const ATTENDANT_HEADERS = ['slug', 'nome', 'comissao_percentual', 'salario_fixo_mensal'];
const GOAL_HEADERS = ['slug', 'meta_titulo', 'meta_valor', 'meta_premio', 'meta_ativa'];

function doGet(e) {
  const params = e.parameter || {};
  if (params.action === 'data') {
    return outputJson_({
      transactions: readTransactions_(params.from, params.to),
      meta: readMetaInsights_(params.from, params.to)
    }, params.callback);
  }
  if (params.action === 'meta') {
    return outputJson_(readMetaInsights_(params.from, params.to), params.callback);
  }
  if (params.action === 'metaActions') {
    return outputJson_(readMetaInsights_(params.from, params.to, true), params.callback);
  }
  if (params.action === 'attendant') {
    return outputJson_(readAttendantData_(params.slug, params.from, params.to), params.callback);
  }
  return outputJson_({ ok: true, app: 'Home Studio BI' }, params.callback);
}

function doPost(e) {
  const payload = parsePayload_(e);
  console.log('Payload recebido: ' + JSON.stringify(payload));
  const validation = validateWebhook_(payload);
  if (!validation.ok) {
    console.log('Webhook rejeitado: ' + JSON.stringify(validation));
    appendDebugLog_('rejected', payload, validation);
    return outputJson_(validation);
  }
  const row = normalizeWebhook_(payload);
  if (!row) {
    console.log('Webhook ignorado pelo normalizador.');
    appendDebugLog_('ignored', payload, { ok: true, ignored: true });
    return outputJson_({ ok: true, ignored: true });
  }
  let inserted = false;
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getTransactionsSheet_();
    if (transactionExists_(sheet, row[0])) {
      console.log('Transação duplicada: ' + row[0]);
      appendDebugLog_('duplicate', payload, { ok: true, duplicate: true, id: row[0], row: row });
      return outputJson_({ ok: true, duplicate: true, id: row[0] });
    }
    sheet.appendRow(row);
    pruneOldRows_(sheet);
    inserted = true;
    console.log('Transação inserida na aba ' + sheet.getName() + ': ' + JSON.stringify(row));
    appendDebugLog_('inserted', payload, { ok: true, id: row[0], row: row, sheet: sheet.getName() });
  } finally {
    lock.releaseLock();
  }
  if (inserted && normalizePersonName_(row[8]) === normalizePersonName_('Sheila')) {
    try {
      sendPushRequest_({
        audience: 'sheila',
        title: 'Venda Realizada! 💰',
        body: '',
        url: getPushProperty_('SHEILA_APP_URL'),
        tag: 'hsbi-sheila-sale'
      });
    } catch (error) {
      console.error('Falha ao enviar push da Sheila: ' + error);
    }
  }
  return outputJson_({ ok: true, id: row[0] });
}

function appendDebugLog_(status, payload, result) {
  try {
    const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = spreadsheet.getSheetByName(DEBUG_SHEET_NAME);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(DEBUG_SHEET_NAME);
      sheet.appendRow(['timestamp', 'status', 'payload', 'result']);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow([
      new Date().toISOString(),
      status,
      JSON.stringify(payload),
      JSON.stringify(result)
    ]);
  } catch (error) {
    console.error('Falha ao gravar Debug: ' + error);
  }
}

function setupOwnerPushTriggers() {
  const handlers = [
    'checkOwnerPushSchedule',
    'sendOwnerCampaignPush08',
    'sendOwnerCampaignPush12',
    'sendOwnerCampaignPush18',
    'sendOwnerCampaignPush23'
  ];
  ScriptApp.getProjectTriggers()
    .filter((trigger) => handlers.indexOf(trigger.getHandlerFunction()) > -1)
    .forEach((trigger) => ScriptApp.deleteTrigger(trigger));
  ScriptApp.newTrigger('checkOwnerPushSchedule').timeBased().everyMinutes(5).create();
  return { ok: true, intervalMinutes: 5 };
}

function checkOwnerPushSchedule() {
  const now = new Date();
  const timezone = Session.getScriptTimeZone();
  const hour = Utilities.formatDate(now, timezone, 'HH');
  const minute = Number(Utilities.formatDate(now, timezone, 'mm'));
  const target = ['08', '12', '18', '23'].indexOf(hour) > -1 && minute < 15
    ? hour + ':00'
    : '';
  if (!target) return { ok: true, skipped: true };
  const properties = PropertiesService.getScriptProperties();
  const key = 'OWNER_PUSH_SENT_' + Utilities.formatDate(now, timezone, 'yyyy-MM-dd') + '_' + target;
  if (properties.getProperty(key)) return { ok: true, duplicate: true };
  const result = sendOwnerCampaignPush_(target);
  properties.setProperty(key, now.toISOString());
  return result;
}

function sendOwnerCampaignPush08() {
  return sendOwnerCampaignPush_('08:00');
}

function sendOwnerCampaignPush12() {
  return sendOwnerCampaignPush_('12:00');
}

function sendOwnerCampaignPush18() {
  return sendOwnerCampaignPush_('18:00');
}

function sendOwnerCampaignPush23() {
  return sendOwnerCampaignPush_('23:00');
}

function sendOwnerCampaignPush_(time) {
  const today = Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const transactions = readTransactions_(today, today);
  const meta = readMetaInsights_(today, today);
  const revenue = transactions.reduce((total, item) => total + parseNumber_(item.valor || 0), 0);
  const sales = transactions.length;
  const ads = parseNumber_(meta.spend || 0);
  const taxRate = Number(PropertiesService.getScriptProperties().getProperty('META_TAX_RATE') || 0.1383);
  const totalSpend = ads + ads * taxRate;
  const cpa = sales > 0 ? totalSpend / sales : null;
  const roas = totalSpend > 0 ? revenue / totalSpend : null;
  const body =
    'Seu investimento está em ' + formatBrl_(totalSpend) +
    ', com faturamento em ' + formatBrl_(revenue) +
    ', com um CPA de ' + (cpa == null ? 'N/A' : formatBrl_(cpa)) +
    ' e um ROI de ' + (roas == null ? '0,00' : formatDecimal_(roas)) + '.';
  return sendPushRequest_({
    audience: 'owner',
    time: time,
    title: 'Resumo das Campanhas!',
    body: body,
    url: getPushProperty_('OWNER_APP_URL'),
    tag: 'hsbi-owner-' + time.replace(':', '')
  });
}

function sendPushRequest_(payload) {
  const baseUrl = getPushProperty_('PUSH_API_URL').replace(/\/$/, '');
  const secret = getPushProperty_('PUSH_API_SECRET');
  if (!baseUrl || !secret) throw new Error('Configure PUSH_API_URL e PUSH_API_SECRET.');
  const response = UrlFetchApp.fetch(baseUrl + '/api/send', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + secret },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  const text = response.getContentText();
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Servidor push respondeu ' + response.getResponseCode() + ': ' + text);
  }
  return JSON.parse(text);
}

function getPushProperty_(name) {
  return String(PropertiesService.getScriptProperties().getProperty(name) || '').trim();
}

function formatBrl_(value) {
  return 'R$ ' + Number(value || 0).toFixed(2).replace('.', ',');
}

function formatDecimal_(value) {
  return Number(value || 0).toFixed(2).replace('.', ',');
}

function parsePayload_(e) {
  const params = (e && e.parameter) ? e.parameter : {};
  if (!e || !e.postData || !e.postData.contents) return params;
  const contents = e.postData.contents;
  try {
    return mergeObjects_(params, flattenPayload_(JSON.parse(contents)));
  } catch (error) {
    return mergeObjects_(params, parseFormPayload_(contents));
  }
}

function normalizeWebhook_(payload) {
  const isCakto = isCaktoPayload_(payload);
  const event = pickValue_(payload, ['event']);
  if (isCakto && event !== 'purchase_approved') return null;
  const now = new Date();
  const timestampValue = isCakto
    ? pickValue_(payload, ['data.paidAt', 'paidAt', 'data.createdAt', 'createdAt'])
    : pickValue_(payload, ['timestamp', 'dataHora', 'created_at', 'createdAt']);
  const timestamp = timestampValue ? new Date(timestampValue) : now;
  const originalValue = parseNumber_(isCakto
    ? pickValue_(payload, ['data.amount', 'amount', 'data.baseAmount', 'baseAmount'])
    : pickValue_(payload, ['valor', 'value', 'event_value', 'eventValue', 'amount', 'preco', 'price']) || 0);
  const originalCurrency = normalizeCurrency_(isCakto
    ? 'BRL'
    : pickValue_(payload, ['moeda', 'currency', 'coin']) || 'BRL');
  const exchangeRate = getCurrencyRateToBrl_(originalCurrency);
  const valueInBrl = roundCurrency_(originalValue * exchangeRate);
  const attendant = pickValue_(payload, ['atendente', 'attendant', 'vendedor', 'seller', 'responsavel', 'responsible']) || 'Sem atendente';
  const attendantConfig = getAttendantConfigByName_(attendant);
  const commissionPercent = attendantConfig ? attendantConfig.comissao_percentual : '';
  return [
    buildTransactionId_(payload, isCakto),
    timestamp.toISOString(),
    Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'HH:mm'),
    isCakto
      ? pickValue_(payload, ['data.customer.name', 'customer.name', 'customer_name']) || 'Sem pagador'
      : pickValue_(payload, ['pagador', 'payer', 'contactName', 'contact_name', 'nome', 'name', 'customer_name', 'cliente']) || 'Sem pagador',
    isCakto
      ? pickValue_(payload, ['data.customer.phone', 'customer.phone', 'phone']) || ''
      : pickValue_(payload, ['telefone', 'phone', 'telephone', 'whatsapp', 'celular', 'mobile']) || '',
    'BRL',
    valueInBrl,
    attendant,
    isCakto ? 'Cakto' : pickValue_(payload, ['origem', 'source']) || 'Zapdata',
    originalCurrency,
    originalValue,
    exchangeRate,
    commissionPercent,
    pickValue_(payload, ['produto', 'product', 'item_type', 'itemType']) || ''
  ];
}

function buildTransactionId_(payload, isCakto) {
  if (isCakto) {
    return pickValue_(payload, ['data.id', 'id', 'transaction_id', 'payment_id']) || Utilities.getUuid();
  }
  return pickValue_(payload, ['transaction_id', 'payment_id', 'order_id', 'sale_id', 'pix_id'])
    || Utilities.getUuid();
}

function isCaktoPayload_(payload) {
  const event = String(pickValue_(payload, ['event']) || '').trim().toLowerCase();
  if (event === 'purchase_approved') return true;
  return Boolean(
    pickValue_(payload, ['secret']) &&
    pickValue_(payload, ['data.amount', 'data.checkoutUrl', 'data.product.id'])
  );
}

function validateWebhook_(payload) {
  const isGallery = String(pickValue_(payload, ['origem', 'source']) || '').trim().toLowerCase() === 'home studio gallery';
  if (!isCaktoPayload_(payload) && !isGallery) return { ok: true };
  const properties = PropertiesService.getScriptProperties();
  const expectedSecret = isGallery
    ? properties.getProperty('GALLERY_WEBHOOK_SECRET')
    : properties.getProperty('CAKTO_WEBHOOK_SECRET');
  if (!expectedSecret) return { ok: true };
  const receivedSecret = String(pickValue_(payload, ['hsbi_key', 'cakto_key', 'webhook_secret']) || '');
  return receivedSecret === expectedSecret
    ? { ok: true }
    : { ok: false, error: 'Chave secreta inválida.' };
}

function transactionExists_(sheet, id) {
  if (!id || sheet.getLastRow() < 2) return false;
  return sheet
    .getRange(2, 1, sheet.getLastRow() - 1, 1)
    .createTextFinder(String(id))
    .matchEntireCell(true)
    .findNext() !== null;
}

function getTransactionsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(SHEET_NAME);
  const current = sheet.getRange(1, 1, 1, HEADERS.length).getValues()[0];
  const missingHeaders = HEADERS.some((header, index) => current[index] !== header);
  if (missingHeaders) {
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function getAttendantsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(ATTENDANTS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(ATTENDANTS_SHEET_NAME);
  const currentWidth = Math.max(sheet.getLastColumn(), ATTENDANT_HEADERS.length);
  const current = sheet.getRange(1, 1, 1, currentWidth).getValues()[0];
  const missingHeaders = ATTENDANT_HEADERS.some((header, index) => current[index] !== header);
  if (missingHeaders) {
    migrateAttendantsSheet_(sheet, current);
    sheet.setFrozenRows(1);
  }
  if (sheet.getLastRow() < 2) {
    sheet.appendRow(['k9v2m7q4', 'Sheila', 10, 1000]);
  }
  return sheet;
}

function migrateAttendantsSheet_(sheet, currentHeaders) {
  const lastRow = sheet.getLastRow();
  const currentWidth = Math.max(sheet.getLastColumn(), currentHeaders.length);
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, currentWidth).getValues() : [];
  const headerIndex = {};
  currentHeaders.forEach((header, index) => {
    if (header) headerIndex[String(header).trim()] = index;
  });
  const remapped = rows.map((row) => ATTENDANT_HEADERS.map((header) => {
    const legacyHeader = header === 'meta_valor' ? 'meta_semanal_valor' : header;
    const index = headerIndex[header] != null ? headerIndex[header] : headerIndex[legacyHeader];
    return index == null ? '' : row[index];
  }));
  sheet.getRange(1, 1, 1, ATTENDANT_HEADERS.length).setValues([ATTENDANT_HEADERS]);
  if (remapped.length) sheet.getRange(2, 1, remapped.length, ATTENDANT_HEADERS.length).setValues(remapped);
  deleteExtraColumns_(sheet, ATTENDANT_HEADERS.length);
}

function readAttendantConfigs_() {
  const sheet = getAttendantsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, ATTENDANT_HEADERS.length)
    .getValues()
    .map((row) => ATTENDANT_HEADERS.reduce((object, header, index) => {
      object[header] = normalizeAttendantCell_(header, row[index]);
      return object;
    }, {}))
    .filter((item) => item.slug && item.nome);
}

function normalizeAttendantCell_(header, value) {
  if (header === 'comissao_percentual' || header === 'salario_fixo_mensal') {
    return parseNumber_(value);
  }
  return value;
}

function getGoalsSheet_() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName(GOALS_SHEET_NAME);
  if (!sheet) sheet = spreadsheet.insertSheet(GOALS_SHEET_NAME);
  const currentWidth = Math.max(sheet.getLastColumn(), GOAL_HEADERS.length);
  const current = sheet.getRange(1, 1, 1, currentWidth).getValues()[0];
  const missingHeaders = GOAL_HEADERS.some((header, index) => current[index] !== header);
  if (missingHeaders) {
    migrateGoalsSheet_(sheet, current);
    sheet.setFrozenRows(1);
  }
  deleteExtraColumns_(sheet, GOAL_HEADERS.length);
  return sheet;
}

function migrateGoalsSheet_(sheet, currentHeaders) {
  const lastRow = sheet.getLastRow();
  const currentWidth = Math.max(sheet.getLastColumn(), currentHeaders.length);
  const rows = lastRow > 1 ? sheet.getRange(2, 1, lastRow - 1, currentWidth).getValues() : [];
  const headerIndex = {};
  currentHeaders.forEach((header, index) => {
    if (header) headerIndex[String(header).trim()] = index;
  });
  const remapped = rows.map((row) => GOAL_HEADERS.map((header) => {
    if (header === 'meta_ativa') return getExistingGoalCell_(row, headerIndex, 'meta_ativa') || true;
    return getExistingGoalCell_(row, headerIndex, header);
  }));
  sheet.getRange(1, 1, 1, GOAL_HEADERS.length).setValues([GOAL_HEADERS]);
  if (remapped.length) sheet.getRange(2, 1, remapped.length, GOAL_HEADERS.length).setValues(remapped);
}

function getExistingGoalCell_(row, headerIndex, header) {
  const index = headerIndex[header];
  return index == null ? '' : row[index];
}

function deleteExtraColumns_(sheet, expectedColumns) {
  const extraColumns = sheet.getLastColumn() - expectedColumns;
  if (extraColumns > 0) sheet.deleteColumns(expectedColumns + 1, extraColumns);
}

function readGoalsForSlug_(slug) {
  const properties = PropertiesService.getScriptProperties();
  const goals = readGoalRows_()
    .map((item) => hydrateGoalStart_(item, properties));
  return goals
    .filter((item) => String(item.slug || '').trim() === String(slug || '').trim())
    .filter((item) => item.meta_ativa && Number(item.meta_valor || 0) > 0 && item.meta_inicio);
}

function inspectGoalStarts() {
  const properties = PropertiesService.getScriptProperties();
  const goals = readGoalRows_()
    .map((goal) => hydrateGoalStart_(goal, properties))
    .filter((goal) => goal.meta_ativa && Number(goal.meta_valor || 0) > 0 && goal.meta_inicio)
    .map((goal) => ({
      slug: goal.slug,
      meta_titulo: goal.meta_titulo,
      meta_valor: goal.meta_valor,
      meta_premio: goal.meta_premio,
      ativada_em: goal.meta_inicio,
      propriedade: getGoalStartKey_(goal)
    }));
  console.log(JSON.stringify(goals, null, 2));
  return goals;
}

function cleanupObsoleteGoalStarts() {
  const properties = PropertiesService.getScriptProperties();
  const activeKeys = new Set(
    readGoalRows_()
      .filter((goal) => goal.meta_ativa && Number(goal.meta_valor || 0) > 0)
      .map((goal) => getGoalStartKey_(goal))
      .filter(Boolean)
  );
  const allProperties = properties.getProperties();
  const removed = [];
  Object.keys(allProperties).forEach((key) => {
    if (key.indexOf('goal_started_at_') !== 0 || activeKeys.has(key)) return;
    properties.deleteProperty(key);
    removed.push(key);
  });
  console.log(JSON.stringify({ removed: removed.length, active: activeKeys.size }, null, 2));
  return { ok: true, removed: removed.length, active: activeKeys.size };
}

function readGoalRows_() {
  const sheet = getGoalsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, GOAL_HEADERS.length)
    .getValues()
    .map((row) => GOAL_HEADERS.reduce((object, header, index) => {
      object[header] = normalizeGoalCell_(header, row[index]);
      return object;
    }, {}))
    .filter((goal) => goal.slug && goal.meta_titulo);
}

function hydrateGoalStart_(goal, properties) {
  const key = getGoalStartKey_(goal);
  if (!key) return goal;
  if (goal.meta_ativa && Number(goal.meta_valor || 0) > 0) {
    let startedAt = properties.getProperty(key);
    if (!startedAt) {
      startedAt = new Date().toISOString();
      properties.setProperty(key, startedAt);
    }
    goal.meta_inicio = startedAt;
  } else {
    properties.deleteProperty(key);
    goal.meta_inicio = '';
  }
  return goal;
}

function getGoalStartKey_(goal) {
  const raw = [
    goal.slug,
    goal.meta_titulo,
    goal.meta_valor,
    goal.meta_premio
  ].map((part) => String(part || '').trim().toLowerCase()).join('|');
  if (!String(goal.slug || '').trim() || !String(goal.meta_titulo || '').trim()) return '';
  return 'goal_started_at_' + Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}

function normalizeGoalCell_(header, value) {
  if (header === 'meta_valor') return parseNumber_(value);
  if (header === 'meta_ativa') {
    if (typeof value === 'boolean') return value;
    return ['true', 'sim', 's', '1', 'ativo', 'ativa'].indexOf(String(value || '').toLowerCase().trim()) > -1;
  }
  return value;
}

function getAttendantConfigByName_(name) {
  const normalizedName = normalizePersonName_(name);
  return readAttendantConfigs_().find((item) => normalizePersonName_(item.nome) === normalizedName) || null;
}

function getAttendantConfigBySlug_(slug) {
  const normalizedSlug = String(slug || '').trim();
  return readAttendantConfigs_().find((item) => String(item.slug || '').trim() === normalizedSlug) || null;
}

function readAttendantData_(slug, from, to) {
  const config = getAttendantConfigBySlug_(slug);
  if (!config) return { ok: false, error: 'Atendente não encontrada.', attendant: null, transactions: [] };
  const goals = readGoalsForSlug_(slug);
  const effectiveFrom = getEarliestGoalStart_(goals, from);
  const transactions = readTransactions_(effectiveFrom, to).filter((item) => normalizePersonName_(item.atendente) === normalizePersonName_(config.nome));
  return {
    ok: true,
    attendant: config,
    goals: goals,
    transactions: transactions,
    serverTime: new Date().toISOString()
  };
}

function getEarliestGoalStart_(goals, fallbackFrom) {
  const fallback = fallbackFrom || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd');
  const dates = goals
    .map((goal) => goal.meta_inicio ? new Date(goal.meta_inicio) : null)
    .filter((date) => date && !isNaN(date.getTime()));
  if (!dates.length) return fallbackFrom;
  const earliest = dates.reduce((min, date) => date < min ? date : min, dates[0]);
  const fallbackDate = fallbackFrom ? new Date(fallbackFrom + 'T00:00:00') : null;
  if (fallbackDate && fallbackDate < earliest) return fallbackFrom;
  return Utilities.formatDate(earliest, Session.getScriptTimeZone(), 'yyyy-MM-dd');
}

function normalizePersonName_(value) {
  return String(value || '').trim().toLowerCase();
}

function readTransactions_(from, to) {
  const sheet = getTransactionsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const start = from ? new Date(from + 'T00:00:00') : new Date('2000-01-01T00:00:00');
  const end = to ? new Date(to + 'T23:59:59') : new Date('2100-01-01T23:59:59');
  const rowWindow = findTransactionRowsByDate_(sheet, start, end);
  if (!rowWindow) return [];
  const values = sheet.getRange(rowWindow.startRow, 1, rowWindow.rowCount, HEADERS.length).getValues();

  return values
    .map((row) => rowToObject_(row))
    .filter((item) => {
      const stamp = item.data ? new Date(item.data + 'T12:00:00') : new Date(item.timestamp);
      return stamp >= start && stamp <= end;
    });
}

function findTransactionRowsByDate_(sheet, start, end) {
  const lastRow = sheet.getLastRow();
  const rowCount = lastRow - 1;
  if (rowCount <= 0) return null;
  const dates = sheet.getRange(2, 3, rowCount, 1).getValues();
  let firstIndex = -1;
  let lastIndex = -1;
  for (let i = 0; i < dates.length; i++) {
    const dateValue = dates[i][0] instanceof Date ? dates[i][0] : new Date(String(dates[i][0]) + 'T00:00:00');
    if (dateValue >= start && dateValue <= end) {
      if (firstIndex === -1) firstIndex = i;
      lastIndex = i;
    }
  }
  if (firstIndex === -1) return null;
  return {
    startRow: firstIndex + 2,
    rowCount: lastIndex - firstIndex + 1
  };
}

function rowToObject_(row) {
  return HEADERS.reduce((object, header, index) => {
    object[header] = normalizeCell_(header, row[index]);
    return object;
  }, {});
}

function normalizeCell_(header, value) {
  if (value instanceof Date) {
    if (header === 'timestamp') return value.toISOString();
    if (header === 'data') return Utilities.formatDate(value, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    if (header === 'hora') return Utilities.formatDate(value, Session.getScriptTimeZone(), 'HH:mm');
  }
  if (header === 'data' && value) {
    const text = String(value);
    if (/^\d{4}-\d{2}-\d{2}/.test(text)) return text.slice(0, 10);
  }
  if (header === 'hora' && value) {
    const match = String(value).match(/(\d{1,2}):(\d{2})/);
    if (match) return String(match[1]).padStart(2, '0') + ':' + match[2];
  }
  if ((header === 'valor' || header === 'valor_original' || header === 'cotacao_brl' || header === 'comissao_percentual') && value !== '') {
    return parseNumber_(value);
  }
  return value;
}

function readMetaInsights_(from, to, includeActions) {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('META_ACCESS_TOKEN');
  const accounts = getMetaAdAccounts_(properties);
  if (!token || !accounts.length) return { spend: 0, leads: 0 };

  const version = properties.getProperty('META_API_VERSION') || 'v25.0';
  const timeRange = encodeURIComponent(JSON.stringify({
    since: from || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    until: to || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  }));
  const result = { spend: 0, leads: 0 };
  const actions = [];
  const errors = [];

  accounts.forEach((account) => {
    const adAccount = account.indexOf('act_') === 0 ? account : 'act_' + account;
    const url =
      'https://graph.facebook.com/' +
      version +
      '/' +
      adAccount +
      '/insights?level=account&fields=spend,actions&time_range=' +
      timeRange +
      '&access_token=' +
      encodeURIComponent(token);
    try {
      const response = UrlFetchApp.fetch(url, { muteHttpExceptions: true });
      const data = JSON.parse(response.getContentText());
      if (response.getResponseCode() >= 400 || data.error) {
        errors.push({ account: adAccount, error: data.error || response.getContentText() });
        return;
      }
      const first = data.data && data.data[0] ? data.data[0] : {};
      const accountActions = first.actions || [];
      result.spend += parseNumber_(first.spend || 0);
      result.leads += countLeads_(accountActions);
      if (includeActions) {
        accountActions.forEach((action) => actions.push({
          account: adAccount,
          action_type: action.action_type,
          value: action.value
        }));
      }
    } catch (error) {
      errors.push({ account: adAccount, error: String(error) });
    }
  });

  result.spend = roundCurrency_(result.spend);
  if (includeActions) {
    result.actions = actions;
    result.accounts = accounts;
    if (errors.length) result.errors = errors;
  }
  return result;
}

function getMetaAdAccounts_(properties) {
  const raw = String(properties.getProperty('META_AD_ACCOUNT_IDS') || '').trim();
  if (!raw) return [];
  const unique = {};
  return raw
    .split(/[\s,;]+/)
    .map((account) => account.trim())
    .filter(Boolean)
    .filter((account) => {
      const normalized = account.indexOf('act_') === 0 ? account.slice(4) : account;
      if (!/^\d+$/.test(normalized) || unique[normalized]) return false;
      unique[normalized] = true;
      return true;
    });
}

function countLeads_(actions) {
  const matchers = getLeadActionMatchers_();
  return actions.reduce((total, action) => {
    const type = String(action.action_type || '').toLowerCase();
    const shouldCount = matchers.some((matcher) => type === matcher);
    if (!shouldCount) return total;
    return total + parseNumber_(action.value || 0);
  }, 0);
}

function getLeadActionMatchers_() {
  const raw = PropertiesService.getScriptProperties().getProperty('LEAD_ACTION_TYPES_JSON');
  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed) && parsed.length) {
        return parsed.map((item) => String(item).toLowerCase().trim()).filter(Boolean);
      }
    } catch (error) {
      return raw.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean);
    }
  }
  return ['lead'];
}

function pruneOldRows_(sheet) {
  const properties = PropertiesService.getScriptProperties();
  const retentionDays = Number(properties.getProperty('RETENTION_DAYS') || 730);
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - retentionDays);
  cutoff.setHours(0, 0, 0, 0);

  const lastRow = sheet.getLastRow();
  if (lastRow > 1) {
    const dates = sheet.getRange(2, 3, lastRow - 1, 1).getValues();
    let oldRows = 0;
    for (let i = 0; i < dates.length; i++) {
      const dateValue = dates[i][0] instanceof Date ? dates[i][0] : new Date(String(dates[i][0]) + 'T00:00:00');
      if (dateValue < cutoff) oldRows += 1;
      else break;
    }
    if (oldRows > 0) sheet.deleteRows(2, oldRows);
  }

  const maxRows = Number(properties.getProperty('MAX_TRANSACTION_ROWS') || 500000);
  const overflow = sheet.getLastRow() - 1 - maxRows;
  if (overflow > 0) sheet.deleteRows(2, overflow);
}

function normalizeCurrency_(value) {
  return String(value || 'BRL').trim().toUpperCase();
}

function getCurrencyRateToBrl_(currency) {
  const normalized = normalizeCurrency_(currency);
  if (normalized === 'BRL') return 1;

  const manualRates = getManualCurrencyRates_();
  if (manualRates[normalized]) return Number(manualRates[normalized]);

  const cache = CacheService.getScriptCache();
  const cacheKey = 'currency-rate-' + normalized + '-BRL';
  const cached = cache.get(cacheKey);
  if (cached) return Number(cached);

  const rate = getGoogleFinanceRate_(normalized);
  cache.put(cacheKey, String(rate), 21600);
  return rate;
}

function getManualCurrencyRates_() {
  const raw = PropertiesService.getScriptProperties().getProperty('CURRENCY_RATES_JSON') || '{}';
  try {
    const parsed = JSON.parse(raw);
    return Object.keys(parsed).reduce((rates, key) => {
      rates[normalizeCurrency_(key)] = Number(parsed[key]);
      return rates;
    }, {});
  } catch (error) {
    return {};
  }
}

function getGoogleFinanceRate_(currency) {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = spreadsheet.getSheetByName('Cotações');
  if (!sheet) {
    sheet = spreadsheet.insertSheet('Cotações');
    sheet.hideSheet();
  }

  const pair = currency + 'BRL';
  sheet.getRange('A1').setValue('Par');
  sheet.getRange('B1').setValue('Cotação');
  sheet.getRange('A2').setValue(pair);
  sheet.getRange('B2').setFormula('=GOOGLEFINANCE("CURRENCY:' + pair + '")');
  SpreadsheetApp.flush();
  Utilities.sleep(1500);

  const rate = parseNumber_(sheet.getRange('B2').getValue());
  if (!rate || rate <= 0) {
    throw new Error('Não foi possível obter cotação para ' + currency + '/BRL. Defina CURRENCY_RATES_JSON nas propriedades do Apps Script.');
  }
  return rate;
}

function roundCurrency_(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function parseNumber_(value) {
  if (typeof value === 'number') return value;
  const text = String(value || '0').trim();
  const normalized = text.indexOf(',') > -1 ? text.replace(/\./g, '').replace(',', '.') : text;
  const parsed = Number(normalized);
  return isNaN(parsed) ? 0 : parsed;
}

function parseFormPayload_(contents) {
  const object = {};
  String(contents || '').split('&').forEach((pair) => {
    const parts = pair.split('=');
    if (!parts[0]) return;
    const key = decodeURIComponent(parts[0].replace(/\+/g, ' '));
    const value = decodeURIComponent((parts.slice(1).join('=') || '').replace(/\+/g, ' '));
    object[key] = value;
  });
  return flattenPayload_(object);
}

function flattenPayload_(payload) {
  const flat = {};
  flattenInto_(flat, payload, '');
  return flat;
}

function flattenInto_(flat, value, prefix) {
  if (value == null) return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => flattenInto_(flat, item, prefix ? prefix + '.' + index : String(index)));
    return;
  }
  if (typeof value === 'object') {
    Object.keys(value).forEach((key) => {
      const nextPrefix = prefix ? prefix + '.' + key : key;
      flattenInto_(flat, value[key], nextPrefix);
      if (typeof value[key] !== 'object' || value[key] == null) flat[key] = value[key];
    });
    return;
  }
  flat[prefix] = value;
}

function pickValue_(object, keys) {
  const normalized = {};
  Object.keys(object || {}).forEach((key) => {
    normalized[normalizeKey_(key)] = object[key];
  });
  for (let i = 0; i < keys.length; i++) {
    const wanted = normalizeKey_(keys[i]);
    if (normalized[wanted] !== undefined && normalized[wanted] !== '') return normalized[wanted];
  }
  return '';
}

function normalizeKey_(key) {
  return String(key || '').toLowerCase().replace(/[^a-z0-9]/g, '');
}

function mergeObjects_(first, second) {
  const merged = {};
  Object.keys(first || {}).forEach((key) => merged[key] = first[key]);
  Object.keys(second || {}).forEach((key) => merged[key] = second[key]);
  return merged;
}

function outputJson_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    return ContentService
      .createTextOutput(String(callback) + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
