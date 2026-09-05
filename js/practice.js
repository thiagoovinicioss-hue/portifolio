import { t, subscribe } from './i18n/index.js';

const motionQuery = typeof window !== 'undefined' ? window.matchMedia('(prefers-reduced-motion: reduce)') : null;
const reducedMotion = Boolean(motionQuery && motionQuery.matches);

const READ_ICON =
  '<svg viewBox="0 0 18 12" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M1 6.5 4.5 10 11 3"/><path d="M7.5 6.5 11 10 17 3"/></svg>';

const CHAT_STEPS = [
  { side: 'in', key: 'pratica.wa.m1', time: '14:32', chip: 0 },
  { side: 'out', key: 'pratica.wa.m2', time: '14:32', chip: 1, typing: true },
  { side: 'in', key: 'pratica.wa.m3', time: '14:33', chip: 2 },
  { side: 'out', key: 'pratica.wa.m4', time: '14:33', chip: 3, typing: true },
  { side: 'in', key: 'pratica.wa.m5', time: '14:34' },
  { side: 'out', key: 'pratica.wa.m6', time: '14:34', chip: 4, typing: true },
];

const CHAT_DELAY_BEFORE = 700;
const CHAT_PAUSE = 1050;
const CHAT_TYPING_MS = 1000;
const CHAT_STOP_DELAY = 4400;
const CHAT_EXIT_MS = 520;

const PAGE_STEPS = ['hero', 'benefits', 'treatments', 'ctaRow'];
const PAGE_OFFSETS = { hero: 14, benefits: 20, treatments: 20, ctaRow: 26 };
const PAGE_SCROLL_MS = 1400;

function escapeHTML(str = '') {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function initPractice() {
  const root = document.getElementById('pratica');
  if (!root) return;

  const chat = root.querySelector('[data-wa-chat]');
  const typing = root.querySelector('.wa-typing');
  const chips = Array.from(root.querySelectorAll('.practice-chip'));
  const waWindow = root.querySelector('[data-wa-window]');
  const browser = root.querySelector('[data-browser]');
  const viewport = root.querySelector('[data-browser-viewport]');
  const page = root.querySelector('[data-browser-page]');
  const cursor = root.querySelector('[data-browser-cursor]');
  const popup = root.querySelector('[data-wa-popup]');
  const ctaTarget = root.querySelector('[data-bm-cta2] .bm-cta');
  const sectionRefs = {
    hero: root.querySelector('[data-bm-hero]'),
    benefits: root.querySelector('[data-bm-benefits]'),
    treatments: root.querySelector('[data-bm-treatments]'),
    ctaRow: root.querySelector('[data-bm-cta2]'),
  };
  const journeyTrack = root.querySelector('[data-journey]');
  const journeySteps = Array.from(root.querySelectorAll('.journey-step'));
  const journeyFill = root.querySelector('[data-journey-fill]');

  if (!chat || !typing || !browser || !page || !viewport || !cursor || !popup) return;

  const setWaLabel = () => waWindow.setAttribute('aria-label', t('pratica.chat.alt'));
  const setBrowserLabel = () => browser.setAttribute('aria-label', t('pratica.page.alt'));
  setWaLabel();
  setBrowserLabel();

  /* ---------- Chat ---------- */

  let chatVisible = false;
  let chatRun = 0;

  function resetChat() {
    typing.classList.remove('is-visible');
    chat.innerHTML = '';
    chat.classList.remove('is-exiting');
    chips.forEach((c) => c.classList.remove('is-active', 'is-done'));
  }

  function emitChip(act) {
    chips.forEach((c, n) => {
      c.classList.remove('is-active');
      c.classList.toggle('is-done', n < act);
      if (n === act) c.classList.add('is-active');
    });
  }

  function emitMessage(step) {
    const msg = document.createElement('div');
    msg.className = `wa-msg ${step.side}`;
    const read = step.side === 'out' ? `<span class="wa-read">${READ_ICON}</span>` : '';
    msg.innerHTML = `<span class="wa-msg-text">${escapeHTML(t(step.key))}</span><span class="wa-meta">${step.time}${read}</span>`;
    chat.appendChild(msg);
    chat.scrollTop = chat.scrollHeight;
  }

  async function renderStaticChat() {
    resetChat();
    typing.classList.remove('is-visible');
    CHAT_STEPS.forEach(emitMessage);
    chips.forEach((c) => c.classList.add('is-done'));
  }

  async function runChat() {
    const id = chatRun;
    while (chatVisible && chatRun === id) {
      resetChat();
      await wait(CHAT_DELAY_BEFORE);
      if (!chatVisible || chatRun !== id) return;

      for (let i = 0; i < CHAT_STEPS.length && chatVisible && chatRun === id; i++) {
        if (CHAT_STEPS[i].typing) {
          await wait(CHAT_PAUSE);
          typing.classList.add('is-visible');
          await wait(CHAT_TYPING_MS);
          typing.classList.remove('is-visible');
        } else {
          await wait(i === 0 ? 0 : CHAT_PAUSE);
        }
        if (!chatVisible || chatRun !== id) return;
        emitMessage(CHAT_STEPS[i]);
        if (CHAT_STEPS[i].chip !== undefined) emitChip(CHAT_STEPS[i].chip);
      }

      await wait(CHAT_STOP_DELAY);
      if (!chatVisible || chatRun !== id) return;
      chat.classList.add('is-exiting');
      await wait(CHAT_EXIT_MS);
      if (!chatVisible || chatRun !== id) return;
      chat.classList.remove('is-exiting');
    }
  }

  function startChat() {
    chatRun += 1;
    if (!chatVisible) return;
    if (reducedMotion) renderStaticChat();
    else runChat();
  }

  new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      chatVisible = entry.isIntersecting;
      if (chatVisible) startChat();
      else chatRun += 1;
    });
  }, { threshold: 0.25 }).observe(waWindow);

  /* ---------- Browser ---------- */

  let pageVisible = false;
  let pageRun = 0;
  let pageY = 0;

  function pageScrollMax() {
    return Math.max(0, page.scrollHeight - viewport.clientHeight);
  }

  function clampedTop(el, pad) {
    return Math.min(Math.max(0, el.offsetTop - pad), pageScrollMax());
  }

  async function animateScrollTo(targetY, dur) {
    const from = pageY;
    const delta = targetY - from;
    if (Math.abs(delta) < 1) return;
    const t0 = performance.now();
    await new Promise((resolve) => {
      const inner = () => {
        const elapsed = (performance.now() - t0) / dur;
        const p = Math.min(1, elapsed);
        const ease = 1 - Math.pow(1 - p, 3);
        pageY = from + delta * ease;
        page.style.transform = `translateY(${-pageY}px)`;
        if (p < 1 && pageVisible) requestAnimationFrame(inner);
        else resolve();
      };
      requestAnimationFrame(inner);
    });
  }

  async function pressCta() {
    const vpRect = viewport.getBoundingClientRect();
    const rect = ctaTarget.getBoundingClientRect();
    const cx = rect.left - vpRect.left + rect.width / 2;
    const cy = rect.top - vpRect.top + rect.height / 2;
    cursor.style.left = `${cx}px`;
    cursor.style.top = `${cy}px`;
    cursor.classList.add('is-visible');
    browser.classList.add('is-highlight');
    await wait(260);
    cursor.classList.add('is-press');
    await wait(200);
    cursor.classList.remove('is-press');

    popup.classList.add('is-visible');
    await wait(1500);
    if (!pageVisible) return;
    popup.classList.add('is-typing');
    await wait(1300);
    popup.classList.remove('is-visible', 'is-typing');
    browser.classList.remove('is-highlight');
    if (waWindow) {
      waWindow.classList.remove('is-awake');
      requestAnimationFrame(() => waWindow.classList.add('is-awake'));
      setTimeout(() => waWindow.classList.remove('is-awake'), 1900);
    }
    cursor.classList.remove('is-visible');
  }

  async function quickPopup() {
    popup.classList.add('is-visible', 'is-typing');
    await wait(2500);
    popup.classList.remove('is-visible', 'is-typing');
    if (waWindow) waWindow.classList.add('is-awake');
    setTimeout(() => waWindow && waWindow.classList.remove('is-awake'), 1900);
  }

  async function runPage() {
    const id = pageRun;
    if (reducedMotion) {
      await quickPopup();
      return;
    }
    await animateScrollTo(0, 900);
    await wait(400);
    for (let i = 0; i < PAGE_STEPS.length && pageVisible && pageRun === id; i++) {
      const key = PAGE_STEPS[i];
      await animateScrollTo(clampedTop(sectionRefs[key], PAGE_OFFSETS[key]), PAGE_SCROLL_MS);
      await wait(420);
    }
    await pressCta();
  }

  function startPage() {
    pageRun += 1;
    if (!pageVisible) return;
    runPage();
  }

  new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      pageVisible = entry.isIntersecting;
      if (pageVisible) startPage();
      else pageRun += 1;
    });
  }, { threshold: 0.28 }).observe(viewport);

  /* ---------- Journey ---------- */

  let journeyDone = false;
  const playJourney = () => {
    if (journeyDone) return;
    journeyDone = true;
    const stepCount = journeySteps.length;
    if (!stepCount) return;
    let i = 0;
    if (reducedMotion) {
      journeySteps.forEach((s) => s.classList.add('is-done'));
      if (journeyFill) journeyFill.style.width = '100%';
      return;
    }
    const timer = setInterval(() => {
      journeySteps[i].classList.add('is-done');
      if (journeyFill && stepCount > 1) {
        journeyFill.style.width = `${(i / (stepCount - 1)) * 100}%`;
      }
      i += 1;
      if (i >= stepCount) clearInterval(timer);
    }, 380);
  };

  if (journeyTrack) {
    const jio = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (entry.isIntersecting) {
          jio.unobserve(entry.target);
          playJourney();
        }
      });
    }, { threshold: 0.4 });
    jio.observe(journeyTrack);
  } else if (journeyFill && journeySteps.length) {
    playJourney();
  }

  /* ---------- Language changes ---------- */

  subscribe(() => {
    setWaLabel();
    setBrowserLabel();
    startChat();
  });
}