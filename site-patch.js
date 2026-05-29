(function () {
  if (window.HOMESTUDIO_BI_SITE_PATCH_LOADED) return;
  window.HOMESTUDIO_BI_SITE_PATCH_LOADED = true;

  const CONFIG = window.HOMESTUDIO_BI_CONFIG || {};
  const BRL = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: CONFIG.currency || 'BRL' });
  const NOTIFICATION_TIMES = ['08:00', '12:00', '18:00', '23:00'];
  const STORE_KEY = 'homestudio.bi.notifications.v1';
  const sent = {};

  function clickRefreshSilently() {
    const button = document.querySelector('#refreshButton');
    if (button && !document.hidden) button.click();
  }

  function startFallbackRefresh() {
    if (!CONFIG.apiUrl || window.HOMESTUDIO_BI_NATIVE_AUTO_REFRESH) return;
    window.setTimeout(clickRefreshSilently, 250);
    window.setInterval(clickRefreshSilently, 15 * 60 * 1000);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) clickRefreshSilently();
    });
  }

  function moneyFrom(selector) {
    const text = document.querySelector(selector)?.textContent || '';
    const numeric = text.replace(/[^\d,.-]/g, '').replace(/\./g, '').replace(',', '.');
    return Number(numeric) || 0;
  }

  function textFrom(selector) {
    return document.querySelector(selector)?.textContent || '0';
  }

  function notificationBody() {
    const spend = moneyFrom('#metaSpendValue');
    const revenue = moneyFrom('#revenueValue');
    const cpa = moneyFrom('#cpaValue');
    const roas = textFrom('#roasValue');
    return `Seu investimento está em ${BRL.format(spend)}, com faturamento em ${BRL.format(revenue)}, com um CPA de ${BRL.format(cpa)} e um ROI de ${roas}.`;
  }

  function readSettings() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return NOTIFICATION_TIMES.reduce((settings, time) => {
        settings[time] = Boolean(saved[time]);
        return settings;
      }, {});
    } catch {
      return NOTIFICATION_TIMES.reduce((settings, time) => ({ ...settings, [time]: false }), {});
    }
  }

  function saveSettings(settings) {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings));
  }

  function permission() {
    return 'Notification' in window ? Notification.permission : 'unsupported';
  }

  async function requestPermission() {
    if (!('Notification' in window)) {
      alert('Este navegador ainda nao liberou notificacoes para este tipo de app.');
      return false;
    }
    if (Notification.permission === 'granted') return true;
    if (Notification.permission === 'denied') {
      alert('As notificacoes estao bloqueadas no navegador. Libere nas configuracoes do site/app.');
      return false;
    }
    return (await Notification.requestPermission()) === 'granted';
  }

  function sendNotification() {
    const body = notificationBody();
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

  function bindNotifications() {
    if (window.HOMESTUDIO_BI_NATIVE_NOTIFICATIONS) return;
    ensureNotificationUi();
    const list = document.querySelector('#notificationList');
    if (!list) return;
    const settings = readSettings();
    const all = document.querySelector('#notifyAllToggle');
    const status = document.querySelector('#notificationStatus');
    const update = () => {
      document.querySelectorAll('[data-notification-time]').forEach((input) => {
        input.checked = Boolean(settings[input.dataset.notificationTime]);
      });
      const enabledCount = NOTIFICATION_TIMES.filter((time) => settings[time]).length;
      if (all) all.checked = enabledCount === NOTIFICATION_TIMES.length;
      if (status) status.textContent = enabledCount ? `${enabledCount} ativas` : 'Desativadas';
      if (permission() === 'denied' && status) status.textContent = 'Bloqueadas';
    };

    document.querySelectorAll('[data-notification-time]').forEach((input) => {
      input.addEventListener('change', async () => {
        const allowed = await requestPermission();
        settings[input.dataset.notificationTime] = allowed ? input.checked : false;
        saveSettings(settings);
        update();
      });
    });
    if (all) {
      all.addEventListener('change', async () => {
        const enabled = all.checked;
        const allowed = enabled ? await requestPermission() : true;
        NOTIFICATION_TIMES.forEach((time) => {
          settings[time] = allowed ? enabled : false;
        });
        saveSettings(settings);
        update();
      });
    }
    document.querySelector('#testNotificationButton')?.addEventListener('click', async () => {
      if (await requestPermission()) sendNotification();
      update();
    });
    update();
  }

  function ensureNotificationUi() {
    if (document.querySelector('#notificationsView')) return;
    document.querySelector('.nav-list')?.insertAdjacentHTML('beforeend', '<button class="nav-item" type="button" data-view="notifications">Notificações</button>');
    document.querySelector('.mobile-tabbar')?.insertAdjacentHTML('beforeend', `
      <button class="mobile-tab" type="button" data-view="notifications" aria-label="Notificações">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 22a2.5 2.5 0 0 0 2.45-2h-4.9A2.5 2.5 0 0 0 12 22Zm7-6V11a7 7 0 0 0-5-6.7V3a2 2 0 1 0-4 0v1.3A7 7 0 0 0 5 11v5l-2 2v1h18v-1l-2-2Z"/></svg>
        <span>Alertas</span>
      </button>
    `);
    document.querySelector('.main-panel')?.insertAdjacentHTML('beforeend', `
      <section class="view" id="notificationsView" data-view-panel="notifications">
        <article class="panel page-panel notifications-panel">
          <div class="panel-header">
            <h1>Notificações</h1>
            <span id="notificationStatus">Desativadas</span>
          </div>
          <div class="notification-master">
            <div>
              <strong>Horários</strong>
              <span>Receba um resumo das campanhas nos horários selecionados.</span>
            </div>
            <label class="toggle-row compact-toggle">
              <span>Ativar todos</span>
              <input id="notifyAllToggle" type="checkbox">
              <i aria-hidden="true"></i>
            </label>
          </div>
          <div class="notification-list" id="notificationList">
            ${NOTIFICATION_TIMES.map((time) => `
              <label class="toggle-row">
                <span>Notificação das ${time}</span>
                <input type="checkbox" data-notification-time="${time}">
                <i aria-hidden="true"></i>
              </label>
            `).join('')}
          </div>
          <button class="secondary-button notification-test" id="testNotificationButton" type="button">Enviar teste</button>
        </article>
      </section>
    `);
    injectNotificationStyles();
    bindDynamicViewButtons();
  }

  function injectNotificationStyles() {
    if (document.querySelector('#homestudioNotificationStyles')) return;
    const style = document.createElement('style');
    style.id = 'homestudioNotificationStyles';
    style.textContent = `
      .notifications-panel{max-width:720px}.notification-master{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px;margin-bottom:10px}.notification-master div{display:grid;gap:6px}.notification-master strong{color:var(--text);font-size:16px;font-weight:var(--font-medium)}.notification-master span,.toggle-row span{color:var(--muted);font-size:14px}.notification-list{display:grid;gap:4px}.toggle-row{min-height:52px;display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:16px}.toggle-row input{position:absolute;inline-size:1px;block-size:1px;opacity:0}.toggle-row i{position:relative;width:46px;height:26px;border-radius:999px;background:#344030;border:1px solid var(--line);transition:background 160ms ease,border-color 160ms ease}.toggle-row i:after{content:"";position:absolute;width:18px;height:18px;left:4px;top:3px;border-radius:999px;background:var(--soft);transition:transform 160ms ease,background 160ms ease}.toggle-row input:checked+i{background:#0f6eea;border-color:#0f6eea}.toggle-row input:checked+i:after{transform:translateX(20px);background:#fff}.compact-toggle{min-height:34px}.notification-test{margin-top:16px}@media(max-width:1100px){.mobile-tabbar{grid-template-columns:repeat(6,1fr)}.mobile-tab{font-size:10px}.mobile-tab svg{width:21px;height:21px}}@media(max-width:480px){.notification-master{grid-template-columns:1fr}.toggle-row{min-height:48px}.status-pill{max-width:108px;min-height:30px;padding:0 8px;font-size:10px;overflow:hidden;text-overflow:ellipsis}}`;
    document.head.append(style);
  }

  function bindDynamicViewButtons() {
    document.querySelectorAll('[data-view="notifications"]').forEach((button) => {
      if (button.dataset.notificationBound) return;
      button.dataset.notificationBound = 'true';
      button.addEventListener('click', (event) => {
        event.preventDefault();
        document.querySelectorAll('[data-view]').forEach((item) => item.classList.toggle('active', item.dataset.view === 'notifications'));
        document.querySelectorAll('[data-view-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.viewPanel === 'notifications'));
      });
    });
  }

  function checkSchedule() {
    if (window.HOMESTUDIO_BI_NATIVE_NOTIFICATIONS || document.hidden || permission() !== 'granted') return;
    const now = new Date();
    const time = now.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', hour12: false });
    const settings = readSettings();
    if (!settings[time]) return;
    const key = `${now.toISOString().slice(0, 10)}:${time}`;
    if (sent[key]) return;
    sent[key] = true;
    sendNotification();
  }

  startFallbackRefresh();
  window.addEventListener('load', () => {
    bindNotifications();
    checkSchedule();
    window.setInterval(checkSchedule, 30000);
  });
})();
