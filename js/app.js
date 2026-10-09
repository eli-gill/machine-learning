/* Canvas editor, node dialogs, execution engine, output manager and persistence. */
(function (DM) {
  'use strict';
  const U = DM.util, T = DM.nodeTypes;
  const $ = (sel, el) => (el || document).querySelector(sel);
  const STORE_KEY = 'dms-stream-v1';
  const NODE_W = 96, SHAPE = 56;

  const S = { nodes: [], links: [], nextId: 1, sel: null, outputs: [], models: new Map() };
  const stage = $('#stage'), svg = $('#links'), wrap = $('#canvas-wrap');

  /* ================= stream model ================= */
  const node = id => S.nodes.find(n => n.id === id);
  const incoming = id => S.links.filter(l => l.to === id);
  const outgoing = id => S.links.filter(l => l.from === id);
  const nodeName = n => n.name || (T[n.type].title ? T[n.type].title(n.params) : T[n.type].label);
  const hasOutput = n => !T[n.type].terminal;
  const maxInputs = n => { const i = T[n.type].inputs; return i === 'many' ? Infinity : i; };

  function addNode(type, x, y, params) {
    const n = { id: 'n' + (S.nextId++), type, x: Math.round(x), y: Math.round(y), params: Object.assign(DM.defaultParams(type), params || {}), name: '' };
    S.nodes.push(n);
    return n;
  }
  function addLink(from, to, quiet) {
    const a = node(from), b = node(to);
    if (!a || !b || from === to) return false;
    const fail = msg => { if (!quiet) status(msg, true); return false; };
    if (!hasOutput(a)) return fail(T[a.type].label + ' nodes are terminal: they produce output, not data.');
    if (maxInputs(b) === 0) return fail(T[b.type].label + ' is a source node and cannot take an input.');
    if (S.links.some(l => l.from === from && l.to === to)) return false;
    if (reaches(to, from)) return fail('That connection would create a loop.');
    const ins = incoming(to);
    if (ins.length >= maxInputs(b)) {
      if (maxInputs(b) === 1) S.links = S.links.filter(l => l.to !== to);   // replace the existing input
      else return fail(T[b.type].label + ' accepts ' + maxInputs(b) + ' inputs.');
    }
    S.links.push({ id: 'l' + (S.nextId++), from, to });
    return true;
  }
  function reaches(from, target) {   // is `target` downstream of `from`?
    const seen = new Set(), stack = [from];
    while (stack.length) {
      const id = stack.pop();
      if (id === target) return true;
      if (seen.has(id)) continue;
      seen.add(id);
      outgoing(id).forEach(l => stack.push(l.to));
    }
    return false;
  }
  function deleteNode(id) {
    S.nodes = S.nodes.filter(n => n.id !== id);
    S.links = S.links.filter(l => l.from !== id && l.to !== id);
    S.models.delete(id);
    if (S.sel && S.sel.id === id) S.sel = null;
  }

  /* ================= execution ================= */
  class UpstreamError extends Error {}
  function execNode(id, memo) {
    if (memo.has(id)) { const m = memo.get(id); if (m.error) throw m.error; return m; }
    const n = node(id), type = T[n.type];
    const ins = incoming(id);
    let inputs;
    try {
      inputs = ins.map(l => execNode(l.from, memo).data);
    } catch (e) {
      const err = new UpstreamError(e.message);
      n.status = 'blocked'; n.error = 'An upstream node failed.';
      memo.set(id, { error: err });
      throw err;
    }
    try {
      if (type.inputs !== 0 && ins.length === 0) throw new Error('Connect an input to this node.');
      if (type.inputs === 2 && ins.length < 2) throw new Error('Merge needs two inputs. Connect a second data source.');
      const res = type.exec(inputs, n.params, { name: nodeName(n), inputNames: ins.map(l => nodeName(node(l.from))) });
      if (res.data && !res.data.meta) res.data.meta = {};
      n.status = 'ok'; n.error = null;
      if (res.model) { n.trained = true; S.models.set(id, Object.assign({ nodeId: id, time: new Date() }, res.model)); }
      memo.set(id, res);
      return res;
    } catch (e) {
      if (!(e instanceof UpstreamError)) { n.status = 'error'; n.error = e.message; }
      memo.set(id, { error: e });
      throw e;
    }
  }

  function runNodes(ids, showSingle) {
    if (!ids.length) { status('Nothing to run. Add an output node (Table, Analysis, …) at the end of a branch.', true); return; }
    status('Running…');
    document.body.classList.add('busy');
    setTimeout(() => {
      const memo = new Map();
      let made = [], errors = 0;
      S.nodes.forEach(n => { n.status = null; });
      ids.forEach(id => {
        try {
          const r = execNode(id, memo);
          if (r.output) made.push(addOutput(id, r.output));
        } catch (e) { errors++; if (!(e instanceof UpstreamError) && !(e instanceof Error)) console.error(e); }
      });
      document.body.classList.remove('busy');
      render(); renderManager();
      const firstErr = S.nodes.find(n => n.status === 'error');
      if (errors) status('Finished with ' + errors + ' error(s). ' + (firstErr ? nodeName(firstErr) + ': ' + firstErr.error : ''), true);
      else status('Finished. ' + (made.length ? made.length + ' output(s) created.' : 'Models updated.'));
      if (showSingle && made.length === 1) showOutput(made[0]);
      else if (made.length) { switchTab('outputs'); flash($('#mgr-outputs')); }
      else if (!errors && ids.some(id => T[node(id).type].model)) switchTab('models');
    }, 30);
  }
  // Run every branch: execute each node at the end of a chain (lone source nodes are skipped).
  const runAll = () => runNodes(S.nodes.filter(n => outgoing(n.id).length === 0 && T[n.type].inputs !== 0).map(n => n.id), true);

  function inputTables(n) {
    const memo = new Map();
    return incoming(n.id).map(l => { try { return execNode(l.from, memo).data; } catch (e) { return null; } });
  }

  /* ================= rendering ================= */
  function render() {
    stage.querySelectorAll('.node').forEach(el => el.remove());
    S.nodes.forEach(n => {
      const t = T[n.type];
      const el = document.createElement('div');
      el.className = 'node cat-' + t.cat + (S.sel && S.sel.kind === 'node' && S.sel.id === n.id ? ' selected' : '') + (n.status ? ' st-' + n.status : '');
      el.style.left = n.x + 'px'; el.style.top = n.y + 'px';
      el.dataset.id = n.id;
      el.title = (n.error ? '⚠ ' + n.error + '\n\n' : '') + t.label + ': ' + t.desc + '\nDouble-click to edit, right-click for more.';
      el.innerHTML = '<div class="shape-wrap"><div class="shape"><span class="glyph">' + U.esc(t.glyph) + '</span></div></div>' +
        '<div class="label">' + U.esc(nodeName(n)) + '</div>' +
        (t.model && n.trained ? '<div class="badge" title="Model trained — see the Models tab">◆</div>' : '') +
        (n.status === 'error' ? '<div class="badge err" title="' + U.esc(n.error) + '">!</div>' : '') +
        (hasOutput(n) ? '<div class="port" title="Drag to another node to connect"></div>' : '');
      stage.appendChild(el);
    });
    drawLinks();
    $('#empty-hint').classList.toggle('hidden', S.nodes.length > 0);
    save();
  }
  const center = n => ({ x: n.x + NODE_W / 2, y: n.y + SHAPE / 2 + 4 });
  function drawLinks(temp) {
    let s = '<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#5a6470"/></marker>' +
      '<marker id="arrow-sel" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#1a73e8"/></marker></defs>';
    S.links.forEach(l => {
      const a = node(l.from), b = node(l.to);
      if (!a || !b) return;
      const p = center(a), q = center(b), dx = q.x - p.x, dy = q.y - p.y, d = Math.hypot(dx, dy) || 1;
      const x1 = p.x + dx / d * 32, y1 = p.y + dy / d * 32, x2 = q.x - dx / d * 36, y2 = q.y - dy / d * 36;
      const sel = S.sel && S.sel.kind === 'link' && S.sel.id === l.id;
      const ins = incoming(l.to);
      const label = T[b.type].inputs === 2 || T[b.type].inputs === 'many' ? '<text class="link-num" x="' + ((x1 + x2) / 2 + 6) + '" y="' + ((y1 + y2) / 2 - 6) + '">' + (ins.indexOf(l) + 1) + '</text>' : '';
      s += '<g class="link' + (sel ? ' selected' : '') + '" data-id="' + l.id + '"><line class="hit" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '"/>' +
        '<line class="vis" x1="' + x1 + '" y1="' + y1 + '" x2="' + x2 + '" y2="' + y2 + '" marker-end="url(#' + (sel ? 'arrow-sel' : 'arrow') + ')"/>' + label + '</g>';
    });
    if (temp) s += '<line class="temp" x1="' + temp.x1 + '" y1="' + temp.y1 + '" x2="' + temp.x2 + '" y2="' + temp.y2 + '" marker-end="url(#arrow)"/>';
    svg.innerHTML = s;
  }

  /* ================= palette ================= */
  let paletteTab = 'sources';
  function renderPalette() {
    $('#palette-tabs').innerHTML = DM.categories.map(c => '<button class="' + (c.key === paletteTab ? 'active ' : '') + 'cat-' + c.key + '" data-cat="' + c.key + '">' + c.label + '</button>').join('');
    $('#palette-items').innerHTML = Object.keys(T).filter(k => T[k].cat === paletteTab).map(k => {
      const t = T[k];
      return '<div class="pal-item node cat-' + t.cat + '" draggable="true" data-type="' + k + '" title="' + U.esc(t.desc) + '\n\nClick to add (connects to the selected node) or drag onto the canvas.">' +
        '<div class="shape-wrap"><div class="shape"><span class="glyph">' + U.esc(t.glyph) + '</span></div></div><div class="label">' + U.esc(t.label) + '</div></div>';
    }).join('');
  }
  $('#palette-tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) { paletteTab = b.dataset.cat; renderPalette(); } });
  $('#palette-items').addEventListener('click', e => {
    const it = e.target.closest('.pal-item'); if (!it) return;
    const type = it.dataset.type, sel = S.sel && S.sel.kind === 'node' ? node(S.sel.id) : null;
    let x, y;
    if (sel) { x = sel.x + 130; y = sel.y; while (S.nodes.some(n => Math.abs(n.x - x) < 60 && Math.abs(n.y - y) < 60)) y += 100; }
    else {
      x = wrap.scrollLeft + 40; y = wrap.scrollTop + 40;
      while (S.nodes.some(n => Math.abs(n.x - x) < 80 && Math.abs(n.y - y) < 80)) { x += 130; if (x > wrap.scrollLeft + wrap.clientWidth - 120) { x = wrap.scrollLeft + 40; y += 110; } }
    }
    const n = addNode(type, x, y);
    if (sel && hasOutput(sel) && maxInputs(n) > 0) addLink(sel.id, n.id, true);
    S.sel = { kind: 'node', id: n.id };
    render();
    status('Added ' + T[type].label + '. Double-click it to change its settings.');
  });
  $('#palette-items').addEventListener('dragstart', e => {
    const it = e.target.closest('.pal-item'); if (!it) return;
    e.dataTransfer.setData('text/x-dms-node', it.dataset.type);
    e.dataTransfer.effectAllowed = 'copy';
  });
  wrap.addEventListener('dragover', e => { if (e.dataTransfer.types.includes('text/x-dms-node')) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy'; } });
  wrap.addEventListener('drop', e => {
    const type = e.dataTransfer.getData('text/x-dms-node'); if (!type) return;
    e.preventDefault();
    const r = stage.getBoundingClientRect();
    const n = addNode(type, e.clientX - r.left - NODE_W / 2, e.clientY - r.top - SHAPE / 2);
    S.sel = { kind: 'node', id: n.id };
    render();
  });

  /* ================= canvas interaction ================= */
  let drag = null;
  const stagePt = e => { const r = stage.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  stage.addEventListener('pointerdown', e => {
    hideMenu();
    if (e.button !== 0) return;
    const el = e.target.closest('.node');
    const pt = stagePt(e);
    if (el && e.target.classList.contains('port')) {
      const n = node(el.dataset.id);
      drag = { mode: 'connect', id: n.id, start: center(n) };
      e.preventDefault();
    } else if (el) {
      const n = node(el.dataset.id);
      S.sel = { kind: 'node', id: n.id };
      stage.querySelectorAll('.node.selected').forEach(x => x.classList.remove('selected'));
      el.classList.add('selected'); drawLinks();
      drag = { mode: 'move', id: n.id, dx: pt.x - n.x, dy: pt.y - n.y, el, moved: false };
      e.preventDefault();
    } else {
      const g = e.target.closest('g.link');
      S.sel = g ? { kind: 'link', id: g.dataset.id } : null;
      render();
    }
  });
  window.addEventListener('pointermove', e => {
    if (!drag) return;
    const pt = stagePt(e);
    if (drag.mode === 'move') {
      const n = node(drag.id);
      n.x = Math.max(0, Math.round(pt.x - drag.dx)); n.y = Math.max(0, Math.round(pt.y - drag.dy));
      drag.el.style.left = n.x + 'px'; drag.el.style.top = n.y + 'px';
      drag.moved = true;
      drawLinks();
    } else {
      drawLinks({ x1: drag.start.x, y1: drag.start.y, x2: pt.x, y2: pt.y });
      stage.querySelectorAll('.node.drop-target').forEach(x => x.classList.remove('drop-target'));
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const t = over && over.closest('#stage .node');
      if (t && t.dataset.id !== drag.id) t.classList.add('drop-target');
    }
  });
  window.addEventListener('pointerup', e => {
    if (!drag) return;
    const d = drag; drag = null;
    if (d.mode === 'connect') {
      const over = document.elementFromPoint(e.clientX, e.clientY);
      const t = over && over.closest('#stage .node');
      if (t && t.dataset.id !== d.id && addLink(d.id, t.dataset.id)) status('Connected ' + nodeName(node(d.id)) + ' → ' + nodeName(node(t.dataset.id)) + '.');
      render();
    } else if (d.moved) save();
  });
  stage.addEventListener('dblclick', e => { const el = e.target.closest('.node'); if (el) openNodeDialog(node(el.dataset.id)); });
  stage.addEventListener('contextmenu', e => {
    const el = e.target.closest('.node'), g = e.target.closest('g.link');
    if (!el && !g) return;
    e.preventDefault();
    if (g) {
      S.sel = { kind: 'link', id: g.dataset.id }; render();
      showMenu(e.clientX, e.clientY, [['Delete connection', () => { S.links = S.links.filter(l => l.id !== g.dataset.id); S.sel = null; render(); }]]);
      return;
    }
    const n = node(el.dataset.id), t = T[n.type];
    S.sel = { kind: 'node', id: n.id }; render();
    const items = [['Edit…', () => openNodeDialog(n)]];
    if (hasOutput(n) && t.inputs !== undefined) items.push(['Preview data', () => preview(n)]);
    if (t.terminal || t.model) items.push(['Run', () => runNodes([n.id], true)]);
    if (t.model && S.models.has(n.id)) items.push(['View model', () => showModel(n.id)]);
    items.push(null, ['Duplicate', () => { const c = addNode(n.type, n.x + 30, n.y + 30, JSON.parse(JSON.stringify(n.params))); c.name = n.name; S.sel = { kind: 'node', id: c.id }; render(); }]);
    items.push(['Disconnect', () => { S.links = S.links.filter(l => l.from !== n.id && l.to !== n.id); render(); }]);
    items.push(['Delete', () => { deleteNode(n.id); render(); renderManager(); }]);
    showMenu(e.clientX, e.clientY, items);
  });
  document.addEventListener('keydown', e => {
    if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) || $('.modal-back')) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && S.sel) {
      e.preventDefault();
      if (S.sel.kind === 'node') deleteNode(S.sel.id); else S.links = S.links.filter(l => l.id !== S.sel.id);
      S.sel = null; render(); renderManager();
    } else if (e.key === 'Enter' && S.sel && S.sel.kind === 'node') openNodeDialog(node(S.sel.id));
    else if (e.key === 'F5' || (e.ctrlKey && e.key === 'e')) { e.preventDefault(); runAll(); }
  });

  /* ---------- context menu ---------- */
  const menu = $('#ctx');
  function showMenu(x, y, items) {
    menu.innerHTML = items.map((it, i) => it ? '<button data-i="' + i + '">' + U.esc(it[0]) + '</button>' : '<hr>').join('');
    menu.classList.remove('hidden');
    menu.style.left = Math.min(x, innerWidth - 180) + 'px'; menu.style.top = Math.min(y, innerHeight - menu.offsetHeight - 8) + 'px';
    menu.onclick = e => { const b = e.target.closest('button'); if (b) { hideMenu(); items[+b.dataset.i][1](); } };
  }
  function hideMenu() { menu.classList.add('hidden'); }
  document.addEventListener('pointerdown', e => { if (!e.target.closest('#ctx')) hideMenu(); });

  /* ================= modals ================= */
  function modal(opts) {
    const back = document.createElement('div');
    back.className = 'modal-back';
    back.innerHTML = '<div class="modal' + (opts.wide ? ' wide' : '') + '" role="dialog"><div class="modal-head"><span class="modal-title"></span><button class="x" title="Close">✕</button></div>' +
      '<div class="modal-body"></div><div class="modal-foot"></div></div>';
    $('.modal-title', back).textContent = opts.title;
    const body = $('.modal-body', back);
    if (typeof opts.body === 'string') body.innerHTML = opts.body; else if (opts.body) body.appendChild(opts.body);
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape' && back === [...document.querySelectorAll('.modal-back')].pop()) { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    $('.x', back).onclick = close;
    back.addEventListener('pointerdown', e => { if (e.target === back) back.dataset.down = '1'; });
    back.addEventListener('click', e => { if (e.target === back && back.dataset.down) close(); back.dataset.down = ''; });
    const foot = $('.modal-foot', back);
    (opts.buttons || [{ label: 'Close', primary: true }]).forEach(b => {
      const btn = document.createElement('button');
      btn.textContent = b.label;
      if (b.primary) btn.className = 'primary';
      if (b.left) btn.classList.add('left');
      btn.onclick = () => { if (!b.onClick || b.onClick() !== false) close(); };
      foot.appendChild(btn);
    });
    const lefts = foot.querySelectorAll('.left');
    if (lefts.length) lefts[lefts.length - 1].insertAdjacentHTML('afterend', '<span class="spacer"></span>');
    document.body.appendChild(back);
    return { close, body };
  }

  /* ================= node settings dialog ================= */
  function openNodeDialog(n) {
    const t = T[n.type];
    const params = JSON.parse(JSON.stringify(n.params));
    let name = n.name;
    const tables = inputTables(n);
    const form = document.createElement('div');
    form.className = 'form';

    function fieldsOf(idx, ftype) {
      const tb = tables[idx || 0];
      if (!tb) return null;
      return tb.fields.filter(f => !ftype || f.type === ftype);
    }
    function row(label, control, help) {
      const d = document.createElement('div');
      d.className = 'frow';
      if (label) { const l = document.createElement('label'); l.textContent = label; d.appendChild(l); }
      d.appendChild(control);
      if (help) { const h = document.createElement('div'); h.className = 'help'; h.innerHTML = help; d.appendChild(h); }
      return d;
    }
    function build() {
      form.innerHTML = '';
      form.insertAdjacentHTML('beforeend', '<p class="desc">' + U.esc(t.desc) + '</p>');
      if (t.inputs !== 0 && !incoming(n.id).length) form.insertAdjacentHTML('beforeend', '<p class="warn">This node has no input yet. Connect data to it to choose fields.</p>');
      else if (tables.some(x => !x)) form.insertAdjacentHTML('beforeend', '<p class="warn">An upstream node has an error, so the field list may be incomplete.</p>');
      const nm = document.createElement('input');
      nm.value = name; nm.placeholder = nodeName(Object.assign({}, n, { name: '', params }));
      nm.oninput = () => { name = nm.value; };
      form.appendChild(row('Node name', nm));

      (t.params || []).forEach(p => {
        if (p.showIf && !p.showIf(params)) return;
        let c;
        switch (p.type) {
          case 'hidden': return;
          case 'info': { const d = document.createElement('div'); d.className = 'info'; d.innerHTML = p.html(params); form.appendChild(d); return; }
          case 'text': case 'number': {
            c = document.createElement('input');
            c.type = p.type === 'number' ? 'number' : 'text';
            if (p.type === 'number') c.step = 'any';
            c.value = params[p.key] == null ? '' : params[p.key];
            c.oninput = () => { params[p.key] = p.type === 'number' ? (c.value === '' ? '' : Number(c.value)) : c.value; };
            break;
          }
          case 'textarea': {
            c = document.createElement('textarea');
            c.rows = 3; c.spellcheck = false; c.value = params[p.key] || '';
            c.oninput = () => { params[p.key] = c.value; };
            break;
          }
          case 'checkbox': {
            c = document.createElement('label'); c.className = 'check';
            c.innerHTML = '<input type="checkbox"' + (params[p.key] ? ' checked' : '') + '> ' + U.esc(p.label);
            c.firstChild.onchange = e => { params[p.key] = e.target.checked; };
            form.appendChild(row('', c, p.help));
            return;
          }
          case 'select': {
            c = document.createElement('select');
            const opts = typeof p.options === 'function' ? p.options() : p.options;
            opts.forEach(o => { const v = typeof o === 'object' ? o.v : o, l = typeof o === 'object' ? o.l : o; c.add(new Option(l, v, false, String(params[p.key]) === String(v))); });
            c.onchange = () => { params[p.key] = c.value; build(); };
            break;
          }
          case 'multi': {
            c = document.createElement('div'); c.className = 'checks inline';
            const cur = new Set(params[p.key] || []);
            p.options.forEach(o => {
              const l = document.createElement('label');
              l.innerHTML = '<input type="checkbox"' + (cur.has(o) ? ' checked' : '') + '> ' + U.esc(o);
              l.firstChild.onchange = e => { e.target.checked ? cur.add(o) : cur.delete(o); params[p.key] = p.options.filter(x => cur.has(x)); };
              c.appendChild(l);
            });
            break;
          }
          case 'field': {
            const fs = fieldsOf(p.input, p.fieldType);
            if (!fs) {
              c = document.createElement('input'); c.value = params[p.key] || ''; c.placeholder = 'Field name (connect ' + (p.input ? 'input ' + (p.input + 1) : 'an input') + ' to pick from a list)';
              c.oninput = () => { params[p.key] = c.value; };
              break;
            }
            c = document.createElement('select');
            c.add(new Option(p.allowNone ? '(none)' : '— choose a field —', ''));
            fs.forEach(f => c.add(new Option((f.type === 'number' ? '# ' : 'A ') + f.name, f.name, false, params[p.key] === f.name)));
            if (params[p.key] && !fs.some(f => f.name === params[p.key])) c.add(new Option(params[p.key] + ' (not in input)', params[p.key], false, true));
            c.onchange = () => { params[p.key] = c.value; };
            break;
          }
          case 'fields': {
            const fs = fieldsOf(p.input, p.fieldType);
            c = document.createElement('div'); c.className = 'checks';
            if (!fs) { c.innerHTML = '<span class="muted">Connect an input to choose fields.</span>'; break; }
            const cur = new Set(params[p.key] || []);
            const tools = document.createElement('div'); tools.className = 'check-tools';
            tools.innerHTML = '<a href="#" data-a="all">all</a> · <a href="#" data-a="none">none</a>';
            tools.onclick = e => { e.preventDefault(); const a = e.target.dataset.a; if (!a) return; params[p.key] = a === 'all' ? fs.map(f => f.name) : []; build(); };
            c.appendChild(tools);
            fs.forEach(f => {
              const l = document.createElement('label');
              l.innerHTML = '<input type="checkbox"' + (cur.has(f.name) ? ' checked' : '') + '> <span class="ftype ' + f.type + '">' + (f.type === 'number' ? '#' : 'A') + '</span>' + U.esc(f.name);
              l.firstChild.onchange = e => { e.target.checked ? cur.add(f.name) : cur.delete(f.name); params[p.key] = fs.map(x => x.name).filter(x => cur.has(x)); };
              c.appendChild(l);
            });
            break;
          }
          case 'fieldTypes': {
            const fs = fieldsOf(0);
            c = document.createElement('div');
            if (!fs) { c.innerHTML = '<span class="muted">Connect an input to see its fields.</span>'; break; }
            const cur = params[p.key] || (params[p.key] = {});
            const tb = document.createElement('table'); tb.className = 'grid compact';
            tb.innerHTML = '<thead><tr><th>Field</th><th>Incoming storage</th><th>Convert to</th></tr></thead>';
            const body = document.createElement('tbody');
            fs.forEach(f => {
              const tr = document.createElement('tr');
              tr.innerHTML = '<td>' + U.esc(f.name) + '</td><td>' + (f.type === 'number' ? '# Number' : 'A Text') + '</td><td></td>';
              const s = document.createElement('select');
              [['', '(no change)'], ['number', 'Number'], ['string', 'Text']].forEach(([v, l]) => s.add(new Option(l, v, false, (cur[f.name] || '') === v)));
              s.onchange = () => { if (s.value) cur[f.name] = s.value; else delete cur[f.name]; };
              tr.lastChild.appendChild(s); body.appendChild(tr);
            });
            tb.appendChild(body); c.appendChild(tb);
            break;
          }
          case 'csvfile': {
            c = document.createElement('div'); c.className = 'csvbox';
            const info = document.createElement('div'); info.className = 'info';
            const describe = () => {
              if (!params.csv) { info.textContent = 'No file loaded yet.'; return; }
              try { const tb = U.csvToTable(params.csv); info.textContent = (params.fileName || 'Pasted data') + ': ' + tb.rows.length + ' records, ' + tb.fields.length + ' fields (' + tb.fields.map(f => f.name).join(', ') + ')'; }
              catch (e) { info.textContent = 'Could not read CSV: ' + e.message; }
            };
            const file = document.createElement('input'); file.type = 'file'; file.accept = '.csv,.txt,.tsv,.xlsx,.xlsm,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
            const sheetBox = document.createElement('label'); sheetBox.className = 'check'; sheetBox.hidden = true;
            const sheetSel = document.createElement('select'); sheetBox.append('Excel sheet: ', sheetSel);
            let book = null, bookName = '';
            const useCsv = (text, fileName) => {
              if (text.length > 3e6) { alert('That sheet is larger than 3 MB of data. Please use a smaller sample (this tool runs entirely in your browser).'); return; }
              params.csv = text; params.fileName = fileName; ta.value = text.slice(0, 20000); ta.readOnly = text.length > 20000; describe();
            };
            const useSheet = () => {
              const sh = book.sheets[+sheetSel.value];
              useCsv(DM.xlsx.rowsToCSV(sh.rows), bookName + (book.sheets.length > 1 ? ' [' + sh.name + ']' : ''));
            };
            sheetSel.onchange = useSheet;
            file.onchange = () => {
              const f = file.files[0]; if (!f) return;
              if (f.size > 3e6) { alert('That file is larger than 3 MB. Please use a smaller sample (this tool runs entirely in your browser).'); return; }
              sheetBox.hidden = true; book = null;
              if (/\.(xlsx|xlsm|xls)$/i.test(f.name)) {
                info.textContent = 'Reading Excel file…';
                f.arrayBuffer().then(buf => DM.xlsx.read(buf)).then(wb => {
                  book = wb; bookName = f.name;
                  sheetSel.innerHTML = '';
                  wb.sheets.forEach((sh, i) => sheetSel.add(new Option(sh.name + ' (' + (sh.rows.length - 1) + ' rows)', i)));
                  sheetBox.hidden = wb.sheets.length < 2;
                  useSheet();
                }).catch(e => { info.textContent = 'Could not read Excel file: ' + e.message; });
                return;
              }
              const rd = new FileReader();
              rd.onload = () => useCsv(rd.result, f.name);
              rd.readAsText(f);
            };
            const ta = document.createElement('textarea'); ta.rows = 6; ta.spellcheck = false; ta.placeholder = '…or paste CSV text here (first row = field names)';
            ta.value = (params.csv || '').slice(0, 20000);
            if ((params.csv || '').length > 20000) ta.readOnly = true;
            ta.oninput = () => { params.csv = ta.value; params.fileName = ''; describe(); };
            c.append(file, sheetBox, ta, info); describe();
            break;
          }
        }
        form.appendChild(row(p.label, c, p.help));
      });
    }
    build();

    const apply = () => { n.params = params; n.name = name.trim(); render(); };
    const buttons = [];
    if (hasOutput(n)) buttons.push({ label: 'Preview', left: true, onClick: () => { apply(); preview(n); return false; } });
    if (t.terminal || t.model) buttons.push({ label: '▶ Run', left: true, onClick: () => { apply(); runNodes([n.id], true); } });
    buttons.push({ label: 'Cancel' }, { label: 'OK', primary: true, onClick: apply });
    modal({ title: t.label + (n.name ? ' — ' + n.name : ''), body: form, buttons });
  }

  function preview(n) {
    const memo = new Map();
    try {
      const r = execNode(n.id, memo);
      render();
      if (r.model) renderManager();
      modal({ title: 'Preview: ' + nodeName(n), body: U.htmlTable(r.data, 200), wide: true });
    } catch (e) {
      render();
      modal({ title: 'Preview: ' + nodeName(n), body: '<p class="warn">' + U.esc(e instanceof UpstreamError ? 'An upstream node failed: ' + e.message : e.message) + '</p>' });
    }
  }

  /* ================= outputs & models manager ================= */
  function addOutput(nodeId, out) {
    const o = Object.assign({ id: 'o' + (S.nextId++), nodeId, time: new Date() }, out);
    S.outputs = S.outputs.filter(x => x.nodeId !== nodeId);   // re-running a node replaces its old output
    S.outputs.unshift(o);
    return o;
  }
  function showOutput(o) {
    const buttons = [];
    if (o.download) buttons.push({ label: '⤓ Download ' + o.download.name, left: true, onClick: () => { U.download(o.download.name, o.download.data || o.download.text, o.download.mime || 'text/csv'); return false; } });
    buttons.push({ label: 'Close', primary: true });
    modal({ title: o.title, body: '<div class="output">' + o.html + '</div>', wide: true, buttons });
  }
  function showModel(id) {
    const m = S.models.get(id); if (!m) return;
    modal({ title: 'Model — ' + m.title, body: '<div class="output">' + m.html + '</div>', wide: true });
  }
  const timeStr = d => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  function renderManager() {
    const oList = $('#mgr-outputs'), mList = $('#mgr-models');
    oList.innerHTML = S.outputs.length ? S.outputs.map(o => {
      const n = node(o.nodeId), t = n ? T[n.type] : null;
      return '<div class="mgr-item" data-id="' + o.id + '"><span class="mini cat-' + (t ? t.cat : 'output') + '">' + U.esc(t ? t.glyph : '▤') + '</span>' +
        '<span class="mgr-text"><b>' + U.esc(o.title) + '</b><small>' + timeStr(o.time) + '</small></span><button class="x" title="Remove">✕</button></div>';
    }).join('') : '<p class="muted pad">Outputs (tables, charts, evaluations) appear here after you run the stream.</p>';
    const ms = [...S.models.values()].filter(m => node(m.nodeId));
    mList.innerHTML = ms.length ? ms.map(m => '<div class="mgr-item" data-id="' + m.nodeId + '"><span class="mini gem">◆</span><span class="mgr-text"><b>' + U.esc(m.title) + '</b><small>trained ' + timeStr(m.time) + '</small></span></div>').join('')
      : '<p class="muted pad">Trained models appear here. Connect a modeling node (after a Partition) and press Run.</p>';
    $('#tab-models-count').textContent = ms.length ? ' (' + ms.length + ')' : '';
    $('#tab-outputs-count').textContent = S.outputs.length ? ' (' + S.outputs.length + ')' : '';
  }
  $('#mgr-outputs').addEventListener('click', e => {
    const it = e.target.closest('.mgr-item'); if (!it) return;
    if (e.target.classList.contains('x')) { S.outputs = S.outputs.filter(o => o.id !== it.dataset.id); renderManager(); return; }
    showOutput(S.outputs.find(o => o.id === it.dataset.id));
  });
  $('#mgr-models').addEventListener('click', e => { const it = e.target.closest('.mgr-item'); if (it) showModel(it.dataset.id); });
  function switchTab(tab) {
    document.querySelectorAll('#manager .tabs button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    $('#mgr-outputs').classList.toggle('hidden', tab !== 'outputs');
    $('#mgr-models').classList.toggle('hidden', tab !== 'models');
  }
  $('#manager .tabs').addEventListener('click', e => { const b = e.target.closest('button'); if (b) switchTab(b.dataset.tab); });
  function flash(el) { el.classList.remove('flash'); void el.offsetWidth; el.classList.add('flash'); }

  /* ================= status, persistence, toolbar ================= */
  let statusTimer;
  function status(msg, err) {
    const el = $('#status-bar');
    el.textContent = msg; el.classList.toggle('err', !!err);
    clearTimeout(statusTimer);
    statusTimer = setTimeout(() => { el.textContent = 'Ready. Tip: select a node, then click palette items to build a chain. Double-click a node to edit it.'; el.classList.remove('err'); }, err ? 12000 : 6000);
  }
  const serialize = () => ({ app: 'data-mining-studio', version: 1, nodes: S.nodes.map(n => ({ id: n.id, type: n.type, x: n.x, y: n.y, name: n.name, params: n.params })), links: S.links.map(l => ({ from: l.from, to: l.to })) });
  function load(stream) {
    if (!stream || !Array.isArray(stream.nodes)) throw new Error('This file is not a saved stream.');
    S.nodes = []; S.links = []; S.sel = null; S.outputs = []; S.models = new Map();
    let maxId = 0;
    stream.nodes.forEach(n => {
      if (!T[n.type]) return;
      S.nodes.push({ id: n.id, type: n.type, x: n.x, y: n.y, name: n.name || '', params: Object.assign(DM.defaultParams(n.type), n.params || {}) });
      const k = parseInt(String(n.id).replace(/\D/g, ''), 10); if (k > maxId) maxId = k;
    });
    S.nextId = maxId + 1;
    (stream.links || []).forEach(l => { if (node(l.from) && node(l.to)) S.links.push({ id: 'l' + (S.nextId++), from: l.from, to: l.to }); });
    render(); renderManager();
  }
  let saveTimer;
  function save() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try { localStorage.setItem(STORE_KEY, JSON.stringify(serialize())); }
      catch (e) { status('Could not auto-save in the browser (the stream may contain a large CSV). Use Save to download it.', true); }
    }, 300);
  }

  $('#btn-new').onclick = () => { if (!S.nodes.length || confirm('Clear the canvas and start a new stream?')) { load({ nodes: [], links: [] }); status('New stream.'); } };
  $('#btn-save').onclick = () => { U.download('stream.json', JSON.stringify(serialize(), null, 1), 'application/json'); status('Stream downloaded as stream.json.'); };
  $('#btn-open').onclick = () => $('#file-open').click();
  $('#file-open').onchange = e => {
    const f = e.target.files[0]; if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { try { load(JSON.parse(rd.result)); status('Opened ' + f.name + '.'); } catch (err) { status('Could not open file: ' + err.message, true); } };
    rd.readAsText(f); e.target.value = '';
  };
  $('#btn-run').onclick = runAll;
  $('#btn-help').onclick = () => modal({ title: 'How to use Data Mining Studio', body: $('#help-template').innerHTML, wide: true });
  const exSel = $('#sel-example');
  DM.examples.forEach((ex, i) => exSel.add(new Option(ex.label, i)));
  exSel.onchange = () => {
    const ex = DM.examples[+exSel.value]; exSel.value = '';
    if (!ex) return;
    if (S.nodes.length && !confirm('Replace the current stream with the "' + ex.label + '" example?')) return;
    load(ex.build());
    wrap.scrollTo(0, 0);
    status('Loaded example: ' + ex.label + '. Press ▶ Run to execute it.');
  };

  /* ================= start ================= */
  renderPalette();
  try {
    const saved = localStorage.getItem(STORE_KEY);
    if (saved) load(JSON.parse(saved)); else load(DM.examples[0].build());
  } catch (e) { load({ nodes: [], links: [] }); }
  renderManager();
  status('Ready. Tip: select a node, then click palette items to build a chain. Double-click a node to edit it.');

  DM.app = { S, runAll, load, serialize, execNode };
})(window.DM);
