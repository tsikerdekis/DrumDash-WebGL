/**
 * DrumDash web transcription form.
 *
 * Talks ONLY to https://drumdash.com/api/* (the Cloudflare Worker). The upstream
 * API key never exists in this file — the Worker holds it server-side.
 *
 * Flow (matches the Unity client's v2 pipeline):
 *   1. POST /api/session                -> HttpOnly cookie
 *   2. POST /api/transcribe             -> task_id + signed GCS PUT URLs
 *   3. PUT bytes directly to GCS        -> browser -> GCS, no proxy bandwidth
 *   4. POST /api/confirm                -> queues the job
 *   5. GET  /api/status/:taskId         -> poll until completed
 *   6. render download links
 */

(function () {
  'use strict';

  // Resolved by api-config.js: same-origin /api in production, overridable to a
  // local Worker with ?api=... or localStorage['dd_api_base'] while testing.
  var API =
    (window.DrumDashApiConfig && window.DrumDashApiConfig.base) || '/api';

  var el = {
    form: document.getElementById('tx-form'),
    drop: document.getElementById('tx-drop'),
    file: document.getElementById('tx-file'),
    dropText: document.getElementById('tx-drop-text'),
    title: document.getElementById('tx-title'),
    artist: document.getElementById('tx-artist'),
    submit: document.getElementById('tx-submit'),
    progress: document.getElementById('tx-progress'),
    progressFill: document.getElementById('tx-progress-fill'),
    progressLabel: document.getElementById('tx-progress-label'),
    error: document.getElementById('tx-error'),
    info: document.getElementById('tx-info'),
    results: document.getElementById('tx-results'),
    downloads: document.getElementById('tx-downloads'),
  };

  if (!el.form) return;

  var selectedFile = null;
  var pollTimer = null;
  // Which export the current result belongs to, so the download bundle can be
  // filtered to one format instead of mixing DrumDash and Paradiddle files.
  var chosenFormat = 'drumdash';
  // Only prefill Artist/Title once, so changing the file cannot overwrite
  // metadata the user has already corrected by hand.
  var prefilledOnce = false;

  // A file handed over from the homepage quick form.
  //
  // index.html -> transcription.html is a real document load, so the File
  // cannot travel in a JS variable; it comes through IndexedDB (see
  // file-handoff.js). Once here it is written into the REAL <input type="file">
  // via DataTransfer, so every later step behaves as if the user picked it —
  // adopting it into a JS variable only was the original bug, which left the
  // picker empty and made Transcribe answer "Choose an audio file first.".
  (function adoptHandoffFile() {
    // Clear the "we expected a file" marker set by the homepage, so a stale flag
    // can never block a later visit.
    var pending = false;
    try {
      pending = window.sessionStorage.getItem('dd_handoff_pending') === '1';
      window.sessionStorage.removeItem('dd_handoff_pending');
    } catch (_) { /* private mode */ }

    var handoff = window.DrumDashFileHandoff;

    function reportMissing() {
      if (pending) {
        showError(
          'Your song did not carry over to this page. Please pick the file again below.'
        );
      }
    }

    if (!handoff) {
      reportMissing();
      return;
    }

    handoff.take().then(function (file) {
      if (file) applyFile(file);
      else reportMissing();
    }, reportMissing);
  })();

  // Puts a File into the visible picker so the rest of the form behaves exactly
  // as if the user had chosen it themselves.
  function applyFile(file) {
    if (!file) return;

    var placed = false;
    try {
      var dt = new DataTransfer();
      dt.items.add(file);
      el.file.files = dt.files;
      placed = el.file.files && el.file.files.length === 1;
    } catch (_) {
      placed = false;   // older browsers cannot assign FileList at all
    }

    chooseFile(file);

    if (!placed) {
      // Never leave a form that appears complete but has no file attached.
      showError(
        'Your song did not carry over to this page. Please pick the file again below.'
      );
    }
  }

  // ---------------------------------------------------------------------
  // UI helpers
  // ---------------------------------------------------------------------

  function setProgress(pct, label) {
    el.progress.classList.add('tx-visible');
    el.progressFill.style.width = Math.max(0, Math.min(100, pct)) + '%';
    if (label) el.progressLabel.textContent = label;
  }

  function hideProgress() {
    el.progress.classList.remove('tx-visible');
  }

  function showError(msg) {
    el.info.classList.remove('tx-visible');
    el.error.textContent = msg;
    el.error.classList.add('tx-visible');
  }

  function clearError() {
    el.error.classList.remove('tx-visible');
    el.info.classList.remove('tx-visible');
  }

  function setBusy(busy) {
    el.submit.disabled = busy;
    el.submit.textContent = busy ? 'Working…' : 'Generate my chart';
  }

  // ---------------------------------------------------------------------
  // File picker
  // ---------------------------------------------------------------------

  function chooseFile(file) {
    if (!file) return;
    selectedFile = file;
    el.dropText.textContent = file.name + ' (' + (file.size / 1048576).toFixed(1) + ' MB)';
    clearError();
    prefillFromFilename(file.name);
  }

  /**
   * Prefill Artist / Title from the file name.
   *
   * "Artist - Song.mp3", "Artist-Song.mp3", "Artist – Song.mp3" and
   * "Artist _ Song.mp3" are all common in music libraries, so split on a dash
   * and treat the left side as Artist.
   *
   * Separator choice matters. A hyphen is ambiguous: "AC-DC - Back In Black" and
   * "Blink-182 - All The Small Things" are real files where splitting on the
   * FIRST hyphen yields a nonsense artist ("AC" / "Blink"). So:
   *
   *   1. prefer a dash with whitespace around it (" - ", " – "), which is
   *      unambiguous — hyphens inside a name are almost never spaced;
   *   2. only then fall back to a bare hyphen, and split on the LAST one, which
   *      keeps "Artist-Song" working and still does better than the first.
   *
   * Rules that matter:
   *   - NEVER overwrite what the user typed. Silent data loss is worse than not
   *     prefilling at all.
   *   - Only fill once, so switching files repeatedly does not keep rewriting a
   *     value the user already corrected.
   */
  function prefillFromFilename(name) {
    if (!name || prefilledOnce) return;

    var base = name.replace(/\.[^.]+$/, '').trim();
    if (!base) return;

    // Underscores read better as spaces in metadata.
    base = base.replace(/_/g, ' ').replace(/\s+/g, ' ').trim();

    var m =
      base.match(/^(.+?)\s+[-–—]\s+(.+)$/) ||   // spaced dash: unambiguous
      base.match(/^(.+?)\s*[-–—]\s*(.+)$/);     // bare dash: best effort

    if (!m) {
      // No artist separator: the whole name is the title.
      if (!el.title.value.trim()) el.title.value = base;
      prefilledOnce = true;
      return;
    }

    var artist = m[1].trim();
    var title = m[2].trim();
    if (!artist || !title) return;

    if (!el.artist.value.trim()) el.artist.value = artist;
    if (!el.title.value.trim()) el.title.value = title;
    prefilledOnce = true;
  }

  el.file.addEventListener('change', function (e) {
    chooseFile(e.target.files && e.target.files[0]);
  });

  ['dragenter', 'dragover'].forEach(function (evt) {
    el.drop.addEventListener(evt, function (e) {
      e.preventDefault();
      el.drop.classList.add('tx-dragover');
    });
  });

  ['dragleave', 'drop'].forEach(function (evt) {
    el.drop.addEventListener(evt, function (e) {
      e.preventDefault();
      el.drop.classList.remove('tx-dragover');
    });
  });

  el.drop.addEventListener('drop', function (e) {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) chooseFile(dt.files[0]);
  });

  // ---------------------------------------------------------------------
  // Session
  // ---------------------------------------------------------------------

  function getTurnstileToken() {
    // If a Turnstile widget is present on the page, use its token.
    if (window.turnstile && typeof window.turnstile.getResponse === 'function') {
      try {
        return window.turnstile.getResponse() || '';
      } catch (_) {
        return '';
      }
    }
    return '';
  }

  function ensureSession() {
    return fetch(API + '/session', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnstileToken: getTurnstileToken() }),
    }).then(function (res) {
      // A Turnstile token is single-use, so a second mint (retry, or a second
      // conversion in the same page) must start from a fresh widget. Without
      // this, enforce mode 403s the retry the user was just told to make.
      if (!res.ok && res.status === 403 && window.DrumDashTurnstile) {
        window.DrumDashTurnstile.reset();
      }
      if (!res.ok) {
        return res.json().catch(function () { return {}; }).then(function (body) {
          throw new Error(sessionError(res.status, body));
        });
      }
      return res.json();
    });
  }

  function sessionError(status, body) {
    if (status === 403 && body && body.error === 'turnstile_failed') {
      return 'Human verification failed. Please reload the page and try again.';
    }
    if (status === 403) {
      return 'This form only works on drumdash.com.';
    }
    return 'Could not start a session (' + status + '). Please try again.';
  }

  // ---------------------------------------------------------------------
  // Install identity
  // ---------------------------------------------------------------------
  // The backend keys quotas on install_id, not on the username, so a new name
  // no longer grants fresh credits. The app uses its install UUID here; the
  // website uses a random id kept in localStorage.
  //
  // This is weaker than the app: clearing site data mints a new one, and the
  // value is only a *claim* — the API cannot verify it. That is why the Worker
  // also forwards a signed session id (x-dd-sid) and the backend applies a
  // second, aggregate limit keyed on it. Without that second key, editing this
  // string per request would defeat the per-install window entirely.

  var INSTALL_KEY = 'dd_web_install_id';

  function getInstallId() {
    try {
      var existing = window.localStorage.getItem(INSTALL_KEY);
      if (existing) return existing;

      var generated =
        (window.crypto && window.crypto.randomUUID)
          ? window.crypto.randomUUID()
          : 'web-' + randomId() + '-' + randomId();

      window.localStorage.setItem(INSTALL_KEY, generated);
      return generated;
    } catch (_) {
      // Storage blocked (private mode): still send a per-run id so the request
      // is well formed, accepting that it will not persist.
      return 'web-' + randomId();
    }
  }

  // ---------------------------------------------------------------------
  // Flow
  // ---------------------------------------------------------------------

  function submitJob() {
    // Exactly one format. A multi-select implied the server could produce an
    // arbitrary bundle, but it only ever returns the DrumDash chart plus both
    // audio tracks — `formats` was computed and then never sent, so the
    // checkboxes were decorative.
    var picked = document.querySelector('input[name="tx-format"]:checked');
    var format = picked ? picked.value : '';

    if (!format) {
      showError('Pick an output format.');
      return Promise.reject(new Error('no-format'));
    }

    // Exactly one format. A multi-select implied the server could produce an
    // arbitrary bundle, but it returns one chart family per run.
    if (format !== 'drumdash' && format !== 'rlrr' &&
        format !== 'clonehero' && format !== 'notation') {
      showError('That export format is not available.');
      return Promise.reject(new Error('format-unavailable'));
    }

    chosenFormat = format;

    var installId = getInstallId();

    // One stable identity per browser, derived from the install id.
    //
    // This used to be 'web-' + randomId() PER SUBMISSION, which minted a fresh
    // username on every conversion. Quotas and credits are keyed on the
    // username, so a user was pushed onto a brand-new zero-credit account after
    // every attempt and ended up in a loop of "no credits left".
    //
    // The prefix must be applied defensively: getInstallId() can already return
    // a value starting with "web-" (its private-mode fallback does), and
    // 'web-' + that produced "web-web-…" — a different account from the one the
    // quota row was created under.
    var digest = installId.replace(/^web-/, '').replace(/[^a-zA-Z0-9]/g, '');
    var sessionUsername = 'web-' + digest.slice(0, 40);

    return ensureSession()
      .then(function () {
        setProgress(5, 'Registering job…');
        return fetch(API + '/transcribe', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            username: sessionUsername,
            type: 'audiotranscribe',
            install_id: installId,
            title: el.title.value.trim() || undefined,
            artist: el.artist.value.trim() || undefined,
            platform: 'web',
          }),
        });
      })
      .then(function (res) {
        if (!res.ok) {
          return res.text().then(function (t) {
            throw new Error(apiError(res.status, t));
          });
        }
        return res.json();
      })
      .then(function (submit) {
        // The website is free and never billed a credit, so this should be
        // unreachable. It is kept as a guard: if the server ever does report it,
        // saying "watch an ad" would be wrong — there are no ads on the web —
        // so the message asks the user to retry rather than pointing at a
        // mechanism that does not exist for them.
        if (submit.status === 'insufficient_credits') {
          throw new Error(
            'Transcription is temporarily unavailable. Please try again later.'
          );
        }

        var uploadUrl =
          (submit.upload_urls && (submit.upload_urls.audio || submit.upload_urls.audio_0)) ||
          null;

        if (!uploadUrl) {
          throw new Error('Server did not return an upload URL.');
        }

        setProgress(15, 'Uploading audio…');
        return uploadToGcs(uploadUrl, selectedFile).then(function () {
          return submit.task_id;
        });
      })
      .then(function (taskId) {
        setProgress(70, 'Queuing transcription…');
        return fetch(API + '/confirm', {
          method: 'POST',
          credentials: 'same-origin',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ task_id: taskId, username: sessionUsername, install_id: installId }),
        }).then(function (res) {
          if (!res.ok) {
            return res.text().then(function (t) {
              throw new Error(apiError(res.status, t));
            });
          }
          return taskId;
        });
      })
      .then(function (taskId) {
        setProgress(78, 'Transcribing… this can take a minute.');
        return pollStatus(taskId);
      });
  }

  function uploadToGcs(url, file) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);

      // The signed URL pins a content-type, and GCS rejects the PUT with 403 if
      // the request's Content-Type differs from the signed one. The backend
      // signs these uploads as application/octet-stream, so send exactly that
      // rather than the file's real type — otherwise every upload fails with a
      // 403 that looks like a permissions problem.
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');

      xhr.upload.onprogress = function (e) {
        if (e.lengthComputable) {
          var pct = 15 + (e.loaded / e.total) * 50;
          setProgress(pct, 'Uploading audio… ' + Math.round((e.loaded / e.total) * 100) + '%');
        }
      };

      xhr.onload = function () {
        if (xhr.status >= 200 && xhr.status < 300) resolve();
        else reject(new Error('Upload failed (' + xhr.status + ').'));
      };

      xhr.onerror = function () {
        reject(new Error('Upload failed — check your connection.'));
      };

      xhr.send(file);
    });
  }

  function pollStatus(taskId) {
    return new Promise(function (resolve, reject) {
      var attempts = 0;
      // Idle-based timeout: drum separation alone can exceed 10 minutes on CPU,
      // so counting polls is the wrong measure. IDLE_TIMEOUT_POLLS x 2 s ≈
      // 10 minutes of NO progress before giving up.
      var IDLE_TIMEOUT_POLLS = 300;
      var idlePolls = 0;
      var lastMarker = null;

      function tick() {
        attempts++;
        fetch(API + '/status/' + encodeURIComponent(taskId), {
          credentials: 'same-origin',
          cache: 'no-store',
        })
          .then(function (res) {
            if (!res.ok) throw new Error('Status check failed (' + res.status + ').');
            return res.json();
          })
          .then(function (s) {
            var pct = 78 + Math.min(20, (s.progress || 0) * 20);
            setProgress(pct, s.stage || 'Transcribing…');

            if (s.status === 'completed') {
              resolve(s);
              return;
            }
            if (s.status === 'failed' || s.status === 'not_found') {
              reject(new Error(s.message || 'Transcription failed.'));
              return;
            }

            // Give up only after a LONG idle stretch, not a fixed poll count.
            //
            // A fixed 200 polls (~6.7 min at 2 s) killed jobs that were still
            // running perfectly well: drum separation alone takes >10 min on
            // CPU, so the page reported "Timed out" while the worker was at
            // 350% CPU finishing the job. What matters is whether the job is
            // still MOVING, so track progress/stage and reset the clock on
            // every change.
            var marker = (s.progress || 0) + '|' + (s.stage || '');
            if (marker !== lastMarker) {
              lastMarker = marker;
              idlePolls = 0;
            } else {
              idlePolls++;
            }

            if (idlePolls > IDLE_TIMEOUT_POLLS) {
              reject(new Error(
                'The transcription stopped making progress. Please try again.'
              ));
              return;
            }
            pollTimer = setTimeout(tick, 2000);
          })
          .catch(reject);
      }

      tick();
    });
  }

  function apiError(status, text) {
    if (status === 401) return 'Your session expired. Please reload the page.';
    if (status === 403) return 'This form only works on drumdash.com.';
    if (status === 429) return 'Too many requests — please wait a moment.';
    try {
      var body = JSON.parse(text);
      if (body && body.detail) return String(body.detail);
    } catch (_) { /* not json */ }
    return 'Request failed (' + status + ').';
  }

  function randomId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  // ---------------------------------------------------------------------
  // Results
  // ---------------------------------------------------------------------
  //
  // The user gets ONE file, not six. What comes back from the worker is:
  //   drumdash{,_easy,_medium,_hard}.json  the chart at four difficulties
  //   drums.ogg / no_drums.ogg             the separated audio
  // Those are only useful together — a chart without its audio is not
  // playable — so they are bundled into a single .zip named after the song.
  //
  // The zip is built in the browser (assets/js/zip.js). The files live on GCS
  // behind short-lived signed URLs, so fetching them client-side costs one
  // request each and avoids buffering audio through the Worker.

  var FRIENDLY = {
    drumdash: 'DrumDash chart (Expert)',
    drumdash_easy: 'DrumDash chart (Easy)',
    drumdash_medium: 'DrumDash chart (Medium)',
    drumdash_hard: 'DrumDash chart (Hard)',
    rlrr: 'Paradiddle song (Expert)',
    rlrr_easy: 'Paradiddle song (Easy)',
    rlrr_medium: 'Paradiddle song (Medium)',
    rlrr_hard: 'Paradiddle song (Hard)',
    clonehero: 'Clone Hero chart (notes.chart)',
    clonehero_mid: 'Clone Hero chart (notes.mid)',
    clonehero_ini: 'Clone Hero song.ini',
    notation_musicxml: 'Sheet music (MusicXML)',
    notation_pdf: 'Sheet music (PDF)',
    chart: 'Clone Hero chart',
    midi: 'MIDI',
    drums: 'Drums only',
    no_drums: 'Song without drums',
  };

  // Filename inside the bundle. The app and Paradiddle both key on the base
  // name, so these are the names a user can drop straight into a song folder.
  //
  // Note the deliberate asymmetry with the GCS objects: DrumDash's Expert chart
  // has NO suffix upstream (drumdash.json), but on disk the app writes
  // expert/easy/medium/hard.drumdash and resolves either form. Paradiddle gets
  // an explicit _expert because nothing there treats "no suffix" as Expert.
  var ARCHIVE_NAME = {
    drumdash: 'expert.drumdash',
    drumdash_easy: 'easy.drumdash',
    drumdash_medium: 'medium.drumdash',
    drumdash_hard: 'hard.drumdash',
    rlrr: 'rlrr_expert.json',
    rlrr_easy: 'rlrr_easy.json',
    rlrr_medium: 'rlrr_medium.json',
    rlrr_hard: 'rlrr_hard.json',
    // Clone Hero expects the chart to sit next to the audio it plays. Both
    // forms are included because libraries ship either.
    clonehero: 'notes.chart',
    clonehero_mid: 'notes.mid',
    // song.ini is MANDATORY. Clone Hero skips any folder without one and
    // records it in badsongs.txt ("no valid metadata file (song.ini)"), so a
    // bundle of only notes.chart never shows up in the game.
    clonehero_ini: 'song.ini',
    notation_musicxml: 'drum_notation.musicxml',
    notation_pdf: 'drum_notation.pdf',
    drums: 'drums.ogg',
    no_drums: 'no_drums.ogg',
  };

  /**
   * Which result keys belong to the chosen format.
   *
   * Audio is shared by both formats (a chart without its audio is not
   * playable), so it is always included.
   */
  function keysForFormat(all, format) {
    var chartKeys = format === 'rlrr'
      ? ['rlrr', 'rlrr_easy', 'rlrr_medium', 'rlrr_hard']
      : format === 'clonehero'
        // A Clone Hero song is a FOLDER. song.ini is what makes it load at
        // all; the audio is the drumless stem the job already ships.
        ? ['clonehero', 'clonehero_mid', 'clonehero_ini']
        : format === 'notation'
          // The PDF is only produced when LilyPond is installed on the worker,
          // so it is optional; MusicXML always is not.
          ? ['notation_musicxml', 'notation_pdf']
          : ['drumdash', 'drumdash_easy', 'drumdash_medium', 'drumdash_hard'];

    // Accept either the download_urls object or an array of its keys.
    //
    // This is not defensive padding: renderResults passes Object.keys(urls),
    // and calling Object.keys() on that ARRAY yields ["0","1","2",…] — so every
    // lookup missed and the form reported "the export was not produced" for a
    // job whose files were on GCS all along.
    var source = Array.isArray(all) ? all : Object.keys(all || {});

    var out = [];
    source.forEach(function (k) {
      if (chartKeys.indexOf(k) !== -1) { out.push(k); return; }
      // Sheet music stands alone: a score is a document, not a chart plus audio.
      if (format !== 'notation' && (k === 'drums' || k === 'no_drums')) out.push(k);
    });

    // Keep a predictable order: Expert first, then the rest, then audio.
    out.sort(function (a, b) {
      var rank = function (k) {
        if (k === chartKeys[0]) return 0;
        if (chartKeys.indexOf(k) !== -1) return 1;
        return 2;
      };
      return rank(a) - rank(b) || a.localeCompare(b);
    });
    return out;
  }

  function slug(text, fallback) {
    var s = String(text || '').trim().toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60);
    return s || fallback;
  }

  function zipName() {
    var title = slug(el.title.value, '');
    var artist = slug(el.artist.value, '');
    if (title && artist) return artist + '-' + title + '.zip';
    if (title) return title + '.zip';
    // No metadata: use the picked file's name so the download is still obvious.
    var file = (el.file.files && el.file.files[0]) || selectedFile;
    var base = file && file.name ? file.name.replace(/\.[^.]+$/, '') : '';
    return slug(base, 'drumdash-chart') + '.zip';
  }

  /** Fetch one signed URL as bytes, tolerating failure. */
  function fetchBytes(url) {
    return fetch(url, { mode: 'cors' }).then(function (res) {
      if (!res.ok) throw new Error('HTTP ' + res.status);
      return res.arrayBuffer();
    });
  }

  function renderResults(status) {
    var urls = status.download_urls || {};
    var allKeys = Object.keys(urls);

    if (!allKeys.length) {
      showError('Transcription finished but no files were returned.');
      return;
    }

    // Show ONLY the chosen format. The worker returns both DrumDash and
    // Paradiddle charts; mixing them into one archive would be exactly the
    // multi-format bundle this form stopped offering.
    var keys = keysForFormat(allKeys, chosenFormat);

    if (!keys.length) {
      var label = chosenFormat === 'rlrr' ? 'Paradiddle'
        : chosenFormat === 'clonehero' ? 'Clone Hero'
        : chosenFormat === 'notation' ? 'Sheet music' : 'DrumDash';
      showError(
        'The ' + label + ' export was not produced. Try again, or choose the ' +
        'other format.'
      );
      return;
    }

    el.downloads.innerHTML = '';

    // Lead with the bundle: one click, everything included.
    var zipBtn = document.createElement('button');
    zipBtn.type = 'button';
    zipBtn.className = 'tx-download tx-download-primary';
    zipBtn.innerHTML =
      '<span>Download everything (.zip)</span>' +
      '<span class="tx-download-ext">' + keys.length + ' files</span>';
    zipBtn.addEventListener('click', function () {
      buildAndSaveZip(zipBtn, urls, keys);
    });
    el.downloads.appendChild(zipBtn);

    // Then the individual files, for anyone who wants just one.
    var details = document.createElement('details');
    details.className = 'tx-downloads-more';
    var summary = document.createElement('summary');
    summary.textContent = 'Or download individual files';
    details.appendChild(summary);

    var list = document.createElement('div');
    list.className = 'tx-download-list';

    keys.forEach(function (key) {
      var a = document.createElement('a');
      a.className = 'tx-download';
      a.href = urls[key];
      a.target = '_blank';
      a.rel = 'noopener';
      a.download = '';

      var label = document.createElement('span');
      label.textContent = FRIENDLY[key] || key;
      a.appendChild(label);

      var ext = document.createElement('span');
      ext.className = 'tx-download-ext';
      ext.textContent = extOf(urls[key]);
      a.appendChild(ext);

      list.appendChild(a);
    });

    details.appendChild(list);
    el.downloads.appendChild(details);

    el.results.classList.add('tx-visible');
  }

  function buildAndSaveZip(btn, urls, keys) {
    var original = btn.innerHTML;
    btn.disabled = true;
    btn.innerHTML = '<span>Preparing download…</span><span class="tx-download-ext">' +
      '0/' + keys.length + '</span>';

    if (!window.DrumDashZip) {
      // No zip implementation: fall back to the plain links rather than fail.
      btn.disabled = false;
      btn.innerHTML = original;
      showError('Could not build the archive in this browser. Use the individual files below.');
      return;
    }

    var entries = [];
    var done = 0;

    var requests = keys.map(function (key) {
      return fetchBytes(urls[key])
        .then(function (buf) {
          // Name inside the zip by what it IS, not by the opaque GCS key, so
          // the contents can be dropped into a game's song folder directly.
          var fileName = ARCHIVE_NAME[key] || (key + '.' + (extOf(urls[key]) || 'bin'));
          entries.push({ name: fileName, bytes: new Uint8Array(buf) });
        })
        .catch(function () { /* skip an unreadable file, keep the rest */ })
        .then(function () {
          done++;
          var tail = btn.querySelector('.tx-download-ext');
          if (tail) tail.textContent = done + '/' + keys.length;
        });
    });

    Promise.all(requests).then(function () {
      if (!entries.length) {
        btn.disabled = false;
        btn.innerHTML = original;
        showError('None of the result files could be downloaded. Try the individual files below.');
        return;
      }

      // Order the archive so the chart JSON comes first — it is the thing most
      // users open, and it keeps the listing predictable.
      entries.sort(function (a, b) { return a.name.localeCompare(b.name); });

      var blob = window.DrumDashZip.build(entries);
      var href = URL.createObjectURL(blob);
      var a = document.createElement('a');
      a.href = href;
      a.download = zipName();
      document.body.appendChild(a);
      a.click();
      a.remove();

      // Revoke later: revoking immediately cancels the download in some builds.
      setTimeout(function () { URL.revokeObjectURL(href); }, 60000);

      btn.disabled = false;
      btn.innerHTML = '<span>Download again (.zip)</span>' +
        '<span class="tx-download-ext">' + entries.length + ' files</span>';
    });
  }


  function extOf(url) {
    try {
      var path = new URL(url, location.origin).pathname;
      var m = path.match(/\.([a-z0-9]{2,5})$/i);
      return m ? m[1] : 'file';
    } catch (_) {
      return 'file';
    }
  }

  // ---------------------------------------------------------------------
  // Submit
  // ---------------------------------------------------------------------

  el.form.addEventListener('submit', function (e) {
    e.preventDefault();
    clearError();

    if (!selectedFile) {
      showError('Choose an audio file first.');
      return;
    }
    if (selectedFile.size > 60 * 1024 * 1024) {
      showError('That file is over 60 MB. Please use a shorter track.');
      return;
    }
    if (pollTimer) clearTimeout(pollTimer);

    el.results.classList.remove('tx-visible');
    setBusy(true);
    setProgress(0, 'Starting…');

    submitJob()
      .then(function (status) {
        setProgress(100, 'Done');
        hideProgress();
        renderResults(status);
      })
      .catch(function (err) {
        if (err && err.message === 'no-format') return; // already shown
        hideProgress();
        showError((err && err.message) || 'Something went wrong.');
      })
      .then(function () {
        setBusy(false);
      });
  });
})();
