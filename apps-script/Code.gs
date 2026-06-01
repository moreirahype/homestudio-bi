const SHEET_NAME = 'Transações';
const HEADERS = ['id', 'timestamp', 'data', 'hora', 'pagador', 'telefone', 'moeda', 'valor', 'atendente', 'origem', 'moeda_original', 'valor_original', 'cotacao_brl'];

function doGet(e) {
  const params = e.parameter || {};
  if (params.action === 'data') {
    return outputJson_({
      transactions: readTransactions_(params.from, params.to),
      meta: readMetaInsights_(params.from, params.to)
    }, params.callback);
  }
  return outputJson_({ ok: true, app: 'Home Studio BI' }, params.callback);
}

function doPost(e) {
  const payload = parsePayload_(e);
  const row = normalizeWebhook_(payload);
  const lock = LockService.getScriptLock();
  lock.waitLock(15000);
  try {
    const sheet = getTransactionsSheet_();
    sheet.appendRow(row);
    pruneOldRows_(sheet);
  } finally {
    lock.releaseLock();
  }
  return outputJson_({ ok: true, id: row[0] });
}

function parsePayload_(e) {
  if (!e || !e.postData || !e.postData.contents) return {};
  try {
    return JSON.parse(e.postData.contents);
  } catch (error) {
    return e.parameter || {};
  }
}

function normalizeWebhook_(payload) {
  const now = new Date();
  const timestamp = payload.timestamp ? new Date(payload.timestamp) : now;
  const originalValue = parseNumber_(payload.valor || payload.value || payload.event_value || 0);
  const originalCurrency = normalizeCurrency_(payload.moeda || payload.currency || 'BRL');
  const exchangeRate = getCurrencyRateToBrl_(originalCurrency);
  const valueInBrl = roundCurrency_(originalValue * exchangeRate);
  const attendant = payload.atendente || payload.attendant || 'Sem atendente';
  return [
    Utilities.getUuid(),
    timestamp.toISOString(),
    Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'HH:mm'),
    payload.pagador || payload.payer || payload.contactName || 'Sem pagador',
    payload.telefone || payload.phone || '',
    'BRL',
    valueInBrl,
    attendant,
    payload.origem || payload.source || 'Zapdata',
    originalCurrency,
    originalValue,
    exchangeRate
  ];
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

function readTransactions_(from, to) {
  const sheet = getTransactionsSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  const values = sheet.getRange(2, 1, lastRow - 1, HEADERS.length).getValues();
  const start = from ? new Date(from + 'T00:00:00') : new Date('2000-01-01T00:00:00');
  const end = to ? new Date(to + 'T23:59:59') : new Date('2100-01-01T23:59:59');

  return values
    .map((row) => rowToObject_(row))
    .filter((item) => {
      const stamp = new Date(item.timestamp);
      return stamp >= start && stamp <= end;
    });
}

function rowToObject_(row) {
  return HEADERS.reduce((object, header, index) => {
    object[header] = row[index];
    return object;
  }, {});
}

function readMetaInsights_(from, to) {
  const properties = PropertiesService.getScriptProperties();
  const token = properties.getProperty('META_ACCESS_TOKEN');
  const account = properties.getProperty('META_AD_ACCOUNT_ID');
  if (!token || !account) return { spend: 0, leads: 0 };

  const version = properties.getProperty('META_API_VERSION') || 'v25.0';
  const adAccount = account.indexOf('act_') === 0 ? account : 'act_' + account;
  const timeRange = encodeURIComponent(JSON.stringify({
    since: from || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    until: to || Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd')
  }));
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
    const first = data.data && data.data[0] ? data.data[0] : {};
    return {
      spend: parseNumber_(first.spend || 0),
      leads: countLeads_(first.actions || [])
    };
  } catch (error) {
    return { spend: 0, leads: 0, error: String(error) };
  }
}

function countLeads_(actions) {
  return actions.reduce((total, action) => {
    const type = String(action.action_type || '').toLowerCase();
    if (type.indexOf('lead') === -1) return total;
    return total + parseNumber_(action.value || 0);
  }, 0);
}

function pruneOldRows_(sheet) {
  const maxRows = Number(PropertiesService.getScriptProperties().getProperty('MAX_TRANSACTION_ROWS') || 40000);
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

function outputJson_(payload, callback) {
  const json = JSON.stringify(payload);
  if (callback) {
    return ContentService
      .createTextOutput(String(callback) + '(' + json + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }
  return ContentService.createTextOutput(json).setMimeType(ContentService.MimeType.JSON);
}
