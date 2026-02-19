// ──────────────────────────────────────────────
// Co168 - Game Catalog (Multi-provider)
// ──────────────────────────────────────────────

(function () {
  'use strict';

  // Detect provider from URL path: /catalog/jili → "jili"
  const pathParts = window.location.pathname.split('/').filter(Boolean);
  const currentProvider = (pathParts[0] === 'catalog' && pathParts[1]) ? pathParts[1] : 'jili';

  // Provider config
  const PROVIDER_CONFIG = {
    jili: {
      logo: '/images/jili-logo.png',
      name: 'JILI GAMES',
      categories: [
        { key: 'all', label: 'ทั้งหมด' },
        { key: 'slot', label: 'สล็อต' },
        { key: 'fishing', label: 'ยิงปลา' },
        { key: 'tableandcard', label: 'ไพ่' },
        { key: 'bingo', label: 'บิงโก' },
        { key: 'casino', label: 'คาสิโน' }
      ]
    },
    pp: {
      logo: '/images/pragmatic-logo.png',
      name: 'Pragmatic Play',
      categories: [
        { key: 'all', label: 'ทั้งหมด' },
        { key: 'slot', label: 'สล็อต' }
      ]
    },
    pg: {
      logo: '/images/pgsoft-logo.png',
      name: 'PG Soft',
      categories: [
        { key: 'all', label: 'ทั้งหมด' },
        { key: 'slot', label: 'สล็อต' }
      ]
    }
  };

  const config = PROVIDER_CONFIG[currentProvider] || PROVIDER_CONFIG.jili;
  const providerLogoUrl = config.logo;

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
  const totalCategoriesCount = document.getElementById('totalCategoriesCount');
  const loadingSpinner = document.getElementById('loadingSpinner');
  const scrollTopBtn = document.getElementById('scrollTopBtn');

  // ──────── Init ────────
  function init() {
    TelegramApp.init();

    // Header: show provider logo
    const headerLogo = document.getElementById('headerProviderLogo');
    const headerTitle = document.getElementById('headerTitle');
    if (headerLogo && headerTitle) {
      if (config.logo) {
        headerLogo.src = config.logo;
        headerLogo.alt = config.name;
        headerLogo.style.display = '';
        headerTitle.style.display = 'none';
      } else {
        headerTitle.textContent = config.name;
        headerTitle.style.display = '';
        headerLogo.style.display = 'none';
      }
    }

    // Build category tabs dynamically
    buildCategoryTabs();

    // Update category count in stats
    if (totalCategoriesCount) {
      totalCategoriesCount.textContent = config.categories.length - 1; // exclude "all"
    }

    // Check URL params for category (from bot inline buttons)
    const params = new URLSearchParams(window.location.search);
    const catParam = params.get('cat');
    if (catParam) {
      currentCategory = catParam;
      document.querySelectorAll('.tab').forEach(t => {
        t.classList.toggle('active', t.dataset.category === catParam);
      });
    }

    setupEventListeners();
    loadGames();
  }

  // ──────── Build Category Tabs ────────
  function buildCategoryTabs() {
    categoryTabs.innerHTML = '';
    config.categories.forEach(cat => {
      const btn = document.createElement('button');
      btn.className = 'tab' + (cat.key === currentCategory ? ' active' : '');
      btn.dataset.category = cat.key;
      btn.textContent = cat.label;
      categoryTabs.appendChild(btn);
    });
  }

  // ──────── Event Listeners ────────
  function setupEventListeners() {
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

    let searchTimeout;
    searchInput.addEventListener('input', (e) => {
      clearTimeout(searchTimeout);
      searchTimeout = setTimeout(() => {
        searchTerm = e.target.value.trim();
        renderGames();
      }, 300);
    });

    categoryTabs.addEventListener('click', (e) => {
      const tab = e.target.closest('.tab');
      if (!tab) return;
      document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      currentCategory = tab.dataset.category;
      TelegramApp.hapticFeedback('light');
      renderGames();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });

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
      gameGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">😔</div><h3>โหลดไม่สำเร็จ</h3><p>กรุณาลองใหม่อีกครั้ง</p></div>';
    } finally {
      isLoading = false;
      loadingSpinner.style.display = 'none';
    }
  }

  // ──────── Render Games ────────
  function renderGames() {
    let filtered = allGames;

    if (currentCategory !== 'all') {
      filtered = filtered.filter(g => {
        const cat = g.category.toLowerCase().replace(/[\s&]+/g, '');
        return cat === currentCategory.toLowerCase().replace(/[\s&]+/g, '');
      });
    }

    if (searchTerm) {
      const term = searchTerm.toLowerCase();
      filtered = filtered.filter(g => g.name.toLowerCase().includes(term));
    }

    gameGrid.innerHTML = '';

    if (filtered.length === 0) {
      gameGrid.innerHTML = '<div class="empty-state" style="grid-column:1/-1;"><div class="empty-icon">🔍</div><h3>ไม่พบเกม</h3><p>' +
        (searchTerm ? 'ไม่พบผลลัพธ์สำหรับ "' + searchTerm + '"' : 'ไม่มีเกมในหมวดนี้') + '</p></div>';
      return;
    }

    const fragment = document.createDocumentFragment();
    filtered.forEach(game => fragment.appendChild(createGameCard(game)));
    gameGrid.appendChild(fragment);
  }

  // ──────── Create Game Card ────────
  function createGameCard(game) {
    const card = document.createElement('div');
    const hasRealImage = game.image && !game.image.includes('placeholder') && game.image.length > 0;
    card.className = 'game-card' + (hasRealImage ? '' : ' game-card--logo-placeholder');

    let imgSrc = hasRealImage ? game.image : providerLogoUrl;
    if (hasRealImage && game.image.indexOf('http') === 0 && game.image.indexOf('pragmaticplay.com') !== -1) {
      imgSrc = '/api/proxy-image?url=' + encodeURIComponent(game.image);
    }

    const safeName = game.name.replace(/"/g, '&quot;').replace(/'/g, '&#39;');

    card.innerHTML =
      '<span class="play-badge">DEMO</span>' +
      '<img class="card-img" src="' + imgSrc + '" alt="' + safeName + '" loading="lazy" ' +
        'onerror="this.src=\'' + providerLogoUrl + '\';this.onerror=null;this.parentElement.classList.add(\'game-card--logo-placeholder\');">' +
      '<div class="card-body">' +
        '<div class="game-name">' + game.name + '</div>' +
        '<div class="game-category">' + game.category + '</div>' +
      '</div>';

    card.addEventListener('click', () => {
      TelegramApp.hapticFeedback('medium');
      window.location.href = game.playUrl || ('/play/' + currentProvider + '/' + (game.slug || game.id));
    });

    return card;
  }

  // ──────── Show Skeleton Loading ────────
  function showSkeletons() {
    gameGrid.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const skeleton = document.createElement('div');
      skeleton.className = 'skeleton';
      skeleton.innerHTML = '<div class="skeleton-img"></div><div class="skeleton-text"></div>';
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
