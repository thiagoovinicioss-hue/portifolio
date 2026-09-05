import { t, getOptions, subscribe } from './i18n/index.js';
import { whatsappUrl, isBackendConfigured } from './config.js';
import { saveLead } from './backend.js';
import { escapeHtml } from './ui.js';
import { recommendAddons, addonById } from './services.js';

const STEPS = [
  { id: 1, fields: ['name', 'companyType', 'contact'] },
  { id: 2, fields: ['goals', 'objective', 'howItWorksToday', 'biggestPain', 'weeklyTimeSpent', 'previousAttempts'] },
  { id: 3, fields: ['budget'] },
  { id: 4, fields: [] },
];

export function initQuote() {
  const shell = document.querySelector('#quoteShell');
  if (!shell) return null;
  return new QuoteFlow(shell);
}

class QuoteFlow {
  constructor(shell) {
    this.shell = shell;
    this.form = shell.querySelector('#quoteForm');
    this.panels = [...shell.querySelectorAll('.quote-step-panel')];
    this.stepEls = [...shell.querySelectorAll('.quote-step')];
    this.progressFill = shell.querySelector('#quoteProgressFill');
    this.progressBar = shell.querySelector('.quote-progress');
    this.nextBtn = shell.querySelector('#quoteNext');
    this.prevBtn = shell.querySelector('#quotePrev');
    this.submitBtn = shell.querySelector('#quoteSubmit');
    this.reviewEl = shell.querySelector('#quoteReview');
    this.successEl = shell.querySelector('#quoteSuccess');
    this.formError = shell.querySelector('#quoteFormError');
    this.backBtn = shell.querySelector('#quoteBack');
    this.doneBtn = shell.querySelector('#quoteDone');
    this.waLink = shell.querySelector('#quoteWaLink');
    this.savedNote = shell.querySelector('#quoteSavedNote');
    this.errorNote = shell.querySelector('#quoteErrorNote');
    this.budgetOptions = [...shell.querySelectorAll('.budget-option')];
    this.hpInput = shell.querySelector('[name="hp"]');
    this.addonGrid = shell.querySelector('#quoteAddonGrid');
    this.addonSummary = shell.querySelector('#quoteAddonSummary');

    this.step = 1;
    this.budgetIndex = null;
    this.data = { name: '', company: '', companyType: '', contact: '', goals: '', objective: '', howItWorksToday: '', biggestPain: '', weeklyTimeSpent: '', previousAttempts: '', budget: '', extra: '', selectedAddOns: [] };
    this.submitting = false;

    this.populateSelects();
    this.bind();
    subscribe(() => {
      this.populateSelects();
      this.renderBudget();
      this.renderReview();
      this.renderAddOns();
      this.syncStep();
    });
  }

  populateSelects() {
    const configs = [
      { el: this.form.querySelector('[name="companyType"]'), key: 'quote.ctype.options' },
      { el: this.form.querySelector('[name="goals"]'), key: 'quote.goals.options' },
      { el: this.form.querySelector('[name="objective"]'), key: 'quote.objective.options' },
    ];
    configs.forEach(({ el, key }) => {
      const current = el.value;
      el.innerHTML = '';
      const def = document.createElement('option');
      def.value = '';
      def.textContent = t(key.replace('.options', '.default'));
      el.appendChild(def);
      getOptions(key).forEach((opt) => {
        const o = document.createElement('option');
        o.value = opt.v;
        o.textContent = opt.label;
        el.appendChild(o);
      });
      if (current) el.value = current;
    });
  }

  bind() {
    this.nextBtn.addEventListener('click', () => this.go(this.step + 1));
    this.prevBtn.addEventListener('click', () => this.go(this.step - 1));
    this.backBtn.addEventListener('click', () => location.hash = '#/');
    this.doneBtn.addEventListener('click', () => location.hash = '#/');

    this.budgetOptions.forEach((btn, i) => {
      btn.addEventListener('click', () => {
        this.budgetIndex = i;
        this.renderBudget();
      });
    });

    // Clicking a step indicator returns to that step (only if already visited)
    this.stepEls.forEach((stepEl, i) => {
      stepEl.addEventListener('click', () => {
        if (i + 1 < this.step) this.go(i + 1);
        else if (i + 1 === this.step) this.go(i + 1);
      });
    });

    const form = this.form;
    form.addEventListener('submit', (e) => e.preventDefault());

    ['name', 'company', 'companyType', 'contact', 'goals', 'objective', 'howItWorksToday', 'biggestPain', 'weeklyTimeSpent', 'previousAttempts', 'extra'].forEach((name) => {
      const el = form.querySelector(`[name="${name}"]`);
      if (!el) return;
      el.addEventListener('input', () => { if (name !== 'extra' && this.step === 4) this.renderReview(); });
    });

    this.submitBtn.addEventListener('click', () => this.submit());
  }

  collect() {
    this.data.name = this.form.querySelector('[name="name"]').value.trim();
    this.data.company = this.form.querySelector('[name="company"]').value.trim();
    this.data.companyType = this.form.querySelector('[name="companyType"]').selectedOptions[0].textContent;
    this.data.contact = this.form.querySelector('[name="contact"]').value.trim();
    this.data.goals = this.form.querySelector('[name="goals"]').selectedOptions[0].textContent;
    this.data.objective = this.form.querySelector('[name="objective"]').selectedOptions[0].textContent;
    this.data.howItWorksToday = this.form.querySelector('[name="howItWorksToday"]').value.trim();
    this.data.biggestPain = this.form.querySelector('[name="biggestPain"]').value.trim();
    this.data.weeklyTimeSpent = this.form.querySelector('[name="weeklyTimeSpent"]').value.trim();
    this.data.previousAttempts = this.form.querySelector('[name="previousAttempts"]').value.trim();
    this.data.budget = this.budgetIndex !== null ? t(`quote.budget.o${this.budgetIndex + 1}`) : '';
    this.data.extra = this.form.querySelector('[name="extra"]').value.trim();
  }

  // The placeholder option always has value="" — an explicit empty value — so a
  // select is only filled when a real (non-placeholder) option is chosen. We
  // validate against the raw option VALUE (not the display text), which prevents
  // placeholders such as "Selecione…" from ever counting as a valid answer.
  selectedValue(name) {
    const el = this.form.querySelector(`[name="${name}"]`);
    return el ? el.value : '';
  }

  validateStep(step) {
    this.collect();
    let ok = true;
    const setError = (name, msg) => {
      const errEl = this.form.querySelector(`[data-error-for="${name}"]`);
      const fieldEl = this.form.querySelector(`[name="${name}"]`);
      if (errEl) {
        ok = false;
        errEl.textContent = msg || t('quote.error.required');
        if (fieldEl) fieldEl.setAttribute('aria-invalid', 'true');
      }
    };
    const clearError = (name) => {
      const errEl = this.form.querySelector(`[data-error-for="${name}"]`);
      const fieldEl = this.form.querySelector(`[name="${name}"]`);
      if (errEl) errEl.textContent = '';
      if (fieldEl) fieldEl.removeAttribute('aria-invalid');
    };

    ['name', 'companyType', 'contact', 'goals', 'objective', 'howItWorksToday', 'biggestPain', 'weeklyTimeSpent', 'previousAttempts', 'extra'].forEach(clearError);
    this.formError.hidden = true;
    const elBudgetError = this.form.querySelector('[data-error-for="budget"]');

    if (step === 1) {
      if (!this.data.name) setError('name');
      if (!this.selectedValue('companyType')) setError('companyType');
      if (!this.data.contact) setError('contact');
    } else if (step === 2) {
      if (!this.selectedValue('goals')) setError('goals');
      if (!this.selectedValue('objective')) setError('objective');
      if (!this.data.howItWorksToday) setError('howItWorksToday');
      if (!this.data.biggestPain) setError('biggestPain');
      if (!this.data.weeklyTimeSpent) setError('weeklyTimeSpent');
      if (!this.data.previousAttempts) setError('previousAttempts');
    } else if (step === 3) {
      if (this.budgetIndex === null) {
        ok = false;
        elBudgetError.textContent = t('quote.error.budget');
      } else {
        elBudgetError.textContent = '';
      }
    }
    return ok;
  }

  go(next) {
    if (this.submitting) return;
    if (next > this.step) {
      if (!this.validateStep(this.step)) return;
    }
    this.step = Math.min(Math.max(next, 1), 4);
    if (this.step === 4) { this.renderReview(); this.renderAddOns(); }
    this.syncStep();
  }

  renderBudget() {
    this.budgetOptions.forEach((el, i) => {
      el.classList.toggle('is-selected', i === this.budgetIndex);
      el.setAttribute('aria-pressed', i === this.budgetIndex ? 'true' : 'false');
    });
    const errEl = this.form.querySelector('[data-error-for="budget"]');
    if (errEl) errEl.textContent = '';
  }

  renderReview() {
    const rows = [
      ['name', this.data.name],
      ['company', this.data.company || t('quote.review.none')],
      ['ctype', this.data.companyType || t('quote.review.none')],
      ['contact', this.data.contact || t('quote.review.none')],
      ['goals', this.data.goals || t('quote.review.none')],
      ['objective', this.data.objective || t('quote.review.none')],
      ['howItWorksToday', this.data.howItWorksToday || t('quote.review.none')],
      ['biggestPain', this.data.biggestPain || t('quote.review.none')],
      ['weeklyTimeSpent', this.data.weeklyTimeSpent || t('quote.review.none')],
      ['previousAttempts', this.data.previousAttempts || t('quote.review.none')],
      ['budget', this.data.budget || t('quote.review.none')],
      ['extra', this.data.extra || t('quote.review.none')],
    ];
    this.reviewEl.innerHTML = '';
    const rowMap = { name: 1, company: 1, ctype: 1, contact: 1, goals: 2, objective: 2, howItWorksToday: 2, biggestPain: 2, weeklyTimeSpent: 2, previousAttempts: 2, budget: 3, extra: 3 };
    rows.forEach(([key, value]) => {
      const div = document.createElement('div');
      div.className = 'quote-review-row';
      div.setAttribute('data-step', rowMap[key]);
      div.innerHTML = `<dt>${t(`quote.review.${key}`)}</dt><dd>${escapeHtml(value)}</dd><span class="quote-review-edit" aria-hidden="true">✎</span>`;
      div.addEventListener('click', () => this.go(rowMap[key]));
      this.reviewEl.appendChild(div);
    });
  }

  renderAddOns() {
    if (!this.addonGrid) return;
    const recs = recommendAddons({
      primaryGoal: this.selectedValue('goals'),
      objectiveValue: this.selectedValue('objective'),
    });
    const selected = new Set(this.data.selectedAddOns);

    this.addonGrid.innerHTML = recs.map(({ id, recommended }) => {
      const addon = addonById(id);
      if (!addon) return '';
      const checked = selected.has(id);
      return `
        <button type="button" class="addon-card${checked ? ' is-selected' : ''}" role="checkbox" aria-checked="${checked ? 'true' : 'false'}" data-addon="${id}">
          ${recommended ? `<span class="addon-badge">${escapeHtml(t('addon.recommended'))}</span>` : ''}
          <span class="addon-check" aria-hidden="true"></span>
          <span class="addon-name">${escapeHtml(t(`addons.${id}.title`))}</span>
          <span class="addon-benefit">${escapeHtml(t(`addons.${id}.benefit`))}</span>
        </button>
      `;
    }).join('');

    this.addonGrid.querySelectorAll('.addon-card').forEach((card) => {
      card.addEventListener('click', () => this.toggleAddOn(card.dataset.addon));
    });

    this.renderAddOnSummary();
  }

  toggleAddOn(id) {
    const idx = this.data.selectedAddOns.indexOf(id);
    if (idx === -1) this.data.selectedAddOns.push(id);
    else this.data.selectedAddOns.splice(idx, 1);
    this.renderAddOns();
  }

  renderAddOnSummary() {
    if (!this.addonSummary) return;
    if (!this.data.selectedAddOns.length) {
      this.addonSummary.textContent = t('addon.none');
      return;
    }
    this.addonSummary.textContent = this.data.selectedAddOns
      .map((id) => t(`addons.${id}.title`))
      .join(' · ');
  }

  syncStep() {
    this.panels.forEach((panel) => {
      const p = Number(panel.dataset.panel);
      panel.hidden = p !== this.step;
      if (p === this.step) {
        window.requestAnimationFrame(() => {
          const title = panel.querySelector('.quote-title');
          title.focus({ preventScroll: true });
        });
      }
    });
    this.stepEls.forEach((el, i) => {
      el.classList.toggle('is-done', i + 1 < this.step);
      el.classList.toggle('is-current', i + 1 === this.step);
      el.setAttribute('aria-current', i + 1 === this.step ? 'step' : 'false');
      el.style.pointerEvents = i + 1 <= this.step ? '' : 'none';
    });
    this.progressFill.style.width = `${((this.step - 1) / 3) * 100}%`;
    this.progressBar.setAttribute('aria-valuenow', String(this.step));
    const last = this.step === 4;
    this.nextBtn.hidden = last;
    this.submitBtn.hidden = !last;
    this.prevBtn.hidden = this.step === 1;
    this.formError.hidden = true;
  }

  showLoading(show) {
    const screen = document.querySelector('#loadingScreen');
    if (show) {
      screen.hidden = false;
      requestAnimationFrame(() => screen.classList.add('is-visible'));
    } else {
      screen.classList.remove('is-visible');
      window.setTimeout(() => { screen.hidden = true; }, 400);
    }
  }

  async submit() {
    if (this.submitting) return;
    this.collect();
    if (!this.validateStep(this.step)) return;

    // Honeypot: bots fill the hidden field -> silently "succeed" without side effects.
    const isBot = this.hpInput.value.trim() !== '';
    if (isBot) {
      this.showSuccess(false);
      return;
    }

    const message = this.buildMessage();
    const payload = {
      name: this.data.name,
      company_name: this.data.company || null,
      company_type: this.data.companyType,
      contact: this.data.contact,
      goals: this.data.goals,
      objective: this.data.objective,
      how_it_works_today: this.data.howItWorksToday || null,
      biggest_pain: this.data.biggestPain || null,
      weekly_time_spent: this.data.weeklyTimeSpent || null,
      previous_attempts: this.data.previousAttempts || null,
      budget: this.data.budget,
      additional_info: this.data.extra || null,
      selected_addons: this.data.selectedAddOns,
    };

    let saved = false;
    let saveFailed = false;
    if (isBackendConfigured()) {
      this.submitting = true;
      this.showLoading(true);
      this.submitBtn.classList.add('is-loading');
      try {
        await saveLead(payload);
        saved = true;
      } catch (err) {
        console.error('lead save failed', err);
        saveFailed = true;
      } finally {
        this.showLoading(false);
        this.submitBtn.classList.remove('is-loading');
        this.submitting = false;
      }
    }

    this.waLink.href = whatsappUrl(message);
    this.showSuccess(saved, { saveFailed });
    window.open(this.waLink.href, '_blank', 'noopener');
  }

  buildMessage() {
    const intro = this.data.company
      ? t('wa.intro.company', { name: this.data.name, company: this.data.company })
      : t('wa.intro.name', { name: this.data.name });
    const lines = [
      intro,
      '',
      `• ${t('wa.what')}: ${this.data.goals}`,
      `• ${t('wa.objective')}: ${this.data.objective}`,
      `• ${t('wa.budget')}: ${this.data.budget}`,
      `• ${t('wa.contact')}: ${this.data.contact}`,
    ];
    if (this.data.extra) lines.push(`• ${t('wa.extra')}: ${this.data.extra}`);
    const addons = (this.data.selectedAddOns || [])
      .map((id) => `- ${t(`addons.${id}.title`)}`)
      .filter(Boolean);
    if (addons.length) {
      lines.push('', t('wa.addons') + ':', ...addons);
    }
    return lines.join('\n');
  }

  showSuccess(saved, opts) {
    const { saveFailed = false } = opts || {};
    this.form.hidden = true;
    this.prevBtn.hidden = true;
    this.nextBtn.hidden = true;
    this.submitBtn.hidden = true;
    this.successEl.hidden = false;
    this.savedNote.hidden = !saved;
    if (this.errorNote) this.errorNote.hidden = !saveFailed;
    this.progressBar.hidden = true;

    window.requestAnimationFrame(() => {
      const el = this.successEl;
      el.style.opacity = '0';
      el.style.transform = 'translateY(12px)';
      requestAnimationFrame(() => {
        el.style.transition = 'opacity .5s ease, transform .5s ease';
        el.style.opacity = '1';
        el.style.transform = 'none';
      });
    });
  }
}