/* ==========================================================================
   Salvatore Pizza — site script
   Vanilla JS. No deps beyond Lucide (loaded by index.html).
   ========================================================================== */
(function () {
  'use strict';

  const prefersReducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- Lucide icons ---------- */
  function initIcons() {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      try { window.lucide.createIcons(); } catch (e) { /* no-op */ }
    }
  }

  /* ---------- Sticky nav scroll state ---------- */
  function initStickyNav() {
    const nav = document.getElementById('nav');
    if (!nav) return;
    const threshold = 80;
    let ticking = false;
    function update() {
      const y = window.scrollY || window.pageYOffset;
      if (y >= threshold) nav.classList.add('is-scrolled');
      else nav.classList.remove('is-scrolled');
      ticking = false;
    }
    function onScroll() {
      if (!ticking) {
        window.requestAnimationFrame(update);
        ticking = true;
      }
    }
    window.addEventListener('scroll', onScroll, { passive: true });
    update();
  }

  /* ---------- Mobile drawer ---------- */
  function initDrawer() {
    const toggle = document.getElementById('nav-toggle');
    const drawer = document.getElementById('drawer');
    const backdrop = document.getElementById('drawer-backdrop');
    const closeBtn = document.getElementById('drawer-close');
    if (!toggle || !drawer || !backdrop || !closeBtn) return;

    let lastFocus = null;

    function focusableEls(container) {
      return container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
    }

    function open() {
      lastFocus = document.activeElement;
      drawer.hidden = false;
      backdrop.hidden = false;
      document.body.classList.add('is-locked');
      toggle.setAttribute('aria-expanded', 'true');
      // Move focus inside
      const focusable = focusableEls(drawer);
      if (focusable.length) focusable[0].focus();
    }

    function close() {
      drawer.hidden = true;
      backdrop.hidden = true;
      document.body.classList.remove('is-locked');
      toggle.setAttribute('aria-expanded', 'false');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    toggle.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    backdrop.addEventListener('click', close);

    // Close on link click
    drawer.querySelectorAll('a[href]').forEach(function (a) {
      a.addEventListener('click', function () {
        close();
      });
    });

    // ESC + focus trap
    document.addEventListener('keydown', function (e) {
      if (drawer.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        const focusable = Array.prototype.slice.call(focusableEls(drawer));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    });
  }

  /* ---------- Scroll reveal ---------- */
  function initReveals() {
    const items = document.querySelectorAll('.reveal');
    if (!items.length) return;
    if (prefersReducedMotion || !('IntersectionObserver' in window)) {
      items.forEach(function (el) { el.classList.add('is-visible'); });
      return;
    }
    const observer = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry, i) {
        if (entry.isIntersecting) {
          // small stagger by index inside observation batch
          const delay = Math.min(i * 40, 160);
          setTimeout(function () {
            entry.target.classList.add('is-visible');
          }, delay);
          observer.unobserve(entry.target);
        }
      });
    }, { threshold: 0.15, rootMargin: '0px 0px -40px 0px' });
    items.forEach(function (el) { observer.observe(el); });
  }

  /* ---------- Newsletter form ---------- */
  function initNewsletter() {
    const form = document.getElementById('newsletter-form');
    const success = document.getElementById('newsletter-success');
    const err = document.getElementById('news-error');
    if (!form || !success) return;
    const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    form.addEventListener('submit', function (e) {
      e.preventDefault();
      const input = form.querySelector('input[type="email"]');
      const value = (input && input.value || '').trim();
      if (!emailRe.test(value)) {
        if (err) err.hidden = false;
        input && input.focus();
        return;
      }
      if (err) err.hidden = true;
      form.hidden = true;
      success.hidden = false;
      initIcons();
    });
    // Hide error as user types
    form.addEventListener('input', function () {
      if (err && !err.hidden) err.hidden = true;
    });
  }

  /* ---------- Reservation modal ---------- */
  function initReservationModal() {
    const modal = document.getElementById('reservation-modal');
    if (!modal) return;
    const panel = modal.querySelector('.modal__panel');
    const closeBtn = document.getElementById('modal-close');
    const form = document.getElementById('reservation-form');
    const success = document.getElementById('reservation-success');

    let lastFocus = null;

    function focusableEls(container) {
      return container.querySelectorAll(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
    }

    function open() {
      lastFocus = document.activeElement;
      modal.hidden = false;
      document.body.classList.add('is-locked');
      // Reset to form view if previously submitted
      if (form && success) {
        form.hidden = false;
        success.hidden = true;
      }
      // Focus first input
      const focusable = focusableEls(panel);
      if (focusable.length) focusable[0].focus();
      else panel.focus();
    }

    function close() {
      modal.hidden = true;
      document.body.classList.remove('is-locked');
      if (lastFocus && typeof lastFocus.focus === 'function') lastFocus.focus();
    }

    // Triggers
    document.querySelectorAll('[data-open-reservation]').forEach(function (el) {
      el.addEventListener('click', function (e) {
        e.preventDefault();
        open();
      });
    });

    // Close triggers
    closeBtn && closeBtn.addEventListener('click', close);
    modal.querySelectorAll('[data-close-modal]').forEach(function (el) {
      el.addEventListener('click', close);
    });

    // ESC + focus trap
    document.addEventListener('keydown', function (e) {
      if (modal.hidden) return;
      if (e.key === 'Escape') { e.preventDefault(); close(); return; }
      if (e.key === 'Tab') {
        const focusable = Array.prototype.slice.call(focusableEls(panel));
        if (!focusable.length) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault(); last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault(); first.focus();
        }
      }
    });

    // Form submission
    if (form && success) {
      form.addEventListener('submit', function (e) {
        e.preventDefault();
        // Minimal validation: check required HTML5 fields
        const required = form.querySelectorAll('[required]');
        let valid = true;
        required.forEach(function (input) {
          if (!input.value || !input.value.trim()) valid = false;
        });
        if (!valid) {
          // Use native reporting
          form.reportValidity && form.reportValidity();
          return;
        }
        form.hidden = true;
        success.hidden = false;
        initIcons();
      });
    }
  }

  /* ---------- Smooth scroll for in-page anchors (respecting reduced motion) ---------- */
  function initSmoothAnchors() {
    document.querySelectorAll('a[href^="#"]').forEach(function (a) {
      a.addEventListener('click', function (e) {
        const href = a.getAttribute('href');
        if (!href || href === '#' || href.length < 2) return;
        // Skip if it's a modal trigger
        if (a.hasAttribute('data-open-reservation')) return;
        const target = document.querySelector(href);
        if (!target) return;
        e.preventDefault();
        target.scrollIntoView({
          behavior: prefersReducedMotion ? 'auto' : 'smooth',
          block: 'start'
        });
      });
    });
  }

  /* ---------- Init ---------- */
  function ready(fn) {
    if (document.readyState !== 'loading') fn();
    else document.addEventListener('DOMContentLoaded', fn);
  }

  ready(function () {
    initIcons();
    initStickyNav();
    initDrawer();
    initReveals();
    initNewsletter();
    initReservationModal();
    initSmoothAnchors();
  });
})();
