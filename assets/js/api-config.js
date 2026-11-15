/**
 * Where the transcription form sends its requests.
 *
 * Production talks to https://drumdash.com/api/* (the Cloudflare Worker), which
 * holds the upstream API key server-side. Nothing here is secret.
 *
 * Local testing: run the Worker locally and the site on :4000, then either
 *   - append ?api=http://localhost:8787/api  to the page URL, or
 *   - run  localStorage.setItem('dd_api_base', 'http://localhost:8787/api')
 *
 * The query param wins, then localStorage, then the same-origin default. This is
 * deliberately visible and overridable so a tester never has to edit a file and
 * a visitor can never end up pointing somewhere unexpected by accident.
 */
(function () {
  'use strict';

  var DEFAULT_BASE = '/api';

  function resolveBase() {
    try {
      var params = new URLSearchParams(window.location.search);
      var fromQuery = params.get('api');
      if (fromQuery) {
        // Only allow http(s) origins: a javascript: URI here would be a
        // self-inflicted XSS vector.
        if (/^https?:\/\//i.test(fromQuery)) return fromQuery.replace(/\/$/, '');
      }
    } catch (e) { /* ignore */ }

    try {
      var stored = window.localStorage.getItem('dd_api_base');
      if (stored && /^https?:\/\//i.test(stored)) return stored.replace(/\/$/, '');
    } catch (e) { /* ignore */ }

    return DEFAULT_BASE;
  }

  window.DrumDashApiConfig = {
    base: resolveBase(),
    isDev: resolveBase() !== DEFAULT_BASE,
    /** Same-origin default, useful for tests that want to ignore overrides. */
    defaultBase: DEFAULT_BASE
  };
})();
