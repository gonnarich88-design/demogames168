(function () {
  'use strict';

  const providerGrid = document.getElementById('providerGrid');
  const loadingSpinner = document.getElementById('loadingSpinner');

  const PROVIDER_ICONS = {
    jili: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="2" y="4" width="20" height="16" rx="3"/><circle cx="8" cy="12" r="2"/><circle cx="16" cy="12" r="2"/><path d="M12 8v8"/></svg>',
    pp: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 22 8.5 22 15.5 12 22 2 15.5 2 8.5"/><line x1="12" y1="22" x2="12" y2="8.5"/><line x1="22" y1="8.5" x2="2" y2="8.5"/></svg>',
    pg: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 2L2 7l10 5 10-5-10-5z"/><path d="M2 17l10 5 10-5"/><path d="M2 12l10 5 10-5"/></svg>'
  };

  function init() {
    if (typeof TelegramApp !== 'undefined') TelegramApp.init();
    sendBotEventIfTelegram('open_webapp');
    loadProviders();
  }

  function sendBotEventIfTelegram(action) {
    var user = typeof Telegram !== 'undefined' && Telegram.WebApp && Telegram.WebApp.initDataUnsafe && Telegram.WebApp.initDataUnsafe.user;
    if (!user) return;
    fetch('/api/bot-event', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        telegram_user_id: user.id,
        username: user.username || null,
        first_name: user.first_name || null,
        action: action
      })
    }).catch(function () {});
  }

  async function loadProviders() {
    loadingSpinner.style.display = 'flex';
    try {
      const res = await fetch('/api/providers');
      const providers = await res.json();
      renderProviders(providers);
    } catch (err) {
      console.error('Failed to load providers:', err);
      providerGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">😔</div><h3>โหลดข้อมูลไม่สำเร็จ</h3><p>กรุณาลองใหม่อีกครั้ง</p></div>';
    } finally {
      loadingSpinner.style.display = 'none';
    }
  }

  function renderProviders(providers) {
    providerGrid.innerHTML = '';
    var fragment = document.createDocumentFragment();
    providers.forEach(function (provider) {
      fragment.appendChild(createProviderCard(provider));
    });
    providerGrid.appendChild(fragment);
  }

  function createProviderCard(provider) {
    var card = document.createElement('div');
    card.className = 'provider-card' + (provider.enabled ? '' : ' disabled');

    var iconHtml;
    if (provider.logo) {
      iconHtml = '<div class="provider-card-icon">' +
        '<img src="' + provider.logo + '" alt="' + provider.name + '" class="provider-card-logo">' +
        '</div>';
    } else {
      var fallbackSvg = PROVIDER_ICONS[provider.slug] || PROVIDER_ICONS.jili;
      iconHtml = '<div class="provider-card-icon"><span style="color:#FFD700;">' + fallbackSvg + '</span></div>';
    }

    card.innerHTML =
      iconHtml +
      '<div class="provider-card-body">' +
        '<div class="provider-card-name">' + provider.name + '</div>' +
        '<div class="provider-card-desc">' + provider.description + '</div>' +
        (provider.enabled
          ? '<div class="provider-card-count">' + (provider.gameCount || 0) + ' เกม</div>'
          : '<div class="provider-card-badge">เร็วๆ นี้</div>') +
      '</div>' +
      '<div class="provider-card-arrow">' +
        (provider.enabled
          ? '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8.59 16.59L13.17 12 8.59 7.41 10 6l6 6-6 6z"/></svg>'
          : '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2zM12 17c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1s3.1 1.39 3.1 3.1v2z"/></svg>') +
      '</div>';

    if (provider.enabled) {
      card.addEventListener('click', function () {
        if (typeof TelegramApp !== 'undefined') TelegramApp.hapticFeedback('medium');
        window.location.href = '/catalog/' + provider.slug;
      });
    } else {
      card.addEventListener('click', function () {
        if (typeof TelegramApp !== 'undefined') TelegramApp.hapticFeedback('error');
      });
    }

    return card;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
