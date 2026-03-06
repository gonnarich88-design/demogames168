// ──────────────────────────────────────────────
// JILI Games - Game Player Logic (Reverse Proxy + iframe)
// ──────────────────────────────────────────────

(function () {
  'use strict';

  let gameData = null;
  let isPlaying = false;
  let isFullscreen = false;

  // DOM Elements
  const gameContainer = document.getElementById('gameContainer');
  const playOverlay = document.getElementById('playOverlay');
  const playThumb = document.getElementById('playThumb');
  const playBtn = document.getElementById('playBtn');
  const gameName = document.getElementById('gameName');
  const gameCategory = document.getElementById('gameCategory');
  const fullscreenBtn = document.getElementById('fullscreenBtn');
  const backBtn = document.getElementById('backBtn');
  const iframeLoader = document.getElementById('iframeLoader');

  // ──────── Init ────────
  async function init() {
    TelegramApp.init();

    TelegramApp.showBackButton(() => {
      if (isPlaying) stopGame();
      window.location.href = '/';
    });

    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('id');
    const errorFromUrl = params.get('error');
    const hintFromUrl = params.get('hint');

    if (!gameId) {
      showError('No game specified');
      return;
    }

    setupEventListeners();

    if (errorFromUrl) {
      await loadGame(gameId);
      const provider = params.get('provider');
      const retryUrl = provider ? '/play/' + provider + '/' + encodeURIComponent(gameId) : '/play/' + gameId;
      showIframeError(decodeURIComponent(errorFromUrl), hintFromUrl ? decodeURIComponent(hintFromUrl) : '', retryUrl);
      return;
    }

    await loadGame(gameId);
  }

  // ──────── Event Listeners ────────
  function setupEventListeners() {
    playBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      startGame();
    });

    playOverlay.addEventListener('click', () => {
      startGame();
    });

    fullscreenBtn.addEventListener('click', () => {
      toggleFullscreen();
    });

    backBtn.addEventListener('click', () => {
      if (isPlaying) stopGame();
      TelegramApp.hapticFeedback('light');
      window.location.href = '/';
    });

    window.addEventListener('resize', () => {
      if (isPlaying) resizeIframe();
    });
  }

  // ──────── Load Game Data ────────
  async function loadGame(gameId) {
    try {
      const res = await fetch(`/api/games/${gameId}`);
      if (!res.ok) throw new Error('Game not found');

      gameData = await res.json();

      // Update UI
      gameName.textContent = gameData.name;
      gameCategory.querySelector('span').textContent = gameData.category;
      document.title = `${gameData.name} - JILI Games`;

      // Set thumbnail
      const imgSrc = gameData.image && !gameData.image.includes('placeholder')
        ? gameData.image
        : `https://via.placeholder.com/300x300/1a1a2e/FFD700?text=${encodeURIComponent(gameData.name)}`;
      playThumb.src = imgSrc;
      playThumb.alt = gameData.name;
      playThumb.onerror = function () {
        this.src = `https://via.placeholder.com/300x300/1a1a2e/FFD700?text=${encodeURIComponent(gameData.name)}`;
      };
    } catch (err) {
      console.error('Failed to load game:', err);
      showError('Game not found');
    }
  }

  // ──────── Start Game: go to /play/:id or /play/:provider/:id so server redirects to game ────────
  function startGame() {
    if (isPlaying) return;

    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('id');
    const provider = params.get('provider');
    if (!gameId) return;

    try { TelegramApp.hapticFeedback('success'); } catch (_) {}
    // Use provider when present (PP/Joker error redirect); else /play/:id (JILI)
    const playUrl = provider ? '/play/' + provider + '/' + encodeURIComponent(gameId) : '/play/' + gameId;
    window.location.href = playUrl;
  }

  // ──────── Stop Game ────────
  function stopGame() {
    const iframe = document.getElementById('gameFrame');
    if (iframe) iframe.remove();
    isPlaying = false;
    iframeLoader.style.display = 'none';
    playOverlay.classList.remove('hidden');

    if (isFullscreen) {
      TelegramApp.exitFullscreen();
      isFullscreen = false;
    }
  }

  // ──────── Toggle Fullscreen ────────
  function toggleFullscreen() {
    if (!isFullscreen) {
      TelegramApp.requestFullscreen();
      isFullscreen = true;
      fullscreenBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M5 16h3v3h2v-5H5v2zm3-8H5v2h5V5H8v3zm6 11h2v-3h3v-2h-5v5zm2-11V5h-2v5h5V8h-3z"/>
        </svg>
        Exit Fullscreen
      `;
      TelegramApp.hapticFeedback('medium');
    } else {
      TelegramApp.exitFullscreen();
      isFullscreen = false;
      fullscreenBtn.innerHTML = `
        <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
          <path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/>
        </svg>
        Fullscreen
      `;
      TelegramApp.hapticFeedback('light');
    }
    resizeIframe();
  }

  // ──────── Resize iframe ────────
  function resizeIframe() {
    const iframe = document.getElementById('gameFrame');
    if (isFullscreen) {
      gameContainer.style.minHeight = '100vh';
      if (iframe) { iframe.style.width = '100vw'; iframe.style.height = '100vh'; }
    } else {
      gameContainer.style.minHeight = '60vh';
      if (iframe) { iframe.style.width = '100%'; iframe.style.height = '100%'; }
    }
  }

  // ──────── Show Iframe Error ────────
  function showIframeError(message, hint, retryUrl) {
    const iframe = document.getElementById('gameFrame');
    if (iframe) iframe.remove();
    isPlaying = false;

    const escape = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const title = escape(message || 'Game loading failed');
    const sub = escape(hint || 'Please try again or go back to catalog.');

    const retryLink = retryUrl
      ? '<a href="' + escape(retryUrl) + '" style="color: #FFD700; text-decoration: underline; font-size: 16px; margin-right: 16px;">ลองอีกครั้ง</a>'
      : '';
    playOverlay.classList.remove('hidden');
    playOverlay.innerHTML = `
      <div style="text-align: center; color: #fff; padding: 20px;">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <h3 style="margin-bottom: 8px;">${title}</h3>
        <p style="font-size: 14px; color: rgba(255,255,255,0.7); margin-bottom: 20px;">${sub}</p>
        ${retryLink}<a href="/" style="color: #FFD700; text-decoration: underline; font-size: 16px;">Back to Games</a>
      </div>
    `;
  }

  // ──────── Show Error ────────
  function showError(message) {
    gameName.textContent = message;
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('id');
    const provider = params.get('provider');
    const retryUrl = gameId ? (provider ? '/play/' + provider + '/' + encodeURIComponent(gameId) : '/play/' + gameId) : '';
    const retryLink = retryUrl
      ? '<a href="' + retryUrl + '" style="color: #FFD700; margin-right: 12px;">ลองอีกครั้ง</a>'
      : '';
    playOverlay.innerHTML = `
      <div style="text-align: center; color: #fff; padding: 20px;">
        <div style="font-size: 48px; margin-bottom: 16px;">😔</div>
        <h3>${message}</h3>
        <p style="font-size: 14px; color: rgba(255,255,255,0.7); margin-top: 8px;">
          ${retryLink}<a href="/" style="color: #FFD700;">Go back to catalog</a>
        </p>
      </div>
    `;
  }

  // ──────── Start ────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
