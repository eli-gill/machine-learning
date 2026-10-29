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
const defaults = def => Object.fromEntries(def.params.filter(p => p.default !== undefined).map(p => [p.key, p.default]));
const train = (rows, p = {}) => DM.models.svm(rows, ['x', 'category'], { x: 'number', category: 'string' }, 'y', 'categorical', p);

test('linear SVM separates numeric binary classes deterministically', () => {
  const rows = [-4, -3, -2, 2, 3, 4].map(x => ({ x, category: 'same', y: x > 0 ? 1 : 0 }));
  const a = train(rows), b = train(rows);
  for (const r of rows) {
    assert.equal(a.predict(r).pred, r.y);
    assert.deepEqual(a.predict(r), b.predict(r));
    assert.ok(a.predict(r).conf >= 0 && a.predict(r).conf <= 1);
  }
  assert.match(a.summary(), /Weights by class/);
  assert.match(a.summary(), /not a calibrated probability/);
});

test('Iris SVM example scores held-out data and integrates with Analysis', () => {
  const example = DM.examples.find(e => e.label.includes('support vector machine'));
  const stream = example.build(), results = new Map();
  for (const node of stream.nodes) {
    const def = DM.nodeTypes[node.type];
    const links = stream.links.filter(l => l.to === node.id);
    results.set(node.id, def.exec(links.map(l => results.get(l.from).data), { ...defaults(def), ...node.params }, { name: node.name, inputNames: links.map(l => l.from) }));
  }
  const data = results.get('n3').data;
  const testing = data.rows.filter(r => r.Partition === '2_Testing');
  const accuracy = testing.filter(r => r.Species === r['$SVM-Species']).length / testing.length;
  assert.ok(testing.length > 20);
  assert.ok(accuracy > 0.85, 'held-out accuracy: ' + accuracy);
  assert.equal(new Set(data.rows.map(r => r['$SVM-Species'])).size, 3);
  assert.equal(data.meta.models[0].pred, '$SVM-Species');
  assert.match(results.get('n4').output.html, /Testing/);
  assert.match(results.get('n4').output.html, /confusion/i);
});

test('missing numbers and unseen categories yield finite scores; invalid parameters fail', () => {
  const rows = [{ x: null, category: 'a', y: 'no' }, { x: 1, category: 'a', y: 'no' }, { x: 4, category: 'b', y: 'yes' }];
  const result = train(rows).predict({ x: null, category: 'unseen' });
  assert.ok(Number.isFinite(result.conf));
  assert.ok(['no', 'yes'].includes(result.pred));
  for (const p of [{ cost: 0 }, { cost: Infinity }, { iterations: 1.5 }, { iterations: 0 }, { learningRate: -1 }, { learningRate: NaN }]) {
    assert.throws(() => train(rows, p), /SVM/);
  }
  assert.throws(() => train(rows.slice(0, 2)), /two different/);
});

test('Testing labels, categories and extreme values cannot affect fitting', () => {
  const source = DM.nodeTypes.sample_data.exec([], { dataset: 'iris' }).data;
  const base = DM.nodeTypes.partition.exec([source], { train: 70, seed: 42 }).data;
  const changed = { ...base, rows: base.rows.map(r => r.Partition === '2_Testing' ? { ...r, Sepal_Length: 1e9, Species: 'new class' } : r) };
  const def = DM.nodeTypes.svm, params = { ...defaults(def), target: 'Species' };
  const a = def.exec([base], params, {}), b = def.exec([changed], params, {});
  assert.equal(a.model.html, b.model.html);
  a.data.rows.forEach((r, i) => {
    if (r.Partition === '1_Training') {
      assert.equal(r['$SVM-Species'], b.data.rows[i]['$SVM-Species']);
      assert.equal(r['$SVMC-Species'], b.data.rows[i]['$SVMC-Species']);
    }
  });
});
