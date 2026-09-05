import { CONFIG } from './config.js';
import { init as initI18n, setLang, getLang, t } from './i18n/index.js';
import { initTheme } from './theme.js';
import { initCarousel } from './carousel.js';
import { initQuote } from './quote.js';
import { initAdmin } from './admin.js';
import { initCalculator } from './calculator.js';
import { initPractice } from './practice.js';

const views = {};
let homeScrollY = 0;

function hideOthers(except) {
  Object.entries(views).forEach(([key, el]) => {
    const show = key === except;
    const targetHidden = !show;
    if (el.hidden === targetHidden) return;
    el.hidden = targetHidden;
    if (show) {
      el.classList.add('view-enter');
      requestAnimationFrame(() => requestAnimationFrame(() => el.classList.remove('view-enter')));
    }
  });
}

function showView(name) {
  if (name === 'orcamento') name = 'quote';
  if (name === 'home') {
    hideOthers('home');
    document.querySelector('.site-header').classList.add('is-home');
    window.scrollTo(0, homeScrollY);
    initReveal();
    initNavSpy();
  } else if (name === 'quote') {
    homeScrollY = window.scrollY;
    hideOthers('quote');
    document.querySelector('.site-header').classList.remove('is-home');
    window.scrollTo(0, 0);
  } else if (name === 'admin') {
    homeScrollY = window.scrollY;
    hideOthers('admin');
    document.querySelector('.site-header').classList.remove('is-home');
    window.scrollTo(0, 0);
    admin?.show();
  }
  closeMenu();
}

function parseHash() {
  const h = location.hash || '#/';
  if (h.startsWith('#/')) {
    const name = h.slice(2).replace(/\/+$/, '');
    return { type: 'route', name: name || 'home' };
  }
  return { type: 'anchor', id: h.slice(1) };
}

function navigate() {
  const { type, name, id } = parseHash();
  if (type === 'route') {
    showView(name);
    return;
  }
  // anchor scroll within home
  showView('home');
  if (id && document.getElementById(id)) {
    requestAnimationFrame(() => {
      document.getElementById(id).scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth', block: 'start' });
    });
  }
}

// ----- Nav & header -----
function initHeader() {
  const header = document.querySelector('.site-header');
  const onScroll = () => header.classList.toggle('is-scrolled', window.scrollY > 10);
  window.addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  const toggle = document.querySelector('#menuToggle');
  const nav = document.querySelector('#mainNav');
  toggle.addEventListener('click', () => {
    const open = nav.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', String(open));
  });
}

function closeMenu() {
  const nav = document.querySelector('#mainNav');
  const toggle = document.querySelector('#menuToggle');
  if (nav) nav.classList.remove('is-open');
  if (toggle) toggle.setAttribute('aria-expanded', 'false');
}

// ----- Reveal on scroll -----
let revealObserver = null;
let revealArmed = false;
function revealAll() {
  document.querySelectorAll('.reveal').forEach((el) => el.classList.add('revealed'));
}
function initReveal() {
  if (!revealObserver && !('IntersectionObserver' in window)) {
    revealAll();
    return;
  }
  if (!revealObserver) {
    try {
      revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (entry.isIntersecting) {
            entry.target.classList.add('revealed');
            revealObserver.unobserve(entry.target);
          }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
      revealArmed = true;
    } catch (_) {
      // IntersectionObserver unavailable or failed to construct — show content.
      revealAll();
      return;
    }
  }
  document.querySelectorAll('.reveal:not(.revealed)').forEach((el) => revealObserver.observe(el));
}

let navSpyObserver = null;
function initNavSpy() {
  if (!('IntersectionObserver' in window)) return;
  navSpyObserver = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      document.querySelectorAll('.main-nav a[data-scroll]').forEach((link) => {
        link.classList.toggle('is-active', link.dataset.scroll === entry.target.id);
      });
    });
  }, { rootMargin: '-40% 0px -55% 0px' });
  ['inicio', 'sobre', 'dores', 'projetos', 'servicos', 'resultados', 'calculadora', 'contato'].forEach((id) => {
    const el = document.getElementById(id);
    if (el) navSpyObserver.observe(el);
  });
}

// ----- Social links from config -----
function wireSocial() {
  const map = { linkedin: '#socialLinkedin', instagram: '#socialInstagram', github: '#socialGithub' };
  Object.entries(map).forEach(([key, sel]) => {
    const el = document.querySelector(sel);
    if (el) el.href = CONFIG.social[key];
  });
  document.querySelector('#socialWhatsapp').href = `https://wa.me/${CONFIG.whatsapp.number}`;
}

let quote, admin;

function initRouter() {
  window.addEventListener('hashchange', navigate);
}

function boot() {
  views.home = document.querySelector('[data-view="home"]');
  views.quote = document.querySelector('[data-view="quote"]');
  views.admin = document.querySelector('[data-view="admin"]');

  document.querySelector('#year').textContent = new Date().getFullYear();

  initI18n();
  initTheme();
  wireSocial();
  initHeader();
  initRouter();

  // Feature modules are discretionary enhancements. If one fails to
  // initialize, log it but never let it blank the page or block the
  // reveal/calculator startup below.
  try {
    initCarousel();
    quote = initQuote();
    admin = initAdmin();
    initCalculator();
    initPractice();
    window.__admin = admin;
  } catch (err) {
    console.error('[init] module failed to initialize:', err);
  }

  // Language buttons use i18n.setLang
  document.querySelectorAll('.lang-btn').forEach((btn) => {
    btn.addEventListener('click', () => setLang(btn.dataset.lang));
  });

  // Smooth scroll for same-view section links
  document.querySelectorAll('a[data-scroll]').forEach((a) => {
    a.addEventListener('click', () => {
      closeMenu();
      // defer to router (hash change)
    });
  });

  navigate();
  initReveal();
  initNavSpy();
  window.addEventListener('load', initReveal);
  // Fail-safe: if reveal could not be armed by load+3s (a module threw
  // before initReveal, or the observer could not be constructed), show
  // every section anyway so the page is never blank.
  window.setTimeout(() => {
    if (!revealArmed && document.querySelector('.reveal:not(.revealed)')) revealAll();
  }, 3000);
}

// Ensure no full-reflow FOUC for languages other than default
document.documentElement.classList.add('js');
boot();