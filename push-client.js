(function () {
  "use strict";

  function getConfig() {
    return Object.assign({ pushApiUrl: "", vapidPublicKey: "" }, window.HSBI_CONFIG || {});
  }

  function apiUrl(path) {
    return `${getConfig().pushApiUrl.replace(/\/$/, "")}${path}`;
  }

  function subscriptionIdKey(audience) {
    return `hsbi-push-subscription-${audience}`;
  }

  function urlBase64ToUint8Array(value) {
    const padding = "=".repeat((4 - (value.length % 4)) % 4);
    const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base64);
    return Uint8Array.from(Array.from(raw).map((char) => char.charCodeAt(0)));
  }

  function assertConfigured() {
    const config = getConfig();
    if (!config.pushApiUrl || !config.vapidPublicKey) {
      throw new Error("O servidor de notificações ainda não foi configurado.");
    }
    if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      throw new Error("No iPhone, abra o app instalado pela Tela de Início para ativar notificações.");
    }
    return config;
  }

  async function requestPermission() {
    assertConfigured();
    if (Notification.permission === "granted") return true;
    if (Notification.permission === "denied") {
      throw new Error("As notificações estão bloqueadas nos ajustes do aparelho.");
    }
    return (await Notification.requestPermission()) === "granted";
  }

  async function sync(audience, preferences) {
    const config = assertConfigured();
    if (!(await requestPermission())) throw new Error("Permissão de notificação não concedida.");
    const registration = await ensureServiceWorkerRegistration();
    let subscription = await registration.pushManager.getSubscription();
    if (!subscription) {
      subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(config.vapidPublicKey)
      });
    }
    const response = await fetch(apiUrl("/api/subscribe"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ audience, subscription: subscription.toJSON(), preferences })
    });
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível ativar as notificações.");
    localStorage.setItem(subscriptionIdKey(audience), result.id);
    return result;
  }

  async function update(audience, preferences) {
    const id = localStorage.getItem(subscriptionIdKey(audience));
    if (!id) return preferences.enabled === false ? { ok: true } : sync(audience, preferences);
    const response = await fetch(apiUrl("/api/preferences"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, preferences })
    });
    if (response.status === 404) {
      localStorage.removeItem(subscriptionIdKey(audience));
      return preferences.enabled === false ? { ok: true } : sync(audience, preferences);
    }
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || "Não foi possível atualizar as notificações.");
    return result;
  }

  async function test(audience, notification) {
    const id = localStorage.getItem(subscriptionIdKey(audience));
    if (!id) throw new Error("Ative pelo menos uma notificação antes de testar.");
    const localShown = await showLocalTestNotification(audience, notification);
    if (localShown) {
      sendRemoteTest(audience, id, notification).catch(console.error);
      return { ok: true, localOnly: true };
    }
    return sendRemoteTest(audience, id, notification);
  }

  async function sendRemoteTest(audience, id, notification) {
    const response = await fetch(apiUrl("/api/test"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(Object.assign({ id, audience }, notification))
    });
    const result = await response.json();
    if (response.status === 429) {
      return { ok: true, throttled: true };
    }
    if (!response.ok || !result.ok) throw new Error(result.error || "Falha ao enviar a notificação de teste.");
    return result;
  }

  async function showLocalTestNotification(audience, notification) {
    if (Notification.permission !== "granted") return false;
    if (!("serviceWorker" in navigator)) {
      new Notification(notification.title || "Hot Sales", { body: notification.body || "" });
      return true;
    }
    const registration = await ensureServiceWorkerRegistration();
    const iconUrl = new URL("../assets/icon-192.png", location.href).href;
    await registration.showNotification(notification.title || "Hot Sales", {
      body: notification.body || "",
      icon: iconUrl,
      badge: iconUrl,
      tag: `hsbi-test-${audience}`,
      data: { url: notification.url || location.href }
    });
    return true;
  }

  async function ensureServiceWorkerRegistration() {
    let registration = await navigator.serviceWorker.getRegistration();
    if (!registration) {
      registration = await navigator.serviceWorker.register("../sw.js?v=62");
    } else {
      registration.update().catch(console.error);
    }
    await navigator.serviceWorker.ready;
    if (!registration.active) {
      await new Promise((resolve) => {
        const worker = registration.installing || registration.waiting;
        if (!worker) return resolve();
        worker.addEventListener("statechange", () => {
          if (worker.state === "activated") resolve();
        }, { once: true });
        window.setTimeout(resolve, 2500);
      });
    }
    return registration;
  }

  window.HSBIPush = { requestPermission, sync, update, test };
})();
