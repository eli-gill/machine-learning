/* Shared helpers: CSV parsing, statistics, formatting, HTML tables and SVG charts. */
window.DM = window.DM || {};
(function (DM) {
  'use strict';
  const U = {};

  U.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  U.isMissing = v => v === null || v === undefined || v === '' || (typeof v === 'number' && !isFinite(v));
  U.isNum = v => typeof v === 'number' && isFinite(v);

  // Seeded random number generator (mulberry32) so results are reproducible.
  U.rng = function (seed) {
    let a = (Number(seed) >>> 0) || 1;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  };
  U.gauss = function (rand) {
    let u = 0, v = 0;
    while (u === 0) u = rand();
    while (v === 0) v = rand();
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
  };

  /* ---------- CSV ---------- */
  U.parseCSV = function (text, delim) {
    text = String(text || '').replace(/^﻿/, '');
    if (!delim) {
      const first = text.split(/\r?\n/, 1)[0] || '';
      const counts = [',', ';', '\t', '|'].map(d => [d, first.split(d).length]);
      counts.sort((a, b) => b[1] - a[1]);
      delim = counts[0][0];
    }
    const rows = [];
    let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) {
        if (c === '"') {
          if (text[i + 1] === '"') { field += '"'; i++; } else q = false;
        } else field += c;
      } else if (c === '"') q = true;
      else if (c === delim) { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') {
        if (c === '\r' && text[i + 1] === '\n') i++;
        row.push(field); rows.push(row); row = []; field = '';
      } else field += c;
    }
    if (field !== '' || row.length) { row.push(field); rows.push(row); }
    return rows.filter(r => !(r.length === 1 && r[0].trim() === ''));
  };

  const isNumStr = v => { const s = String(v).trim(); return s !== '' && isFinite(Number(s)); };

  // Build a table from a header row and data rows, inferring number vs string storage.
  U.tableFromArrays = function (header, data) {
    const names = [];
    header.forEach((h, i) => {
      let n = String(h == null ? '' : h).trim() || ('Field' + (i + 1));
      const base = n; let k = 2;
      while (names.includes(n)) n = base + '_' + (k++);
      names.push(n);
    });
    const fields = names.map((name, j) => {
      let numeric = true, any = false;
      for (const r of data) {
        const v = r[j];
        if (v === undefined || v === null || String(v).trim() === '') continue;
        any = true;
        if (!isNumStr(v)) { numeric = false; break; }
      }
      return { name, type: numeric && any ? 'number' : 'string' };
    });
    const rows = data.map(r => {
      const o = {};
      fields.forEach((f, j) => {
        let v = r[j];
        if (v === undefined || v === null || String(v).trim() === '') v = null;
        else if (f.type === 'number') v = Number(v);
        else v = String(v);
        o[f.name] = v;
      });
      return o;
    });
    return { fields, rows, meta: {} };
  };

  U.csvToTable = function (text) {
    const arr = U.parseCSV(text);
    if (!arr.length) throw new Error('The CSV file is empty.');
    return U.tableFromArrays(arr[0], arr.slice(1));
  };

  U.toCSV = function (table) {
    const q = v => {
      if (U.isMissing(v)) return '';
      const s = String(v);
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [table.fields.map(f => q(f.name)).join(',')];
    table.rows.forEach(r => lines.push(table.fields.map(f => q(r[f.name])).join(',')));
    return lines.join('\n');
  };

  U.download = function (name, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };

  /* ---------- tables ---------- */
  U.copyMeta = m => JSON.parse(JSON.stringify(m || {}));
  U.field = (t, name) => t.fields.find(f => f.name === name);
  U.requireField = function (t, name, what) {
    if (!name) throw new Error('Choose ' + (what || 'a field') + ' in the node settings.');
    const f = U.field(t, name);
    if (!f) throw new Error('Field "' + name + '" is not in the incoming data.');
    return f;
  };
  // Replace or append a field definition.
  U.setField = function (fields, name, type) {
    const out = fields.filter(f => f.name !== name);
    out.push({ name, type });
    return out;
  };
  U.inferType = function (rows, name) {
    let any = false;
    for (const r of rows) {
      const v = r[name];
      if (U.isMissing(v)) continue;
      any = true;
      if (typeof v !== 'number') return 'string';
    }
    return any ? 'number' : 'string';
  };

  /* ---------- statistics ---------- */
  U.nums = (rows, name) => { const a = []; for (const r of rows) if (U.isNum(r[name])) a.push(r[name]); return a; };
  U.mean = a => a.length ? a.reduce((s, v) => s + v, 0) / a.length : NaN;
  U.std = a => {
    if (a.length < 2) return 0;
    const m = U.mean(a);
    return Math.sqrt(a.reduce((s, v) => s + (v - m) * (v - m), 0) / (a.length - 1));
  };
  U.quantile = (a, q) => {
    if (!a.length) return NaN;
    const s = a.slice().sort((x, y) => x - y);
    const pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  };
  U.median = a => U.quantile(a, 0.5);
  U.counts = (rows, name) => {
    const m = new Map();
    for (const r of rows) {
      const v = r[name];
      if (U.isMissing(v)) continue;
      const k = String(v);
      m.set(k, (m.get(k) || 0) + 1);
    }
    return m;
  };
  U.mode = (rows, name) => {
    let best = null, bc = -1;
    const firstVal = new Map();
    for (const r of rows) { const v = r[name]; if (!U.isMissing(v) && !firstVal.has(String(v))) firstVal.set(String(v), v); }
    U.counts(rows, name).forEach((c, k) => { if (c > bc) { bc = c; best = k; } });
    return best === null ? null : firstVal.get(best);
  };

  /* ---------- formatting ---------- */
  U.fmt = function (v, digits) {
    if (U.isMissing(v)) return '';
    if (typeof v !== 'number') return String(v);
    if (Number.isInteger(v)) return String(v);
    if (Math.abs(v) < 1e-9) return '0';
    const d = digits == null ? 4 : digits;
    const a = Math.abs(v);
    if (a >= 1000) return v.toFixed(1);
    if (a >= 1) return String(+v.toFixed(d > 3 ? 3 : d));
    return String(+v.toPrecision(d));
  };
  U.pct = v => (100 * v).toFixed(1) + '%';

  U.htmlTable = function (table, maxRows) {
    const n = table.rows.length, show = Math.min(n, maxRows || 500);
    let h = '<div class="grid-wrap"><table class="grid"><thead><tr><th class="rownum">#</th>';
    table.fields.forEach(f => {
      h += '<th title="' + (f.type === 'number' ? 'Numeric' : 'String') + '"><span class="ftype ' + f.type + '">' +
        (f.type === 'number' ? '#' : 'A') + '</span>' + U.esc(f.name) + '</th>';
    });
    h += '</tr></thead><tbody>';
    for (let i = 0; i < show; i++) {
      const r = table.rows[i];
      h += '<tr><td class="rownum">' + (i + 1) + '</td>';
      table.fields.forEach(f => {
        const v = r[f.name];
        h += U.isMissing(v) ? '<td class="missing">$null$</td>'
          : '<td class="' + (typeof v === 'number' ? 'num' : '') + '">' + U.esc(U.fmt(v)) + '</td>';
      });
      h += '</tr>';
    }
    h += '</tbody></table></div>';
    h += '<p class="muted">' + (show < n ? 'Showing first ' + show + ' of ' : '') + n + ' records, ' + table.fields.length + ' fields.</p>';
    return h;
  };

  // Simple key/value or matrix table from arrays.
  U.simpleTable = function (headers, rows, opts) {
    let h = '<table class="grid compact' + (opts && opts.cls ? ' ' + opts.cls : '') + '"><thead><tr>';
    headers.forEach(x => { h += '<th>' + U.esc(x) + '</th>'; });
    h += '</tr></thead><tbody>';
    rows.forEach(r => {
      h += '<tr>' + r.map((c, i) => {
        if (c && typeof c === 'object' && c.html != null) return '<td' + (c.cls ? ' class="' + c.cls + '"' : '') + '>' + c.html + '</td>';
        return '<td class="' + (typeof c === 'number' ? 'num' : (i === 0 ? 'key' : '')) + '">' + U.esc(U.fmt(c)) + '</td>';
      }).join('') + '</tr>';
    });
    return h + '</tbody></table>';
  };

  /* ---------- charts (inline SVG) ---------- */
  U.colors = ['#3b6fb6', '#e08a2c', '#3f9a5b', '#c8453c', '#7d5ab5', '#8c6a4f', '#d067a8', '#6f7b87', '#b3a33a', '#2ba3b4'];

  function niceTicks(min, max, count) {
    if (!isFinite(min) || !isFinite(max)) return [0, 1];
    if (min === max) { min -= 1; max += 1; }
    const span = max - min;
    const step0 = Math.pow(10, Math.floor(Math.log10(span / count)));
    const err = span / count / step0;
    const step = step0 * (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1);
    const ticks = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) ticks.push(+v.toFixed(10));
    return ticks;
  }
  U.niceTicks = niceTicks;

  function legend(names, x, y) {
    let s = '';
    names.forEach((nm, i) => {
      const yy = y + i * 18;
      s += '<rect x="' + x + '" y="' + (yy - 10) + '" width="12" height="12" rx="2" fill="' + U.colors[i % U.colors.length] + '"/>' +
        '<text x="' + (x + 18) + '" y="' + yy + '" class="lbl">' + U.esc(String(nm).slice(0, 22)) + '</text>';
    });
    return s;
  }

  /* labels: category names; series: [{name, values}] (stacked when more than one). */
  U.barChart = function (labels, series, opts) {
    opts = opts || {};
    const W = 680, H = 340, legendW = series.length > 1 ? 150 : 0;
    const m = { l: 56, r: 16 + legendW, t: 16, b: 70 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const totals = labels.map((_, i) => series.reduce((s, se) => s + (se.values[i] || 0), 0));
    const maxV = Math.max(1, ...totals);
    const ticks = niceTicks(0, maxV, 5);
    const top = ticks[ticks.length - 1];
    const bw = pw / Math.max(1, labels.length);
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    ticks.forEach(t => {
      const y = m.t + ph - (t / top) * ph;
      s += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + y + '" y2="' + y + '" class="gridline"/>' +
        '<text x="' + (m.l - 6) + '" y="' + (y + 4) + '" class="tick" text-anchor="end">' + U.fmt(t) + '</text>';
    });
    labels.forEach((lab, i) => {
      let acc = 0;
      const x = m.l + i * bw + bw * 0.12, w = bw * 0.76;
      series.forEach((se, k) => {
        const v = se.values[i] || 0;
        if (!v) return;
        const h = (v / top) * ph, y = m.t + ph - ((acc + v) / top) * ph;
        s += '<rect x="' + x.toFixed(1) + '" y="' + y.toFixed(1) + '" width="' + w.toFixed(1) + '" height="' + h.toFixed(1) +
          '" fill="' + U.colors[k % U.colors.length] + '"><title>' + U.esc(lab) + (series.length > 1 ? ' / ' + U.esc(se.name) : '') + ': ' + v + '</title></rect>';
        acc += v;
      });
      const lx = m.l + i * bw + bw / 2, ly = m.t + ph + 14;
      const text = U.esc(String(lab).slice(0, 16));
      s += labels.length > 8
        ? '<text class="tick" text-anchor="end" transform="translate(' + lx + ',' + ly + ') rotate(-40)">' + text + '</text>'
        : '<text class="tick" text-anchor="middle" x="' + lx + '" y="' + ly + '">' + text + '</text>';
    });
    s += '<line x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + (m.t + ph) + '" y2="' + (m.t + ph) + '" class="axis"/>';
    if (opts.yLabel) s += '<text class="lbl" transform="translate(14,' + (m.t + ph / 2) + ') rotate(-90)" text-anchor="middle">' + U.esc(opts.yLabel) + '</text>';
    if (opts.xLabel) s += '<text class="lbl" x="' + (m.l + pw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + U.esc(opts.xLabel) + '</text>';
    if (series.length > 1) s += legend(series.map(se => se.name), W - legendW + 4, m.t + 12);
    return s + '</svg>';
  };

  /* points: [{x, y, c}] where c is a category label (optional). */
  U.scatter = function (points, opts) {
    opts = opts || {};
    const cats = [];
    points.forEach(p => { if (p.c != null && !cats.includes(p.c)) cats.push(p.c); });
    cats.sort((a, b) => String(a).localeCompare(String(b), undefined, { numeric: true }));
    const W = 680, H = 380, legendW = cats.length ? 150 : 0;
    const m = { l: 60, r: 16 + legendW, t: 16, b: 46 };
    const pw = W - m.l - m.r, ph = H - m.t - m.b;
    const xs = points.map(p => p.x), ys = points.map(p => p.y);
    const xt = niceTicks(Math.min(...xs), Math.max(...xs), 6), yt = niceTicks(Math.min(...ys), Math.max(...ys), 6);
    const x0 = xt[0], x1 = xt[xt.length - 1], y0 = yt[0], y1 = yt[yt.length - 1];
    const sx = v => m.l + ((v - x0) / (x1 - x0 || 1)) * pw, sy = v => m.t + ph - ((v - y0) / (y1 - y0 || 1)) * ph;
    let s = '<svg class="chart" viewBox="0 0 ' + W + ' ' + H + '" role="img">';
    xt.forEach(t => { s += '<line class="gridline" x1="' + sx(t) + '" x2="' + sx(t) + '" y1="' + m.t + '" y2="' + (m.t + ph) + '"/><text class="tick" text-anchor="middle" x="' + sx(t) + '" y="' + (m.t + ph + 16) + '">' + U.fmt(t) + '</text>'; });
    yt.forEach(t => { s += '<line class="gridline" x1="' + m.l + '" x2="' + (m.l + pw) + '" y1="' + sy(t) + '" y2="' + sy(t) + '"/><text class="tick" text-anchor="end" x="' + (m.l - 6) + '" y="' + (sy(t) + 4) + '">' + U.fmt(t) + '</text>'; });
    points.forEach(p => {
      const ci = p.c == null ? 0 : cats.indexOf(p.c);
      s += '<circle cx="' + sx(p.x).toFixed(1) + '" cy="' + sy(p.y).toFixed(1) + '" r="3.2" fill="' + U.colors[ci % U.colors.length] + '" fill-opacity="0.75"/>';
    });
    if (opts.line) {
      const lo = Math.max(x0, y0), hi = Math.min(x1, y1);
      if (hi > lo) s += '<line x1="' + sx(lo) + '" y1="' + sy(lo) + '" x2="' + sx(hi) + '" y2="' + sy(hi) + '" stroke="#999" stroke-dasharray="4 3"/>';
    }
    s += '<text class="lbl" x="' + (m.l + pw / 2) + '" y="' + (H - 6) + '" text-anchor="middle">' + U.esc(opts.xLabel || '') + '</text>';
    s += '<text class="lbl" transform="translate(14,' + (m.t + ph / 2) + ') rotate(-90)" text-anchor="middle">' + U.esc(opts.yLabel || '') + '</text>';
    if (cats.length) s += legend(cats.slice(0, 15), W - legendW + 4, m.t + 12);
    return s + '</svg>';
  };

  // Tiny inline histogram for the Data Audit node.
  U.sparkBars = function (values) {
    const W = 90, H = 26, max = Math.max(1, ...values), bw = W / Math.max(1, values.length);
    let s = '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" width="' + W + '" height="' + H + '">';
    values.forEach((v, i) => {
      const h = (v / max) * (H - 2);
      s += '<rect x="' + (i * bw + 0.5).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + Math.max(1, bw - 1).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="#3b6fb6"/>';
    });
    return s + '</svg>';
  };

  // Equal-width histogram bins for a numeric array.
  U.histogram = function (vals, bins) {
    const lo = Math.min(...vals), hi = Math.max(...vals);
    const w = (hi - lo) / bins || 1;
    const counts = new Array(bins).fill(0);
    vals.forEach(v => { counts[Math.min(bins - 1, Math.floor((v - lo) / w))]++; });
    const labels = counts.map((_, i) => U.fmt(lo + i * w, 3) + '–' + U.fmt(lo + (i + 1) * w, 3));
    return { lo, hi, w, counts, labels, binOf: v => Math.max(0, Math.min(bins - 1, Math.floor((v - lo) / w))) };
  };

  DM.util = U;
})(window.DM);
