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

const PAGE_STEPS = ['hero', 'benefits', 'treatments', 'ctaRow'];
const PAGE_OFFSETS = { hero: 14, benefits: 20, treatments: 20, ctaRow: 26 };
const PAGE_SCROLL_MS = 1400;

const STATUS_KEYS = {
  novo: 'pratica.leads.status.novo',
  contato: 'pratica.leads.status.contato',
  negocio: 'pratica.leads.status.negocio',
  fechado: 'pratica.leads.status.fechado',
  perdido: 'pratica.leads.status.perdido',
};

const LEAD_ROWS = [
  { id: 'r1', avatar: 'MC', name: 'pratica.leads.r1.n', interest: 'pratica.leads.r1.i', source: 'pratica.leads.r1.o', time: 'pratica.leads.r1.u', status: 'novo' },
  { id: 'r2', avatar: 'CR', name: 'pratica.leads.r2.n', interest: 'pratica.leads.r2.i', source: 'pratica.leads.r2.o', time: 'pratica.leads.r2.u', status: 'contato' },
  { id: 'r3', avatar: 'JM', name: 'pratica.leads.r3.n', interest: 'pratica.leads.r3.i', source: 'pratica.leads.r3.o', time: 'pratica.leads.r3.u', status: 'negocio' },
  { id: 'r4', avatar: 'FL', name: 'pratica.leads.r4.n', interest: 'pratica.leads.r4.i', source: 'pratica.leads.r4.o', time: 'pratica.leads.r4.u', status: 'fechado' },
];

const INCOMING = {
  id: 'r5', avatar: 'AO', name: 'pratica.leads.r5.n', interest: 'pratica.leads.r5.i', source: 'pratica.leads.r5.o', time: 'pratica.leads.r5.u', status: 'novo', notes: 'pratica.leads.detail.notes',
};

const BASE_COUNTS = { novo: 8, negocio: 5, fechado: 3 };

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

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

const statusLabel = (status) => t(STATUS_KEYS[status] || STATUS_KEYS.novo);

/* ---------- Shared demo cursor ----------
   A classic mouse arrow, reused by both demos. The tip of the SVG sits at
   (·2px, ·2px), so each host sets `--mx`/`--my` and the shape is nudged via
   margin + transform-origin. Movement follows a bezier arc with a natural
   ease so gestures read like a real hand. */
const CURSOR_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 2 20 17 13.5 18.5 16.5 23 11.7 23.8 8.9 18.4 2 21.5Z"/></svg>';

function createCursor(container) {
  const el = document.createElement('span');
  el.className = 'mouse-cursor';
  el.innerHTML = CURSOR_ICON;
  container.appendChild(el);

  let animId = 0;
  const setXY = (x, y) => {
    el.style.setProperty('--mx', `${x}px`);
    el.style.setProperty('--my', `${y}px`);
  };

  return {
    host: container,
    el,
    show() { el.classList.add('is-visible'); },
    hide() { animId += 1; el.classList.remove('is-visible', 'is-press'); },
    place(x, y) {
      if (reducedMotion) return;
      animId += 1;
      setXY(x, y);
    },
    moveTo(toX, toY, opts = {}) {
      if (reducedMotion) return Promise.resolve();
      const id = ++animId;
      const fromX = parseFloat(el.style.getPropertyValue('--mx')) || 0;
      const fromY = parseFloat(el.style.getPropertyValue('--my')) || 0;
      const dist = Math.max(1, Math.hypot(toX - fromX, toY - fromY));
      const dur = opts.duration || clamp(Math.round(dist * 1.15), 380, 880);
      const bend = opts.bend !== undefined ? opts.bend : Math.min(30, dist * 0.12);
      const mx = (fromX + toX) / 2;
      const my = (fromY + toY) / 2;
      const nx = -(toY - fromY) / dist;
      const ny = (toX - fromX) / dist;
      const side = opts.arc || 1;
      const ctrl = { x: mx + nx * bend * side, y: my + ny * bend * side };
      return new Promise((resolve) => {
        const t0 = performance.now();
        const tick = () => {
          if (id !== animId) { resolve(); return; }
          const p = Math.min(1, (performance.now() - t0) / dur);
          const ease = 1 - Math.pow(1 - p, 3);
          const q = 1 - ease;
          setXY(
            q * q * fromX + 2 * q * ease * ctrl.x + ease * ease * toX,
            q * q * fromY + 2 * q * ease * ctrl.y + ease * ease * toY,
          );
          if (p < 1) requestAnimationFrame(tick);
          else resolve();
        };
        requestAnimationFrame(tick);
      });
    },
    press(hold = 150) {
      if (reducedMotion) return Promise.resolve();
      const id = ++animId;
      el.classList.add('is-press');
      return new Promise((resolve) => {
        setTimeout(() => {
          if (id === animId) el.classList.remove('is-press');
          resolve();
        }, hold);
      });
    },
  };
}

function cursorAt(cursor, el) {
  const r = el.getBoundingClientRect();
  const c = cursor.host.getBoundingClientRect();
  return { x: r.left - c.left + r.width / 2, y: r.top - c.top + r.height / 2 };
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

  const panel = root.querySelector('[data-leads-panel]');
  const rowsEl = root.querySelector('[data-leads-rows]');
  const detail = root.querySelector('[data-leads-detail]');
  const detailName = root.querySelector('[data-leads-detail-name]');
  const detailMeta = root.querySelector('[data-leads-detail-meta]');
  const detailInterest = root.querySelector('[data-leads-detail-interest]');
  const detailSource = root.querySelector('[data-leads-detail-source]');
  const detailTime = root.querySelector('[data-leads-detail-time]');
  const detailNotes = root.querySelector('[data-leads-detail-notes]');
  const detailBadge = root.querySelector('[data-leads-detail-status]');
  const closeBtn = root.querySelector('[data-leads-close]');
  const toast = root.querySelector('[data-leads-toast]');
  const filterBtn = root.querySelector('[data-leads-filter]');
  const filterDd = root.querySelector('[data-leads-filter-dd]');
  const statusDd = root.querySelector('[data-leads-dd]');

  if (!chat || !typing || !browser || !page || !viewport || !popup || !panel || !rowsEl) return;

  const browserCursor = createCursor(viewport);
  const leadsCursor = createCursor(panel);

  const setWaLabel = () => waWindow.setAttribute('aria-label', t('pratica.chat.alt'));
  const setBrowserLabel = () => browser.setAttribute('aria-label', t('pratica.page.alt'));
  const setLeadsLabel = () => panel.setAttribute('aria-label', t('pratica.leads.alt'));
  setWaLabel();
  setBrowserLabel();
  setLeadsLabel();

  /* ---------- Chat ---------- */

  let chatVisible = false;
  let chatRun = 0;

  function resetChat() {
    typing.classList.remove('is-visible');
    chat.innerHTML = '';
    chat.scrollTop = 0;
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
  }

  /* Animated reveal of the newest message: previous messages glide up
     smoothly inside the fixed-size viewport. No scrollbar is shown. */
  function smoothScrollChat(alive) {
    return new Promise((resolve) => {
      if (reducedMotion) {
        chat.scrollTop = chat.scrollHeight;
        resolve();
        return;
      }
      requestAnimationFrame(() => requestAnimationFrame(() => {
        const target = chat.scrollHeight;
        const from = chat.scrollTop;
        const delta = target - from;
        if (Math.abs(delta) < 1) { resolve(); return; }
        const t0 = performance.now();
        const dur = 380;
        const step = () => {
          if (alive && !alive()) { resolve(); return; }
          const p = Math.min(1, (performance.now() - t0) / dur);
          const ease = 1 - Math.pow(1 - p, 3);
          chat.scrollTop = from + delta * ease;
          if (p < 1) requestAnimationFrame(step);
          else resolve();
        };
        requestAnimationFrame(step);
      }));
    });
  }

  async function renderStaticChat() {
    resetChat();
    typing.classList.remove('is-visible');
    CHAT_STEPS.forEach(emitMessage);
    chat.scrollTop = chat.scrollHeight;
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
        await smoothScrollChat(() => chatVisible && chatRun === id);
        if (CHAT_STEPS[i].chip !== undefined) emitChip(CHAT_STEPS[i].chip);
      }

      await wait(CHAT_STOP_DELAY);
      if (!chatVisible || chatRun !== id) return;
      // Elegant reset: fade the whole messages viewport, clear it while
      // hidden, then let the next cycle re-fade in. Window size never changes.
      chat.classList.add('is-exiting');
      await wait(reducedMotion ? 10 : 300);
      if (!chatVisible || chatRun !== id) return;
      resetChat();
      await wait(reducedMotion ? 10 : 240);
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

  /* The mouse arrow glides in from the corner, stops near, then on the
     CTA, presses it and hands the visitor over to the WhatsApp popup. */
  async function pressCta() {
    if (reducedMotion) return;
    const vpRect = viewport.getBoundingClientRect();
    const r = ctaTarget.getBoundingClientRect();
    const cx = clamp(r.left - vpRect.left + r.width / 2, 12, vpRect.width - 12);
    const cy = clamp(r.top - vpRect.top + r.height / 2, 12, vpRect.height - 12);
    const startX = Math.min(26, vpRect.width - 26);
    const startY = vpRect.height - 26;

    browserCursor.show();
    browserCursor.place(startX, startY);
    await wait(240);
    if (!pageVisible) return;
    await browserCursor.moveTo(cx - 120, cy + 110);
    await wait(140);
    if (!pageVisible) return;
    await browserCursor.moveTo(cx, cy);
    await wait(140);
    if (!pageVisible) return;
    ctaTarget.classList.add('is-hover');
    await wait(380);
    if (!pageVisible) return;
    await browserCursor.press(130);
    ctaTarget.classList.add('is-clicked');

    popup.classList.add('is-visible');
    await wait(1500);
    if (!pageVisible) return;
    popup.classList.add('is-typing');
    await wait(1100);
    popup.classList.remove('is-visible', 'is-typing');
    ctaTarget.classList.remove('is-hover', 'is-clicked');
    if (waWindow) {
      waWindow.classList.remove('is-awake');
      requestAnimationFrame(() => waWindow.classList.add('is-awake'));
      setTimeout(() => waWindow.classList.remove('is-awake'), 1900);
    }
    browserCursor.hide();
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

  /* ---------- Leads panel ---------- */

  let leadsVisible = false;
  let leadsRun = 0;

  function buildRow(item, opts = {}) {
    const row = document.createElement('div');
    row.className = `leads-row${opts.incoming ? ' is-incoming' : ''}`;
    row.dataset.lead = item.id;
    row.innerHTML =
      `<span class="leads-avatar">${escapeHTML(item.avatar)}</span>` +
      `<span class="leads-id">` +
        `<span class="leads-name">${escapeHTML(t(item.name))}</span>` +
        `<span class="leads-meta">${escapeHTML(t(item.source))} · ${escapeHTML(t(item.time))}</span>` +
      `</span>` +
      `<span class="leads-interest">${escapeHTML(t(item.interest))}</span>` +
      `<span class="leads-badge is-${item.status}">${escapeHTML(statusLabel(item.status))}</span>`;
    return row;
  }

  function renderList(items) {
    const frag = document.createDocumentFragment();
    items.forEach((item) => frag.appendChild(buildRow(item)));
    rowsEl.replaceChildren(frag);
  }

  function fillDetail(item) {
    detailName.textContent = t(item.name);
    detailMeta.textContent = `${t(item.source)} · ${t(item.time)}`;
    detailInterest.textContent = t(item.interest);
    detailSource.textContent = t(item.source);
    detailTime.textContent = t(item.time);
    detailNotes.textContent = t(item.notes);
    setDetailBadge(item.status);
  }

  function setDetailBadge(status) {
    detailBadge.className = `leads-badge is-${status}`;
    detailBadge.textContent = statusLabel(status);
  }

  function setNum(key, value, pop = true) {
    const el = panel.querySelector(`[data-leads-num="${key}"]`);
    if (!el) return;
    if (pop && !reducedMotion) {
      el.classList.remove('is-pop');
      void el.offsetWidth;
      el.classList.add('is-pop');
    }
    el.textContent = value;
  }

  function applyCounts(counts, pop = true) {
    Object.keys(counts).forEach((key) => setNum(key, counts[key], pop));
  }

  function closeDds() {
    statusDd.classList.remove('is-open', 'is-up');
    filterDd.classList.remove('is-open');
    filterBtn.classList.remove('is-open');
  }

  function resetLeadsState() {
    INCOMING.status = 'novo';
    closeDds();
    filterBtn.classList.remove('is-active');
    detail.classList.remove('is-open');
    toast.classList.remove('is-show');
    applyCounts(BASE_COUNTS, false);
    renderList(LEAD_ROWS);
    fillDetail(INCOMING);
    leadsCursor.hide();
  }

  async function renderStaticLeads() {
    resetLeadsState();
    rowsEl.prepend(buildRow(INCOMING));
    setNum('novo', BASE_COUNTS.novo + 1, false);
  }

  async function runLeads() {
    const id = leadsRun;
    const dead = () => !leadsVisible || leadsRun !== id;

    while (leadsVisible && leadsRun === id) {
      panel.classList.remove('is-exiting');
      resetLeadsState();
      await wait(reducedMotion ? 10 : 160);
      if (dead()) return;

      // A new lead arrives
      toast.classList.add('is-show');
      await wait(700);
      if (dead()) return;

      const incomingRow = buildRow(INCOMING, { incoming: true });
      rowsEl.prepend(incomingRow);
      setNum('novo', BASE_COUNTS.novo + 1);
      toast.classList.remove('is-show');
      await wait(620);
      if (dead()) return;

      // The mouse arrow comes in and opens the lead
      const pr = panel.getBoundingClientRect();
      leadsCursor.show();
      leadsCursor.place(pr.width - 22, pr.height - 18);
      await wait(280);
      if (dead()) return;

      const rowPoint = cursorAt(leadsCursor, incomingRow);
      await leadsCursor.moveTo(rowPoint.x - 8, rowPoint.y + 8);
      await wait(220);
      if (dead()) return;

      incomingRow.classList.add('is-hover');
      await wait(420);
      if (dead()) return;
      await leadsCursor.press(120);
      incomingRow.classList.remove('is-hover');

      detail.classList.add('is-open');
      fillDetail(INCOMING);
      await wait(560);
      if (dead()) return;

      // Move the lead forward: change status to "Em contato"
      await leadsCursor.moveTo(cursorAt(leadsCursor, detailBadge).x + 14, cursorAt(leadsCursor, detailBadge).y);
      await wait(240);
      if (dead()) return;
      await leadsCursor.press(120);
      statusDd.classList.add('is-up', 'is-open');
      await wait(320);
      if (dead()) return;

      const contatoOpt = statusDd.querySelector('[data-leads-status-option="contato"]');
      await leadsCursor.moveTo(cursorAt(leadsCursor, contatoOpt).x + 20, cursorAt(leadsCursor, contatoOpt).y);
      await wait(180);
      if (dead()) return;
      await leadsCursor.press(120);

      statusDd.classList.remove('is-open');
      INCOMING.status = 'contato';
      setDetailBadge(INCOMING.status);
      const rowBadge = incomingRow.querySelector('.leads-badge');
      rowBadge.className = `leads-badge is-${INCOMING.status}`;
      rowBadge.textContent = statusLabel(INCOMING.status);
      applyCounts(BASE_COUNTS);
      await wait(460);
      if (dead()) return;

      // Close the detail
      await leadsCursor.moveTo(cursorAt(leadsCursor, closeBtn).x + 8, cursorAt(leadsCursor, closeBtn).y);
      await wait(200);
      if (dead()) return;
      await leadsCursor.press(120);
      detail.classList.remove('is-open');
      await wait(580);
      if (dead()) return;

      // Filter the list to show the organized stage
      await leadsCursor.moveTo(cursorAt(leadsCursor, filterBtn).x + 8, cursorAt(leadsCursor, filterBtn).y);
      await wait(200);
      if (dead()) return;
      await leadsCursor.press(120);
      filterBtn.classList.add('is-open');
      filterDd.classList.add('is-open');
      await wait(320);
      if (dead()) return;

      const contatoFilter = filterDd.querySelector('[data-leads-filter-option="contato"]');
      await leadsCursor.moveTo(cursorAt(leadsCursor, contatoFilter).x + 18, cursorAt(leadsCursor, contatoFilter).y);
      await wait(180);
      if (dead()) return;
      await leadsCursor.press(120);

      filterDd.classList.remove('is-open');
      filterBtn.classList.remove('is-open');
      filterBtn.classList.add('is-active');
      renderList(LEAD_ROWS.filter((r) => r.status === 'contato').concat(INCOMING));
      await wait(1050);
      if (dead()) return;

      // Elegant reset so the story can repeat
      panel.classList.add('is-exiting');
      await wait(reducedMotion ? 10 : 420);
      if (dead()) return;
    }
  }

  function startLeads() {
    leadsRun += 1;
    if (!leadsVisible) return;
    if (reducedMotion) renderStaticLeads();
    else runLeads();
  }

  new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      leadsVisible = entry.isIntersecting;
      if (leadsVisible) startLeads();
      else leadsRun += 1;
    });
  }, { threshold: 0.25 }).observe(panel);

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
    setLeadsLabel();
    startChat();
    startLeads();
  });
}