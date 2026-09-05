import { PROJECTS } from './projects.js';
import { t, getLang, subscribe } from './i18n/index.js';

const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

/* Per-breakpoint base geometry for the 3D ring. Cards sized so the front card
   always fits the viewport; radius derived from width + angular gap. */
const GEOMETRY = {
  desktop: {
    cardRatio: 1.72,
    gapFraction: 0.46,
    perspective: 4000,
    tilt: -6,
    heightCap: 720,
    heightBudget: 0.8,
    deckPerspective: 2800,   // closer view after the reveal, keeps full ring in frame
  },
  mobile: {
    cardRatio: 1.68,
    gapFraction: 0.42,
    perspective: 2400,
    tilt: -8,
    heightCap: 520,
    heightBudget: 0.82,
    deckPerspective: 1700,
  },
};

/* Phases of the intro → interactive sequence */
const PHASE = {
  cover: 'cover',      // glass circle + "clique para ver" overlay
  spin: 'spin',        // 3D ring auto-rotates as a showcase
  reveal: 'reveal',    // camera settles smoothly closer after the spin
  interact: 'interact' // final interactive 360° ring
};

const SPIN_SPEED = 0.32;     // cards/s during the showcase spin (slow + smooth)
const SPIN_MS = 3400;        // how long the 3D spins (eased in) before the reveal
const SPIN_RAMP = 1400;      // ms over which the spin accelerates from standstill
const REVEAL_MS = 3600;      // duration of the camera settle (long, buttery smooth)
const IDLE_DELAY = 2500;     // ms without interaction before gentle idle spin resumes
const IDLE_SPEED = 0.05;     // very slow cards/s while idling

const wrap = (n, m) => ((n % m) + m) % m;
const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

/* True 360° ring: cards mounted radially around a full circle. Every card stays
   visible (op = 1) so rotating the ring loops forever with no edge. */
function ringPose(i, pos, angleStep, radius) {
  const a = (i - pos) * angleStep;
  const rad = a * (Math.PI / 180);
  return { x: radius * Math.sin(rad), z: radius * Math.cos(rad), ry: a, rx: 0, y: 0, op: 1 };
}

export class Carousel {
  constructor(root) {
    this.root = root;
    this.camera = root.querySelector('#carouselCamera');
    this.ring = root.querySelector('#carouselRing');
    this.floor = root.querySelector('#carouselFloor');
    this.prevBtn = root.querySelector('#carouselPrev');
    this.nextBtn = root.querySelector('#carouselNext');
    this.counter = root.querySelector('#carouselCounter');
    this.cover = root.querySelector('#carouselCover');

    this.cards = [];
    this.metrics = null;

    this.pos = 0;              // continuous active-card position (single source of truth)
    this.posGoal = null;       // integer target when navigating
    this.blend = 0;            // 0 = 3D ring view, 1 = camera settled closer
    this.phase = PHASE.cover;
    this.phaseStarted = 0;
    this.lastInteraction = 0;
    this.modalOpen = false;
    this.modalActiveIndex = -1;

    this.dragging = false;
    this.pointerId = null;
    this.captured = false;
    this.activated = false;
    this.startX = 0; this.startY = 0;
    this.dragDX = 0; this.lastX = 0;
    this.ringDrag = 0;
    this.dragStartPos = 0;
    this.velocity = 0; this.lastT = 0;

    this.rafId = null;
    this.lastA11y = -1;

    this.render();
    this.buildModal();
    this.bind();

    this.onResizeDebounced = this._debounce(() => this.applyMetrics(), 120);
    window.addEventListener('resize', this.onResizeDebounced);
    this.buildDebug();

    this.root.classList.add('phase-cover');
    this.applyPhaseClass();
    this.tickStart = performance.now();
    this.rafId = requestAnimationFrame(this.tick);
  }

  _debounce(fn, wait) {
    let timer;
    return (...args) => { window.clearTimeout(timer); timer = window.setTimeout(() => fn(...args), wait); };
  }

  render() {
    this.ring.innerHTML = '';
    this.cards = PROJECTS.map((project, i) => {
      const lang = getLang();
      const desc = project.description[lang] || project.description.pt;
      const cat = project.category[lang] || project.category.pt;

      const card = document.createElement('article');
      card.className = 'project-card';
      card.dataset.index = String(i);
      card.setAttribute('aria-label', project.title);

      card.innerHTML = `
        <div class="card-face card-front">
          <a class="card-preview" href="${project.url}" target="_blank" rel="noopener" tabindex="-1">
            <img src="${project.preview}" alt="" width="720" height="420" loading="lazy" decoding="async">
            <span class="card-preview-shade" aria-hidden="true"></span>
          </a>
          <div class="card-body">
            <span class="card-category">${cat}</span>
            <h3 class="card-title">${project.title}</h3>
            <p class="card-desc">${desc}</p>
            <button type="button" class="card-more" data-more>${t('carousel.readMore')}</button>
            <a class="card-link" href="${project.url}" target="_blank" rel="noopener">
              <span>${t('carousel.view')}</span>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 17 17 7m0 0H8m9 0v9"/></svg>
            </a>
          </div>
        </div>
        <div class="card-face card-back">
          <span class="card-back-cat">${cat}</span>
          <span class="card-back-title">${project.title}</span>
          <span class="card-back-index">${String(i + 1).padStart(2, '0')}</span>
        </div>
      `;

      this.ring.appendChild(card);
      return card;
    });

    this.liveRegion = document.createElement('p');
    this.liveRegion.className = 'sr-only';
    this.liveRegion.setAttribute('aria-live', 'polite');
    this.root.appendChild(this.liveRegion);

    this.applyMetrics();
    this.updateAccessibility();
  }

  computeMetrics() {
    const mobile = this.root.clientWidth < 700;
    const s = mobile ? GEOMETRY.mobile : GEOMETRY.desktop;
    const angleStep = 360 / PROJECTS.length;
    const halfAngle = (angleStep / 2) * (Math.PI / 180);
    const P = s.perspective;
    const vh = window.innerHeight || 800;
    const targetFrontH = Math.min(s.heightCap, vh * s.heightBudget);

    let cardW = mobile ? 150 : 240;
    for (let k = 0; k < 40; k++) {
      const cardH = cardW * s.cardRatio;
      const R = cardW * (1 + s.gapFraction) / (2 * Math.sin(halfAngle));
      const scale = P / (P - R);
      cardW *= targetFrontH / (cardH * scale);
    }
    const cardH = cardW * s.cardRatio;
    const radius = cardW * (1 + s.gapFraction) / (2 * Math.sin(halfAngle));
    const sceneH = Math.round(targetFrontH + 180);

    return {
      mobile, angleStep, cardW, cardH, radius,
      perspective: P, tilt: s.tilt, sceneH,
      deckPerspective: s.deckPerspective,
    };
  }

  applyMetrics() {
    const m = this.metrics = this.computeMetrics();

    this.root.style.setProperty('--carousel-perspective', `${m.perspective}px`);
    this.root.style.setProperty('--carousel-tilt', `${m.tilt}deg`);
    this.root.style.setProperty('--card-w', `${Math.round(m.cardW)}px`);
    this.root.style.setProperty('--card-h', `${Math.round(m.cardH)}px`);
    this.root.style.height = `${m.sceneH}px`;

    if (this.floor) this.floor.style.transform = `translate(-50%, -46%) scale(${(m.radius / 380).toFixed(3)})`;

    this.positionCards();
  }

  activeIndex() {
    return wrap(Math.round(this.pos), PROJECTS.length);
  }

  interactive() {
    return this.phase === PHASE.interact;
  }

  /* ---- intro sequence ---- */
  startIntro() {
    if (!this.metrics || this.phase !== PHASE.cover) return;
    if (this.cover) this.cover.classList.add('is-leaving');
    window.setTimeout(() => {
      if (this.cover) this.cover.setAttribute('aria-hidden', 'true');
      this.enterPhase(PHASE.spin);
    }, reducedMotion.matches ? 0 : 720);
  }

  enterPhase(phase) {
    this.phase = phase;
    this.phaseStarted = performance.now();
    this.applyPhaseClass();
  }

  applyPhaseClass() {
    this.root.classList.remove('phase-cover', 'phase-spin', 'phase-reveal', 'phase-interact');
    this.root.classList.add(`phase-${this.phase}`);
  }

  /* ---- animation loop ---- */
  tick = (now) => {
    const dt = Math.min(0.05, (now - this.tickStart) / 1000);
    this.tickStart = now;
    const m = this.metrics;
    const rm = reducedMotion.matches;

    if (m) {
      if (this.phase === PHASE.spin) {
        // showcase: ease the 3D ring up to speed, then glide into the reveal
        const ramp = easeInOutCubic(clamp((now - this.phaseStarted) / SPIN_RAMP, 0, 1));
        this.pos += dt * SPIN_SPEED * ramp;
        if (now - this.phaseStarted >= SPIN_MS) this.enterPhase(PHASE.reveal);
      } else if (this.phase === PHASE.reveal) {
        // morph ring → fan while decelerating the rotation to a graceful stop
        const p = clamp((now - this.phaseStarted) / REVEAL_MS, 0, 1);
        this.blend = rm ? 1 : easeInOutCubic(p);
        this.pos += dt * SPIN_SPEED * (1 - easeOutCubic(p));
        if (p >= 1) { this.blend = 1; this.enterPhase(PHASE.interact); }
      } else if (this.interactive()) {
        // navigate toward a chosen card, else gentle idle rotation
        if (this.posGoal !== null) {
          const goal = wrap(Math.round(this.posGoal), PROJECTS.length);
          let diff = goal - this.pos;
          // snap to the shortest signed distance so we never spin the long way
          if (diff > PROJECTS.length / 2) diff -= PROJECTS.length;
          else if (diff < -PROJECTS.length / 2) diff += PROJECTS.length;
          this.pos += diff * Math.min(1, dt * 7);
          if (Math.abs(diff) < 0.002) { this.pos = goal; this.posGoal = null; }
        } else if (!this.dragging && !this.modalOpen && !rm && !document.hidden && (now - this.lastInteraction) >= IDLE_DELAY) {
          this.pos += dt * IDLE_SPEED;
        }
      }

      // keep the active position normalized so navigation stays perfectly
      // continuous and loops forever without accumulating drift (the card
      // poses are all periodic mod LEN, so this causes no visual jump).
      this.pos = wrap(this.pos, PROJECTS.length);
    }

    this.positionCards();
    this.updateAccessibility();
    this.debugFrame();

    this.rafId = requestAnimationFrame(this.tick);
  };

  /* ---- positioning ---- */
  positionCards() {
    const m = this.metrics;
    if (!m) return;
    const b = this.blend;

    // camera: after the spin, ease slightly closer (lower perspective) and level
    // out a bit — the cards themselves stay on the full seamless 360° ring.
    const perspective = m.perspective + (m.deckPerspective - m.perspective) * b;
    this.root.style.setProperty('--carousel-perspective', `${perspective.toFixed(0)}px`);
    this.camera.style.transform = `rotateX(${(m.tilt * (1 - b * 0.5)).toFixed(2)}deg)`;

    const interactive = this.interactive();
    const dragShift = interactive && this.dragging ? this.ringDrag : 0;

    this.cards.forEach((card, i) => {
      const p = ringPose(i, this.pos, m.angleStep, m.radius);

      // while dragging, nudge the whole ring horizontally for direct tactile feel
      const x = p.x + (interactive ? dragShift : 0);

      card.style.transform =
        `translate(-50%, -50%) translateX(${x.toFixed(1)}px) translateY(${p.y.toFixed(1)}px) ` +
        `translateZ(${p.z.toFixed(1)}px) rotateX(${p.rx.toFixed(1)}deg) rotateY(${p.ry.toFixed(1)}deg)`;
      // all cards visible → the ring loops 360° with no disappearing edge
      card.style.opacity = p.op.toFixed(3);
      card.style.pointerEvents = interactive && Math.abs(i - this.pos) <= 3 ? '' : 'none';
    });
  }

  updateAccessibility() {
    const index = this.activeIndex();
    if (index === this.lastA11y && this.cards.length) return;
    this.lastA11y = index;
    const len = PROJECTS.length;
    this.cards.forEach((card, i) => {
      const active = i === index;
      card.classList.toggle('is-active', active);
      card.setAttribute('aria-hidden', active ? 'false' : 'true');
      card.querySelectorAll('a').forEach((a) => { a.tabIndex = active ? 0 : -1; });
    });
    this.counter.textContent = `${String(index + 1).padStart(2, '0')} / ${String(len).padStart(2, '0')}`;
    this.root.setAttribute('aria-label', `${t('carousel.region')}: ${PROJECTS[index].title} (${index + 1} / ${len})`);
    if (this.liveRegion) this.liveRegion.textContent = PROJECTS[index].title;
  }

  /* ---- navigation ---- */
  goTo(index) {
    if (!this.metrics || !this.interactive()) return;
    this.posGoal = wrap(index, PROJECTS.length);
    this.lastInteraction = performance.now();
  }

  go(dir) {
    this.goTo(this.activeIndex() + dir);
  }

  /* ---- "ler mais" close-up modal ---- */
  buildModal() {
    const modal = document.createElement('div');
    modal.className = 'carousel-modal';
    modal.hidden = true;
    modal.setAttribute('role', 'dialog');
    modal.setAttribute('aria-modal', 'true');
    modal.innerHTML = `
      <div class="carousel-modal-backdrop" data-modal-close></div>
      <div class="carousel-modal-panel" role="document">
        <button type="button" class="carousel-modal-close" data-modal-close aria-label="${t('carousel.close')}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M18 6 6 18M6 6l12 12"/></svg>
        </button>
        <div class="carousel-modal-media"></div>
        <div class="carousel-modal-body">
          <span class="carousel-modal-category"></span>
          <h3 class="carousel-modal-title"></h3>
          <p class="carousel-modal-desc"></p>
          <a class="carousel-modal-link" target="_blank" rel="noopener">
            <span>${t('carousel.view')}</span>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M7 17 17 7m0 0H8m9 0v9"/></svg>
          </a>
        </div>
      </div>
    `;
    modal.querySelectorAll('[data-modal-close]').forEach((el) => el.addEventListener('click', () => this.closeModal()));
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.classList.contains('carousel-modal-backdrop')) this.closeModal();
    });
    this.modalEl = modal;
    this.modalMedia = modal.querySelector('.carousel-modal-media');
    this.modalCategory = modal.querySelector('.carousel-modal-category');
    this.modalTitle = modal.querySelector('.carousel-modal-title');
    this.modalDesc = modal.querySelector('.carousel-modal-desc');
    this.modalLink = modal.querySelector('.carousel-modal-link');
    document.body.appendChild(modal);
  }

  openModal(index) {
    const i = wrap(index, PROJECTS.length);
    const project = PROJECTS[i];
    const lang = getLang();
    const desc = project.description[lang] || project.description.pt;
    const cat = project.category[lang] || project.category.pt;
    this.modalActiveIndex = i;
    this.modalMedia.innerHTML = `<img src="${project.preview}" alt="" width="720" height="420" loading="lazy" decoding="async">`;
    this.modalCategory.textContent = cat;
    this.modalTitle.textContent = project.title;
    this.modalDesc.textContent = desc;
    this.modalLink.href = project.url;
    this.modalLink.querySelector('span').textContent = t('carousel.view');
    this.modalOpen = true;
    this.modalEl.hidden = false;
    // small delay so the browser applies the visible state before the transition
    requestAnimationFrame(() => requestAnimationFrame(() => this.modalEl.classList.add('is-open')));
    document.body.classList.add('carousel-modal-open');
  }

  closeModal() {
    if (!this.modalOpen) return;
    this.modalOpen = false;
    this.modalEl.classList.remove('is-open');
    const done = () => {
      this.modalEl.hidden = true;
      this.modalEl.removeEventListener('transitionend', done);
    };
    this.modalEl.addEventListener('transitionend', done);
    document.body.classList.remove('carousel-modal-open');
  }

  bind() {
    if (this.cover) this.cover.addEventListener('click', () => this.startIntro());

    this.prevBtn.addEventListener('click', () => this.go(-1));
    this.nextBtn.addEventListener('click', () => this.go(1));

    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { this.closeModal(); return; }
      if (this.modalOpen) return;
      if (e.key === 'ArrowLeft') { e.preventDefault(); this.go(1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); this.go(-1); }
      else if (e.key === 'Home') { e.preventDefault(); this.goTo(0); }
      else if (e.key === 'End') { e.preventDefault(); this.goTo(PROJECTS.length - 1); }
    });

    // --- Pointer / touch drag on the 360° ring ---
    this.root.addEventListener('pointerdown', (e) => {
      if (!this.interactive()) return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      if (e.target.closest('.carousel-nav')) return;
      this.dragging = true;
      this.activated = false;
      this.captured = false;
      this.pointerId = e.pointerId;
      this.startX = e.clientX;
      this.startY = e.clientY;
      this.lastX = e.clientX;
      this.lastT = performance.now();
      this.dragDX = 0;
      this.ringDrag = 0;
      this.velocity = 0;
      this.dragStartPos = this.pos;
      this.lastInteraction = performance.now();
      this.root.classList.add('is-dragging');
    });

    this.root.addEventListener('pointermove', (e) => {
      if (!this.dragging || e.pointerId !== this.pointerId) return;
      if (!this.activated) {
        const dxCum = e.clientX - this.startX;
        const dyCum = e.clientY - this.startY;
        if (Math.abs(dxCum) > 6 && Math.abs(dxCum) > Math.abs(dyCum)) {
          this.activated = true;
          this.captured = true;
          try { this.root.setPointerCapture(e.pointerId); } catch (_) {}
        } else {
          return;
        }
      }
      const now = performance.now();
      const dt = now - this.lastT;
      if (dt > 0) this.velocity = 0.8 * this.velocity + 0.2 * ((e.clientX - this.lastX) / dt);
      this.lastX = e.clientX;
      this.lastT = now;
      this.dragDX = e.clientX - this.startX;

      // dragging rotates the whole ring: right/left moves cards continuously, 360°
      if (this.metrics) {
        const scale = 1 / (this.metrics.cardW * 1.1);
        this.pos = wrap(this.dragStartPos - this.dragDX * scale, PROJECTS.length);
        this.ringDrag = this.dragDX * 0.22;
      }
    });

    const endDrag = (e) => {
      if (!this.dragging || (e.pointerId !== undefined && e.pointerId !== this.pointerId)) return;
      if (this.captured) { try { this.root.releasePointerCapture(this.pointerId); } catch (_) {} }
      this.dragging = false;
      this.captured = false;
      this.pointerId = null;
      this.ringDrag = 0;
      this.root.classList.remove('is-dragging');

      if (this.activated && this.interactive()) {
        // settle on the nearest card, stepping one more if the flick is strong
        let goal = Math.round(this.pos);
        if (this.velocity < -0.5) goal = Math.ceil(this.pos);
        else if (this.velocity > 0.5) goal = Math.floor(this.pos);
        this.posGoal = wrap(goal, PROJECTS.length);
      }
      this.dragDX = 0;
    };
    this.root.addEventListener('pointerup', endDrag);
    this.root.addEventListener('pointercancel', endDrag);

    // Clicking "ler mais" opens the close-up; clicking a side card spins it front;
    // never hijack card links.
    this.ring.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a) return;
      const card = e.target.closest('.project-card');
      if (!card) return;
      const idx = Number(card.dataset.index);
      if (!Number.isInteger(idx) || !this.interactive()) return;
      const more = e.target.closest('.card-more');
      if (more) {
        e.preventDefault();
        this.openModal(idx);
        return;
      }
      if (idx !== this.activeIndex()) {
        e.preventDefault();
        this.goTo(idx);
      }
    });

    document.addEventListener('keydown', this._onDocKey, true);

    subscribe(() => {
      if (this.root.hidden) return;
      this.render();
      if (this.modalOpen && this.modalActiveIndex >= 0) this.openModal(this.modalActiveIndex);
    });
  }

  _onDocKey = (e) => {
    if (e.key === 'Escape' && this.modalOpen) this.closeModal();
  };

  /* --- Dev-only debug overlay (enable with ?debug=carousel) --- */
  buildDebug() {
    if (!/carousel/.test(window.location.search)) return;
    const div = document.createElement('div');
    div.className = 'carousel-debug';
    div.setAttribute('aria-hidden', 'true');
    div.innerHTML = `<span class="debug-legend"></span>`;
    this.debugEl = div;
    this.root.appendChild(div);
  }

  debugFrame() {
    if (!this.debugEl) return;
    const m = this.metrics;
    if (!m) return;
    this.debugEl.querySelector('.debug-legend').textContent =
      `phase ${this.phase} · blend ${this.blend.toFixed(2)} · pos ${this.pos.toFixed(2)} · active ${this.activeIndex()} · step ${m.angleStep}° · radius ${Math.round(m.radius)}px`;
  }
}

export function initCarousel() {
  const el = document.querySelector('#carousel');
  if (!el) return null;
  return new Carousel(el);
}
