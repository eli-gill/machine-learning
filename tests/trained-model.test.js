'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
function studio() {
  const ctx = vm.createContext({ window: {} });
  for (const file of ['util', 'datasets', 'models', 'nodes']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), ctx);
  return ctx.window.DM;
}
const DM = studio();
const defaults = type => DM.defaultParams(type);
const iris = DM.nodeTypes.sample_data.exec([], { dataset: 'iris' }).data;
const inputs = ['Sepal_Length', 'Sepal_Width', 'Petal_Length', 'Petal_Width'];
const partition = DM.nodeTypes.partition.exec([iris], { train: 70, seed: 42 }).data;
const newData = { fields: iris.fields.filter(f => f.name !== 'Species'), rows: iris.rows.slice(0, 8).map(({ Species, ...r }) => r), meta: {} };

for (const type of Object.keys(DM.nodeTypes).filter(t => DM.nodeTypes[t].model && t !== 'apriori')) {
  test(type + ': frozen node scores unlabeled new data and survives JSON/reload', () => {
    const continuous = type === 'linear';
    const params = { ...defaults(type), target: continuous ? 'Sepal_Length' : 'Species', inputs: continuous ? inputs.slice(1) : inputs };
    const trained = DM.nodeTypes[type].exec([partition], params, {});
    assert.ok(trained.fitted, 'every model must expose a fitted scorer');
    const expected = trained.fitted.score(newData);
    const recipe = trained.fitted.recipe;
    DM.cacheTrainedModel(trained.fitted);
    const cached = DM.nodeTypes.trained_model.exec([newData], { recipe }).data;
    assert.deepEqual(cached, expected);
    const other = studio(); // no in-memory model, no original training branch
    const saved = JSON.parse(JSON.stringify(recipe));
    const restored = other.nodeTypes.trained_model.exec([newData], { recipe: saved }).data;
    assert.equal(JSON.stringify(restored), JSON.stringify(expected));
    assert.equal(restored.rows.length, newData.rows.length);
    assert.equal(newData.fields.some(f => f.name.startsWith('$')), false, 'must not mutate input');
    const original = DM.models[type];
    DM.models[type] = () => { throw new Error('Unexpected retraining'); };
    try {
      other.models[type] = () => { throw new Error('Unexpected retraining'); };
      other.nodeTypes.trained_model.exec([newData], { recipe: saved });
      DM.nodeTypes.trained_model.exec([newData], { recipe });
    } finally { DM.models[type] = original; }
    assert.throws(() => trained.fitted.score({ fields: [], rows: [], meta: {} }), /missing input field/);
  });
}

test('single-cluster K-Means retains fitted anomaly thresholds', () => {
  const result = DM.nodeTypes.kmeans.exec([iris], { ...defaults('kmeans'), inputs, mode: 'single' }, {});
  const scored = result.fitted.score(newData);
  assert.ok(scored.fields.some(f => f.name === '$KMA-K-Means'));
  assert.equal(JSON.stringify(DM.nodeTypes.trained_model.exec([newData], { recipe: JSON.parse(JSON.stringify(result.fitted.recipe)) }).data), JSON.stringify(scored));
});

for (const format of ['tabular', 'transactional']) {
  test('Apriori ' + format + ': frozen rules recommend absent items in new baskets', () => {
    const tabular = format === 'tabular';
    const fields = tabular ? [{ name: 'Bread', type: 'string' }, { name: 'Butter', type: 'string' }] : [{ name: 'ID', type: 'number' }, { name: 'Item', type: 'string' }];
    const rows = tabular ? Array.from({ length: 5 }, () => ({ Bread: 'T', Butter: 'T' })) : Array.from({ length: 5 }, (_, i) => [{ ID: i, Item: 'Bread' }, { ID: i, Item: 'Butter' }]).flat();
    const data = { fields, rows, meta: {} };
    const params = { ...defaults('apriori'), format, inputs: ['Bread', 'Butter'], idField: 'ID', itemField: 'Item' };
    const result = DM.nodeTypes.apriori.exec([data], params, {});
    const baskets = { fields, rows: tabular ? [{ Bread: 'T', Butter: 'F' }] : [{ ID: 99, Item: 'Bread' }], meta: {} };
    const expected = result.fitted.score(baskets);
    assert.equal(expected.rows.length, 1);
    assert.equal(expected.rows[0].Recommendation, 'Butter');
    assert.equal(expected.rows[0].Confidence, 1);
    const restored = studio().nodeTypes.trained_model.exec([baskets], { recipe: JSON.parse(JSON.stringify(result.fitted.recipe)) }).data;
    assert.equal(JSON.stringify(restored), JSON.stringify(expected));
    assert.equal(result.fitted.score(data).rows.length, 0, 'do not recommend items already present');
  });
}

test('trained model requires a valid saved model and compatible field types', () => {
  assert.throws(() => DM.nodeTypes.trained_model.exec([newData], {}), /Create a trained model/);
  const result = DM.nodeTypes.tree.exec([partition], { ...defaults('tree'), target: 'Species', inputs }, {});
  const incompatible = { ...newData, fields: newData.fields.map(f => ({ ...f, type: 'string' })) };
  assert.throws(() => result.fitted.score(incompatible), /must have type number/);
});
