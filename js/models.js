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
  M.kmeans = function (rows, inputs, types, p) {
    const K = Math.max(2, Math.round(+p.k || 3)), rand = U.rng(+p.seed || 1);
    const enc = M.encoder(rows, inputs, types);
    const X = rows.map(r => enc.encode(r));
    if (X.length < K) throw new Error('Need at least ' + K + ' records for ' + K + ' clusters.');
    const dist = (a, b) => { let d = 0; for (let j = 0; j < a.length; j++) { const t = a[j] - b[j]; d += t * t; } return d; };
    // k-means++ initialisation
    const C = [X[Math.floor(rand() * X.length)].slice()];
    while (C.length < K) {
      const d = X.map(x => Math.min(...C.map(c => dist(x, c))));
      let r = rand() * d.reduce((a, b) => a + b, 0), idx = 0;
      for (; idx < d.length - 1; idx++) { r -= d[idx]; if (r <= 0) break; }
      C.push(X[idx].slice());
    }
    let assign = new Array(X.length).fill(-1), iter = 0;
    for (; iter < (+p.iterations || 50); iter++) {
      let changed = false;
      X.forEach((x, i) => {
        let b = 0, bd = Infinity;
        C.forEach((c, k) => { const d = dist(x, c); if (d < bd) { bd = d; b = k; } });
        if (assign[i] !== b) { assign[i] = b; changed = true; }
      });
      C.forEach((c, k) => {
        const members = X.filter((_, i) => assign[i] === k);
        if (members.length) for (let j = 0; j < c.length; j++) c[j] = members.reduce((s, x) => s + x[j], 0) / members.length;
      });
      if (!changed) break;
    }
    const nearest = x => { let b = 0, bd = Infinity; C.forEach((c, k) => { const d = dist(x, c); if (d < bd) { bd = d; b = k; } }); return { k: b, d: Math.sqrt(bd) }; };
    return {
      predict(r) { const nb = nearest(enc.encode(r)); return { pred: 'cluster-' + (nb.k + 1), conf: nb.d }; },
      summary() {
        const groups = C.map((_, k) => rows.filter((__, i) => assign[i] === k));
        let h = '<p>' + K + ' clusters found after ' + (iter + 1) + ' iterations.</p>';
        h += '<h3>Cluster profiles</h3><p class="muted">Numbers: mean within the cluster. Categories: most common value.</p>';
        h += U.simpleTable(['Input'].concat(C.map((_, k) => 'cluster-' + (k + 1))),
          [['Records'].concat(groups.map(g => g.length + ' (' + U.pct(g.length / rows.length) + ')'))].concat(inputs.map(name =>
            [name].concat(groups.map(g => types[name] === 'number' ? U.fmt(U.mean(U.nums(g, name))) : String(U.mode(g, name) == null ? '' : U.mode(g, name)))))));
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
