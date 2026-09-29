/* Node type definitions: palette category, settings (params) and exec().
   exec(inputs, params, ctx) returns { data } for nodes that pass data on,
   { output } for terminal nodes, and { data, model } for modeling nodes. */
(function (DM) {
  'use strict';
  const U = DM.util;

  DM.categories = [
    { key: 'sources', label: 'Sources' },
    { key: 'record', label: 'Record Ops' },
    { key: 'field', label: 'Field Ops' },
    { key: 'graphs', label: 'Graphs' },
    { key: 'modeling', label: 'Modeling' },
    { key: 'output', label: 'Output' }
  ];

  const T = {};
  const table = (src, fields, rows) => ({ fields, rows, meta: U.copyMeta(src.meta) });
  const TRAIN = '1_Training', TEST = '2_Testing';

  /* ---------- expressions (Derive / Select) ---------- */
  const HELPERS = {
    abs: Math.abs, sqrt: Math.sqrt, log: Math.log, log10: Math.log10, exp: Math.exp, round: Math.round,
    floor: Math.floor, ceil: Math.ceil, min: Math.min, max: Math.max, pow: Math.pow,
    isMissing: U.isMissing, upper: s => String(s).toUpperCase(), lower: s => String(s).toLowerCase(),
    trim: s => String(s).trim(), len: s => String(s).length, contains: (s, t) => String(s).includes(t),
    number: v => (U.isMissing(v) ? null : Number(v)), text: v => (U.isMissing(v) ? null : String(v))
  };
  const RESERVED = new Set(('break case catch class const continue debugger default delete do else export extends false finally for function if import in ' +
    'instanceof new null return super switch this throw true try typeof var void while with yield let static await row undefined NaN Infinity Math').split(' '));
  DM.compileExpr = function (expr, fields) {
    if (!String(expr || '').trim()) throw new Error('Enter an expression.');
    const ids = fields.map(f => f.name).filter(n => /^[A-Za-z_$][\w$]*$/.test(n) && !RESERVED.has(n) && !(n in HELPERS));
    let fn;
    try {
      fn = new Function('row', ...Object.keys(HELPERS), ...ids, '"use strict"; return (' + expr + ');');
    } catch (e) { throw new Error('Expression error: ' + e.message); }
    const hv = Object.values(HELPERS);
    return row => {
      try { return fn(row, ...hv, ...ids.map(i => row[i])); } catch (e) { throw new Error('Expression error: ' + e.message); }
    };
  };
  const EXPR_HELP = 'JavaScript syntax. Use field names directly (e.g. <code>Income / 12</code>) or <code>row["Field Name"]</code> for names with spaces. ' +
    'Comparisons: <code>== != &gt; &lt; &amp;&amp; ||</code>. If/else: <code>Age &lt; 30 ? "Young" : "Adult"</code>. ' +
    'Functions: abs sqrt log exp round floor ceil min max pow isMissing upper lower trim len contains number text.';

  /* ---------- Sources ---------- */
  T.sample_data = {
    cat: 'sources', label: 'Sample Data', glyph: '⛁', inputs: 0,
    desc: 'Load one of the built-in practice datasets.',
    params: [
      { key: 'dataset', label: 'Dataset', type: 'select', default: 'iris', options: () => Object.keys(DM.datasets).map(k => ({ v: k, l: DM.datasets[k].label })) },
      { key: '_info', type: 'info', html: p => DM.datasets[p.dataset] ? U.esc(DM.datasets[p.dataset].desc) : '' }
    ],
    title: p => DM.datasets[p.dataset] ? DM.datasets[p.dataset].label : 'Sample Data',
    exec(inp, p) {
      const d = DM.datasets[p.dataset];
      if (!d) throw new Error('Choose a dataset.');
      return { data: d.build() };
    }
  };

  T.csv = {
    cat: 'sources', label: 'CSV File', glyph: '≣', inputs: 0,
    desc: 'Read a comma-separated file from your computer (it stays in your browser).',
    params: [{ key: 'csv', label: 'File', type: 'csvfile', default: '' }, { key: 'fileName', type: 'hidden', default: '' }],
    title: p => p.fileName || 'CSV File',
    exec(inp, p) {
      if (!p.csv) throw new Error('Open the node and choose a CSV file (or paste CSV text).');
      return { data: U.csvToTable(p.csv) };
    }
  };

  /* ---------- Record Ops ---------- */
  const OPS = ['=', '!=', '>', '>=', '<', '<=', 'contains', 'is missing', 'is not missing'];
  function simpleCondition(t, p) {
    const f = U.requireField(t, p.field);
    const op = p.op || '=';
    const raw = p.value == null ? '' : String(p.value);
    const val = f.type === 'number' ? Number(raw) : raw;
    if (f.type === 'number' && !['is missing', 'is not missing', 'contains'].includes(op) && !isFinite(val)) throw new Error('"' + raw + '" is not a number.');
    return r => {
      const v = r[f.name];
      if (op === 'is missing') return U.isMissing(v);
      if (op === 'is not missing') return !U.isMissing(v);
      if (U.isMissing(v)) return false;
      switch (op) {
        case '=': return v === val || String(v) === raw;
        case '!=': return !(v === val || String(v) === raw);
        case '>': return v > val;
        case '>=': return v >= val;
        case '<': return v < val;
        case '<=': return v <= val;
        case 'contains': return String(v).toLowerCase().includes(raw.toLowerCase());
      }
      return false;
    };
  }
  T.select = {
    cat: 'record', label: 'Select', glyph: 'σ', inputs: 1,
    desc: 'Keep or discard records that match a condition.',
    params: [
      { key: 'action', label: 'Mode', type: 'select', default: 'include', options: [{ v: 'include', l: 'Include matching records' }, { v: 'discard', l: 'Discard matching records' }] },
      { key: 'how', label: 'Condition type', type: 'select', default: 'simple', options: [{ v: 'simple', l: 'Simple condition' }, { v: 'expression', l: 'Expression' }] },
      { key: 'field', label: 'Field', type: 'field', showIf: p => p.how !== 'expression' },
      { key: 'op', label: 'Operator', type: 'select', default: '=', options: OPS, showIf: p => p.how !== 'expression' },
      { key: 'value', label: 'Value', type: 'text', default: '', showIf: p => p.how !== 'expression' && !/missing/.test(p.op) },
      { key: 'expression', label: 'Condition', type: 'textarea', default: '', showIf: p => p.how === 'expression', help: EXPR_HELP }
    ],
    exec(inp, p) {
      const t = inp[0];
      let test;
      if (p.how === 'expression') { const f = DM.compileExpr(p.expression, t.fields); test = r => !!f(r); }
      else test = simpleCondition(t, p);
      const keep = p.action !== 'discard';
      return { data: table(t, t.fields, t.rows.filter(r => test(r) === keep)) };
    }
  };

  T.sample = {
    cat: 'record', label: 'Sample', glyph: '%', inputs: 1,
    desc: 'Take a subset of records.',
    params: [
      { key: 'method', label: 'Method', type: 'select', default: 'random', options: [{ v: 'first', l: 'First N records' }, { v: 'random', l: 'Random percentage' }, { v: 'nth', l: 'Every Nth record' }] },
      { key: 'n', label: 'N', type: 'number', default: 100, showIf: p => p.method !== 'random' },
      { key: 'percent', label: 'Percent', type: 'number', default: 50, showIf: p => p.method === 'random' },
      { key: 'seed', label: 'Random seed', type: 'number', default: 1, showIf: p => p.method === 'random' }
    ],
    exec(inp, p) {
      const t = inp[0];
      let rows;
      if (p.method === 'first') rows = t.rows.slice(0, Math.max(0, +p.n));
      else if (p.method === 'nth') { const n = Math.max(1, Math.round(+p.n)); rows = t.rows.filter((_, i) => i % n === 0); }
      else { const rand = U.rng(p.seed); rows = t.rows.filter(() => rand() * 100 < +p.percent); }
      return { data: table(t, t.fields, rows) };
    }
  };

  T.sort = {
    cat: 'record', label: 'Sort', glyph: '⇅', inputs: 1,
    desc: 'Sort records by a field.',
    params: [
      { key: 'field', label: 'Sort by', type: 'field' },
      { key: 'order', label: 'Order', type: 'select', default: 'asc', options: [{ v: 'asc', l: 'Ascending' }, { v: 'desc', l: 'Descending' }] }
    ],
    exec(inp, p) {
      const t = inp[0], f = U.requireField(t, p.field), dir = p.order === 'desc' ? -1 : 1;
      const rows = t.rows.slice().sort((a, b) => {
        const x = a[f.name], y = b[f.name];
        if (U.isMissing(x)) return U.isMissing(y) ? 0 : 1;
        if (U.isMissing(y)) return -1;
        return (x < y ? -1 : x > y ? 1 : 0) * dir;
      });
      return { data: table(t, t.fields, rows) };
    }
  };

  T.distinct = {
    cat: 'record', label: 'Distinct', glyph: '≠', inputs: 1,
    desc: 'Remove duplicate records (keeps the first of each group).',
    params: [{ key: 'keys', label: 'Key fields (none checked = compare whole record)', type: 'fields' }],
    exec(inp, p) {
      const t = inp[0], keys = (p.keys && p.keys.length ? p.keys : t.fields.map(f => f.name)).filter(k => U.field(t, k));
      const seen = new Set();
      const rows = t.rows.filter(r => { const k = JSON.stringify(keys.map(n => r[n])); if (seen.has(k)) return false; seen.add(k); return true; });
      return { data: table(t, t.fields, rows) };
    }
  };

  T.merge = {
    cat: 'record', label: 'Merge', glyph: '⋈', inputs: 2,
    desc: 'Join two data sources on a key field. The first connected input is the left side.',
    params: [
      { key: 'join', label: 'Join type', type: 'select', default: 'inner', options: [
        { v: 'inner', l: 'Inner join (only matching keys)' }, { v: 'left', l: 'Left outer (all records from input 1)' },
        { v: 'right', l: 'Right outer (all records from input 2)' }, { v: 'full', l: 'Full outer (all records from both)' }] },
      { key: 'leftKey', label: 'Key in input 1', type: 'field', input: 0 },
      { key: 'rightKey', label: 'Key in input 2', type: 'field', input: 1 }
    ],
    exec(inp, p, ctx) {
      if (inp.length < 2) throw new Error('Merge needs two inputs. Connect a second data source.');
      const [L, R] = inp;
      const common = L.fields.find(f => U.field(R, f.name));
      const lk = p.leftKey || (common && common.name), rk = p.rightKey || lk;
      U.requireField(L, lk, 'the key for input 1'); U.requireField(R, rk, 'the key for input 2');
      const rFields = R.fields.filter(f => f.name !== rk).map(f => {
        let name = f.name, k = 2;
        while (L.fields.some(g => g.name === name)) name = f.name + '_' + (k++);
        return { from: f.name, name, type: f.type };
      });
      const index = new Map();
      R.rows.forEach((r, i) => { const v = r[rk]; if (U.isMissing(v)) return; const k = String(v); if (!index.has(k)) index.set(k, []); index.get(k).push(i); });
      const used = new Set(), rows = [];
      const addRight = (o, r) => { rFields.forEach(f => { o[f.name] = r ? r[f.from] : null; }); return o; };
      L.rows.forEach(l => {
        const m = U.isMissing(l[lk]) ? null : index.get(String(l[lk]));
        if (m) m.forEach(i => { used.add(i); rows.push(addRight(Object.assign({}, l), R.rows[i])); });
        else if (p.join === 'left' || p.join === 'full') rows.push(addRight(Object.assign({}, l), null));
      });
      if (p.join === 'right' || p.join === 'full') {
        R.rows.forEach((r, i) => {
          if (used.has(i)) return;
          const o = {}; L.fields.forEach(f => { o[f.name] = null; }); o[lk] = r[rk];
          rows.push(addRight(o, r));
        });
      }
      const out = { fields: L.fields.concat(rFields.map(f => ({ name: f.name, type: f.type }))), rows, meta: Object.assign(U.copyMeta(R.meta), U.copyMeta(L.meta)) };
      return { data: out };
    }
  };

  T.append = {
    cat: 'record', label: 'Append', glyph: '∪', inputs: 'many',
    desc: 'Stack records from several sources on top of each other (fields matched by name).',
    params: [{ key: 'tag', label: 'Add a field naming the source (leave blank for none)', type: 'text', default: '' }],
    exec(inp, p, ctx) {
      if (inp.length < 1) throw new Error('Append needs at least one input.');
      let fields = [];
      inp.forEach(t => t.fields.forEach(f => { const e = fields.find(g => g.name === f.name); if (!e) fields.push({ name: f.name, type: f.type }); else if (e.type !== f.type) e.type = 'string'; }));
      const rows = [];
      inp.forEach((t, k) => t.rows.forEach(r => {
        const o = {};
        fields.forEach(f => { const v = r[f.name]; o[f.name] = v === undefined ? null : (f.type === 'string' && !U.isMissing(v) ? String(v) : v); });
        if (p.tag) o[p.tag] = ctx.inputNames[k];
        rows.push(o);
      }));
      if (p.tag) fields = U.setField(fields, p.tag, 'string');
      return { data: { fields, rows, meta: U.copyMeta(inp[0].meta) } };
    }
  };

  const AGG = { Mean: v => U.mean(v), Sum: v => v.reduce((a, b) => a + b, 0), Min: v => Math.min(...v), Max: v => Math.max(...v), SDev: v => U.std(v) };
  T.aggregate = {
    cat: 'record', label: 'Aggregate', glyph: 'Σ', inputs: 1,
    desc: 'Summarise records into groups (one output record per group).',
    params: [
      { key: 'keys', label: 'Group by', type: 'fields' },
      { key: 'values', label: 'Fields to summarise', type: 'fields', fieldType: 'number' },
      { key: 'funcs', label: 'Statistics', type: 'multi', default: ['Mean'], options: Object.keys(AGG) }
    ],
    exec(inp, p) {
      const t = inp[0], keys = (p.keys || []).filter(k => U.field(t, k)), vals = (p.values || []).filter(k => U.field(t, k));
      const funcs = (p.funcs || []).filter(f => AGG[f]);
      const groups = new Map();
      t.rows.forEach(r => { const k = JSON.stringify(keys.map(n => r[n])); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); });
      const fields = keys.map(k => Object.assign({}, U.field(t, k)));
      vals.forEach(v => funcs.forEach(fn => fields.push({ name: v + '_' + fn, type: 'number' })));
      fields.push({ name: 'Record_Count', type: 'number' });
      const rows = [];
      groups.forEach(g => {
        const o = {};
        keys.forEach(k => { o[k] = g[0][k]; });
        vals.forEach(v => { const a = U.nums(g, v); funcs.forEach(fn => { o[v + '_' + fn] = a.length ? AGG[fn](a) : null; }); });
        o.Record_Count = g.length;
        rows.push(o);
      });
      return { data: { fields, rows, meta: {} } };
    }
  };

  /* ---------- Field Ops ---------- */
  T.filter = {
    cat: 'field', label: 'Filter', glyph: 'π', inputs: 1,
    desc: 'Remove or rename fields.',
    params: [
      { key: 'drop', label: 'Fields to remove', type: 'fields' },
      { key: 'rename', label: 'Rename (one per line: OldName = NewName)', type: 'textarea', default: '' }
    ],
    exec(inp, p) {
      const t = inp[0], drop = new Set(p.drop || []), ren = {};
      String(p.rename || '').split('\n').forEach(line => { const m = line.split('='); if (m.length === 2 && m[0].trim() && m[1].trim()) ren[m[0].trim()] = m[1].trim(); });
      const keep = t.fields.filter(f => !drop.has(f.name));
      const fields = keep.map(f => ({ name: ren[f.name] || f.name, type: f.type }));
      const rows = t.rows.map(r => { const o = {}; keep.forEach(f => { o[ren[f.name] || f.name] = r[f.name]; }); return o; });
      const meta = U.copyMeta(t.meta);
      if (meta.partition && (drop.has(meta.partition) || ren[meta.partition])) meta.partition = ren[meta.partition] || undefined;
      return { data: { fields, rows, meta } };
    }
  };

  T.type = {
    cat: 'field', label: 'Type', glyph: '#', inputs: 1,
    desc: 'Change how fields are stored: numbers vs text. Converting to number strips $ , % and spaces; values that are not numbers become $null$.',
    params: [{ key: 'types', label: 'Storage', type: 'fieldTypes', default: {} }],
    exec(inp, p) {
      const t = inp[0], conv = p.types || {};
      const fields = t.fields.map(f => ({ name: f.name, type: conv[f.name] === 'number' || conv[f.name] === 'string' ? conv[f.name] : f.type }));
      const rows = t.rows.map(r => {
        const o = Object.assign({}, r);
        fields.forEach(f => {
          const v = r[f.name];
          if (U.isMissing(v)) { o[f.name] = null; return; }
          if (f.type === 'number' && typeof v !== 'number') { const n = Number(String(v).replace(/[$,%\s]/g, '')); o[f.name] = String(v).trim() !== '' && isFinite(n) ? n : null; }
          if (f.type === 'string' && typeof v !== 'string') o[f.name] = String(v);
        });
        return o;
      });
      return { data: table(t, fields, rows) };
    }
  };

  T.filler = {
    cat: 'field', label: 'Fill Missing', glyph: '∅', inputs: 1,
    desc: 'Replace missing ($null$) values, or remove the records that have them.',
    params: [
      { key: 'fields', label: 'Fields (none checked = every field)', type: 'fields' },
      { key: 'method', label: 'Replace with', type: 'select', default: 'mean', options: [
        { v: 'mean', l: 'Mean (numbers) / most common value (text)' }, { v: 'median', l: 'Median (numbers) / most common value (text)' },
        { v: 'mode', l: 'Most common value' }, { v: 'constant', l: 'A constant value' }, { v: 'remove', l: 'Remove records with missing values' }] },
      { key: 'constant', label: 'Constant', type: 'text', default: '0', showIf: p => p.method === 'constant' }
    ],
    exec(inp, p) {
      const t = inp[0], names = (p.fields && p.fields.length ? p.fields : t.fields.map(f => f.name)).filter(n => U.field(t, n));
      if (p.method === 'remove') return { data: table(t, t.fields, t.rows.filter(r => names.every(n => !U.isMissing(r[n])))) };
      const fill = {};
      names.forEach(n => {
        const f = U.field(t, n);
        if (p.method === 'constant') fill[n] = f.type === 'number' && isFinite(Number(p.constant)) ? Number(p.constant) : String(p.constant);
        else if (f.type === 'number' && p.method !== 'mode') { const v = U.nums(t.rows, n); fill[n] = v.length ? +(p.method === 'median' ? U.median(v) : U.mean(v)).toFixed(4) : null; }
        else fill[n] = U.mode(t.rows, n);
      });
      const fields = t.fields.map(f => (fill[f.name] !== undefined && typeof fill[f.name] === 'string' && f.type === 'number') ? { name: f.name, type: 'string' } : f);
      const rows = t.rows.map(r => { const o = Object.assign({}, r); names.forEach(n => { if (U.isMissing(o[n])) o[n] = fill[n]; }); return o; });
      return { data: table(t, fields, rows) };
    }
  };

  T.clean_text = {
    cat: 'field', label: 'Clean Text', glyph: 'Aa', inputs: 1,
    desc: 'Tidy text values: trim spaces and make capitalisation consistent (e.g. "north", "NORTH " → "North").',
    params: [
      { key: 'fields', label: 'Text fields (none checked = all text fields)', type: 'fields', fieldType: 'string' },
      { key: 'trim', label: 'Trim leading/trailing spaces', type: 'checkbox', default: true },
      { key: 'case', label: 'Capitalisation', type: 'select', default: 'title', options: [{ v: 'none', l: 'Leave as is' }, { v: 'lower', l: 'lower case' }, { v: 'upper', l: 'UPPER CASE' }, { v: 'title', l: 'Title Case' }] },
      { key: 'blank', label: 'Treat empty text as missing', type: 'checkbox', default: true }
    ],
    exec(inp, p) {
      const t = inp[0];
      const names = (p.fields && p.fields.length ? p.fields : t.fields.filter(f => f.type === 'string').map(f => f.name)).filter(n => U.field(t, n) && U.field(t, n).type === 'string');
      const fix = s => {
        if (p.trim) s = s.trim().replace(/\s+/g, ' ');
        if (p.case === 'lower') s = s.toLowerCase();
        else if (p.case === 'upper') s = s.toUpperCase();
        else if (p.case === 'title') s = s.toLowerCase().replace(/(^|[\s\-_/])(\S)/g, (m, a, b) => a + b.toUpperCase());
        return p.blank && s.trim() === '' ? null : s;
      };
      const rows = t.rows.map(r => { const o = Object.assign({}, r); names.forEach(n => { if (typeof o[n] === 'string') o[n] = fix(o[n]); }); return o; });
      return { data: table(t, t.fields, rows) };
    }
  };

  T.derive = {
    cat: 'field', label: 'Derive', glyph: 'ƒ', inputs: 1,
    desc: 'Create a new field from an expression.',
    params: [
      { key: 'name', label: 'New field name', type: 'text', default: 'NewField' },
      { key: 'expression', label: 'Formula', type: 'textarea', default: '', help: EXPR_HELP }
    ],
    title: p => p.name || 'Derive',
    exec(inp, p) {
      const t = inp[0];
      if (!p.name) throw new Error('Enter a name for the new field.');
      const f = DM.compileExpr(p.expression, t.fields);
      const rows = t.rows.map(r => {
        let v = f(r);
        if (typeof v === 'boolean') v = v ? 'T' : 'F';
        if (typeof v === 'number' && !isFinite(v)) v = null;
        return Object.assign({}, r, { [p.name]: v === undefined ? null : v });
      });
      return { data: table(t, U.setField(t.fields, p.name, U.inferType(rows, p.name)), rows) };
    }
  };

  T.binning = {
    cat: 'field', label: 'Binning', glyph: '⊞', inputs: 1,
    desc: 'Group a numeric field into ranges (bins).',
    params: [
      { key: 'field', label: 'Field to bin', type: 'field', fieldType: 'number' },
      { key: 'bins', label: 'Number of bins', type: 'number', default: 4 },
      { key: 'method', label: 'Method', type: 'select', default: 'width', options: [{ v: 'width', l: 'Equal width' }, { v: 'freq', l: 'Equal frequency (quantiles)' }] },
      { key: 'newName', label: 'New field name (blank = <field>_BIN)', type: 'text', default: '' }
    ],
    exec(inp, p) {
      const t = inp[0], f = U.requireField(t, p.field, 'a field to bin');
      if (f.type !== 'number') throw new Error('Binning needs a numeric field.');
      const vals = U.nums(t.rows, f.name), k = Math.max(2, Math.round(+p.bins || 4));
      if (!vals.length) throw new Error('No numeric values to bin.');
      let edges;
      if (p.method === 'freq') edges = Array.from({ length: k - 1 }, (_, i) => U.quantile(vals, (i + 1) / k));
      else { const lo = Math.min(...vals), hi = Math.max(...vals); edges = Array.from({ length: k - 1 }, (_, i) => lo + (hi - lo) * (i + 1) / k); }
      edges = edges.map(e => +e.toFixed(4)).filter((e, i, a) => a.indexOf(e) === i);
      const label = i => i === 0 ? '< ' + U.fmt(edges[0]) : i === edges.length ? '≥ ' + U.fmt(edges[edges.length - 1]) : U.fmt(edges[i - 1]) + ' – ' + U.fmt(edges[i]);
      const name = p.newName || f.name + '_BIN';
      const rows = t.rows.map(r => {
        const v = r[f.name];
        if (!U.isNum(v)) return Object.assign({}, r, { [name]: null });
        let i = 0; while (i < edges.length && v >= edges[i]) i++;
        return Object.assign({}, r, { [name]: (i + 1) + ': ' + label(i) });
      });
      return { data: table(t, U.setField(t.fields, name, 'string'), rows) };
    }
  };

  T.partition = {
    cat: 'field', label: 'Partition', glyph: '÷', inputs: 1,
    desc: 'Randomly split records into Training and Testing sets. Models train on the Training records and are evaluated on both.',
    params: [
      { key: 'train', label: 'Training %', type: 'number', default: 70 },
      { key: 'seed', label: 'Random seed', type: 'number', default: 1234 },
      { key: 'name', label: 'Partition field name', type: 'text', default: 'Partition' }
    ],
    exec(inp, p) {
      const t = inp[0], rand = U.rng(p.seed), name = p.name || 'Partition';
      const rows = t.rows.map(r => Object.assign({}, r, { [name]: rand() * 100 < +p.train ? TRAIN : TEST }));
      const out = table(t, U.setField(t.fields, name, 'string'), rows);
      out.meta.partition = name;
      return { data: out };
    }
  };

  /* ---------- Graphs ---------- */
  T.distribution = {
    cat: 'graphs', label: 'Distribution', glyph: '▆', inputs: 1, terminal: true,
    desc: 'Bar chart of how often each value occurs (numbers are grouped into ranges). Optionally colour by a second field.',
    params: [
      { key: 'field', label: 'Field', type: 'field' },
      { key: 'overlay', label: 'Colour by (optional)', type: 'field', allowNone: true },
      { key: 'bins', label: 'Bins for numeric fields', type: 'number', default: 10 }
    ],
    title: p => p.field ? p.field : 'Distribution',
    exec(inp, p) {
      const t = inp[0], f = U.requireField(t, p.field);
      const ov = p.overlay && U.field(t, p.overlay) ? p.overlay : null;
      let labels, keyOf;
      const vals = f.type === 'number' ? U.nums(t.rows, f.name) : [];
      const distinct = [...new Set(vals)].sort((a, b) => a - b);
      if (f.type === 'number' && distinct.length <= 25 && distinct.every(Number.isInteger)) {
        labels = distinct.map(String); keyOf = v => U.isNum(v) ? String(v) : null;   // few whole numbers: one bar per value
      } else if (f.type === 'number') {
        if (!vals.length) throw new Error('No numeric values to plot.');
        const h = U.histogram(vals, Math.max(2, Math.round(+p.bins || 10)));
        labels = h.labels; keyOf = v => U.isNum(v) ? h.labels[h.binOf(v)] : null;
      } else {
        const c = [...U.counts(t.rows, f.name).entries()].sort((a, b) => b[1] - a[1]).slice(0, 40);
        labels = c.map(e => e[0]); keyOf = v => U.isMissing(v) ? null : String(v);
      }
      const groups = ov ? [...U.counts(t.rows, ov).keys()].sort().slice(0, 10) : ['Count'];
      const series = groups.map(g => ({ name: g, values: labels.map(() => 0) }));
      let missing = 0;
      t.rows.forEach(r => {
        const k = keyOf(r[f.name]); if (k === null) { missing++; return; }
        const i = labels.indexOf(k); if (i < 0) return;
        const g = ov ? groups.indexOf(String(r[ov])) : 0; if (g < 0) return;
        series[g].values[i]++;
      });
      const totals = labels.map((_, i) => series.reduce((s, se) => s + se.values[i], 0)), N = totals.reduce((a, b) => a + b, 0) || 1;
      let html = U.barChart(labels, series, { xLabel: f.name, yLabel: 'Count' });
      html += U.simpleTable(['Value', 'Count', '%'].concat(ov ? groups : []), labels.map((l, i) => [l, totals[i], U.pct(totals[i] / N)].concat(ov ? series.map(se => se.values[i]) : [])));
      if (missing) html += '<p class="muted">' + missing + ' records with missing ' + U.esc(f.name) + ' not shown.</p>';
      return { output: { title: 'Distribution of ' + f.name + (ov ? ' by ' + ov : ''), html } };
    }
  };

  T.plot = {
    cat: 'graphs', label: 'Plot', glyph: '⁘', inputs: 1, terminal: true,
    desc: 'Scatter plot of two numeric fields, optionally coloured by a third.',
    params: [
      { key: 'x', label: 'X field', type: 'field', fieldType: 'number' },
      { key: 'y', label: 'Y field', type: 'field', fieldType: 'number' },
      { key: 'color', label: 'Colour by (optional)', type: 'field', allowNone: true }
    ],
    title: p => p.x && p.y ? p.y + ' x ' + p.x : 'Plot',
    exec(inp, p) {
      const t = inp[0];
      U.requireField(t, p.x, 'an X field'); U.requireField(t, p.y, 'a Y field');
      const c = p.color && U.field(t, p.color) ? p.color : null;
      const pts = t.rows.filter(r => U.isNum(r[p.x]) && U.isNum(r[p.y])).slice(0, 3000)
        .map(r => ({ x: r[p.x], y: r[p.y], c: c ? (U.isMissing(r[c]) ? '$null$' : String(r[c])) : null }));
      if (!pts.length) throw new Error('No records with numeric values for both fields.');
      return { output: { title: 'Plot of ' + p.y + ' vs ' + p.x, html: U.scatter(pts, { xLabel: p.x, yLabel: p.y, line: /^\$/.test(p.y) || /^\$/.test(p.x) }) + '<p class="muted">' + pts.length + ' points.</p>' } };
    }
  };

  /* ---------- Modeling ---------- */
  function resolveInputs(t, p, target) {
    const part = t.meta.partition;
    const chosen = (p.inputs || []).filter(n => U.field(t, n) && n !== target);
    if (chosen.length) return chosen;
    return t.fields.map(f => f.name).filter(n => n !== target && n !== part && n[0] !== '$' && !/^id$|[a-z_]ID$|_id$/.test(n));
  }
  function decideKind(t, target, choice, allowed, label) {
    const f = U.field(t, target);
    let kind = choice;
    if (!kind || kind === 'auto') {
      if (f.type === 'string') kind = 'categorical';
      else { const u = new Set(U.nums(t.rows, target)); kind = u.size <= 5 && [...u].every(Number.isInteger) ? 'categorical' : 'continuous'; }
    }
    if (!allowed.includes(kind)) {
      if (allowed[0] === 'categorical') kind = 'categorical';
      else throw new Error(label + ' needs a numeric (continuous) target. "' + target + '" looks categorical.');
    }
    if (kind === 'continuous' && f.type !== 'number') throw new Error('"' + target + '" is text, so it cannot be a continuous target. Use a Type node or pick another field.');
    return kind;
  }
  function types(t) { const o = {}; t.fields.forEach(f => { o[f.name] = f.type; }); return o; }

  function modelNode(def) {
    const params = [
      { key: 'target', label: 'Target (field to predict)', type: 'field' },
      { key: 'inputs', label: 'Inputs (none checked = all other fields except IDs, Partition and $ fields)', type: 'fields' }
    ];
    if (def.kinds.length > 1) params.push({ key: 'targetKind', label: 'Target is', type: 'select', default: 'auto', options: [{ v: 'auto', l: 'Detect automatically' }, { v: 'categorical', l: 'Categorical (classification)' }, { v: 'continuous', l: 'Continuous (regression)' }] });
    return {
      cat: 'modeling', label: def.label, glyph: def.glyph, inputs: 1, model: true, desc: def.desc,
      params: params.concat(def.params || []),
      title: p => p.target ? p.target : def.label,
      exec(inp, p, ctx) {
        const t = inp[0];
        U.requireField(t, p.target, 'a target field');
        const target = p.target, kind = decideKind(t, target, p.targetKind, def.kinds, def.label);
        const inputs = resolveInputs(t, p, target);
        if (!inputs.length) throw new Error('No input fields to learn from.');
        const part = t.meta.partition && U.field(t, t.meta.partition) ? t.meta.partition : null;
        const train = t.rows.filter(r => (!part || r[part] === TRAIN) && !U.isMissing(r[target]) && (kind !== 'continuous' || U.isNum(r[target])));
        if (train.length < 2) throw new Error('Not enough training records with a value for ' + target + '.');
        const m = DM.models[def.algo](train, inputs, types(t), target, kind, p);
        const pf = '$' + def.prefix + '-' + target, cf = '$' + def.prefix + 'C-' + target;
        const rows = t.rows.map(r => { const o = Object.assign({}, r), res = m.predict(r); o[pf] = res.pred; if (kind === 'categorical') o[cf] = +res.conf.toFixed(4); return o; });
        let fields = U.setField(t.fields, pf, kind === 'categorical' ? U.field(t, target).type : 'number');
        if (kind === 'categorical') fields = U.setField(fields, cf, 'number');
        const meta = U.copyMeta(t.meta);
        meta.models = (meta.models || []).filter(x => x.pred !== pf).concat({ name: ctx.name && ctx.name !== target ? ctx.name : def.label, target, pred: pf, conf: kind === 'categorical' ? cf : null, kind });
        const head = '<p class="model-head"><b>' + U.esc(def.label) + '</b> predicting <b>' + U.esc(target) + '</b> (' + (kind === 'categorical' ? 'classification' : 'regression') + ')<br>' +
          'Trained on ' + train.length + (part ? ' Training-partition' : '') + ' records. Inputs: ' + inputs.map(U.esc).join(', ') + '.<br>' +
          'Adds field <code>' + U.esc(pf) + '</code> (prediction)' + (kind === 'categorical' ? ' and <code>' + U.esc(cf) + '</code> (confidence)' : '') + '.</p>' +
          (part ? '' : '<p class="warn">No Partition node upstream: the model was trained on all records, so there is no separate test set.</p>');
        return { data: { fields, rows, meta }, model: { title: def.label + ': ' + target, html: head + m.summary() } };
      }
    };
  }

  T.tree = modelNode({ label: 'Decision Tree', glyph: '⋔', algo: 'tree', prefix: 'R', kinds: ['categorical', 'continuous'],
    desc: 'C&R-style tree: repeatedly splits the data on the input that best separates the target.',
    params: [{ key: 'maxDepth', label: 'Maximum depth', type: 'number', default: 4 }, { key: 'minLeaf', label: 'Minimum records per leaf', type: 'number', default: 5 }] });
  T.logistic = modelNode({ label: 'Logistic Regression', glyph: '∫', algo: 'logistic', prefix: 'L', kinds: ['categorical'],
    desc: 'Predicts a categorical target from a weighted sum of the inputs.',
    params: [{ key: 'iterations', label: 'Training iterations', type: 'number', default: 300 }, { key: 'learningRate', label: 'Learning rate', type: 'number', default: 0.3 }, { key: 'l2', label: 'Regularisation (L2)', type: 'number', default: 0.001 }] });
  T.linear = modelNode({ label: 'Linear Regression', glyph: '⟋', algo: 'linear', prefix: 'E', kinds: ['continuous'],
    desc: 'Fits a straight-line equation to predict a numeric target.',
    params: [{ key: 'ridge', label: 'Ridge penalty (0 = ordinary least squares)', type: 'number', default: 0 }] });
  T.knn = modelNode({ label: 'KNN', glyph: '◎', algo: 'knn', prefix: 'KNN', kinds: ['categorical', 'continuous'],
    desc: 'k-Nearest Neighbours: predicts from the most similar training records.',
    params: [{ key: 'k', label: 'Number of neighbours (k)', type: 'number', default: 5 }] });
  T.bayes = modelNode({ label: 'Naive Bayes', glyph: 'β', algo: 'bayes', prefix: 'B', kinds: ['categorical'],
    desc: 'Probabilistic classifier that treats inputs as independent given the class.',
    params: [{ key: 'laplace', label: 'Laplace smoothing', type: 'number', default: 1 }] });

  T.kmeans = {
    cat: 'modeling', label: 'K-Means', glyph: '⁂', inputs: 1, model: true,
    desc: 'Clustering: groups similar records together. No target needed.',
    params: [
      { key: 'inputs', label: 'Inputs (none checked = all fields except IDs, Partition and $ fields)', type: 'fields' },
      { key: 'k', label: 'Number of clusters', type: 'number', default: 3 },
      { key: 'seed', label: 'Random seed', type: 'number', default: 1 }
    ],
    exec(inp, p, ctx) {
      const t = inp[0], inputs = resolveInputs(t, p, null);
      if (!inputs.length) throw new Error('No input fields to cluster on.');
      const m = DM.models.kmeans(t.rows, inputs, types(t), p);
      const rows = t.rows.map(r => { const res = m.predict(r); return Object.assign({}, r, { '$KM-K-Means': res.pred, '$KMD-K-Means': +res.conf.toFixed(4) }); });
      const fields = U.setField(U.setField(t.fields, '$KM-K-Means', 'string'), '$KMD-K-Means', 'number');
      const head = '<p class="model-head"><b>K-Means</b> on ' + t.rows.length + ' records. Inputs: ' + inputs.map(U.esc).join(', ') +
        '.<br>Adds <code>$KM-K-Means</code> (cluster) and <code>$KMD-K-Means</code> (distance to cluster centre).</p>';
      return { data: table(t, fields, rows), model: { title: 'K-Means (' + p.k + ' clusters)', html: head + m.summary() } };
    }
  };

  /* ---------- Output ---------- */
  T.table = {
    cat: 'output', label: 'Table', glyph: '▤', inputs: 1, terminal: true,
    desc: 'Show the data as a table.',
    params: [{ key: 'maxRows', label: 'Maximum rows to show', type: 'number', default: 500 }],
    exec(inp, p, ctx) { return { output: { title: 'Table (' + ctx.inputNames[0] + ')', html: U.htmlTable(inp[0], +p.maxRows || 500) } }; }
  };

  T.audit = {
    cat: 'output', label: 'Data Audit', glyph: '✓', inputs: 1, terminal: true,
    desc: 'Summary statistics and data quality for every field.',
    params: [],
    exec(inp) {
      const t = inp[0], n = t.rows.length;
      const rows = t.fields.map(f => {
        const miss = t.rows.filter(r => U.isMissing(r[f.name])).length;
        const uniq = U.counts(t.rows, f.name).size;
        const missCell = { html: miss ? '<span class="' + (miss / n > 0.05 ? 'bad' : 'warnc') + '">' + miss + ' (' + U.pct(miss / Math.max(1, n)) + ')</span>' : '0' };
        if (f.type === 'number') {
          const v = U.nums(t.rows, f.name);
          return [f.name, { html: '<span class="ftype number">#</span>' }, { html: v.length > 1 ? U.sparkBars(U.histogram(v, 12).counts) : '' }, v.length ? Math.min(...v) : '', v.length ? Math.max(...v) : '',
            v.length ? U.mean(v) : '', v.length ? U.std(v) : '', uniq, n - miss, missCell];
        }
        const c = [...U.counts(t.rows, f.name).entries()].sort((a, b) => b[1] - a[1]);
        return [f.name, { html: '<span class="ftype string">A</span>' }, { html: U.sparkBars(c.slice(0, 12).map(e => e[1])) }, '', '', '', '',
          { html: uniq + (c.length ? ' <span class="muted">top: ' + U.esc(c[0][0]) + '</span>' : '') }, n - miss, missCell];
      });
      return { output: { title: 'Data Audit', html: '<p>' + n + ' records, ' + t.fields.length + ' fields.</p>' +
        U.simpleTable(['Field', 'Type', 'Shape', 'Min', 'Max', 'Mean', 'Std Dev', 'Unique', 'Valid', 'Missing'], rows) +
        '<p class="muted">Tip: use Clean Text for inconsistent labels (look at Unique counts), Fill Missing for $null$ values, and Distinct for duplicate records.</p>' } };
    }
  };

  T.analysis = {
    cat: 'output', label: 'Analysis', glyph: '⚖', inputs: 1, terminal: true,
    desc: 'Evaluate model predictions: accuracy & confusion matrix for classification, error measures for regression — separately for Training and Testing.',
    params: [],
    exec(inp) {
      const t = inp[0], models = (t.meta.models || []).filter(m => U.field(t, m.pred) && U.field(t, m.target));
      if (!models.length) throw new Error('No model predictions found. Connect Analysis after a modeling node.');
      const part = t.meta.partition && U.field(t, t.meta.partition) ? t.meta.partition : null;
      const groups = part ? [[TRAIN, t.rows.filter(r => r[part] === TRAIN)], [TEST, t.rows.filter(r => r[part] === TEST)]] : [['All records', t.rows]];
      let html = '';
      models.forEach(m => {
        html += '<h3>' + U.esc(m.name) + ' → ' + U.esc(m.target) + ' <span class="muted">(' + U.esc(m.pred) + ')</span></h3><div class="analysis-cols">';
        groups.forEach(([gname, rows]) => {
          const rs = rows.filter(r => !U.isMissing(r[m.target]) && !U.isMissing(r[m.pred]));
          html += '<div class="analysis-col"><h4>' + U.esc(gname) + ' <span class="muted">(' + rs.length + ' records)</span></h4>';
          if (!rs.length) { html += '<p class="muted">No records.</p></div>'; return; }
          if (m.kind === 'categorical') {
            const correct = rs.filter(r => String(r[m.target]) === String(r[m.pred])).length;
            const labels = [...new Set(rs.map(r => String(r[m.target])).concat(rs.map(r => String(r[m.pred]))))].sort();
            const cm = labels.map(a => labels.map(pd => rs.filter(r => String(r[m.target]) === a && String(r[m.pred]) === pd).length));
            html += '<p class="big">Accuracy <b>' + U.pct(correct / rs.length) + '</b> <span class="muted">(' + correct + ' correct, ' + (rs.length - correct) + ' wrong)</span></p>';
            html += '<p class="muted">Confusion matrix — rows: actual, columns: predicted</p>';
            html += U.simpleTable(['Actual \\ Predicted'].concat(labels), labels.map((a, i) => [a].concat(cm[i].map((v, j) => ({ html: String(v), cls: 'num ' + (i === j ? 'diag' : v ? 'off' : '') })))), { cls: 'confusion' });
            html += U.simpleTable(['Class', 'Precision', 'Recall'], labels.map((l, i) => {
              const tp = cm[i][i], col = cm.reduce((s, r) => s + r[i], 0), row = cm[i].reduce((a, b) => a + b, 0);
              return [l, col ? U.pct(tp / col) : '–', row ? U.pct(tp / row) : '–'];
            }));
          } else {
            const e = rs.map(r => r[m.target] - r[m.pred]), y = rs.map(r => r[m.target]), ym = U.mean(y);
            const sse = e.reduce((s, v) => s + v * v, 0), sst = y.reduce((s, v) => s + (v - ym) ** 2, 0);
            html += U.simpleTable(['Measure', 'Value'], [['Mean absolute error', U.mean(e.map(Math.abs))], ['Root mean squared error', Math.sqrt(sse / rs.length)],
              ['R² (variance explained)', sst ? 1 - sse / sst : 0], ['Mean error (bias)', U.mean(e)]]);
          }
          html += '</div>';
        });
        html += '</div>';
      });
      if (part) html += '<p class="muted">Compare Training vs Testing: a much better Training score means the model is over-fitting (memorising rather than learning).</p>';
      return { output: { title: 'Analysis: ' + models.map(m => m.name).join(', '), html } };
    }
  };

  T.export = {
    cat: 'output', label: 'Export CSV', glyph: '⤓', inputs: 1, terminal: true,
    desc: 'Download the data as a CSV file.',
    params: [{ key: 'fileName', label: 'File name', type: 'text', default: 'export.csv' }],
    exec(inp, p) {
      const name = (p.fileName || 'export.csv').replace(/[^\w.\- ]/g, '_');
      return { output: { title: 'Export: ' + name, html: '<p>' + inp[0].rows.length + ' records ready.</p>', download: { name: /\.csv$/i.test(name) ? name : name + '.csv', text: U.toCSV(inp[0]) } } };
    }
  };

  DM.nodeTypes = T;
  DM.defaultParams = function (type) {
    const o = {};
    (T[type].params || []).forEach(p => {
      if (p.type === 'info') return;
      o[p.key] = p.default !== undefined ? JSON.parse(JSON.stringify(p.default)) : (p.type === 'fields' || p.type === 'multi' ? [] : '');
    });
    return o;
  };
})(window.DM);
