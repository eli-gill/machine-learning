# Data Mining Studio

A small visual data mining workbench for students, modelled on the stream canvas in **IBM SPSS Modeler**.
You drag nodes from a palette onto a canvas, connect them into a stream, and run it. The data flows from
sources through cleaning and joins, into a Training/Testing split, through a model, and out to results.

It is a static site: plain HTML, CSS and JavaScript with no build step, no server and no dependencies.
All data stays in the browser.

## Features

| Palette tab | Nodes |
|---|---|
| **Sources** | Sample Data (built-in datasets), CSV File (upload or paste) |
| **Record Ops** | Select, Sample, Sort, Distinct, **Merge** (inner / left / right / full join), Append, Aggregate |
| **Field Ops** | Filter (drop/rename), Type (number ↔ text), Fill Missing, Clean Text, Derive (formula), Binning, **Partition** |
| **Graphs** | Distribution (bar chart / histogram with optional overlay), Plot (scatter) |
| **Modeling** | Decision Tree, Logistic Regression, Linear Regression, KNN, Naive Bayes, K-Means |
| **Output** | Table, Data Audit, **Analysis** (accuracy, confusion matrix, MAE/RMSE/R² for Training vs Testing), Export CSV |

- Node shapes follow the SPSS Modeler convention: circle = source, hexagon = operation, triangle = graph, pentagon = model, square = output.
- Modeling nodes train on the `1_Training` partition and add prediction fields to every record (`$R-Churn`, `$RC-Churn`, and so on), the way SPSS model nuggets do. Trained models are listed in the **Models** tab; results appear in the **Outputs** tab.
- Streams auto-save in the browser. **Save** / **Open…** download and load a `.json` file (useful for handing in work).
- Four example streams are available under **Examples…**: customer churn (join → clean → partition → tree & logistic → analysis), Iris classification, house-price regression, and K-Means clustering.

### Built-in datasets

| Dataset | Rows | Use it for |
|---|---|---|
| Iris flowers | 150 | classification, clustering |
| Telco customers | 512 | cleaning (missing Age/Income, messy `Region` text, 12 duplicate rows), `Churn` target |
| Telco usage | 482 | joining to customers on `CustomerID` (some customers are missing, some IDs are orphans) |
| House prices | 300 | regression (`Price` target) |

The telco and housing data are synthetic, generated from a fixed seed so every student sees the same rows.
Copies are in [`data/`](data/) for practising the CSV File node.

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

## Publishing on GitHub Pages

In the repository, go to **Settings → Pages**, set **Source** to *Deploy from a branch*, then choose the `main` branch and the `/ (root)` folder.
The site will be live at `https://<user>.github.io/<repo>/` within a minute or two.

## Code layout

```
index.html        page layout + help text
css/style.css     all styling
js/util.js        CSV parsing, statistics, tables, SVG charts
js/datasets.js    built-in sample data
js/models.js      algorithms (CART tree, softmax logistic, least squares, KNN, Naive Bayes, K-Means)
js/nodes.js       node types: palette category, settings and exec()
js/examples.js    example streams
js/app.js         canvas editor, settings dialogs, execution engine, outputs/models panel
```

To add a node, add an entry to `DM.nodeTypes` in `js/nodes.js` with `cat`, `label`, `glyph`, `inputs`, `params` and an
`exec(inputs, params, ctx)` function. The palette and settings dialog are built from that definition automatically.
