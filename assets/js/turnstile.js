/**
 * Cloudflare Turnstile widget loader for the two form pages.
 *
 * WHY THIS FILE EXISTS
 * --------------------
 * The Worker has had a Turnstile gate on POST /api/session since it was written,
 * but no page ever rendered a widget. The JS only contained defensive stubs:
 *
 *     if (window.turnstile && ...getResponse) return ...
 *     return '';                       // always, because turnstile never existed
 *
 * So every /api/session call carried an empty token, and the Worker was left in
 * "soft" mode (missing token allowed) for the only client that exists — which is
 * to say Turnstile was doing nothing at all. `/api/health` confirmed it:
 * turnstileMode "soft" while a session could be minted with `{}` as the body.
 *
 * This loads the widget and exposes the token through window.turnstile, which is
 * the exact API the three existing call sites already probe. That matters: the
 * form scripts did not need to change to start sending real tokens.
 *
 * LOAD ORDER
 * ----------
 * Must come BEFORE transcribe-form.js / translate-form.js in the document. Both
 * are `defer`, and deferred scripts run in document order; a session minted
 * before the widget exists sends an empty token. The scripts also re-read
 * window.turnstile at call time, so a widget that loads slightly late is still
 * picked up — but the order should not rely on that.
 *
 * NO SITEKEY => NO WIDGET, NO ERROR
 * --------------------------------
 * The sitekey lives in _config.yml as `turnstile_sitekey`. An empty value (the
 * default, and the local-dev case) makes this a no-op, so nothing renders and no
 * request goes to challenges.cloudflare.com. That keeps local testing and the
 * current "soft" deployment working unchanged, and means a deploy cannot break
 * the form by pointing at a missing key.
 */
(function () {
  'use strict';

  var SCRIPT_SRC =
    'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

  // Injected by the layout from _config.yml. Absent for local builds.
  var sitekey = (window.DrumDashTurnstileSitekey || '').trim();

  // Containers to render into. An invisible widget needs a mount point, and
  // rendering into a real (but hidden) element is more predictable than the
  // implicit "invisible" auto-render mode, because we can read the token from a
  // widget id rather than a global.
  var CONTAINERS = ['tx-turnstile', 'tr-turnstile'];

  if (!sitekey) {
    // Deliberately quiet. A missing sitekey is the normal state for local dev,
    // and the Worker's "soft" mode accepts an empty token, so this is not a
    // failure — logging it would train people to ignore a real warning later.
    return;
  }

  var widgetId = null;
  var loading = false;

  function loadScript(cb) {
    if (window.turnstile) return cb();
    if (loading) return; // a second call while in flight is a no-op
    loading = true;

    var s = document.createElement('script');
    s.src = SCRIPT_SRC;
    s.async = true;
    s.defer = true;
    s.onload = function () {
      loading = false;
      cb();
    };
    s.onerror = function () {
      loading = false;
      // The form still works in "soft" mode, so this is a warning rather than a
      // blocked submit. In "enforce" mode the Worker's 403 will surface it.
      if (window.console && console.warn) {
        console.warn('[drumdash] Turnstile could not be loaded; continuing without it');
      }
    };
    document.head.appendChild(s);
  }

  function mount() {
    if (!window.turnstile || widgetId !== null) return;

    var el = null;
    for (var i = 0; i < CONTAINERS.length; i++) {
      var candidate = document.getElementById(CONTAINERS[i]);
      if (candidate) {
        el = candidate;
        break;
      }
    }
    // No container on this page: fall back to an offscreen host so getResponse()
    // still works. Cheaper than making every page carry markup it does not need.
    if (!el) {
      el = document.createElement('div');
      el.id = CONTAINERS[0];
      el.style.position = 'absolute';
      el.style.left = '-9999px';
      el.setAttribute('aria-hidden', 'true');
      document.body.appendChild(el);
    }

    try {
      widgetId = window.turnstile.render(el, {
        sitekey: sitekey,
        // "invisible" shows no checkbox on the happy path and only challenges
        // when Cloudflare's risk score says it should. The form already has a
        // deliberate submit action to hang it on.
        appearance: 'interaction-only',
        theme: 'auto',
        callback: function () {
          if (window.console && console.debug) {
            console.debug('[drumdash] turnstile token ready');
          }
        },
        'error-callback': function (code) {
          if (window.console && console.warn) {
            console.warn('[drumdash] turnstile error: ' + code);
          }
          return true; // let the widget retry on its own
        },
      });
    } catch (e) {
      // A render failure must never break the form.
      if (window.console && console.warn) {
        console.warn('[drumdash] turnstile render failed', e);
      }
    }
  }

  function begin() {
    loadScript(function () {
      // api.js?render=explicit defines turnstile synchronously after load, but
      // guard anyway: Cloudflare sometimes resolves onload before render() is
      // callable.
      if (window.turnstile && typeof window.turnstile.render === 'function') {
        mount();
      } else {
        setTimeout(begin, 100);
      }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', begin);
  } else {
    begin();
  }

  /**
   * A spent token is single-use: once Siteverify accepts it, presenting the same
   * string again fails. The Worker issues the cookie on the first call, so the
   * only real risk is a second /api/session within the same page (e.g. a retry
   * after a network error), which would otherwise 403 in enforce mode.
   *
   * Exposed so the form scripts can reset without knowing about widget ids.
   */
  window.DrumDashTurnstile = {
    enabled: function () {
      return !!sitekey;
    },
    reset: function () {
      if (window.turnstile && widgetId !== null) {
        try {
          window.turnstile.reset(widgetId);
        } catch (_) {
          /* ignore */
        }
      }
    },
  };
})();
