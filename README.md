# Data Mining Studio

A small visual data mining workbench for students, modelled on the stream canvas in **IBM SPSS Modeler**.
You drag nodes from a palette onto a canvas, connect them into a stream, and run it. The data flows from
sources through cleaning and joins, into a Training/Testing split, through a model, and out to results.

It is a static site: plain HTML, CSS and JavaScript with no build step, no server and no dependencies.
All data stays in the browser.

## Features

| Palette tab | Nodes |
|---|---|
| **Sources** | Sample Data (built-in datasets), CSV / Excel File (upload a `.csv` or `.xlsx`, or paste CSV; multi-GB CSVs can be streamed and reduced to a sample or selected columns) |
| **Record Ops** | Select, Sample, Sort, Distinct, **Merge** (inner / left / right / full join), Append, Aggregate |
| **Field Ops** | Filter (drop/rename), Type (number ↔ text), Fill Missing, Clean Text, Derive (formula), Binning, **Partition** |
| **Graphs** | Distribution (bar chart / histogram with optional overlay), Plot (scatter) |
| **Modeling** | Decision Tree, **CHAID**, **Artificial Neural Network (ANN)**, Logistic Regression, Linear Regression, KNN, Naive Bayes, K-Means (several clusters or **single-cluster** anomaly scoring), **Anomaly Detection**, **Apriori** (association rules) |
| **Output** | Table, Data Audit, **Analysis** (accuracy, confusion matrix, MAE/RMSE/R² for Training vs Testing), Export (CSV or Excel `.xlsx`) |

- Node shapes follow the SPSS Modeler convention: circle = source, hexagon = operation, triangle = graph, pentagon = model, square = output.
- Modeling nodes train on the `1_Training` partition and add prediction fields to every record (`$R-Churn`, `$RC-Churn`, and so on), the way SPSS model nuggets do. Trained models are listed in the **Models** tab; results appear in the **Outputs** tab.
- **Excel files**: the CSV / Excel File node opens `.xlsx` / `.xlsm` workbooks (pick the sheet if there is more than one; the first non-empty row is the header; dates become `YYYY-MM-DD` text; formulas use the value Excel last saved). The Export node can write `.xlsx` as well as CSV. Old `.xls` files must be re-saved as `.xlsx`. Reading needs a browser with `DecompressionStream` (current Chrome, Edge, Firefox, Safari).
- Streams auto-save in the browser. **Save** / **Open…** download and load a `.json` file (useful for handing in work).
- Apriori finds association rules ("if Bread & Diapers then Wipes") with support, confidence and lift. It accepts **transactional** data (a transaction ID field + an item field, one row per item) or **tabular** data (one row per transaction, with T/F flag fields or `Field = value` items).
- **CHAID** is a chi-squared tree for a categorical target. Unlike the Decision Tree it can split a node into more than two branches, merging categories (or numeric bins) whose outcomes are not significantly different. Splits use Bonferroni-adjusted p-values; you can set the split and merge significance levels, the depth, and minimum records per node and branch.
- **K-Means** has a *Single cluster* mode: every record goes into one cluster and its distance from the centre is its anomaly score. It adds `$KMD-` (distance), `$KMI-` (anomaly index = distance ÷ average distance) and `$KMA-` (*anomaly* / *normal*, flagging the furthest N% of records).
- **Silhouette**: K-Means (several clusters) and Anomaly Detection (peer groups) report cluster quality as the average silhouette overall and per cluster, from -1 (probably misplaced) through 0 (on the border) to +1 (well inside its cluster). K-Means also adds a per-record `$KMS-` field, so you can plot or filter the weakly clustered records; with more than 2,000 records the summary is estimated from a random sample of 1,000 and the per-record field is left out.
- **Anomaly Detection** is a separate model that needs no target. It groups the Training records into peer groups with k-means, scores each record against its own group (`$OA-` anomaly index, `$OP-` peer group), flags unusual ones (`$O-`, by top % or by index cutoff) and names the field contributing most (`$OR-`).
- Seven example streams are available under **Examples…**: customer churn (join → clean → partition → tree & logistic → analysis), Iris classification (including CHAID), ANN explanation with a surrogate tree, house-price regression, K-Means clustering, Iris anomaly detection, and market-basket association rules.

### Exploring an ANN's “black box”

Choose **Examples… → Iris: explain an ANN with a surrogate tree**, then **Run**.
The ANN is a classifier with one configurable tanh hidden layer, softmax outputs,
seeded initialization, and full-batch backpropagation. It adds `$ANN-Species`
(prediction) and `$ANNC-Species` (confidence). Numeric scaling and categorical
encoding are learned from Training records only; unseen categories have all-zero indicators.

1. **ANN accuracy vs true species** compares ANN predictions with the real `Species`
   labels on Training and Testing records.
2. The **Surrogate** Decision Tree targets `$ANN-Species`, using only the four original
   flower measurements. Neither `Species` nor the ANN confidence/prediction is used
   as an input: this avoids leaking the answer into the explanation.
3. Open the surrogate in **Models** to read its short rules and input importance.
   In **Tree agreement with ANN**, the tree's score against `$ANN-Species` is
   **fidelity** (agreement with the ANN), not accuracy against the real species.
   Analysis also retains the ANN's separate accuracy section.
4. Inspect Testing agreement and compare the three labels in the Table. Try changing
   the tree depth: a smaller tree is easier to read, but may imitate the ANN less well.

Both models train on the same Training partition; Testing records are only scored.
The tree is a global approximation of the ANN's behavior, not a recovery of its
internal computation, a causal explanation, or a guarantee about an individual prediction.
High agreement does not establish that either model is correct.

### Built-in datasets

| Dataset | Rows | Use it for |
|---|---|---|
| Iris flowers | 150 | classification, clustering |
| Telco customers | 512 | cleaning (missing Age/Income, messy `Region` text, 12 duplicate rows), `Churn` target |
| Telco usage | 482 | joining to customers on `CustomerID` (some customers are missing, some IDs are orphans) |
| House prices | 300 | regression (`Price` target) |
| Grocery baskets | 400 baskets | Apriori, transactional format (`BasketID`, `Item`) |
| Grocery baskets (flags) | 400 | Apriori, tabular format (one T/F field per product) |

The telco, housing and basket data are synthetic, generated from a fixed seed so every student sees the same rows.
Copies are in [`data/`](data/) for practising the CSV / Excel File node.

## Using it

1. Click **Sample Data** in the palette (or drag it onto the canvas), then double-click it to pick a dataset.
2. With a node selected, clicking further palette items adds them *after* it and connects them automatically. You can also drag from the small dot on a node's right edge onto another node.
3. Double-click any node to change its settings. Right-click it for Preview, Run, Duplicate, Disconnect and Delete.
4. Press **▶ Run** (or F5). A node with an error turns red; hover over it to read the message.

## Running locally

Open `index.html` directly in a browser. Or, to serve it:

```sh
python3 -m http.server 8000   # then visit http://localhost:8000
```

Run the dependency-free algorithm and stream checks with Node.js:

```sh
node --test tests/*.test.js
```

## Publishing on GitHub Pages

In the repository, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, then choose the `main` branch and the `/ (root)` folder.
The site will be live at `https://<user>.github.io/<repo>/` within a minute or two.

## Code layout

```
index.html        page layout + help text
css/style.css     all styling
js/util.js        CSV parsing, statistics, tables, SVG charts
js/xlsx.js        Excel (.xlsx) reader and writer (zip + XML, no libraries)
js/datasets.js    built-in sample data
js/models.js      algorithms (CART tree, CHAID, ANN, softmax logistic, least squares, KNN, Naive Bayes, K-Means, anomaly detection, Apriori)
js/nodes.js       node types: palette category, settings and exec()
js/examples.js    example streams
js/app.js         canvas editor, settings dialogs, execution engine, outputs/models panel
```

To add a node, add an entry to `DM.nodeTypes` in `js/nodes.js` with `cat`, `label`, `glyph`, `inputs`, `params` and an
`exec(inputs, params, ctx)` function. The palette and settings dialog are built from that definition automatically.
