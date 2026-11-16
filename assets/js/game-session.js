/**
 * Mints and refreshes the Worker session cookie the WebGL game needs.
 *
 * Why this file exists
 * --------------------
 * The web build of DrumDash talks to https://drumdash.com/api/* (the Cloudflare
 * Worker), which authenticates with a first-party HttpOnly cookie issued by
 * POST /api/session. Nothing on the game page ever asked for that cookie:
 *
 *   - The transcription form mints its own session when the user submits, so
 *     transcription.html worked.
 *   - play.html loaded the Unity bundle straight away and the client skipped
 *     the session request ("WebGL holds no credential client-side, so there is
 *     nothing to attest"), which conflated "no Play Integrity" with "no
 *     credential". The result was
 *
 *       POST /api/transcribe -> 401 {"error":"no_valid_session"}
 *
 *     on every import, while Android — which mints an app session at startup —
 *     worked fine.
 *
 * The client is fixed, but a rebuild is not required for this to work: the
 * cookie is an ordinary same-origin credential, so the page can obtain it on the
 * game's behalf. That is what this script does.
 *
 * The cookie is HttpOnly, so this script cannot read it and must not try. It
 * only requests one and refreshes it a little before the Worker's hour is up.
 */
(function () {
  'use strict';

  var API =
    (window.DrumDashApiConfig && window.DrumDashApiConfig.base) || '/api';

  // Worker SESSION_TTL_SECONDS is 3600. Refresh with a margin so a user who
  // leaves the tab open cannot submit into an expired cookie.
  var REFRESH_MS = 50 * 60 * 1000;

  var timer = null;
  var lastStatus = 0;

  function mint() {
    return fetch(API + '/session', {
      method: 'POST',
      // The cookie is first-party; 'same-origin' is enough and avoids sending
      // anything anywhere else.
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnstileToken: getTurnstileToken() }),
    })
      .then(function (res) {
        lastStatus = res.status;
        if (!res.ok) {
          return res
            .json()
            .catch(function () {
              return {};
            })
            .then(function (body) {
              throw new Error((body && body.error) || 'http_' + res.status);
            });
        }
        return res.json().catch(function () {
          return {};
        });
      })
      .then(function (body) {
        // Only log the happy path in debug mode; a failed mint is worth a
        // warning because it is exactly what makes every import 401.
        if (window.console && console.debug) {
          console.debug('[drumdash] web session established', body);
        }
        scheduleRefresh();
        return true;
      })
      .catch(function (err) {
        var detail = String((err && err.message) || err);
        if (window.console && console.warn) {
          console.warn(
            '[drumdash] could not start a web session (' + detail + '). ' +
              'Song import will fail with 401 until this succeeds.'
          );
        }
        // Retry sooner, but not in a tight loop.
        clearTimeout(timer);
        timer = setTimeout(mint, 30000);
        return false;
      });
  }

  function scheduleRefresh() {
    clearTimeout(timer);
    timer = setTimeout(mint, REFRESH_MS);
  }

  function getTurnstileToken() {
    // No widget is rendered on the game page today, and the Worker is in "soft"
    // mode, so this is normally ''. It is read anyway so that switching the
    // Worker to "enforce" only requires adding the widget here.
    try {
      if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
        return window.turnstile.getResponse() || '';
      }
    } catch (_) {
      /* ignore */
    }
    return '';
  }

  // Expose for manual checks from the console: DrumDashGameSession.mint()
  window.DrumDashGameSession = {
    mint: mint,
    status: function () {
      return lastStatus;
    },
  };

  mint();
})();
