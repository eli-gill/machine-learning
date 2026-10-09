/* Small, readable implementations of the modeling algorithms. Each trainer
   returns an object with predict(row) -> { pred, conf } and summary() -> HTML. */
(function (DM) {
  'use strict';
  const U = DM.util;
  const M = {};

  // Distinct target classes (string keys), remembering one original value for each.
  function classList(rows, target) {
    const m = new Map();
    rows.forEach(r => { const v = r[target]; if (!U.isMissing(v) && !m.has(String(v))) m.set(String(v), v); });
    return [...m.entries()].sort((a, b) => a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0).map(([key, value]) => ({ key, value }));
  }

  /* Turns rows into numeric vectors: numbers are standardized (missing -> mean),
     strings become one-hot indicator columns. */
  M.encoder = function (rows, inputs, types, opts) {
    opts = opts || {};
    const specs = inputs.map(name => {
      if (types[name] === 'number') {
        const v = U.nums(rows, name);
        let sd = U.std(v);
        if (!(sd > 0)) sd = 1;
        return { name, kind: 'num', mean: v.length ? U.mean(v) : 0, sd };
      }
      const counts = [...U.counts(rows, name).entries()].sort((a, b) => b[1] - a[1]).slice(0, 30).map(e => e[0]);
      return opts.dropFirst ? { name, kind: 'cat', base: counts[0], cats: counts.slice(1) } : { name, kind: 'cat', cats: counts };
    });
    const names = [];
    specs.forEach(s => { if (s.kind === 'num') names.push(s.name); else s.cats.forEach(c => names.push(s.name + ' = ' + c)); });
    return {
      specs, names, dim: names.length,
      encode(r) {
        const x = [];
        for (const s of specs) {
          const v = r[s.name];
          if (s.kind === 'num') x.push(U.isNum(v) ? (v - s.mean) / s.sd : 0);
          else { const k = U.isMissing(v) ? null : String(v); for (const c of s.cats) x.push(k === c ? 1 : 0); }
        }
        return x;
      }
    };
  };

  /* ---------- Decision tree (CART: Gini for classes, variance for numbers) ---------- */
  M.tree = function (rows, inputs, types, target, kind, p) {
    const isCls = kind === 'categorical';
    const maxDepth = Math.max(1, +p.maxDepth || 5), minLeaf = Math.max(1, +p.minLeaf || 1);
    const classes = isCls ? classList(rows, target) : null;
    const ci = isCls ? new Map(classes.map((c, i) => [c.key, i])) : null;
    const K = isCls ? classes.length : 0;
    const y = rows.map(r => isCls ? ci.get(String(r[target])) : +r[target]);
    const cols = inputs.map(name => {
      if (types[name] === 'number') {
        const fill = U.mean(U.nums(rows, name)) || 0;
        return { name, num: true, fill, x: rows.map(r => U.isNum(r[name]) ? r[name] : fill) };
      }
      return { name, num: false, x: rows.map(r => U.isMissing(r[name]) ? '(missing)' : String(r[name])) };
    });
    const importance = {};
    inputs.forEach(n => { importance[n] = 0; });
    const giniW = (c, n) => { let s = 0; for (const v of c) s += v * v; return n - s / n; };   // n * Gini
    const sse = (s, s2, n) => s2 - s * s / n;

    function build(idx, depth) {
      const n = idx.length, node = { n };
      if (isCls) {
        const c = new Array(K).fill(0);
        idx.forEach(i => c[y[i]]++);
        let b = 0; c.forEach((v, i) => { if (v > c[b]) b = i; });
        Object.assign(node, { counts: c, pred: b, conf: c[b] / n, imp: giniW(c, n) });
      } else {
        let s = 0, s2 = 0;
        idx.forEach(i => { s += y[i]; s2 += y[i] * y[i]; });
        Object.assign(node, { mean: s / n, s, s2, imp: sse(s, s2, n) });
      }
      if (depth >= maxDepth || n < 2 * minLeaf || node.imp <= 1e-9) return node;

      let best = null;
      for (const col of cols) {
        if (col.num) {
          const sorted = idx.slice().sort((a, b) => col.x[a] - col.x[b]);
          const lc = isCls ? new Array(K).fill(0) : null, rc = isCls ? node.counts.slice() : null;
          let ls = 0, ls2 = 0;
          for (let k = 0; k < n - 1; k++) {
            const i = sorted[k];
            if (isCls) { lc[y[i]]++; rc[y[i]]--; } else { ls += y[i]; ls2 += y[i] * y[i]; }
            const nl = k + 1, nr = n - nl;
            const a = col.x[i], b = col.x[sorted[k + 1]];
            if (a === b || nl < minLeaf || nr < minLeaf) continue;
            const score = isCls ? giniW(lc, nl) + giniW(rc, nr) : sse(ls, ls2, nl) + sse(node.s - ls, node.s2 - ls2, nr);
            const gain = node.imp - score;
            if (!best || gain > best.gain) best = { gain, col, thr: (a + b) / 2 };
          }
        } else {
          const groups = new Map();
          idx.forEach(i => {
            const v = col.x[i];
            let e = groups.get(v);
            if (!e) { e = isCls ? { n: 0, c: new Array(K).fill(0) } : { n: 0, s: 0, s2: 0 }; groups.set(v, e); }
            e.n++;
            if (isCls) e.c[y[i]]++; else { e.s += y[i]; e.s2 += y[i] * y[i]; }
          });
          if (groups.size < 2) continue;
          groups.forEach((e, cat) => {
            const nl = e.n, nr = n - nl;
            if (nl < minLeaf || nr < minLeaf) return;
            const score = isCls ? giniW(e.c, nl) + giniW(node.counts.map((v, j) => v - e.c[j]), nr)
              : sse(e.s, e.s2, nl) + sse(node.s - e.s, node.s2 - e.s2, nr);
            const gain = node.imp - score;
            if (!best || gain > best.gain) best = { gain, col, cat };
          });
        }
      }
      if (!best || best.gain <= 1e-9) return node;
      importance[best.col.name] += best.gain;
      const L = [], R = [];
      idx.forEach(i => { (best.col.num ? best.col.x[i] <= best.thr : best.col.x[i] === best.cat) ? L.push(i) : R.push(i); });
      node.split = { field: best.col.name, num: best.col.num, thr: best.thr, cat: best.cat, fill: best.col.fill };
      node.left = build(L, depth + 1);
      node.right = build(R, depth + 1);
      return node;
    }
    const root = build(rows.map((_, i) => i), 0);

    function leafOf(r) {
      let nd = root;
      while (nd.split) {
        const s = nd.split, v = r[s.field];
        const goLeft = s.num ? (U.isNum(v) ? v : s.fill) <= s.thr : (U.isMissing(v) ? '(missing)' : String(v)) === s.cat;
        nd = goLeft ? nd.left : nd.right;
      }
      return nd;
    }
    const leafText = nd => isCls
      ? '<b>' + U.esc(classes[nd.pred].key) + '</b> <span class="muted">(' + U.pct(nd.conf) + ', n=' + nd.n + ')</span>'
      : '<b>' + U.fmt(nd.mean) + '</b> <span class="muted">(n=' + nd.n + ')</span>';
    function render(nd) {
      if (!nd.split) return '';
      const s = nd.split;
      const cL = s.num ? U.esc(s.field) + ' ≤ ' + U.fmt(s.thr) : U.esc(s.field) + ' = "' + U.esc(s.cat) + '"';
      const cR = s.num ? U.esc(s.field) + ' &gt; ' + U.fmt(s.thr) : U.esc(s.field) + ' ≠ "' + U.esc(s.cat) + '"';
      const item = (cond, ch) => '<li><span class="cond">' + cond + '</span>' + (ch.split ? ' <span class="muted">(n=' + ch.n + ')</span>' + render(ch) : ' → ' + leafText(ch)) + '</li>';
      return '<ul>' + item(cL, nd.left) + item(cR, nd.right) + '</ul>';
    }
    let leaves = 0, depth = 0;
    (function walk(nd, d) { depth = Math.max(depth, d); if (!nd.split) leaves++; else { walk(nd.left, d + 1); walk(nd.right, d + 1); } })(root, 0);

    return {
      predict(r) {
        const nd = leafOf(r);
        return isCls ? { pred: classes[nd.pred].value, conf: nd.conf } : { pred: nd.mean };
      },
      summary() {
        return '<h3>Tree structure</h3><p class="muted">' + leaves + ' leaves, depth ' + depth + '. Each line is a rule; follow a path from the top to reach a prediction.</p>' +
          '<div class="tree">' + (root.split ? '<div><span class="cond">All records</span> <span class="muted">(n=' + root.n + ')</span></div>' + render(root) : 'No useful split found. Prediction for every record: ' + leafText(root)) + '</div>' +
          importanceHtml(importance);
      }
    };
  };

  function importanceHtml(imp) {
    const entries = Object.entries(imp).filter(e => e[1] > 0).sort((a, b) => b[1] - a[1]);
    if (!entries.length) return '';
    const tot = entries.reduce((s, e) => s + e[1], 0);
    return '<h3>Predictor importance</h3><div class="bars">' + entries.map(([n, v]) =>
      '<div class="bar-row"><span class="bar-name">' + U.esc(n) + '</span><span class="bar"><span style="width:' + (100 * v / tot).toFixed(1) + '%"></span></span><span class="bar-val">' + (v / tot).toFixed(3) + '</span></div>').join('') + '</div>';
  }

  /* ---------- CHAID (chi-squared automatic interaction detection) ----------
     A tree for a categorical target. At each node every input is grouped by merging the categories
     whose class mix is not significantly different (chi-squared test); the input with the smallest
     Bonferroni-adjusted p-value is used to split the node, with one child per merged group. */

  // Upper tail of the chi-squared distribution: P(X > x) for df degrees of freedom (regularised incomplete gamma).
  function chiSqP(x, df) {
    if (!(df > 0)) return 1;
    if (!(x > 0)) return 1;
    const a = df / 2, z = x / 2, lg = lgamma(a);
    if (z < a + 1) {   // series for the lower tail
      let term = 1 / a, sum = term;
      for (let n = 1; n < 500; n++) { term *= z / (a + n); sum += term; if (term < sum * 1e-14) break; }
      return Math.max(0, 1 - sum * Math.exp(-z + a * Math.log(z) - lg));
    }
    // continued fraction (Lentz) for the upper tail
    let b = z + 1 - a, c = 1 / 1e-300, d = 1 / b, h = d;
    for (let i = 1; i < 500; i++) {
      const an = -i * (i - a);
      b += 2; d = an * d + b; if (Math.abs(d) < 1e-300) d = 1e-300;
      c = b + an / c; if (Math.abs(c) < 1e-300) c = 1e-300;
      d = 1 / d; const del = d * c; h *= del;
      if (Math.abs(del - 1) < 1e-14) break;
    }
    return Math.min(1, Math.exp(-z + a * Math.log(z) - lg) * h);
  }
  function lgamma(x) {   // Lanczos approximation
    const g = [676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059, 12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7];
    if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - lgamma(1 - x);
    x -= 1;
    let s = 0.99999999999980993;
    g.forEach((gi, i) => { s += gi / (x + i + 1); });
    const t = x + g.length - 0.5;
    return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(s);
  }
  M.chiSqP = chiSqP;

  // Pearson chi-squared test on a table of count rows (one per group) by class columns; empty columns are ignored.
  function chiSqTable(rowsCounts) {
    const K = rowsCounts[0].length, colTot = new Array(K).fill(0), rowTot = rowsCounts.map(r => r.reduce((a, b) => a + b, 0));
    rowsCounts.forEach(r => r.forEach((v, k) => { colTot[k] += v; }));
    const total = rowTot.reduce((a, b) => a + b, 0), cols = colTot.filter(v => v > 0).length;
    const df = (rowsCounts.length - 1) * (cols - 1);
    if (df <= 0 || !total) return { chi: 0, df: 0, p: 1 };
    let chi = 0;
    rowsCounts.forEach((r, i) => r.forEach((v, k) => { if (colTot[k] > 0 && rowTot[i] > 0) { const e = rowTot[i] * colTot[k] / total; chi += (v - e) * (v - e) / e; } }));
    return { chi, df, p: chiSqP(chi, df) };
  }

  // Stirling numbers of the second kind: ways to merge c categories into r groups (nominal Bonferroni multiplier).
  function stirling2(c, r) {
    let prev = new Array(r + 1).fill(0); prev[0] = 1;
    for (let n = 1; n <= c; n++) {
      const cur = new Array(r + 1).fill(0);
      for (let k = 1; k <= Math.min(n, r); k++) cur[k] = k * prev[k] + prev[k - 1];
      prev = cur;
    }
    return prev[r];
  }
  function choose(n, k) { if (k < 0 || k > n) return 0; let r = 1; for (let i = 1; i <= k; i++) r = r * (n - k + i) / i; return r; }

  M.chaid = function (rows, inputs, types, target, kind, p) {
    const classes = classList(rows, target), K = classes.length;
    if (K < 2) throw new Error('The target needs at least two different values in the training data.');
    const ci = new Map(classes.map((c, i) => [c.key, i]));
    const y = rows.map(r => ci.get(String(r[target])));
    const alphaSplit = p.alphaSplit === '' || p.alphaSplit == null ? 0.05 : +p.alphaSplit;
    const alphaMerge = p.alphaMerge === '' || p.alphaMerge == null ? 0.05 : +p.alphaMerge;
    const maxDepth = Math.max(1, Math.round(+p.maxDepth || 3)), minParent = Math.max(2, +p.minParent || 30), minChild = Math.max(1, +p.minChild || 10);
    const nBins = Math.max(2, Math.round(+p.bins || 10));
    const MISSING = '(missing)';

    // Turn every input into category codes. Numbers become ordered bins; text stays unordered.
    const cols = inputs.map(name => {
      if (types[name] === 'number') {
        const vals = U.nums(rows, name), distinct = [...new Set(vals)].sort((a, b) => a - b);
        let edges;
        if (distinct.length <= nBins) edges = distinct.slice(1).map((v, i) => (v + distinct[i]) / 2);
        else { edges = []; for (let i = 1; i < nBins; i++) { const e = U.quantile(vals, i / nBins); if (!edges.length || e > edges[edges.length - 1]) edges.push(e); } }
        const binOf = v => { let b = 0; while (b < edges.length && v > edges[b]) b++; return b; };
        const miss = edges.length + 1;
        return { name, num: true, edges, miss, codeOf: v => U.isNum(v) ? binOf(v) : miss, train: rows.map(r => U.isNum(r[name]) ? binOf(r[name]) : miss) };
      }
      const labels = new Map();
      const lab = v => U.isMissing(v) ? MISSING : String(v);
      rows.forEach(r => { const l = lab(r[name]); if (!labels.has(l)) labels.set(l, labels.size); });
      const names = [...labels.keys()];
      return { name, num: false, names, codeOf: v => labels.has(lab(v)) ? labels.get(lab(v)) : -1, train: rows.map(r => labels.get(lab(r[name]))) };
    });

    const importance = {};
    inputs.forEach(n => { importance[n] = 0; });
    const classCounts = idx => { const c = new Array(K).fill(0); idx.forEach(i => c[y[i]]++); return c; };

    // Best grouping of one input's categories within the records idx; null when it cannot be split.
    function groupColumn(col, idx) {
      const byCode = new Map();
      idx.forEach(i => { const c = col.train[i]; let g = byCode.get(c); if (!g) { g = { codes: [c], counts: new Array(K).fill(0), n: 0, floating: col.num && c === col.miss }; byCode.set(c, g); } g.counts[y[i]]++; g.n++; });
      let groups = [...byCode.values()].sort((a, b) => a.codes[0] - b.codes[0]);
      if (groups.length < 2) return null;
      const cats = groups.length, hasMissing = col.num && byCode.has(col.miss);
      const allowed = list => {   // pairs of groups that may be merged
        const out = [];
        if (!col.num) { for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) out.push([list[i], list[j]]); return out; }
        const ordered = list.filter(g => !g.floating);
        for (let i = 0; i + 1 < ordered.length; i++) out.push([ordered[i], ordered[i + 1]]);
        list.filter(g => g.floating).forEach(f => ordered.forEach(o => out.push([f, o])));
        return out;
      };
      const mergeInto = (a, b) => {
        a.codes = a.codes.concat(b.codes).sort((x, z) => x - z); a.n += b.n; a.floating = a.floating && b.floating;
        b.counts.forEach((v, k) => { a.counts[k] += v; });
        groups = groups.filter(g => g !== b).sort((x, z) => x.codes[0] - z.codes[0]);
      };
      const pairP = (a, b) => chiSqTable([a.counts, b.counts]).p;
      while (groups.length > 1) {   // merge the least different pair while it is not significant
        let best = null;
        allowed(groups).forEach(([a, b]) => { const pv = pairP(a, b); if (!best || pv > best.p) best = { a, b, p: pv }; });
        if (!best || best.p <= alphaMerge) break;
        mergeInto(best.a, best.b);
      }
      while (groups.length > 1) {   // then fold in groups that are too small to be a child node
        const small = groups.filter(g => g.n < minChild).sort((a, b) => a.n - b.n)[0];
        if (!small) break;
        let best = null;
        allowed(groups).filter(pr => pr.includes(small)).forEach(([a, b]) => { const pv = pairP(a, b); if (!best || pv > best.p) best = { a, b, p: pv }; });
        if (!best) break;
        mergeInto(best.a, best.b);
      }
      if (groups.length < 2) return null;
      const test = chiSqTable(groups.map(g => g.counts));
      const r = groups.length;
      let mult;
      if (col.num) {
        const c0 = cats - (hasMissing ? 1 : 0), r0 = groups.filter(g => g.codes.some(c => c !== col.miss)).length;
        mult = choose(Math.max(0, c0 - 1), Math.max(0, r0 - 1)) * (hasMissing ? r : 1);
      } else mult = stirling2(cats, r);
      return { col, groups, chi: test.chi, df: test.df, p: Math.min(1, test.p * Math.max(1, mult)) };
    }

    function build(idx, depth) {
      const n = idx.length, counts = classCounts(idx);
      let b = 0; counts.forEach((v, i) => { if (v > counts[b]) b = i; });
      const node = { n, counts, pred: b, conf: counts[b] / n };
      if (depth >= maxDepth || n < minParent || counts[b] === n) return node;
      let best = null;
      cols.forEach(col => {
        const g = groupColumn(col, idx);
        if (g && g.df > 0 && (!best || g.p < best.p || (g.p === best.p && g.chi > best.chi))) best = g;
      });
      if (!best || best.p >= alphaSplit) return node;
      importance[best.col.name] += best.chi;
      const codeToGroup = new Map();
      best.groups.forEach((g, gi) => g.codes.forEach(c => codeToGroup.set(c, gi)));
      node.split = { col: best.col, groups: best.groups.map(g => ({ codes: g.codes })), codeToGroup, chi: best.chi, df: best.df, p: best.p };
      node.children = best.groups.map((g, gi) => build(idx.filter(i => codeToGroup.get(best.col.train[i]) === gi), depth + 1));
      return node;
    }
    const root = build(rows.map((_, i) => i), 0);

    function leafOf(r) {
      let nd = root;
      while (nd.split) {
        const gi = nd.split.codeToGroup.get(nd.split.col.codeOf(r[nd.split.col.name]));
        if (gi === undefined) break;   // a value never seen in training: keep this node's prediction
        nd = nd.children[gi];
      }
      return nd;
    }

    function condition(col, codes) {
      const f = U.esc(col.name);
      if (!col.num) return codes.length === 1 ? f + ' = "' + U.esc(col.names[codes[0]]) + '"' : f + ' in {' + codes.map(c => '"' + U.esc(col.names[c]) + '"').join(', ') + '}';
      const real = codes.filter(c => c !== col.miss), hasMiss = codes.length !== real.length;
      if (!real.length) return f + ' is missing';
      const lo = Math.min(...real), hi = Math.max(...real);
      const lower = lo > 0 ? col.edges[lo - 1] : -Infinity, upper = hi < col.edges.length ? col.edges[hi] : Infinity;
      let t;
      if (lower === -Infinity && upper === Infinity) t = f + ' (any value)';
      else if (lower === -Infinity) t = f + ' ≤ ' + U.fmt(upper);
      else if (upper === Infinity) t = f + ' &gt; ' + U.fmt(lower);
      else t = U.fmt(lower) + ' &lt; ' + f + ' ≤ ' + U.fmt(upper);
      return t + (hasMiss ? ' or missing' : '');
    }
    const leafText = nd => '<b>' + U.esc(classes[nd.pred].key) + '</b> <span class="muted">(' + U.pct(nd.conf) + ', n=' + nd.n + ')</span>';
    function render(nd) {
      if (!nd.split) return '';
      const s = nd.split;
      return '<div class="muted">split on <b>' + U.esc(s.col.name) + '</b>: χ² = ' + U.fmt(s.chi, 3) + ', df = ' + s.df + ', adjusted p = ' + (s.p < 0.0001 ? '&lt; 0.0001' : U.fmt(s.p, 3)) + '</div><ul>' +
        s.groups.map((g, gi) => { const ch = nd.children[gi]; return '<li><span class="cond">' + condition(s.col, g.codes) + '</span>' + (ch.split ? ' <span class="muted">(n=' + ch.n + ')</span>' + render(ch) : ' → ' + leafText(ch)) + '</li>'; }).join('') + '</ul>';
    }
    let leaves = 0, depth = 0;
    (function walk(nd, d) { depth = Math.max(depth, d); if (!nd.split) leaves++; else nd.children.forEach(c => walk(c, d + 1)); })(root, 0);

    return {
      predict(r) { const nd = leafOf(r); return { pred: classes[nd.pred].value, conf: nd.conf }; },
      summary() {
        return '<h3>CHAID tree</h3><p class="muted">' + leaves + ' leaves, depth ' + depth + '. Categories whose outcomes are not significantly different (merge p &gt; ' + alphaMerge + ') are grouped together; ' +
          'a node splits only if the adjusted p-value is below ' + alphaSplit + '. Numeric inputs are cut into up to ' + nBins + ' bins first.</p>' +
          '<div class="tree">' + (root.split ? '<div><span class="cond">All records</span> <span class="muted">(n=' + root.n + ')</span></div>' + render(root) : 'No significant split found. Prediction for every record: ' + leafText(root)) + '</div>' +
          importanceHtml(importance);
      }
    };
  };

  /* ---------- Logistic regression (softmax, gradient descent) ---------- */
  M.logistic = function (rows, inputs, types, target, kind, p) {
    const classes = classList(rows, target), K = classes.length;
    if (K < 2) throw new Error('The target needs at least two different values in the training data.');
    const ci = new Map(classes.map((c, i) => [c.key, i]));
    const enc = M.encoder(rows, inputs, types, { dropFirst: true });
    const X = rows.map(r => enc.encode(r).concat(1)), y = rows.map(r => ci.get(String(r[target])));
    const D = enc.dim + 1, n = X.length, iters = Math.max(1, +p.iterations || 300), lr = +p.learningRate || 0.3, l2 = +p.l2 || 0;
    const W = Array.from({ length: K }, () => new Array(D).fill(0));
    const probs = x => {
      const z = W.map(w => w.reduce((s, wj, j) => s + wj * x[j], 0));
      const mx = Math.max(...z), e = z.map(v => Math.exp(v - mx)), t = e.reduce((a, b) => a + b, 0);
      return e.map(v => v / t);
    };
    for (let it = 0; it < iters; it++) {
      const G = Array.from({ length: K }, () => new Array(D).fill(0));
      for (let i = 0; i < n; i++) {
        const pr = probs(X[i]);
        for (let k = 0; k < K; k++) {
          const g = pr[k] - (y[i] === k ? 1 : 0);
          if (g !== 0) for (let j = 0; j < D; j++) G[k][j] += g * X[i][j];
        }
      }
      for (let k = 0; k < K; k++) for (let j = 0; j < D; j++) W[k][j] -= lr * (G[k][j] / n + (j < D - 1 ? l2 * W[k][j] : 0));
    }
    const featNames = enc.names.concat('(Intercept)');
    return {
      predict(r) {
        const pr = probs(enc.encode(r).concat(1));
        let b = 0; pr.forEach((v, i) => { if (v > pr[b]) b = i; });
        return { pred: classes[b].value, conf: pr[b] };
      },
      summary() {
        let h = '<p class="muted">Inputs are standardized (numbers) or 0/1 indicators (categories, compared with the most common value' +
          '). A positive coefficient raises the chance of that class.</p>';
        if (K === 2) {
          const pos = classes[1].key;
          h += '<h3>Coefficients for ' + U.esc(target) + ' = "' + U.esc(pos) + '"</h3>' +
            U.simpleTable(['Term', 'Coefficient', 'Odds ratio'], featNames.map((f, j) => { const c = W[1][j] - W[0][j]; return [f, c, Math.exp(c)]; }));
        } else {
          h += '<h3>Coefficients by class</h3>' + U.simpleTable(['Term'].concat(classes.map(c => c.key)), featNames.map((f, j) => [f].concat(W.map(w => w[j]))));
        }
        return h;
      }
    };
  };

  /* ---------- Linear regression (least squares with a tiny ridge penalty) ---------- */
  function solve(A, b) {
    const n = b.length, M2 = A.map((row, i) => row.concat(b[i]));
    for (let c = 0; c < n; c++) {
      let piv = c;
      for (let r = c + 1; r < n; r++) if (Math.abs(M2[r][c]) > Math.abs(M2[piv][c])) piv = r;
      [M2[c], M2[piv]] = [M2[piv], M2[c]];
      const d = M2[c][c] || 1e-12;
      for (let r = 0; r < n; r++) {
        if (r === c) continue;
        const f = M2[r][c] / d;
        if (f) for (let k = c; k <= n; k++) M2[r][k] -= f * M2[c][k];
      }
    }
    return M2.map((row, i) => row[n] / (row[i] || 1e-12));
  }
  M.linear = function (rows, inputs, types, target, kind, p) {
    const enc = M.encoder(rows, inputs, types, { dropFirst: true });
    const X = rows.map(r => enc.encode(r).concat(1)), y = rows.map(r => +r[target]);
    const D = enc.dim + 1, lambda = 1e-6 + (+p.ridge || 0);
    const A = Array.from({ length: D }, () => new Array(D).fill(0)), b = new Array(D).fill(0);
    X.forEach((x, i) => { for (let j = 0; j < D; j++) { b[j] += x[j] * y[i]; for (let k = 0; k < D; k++) A[j][k] += x[j] * x[k]; } });
    for (let j = 0; j < D - 1; j++) A[j][j] += lambda * rows.length;
    const w = solve(A, b);
    const predict = x => x.reduce((s, v, j) => s + v * w[j], 0);
    // Convert standardized coefficients back to the original units.
    let intercept = w[D - 1];
    const terms = [];
    let j = 0;
    enc.specs.forEach(s => {
      if (s.kind === 'num') { const c = w[j++] / s.sd; intercept -= c * s.mean; terms.push([s.name, c, w[j - 1]]); }
      else s.cats.forEach(c => { terms.push([s.name + ' = ' + c + ' (vs ' + s.base + ')', w[j], w[j]]); j++; });
    });
    const preds = X.map(predict), ym = U.mean(y);
    const ssr = preds.reduce((s, v, i) => s + (y[i] - v) ** 2, 0), sst = y.reduce((s, v) => s + (v - ym) ** 2, 0);
    return {
      predict: r => ({ pred: predict(enc.encode(r).concat(1)) }),
      summary() {
        return '<h3>Equation</h3><p class="equation">' + U.esc(target) + ' ≈ ' + U.fmt(intercept) +
          terms.map(t => (t[1] < 0 ? ' − ' : ' + ') + U.fmt(Math.abs(t[1])) + ' × [' + U.esc(t[0].replace(/ \(vs .*\)$/, '')) + ']').join('') + '</p>' +
          '<p>Training R² = <b>' + (1 - ssr / sst).toFixed(3) + '</b>, RMSE = ' + U.fmt(Math.sqrt(ssr / rows.length)) + '</p>' +
          '<h3>Coefficients</h3>' + U.simpleTable(['Term', 'Coefficient (original units)', 'Standardized'], [['(Intercept)', intercept, '']].concat(terms)) +
          '<p class="muted">Category terms are 0/1 indicators compared with the most common category. Standardized coefficients show the effect of a one-standard-deviation change, so they can be compared across inputs.</p>';
      }
    };
  };

  /* ---------- k-Nearest Neighbours ---------- */
  M.knn = function (rows, inputs, types, target, kind, p) {
    const isCls = kind === 'categorical', k = Math.max(1, Math.min(rows.length, Math.round(+p.k || 5)));
    const enc = M.encoder(rows, inputs, types);
    const X = rows.map(r => enc.encode(r)), y = rows.map(r => r[target]);
    return {
      predict(r) {
        const x = enc.encode(r), best = [];  // [dist, index] sorted ascending, length <= k
        for (let i = 0; i < X.length; i++) {
          let d = 0; const xi = X[i];
          for (let j = 0; j < x.length; j++) { const t = x[j] - xi[j]; d += t * t; }
          if (best.length < k || d < best[best.length - 1][0]) {
            let pos = best.length;
            while (pos > 0 && best[pos - 1][0] > d) pos--;
            best.splice(pos, 0, [d, i]);
            if (best.length > k) best.pop();
          }
        }
        if (!isCls) return { pred: U.mean(best.map(b => +y[b[1]])) };
        const votes = new Map(), vals = new Map();
        best.forEach(b => { const key = String(y[b[1]]); votes.set(key, (votes.get(key) || 0) + 1); vals.set(key, y[b[1]]); });
        let top = null, tc = -1;
        votes.forEach((c, key) => { if (c > tc) { tc = c; top = key; } });
        return { pred: vals.get(top), conf: tc / best.length };
      },
      summary() {
        return '<p>k-NN keeps all <b>' + rows.length + '</b> training records. A new record is predicted from its <b>' + k +
          '</b> closest training records' + (isCls ? ' (majority vote).' : ' (average of their values).') + '</p>' +
          '<p class="muted">Distances use standardized numeric inputs and 0/1 indicators for categories: ' + U.esc(enc.names.join(', ')) + '.</p>';
      }
    };
  };

  /* ---------- Naive Bayes ---------- */
  M.bayes = function (rows, inputs, types, target, kind, p) {
    const classes = classList(rows, target), K = classes.length, alpha = +p.laplace || 1;
    const byClass = classes.map(c => rows.filter(r => String(r[target]) === c.key));
    const prior = byClass.map(g => g.length / rows.length);
    const feats = inputs.map(name => {
      if (types[name] === 'number') {
        return { name, num: true, stats: byClass.map(g => { const v = U.nums(g, name); const m = U.mean(v) || 0; const s = Math.max(U.std(v), 1e-3 * (Math.abs(m) + 1)); return { m, s }; }) };
      }
      const cats = [...U.counts(rows, name).keys()];
      return { name, num: false, cats, tables: byClass.map(g => { const c = U.counts(g, name); let tot = 0; c.forEach(v => { tot += v; }); return { c, tot }; }) };
    });
    return {
      predict(r) {
        const lp = prior.map(Math.log);
        feats.forEach(f => {
          const v = r[f.name];
          if (U.isMissing(v)) return;
          for (let k = 0; k < K; k++) {
            if (f.num) { if (!U.isNum(v)) return; const { m, s } = f.stats[k]; lp[k] += -Math.log(s) - ((v - m) ** 2) / (2 * s * s); }
            else { const t = f.tables[k]; lp[k] += Math.log(((t.c.get(String(v)) || 0) + alpha) / (t.tot + alpha * (f.cats.length + 1))); }
          }
        });
        const mx = Math.max(...lp), e = lp.map(v => Math.exp(v - mx)), tot = e.reduce((a, b) => a + b, 0);
        let b = 0; e.forEach((v, i) => { if (v > e[b]) b = i; });
        return { pred: classes[b].value, conf: e[b] / tot };
      },
      summary() {
        let h = '<h3>Class priors</h3>' + U.simpleTable(['Class', 'Training records', 'Prior'], classes.map((c, k) => [c.key, byClass[k].length, prior[k]]));
        h += '<h3>How each input differs by class</h3><p class="muted">Numbers: class mean (std dev). Categories: most common value within the class.</p>';
        h += U.simpleTable(['Input'].concat(classes.map(c => c.key)), feats.map(f => [f.name].concat(classes.map((c, k) => {
          if (f.num) return U.fmt(f.stats[k].m) + ' (' + U.fmt(f.stats[k].s) + ')';
          let best = '', bc = -1; f.tables[k].c.forEach((v, key) => { if (v > bc) { bc = v; best = key; } });
          return best + (f.tables[k].tot ? ' (' + U.pct(bc / f.tables[k].tot) + ')' : '');
        }))));
        return h;
      }
    };
  };

  /* ---------- K-Means clustering ---------- */
  const sqDist = (a, b) => { let d = 0; for (let j = 0; j < a.length; j++) { const t = a[j] - b[j]; d += t * t; } return d; };

  // Core k-means loop (k-means++ start). Returns the centres C, each point's cluster and the iterations used.
  function kmeansFit(X, K, rand, maxIter) {
    const C = [X[Math.floor(rand() * X.length)].slice()];
    while (C.length < K) {
      const d = X.map(x => Math.min(...C.map(c => sqDist(x, c))));
      let r = rand() * d.reduce((a, b) => a + b, 0), idx = 0;
      for (; idx < d.length - 1; idx++) { r -= d[idx]; if (r <= 0) break; }
      C.push(X[idx].slice());
    }
    const assign = new Array(X.length).fill(-1);
    let iter = 0;
    for (; iter < maxIter; iter++) {
      let changed = false;
      X.forEach((x, i) => {
        let b = 0, bd = Infinity;
        C.forEach((c, k) => { const d = sqDist(x, c); if (d < bd) { bd = d; b = k; } });
        if (assign[i] !== b) { assign[i] = b; changed = true; }
      });
      C.forEach((c, k) => {
        const members = X.filter((_, i) => assign[i] === k);
        if (members.length) for (let j = 0; j < c.length; j++) c[j] = members.reduce((s, x) => s + x[j], 0) / members.length;
      });
      if (!changed) break;
    }
    return { C, assign, iter };
  }

  // Equal-width histogram of distances (or anomaly indexes) as a small SVG, with a marker at the anomaly cutoff.
  function distanceChart(dists, cutoff, label) {
    const hi = Math.max(...dists, cutoff), bins = 20, w = hi / bins || 1, counts = new Array(bins).fill(0);
    dists.forEach(d => { counts[Math.min(bins - 1, Math.floor(d / w))]++; });
    const mx = Math.max(1, ...counts), W = 460, H = 120, bw = W / bins;
    let s = '<svg viewBox="0 0 ' + W + ' ' + (H + 18) + '" width="' + W + '" height="' + (H + 18) + '" class="spark">';
    counts.forEach((c, i) => {
      const h = c / mx * (H - 4), anomalous = (i + 0.5) * w > cutoff;
      s += '<rect x="' + (i * bw + 1).toFixed(1) + '" y="' + (H - h).toFixed(1) + '" width="' + (bw - 2).toFixed(1) + '" height="' + h.toFixed(1) + '" fill="' + (anomalous ? '#c8453c' : '#3b6fb6') + '"/>';
    });
    const cx = Math.min(W, cutoff / hi * W);
    s += '<line x1="' + cx.toFixed(1) + '" x2="' + cx.toFixed(1) + '" y1="0" y2="' + H + '" stroke="#333" stroke-dasharray="4 3"/>';
    s += '<text x="0" y="' + (H + 13) + '" font-size="10" fill="#666">0</text><text x="' + W + '" y="' + (H + 13) + '" font-size="10" fill="#666" text-anchor="end">' + U.esc(U.fmt(hi, 3)) + ' (' + U.esc(label || 'distance from centre') + ')</text>';
    return s + '</svg>';
  }

  /* Silhouette of a clustering (Kaufman & Rousseeuw). For each record: a = mean distance to the other
     records in its own cluster, b = smallest mean distance to the records of any other cluster, and
     silhouette = (b - a) / max(a, b). It runs from -1 (probably in the wrong cluster) through 0 (on the
     border) to +1 (well inside its cluster). Distances are Euclidean in the standardized input space.
     Every record is scored when there are at most SIL_FULL; with more, a seeded sample of SIL_SAMPLE
     records is scored against all the others (an estimate), because the exact method compares every pair. */
  const SIL_FULL = 2000, SIL_SAMPLE = 1000;
  function silhouette(X, labels, K, seed) {
    const n = X.length, size = new Array(K).fill(0);
    labels.forEach(k => { size[k]++; });
    if (size.filter(v => v > 0).length < 2) return null;   // needs at least two non-empty clusters
    let idx = X.map((_, i) => i);
    const sampled = n > SIL_FULL;
    if (sampled) {
      const rand = U.rng(seed);
      for (let i = 0; i < SIL_SAMPLE; i++) { const j = i + Math.floor(rand() * (n - i)); const t = idx[i]; idx[i] = idx[j]; idx[j] = t; }
      idx = idx.slice(0, SIL_SAMPLE).sort((a, b) => a - b);
    }
    const values = sampled ? null : new Array(n).fill(0), sum = new Array(K).fill(0), cnt = new Array(K).fill(0);
    let total = 0;
    idx.forEach(i => {
      const own = labels[i], d = new Array(K).fill(0);
      for (let j = 0; j < n; j++) if (j !== i) d[labels[j]] += Math.sqrt(sqDist(X[i], X[j]));
      let s = 0;
      if (size[own] > 1) {   // a lone record in its cluster scores 0 by convention
        const a = d[own] / (size[own] - 1);
        let b = Infinity;
        for (let k = 0; k < K; k++) if (k !== own && size[k] > 0) b = Math.min(b, d[k] / size[k]);
        const m = Math.max(a, b);
        s = m > 0 ? (b - a) / m : 0;
      }
      if (values) values[i] = s;
      sum[own] += s; cnt[own]++; total += s;
    });
    return {
      mean: total / idx.length, values, sampled: sampled ? idx.length : 0,
      negative: values ? values.filter(v => v < 0).length : null,
      perCluster: sum.map((v, k) => ({ n: size[k], scored: cnt[k], mean: cnt[k] ? v / cnt[k] : null }))
    };
  }
  function silhouetteLabel(v) {   // Kaufman & Rousseeuw's rule of thumb
    return v > 0.7 ? 'strong structure' : v > 0.5 ? 'reasonable structure' : v > 0.25 ? 'weak structure, clusters may be artificial' : 'no substantial structure';
  }
  function silhouetteHtml(sil, names, what) {
    if (!sil) return '<h3>Cluster quality (silhouette)</h3><p class="muted">Not available: it needs at least two non-empty ' + what + '.</p>';
    let h = '<h3>Cluster quality (silhouette)</h3><p>Average silhouette: <b>' + U.fmt(sil.mean, 3) + '</b> (' + silhouetteLabel(sil.mean) + ').</p>';
    h += U.simpleTable(['Cluster', 'Records', 'Average silhouette'], names.map((nm, k) => [nm, sil.perCluster[k].n,
      sil.perCluster[k].mean == null ? '' : { html: '<span class="sil-bar"><span style="width:' + (100 * Math.max(0, sil.perCluster[k].mean)).toFixed(1) + '%"></span></span> ' + U.esc(U.fmt(sil.perCluster[k].mean, 3)) }]));
    h += '<p class="muted">For each record: silhouette = (b − a) ÷ max(a, b), where a is its average distance to the rest of its own cluster and b its average distance to the nearest other cluster. ' +
      '+1 = well inside its cluster, 0 = on the border between two clusters, below 0 = probably in the wrong cluster. Above 0.5 is reasonable; below 0.25 means little real structure. Inputs are standardized.' +
      (sil.sampled ? ' With this many records the values are estimated from a random sample of ' + sil.sampled + '.' : ' ' + sil.negative + ' record' + (sil.negative === 1 ? ' has' : 's have') + ' a negative silhouette.') + '</p>';
    return h;
  }

  /* single: true = one cluster; each record's distance from the centre is its anomaly score.
     p.anomalyPct = share of training records (the furthest ones) to flag as anomalies. */
  M.kmeans = function (rows, inputs, types, p) {
    const single = p.mode === 'single';
    const K = single ? 1 : Math.max(2, Math.round(+p.k || 3)), rand = U.rng(+p.seed || 1);
    const enc = M.encoder(rows, inputs, types);
    const X = rows.map(r => enc.encode(r));
    if (X.length < (single ? 2 : K)) throw new Error('Need at least ' + (single ? 2 : K) + ' records for ' + (single ? 'single-cluster mode' : K + ' clusters') + '.');
    const { C, assign, iter } = kmeansFit(X, K, rand, +p.iterations || 50);
    const nearest = x => { let b = 0, bd = Infinity; C.forEach((c, k) => { const d = sqDist(x, c); if (d < bd) { bd = d; b = k; } }); return { k: b, d: Math.sqrt(bd) }; };
    let cutoff = null, meanDist = 1, trainDist = null, sil = null;
    if (!single) sil = silhouette(X, X.map(x => nearest(x).k), K, (+p.seed || 1) + 7919);
    if (single) {
      const pct = Math.min(50, Math.max(0.1, p.anomalyPct === '' || p.anomalyPct == null ? 5 : +p.anomalyPct || 5));
      trainDist = X.map(x => nearest(x).d);
      cutoff = U.quantile(trainDist, 1 - pct / 100);
      meanDist = U.mean(trainDist) || 1;
    }
    return {
      silhouette: sil,   // per-record values (null when sampled), overall mean and per-cluster means
      predict(r) {
        const nb = nearest(enc.encode(r));
        const res = { pred: 'cluster-' + (nb.k + 1), conf: nb.d };
        if (single) { res.index = nb.d / meanDist; res.anomaly = nb.d > cutoff; }
        return res;
      },
      summary() {
        if (single) {
          const flagged = trainDist.filter(d => d > cutoff).length, sd = U.std(trainDist);
          let h = '<p>Single-cluster mode: all records belong to one cluster, so each record\'s <b>distance from the cluster centre</b> measures how unusual it is.</p>';
          h += '<h3>Distance from the centre (training records)</h3>' + U.simpleTable(['Mean', 'Std dev', 'Maximum', 'Anomaly cutoff', 'Flagged'],
            [[meanDist, sd, Math.max(...trainDist), cutoff, flagged + ' (' + U.pct(flagged / trainDist.length) + ')']]);
          h += distanceChart(trainDist, cutoff);
          h += '<p class="muted"><b>Anomaly index</b> = distance ÷ mean training distance (1 = typical). Records with a distance above the cutoff are flagged. Inputs are standardized, so each field counts equally.</p>';
          h += '<h3>Cluster centre</h3><p class="muted">Numbers: mean. Categories: most common value.</p>' +
            U.simpleTable(['Input', 'Centre'], inputs.map(name => [name, types[name] === 'number' ? U.fmt(U.mean(U.nums(rows, name))) : String(U.mode(rows, name) == null ? '' : U.mode(rows, name))]));
          return h;
        }
        const groups = C.map((_, k) => rows.filter((__, i) => assign[i] === k));
        let h = '<p>' + K + ' clusters found after ' + (iter + 1) + ' iterations.</p>';
        h += '<h3>Cluster profiles</h3><p class="muted">Numbers: mean within the cluster. Categories: most common value.</p>';
        h += U.simpleTable(['Input'].concat(C.map((_, k) => 'cluster-' + (k + 1))),
          [['Records'].concat(groups.map(g => g.length + ' (' + U.pct(g.length / rows.length) + ')'))].concat(inputs.map(name =>
            [name].concat(groups.map(g => types[name] === 'number' ? U.fmt(U.mean(U.nums(g, name))) : String(U.mode(g, name) == null ? '' : U.mode(g, name)))))));
        h += silhouetteHtml(sil, C.map((_, k) => 'cluster-' + (k + 1)), 'clusters');
        return h;
      }
    };
  };

  /* ---------- Anomaly detection (cluster-based, like SPSS Modeler's Anomaly node) ----------
     Training records are grouped into peer groups with k-means. A record's anomaly index is its distance
     from its own peer group's centre divided by that group's average distance, so 1 is typical and large
     values are unusual. Records whose index is over the cutoff are flagged. */
  M.anomaly = function (rows, inputs, types, p) {
    const K = Math.max(1, Math.round(+p.peerGroups || 3)), rand = U.rng(+p.seed || 1);
    const enc = M.encoder(rows, inputs, types), X = rows.map(r => enc.encode(r));
    if (X.length < Math.max(2, K)) throw new Error('Need at least ' + Math.max(2, K) + ' training records for ' + K + ' peer group' + (K > 1 ? 's' : '') + '.');
    const { C, assign } = kmeansFit(X, K, rand, +p.iterations || 50);

    // which input field does each encoded column belong to?
    const dimField = [];
    enc.specs.forEach((s, fi) => { const w = s.kind === 'num' ? 1 : s.cats.length; for (let j = 0; j < w; j++) dimField.push(fi); });
    const score = x => {
      let b = 0, bd = Infinity;
      C.forEach((c, k) => { const d = sqDist(x, c); if (d < bd) { bd = d; b = k; } });
      return { k: b, d: Math.sqrt(bd) };
    };
    const trainScores = X.map(score);
    const groupMean = C.map((_, k) => { const d = trainScores.filter(s => s.k === k).map(s => s.d); return d.length ? U.mean(d) : NaN; });
    const allMean = U.mean(trainScores.map(s => s.d));
    const meanOf = k => (groupMean[k] > 1e-9 ? groupMean[k] : (allMean > 1e-9 ? allMean : 1));
    const indexOf = s => s.d / meanOf(s.k);
    const trainIdx = trainScores.map(indexOf);

    const method = p.method === 'index' ? 'index' : 'pct';
    const pct = Math.min(50, Math.max(0.1, p.anomalyPct === '' || p.anomalyPct == null ? 5 : +p.anomalyPct || 5));
    const cutoff = method === 'index' ? (+p.indexCutoff > 0 ? +p.indexCutoff : 2) : U.quantile(trainIdx, 1 - pct / 100);

    // share of a record's squared distance contributed by each input field
    function contributions(x, k) {
      const sh = new Array(inputs.length).fill(0);
      x.forEach((v, j) => { const t = v - C[k][j]; sh[dimField[j]] += t * t; });
      const tot = sh.reduce((a, b) => a + b, 0) || 1;
      return sh.map(v => v / tot);
    }
    function reasonOf(x, k) {
      const sh = contributions(x, k);
      let b = 0; sh.forEach((v, i) => { if (v > sh[b]) b = i; });
      return { field: inputs[b], share: sh[b] };
    }

    const flaggedTrain = trainIdx.map(v => v > cutoff);
    const sil = K > 1 ? silhouette(X, trainScores.map(s => s.k), K, (+p.seed || 1) + 7919) : null;
    return {
      predict(r) {
        const x = enc.encode(r), s = score(x), idx = indexOf(s), anomaly = idx > cutoff;
        const out = { pred: anomaly ? 'anomaly' : 'normal', conf: idx, peer: 'peer-' + (s.k + 1) };
        if (anomaly) { const re = reasonOf(x, s.k); out.reason = re.field; out.share = re.share; }
        return out;
      },
      summary() {
        const nFlag = flaggedTrain.filter(Boolean).length;
        let h = '<p>' + K + ' peer group' + (K > 1 ? 's' : '') + ' found. A record is flagged when its anomaly index is above <b>' + U.fmt(cutoff, 3) + '</b>' +
          (method === 'pct' ? ' (the top ' + U.fmt(pct) + '% of training records)' : '') + '. ' + nFlag + ' of ' + rows.length + ' training records (' + U.pct(nFlag / rows.length) + ') are flagged.</p>';
        h += '<h3>Anomaly index (training records)</h3>' + distanceChart(trainIdx, cutoff, 'anomaly index') +
          '<p class="muted">Anomaly index = distance from the peer group centre ÷ the group\'s average distance. 1 is typical; the dashed line is the cutoff. Inputs are standardized so each field counts equally.</p>';
        h += '<h3>Peer groups</h3>' + U.simpleTable(['Peer group', 'Records', 'Average distance', 'Flagged'], C.map((_, k) => {
          const n = trainScores.filter(s => s.k === k).length, f = trainScores.filter((s, i) => s.k === k && flaggedTrain[i]).length;
          return ['peer-' + (k + 1), n, groupMean[k], f];
        }));
        if (K > 1) h += silhouetteHtml(sil, C.map((_, k) => 'peer-' + (k + 1)), 'peer groups') + '<p class="muted">A high silhouette means the peer groups are distinct, so each record is compared with genuinely similar records.</p>';
        const reasons = new Map();
        X.forEach((x, i) => { if (flaggedTrain[i]) { const f = reasonOf(x, trainScores[i].k).field; reasons.set(f, (reasons.get(f) || 0) + 1); } });
        if (reasons.size) {
          h += '<h3>Fields behind the anomalies</h3><p class="muted">For each flagged training record, the input that contributes most to its distance from the peer group centre.</p>' +
            U.simpleTable(['Field', 'Flagged records'], [...reasons.entries()].sort((a, b) => b[1] - a[1]));
        }
        const top = trainIdx.map((v, i) => i).sort((a, b) => trainIdx[b] - trainIdx[a]).slice(0, 10);
        h += '<h3>Most anomalous training records</h3>' + U.simpleTable(['Record #', 'Anomaly index', 'Peer group', 'Main field', 'Share of distance'], top.map(i => {
          const re = reasonOf(X[i], trainScores[i].k);
          return [i + 1, trainIdx[i], 'peer-' + (trainScores[i].k + 1), re.field, U.pct(re.share)];
        })) + '<p class="muted">Record # is the position among the records the model was trained on.</p>';
        return h;
      }
    };
  };

  /* ---------- Apriori (association rules) ----------
     transactions: arrays of item names. Finds itemsets that appear in at least
     minSupport of transactions, growing them one item at a time, then turns each
     itemset into rules "antecedent -> one consequent". */
  M.apriori = function (transactions, p) {
    const N = transactions.length;
    if (!N) throw new Error('No transactions to analyse.');
    const minSup = Math.max(0.0001, (+p.minSupport || 10) / 100), minConf = (+p.minConfidence || 0) / 100;
    const maxLen = Math.max(1, Math.round(+p.maxAntecedents || 3)) + 1;
    const minCount = Math.ceil(minSup * N);
    const tsets = transactions.map(t => new Set(t));
    const key = items => items.join('\u0001');
    const support = new Map();   // itemset key -> count

    // Level 1: single items.
    const c1 = new Map();
    tsets.forEach(t => t.forEach(it => c1.set(it, (c1.get(it) || 0) + 1)));
    let level = [...c1.entries()].filter(e => e[1] >= minCount).map(e => [e[0]]).sort();
    level.forEach(s => support.set(key(s), c1.get(s[0])));
    const levels = [level.length];
    let candidatesChecked = c1.size;

    for (let k = 2; k <= maxLen && level.length > 1; k++) {
      // Join step: combine itemsets that share their first k-2 items.
      const prev = new Set(level.map(key)), cands = [];
      for (let i = 0; i < level.length; i++) {
        for (let j = i + 1; j < level.length; j++) {
          const a = level[i], b = level[j];
          if (key(a.slice(0, -1)) !== key(b.slice(0, -1))) break;   // level is sorted, so no later match
          const c = a.concat(b[b.length - 1]);
          // Prune step: every (k-1)-subset must itself be frequent.
          if (c.every((_, d) => prev.has(key(c.filter((__, e) => e !== d))))) cands.push(c);
        }
      }
      if (cands.length > 200000) throw new Error('Too many candidate itemsets. Raise the minimum support.');
      candidatesChecked += cands.length;
      const counts = cands.map(c => { let n = 0; tsets.forEach(t => { if (c.every(it => t.has(it))) n++; }); return n; });
      level = cands.filter((c, i) => counts[i] >= minCount);
      cands.forEach((c, i) => { if (counts[i] >= minCount) support.set(key(c), counts[i]); });
      levels.push(level.length);
    }

    // Rules with a single consequent (like SPSS Modeler's Apriori).
    const rules = [];
    support.forEach((cnt, k) => {
      const items = k.split('\u0001');
      if (items.length < 2) return;
      items.forEach(cons => {
        const ante = items.filter(x => x !== cons);
        const conf = cnt / support.get(key(ante));
        if (conf < minConf) return;
        rules.push({ ante, cons, count: cnt, anteSup: support.get(key(ante)) / N, support: cnt / N, conf, lift: conf / (support.get(cons) / N) });
      });
    });
    const by = p.sortBy === 'lift' ? 'lift' : p.sortBy === 'support' ? 'support' : 'conf';
    rules.sort((a, b) => b[by] - a[by] || b.conf - a.conf || b.support - a.support);

    return {
      rules,
      summary() {
        const show = rules.slice(0, Math.max(1, +p.maxRules || 100));
        let h = '<p>' + N + ' transactions. Frequent itemsets (support ≥ ' + U.pct(minSup) + ', i.e. ≥ ' + minCount + ' transactions): ' +
          levels.map((n, i) => '<b>' + n + '</b> of size ' + (i + 1)).join(', ') + '. ' + candidatesChecked + ' candidate itemsets checked.</p>';
        if (!rules.length) return h + '<p class="warn">No rules found. Try lowering the minimum support or confidence.</p>';
        h += '<h3>Rules' + (show.length < rules.length ? ' (top ' + show.length + ' of ' + rules.length + ')' : ' (' + rules.length + ')') + '</h3>';
        h += '<p class="muted">Read each rule as <i>“if a basket has the antecedent, it also has the consequent”</i>. ' +
          '<b>Support</b> = share of all transactions containing every item in the rule. <b>Confidence</b> = how often the rule is right when the antecedent is present. ' +
          '<b>Lift</b> &gt; 1 means the items occur together more often than chance.</p>';
        h += U.simpleTable(['Antecedent (if…)', 'Consequent (then…)', 'Antecedent support', 'Rule support', 'Confidence', 'Lift', 'Transactions'],
          show.map(r => [{ html: r.ante.map(U.esc).join(' <span class="muted">&amp;</span> ') }, { html: '<b>' + U.esc(r.cons) + '</b>' },
            U.pct(r.anteSup), U.pct(r.support), U.pct(r.conf), { html: '<span class="' + (r.lift >= 1.2 ? 'good' : r.lift < 1 ? 'muted' : '') + '">' + r.lift.toFixed(2) + '</span>', cls: 'num' }, r.count]));
        return h;
      }
    };
  };

  DM.models = M;
})(window.DM);
