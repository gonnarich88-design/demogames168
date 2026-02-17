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
  function init() {
    TelegramApp.init();

    // Setup Telegram back button
    TelegramApp.showBackButton(() => {
      if (isPlaying) stopGame();
      window.location.href = '/';
    });

    // Get game ID from URL
    const params = new URLSearchParams(window.location.search);
    const gameId = params.get('id');

    if (!gameId) {
      showError('No game specified');
      return;
    }

    loadGame(gameId);
    setupEventListeners();
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

  // ──────── Start Game (resolve URL server-side, then navigate directly) ────────
  async function startGame() {
    if (!gameData || isPlaying) return;

    TelegramApp.hapticFeedback('success');
    isPlaying = true;

    // Show loader, hide overlay
    iframeLoader.style.display = 'flex';
    playOverlay.classList.add('hidden');

    try {
      // Resolve the game URL server-side (follows redirect chain)
      const gameId = new URLSearchParams(window.location.search).get('id');
      console.log('Resolving game URL for:', gameId);

      const resp = await fetch(`/api/game-url/${gameId}`);
      if (!resp.ok) {
        let errorMsg = '';
        let hintMsg = '';
        try {
          const errBody = await resp.json();
          if (errBody.error) errorMsg = errBody.error;
          if (errBody.hint) hintMsg = errBody.hint;
        } catch (_) {}
        if (!errorMsg) errorMsg = 'Failed to resolve game URL, status: ' + resp.status;
        isPlaying = false;
        iframeLoader.style.display = 'none';
        showIframeError(errorMsg, hintMsg);
        return;
      }

      const data = await resp.json();
      console.log('Resolved game URL:', data.url);

      if (!data.url) {
        isPlaying = false;
        iframeLoader.style.display = 'none';
        showIframeError('Empty game URL returned');
        return;
      }

      // Navigate directly to the game page (avoid iframe restrictions in Telegram WebView)
      // User can use Telegram's Back button to return to game detail page
      window.location.href = data.url;

    } catch (err) {
      console.error('Failed to start game:', err);
      isPlaying = false;
      iframeLoader.style.display = 'none';
      showIframeError(err.message || 'Game loading failed');
    }
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
    if (isFullscreen) {
      gameContainer.style.minHeight = '100vh';
    } else {
      gameContainer.style.minHeight = '60vh';
    }
  }

  // ──────── Show Iframe Error ────────
  function showIframeError(message, hint) {
    const iframe = document.getElementById('gameFrame');
    if (iframe) iframe.remove();
    isPlaying = false;

    const escape = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const title = escape(message || 'Game loading failed');
    const sub = escape(hint || 'Please try again or go back to catalog.');

    playOverlay.classList.remove('hidden');
    playOverlay.innerHTML = `
      <div style="text-align: center; color: #fff; padding: 20px;">
        <div style="font-size: 48px; margin-bottom: 16px;">⚠️</div>
        <h3 style="margin-bottom: 8px;">${title}</h3>
        <p style="font-size: 14px; color: rgba(255,255,255,0.7); margin-bottom: 20px;">${sub}</p>
        <a href="/" style="color: #FFD700; text-decoration: underline; font-size: 16px;">Back to Games</a>
      </div>
    `;
  }

  // ──────── Show Error ────────
  function showError(message) {
    gameName.textContent = message;
    playOverlay.innerHTML = `
      <div style="text-align: center; color: #fff; padding: 20px;">
        <div style="font-size: 48px; margin-bottom: 16px;">😔</div>
        <h3>${message}</h3>
        <p style="font-size: 14px; color: rgba(255,255,255,0.7); margin-top: 8px;">
          <a href="/" style="color: #FFD700;">Go back to catalog</a>
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
