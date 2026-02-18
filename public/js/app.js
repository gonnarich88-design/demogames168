// ──────────────────────────────────────────────
// JILI Games - Catalog App Logic
// ──────────────────────────────────────────────

(function () {
  'use strict';

  // Detect provider from URL path: /catalog/jili → "jili"
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const currentProvider = (pathParts[0] === 'catalog' && pathParts[1]) ? pathParts[1] : 'jili';

  // Provider logo paths (match data/providers.json) — used when game has no image
  const PROVIDER_LOGO = {
    jili: '/images/jili-logo.png',
    pp: '/images/pragmatic-logo.png',
    pg: '/images/pgsoft-logo.png'
  };
  const providerLogoUrl = PROVIDER_LOGO[currentProvider] || PROVIDER_LOGO.jili;

  // State
  let allGames = [];
  let currentCategory = 'all';
  let searchTerm = '';
  let isLoading = false;

  // DOM Elements
  const gameGrid = document.getElementById('gameGrid');
  const searchToggle = document.getElementById('searchToggle');
  const searchBar = document.getElementById('searchBar');
  const searchInput = document.getElementById('searchInput');
  const categoryTabs = document.getElementById('categoryTabs');
  const totalGamesCount = document.getElementById('totalGamesCount');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const scrollTopBtn = document.getElementById('scrollTopBtn');

  // ──────── Init ────────
  function init() {
    TelegramApp.init();

    // Check URL params for category (from bot inline buttons)
    const params = new URLSearchParams(window.location.search);
    const catParam = params.get('cat');
    if (catParam) {
      currentCategory = catParam;
      // Update active tab
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.category === catParam);
      });
    }

    setupEventListeners();
    loadGames();
  }

  // ──────── Event Listeners ────────
  function setupEventListeners() {
    // Search toggle
    searchToggle.addEventListener('click', () => {
      searchBar.classList.toggle('visible');
      if (searchBar.classList.contains('visible')) {
        searchInput.focus();
        TelegramApp.hapticFeedback('light');
      } else {
        searchInput.value = '';
        searchTerm = '';
        renderGames();
      }
    });

    // Search input (debounced)
    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchTerm = e.target.value.trim();
        renderGames();
      }, 300);
    });

    // Category tabs
    categoryTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;

      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentCategory = tab.dataset.category;
      TelegramApp.hapticFeedback('light');
      renderGames();

      // Scroll grid to top
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

    // Scroll to top button
    window.addEventListener('scroll', () => {
      scrollTopBtn.classList.toggle('visible', window.scrollY > 400);
    });

    scrollTopBtn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
      TelegramApp.hapticFeedback('light');
    });
  }

  // ──────── Load Games from API ────────
  async function loadGames() {
    if (isLoading) return;
    isLoading = true;
    showSkeletons();

    try {
      const res = await fetch('/api/providers/' + currentProvider + '/games?limit=500');
      const data = await res.json();
      allGames = data.games || [];
      totalGamesCount.textContent = allGames.length;
      renderGames();
    } catch (err) {
      console.error('Failed to load games:', err);
      gameGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <div class="empty-icon">😔</div>
          <h3>Failed to load games</h3>
          <p>Please check your connection and try again.</p>
        </div>
      `;
    } finally {
      isLoading = false;
      loadingSpinner.style.display = 'none';
    }
  }

  // ──────── Render Games ────────
  function renderGames() {
    let filtered = allGames;

    // Filter by category
    if (currentCategory !== 'all') {
      filtered = filtered.filter(g => {
        const cat = g.category.toLowerCase().replace(/[\s&]+/g, '');
        return cat === currentCategory.toLowerCase().replace(/[\s&]+/g, '');
      });
    }

    // Filter by search
    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(g => g.name.toLowerCase().includes(term));
    }

    // Clear grid
    gameGrid.innerHTML = '';

    if (filtered.length === 0) {
      gameGrid.innerHTML = `
        <div class="empty-state" style="grid-column: 1/-1;">
          <div class="empty-icon">🔍</div>
          <h3>No games found</h3>
          <p>${searchTerm ? `No results for "${searchTerm}"` : 'No games in this category.'}</p>
        </div>
      `;
      return;
    }

    // Create cards
    const fragment = document.createDocumentFragment();
    filtered.forEach(game => {
      fragment.appendChild(createGameCard(game));
    });
    gameGrid.appendChild(fragment);
  }

  // ──────── Create Game Card ────────
  // Fallback image when no URL or placeholder: SVG data URI (works without external requests, e.g. in WebView)
  function gamePlaceholderDataUri(name) {
    const s = String(name).trim();
    const maxLen = 14;
    let line1, line2;
    const parts = s.split(/\s+/).filter(Boolean);
    if (parts.length >= 2) {
      const mid = Math.ceil(parts.length / 2);
      line1 = parts.slice(0, mid).join(' ');
      line2 = parts.slice(mid).join(' ');
    } else {
      const n = s.length;
      const half = Math.ceil(n / 2);
      line1 = s.slice(0, half);
      line2 = s.slice(half);
    }
    if (line1.length > maxLen) line1 = line1.slice(0, maxLen);
    if (line2.length > maxLen) line2 = line2.slice(0, maxLen);
    function esc(t) {
      return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    }
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300">' +
      '<defs>' +
      '<linearGradient id="bg" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#1a1a2e"/><stop offset="50%" stop-color="#252542"/><stop offset="100%" stop-color="#1a1a2e"/></linearGradient>' +
      '<linearGradient id="gold" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stop-color="#FFD700"/><stop offset="100%" stop-color="#FFA500"/></linearGradient>' +
      '<filter id="sh" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="1" stdDeviation="1.5" flood-color="#000" flood-opacity="0.5"/></filter>' +
      '</defs>' +
      '<rect width="300" height="300" fill="url(#bg)"/>' +
      '<rect x="1" y="1" width="298" height="298" fill="none" stroke="rgba(255,215,0,0.25)" stroke-width="1" rx="8"/>' +
      '<text x="150" y="142" text-anchor="middle" fill="url(#gold)" font-family="system-ui,sans-serif" font-size="17" font-weight="600" filter="url(#sh)">' + esc(line1) + '</text>' +
      '<text x="150" y="165" text-anchor="middle" fill="url(#gold)" font-family="system-ui,sans-serif" font-size="17" font-weight="600" filter="url(#sh)">' + esc(line2) + '</text>' +
      '</svg>';
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
  }

  function createGameCard(game) {
    const card = document.createElement('div');
    card.className = 'game-card';

    const hasRealImage = game.image && !game.image.includes('placeholder');
    const imgSrc = hasRealImage ? game.image : providerLogoUrl;
    const fallbackSrc = gamePlaceholderDataUri(game.name);

    card.innerHTML = `
      <span class="play-badge">DEMO</span>
      <img class="card-img"
           src="${imgSrc}"
           alt="${game.name.replace(/"/g, '&quot;')}"
           loading="lazy"
           onerror="this.src=this.dataset.fallback;this.onerror=null;"
           data-fallback="${fallbackSrc}">
      <div class="card-body">
        <div class="game-name">${game.name}</div>
        <div class="game-category">${game.category}</div>
      </div>
    `;

    card.addEventListener('click', () => {
      TelegramApp.hapticFeedback('medium');
      window.location.href = '/play/' + currentProvider + '/' + game.id;
    });

    return card;
  }

  // ──────── Show Skeleton Loading ────────
  function showSkeletons() {
    gameGrid.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'skeleton';
      skeleton.innerHTML = `
        <div class="skeleton-img"></div>
        <div class="skeleton-text"></div>
      `;
      gameGrid.appendChild(skeleton);
    }
  }

  // ──────── Start ────────
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
