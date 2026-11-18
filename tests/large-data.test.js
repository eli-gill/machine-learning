'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const ctx = vm.createContext({ window: {}, TextEncoder, TextDecoder });
for (const file of ['util', 'models', 'nodes']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../js/' + file + '.js'), 'utf8'), ctx);
}
const DM = ctx.window.DM, U = DM.util;
const values = Array.from({ length: 200000 }, (_, i) => i - 100000);
const data = { fields: [{ name: 'x', type: 'number' }], rows: values.map(x => ({ x })), meta: {} };

test('200k-value extrema and histogram avoid argument limits', () => {
  assert.equal(U.min(values), -100000);
  assert.equal(U.max(values), 99999);
  assert.equal(U.min([]), Infinity);
  assert.equal(U.max([]), -Infinity);
  assert.equal(U.histogram(values, 12).counts.reduce((a, b) => a + b, 0), values.length);
});

test('Aggregate and Data Audit handle 200k records without dropping rows', () => {
  const result = DM.nodeTypes.aggregate.exec([data], { keys: [], values: ['x'], funcs: ['Min', 'Max'] }).data;
  assert.equal(result.rows[0].x_Min, -100000);
  assert.equal(result.rows[0].x_Max, 99999);
  assert.equal(result.rows[0].Record_Count, values.length);
  assert.doesNotThrow(() => DM.nodeTypes.audit.exec([data], {}));
});

test('equal-width Binning handles 200k records', () => {
  const result = DM.nodeTypes.binning.exec([data], { field: 'x', bins: 4, method: 'width' }).data;
  assert.equal(result.rows.length, 200000);
  assert.match(result.rows[0].x_BIN, /^1:/);
  assert.match(result.rows[199999].x_BIN, /^4:/);
});

test('single-cluster model summary handles 200k training distances', () => {
  const model = DM.models.kmeans(data.rows, ['x'], { x: 'number' }, { mode: 'single', k: 1, iterations: 1 });
  assert.doesNotThrow(() => model.summary());
});

test('streamed CSV retains 200k rows when all rows are requested', async () => {
  const file = new Blob(['x\n' + values.join('\n')]);
  const result = await U.streamCSV(file, { maxRows: 0 });
  assert.equal(result.kept, 200000);
  assert.equal(result.total, 200000);
  assert.equal(U.csvToTable(result.text).rows.length, 200000);
});

test('streamed CSV enforces UTF-8 output budget and releases reader on failure', async () => {
  const file = new Blob(['x\nééé\nééé']);
  await assert.rejects(U.streamCSV(file, { maxBytes: 10 }), /retained CSV exceeds/);
  const result = await U.streamCSV(file, { maxBytes: 20 });
  assert.equal(result.text, 'x\nééé\nééé');
});

test('streamed sampling and column selection preserve valid quoted CSV', async () => {
  const file = new Blob(['id,text\n1,"a,b"\n2,"say ""hi"""\n3,last']);
  const result = await U.streamCSV(file, { columns: ['text'], maxRows: 2, mode: 'sample', seed: 42 });
  assert.equal(result.kept, 2);
  assert.equal(result.total, 3);
  assert.equal(U.csvToTable(result.text).rows.length, 2);
});
