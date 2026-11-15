/**
 * Homepage "quick transcribe" bar.
 *
 * A compact single-file CTA that hands the chosen song to the converter page,
 * where the upload actually happens.
 *
 * Why hand off instead of converting here: a conversion takes tens of seconds
 * and shows progress, format choices and download links. Duplicating that in a
 * hero widget would mean two copies of the same flow to keep in sync, and it
 * would trap the user in the hero with nowhere to see the result.
 *
 * Passing the file across a page navigation
 * -----------------------------------------
 * index.html -> transcription.html is a real document load (only a fragment
 * change would keep the document alive), so a global variable is gone by the
 * time the converter runs. That was the original bug: the file was stashed on
 * `window` and silently never arrived.
 *
 * `file-handoff.js` puts the File in IndexedDB, which the converter reads back
 * on load. If that fails for any reason the converter says so explicitly rather
 * than showing an empty form that looks ready.
 */
(function () {
  'use strict';

  var form = document.getElementById('quick-transcribe');
  if (!form) return;

  var fileInput = document.getElementById('qt-file');
  var label = document.getElementById('qt-filename');
  var drop = document.getElementById('qt-drop');
  var submit = document.getElementById('qt-submit');
  var selected = null;

  function describe(file) {
    if (!file) return 'Drop a song or click to browse';
    var mb = (file.size / 1048576).toFixed(1);
    return file.name + ' (' + mb + ' MB)';
  }

  function choose(file) {
    if (!file) return;
    selected = file;
    if (label) label.textContent = describe(file);
    if (drop) drop.classList.add('qt-has-file');
    if (submit) {
      submit.disabled = false;
      // Say what will happen, so the click is not a surprise page change.
      submit.innerHTML = 'Transcribe Now <span aria-hidden="true">→</span>';
    }
  }

  if (fileInput) {
    fileInput.addEventListener('change', function (e) {
      choose(e.target.files && e.target.files[0]);
    });
  }

  if (drop) {
    ['dragenter', 'dragover'].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.add('qt-dragover');
      });
    });
    ['dragleave', 'drop'].forEach(function (evt) {
      drop.addEventListener(evt, function (e) {
        e.preventDefault();
        drop.classList.remove('qt-dragover');
      });
    });
    drop.addEventListener('drop', function (e) {
      var dt = e.dataTransfer;
      if (dt && dt.files && dt.files.length) choose(dt.files[0]);
    });
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    if (!selected) return;

    var file = selected;

    // Carry the current query string across. The converter resolves its API
    // base from ?api=..., so dropping it would silently send a local test at
    // the same-origin /api and fail with a 404 that looks like a server bug.
    var go = function () {
      var search = window.location.search || '';
      window.location.assign('transcription.html' + search + '#convert');
    };

    // Remember that a handoff was EXPECTED, so the converter can say "your file
    // didn't carry over" instead of silently showing an empty form.
    try {
      window.sessionStorage.setItem('dd_handoff_pending', '1');
    } catch (_) { /* private mode: the flag is a nicety, not required */ }

    if (window.DrumDashFileHandoff) {
      // Never block navigation on storage: a rejected put() still navigates.
      window.DrumDashFileHandoff.put(file).then(go, go);
    } else {
      go();
    }
  });
})();
