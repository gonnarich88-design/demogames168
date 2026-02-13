// ──────────────────────────────────────────────
// Telegram Web App SDK Wrapper
// ──────────────────────────────────────────────
const tg = window.Telegram?.WebApp;

const TelegramApp = {
  isReady: false,

  init() {
    if (!tg) {
      console.warn('Not running inside Telegram. Using browser fallback mode.');
      document.body.classList.add('browser-mode');
      this.isReady = true;
      return;
    }

    // Signal ready
    tg.ready();

    // Expand to full height
    tg.expand();

    // Disable vertical swipes to prevent accidental close during scroll
    if (tg.disableVerticalSwipes) {
      tg.disableVerticalSwipes();
    }

    // Apply safe area for notched devices
    this.applySafeArea();

    // Listen for theme changes
    tg.onEvent('themeChanged', () => this.applySafeArea());

    this.isReady = true;
    console.log('Telegram WebApp initialized', {
      version: tg.version,
      platform: tg.platform,
      colorScheme: tg.colorScheme
    });
  },

  applySafeArea() {
    if (tg?.safeAreaInset) {
      document.documentElement.style.setProperty('--safe-top', (tg.safeAreaInset.top || 0) + 'px');
      document.documentElement.style.setProperty('--safe-bottom', (tg.safeAreaInset.bottom || 0) + 'px');
    }
    if (tg?.contentSafeAreaInset) {
      document.documentElement.style.setProperty('--content-safe-top', (tg.contentSafeAreaInset.top || 0) + 'px');
    }
  },

  showBackButton(callback) {
    if (tg?.BackButton) {
      tg.BackButton.show();
      tg.BackButton.onClick(callback);
    }
  },

  hideBackButton() {
    if (tg?.BackButton) {
      tg.BackButton.hide();
      tg.BackButton.offClick();
    }
  },

  requestFullscreen() {
    if (tg?.requestFullscreen) {
      tg.requestFullscreen();
    } else if (document.documentElement.requestFullscreen) {
      document.documentElement.requestFullscreen();
    }
  },

  exitFullscreen() {
    if (tg?.exitFullscreen) {
      tg.exitFullscreen();
    } else if (document.exitFullscreen) {
      document.exitFullscreen();
    }
  },

  openLink(url) {
    if (tg?.openLink) {
      tg.openLink(url);
    } else {
      window.open(url, '_blank');
    }
  },

  hapticFeedback(type) {
    if (tg?.HapticFeedback) {
      if (type === 'light') tg.HapticFeedback.impactOccurred('light');
      else if (type === 'medium') tg.HapticFeedback.impactOccurred('medium');
      else if (type === 'heavy') tg.HapticFeedback.impactOccurred('heavy');
      else if (type === 'success') tg.HapticFeedback.notificationOccurred('success');
      else if (type === 'error') tg.HapticFeedback.notificationOccurred('error');
    }
  },

  get colorScheme() {
    return tg?.colorScheme || 'light';
  },

  get userId() {
    return tg?.initDataUnsafe?.user?.id || null;
  },

  get userName() {
    const user = tg?.initDataUnsafe?.user;
    return user ? (user.first_name || '') + (user.last_name ? ' ' + user.last_name : '') : 'Player';
  }
};
