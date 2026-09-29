/* Built-in sample datasets. Iris is the classic Fisher data; the others are
   synthetic but generated from a fixed seed, so every student gets the same rows. */
(function (DM) {
  'use strict';
  const U = DM.util;

  const IRIS = {
    setosa: '5.1,3.5,1.4,0.2 4.9,3.0,1.4,0.2 4.7,3.2,1.3,0.2 4.6,3.1,1.5,0.2 5.0,3.6,1.4,0.2 5.4,3.9,1.7,0.4 4.6,3.4,1.4,0.3 5.0,3.4,1.5,0.2 4.4,2.9,1.4,0.2 4.9,3.1,1.5,0.1 ' +
      '5.4,3.7,1.5,0.2 4.8,3.4,1.6,0.2 4.8,3.0,1.4,0.1 4.3,3.0,1.1,0.1 5.8,4.0,1.2,0.2 5.7,4.4,1.5,0.4 5.4,3.9,1.3,0.4 5.1,3.5,1.4,0.3 5.7,3.8,1.7,0.3 5.1,3.8,1.5,0.3 ' +
      '5.4,3.4,1.7,0.2 5.1,3.7,1.5,0.4 4.6,3.6,1.0,0.2 5.1,3.3,1.7,0.5 4.8,3.4,1.9,0.2 5.0,3.0,1.6,0.2 5.0,3.4,1.6,0.4 5.2,3.5,1.5,0.2 5.2,3.4,1.4,0.2 4.7,3.2,1.6,0.2 ' +
      '4.8,3.1,1.6,0.2 5.4,3.4,1.5,0.4 5.2,4.1,1.5,0.1 5.5,4.2,1.4,0.2 4.9,3.1,1.5,0.2 5.0,3.2,1.2,0.2 5.5,3.5,1.3,0.2 4.9,3.6,1.4,0.1 4.4,3.0,1.3,0.2 5.1,3.4,1.5,0.2 ' +
      '5.0,3.5,1.3,0.3 4.5,2.3,1.3,0.3 4.4,3.2,1.3,0.2 5.0,3.5,1.6,0.6 5.1,3.8,1.9,0.4 4.8,3.0,1.4,0.3 5.1,3.8,1.6,0.2 4.6,3.2,1.4,0.2 5.3,3.7,1.5,0.2 5.0,3.3,1.4,0.2',
    versicolor: '7.0,3.2,4.7,1.4 6.4,3.2,4.5,1.5 6.9,3.1,4.9,1.5 5.5,2.3,4.0,1.3 6.5,2.8,4.6,1.5 5.7,2.8,4.5,1.3 6.3,3.3,4.7,1.6 4.9,2.4,3.3,1.0 6.6,2.9,4.6,1.3 5.2,2.7,3.9,1.4 ' +
      '5.0,2.0,3.5,1.0 5.9,3.0,4.2,1.5 6.0,2.2,4.0,1.0 6.1,2.9,4.7,1.4 5.6,2.9,3.6,1.3 6.7,3.1,4.4,1.4 5.6,3.0,4.5,1.5 5.8,2.7,4.1,1.0 6.2,2.2,4.5,1.5 5.6,2.5,3.9,1.1 ' +
      '5.9,3.2,4.8,1.8 6.1,2.8,4.0,1.3 6.3,2.5,4.9,1.5 6.1,2.8,4.7,1.2 6.4,2.9,4.3,1.3 6.6,3.0,4.4,1.4 6.8,2.8,4.8,1.4 6.7,3.0,5.0,1.7 6.0,2.9,4.5,1.5 5.7,2.6,3.5,1.0 ' +
      '5.5,2.4,3.8,1.1 5.5,2.4,3.7,1.0 5.8,2.7,3.9,1.2 6.0,2.7,5.1,1.6 5.4,3.0,4.5,1.5 6.0,3.4,4.5,1.6 6.7,3.1,4.7,1.5 6.3,2.3,4.4,1.3 5.6,3.0,4.1,1.3 5.5,2.5,4.0,1.3 ' +
      '5.5,2.6,4.4,1.2 6.1,3.0,4.6,1.4 5.8,2.6,4.0,1.2 5.0,2.3,3.3,1.0 5.6,2.7,4.2,1.3 5.7,3.0,4.2,1.2 5.7,2.9,4.2,1.3 6.2,2.9,4.3,1.3 5.1,2.5,3.0,1.1 5.7,2.8,4.1,1.3',
    virginica: '6.3,3.3,6.0,2.5 5.8,2.7,5.1,1.9 7.1,3.0,5.9,2.1 6.3,2.9,5.6,1.8 6.5,3.0,5.8,2.2 7.6,3.0,6.6,2.1 4.9,2.5,4.5,1.7 7.3,2.9,6.3,1.8 6.7,2.5,5.8,1.8 7.2,3.6,6.1,2.5 ' +
      '6.5,3.2,5.1,2.0 6.4,2.7,5.3,1.9 6.8,3.0,5.5,2.1 5.7,2.5,5.0,2.0 5.8,2.8,5.1,2.4 6.4,3.2,5.3,2.3 6.5,3.0,5.5,1.8 7.7,3.8,6.7,2.2 7.7,2.6,6.9,2.3 6.0,2.2,5.0,1.5 ' +
      '6.9,3.2,5.7,2.3 5.6,2.8,4.9,2.0 7.7,2.8,6.7,2.0 6.3,2.7,4.9,1.8 6.7,3.3,5.7,2.1 7.2,3.2,6.0,1.8 6.2,2.8,4.8,1.8 6.1,3.0,4.9,1.8 6.4,2.8,5.6,2.1 7.2,3.0,5.8,1.6 ' +
      '7.4,2.8,6.1,1.9 7.9,3.8,6.4,2.0 6.4,2.8,5.6,2.2 6.3,2.8,5.1,1.5 6.1,2.6,5.6,1.4 7.7,3.0,6.1,2.3 6.3,3.4,5.6,2.4 6.4,3.1,5.5,1.8 6.0,3.0,4.8,1.8 6.9,3.1,5.4,2.1 ' +
      '6.7,3.1,5.6,2.4 6.9,3.1,5.1,2.3 5.8,2.7,5.1,1.9 6.8,3.2,5.9,2.3 6.7,3.3,5.7,2.5 6.7,3.0,5.2,2.3 6.3,2.5,5.0,1.9 6.5,3.0,5.2,2.0 6.2,3.4,5.4,2.3 5.9,3.0,5.1,1.8'
  };

  function iris() {
    const fields = [
      { name: 'Sepal_Length', type: 'number' }, { name: 'Sepal_Width', type: 'number' },
      { name: 'Petal_Length', type: 'number' }, { name: 'Petal_Width', type: 'number' },
      { name: 'Species', type: 'string' }
    ];
    const rows = [];
    Object.keys(IRIS).forEach(sp => {
      IRIS[sp].split(' ').forEach(rec => {
        const v = rec.split(',').map(Number);
        rows.push({ Sepal_Length: v[0], Sepal_Width: v[1], Petal_Length: v[2], Petal_Width: v[3], Species: sp });
      });
    });
    return { fields, rows, meta: {} };
  }

  // Customers + usage share one generator so churn depends on fields from both tables.
  let telco = null;
  function buildTelco() {
    if (telco) return telco;
    const rand = U.rng(20240901);
    const pick = (arr, w) => {
      let r = rand() * w.reduce((a, b) => a + b, 0);
      for (let i = 0; i < arr.length; i++) { r -= w[i]; if (r <= 0) return arr[i]; }
      return arr[arr.length - 1];
    };
    const customers = [], usage = [];
    for (let i = 0; i < 500; i++) {
      const id = 1001 + i;
      const age = Math.round(Math.min(85, Math.max(18, 42 + 13 * U.gauss(rand))));
      const gender = rand() < 0.5 ? 'F' : 'M';
      let region = pick(['North', 'South', 'East', 'West'], [3, 3, 2, 2]);
      const plan = pick(['Basic', 'Standard', 'Premium'], [45, 35, 20]);
      const tenure = 1 + Math.floor(rand() * 72);
      const income = Math.round((28000 + age * 900 + (plan === 'Premium' ? 18000 : 0) + 14000 * U.gauss(rand)) / 100) * 100;
      const charges = +((plan === 'Basic' ? 35 : plan === 'Standard' ? 65 : 95) + 12 * U.gauss(rand)).toFixed(2);
      const calls = Math.max(0, Math.round(1.6 + 1.5 * U.gauss(rand) + (rand() < 0.15 ? 3 : 0)));
      const data = +Math.max(0.2, (plan === 'Basic' ? 4 : plan === 'Standard' ? 12 : 30) * (0.5 + rand())).toFixed(1);
      const z = -1.1 + 0.62 * calls - 0.045 * tenure + (plan === 'Basic' ? 0.7 : plan === 'Premium' ? -0.6 : 0) +
        0.018 * (charges - 60) + (age < 30 ? 0.5 : 0);
      const churn = rand() < 1 / (1 + Math.exp(-z)) ? 'Yes' : 'No';
      // Deliberately messy values for the cleaning exercises.
      const mess = rand();
      if (mess < 0.06) region = region.toLowerCase();
      else if (mess < 0.10) region = region.toUpperCase();
      else if (mess < 0.14) region = region + ' ';
      customers.push({
        CustomerID: id, Age: rand() < 0.03 ? null : age, Gender: gender, Region: region, Plan: plan,
        Tenure: tenure, Income: rand() < 0.06 ? null : income, Churn: churn
      });
      if (rand() > 0.04) usage.push({ CustomerID: id, MonthlyCharges: charges, SupportCalls: calls, DataGB: data });
    }
    // Duplicate records (to practise Distinct) and orphan usage rows (to practise join types).
    for (let k = 0; k < 12; k++) customers.push(Object.assign({}, customers[Math.floor(rand() * 500)]));
    for (let k = 0; k < 8; k++) usage.push({ CustomerID: 2001 + k, MonthlyCharges: 50, SupportCalls: 1, DataGB: 5 });
    telco = { customers, usage };
    return telco;
  }

  function housing() {
    const rand = U.rng(777);
    const rows = [];
    for (let i = 0; i < 300; i++) {
      const hood = ['Downtown', 'Suburb', 'Rural'][Math.floor(rand() * 3)];
      const sqft = Math.round(800 + rand() * 2700);
      const beds = Math.max(1, Math.min(6, Math.round(sqft / 650 + U.gauss(rand) * 0.6)));
      const baths = Math.max(1, Math.min(4, Math.round(beds * 0.6 + rand())));
      const age = Math.floor(rand() * 80);
      const garage = rand() < (hood === 'Downtown' ? 0.3 : 0.8) ? 'Yes' : 'No';
      const price = 40000 + 118 * sqft + 9000 * beds + 7000 * baths - 850 * age +
        (hood === 'Downtown' ? 60000 : hood === 'Suburb' ? 25000 : 0) + (garage === 'Yes' ? 12000 : 0) + 22000 * U.gauss(rand);
      rows.push({ HouseID: i + 1, Neighborhood: hood, SqFt: sqft, Bedrooms: beds, Bathrooms: baths, AgeYears: age, Garage: garage, Price: Math.round(price / 100) * 100 });
    }
    return {
      fields: [{ name: 'HouseID', type: 'number' }, { name: 'Neighborhood', type: 'string' }, { name: 'SqFt', type: 'number' },
        { name: 'Bedrooms', type: 'number' }, { name: 'Bathrooms', type: 'number' }, { name: 'AgeYears', type: 'number' },
        { name: 'Garage', type: 'string' }, { name: 'Price', type: 'number' }],
      rows, meta: {}
    };
  }

  // Shopping baskets with planted associations (bread & butter, beer & chips, pasta & sauce...).
  const ITEMS = ['Bread', 'Butter', 'Milk', 'Eggs', 'Cheese', 'Beer', 'Chips', 'Salsa', 'Diapers', 'Wipes',
    'Pasta', 'Pasta Sauce', 'Coffee', 'Sugar', 'Apples', 'Bananas', 'Yogurt', 'Cereal'];
  let baskets = null;
  function buildBaskets() {
    if (baskets) return baskets;
    const rand = U.rng(4242);
    baskets = [];
    for (let i = 0; i < 400; i++) {
      const b = new Set();
      ITEMS.forEach(it => { if (rand() < 0.1) b.add(it); });           // background noise
      if (rand() < 0.35) { b.add('Bread'); if (rand() < 0.7) b.add('Butter'); if (rand() < 0.35) b.add('Milk'); }
      if (rand() < 0.25) { b.add('Beer'); if (rand() < 0.75) b.add('Chips'); }
      if (b.has('Chips') && rand() < 0.5) b.add('Salsa');
      if (rand() < 0.15) { b.add('Diapers'); if (rand() < 0.6) b.add('Wipes'); if (rand() < 0.45) b.add('Beer'); }
      if (rand() < 0.2) { b.add('Pasta'); if (rand() < 0.8) b.add('Pasta Sauce'); if (rand() < 0.4) b.add('Cheese'); }
      if (rand() < 0.2) { b.add('Coffee'); if (rand() < 0.55) b.add('Sugar'); if (rand() < 0.3) b.add('Milk'); }
      if (rand() < 0.2) { b.add('Cereal'); if (rand() < 0.65) b.add('Milk'); if (rand() < 0.3) b.add('Bananas'); }
      if (!b.size) b.add(ITEMS[Math.floor(rand() * ITEMS.length)]);
      baskets.push(ITEMS.filter(it => b.has(it)));
    }
    return baskets;
  }
  function basketsTransactional() {
    const rows = [];
    buildBaskets().forEach((b, i) => b.forEach(it => rows.push({ BasketID: i + 1, Item: it })));
    return { fields: [{ name: 'BasketID', type: 'number' }, { name: 'Item', type: 'string' }], rows, meta: {} };
  }
  function basketsFlags() {
    const cols = ITEMS.map(it => it.replace(/ /g, '_'));
    const rows = buildBaskets().map((b, i) => {
      const o = { BasketID: i + 1 };
      ITEMS.forEach((it, j) => { o[cols[j]] = b.includes(it) ? 'T' : 'F'; });
      return o;
    });
    return { fields: [{ name: 'BasketID', type: 'number' }].concat(cols.map(c => ({ name: c, type: 'string' }))), rows, meta: {} };
  }

  const fromRows = (rows) => {
    const names = Object.keys(rows[0]);
    return { fields: names.map(n => ({ name: n, type: U.inferType(rows, n) })), rows: rows.map(r => Object.assign({}, r)), meta: {} };
  };

  DM.datasets = {
    iris: { label: 'Iris flowers', desc: '150 flowers, 4 measurements, 3 species. Classic classification & clustering data.', build: iris },
    customers: { label: 'Telco customers', desc: '512 customer records with a Churn target. Contains missing values, messy Region text and duplicate rows. Join with "Telco usage" on CustomerID.', build: () => fromRows(buildTelco().customers) },
    usage: { label: 'Telco usage', desc: 'Monthly charges, support calls and data use per customer. Some customers are missing and some IDs have no customer.', build: () => fromRows(buildTelco().usage) },
    baskets: { label: 'Grocery baskets', desc: '400 shopping baskets in transactional format: one row per item bought (BasketID, Item). Use with Apriori to find items bought together.', build: basketsTransactional },
    basket_flags: { label: 'Grocery baskets (flags)', desc: 'The same 400 baskets in tabular format: one row per basket, one T/F field per product. Use with Apriori in tabular mode.', build: basketsFlags },
    housing: { label: 'House prices', desc: '300 houses with size, age, neighborhood and sale Price (a continuous target for regression).', build: housing }
  };
})(window.DM);
