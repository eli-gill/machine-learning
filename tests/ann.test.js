'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const context = vm.createContext({ window: {} });
for (const file of ['util', 'datasets', 'models', 'nodes', 'examples']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), context);
}
const DM = context.window.DM;
function execute(example, overrides = {}) {
  const stream = example.build(), results = new Map();
  for (const node of stream.nodes) {
    const def = DM.nodeTypes[node.type];
    const defaults = Object.fromEntries(def.params.filter(p => p.default !== undefined).map(p => [p.key, p.default]));
    const inputs = stream.links.filter(l => l.to === node.id).map(l => results.get(l.from).data);
    results.set(node.id, def.exec(inputs, { ...defaults, ...node.params, ...overrides[node.id] }, { name: node.name, inputNames: stream.links.filter(l => l.to === node.id).map(l => l.from) }));
  }
  return results;
}
const example = DM.examples.find(e => e.label.includes('surrogate tree'));

test('ANN example: held-out accuracy, surrogate fidelity and original-only inputs', () => {
  const result = execute(example);
  const ann = result.get('n3'), tree = result.get('n5');
  const heldOut = tree.data.rows.filter(r => r.Partition === '2_Testing');
  assert.ok(heldOut.length > 20);
  const accuracy = heldOut.filter(r => r.Species === r['$ANN-Species']).length / heldOut.length;
  const fidelity = heldOut.filter(r => r['$ANN-Species'] === r['$R-$ANN-Species']).length / heldOut.length;
  assert.ok(accuracy > 0.85, 'ANN test accuracy: ' + accuracy);
  assert.ok(fidelity > 0.85, 'surrogate test fidelity: ' + fidelity);
  assert.equal(tree.data.meta.models.length, 2);
  assert.match(tree.model.html, /Tree structure/);
  assert.match(result.get('n6').output.html, /Testing/);
  assert.match(result.get('n6').output.html, /\$ANN-Species/);
  const treeNode = example.build().nodes.find(n => n.type === 'tree');
  assert.equal(treeNode.params.inputs.length, 4);
  assert.ok(treeNode.params.inputs.every(f => !f.startsWith('$') && f !== 'Species'));
  for (const r of ann.data.rows) assert.ok(r['$ANNC-Species'] >= 0 && r['$ANNC-Species'] <= 1);
});

test('ANN can learn nonlinear XOR and reproduces seeded training', () => {
  const rows = Array.from({ length: 40 }, (_, i) => ({ a: i % 2, b: Math.floor(i / 2) % 2, y: (i % 2) ^ (Math.floor(i / 2) % 2) }));
  const train = () => DM.models.ann(rows, ['a', 'b'], { a: 'number', b: 'number' }, 'y', 'categorical', { iterations: 1500, seed: 7 });
  const a = train(), b = train();
  rows.forEach(r => {
    assert.equal(a.predict(r).pred, r.y);
    assert.deepEqual(a.predict(r), b.predict(r));
  });
});

test('ANN handles missing numbers and unseen categories; validates settings', () => {
  const rows = [{ x: 1, c: 'a', y: 'no' }, { x: null, c: 'a', y: 'no' }, { x: 5, c: 'b', y: 'yes' }, { x: 6, c: 'b', y: 'yes' }];
  const train = p => DM.models.ann(rows, ['x', 'c'], { x: 'number', c: 'string' }, 'y', 'categorical', p);
  const result = train({}).predict({ x: null, c: 'unseen' });
  assert.ok(Number.isFinite(result.conf));
  assert.ok(['yes', 'no'].includes(result.pred));
  for (const p of [{ hiddenUnits: 0 }, { hiddenUnits: 1.5 }, { iterations: Infinity }, { learningRate: -1 }, { l2: -1 }, { seed: NaN }]) {
    assert.throws(() => train(p), /ANN/);
  }
  assert.throws(() => DM.models.ann(rows.slice(0, 2), ['x'], { x: 'number' }, 'y', 'categorical', {}), /two different/);
});

test('Testing values and labels do not influence ANN training or encoding', () => {
  const base = execute(example).get('n2').data;
  const changed = { ...base, rows: base.rows.map(r => r.Partition === '2_Testing' ? { ...r, Sepal_Length: 1e6, Species: 'unseen label' } : r) };
  const def = DM.nodeTypes.ann;
  const params = Object.fromEntries(def.params.filter(p => p.default !== undefined).map(p => [p.key, p.default]));
  params.target = 'Species';
  const a = def.exec([base], params, {}).data;
  const b = def.exec([changed], params, {}).data;
  a.rows.forEach((r, i) => {
    if (r.Partition === '1_Training') {
      assert.equal(r['$ANN-Species'], b.rows[i]['$ANN-Species']);
      assert.equal(r['$ANNC-Species'], b.rows[i]['$ANNC-Species']);
    }
  });
});

test('all ready-made examples execute successfully', () => {
  for (const e of DM.examples) execute(e);
});
