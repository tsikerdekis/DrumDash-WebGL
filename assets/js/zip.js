/**
 * Minimal ZIP writer (STORE method, no compression).
 *
 * Why hand-rolled: the results page needs to hand the user ONE file instead of
 * six separate downloads. A full zip library would be another third-party
 * dependency on a public page, and the payload here is JSON plus already-
 * compressed OGG — deflate would buy almost nothing on either. A store-only
 * archive is ~100 lines and has no supply-chain or CDN-availability risk.
 *
 * Format reference: PKWARE APPNOTE, sections 4.3.6 (local file header),
 * 4.3.7 (central directory) and 4.3.12 (end of central directory).
 *
 * All multi-byte fields are little-endian. Filenames are written as ASCII/UTF-8
 * with the language-encoding flag (bit 11) set so non-ASCII titles survive.
 */
(function () {
  'use strict';

  // CRC-32 (IEEE 802.3) lookup table, built once.
  var CRC_TABLE = (function () {
    var table = new Uint32Array(256);
    for (var i = 0; i < 256; i++) {
      var c = i;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      table[i] = c >>> 0;
    }
    return table;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function utf8(str) {
    return new TextEncoder().encode(str);
  }

  /** Dos time/date, fixed to a constant so archives are reproducible. */
  function dosDateTime() {
    // 2026-01-01 00:00:00
    var time = 0;
    var date = ((2026 - 1980) << 9) | (1 << 5) | 1;
    return { time: time, date: date };
  }

  /**
   * Build a ZIP from [{ name, bytes }] and return a Blob.
   * `bytes` may be a Uint8Array, ArrayBuffer, or string.
   */
  function build(entries) {
    var dt = dosDateTime();
    var locals = [];
    var centrals = [];
    var offset = 0;

    entries.forEach(function (entry) {
      var nameBytes = utf8(entry.name);

      var data;
      if (entry.bytes instanceof Uint8Array) data = entry.bytes;
      else if (entry.bytes instanceof ArrayBuffer) data = new Uint8Array(entry.bytes);
      else data = utf8(String(entry.bytes == null ? '' : entry.bytes));

      var crc = crc32(data);
      var size = data.length;

      // ---- local file header (30 bytes + name) ----
      var local = new Uint8Array(30 + nameBytes.length);
      var lv = new DataView(local.buffer);
      lv.setUint32(0, 0x04034b50, true);   // signature
      lv.setUint16(4, 20, true);           // version needed
      lv.setUint16(6, 0x0800, true);       // flags: UTF-8 names
      lv.setUint16(8, 0, true);            // method: store
      lv.setUint16(10, dt.time, true);
      lv.setUint16(12, dt.date, true);
      lv.setUint32(14, crc, true);
      lv.setUint32(18, size, true);        // compressed size
      lv.setUint32(22, size, true);        // uncompressed size
      lv.setUint16(26, nameBytes.length, true);
      lv.setUint16(28, 0, true);           // extra length
      local.set(nameBytes, 30);

      // ---- central directory header (46 bytes + name) ----
      var central = new Uint8Array(46 + nameBytes.length);
      var cv = new DataView(central.buffer);
      cv.setUint32(0, 0x02014b50, true);   // signature
      cv.setUint16(4, 20, true);           // version made by
      cv.setUint16(6, 20, true);           // version needed
      cv.setUint16(8, 0x0800, true);       // flags: UTF-8 names
      cv.setUint16(10, 0, true);           // method: store
      cv.setUint16(12, dt.time, true);
      cv.setUint16(14, dt.date, true);
      cv.setUint32(16, crc, true);
      cv.setUint32(20, size, true);
      cv.setUint32(24, size, true);
      cv.setUint16(28, nameBytes.length, true);
      cv.setUint16(30, 0, true);           // extra length
      cv.setUint16(32, 0, true);           // comment length
      cv.setUint16(34, 0, true);           // disk number
      cv.setUint16(36, 0, true);           // internal attrs
      cv.setUint32(38, 0, true);           // external attrs
      cv.setUint32(42, offset, true);      // offset of local header
      central.set(nameBytes, 46);

      locals.push(local, data);
      centrals.push(central);
      offset += local.length + size;
    });

    var centralSize = centrals.reduce(function (n, c) { return n + c.length; }, 0);

    // ---- end of central directory (22 bytes) ----
    var end = new Uint8Array(22);
    var ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(4, 0, true);
    ev.setUint16(6, 0, true);
    ev.setUint16(8, entries.length, true);
    ev.setUint16(10, entries.length, true);
    ev.setUint32(12, centralSize, true);
    ev.setUint32(16, offset, true);
    ev.setUint16(20, 0, true);

    return new Blob(locals.concat(centrals, [end]), { type: 'application/zip' });
  }

  window.DrumDashZip = { build: build };
})();
