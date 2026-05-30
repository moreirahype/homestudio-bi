window.HOMESTUDIO_BI_CONFIG = {
  apiUrl: 'https://script.google.com/macros/s/AKfycbxjAbvydrxB6I2et5e6FxuZuy6jzawlvcCnRXtDqPNYmzaSfKXQ5t5bWSoowrg4yVYnrg/exec',
  defaultPeriod: 'today',
  currency: 'BRL'
};

if (!window.HOMESTUDIO_BI_SITE_PATCH_REQUESTED) {
  window.HOMESTUDIO_BI_SITE_PATCH_REQUESTED = true;
  const patch = document.createElement('script');
  patch.src = 'site-patch.js?v=16';
  patch.defer = true;
  document.head.appendChild(patch);
}
