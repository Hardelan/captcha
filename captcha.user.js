// ==UserScript==
// @name         Key-Drop <> CheckboxClicker unified postMessage & human-click
// @namespace    http://tampermonkey.net/
// @version      1.1
// @description  Jeden skrypt: parent (key-drop.com) wysyła postMessage do iframe (static.checkboxclicker.com) po 5s i 10s; iframe wykonuje "ludzkie" kliknięcie na checkbox. Fallbacky w iframe (self try 5s/10s). Logs w konsoli.
// @author       You
// @match        https://key-drop.com/*
// @match        https://*.key-drop.com/*
// @match        https://static.checkboxclicker.com/*
// @run-at       document-idle
// @grant        none
// @updateURL   https://raw.githubusercontent.com/Hardelan/captcha/main/captcha.user.js
// @downloadURL https://raw.githubusercontent.com/Hardelan/captcha/main/captcha.user.js
// ==/UserScript==

(function () {
  'use strict';

  // ---------- CONFIG ----------
  const IFRAME_ORIGIN = 'https://static.checkboxclicker.com';
  const PARENT_ORIGIN_BASE = 'https://key-drop.com';
  const LABEL_SELECTOR = 'label.cb-lb';
  const HOLD_MS_MIN = 120;
  const HOLD_MS_MAX = 420;
  const SIMULATE_MOUSE_MOVE = true;
  // ---------- /CONFIG ----------

  const randInt = (min, max) => Math.floor(Math.random() * (max - min + 1)) + min;

  // Common utils
  function dispatchMouseEvent(target, type, opts = {}) {
    if (!target || !target.getBoundingClientRect) return;
    const rect = target.getBoundingClientRect();
    const cx = ('clientX' in opts) ? opts.clientX : Math.floor(rect.left + rect.width / 2);
    const cy = ('clientY' in opts) ? opts.clientY : Math.floor(rect.top + rect.height / 2);
    const init = Object.assign({
      view: window,
      bubbles: true,
      cancelable: true,
      clientX: cx,
      clientY: cy,
      button: 0,
      buttons: 1
    }, opts);
    target.dispatchEvent(new MouseEvent(type, init));
  }

  async function humanClick(el) {
    if (!el) return false;
    if (SIMULATE_MOUSE_MOVE) {
      dispatchMouseEvent(el, 'mouseover', { buttons: 0 });
      const rect = el.getBoundingClientRect();
      const steps = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < steps; i++) {
        dispatchMouseEvent(el, 'mousemove', {
          clientX: Math.floor(rect.left + Math.random() * rect.width),
          clientY: Math.floor(rect.top + Math.random() * rect.height),
          buttons: 0
        });
      }
    }
    dispatchMouseEvent(el, 'mousedown', { button: 0, buttons: 1 });
    await new Promise(r => setTimeout(r, randInt(HOLD_MS_MIN, HOLD_MS_MAX)));
    dispatchMouseEvent(el, 'mouseup', { button: 0, buttons: 0 });
    dispatchMouseEvent(el, 'click', { button: 0, buttons: 0 });
    return true;
  }

  // ---------- ROLE: PARENT (key-drop.com) ----------
  function isParentContext() {
    return location.hostname.endsWith('key-drop.com');
  }

  if (isParentContext()) {
    const LOG = (...a) => console.log('[KD→IFRAME]', ...a);
    const WARN = (...a) => console.warn('[KD→IFRAME]', ...a);

    function findTargetIframe() {
      const iframes = Array.from(document.querySelectorAll('iframe'));
      for (const f of iframes) {
        try {
          const src = f.getAttribute('src') || '';
          // match either exact origin or src starting with it
          if (src.startsWith(IFRAME_ORIGIN)) return f;
        } catch (e) { /* ignore */ }
      }
      return null;
    }

    function sendClickRequest(tag) {
      const iframe = findTargetIframe();
      if (!iframe) {
        WARN('Nie znaleziono iframe z', IFRAME_ORIGIN, tag);
        return;
      }
      if (!iframe.contentWindow) {
        WARN('iframe.contentWindow niedostępny', tag);
        return;
      }
      const msg = { type: 'KD_CLICK_REQUEST', tag };
      LOG('Wysyłam', msg, 'do', IFRAME_ORIGIN);
      try {
        iframe.contentWindow.postMessage(msg, IFRAME_ORIGIN);
      } catch (e) {
        WARN('postMessage error:', e);
      }
    }

    // odbiór odpowiedzi z iframe
    window.addEventListener('message', (ev) => {
      if (ev.origin !== IFRAME_ORIGIN) return;
      const data = ev.data || {};
      if (!data || !data.type) return;
      if (data.type === 'KD_CLICK_RESULT') {
        LOG('Odpowiedź z iframe:', data);
      }
    });

    // schedule exactly two attempts: ~5s and ~10s
    setTimeout(() => sendClickRequest('T~5s'), 5000);
    setTimeout(() => sendClickRequest('T~10s'), 10000);

    // done for parent
    return;
  }

  // ---------- ROLE: IFRAME (static.checkboxclicker.com) ----------
  // If reached here, script runs in iframe domain context.
  const LOG = (...a) => console.log('[IFRAME]', ...a);
  const WARN = (...a) => console.warn('[IFRAME]', ...a);

  function isAllowedParent(origin) {
    if (!origin) return false;
    try {
      const u = new URL(origin);
      if (u.protocol !== 'https:') return false;
      return u.hostname.endsWith('key-drop.com');
    } catch { return false; }
  }

  function findTargetPair() {
    const label = document.querySelector(LABEL_SELECTOR);
    let input = label ? label.querySelector('input[type="checkbox"]') : null;
    if (!input && label && label.htmlFor) {
      input = document.getElementById(label.htmlFor);
    }
    if (!input) input = document.querySelector('input[type="checkbox"]');
    return { label, input };
  }

  async function performHumanCheck(reason) {
    const { label, input } = findTargetPair();
    if (!label && !input) return { ok: false, reason: 'no-targets', by: reason };
    const box = input;
    if (!box) return { ok: false, reason: 'no-checkbox', by: reason };
    if (box.disabled) return { ok: false, reason: 'disabled', by: reason };
    if (box.checked) return { ok: true, reason: 'already-checked', by: reason };

    if (label) {
      try { label.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
      await humanClick(label);
      await new Promise(r => setTimeout(r, 60));
      if (box.checked) return { ok: true, reason: 'clicked-label', by: reason };
    }

    try { box.scrollIntoView({ block: 'center', inline: 'center' }); } catch {}
    await humanClick(box);
    await new Promise(r => setTimeout(r, 60));
    if (box.checked) return { ok: true, reason: 'clicked-input', by: reason };

    // fallback: force checked + change
    box.checked = true;
    box.dispatchEvent(new Event('change', { bubbles: true, cancelable: true }));
    await new Promise(r => setTimeout(r, 30));
    if (box.checked) return { ok: true, reason: 'forced', by: reason };

    return { ok: false, reason: 'failed', by: reason };
  }

  // message listener - parent -> iframe
  window.addEventListener('message', async (ev) => {
    const origin = ev.origin || '';
    if (!isAllowedParent(origin)) {
      // ignore other origins
      return;
    }
    const data = ev.data || {};
    if (!data || data.type !== 'KD_CLICK_REQUEST') return;
    LOG('Otrzymano KD_CLICK_REQUEST:', data.tag, 'od', origin);
    const res = await performHumanCheck(`postMessage:${data.tag || ''}`);
    // odeślij rezultat do rodzica (postMessage do parent origin)
    try {
      window.parent.postMessage(Object.assign({ type: 'KD_CLICK_RESULT', tag: data.tag }, res), origin);
      LOG('Wysłano KD_CLICK_RESULT do rodzica:', res);
    } catch (e) {
      WARN('Nie udało się wysłać odpowiedzi do rodzica:', e);
    }
  });

  // fallback: sam spróbuj po 5s i 10s (jeśli parent nie wyśle wiadomości)
  setTimeout(async () => {
    const r1 = await performHumanCheck('self:5s');
    LOG('Self check 5s:', r1);
    if (!r1.ok) {
      setTimeout(async () => {
        const r2 = await performHumanCheck('self:10s');
        LOG('Self check 10s:', r2);
      }, 5000);
    }
  }, 5000);

})();
