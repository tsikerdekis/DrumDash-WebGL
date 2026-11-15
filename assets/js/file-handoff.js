/**
 * Carries a chosen File from the homepage to the converter page.
 *
 * Why this exists
 * ---------------
 * The homepage takes a file and then navigates to transcription.html to run the
 * conversion. The file has to get across that navigation, and every obvious
 * transport fails:
 *
 *   - a global variable  -> index.html -> transcription.html is a REAL document
 *     load, not a same-document (fragment) navigation, so window state is gone.
 *     The original code assumed otherwise and the file was always lost.
 *   - sessionStorage     -> holds strings only; a File cannot be serialised.
 *   - a URL              -> same problem, plus size limits.
 *
 * IndexedDB can store a Blob/File directly and read it back in the next
 * document, which is the one thing that actually works. It is same-origin, so
 * the file never leaves the browser and nothing is uploaded twice.
 *
 * Failure is always soft: if IndexedDB is unavailable (private mode, disabled
 * storage) put() resolves anyway and the converter simply asks for the file
 * again. A dead end here must never block a conversion.
 */
(function () {
  'use strict';

  var DB_NAME = 'drumdash-handoff';
  var STORE = 'files';
  var KEY = 'pending';
  var MAX_AGE_MS = 10 * 60 * 1000;   // 10 minutes

  function openDb() {
    return new Promise(function (resolve, reject) {
      if (!window.indexedDB) return reject(new Error('no-indexeddb'));
      var req;
      try {
        req = window.indexedDB.open(DB_NAME, 1);
      } catch (e) {
        return reject(e);
      }
      req.onupgradeneeded = function () {
        var db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = function () { resolve(req.result); };
      req.onerror = function () { reject(req.error || new Error('idb-open-failed')); };
    });
  }

  function withStore(mode, fn) {
    return openDb().then(function (db) {
      return new Promise(function (resolve, reject) {
        var tx = db.transaction(STORE, mode);
        var store = tx.objectStore(STORE);
        var result;
        try {
          result = fn(store);
        } catch (e) {
          db.close();
          return reject(e);
        }
        tx.oncomplete = function () {
          db.close();
          resolve(result && result.__req ? result.__req.result : result);
        };
        tx.onerror = function () {
          db.close();
          reject(tx.error || new Error('idb-tx-failed'));
        };
        tx.onabort = function () {
          db.close();
          reject(tx.error || new Error('idb-tx-aborted'));
        };
      });
    });
  }

  /** Store a File for the next page. Always resolves; never rejects. */
  function put(file) {
    if (!file) return Promise.resolve(false);
    return withStore('readwrite', function (store) {
      var rec = { file: file, name: file.name, type: file.type, at: Date.now() };
      return { __req: store.put(rec, KEY) };
    })
      .then(function () { return true; })
      .catch(function () { return false; });   // soft failure, see header
  }

  /** Read and delete the stored File. Resolves to a File or null. */
  function take() {
    var rec = null;

    // 1) Read the record WITHOUT deleting it. The Blob inside is backed by
    //    IndexedDB storage; deleting the record while a File still points at it
    //    makes a later xhr.send(file) fail with a bare network error.
    return withStore('readonly', function (store) {
      var getReq = store.get(KEY);
      getReq.onsuccess = function () { rec = getReq.result; };
      return null;
    })
      .then(function () {
        if (!rec || !rec.file) return null;

        // Stale entries would resurrect a file the user picked long ago.
        if (rec.at && Date.now() - rec.at > MAX_AGE_MS) return null;

        // 2) Copy the bytes into memory so the File no longer depends on the DB.
        var blob = rec.file;
        var read = blob.arrayBuffer
          ? blob.arrayBuffer()
          : new Promise(function (res, rej) {
              var fr = new FileReader();
              fr.onload = function () { res(fr.result); };
              fr.onerror = function () { rej(fr.error); };
              fr.readAsArrayBuffer(blob);
            });

        return read.then(function (buf) {
          var type = rec.type || blob.type || 'audio/mpeg';
          var name = rec.name || 'audio.mp3';
          var lm = blob.lastModified || rec.at || Date.now();
          try {
            return new File([buf], name, { type: type, lastModified: lm });
          } catch (_) {
            return new Blob([buf], { type: type });
          }
        });
      })
      .then(function (file) {
        // 3) Now that the data is in memory, remove the stored copy.
        return withStore('readwrite', function (store) {
          store.delete(KEY);
          return null;
        }).catch(function () {}).then(function () { return file; });
      })
      .catch(function () { return null; });
  }

  window.DrumDashFileHandoff = { put: put, take: take };
})();
