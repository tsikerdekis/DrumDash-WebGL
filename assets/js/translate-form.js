/**
 * DrumDash chart converter (translate.html).
 *
 * Same Worker flow as transcribe-form.js, with type 'translate':
 *   POST /api/session -> POST /api/transcribe (signed PUT URLs, one per chart file)
 *   -> PUT files to GCS -> POST /api/confirm -> poll GET /api/status/:id -> downloads.
 * No audio is uploaded. One file in; the format and its difficulties are detected in the
 * browser, and the user picks which lower difficulties to generate.
 */
(function () {
  'use strict';

  var API = (window.DrumDashApiConfig && window.DrumDashApiConfig.base) || '/api';
  var MAX_BYTES = 10 * 1024 * 1024;
  var DIFFS = ['expert', 'hard', 'medium', 'easy'];
  var LOWER = ['hard', 'medium', 'easy'];

  function $(id) { return document.getElementById(id); }
  var el = {
    form: $('tr-form'), submit: $('tr-submit'), title: $('tr-title'), artist: $('tr-artist'),
    drop: $('tr-drop'), file: $('tr-file'), dropText: $('tr-drop-text'), detected: $('tr-detected'),
    progress: $('tr-progress'), fill: $('tr-progress-fill'), label: $('tr-progress-label'),
    error: $('tr-error'), info: $('tr-info'), results: $('tr-results'), downloads: $('tr-downloads'),
    sheet: $('tr-sheet'),
  };
  if (!el.form) return;

  var pollTimer = null;
  var INSTALL_KEY = 'dd_web_install_id';

  function randomId() {
    if (window.crypto && window.crypto.randomUUID) return window.crypto.randomUUID();
    return 'x' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  }
  function getInstallId() {
    try {
      var v = window.localStorage.getItem(INSTALL_KEY);
      if (v) return v;
      v = randomId();
      window.localStorage.setItem(INSTALL_KEY, v);
      return v;
    } catch (_) { return 'web-' + randomId(); }
  }
  function radio(name) {
    var r = document.querySelector('input[name="' + name + '"]:checked');
    return r ? r.value : '';
  }
  function setProgress(p, text) {
    el.progress.classList.add('tx-visible');
    el.fill.style.width = Math.max(0, Math.min(100, p)) + '%';
    if (text) el.label.textContent = text;
  }
  function hideProgress() { el.progress.classList.remove('tx-visible'); }
  function showError(m) { el.info.classList.remove('tx-visible'); el.error.textContent = m; el.error.classList.add('tx-visible'); }
  function clearError() { el.error.classList.remove('tx-visible'); el.info.classList.remove('tx-visible'); }
  function setBusy(b) { el.submit.disabled = b; el.submit.textContent = b ? 'Working…' : 'Convert'; }

  // ---- Detection ----------------------------------------------------------
  // Paradiddle .rlrr files are UTF-16 (BOM FF FE); the others are UTF-8.
  function decodeText(buf) {
    var u = new Uint8Array(buf);
    if (u[0] === 0xff && u[1] === 0xfe) return new TextDecoder('utf-16le').decode(u.subarray(2));
    if (u[0] === 0xfe && u[1] === 0xff) return new TextDecoder('utf-16be').decode(u.subarray(2));
    var t = new TextDecoder('utf-8').decode(u);
    return t.charCodeAt(0) === 0xfeff ? t.slice(1) : t;
  }

  function difficultyFromName(name) {
    var m = /(expert|hard|medium|easy)/i.exec(name || '');
    return m ? m[1].toLowerCase() : 'expert';
  }

  function str(v) { return typeof v === 'string' ? v.trim() : ''; }

  /** `Name = "Song"` inside a .chart's [Song] block. */
  function chartField(text, key) {
    var m = new RegExp('^\\s*' + key + '\\s*=\\s*"?([^"\\r\\n]*)"?\\s*$', 'mi').exec(text);
    return m ? m[1].trim() : '';
  }

  /** -> { format, difficulties:[...], title, artist } or null when not a drum chart. */
  function detect(text, name) {
    if (/^\s*\[Song\]/m.test(text)) {
      var found = [];
      DIFFS.forEach(function (d) {
        if (new RegExp('^\\s*\\[' + d + 'Drums\\]', 'mi').test(text)) found.push(d);
      });
      return found.length ? {
        format: 'clonehero', difficulties: found,
        title: chartField(text, 'Name'), artist: chartField(text, 'Artist'),
      } : null;
    }
    var obj;
    try { obj = JSON.parse(text); } catch (_) { return null; }
    if (!obj || typeof obj !== 'object') return null;
    var diff = difficultyFromName(name);
    var meta = obj.recordingMetadata || {};
    if (Array.isArray(obj.events)) {
      return { format: 'rlrr', difficulties: [diff],
               title: str(meta.title) || str(obj.title), artist: str(meta.artist) || str(obj.artist) };
    }
    if (Array.isArray(obj.notes)) {
      return { format: 'drumdash', difficulties: [diff], title: str(obj.title), artist: str(obj.artist) };
    }
    return null;
  }

  var FORMAT_LABEL = { rlrr: 'Paradiddle', drumdash: 'DrumDash', clonehero: 'Clone Hero' };
  var picked = null;     // File
  var detectedInfo = null;

  /** Lower difficulties that can be generated: those below the highest one provided. */
  function generatable(provided) {
    var out = {};
    LOWER.forEach(function (t) {
      var ti = DIFFS.indexOf(t);
      var hasHigher = provided.some(function (p) { return DIFFS.indexOf(p) < ti; });
      out[t] = hasHigher && provided.indexOf(t) === -1;
    });
    return out;
  }

  function applyDetection(info) {
    var can = info ? generatable(info.difficulties) : { hard: false, medium: false, easy: false };
    LOWER.forEach(function (t) {
      var box = document.querySelector('input[name="tr-diff"][value="' + t + '"]');
      var note = $('tr-note-' + t);
      box.disabled = !can[t];
      box.checked = can[t];
      note.textContent = !info ? '' : can[t] ? 'generated for you' : 'already in your file or higher than it';
    });
  }

  // Fill Artist/Title from the chart, but never over something the user typed.
  var edited = { title: false, artist: false };
  ['title', 'artist'].forEach(function (k) {
    el[k].addEventListener('input', function () { edited[k] = el[k].value.trim() !== ''; });
  });
  function prefill(info) {
    ['title', 'artist'].forEach(function (k) {
      if (info[k] && !edited[k]) el[k].value = info[k];
    });
  }

  function chooseFile(file) {
    picked = file || null;
    detectedInfo = null;
    el.detected.hidden = true;
    el.detected.classList.remove('tr-bad');
    clearError();
    applyDetection(null);
    if (!file) return;
    el.dropText.textContent = file.name + ' (' + (file.size / 1048576).toFixed(2) + ' MB)';
    if (file.size > MAX_BYTES) return showError('That file is over 10 MB.');
    file.arrayBuffer().then(function (buf) {
      var info = null;
      try { info = detect(decodeText(buf), file.name); } catch (_) { info = null; }
      el.detected.hidden = false;
      if (!info) {
        el.detected.classList.add('tr-bad');
        el.detected.textContent = 'This does not look like a Paradiddle, DrumDash or Clone Hero drum chart.';
        return;
      }
      detectedInfo = info;
      el.detected.textContent = 'Detected: ' + FORMAT_LABEL[info.format] + ' chart (' +
        info.difficulties.map(function (d) { return d.charAt(0).toUpperCase() + d.slice(1); }).join(', ') + ')';
      applyDetection(info);
      prefill(info);
      if (!Object.keys(generatable(info.difficulties)).some(function (t) { return generatable(info.difficulties)[t]; })) {
        showError('Nothing to generate: Hard, Medium and Easy all already exist, or the file is Easy.');
      }
    });
  }

  el.file.addEventListener('change', function (e) { chooseFile(e.target.files && e.target.files[0]); });
  ['dragenter', 'dragover'].forEach(function (evt) {
    el.drop.addEventListener(evt, function (e) { e.preventDefault(); el.drop.classList.add('tx-dragover'); });
  });
  ['dragleave', 'drop'].forEach(function (evt) {
    el.drop.addEventListener(evt, function (e) { e.preventDefault(); el.drop.classList.remove('tx-dragover'); });
  });
  el.drop.addEventListener('drop', function (e) {
    var dt = e.dataTransfer;
    if (dt && dt.files && dt.files.length) chooseFile(dt.files[0]);
  });

  function apiError(status, text) {
    if (status === 401) return 'Your session expired. Please reload the page.';
    if (status === 403) return 'This form only works on drumdash.com.';
    if (status === 429) return 'Too many requests — please wait a moment.';
    try { var b = JSON.parse(text); if (b && b.detail) return String(b.detail); } catch (_) {}
    return 'Request failed (' + status + ').';
  }

  function ensureSession() {
    var token = '';
    try { token = (window.turnstile && window.turnstile.getResponse && window.turnstile.getResponse()) || ''; } catch (_) {}
    return fetch(API + '/session', {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ turnstileToken: token }),
    }).then(function (res) {
      // Tokens are single-use (see transcribe-form.js); reset before a retry.
      if (!res.ok && res.status === 403 && window.DrumDashTurnstile) window.DrumDashTurnstile.reset();
      if (!res.ok) throw new Error('Could not start a session (' + res.status + '). Please try again.');
      return res.json();
    });
  }

  function post(path, body) {
    return fetch(API + path, {
      method: 'POST', credentials: 'same-origin',
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    }).then(function (res) {
      if (!res.ok) return res.text().then(function (t) { throw new Error(apiError(res.status, t)); });
      return res.json();
    });
  }

  function put(url, file) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', url, true);
      // The signed URL pins this content type (see transcribe-form.js).
      xhr.setRequestHeader('Content-Type', 'application/octet-stream');
      xhr.onload = function () { xhr.status >= 200 && xhr.status < 300 ? resolve() : reject(new Error('Upload failed (' + xhr.status + ').')); };
      xhr.onerror = function () { reject(new Error('Upload failed — check your connection.')); };
      xhr.send(file);
    });
  }

  function poll(taskId) {
    return new Promise(function (resolve, reject) {
      var idle = 0, last = null;
      (function tick() {
        fetch(API + '/status/' + encodeURIComponent(taskId), { credentials: 'same-origin', cache: 'no-store' })
          .then(function (res) { if (!res.ok) throw new Error('Status check failed (' + res.status + ').'); return res.json(); })
          .then(function (s) {
            setProgress(60 + Math.min(38, (s.progress || 0) * 38), s.stage || 'Converting…');
            if (s.status === 'completed') return resolve(s);
            if (s.status === 'failed' || s.status === 'not_found' || s.error) {
              return reject(new Error(s.message || 'Conversion failed.'));
            }
            var marker = (s.progress || 0) + '|' + (s.stage || '');
            idle = marker === last ? idle + 1 : 0;
            last = marker;
            if (idle > 300) return reject(new Error('The conversion stopped making progress. Please try again.'));
            pollTimer = setTimeout(tick, 2000);
          }).catch(reject);
      })();
    });
  }

  function run(file, info, targets) {
    var installId = getInstallId();
    var digest = installId.replace(/^web-/, '').replace(/[^a-zA-Z0-9]/g, '');
    var username = 'web-' + digest.slice(0, 40);
    // One slot, named for the difficulty the file holds (a .chart holds several; any slot works).
    var slot = 'src_' + (info.format === 'clonehero' ? 'expert' : info.difficulties[0]);
    // Sheet music is a separate product: the job renders two score files per
    // difficulty when asked, which tripled the archive for people who only
    // wanted a playable chart. Ask for it explicitly.
    var wantSheet = !!(el.sheet && el.sheet.checked);

    return ensureSession().then(function () {
      setProgress(5, 'Registering job…');
      return post('/transcribe', {
        username: username, type: 'translate', install_id: installId, platform: 'web',
        input_format: info.format, output_format: radio('tr-out'),
        targets: targets, optional_files: [slot], include_sheet: wantSheet,
        title: el.title.value.trim() || undefined, artist: el.artist.value.trim() || undefined,
      });
    }).then(function (submit) {
      var url = submit.upload_urls && submit.upload_urls[slot];
      if (!url) throw new Error('Server did not return an upload URL.');
      setProgress(15, 'Uploading…');
      return put(url, file).then(function () { return submit.task_id; });
    }).then(function (taskId) {
      setProgress(55, 'Queuing…');
      return post('/confirm', { task_id: taskId, username: username, install_id: installId })
        .then(function () { return poll(taskId); });
    });
  }

  // ---- Results ----
  var CAP = { expert: 'Expert', hard: 'Hard', medium: 'Medium', easy: 'Easy' };
  var CHART_NAMES = {
    drumdash: ['expert.drumdash', 'DrumDash Expert'], drumdash_hard: ['hard.drumdash', 'DrumDash Hard'],
    drumdash_medium: ['medium.drumdash', 'DrumDash Medium'], drumdash_easy: ['easy.drumdash', 'DrumDash Easy'],
    rlrr: ['rlrr_expert.json', 'Paradiddle Expert'], rlrr_hard: ['rlrr_hard.json', 'Paradiddle Hard'],
    rlrr_medium: ['rlrr_medium.json', 'Paradiddle Medium'], rlrr_easy: ['rlrr_easy.json', 'Paradiddle Easy'],
    clonehero: ['notes.chart', 'Clone Hero notes.chart (all difficulties)'],
  };

  function entriesFor(urls) {
    var out = { charts: [], pdf: [], xml: [] };
    Object.keys(CHART_NAMES).forEach(function (k) {
      if (urls[k]) out.charts.push({ key: k, url: urls[k], file: CHART_NAMES[k][0], label: CHART_NAMES[k][1] });
    });
    DIFFS.forEach(function (d) {
      if (urls['sheet_pdf_' + d]) out.pdf.push({ key: 'sheet_pdf_' + d, url: urls['sheet_pdf_' + d], file: 'sheet_' + d + '.pdf', label: CAP[d] + ' sheet music (PDF)' });
      if (urls['sheet_musicxml_' + d]) out.xml.push({ key: 'sheet_musicxml_' + d, url: urls['sheet_musicxml_' + d], file: 'sheet_' + d + '.musicxml', label: CAP[d] + ' sheet music (MusicXML)' });
    });
    return out;
  }

  function link(item) {
    var a = document.createElement('a');
    a.className = 'tx-download';
    a.href = item.url; a.target = '_blank'; a.rel = 'noopener'; a.download = item.file;
    a.innerHTML = '<span></span><span class="tx-download-ext"></span>';
    a.firstChild.textContent = item.label;
    a.lastChild.textContent = item.file.split('.').pop();
    return a;
  }

  function addGroup(title, items) {
    if (!items.length) return;
    var h = document.createElement('p'); h.className = 'tr-group'; h.textContent = title;
    el.downloads.appendChild(h);
    items.forEach(function (i) { el.downloads.appendChild(link(i)); });
  }

  function zipAll(btn, all) {
    var original = btn.innerHTML;
    btn.disabled = true; btn.firstChild.textContent = 'Preparing download…';
    Promise.all(all.map(function (i) {
      return fetch(i.url, { mode: 'cors' }).then(function (r) {
        if (!r.ok) throw new Error('HTTP ' + r.status);
        return r.arrayBuffer();
      }).then(function (buf) { return { name: i.file, bytes: new Uint8Array(buf) }; })
        .catch(function () { return null; });
    })).then(function (entries) {
      entries = entries.filter(Boolean);
      btn.disabled = false; btn.innerHTML = original;
      if (!entries.length) return showError('Could not download the files for the archive. Use the individual links.');
      var href = URL.createObjectURL(window.DrumDashZip.build(entries));
      var a = document.createElement('a');
      a.href = href; a.download = 'converted-chart.zip';
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(function () { URL.revokeObjectURL(href); }, 60000);
    });
  }

  function renderResults(status) {
    var e = entriesFor(status.download_urls || {});
    // Deploy-order guard: an older worker renders sheet music regardless of
    // what we asked for, and the API/site deploy separately. If the box is not
    // ticked, drop those files here too, so the user sees exactly the format
    // they picked no matter which side is older.
    var wantSheet = !!(el.sheet && el.sheet.checked) && status.include_sheet !== false;
    if (!wantSheet) { e.pdf = []; e.xml = []; }
    var all = e.charts.concat(e.pdf, e.xml);
    if (!all.length) return showError('Conversion finished but no files were returned.');

    el.downloads.innerHTML = '';
    if (window.DrumDashZip && all.length > 1) {
      var zip = document.createElement('button');
      zip.type = 'button'; zip.className = 'tx-download tx-download-primary';
      zip.innerHTML = '<span>Download everything (.zip)</span><span class="tx-download-ext">' + all.length + ' files</span>';
      zip.addEventListener('click', function () { zipAll(zip, all); });
      el.downloads.appendChild(zip);
    }
    addGroup('Charts', e.charts);
    addGroup('Sheet music PDFs', e.pdf);
    addGroup('Sheet music MusicXML', e.xml);

    var gen = status.generated_difficulties || {};
    var made = Object.keys(gen);
    if (made.length) {
      el.info.textContent = 'Generated ' + made.join(', ') + ' from ' +
        made.map(function (t) { return gen[t]; }).filter(function (v, i, a) { return a.indexOf(v) === i; }).join(' / ') + '.';
      el.info.classList.add('tx-visible');
    }
    // Only warn about missing PDFs when sheet music was actually requested;
    // otherwise "PDF rendering is not available" is noise about a file the
    // user never asked for.
    if (wantSheet && !e.pdf.length) {
      el.info.textContent = (el.info.textContent ? el.info.textContent + ' ' : '') +
        'PDF rendering is not available right now; MusicXML files are included and open in MuseScore.';
      el.info.classList.add('tx-visible');
    }
    el.results.classList.add('tx-visible');
  }

  el.form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    clearError();
    if (!picked) return showError('Choose a chart file first.');
    if (!detectedInfo) return showError('That file was not recognised as a drum chart.');
    var targets = Array.prototype.map.call(
      document.querySelectorAll('input[name="tr-diff"]:checked:not(:disabled)'),
      function (b) { return b.value; });
    if (!targets.length) return showError('Select at least one difficulty to generate.');
    if (pollTimer) clearTimeout(pollTimer);
    el.results.classList.remove('tx-visible');
    setBusy(true); setProgress(0, 'Starting…');
    run(picked, detectedInfo, targets)
      .then(function (s) { setProgress(100, 'Done'); hideProgress(); renderResults(s); })
      .catch(function (err) { hideProgress(); showError((err && err.message) || 'Something went wrong.'); })
      .then(function () { setBusy(false); });
  });
})();
