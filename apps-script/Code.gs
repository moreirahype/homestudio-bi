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
  if (params.action === 'meta') {
    return outputJson_(readMetaInsights_(params.from, params.to), params.callback);
  }
  if (params.action === 'metaActions') {
    return outputJson_(readMetaInsights_(params.from, params.to, true), params.callback);
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
  const now = new Date();
  const timestampValue = pickValue_(payload, ['timestamp', 'dataHora', 'created_at', 'createdAt']);
  const timestamp = timestampValue ? new Date(timestampValue) : now;
  const originalValue = parseNumber_(pickValue_(payload, ['valor', 'value', 'event_value', 'eventValue', 'amount', 'preco', 'price']) || 0);
  const originalCurrency = normalizeCurrency_(pickValue_(payload, ['moeda', 'currency', 'coin']) || 'BRL');
  const exchangeRate = getCurrencyRateToBrl_(originalCurrency);
  const valueInBrl = roundCurrency_(originalValue * exchangeRate);
  const attendant = pickValue_(payload, ['atendente', 'attendant', 'vendedor', 'seller', 'responsavel', 'responsible']) || 'Sem atendente';
  return [
    Utilities.getUuid(),
    timestamp.toISOString(),
    Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'yyyy-MM-dd'),
    Utilities.formatDate(timestamp, Session.getScriptTimeZone(), 'HH:mm'),
    pickValue_(payload, ['pagador', 'payer', 'contactName', 'contact_name', 'nome', 'name', 'customer_name', 'cliente']) || 'Sem pagador',
    pickValue_(payload, ['telefone', 'phone', 'telephone', 'whatsapp', 'celular', 'mobile']) || '',
    'BRL',
    valueInBrl,
    attendant,
    pickValue_(payload, ['origem', 'source']) || 'Zapdata',
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
      const stamp = item.data ? new Date(item.data + 'T12:00:00') : new Date(item.timestamp);
      return stamp >= start && stamp <= end;
    });
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
  if ((header === 'valor' || header === 'valor_original' || header === 'cotacao_brl') && value !== '') {
    return parseNumber_(value);
  }
  return value;
}

function readMetaInsights_(from, to, includeActions) {
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
    const result = {
      spend: parseNumber_(first.spend || 0),
      leads: countLeads_(first.actions || [])
    };
    if (includeActions) result.actions = first.actions || [];
    return result;
  } catch (error) {
    return { spend: 0, leads: 0, error: String(error) };
  }
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
  const retentionDays = Number(properties.getProperty('RETENTION_DAYS') || 180);
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

  const maxRows = Number(properties.getProperty('MAX_TRANSACTION_ROWS') || 60000);
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
