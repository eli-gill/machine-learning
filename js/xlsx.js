/* Excel (.xlsx) support with no dependencies.
   DM.xlsx.read(arrayBuffer)  -> Promise of { sheets: [{ name, rows }] }  (rows = arrays of strings, first row = header)
   DM.xlsx.write(table)       -> Uint8Array holding a one-sheet workbook
   An .xlsx file is a zip of XML files. Reading needs the browser's DecompressionStream to inflate them;
   writing stores the files uncompressed, so it needs nothing. */
window.DM = window.DM || {};
(function (DM) {
  'use strict';
  const U = DM.util;
  const X = {};
  const MAX_XML = 80e6;   // refuse sheets that unpack to more than ~80 MB of XML

  /* ---------- zip reading ---------- */
  async function inflate(data) {
    if (typeof DecompressionStream === 'undefined') throw new Error('This browser cannot unpack .xlsx files. Please use a current Chrome, Edge, Firefox or Safari, or save the sheet as CSV.');
    const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
    return new Uint8Array(await new Response(stream).arrayBuffer());
  }

  function openZip(buf) {
    const b = new Uint8Array(buf), dv = new DataView(b.buffer, b.byteOffset, b.byteLength);
    let e = -1;
    for (let i = b.length - 22; i >= Math.max(0, b.length - 22 - 65535); i--) if (dv.getUint32(i, true) === 0x06054b50) { e = i; break; }
    if (e < 0) {
      if (b.length > 7 && b[0] === 0xD0 && b[1] === 0xCF && b[2] === 0x11 && b[3] === 0xE0) throw new Error('This is an old Excel (.xls) file. In Excel use File > Save As > Excel Workbook (.xlsx), or save it as CSV.');
      throw new Error('This does not look like an .xlsx file (it is not a zip archive).');
    }
    const count = dv.getUint16(e + 10, true), dec = new TextDecoder('utf-8');
    const entries = new Map();
    let p = dv.getUint32(e + 16, true);
    for (let i = 0; i < count; i++) {
      if (p + 46 > b.length || dv.getUint32(p, true) !== 0x02014b50) throw new Error('The .xlsx file is damaged (bad zip directory).');
      const flags = dv.getUint16(p + 8, true), nlen = dv.getUint16(p + 28, true), elen = dv.getUint16(p + 30, true), clen = dv.getUint16(p + 32, true);
      const name = dec.decode(b.subarray(p + 46, p + 46 + nlen));
      entries.set(name, { flags, method: dv.getUint16(p + 10, true), csize: dv.getUint32(p + 20, true), usize: dv.getUint32(p + 24, true), offset: dv.getUint32(p + 42, true) });
      p += 46 + nlen + elen + clen;
    }
    async function bytes(name) {
      const en = entries.get(name);
      if (!en) return null;
      if (en.flags & 1) throw new Error('This workbook is password-protected. Remove the password in Excel first.');
      if (en.csize === 0xFFFFFFFF || en.usize === 0xFFFFFFFF) throw new Error('This workbook is too large for the browser reader.');
      if (en.usize > MAX_XML) throw new Error('This sheet is too large to open in the browser. Please use a smaller sample.');
      const h = en.offset, start = h + 30 + dv.getUint16(h + 26, true) + dv.getUint16(h + 28, true);
      const raw = b.subarray(start, start + en.csize);
      if (en.method === 0) return raw;
      if (en.method === 8) return inflate(raw);
      throw new Error('Unsupported compression in the .xlsx file.');
    }
    return {
      has: name => entries.has(name),
      async text(name) {
        const d = await bytes(name);
        return d ? dec.decode(d).replace(/^﻿/, '') : null;
      }
    };
  }

  /* ---------- a small, forgiving XML parser ---------- */
  const decodeEntities = s => s.indexOf('&') < 0 ? s : s.replace(/&(#x[0-9a-f]+|#\d+|amp|lt|gt|quot|apos);/gi, (m, g) => {
    if (g[0] === '#') { const c = g[1] === 'x' || g[1] === 'X' ? parseInt(g.slice(2), 16) : parseInt(g.slice(1), 10); try { return String.fromCodePoint(c); } catch (e) { return ''; } }
    return { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }[g.toLowerCase()];
  });
  // Excel escapes characters XML cannot hold as _xHHHH_ (e.g. _x000D_ for a carriage return).
  const unescapeExcel = s => s.indexOf('_x') < 0 ? s : s.replace(/_x([0-9A-Fa-f]{4})_/g, (m, h) => String.fromCharCode(parseInt(h, 16)));

  function parseXml(src) {
    const root = { n: '#root', a: {}, k: [], t: '' }, stack = [root];
    const re = /<!--[\s\S]*?-->|<\?[\s\S]*?\?>|<!\[CDATA\[([\s\S]*?)\]\]>|<!DOCTYPE[^>]*>|<(\/?)([^\s\/>]+)((?:\s+[^\s=\/>]+\s*=\s*(?:"[^"]*"|'[^']*'))*)\s*(\/?)>|([^<]+)/g;
    const attrRe = /([^\s=]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
    let m;
    while ((m = re.exec(src))) {
      const top = stack[stack.length - 1];
      if (m[1] !== undefined) top.t += m[1];
      else if (m[6] !== undefined) top.t += decodeEntities(m[6]);
      else if (m[3] !== undefined) {
        const name = m[3].replace(/^.*:/, '');
        if (m[2]) {   // closing tag
          for (let i = stack.length - 1; i > 0; i--) if (stack[i].n === name) { stack.length = i; break; }
          continue;
        }
        const a = {};
        let am; attrRe.lastIndex = 0;
        while ((am = attrRe.exec(m[4]))) a[am[1].replace(/^.*:/, '')] = decodeEntities(am[2] !== undefined ? am[2] : am[3]);
        const el = { n: name, a, k: [], t: '' };
        top.k.push(el);
        if (!m[5]) stack.push(el);
      }
    }
    return root;
  }
  const kids = (el, name) => el ? el.k.filter(c => c.n === name) : [];
  const kid = (el, name) => el ? el.k.find(c => c.n === name) : undefined;
  // Text of a shared/inline string: every <t>, skipping phonetic (<rPh>) runs.
  function richText(el) {
    let s = '';
    (function walk(e) { e.k.forEach(c => { if (c.n === 't') s += c.t; else if (c.n !== 'rPh') walk(c); }); })(el);
    return unescapeExcel(s);
  }

  /* ---------- dates ---------- */
  const BUILTIN_DATE = new Set([14, 15, 16, 17, 18, 19, 20, 21, 22, 27, 28, 29, 30, 31, 32, 33, 34, 35, 36, 45, 46, 47, 50, 51, 52, 53, 54, 55, 56, 57, 58]);
  const isDateFormat = code => /[dmyhs]/i.test(String(code).replace(/"[^"]*"|\\.|\[[^\]]*\]|_.|\*./g, ''));
  const p2 = n => (n < 10 ? '0' : '') + n;
  function serialToText(v, date1904) {
    const ms = Math.round(v * 86400) * 1000;
    const d = new Date((date1904 ? Date.UTC(1904, 0, 1) : Date.UTC(1899, 11, 30)) + ms);
    const time = p2(d.getUTCHours()) + ':' + p2(d.getUTCMinutes()) + ':' + p2(d.getUTCSeconds());
    if (v >= 0 && v < 1) return time;
    const day = d.getUTCFullYear() + '-' + p2(d.getUTCMonth() + 1) + '-' + p2(d.getUTCDate());
    return Math.abs(v - Math.floor(v)) < 1e-9 ? day : day + ' ' + time;
  }

  /* ---------- reading ---------- */
  const colIndex = ref => { let n = 0; const m = /^[A-Za-z]+/.exec(ref || ''); if (!m) return -1; for (const ch of m[0].toUpperCase()) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };

  function sheetRows(xml, shared, dateStyles, date1904) {
    const sd = kid(parseXml(xml).k[0], 'sheetData');
    const cells = [];   // [row, col, text]
    let r = -1;
    kids(sd, 'row').forEach(row => {
      r = row.a.r ? (+row.a.r - 1) : r + 1;
      let c = -1;
      kids(row, 'c').forEach(cell => {
        const ci = cell.a.r ? colIndex(cell.a.r) : c + 1;
        c = ci;
        const v = kid(cell, 'v'), type = cell.a.t || 'n';
        let val = null;
        if (type === 'inlineStr') { const is = kid(cell, 'is'); if (is) val = richText(is); }
        else if (v && v.t !== '') {
          if (type === 's') val = shared[parseInt(v.t, 10)];
          else if (type === 'str') val = unescapeExcel(v.t);
          else if (type === 'b') val = v.t.trim() === '1' ? 'TRUE' : 'FALSE';
          else if (type === 'e') val = null;
          else if (type === 'd') val = v.t.trim();
          else {
            const num = Number(v.t);
            val = isFinite(num) && dateStyles[+cell.a.s] ? serialToText(num, date1904) : v.t.trim();
          }
        }
        if (val != null && val !== '') cells.push([r, ci, val]);
      });
    });
    if (!cells.length) return [];
    let r0 = Infinity, r1 = -1, c0 = Infinity, c1 = -1;
    cells.forEach(([a, b]) => { r0 = Math.min(r0, a); r1 = Math.max(r1, a); c0 = Math.min(c0, b); c1 = Math.max(c1, b); });
    if ((r1 - r0 + 1) * (c1 - c0 + 1) > 4e6) throw new Error('This sheet is too large to open in the browser. Please use a smaller sample.');
    const grid = Array.from({ length: r1 - r0 + 1 }, () => new Array(c1 - c0 + 1).fill(''));
    cells.forEach(([a, b, val]) => { grid[a - r0][b - c0] = String(val); });
    return grid;
  }

  X.read = async function (buf) {
    const zip = openZip(buf);
    const wbXml = await zip.text('xl/workbook.xml');
    if (!wbXml) throw new Error('This zip file is not an Excel workbook (no xl/workbook.xml).');
    const wb = parseXml(wbXml).k[0];
    const date1904 = ['1', 'true'].includes(String((kid(wb, 'workbookPr') || { a: {} }).a.date1904));
    const rels = new Map();
    const relXml = await zip.text('xl/_rels/workbook.xml.rels');
    if (relXml) kids(parseXml(relXml).k[0], 'Relationship').forEach(x => rels.set(x.a.Id, x.a.Target));

    const shared = [];
    const ssXml = await zip.text('xl/sharedStrings.xml');
    if (ssXml) kids(parseXml(ssXml).k[0], 'si').forEach(si => shared.push(richText(si)));

    const dateStyles = [];
    const stXml = await zip.text('xl/styles.xml');
    if (stXml) {
      const st = parseXml(stXml).k[0], custom = new Map();
      kids(kid(st, 'numFmts'), 'numFmt').forEach(f => custom.set(+f.a.numFmtId, f.a.formatCode));
      kids(kid(st, 'cellXfs'), 'xf').forEach(xf => {
        const id = +xf.a.numFmtId || 0;
        dateStyles.push(custom.has(id) ? isDateFormat(custom.get(id)) : BUILTIN_DATE.has(id));
      });
    }

    let list = kids(kid(wb, 'sheets'), 'sheet');
    if (list.some(s => s.a.state !== 'hidden' && s.a.state !== 'veryHidden')) list = list.filter(s => s.a.state !== 'hidden' && s.a.state !== 'veryHidden');
    const sheets = [];
    for (let i = 0; i < list.length; i++) {
      const s = list[i];
      let target = rels.get(s.a.id) || 'worksheets/sheet' + (i + 1) + '.xml';
      target = target[0] === '/' ? target.slice(1) : 'xl/' + target.replace(/^\.\//, '');
      const xml = await zip.text(target);
      if (!xml) continue;   // e.g. a chart sheet
      const rows = sheetRows(xml, shared, dateStyles, date1904);
      if (rows.length) sheets.push({ name: s.a.name || 'Sheet' + (i + 1), rows });
    }
    if (!sheets.length) throw new Error('The workbook has no data (every sheet is empty).');
    return { sheets };
  };

  // Rows (arrays of strings) -> CSV text, which the CSV parser then turns into a table.
  X.rowsToCSV = rows => rows.map(r => r.map(v => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join(',')).join('\n');

  /* ---------- writing ---------- */
  const crcTable = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(d) { let c = 0xFFFFFFFF; for (let i = 0; i < d.length; i++) c = crcTable[(c ^ d[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }

  function zipStore(files) {   // files: [[name, string]]
    const enc = new TextEncoder(), parts = [], central = [];
    let offset = 0;
    files.forEach(([name, text]) => {
      const nm = enc.encode(name), data = enc.encode(text), crc = crc32(data);
      const lh = new DataView(new ArrayBuffer(30));
      lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
      lh.setUint16(12, 0x21, true); lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true); lh.setUint16(26, nm.length, true);
      const ch = new DataView(new ArrayBuffer(46));
      ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
      ch.setUint16(14, 0x21, true); ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true); ch.setUint16(28, nm.length, true); ch.setUint32(42, offset, true);
      parts.push(new Uint8Array(lh.buffer), nm, data);
      central.push(new Uint8Array(ch.buffer), nm);
      offset += 30 + nm.length + data.length;
    });
    const cdSize = central.reduce((s, a) => s + a.length, 0), end = new DataView(new ArrayBuffer(22));
    end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
    const all = parts.concat(central, [new Uint8Array(end.buffer)]), out = new Uint8Array(offset + cdSize + 22);
    let p = 0; all.forEach(a => { out.set(a, p); p += a.length; });
    return out;
  }

  const xmlEsc = s => String(s).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g, '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const colName = i => { let s = ''; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + (i - 1) % 26) + s; return s; };
  const HEAD = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"';

  X.write = function (table) {
    if (table.rows.length + 1 > 1048576 || table.fields.length > 16384) throw new Error('Too much data for one Excel sheet (limit 1,048,576 rows and 16,384 columns).');
    const strCell = (ref, v, style) => {
      const s = String(v);
      return '<c r="' + ref + '" t="inlineStr"' + (style ? ' s="1"' : '') + '><is><t' + (/^\s|\s$/.test(s) ? ' xml:space="preserve"' : '') + '>' + xmlEsc(s) + '</t></is></c>';
    };
    const out = [HEAD + '<worksheet ' + NS + '><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews><sheetData>'];
    out.push('<row r="1">' + table.fields.map((f, j) => strCell(colName(j) + '1', f.name, true)).join('') + '</row>');
    table.rows.forEach((r, i) => {
      let line = '<row r="' + (i + 2) + '">';
      table.fields.forEach((f, j) => {
        const v = r[f.name];
        if (U.isMissing(v)) return;
        const ref = colName(j) + (i + 2);
        line += U.isNum(v) ? '<c r="' + ref + '"><v>' + v + '</v></c>' : strCell(ref, v, false);
      });
      out.push(line + '</row>');
    });
    out.push('</sheetData></worksheet>');
    return zipStore([
      ['[Content_Types].xml', HEAD + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>'],
      ['_rels/.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>'],
      ['xl/workbook.xml', HEAD + '<workbook ' + NS + ' xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="Data" sheetId="1" r:id="rId1"/></sheets></workbook>'],
      ['xl/_rels/workbook.xml.rels', HEAD + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>'],
      ['xl/styles.xml', HEAD + '<styleSheet ' + NS + '><fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>' +
        '<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>' +
        '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
        '<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>' +
        '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>'],
      ['xl/worksheets/sheet1.xml', out.join('')]
    ]);
  };

  DM.xlsx = X;
})(window.DM);
