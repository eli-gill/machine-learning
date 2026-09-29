/* Ready-made example streams, loadable from the toolbar. */
(function (DM) {
  'use strict';
  // nodes: [id, type, x, y, params, name]; links: [from, to]
  const stream = (nodes, links) => ({
    nodes: nodes.map(([id, type, x, y, params, name]) => ({ id, type, x, y, params: params || {}, name: name || '' })),
    links: links.map(([from, to]) => ({ from, to }))
  });

  DM.examples = [
    {
      label: 'Customer churn: join, clean, split, model',
      build: () => stream([
        ['n1', 'sample_data', 40, 60, { dataset: 'customers' }],
        ['n2', 'sample_data', 40, 250, { dataset: 'usage' }],
        ['n3', 'distinct', 170, 60, { keys: ['CustomerID'] }, 'Remove duplicates'],
        ['n4', 'merge', 300, 150, { join: 'inner', leftKey: 'CustomerID', rightKey: 'CustomerID' }, 'Join on CustomerID'],
        ['n5', 'audit', 300, 330, {}],
        ['n6', 'clean_text', 430, 150, { fields: ['Region'], trim: true, case: 'title', blank: true }, 'Fix Region text'],
        ['n7', 'filler', 560, 150, { fields: ['Age', 'Income'], method: 'median' }, 'Fill Age/Income'],
        ['n8', 'partition', 690, 150, { train: 70, seed: 1234 }],
        ['n9', 'tree', 830, 60, { target: 'Churn', maxDepth: 4, minLeaf: 10 }],
        ['n10', 'logistic', 830, 250, { target: 'Churn' }],
        ['n11', 'analysis', 970, 60, {}, 'Tree accuracy'],
        ['n12', 'analysis', 970, 250, {}, 'Logistic accuracy'],
        ['n13', 'distribution', 690, 330, { field: 'SupportCalls', overlay: 'Churn' }]
      ], [['n1', 'n3'], ['n3', 'n4'], ['n2', 'n4'], ['n4', 'n5'], ['n4', 'n6'], ['n6', 'n7'], ['n7', 'n8'], ['n8', 'n9'], ['n8', 'n10'], ['n9', 'n11'], ['n10', 'n12'], ['n7', 'n13']])
    },
    {
      label: 'Iris: classify species',
      build: () => stream([
        ['n1', 'sample_data', 40, 150, { dataset: 'iris' }],
        ['n2', 'plot', 170, 20, { x: 'Petal_Length', y: 'Petal_Width', color: 'Species' }],
        ['n3', 'partition', 200, 150, { train: 70, seed: 42 }],
        ['n4', 'knn', 350, 60, { target: 'Species', k: 5 }],
        ['n5', 'tree', 350, 240, { target: 'Species', maxDepth: 3, minLeaf: 3 }],
        ['n6', 'analysis', 500, 60, {}],
        ['n7', 'analysis', 500, 240, {}],
        ['n8', 'table', 500, 380, {}]
      ], [['n1', 'n2'], ['n1', 'n3'], ['n3', 'n4'], ['n3', 'n5'], ['n4', 'n6'], ['n5', 'n7'], ['n5', 'n8']])
    },
    {
      label: 'House prices: regression',
      build: () => stream([
        ['n1', 'sample_data', 40, 150, { dataset: 'housing' }],
        ['n2', 'audit', 170, 20, {}],
        ['n3', 'derive', 190, 150, { name: 'Rooms', expression: 'Bedrooms + Bathrooms' }],
        ['n4', 'partition', 330, 150, { train: 75, seed: 7 }],
        ['n5', 'linear', 470, 70, { target: 'Price' }],
        ['n6', 'tree', 470, 250, { target: 'Price', maxDepth: 5, minLeaf: 8 }],
        ['n7', 'analysis', 610, 70, {}],
        ['n8', 'plot', 610, 180, { x: 'Price', y: '$E-Price', color: 'Partition' }, 'Actual vs predicted'],
        ['n9', 'analysis', 610, 300, {}]
      ], [['n1', 'n2'], ['n1', 'n3'], ['n3', 'n4'], ['n4', 'n5'], ['n4', 'n6'], ['n5', 'n7'], ['n5', 'n8'], ['n6', 'n9']])
    },
    {
      label: 'Iris: clustering with K-Means',
      build: () => stream([
        ['n1', 'sample_data', 40, 120, { dataset: 'iris' }],
        ['n2', 'kmeans', 190, 120, { inputs: ['Sepal_Length', 'Sepal_Width', 'Petal_Length', 'Petal_Width'], k: 3 }],
        ['n3', 'plot', 340, 30, { x: 'Petal_Length', y: 'Petal_Width', color: '$KM-K-Means' }],
        ['n4', 'distribution', 340, 210, { field: '$KM-K-Means', overlay: 'Species' }, 'Clusters vs species']
      ], [['n1', 'n2'], ['n2', 'n3'], ['n2', 'n4']])
    },
    {
      label: 'Market baskets: association rules (Apriori)',
      build: () => stream([
        ['n1', 'sample_data', 40, 60, { dataset: 'baskets' }],
        ['n2', 'distribution', 190, 0, { field: 'Item' }, 'Item popularity'],
        ['n3', 'apriori', 210, 120, { format: 'transactional', idField: 'BasketID', itemField: 'Item', minSupport: 5, minConfidence: 50, sortBy: 'lift' }, 'Apriori (transactional)'],
        ['n4', 'sample_data', 40, 260, { dataset: 'basket_flags' }],
        ['n5', 'apriori', 210, 260, { format: 'tabular', items: 'flags', minSupport: 5, minConfidence: 50 }, 'Apriori (tabular flags)']
      ], [['n1', 'n2'], ['n1', 'n3'], ['n4', 'n5']])
    },
    {
      label: 'Empty canvas',
      build: () => stream([], [])
    }
  ];
})(window.DM);
