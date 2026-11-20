// KelvinK — reads a ThermalSim optimization_results.csv client-side and
// renders it as a leaderboard/dashboard instead of raw rows in a file
// browser. Nothing is uploaded anywhere; parsing happens in the browser.

const METRIC_META = {
  peak_temp:            { label: "Peak Temp",            unit: "°C",  goal: "min", decimals: 2 },
  time_above_28c:       { label: "Time Above 28°C",      unit: "h",   goal: "min", decimals: 2 },
  diurnal_swing:        { label: "Diurnal Swing",        unit: "°C",  goal: "min", decimals: 4 },
  mean_afternoon_temp:  { label: "Mean Afternoon Temp",  unit: "°C",  goal: "min", decimals: 2 },
  thermal_lag:          { label: "Thermal Lag",          unit: "h",   goal: "max", decimals: 2 },
  decrement_factor:     { label: "Decrement Factor",     unit: "",    goal: "min", decimals: 3 },
  discomfort_hours:     { label: "Discomfort Hours",     unit: "h",   goal: "min", decimals: 2 },
  ottv:                 { label: "OTTV",                 unit: "W/m²",goal: "min", decimals: 2 },
  pec:                  { label: "Primary Energy",       unit: "kWh/m²a", goal: "min", decimals: 1 },
  global_cost:          { label: "Global Cost",          unit: "€/m²",goal: "min", decimals: 2 },
  sintering_duration:   { label: "Sintering Duration",   unit: "h",   goal: "max", decimals: 2 },
  heat_loss:            { label: "Envelope Heat Loss",   unit: "J",   goal: "min", decimals: 0 }, // legacy metric (pre-ThermalSim-3), kept for old CSVs
  fuel_required:        { label: "Fuel Energy to 900°C", unit: "J/m", goal: "min", decimals: 0 },
  spatial_non_uniform:  { label: "Spatial Non-Uniformity (cavity)", unit: "°C", goal: "min", decimals: 2 },
};

const RESERVED = ["expname", "score", "feasible"];

let state = {
  rows: [],
  materialCols: [],
  metricCols: [],
  sortKey: "Score",
  sortDir: "desc",
  selectedIndex: null,
  chartBars: [],
  badge: null,        // e.g. "DEMO DATA", "LIVE SIMULATION", or null
  caseLabel: null,     // overrides detectCase() when known for certain (live runs)
  lastSimConfig: null, // simulation_config.txt contents, set after a live run
};

// ---------------- CSV parsing ----------------

function parseCSV(text) {
  const lines = text.replace(/\r\n/g, "\n").split("\n").filter(l => l.trim().length > 0);
  if (lines.length < 2) throw new Error("CSV has no data rows.");
  const header = splitCSVLine(lines[0]);
  const rows = lines.slice(1).map(line => {
    const cells = splitCSVLine(line);
    const obj = {};
    header.forEach((h, i) => { obj[h.trim()] = (cells[i] ?? "").trim(); });
    return obj;
  });
  return { header: header.map(h => h.trim()), rows };
}

function splitCSVLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"' && line[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') { inQuotes = false; }
      else { cur += c; }
    } else {
      if (c === '"') inQuotes = true;
      else if (c === ",") { out.push(cur); cur = ""; }
      else cur += c;
    }
  }
  out.push(cur);
  return out;
}

function isNumeric(v) {
  if (v === "" || v === null || v === undefined) return false;
  return !isNaN(parseFloat(v)) && isFinite(v);
}

function classifyColumns(header, rows) {
  const materialCols = [];
  const metricCols = [];
  for (const h of header) {
    const key = h.toLowerCase();
    if (RESERVED.includes(key)) continue;
    const allNumeric = rows.every(r => isNumeric(r[h]));
    if (allNumeric) metricCols.push(h);
    else materialCols.push(h);
  }
  return { materialCols, metricCols };
}

function prettifyMaterialLabel(colName) {
  // e.g. "Region_1_OuterWall" -> "Outer Wall", "Region_3_Cavity" -> "Cavity"
  let s = colName.replace(/^Region_\d+_?/i, "");
  s = s.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/_/g, " ").trim();
  return s.length ? s : colName;
}

function metricMeta(key) {
  const norm = key.toLowerCase();
  return METRIC_META[norm] || { label: humanize(key), unit: "", goal: "min", decimals: 3 };
}

function humanize(key) {
  return key.replace(/_/g, " ").replace(/\b\w/g, c => c.toUpperCase());
}

function detectCase(metricCols) {
  const keys = metricCols.map(k => k.toLowerCase());
  if (keys.includes("sintering_duration") || keys.includes("heat_loss")) return "Brick-Firing Kiln";
  if (keys.includes("time_above_28c") || keys.includes("diurnal_swing")) return "Passive-Cooling Room";
  return "Unrecognized run";
}

// ---------------- Loading ----------------

function loadCSVText(text, isDemo = false) {
  let parsed;
  try {
    parsed = parseCSV(text);
  } catch (e) {
    alert("Couldn't read that file as CSV: " + e.message);
    return;
  }
  const { header, rows: rawRows } = parsed;
  if (!header.some(h => h.toLowerCase() === "score")) {
    alert("This doesn't look like an optimization_results.csv — no Score column found.");
    return;
  }
  const { materialCols, metricCols } = classifyColumns(header, rawRows);

  const rows = rawRows.map(r => ({
    ExpName: r["ExpName"] ?? r[header.find(h => h.toLowerCase() === "expname")] ?? "?",
    Score: parseFloat(r["Score"] ?? r[header.find(h => h.toLowerCase() === "score")]),
    Feasible: parseFeasible(r["Feasible"] ?? r[header.find(h => h.toLowerCase() === "feasible")]),
    materials: Object.fromEntries(materialCols.map(c => [c, r[c]])),
    metrics: Object.fromEntries(metricCols.map(c => [c, parseFloat(r[c])])),
  }));

  loadRows(rows, materialCols, metricCols, { badge: isDemo ? "DEMO DATA" : null });
}

function parseFeasible(v) {
  if (v === undefined) return true;
  const s = String(v).trim().toLowerCase();
  return s === "true" || s === "1" || s === "yes";
}

// Shared entry point for both a parsed CSV and a freshly-run in-browser
// simulation — anything that can produce {ExpName, Score, Feasible,
// materials, metrics} rows can feed the dashboard through here.
function loadRows(rows, materialCols, metricCols, opts = {}) {
  state.rows = rows;
  state.materialCols = materialCols;
  state.metricCols = metricCols;
  state.sortKey = "Score";
  state.sortDir = "desc";
  state.selectedIndex = null;
  state.badge = opts.badge ?? null;
  state.caseLabel = opts.caseLabel ?? null;

  render();
}

// ---------------- Rendering ----------------

function render() {
  document.getElementById("dropzone").hidden = true;
  document.getElementById("results").hidden = false;
  document.getElementById("downloadResultsBtn").hidden = state.rows.length === 0;

  const caseSwitch = document.getElementById("caseSwitch");
  caseSwitch.hidden = false;
  const caseLabel = state.caseLabel || detectCase(state.metricCols);
  document.getElementById("casePill").textContent =
    caseLabel + (state.badge ? `  ·  ${state.badge}` : "");

  renderSummary();
  renderPodium();
  renderChart();
  renderTable();
  renderDetail(state.selectedIndex);
}

function sortedRows() {
  const rows = [...state.rows];
  const key = state.sortKey;
  const dir = state.sortDir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    let av, bv;
    if (key === "Score") { av = a.Score; bv = b.Score; }
    else if (key === "ExpName") { av = a.ExpName; bv = b.ExpName; }
    else if (state.materialCols.includes(key)) { av = a.materials[key] || ""; bv = b.materials[key] || ""; }
    else { av = a.metrics[key]; bv = b.metrics[key]; }
    if (typeof av === "string") return dir * av.localeCompare(bv);
    return dir * ((av ?? -Infinity) - (bv ?? -Infinity));
  });
  return rows;
}

function renderSummary() {
  const rows = state.rows;
  const feasible = rows.filter(r => r.Feasible);
  document.getElementById("statTotal").textContent = rows.length;
  document.getElementById("statFeasible").textContent = `${feasible.length} / ${rows.length}`;
  const best = feasible.length ? Math.max(...feasible.map(r => r.Score)) : null;
  document.getElementById("statBestScore").textContent = best !== null ? best.toFixed(4) : "—";

  const top25 = [...feasible].sort((a, b) => b.Score - a.Score).slice(0, 25);
  if (top25.length >= 2) {
    const spread = top25[0].Score - top25[top25.length - 1].Score;
    document.getElementById("statSpread").textContent = spread.toFixed(4);
  } else {
    document.getElementById("statSpread").textContent = "—";
  }
}

function renderPodium() {
  const podium = document.getElementById("podium");
  podium.innerHTML = "";
  const top3 = [...state.rows].filter(r => r.Feasible).sort((a, b) => b.Score - a.Score).slice(0, 3);
  if (top3.length === 0) {
    podium.innerHTML = `<p class="detail-empty">No feasible designs in this dataset.</p>`;
    return;
  }
  top3.forEach((row, i) => {
    const card = document.createElement("div");
    card.className = `podium-card rank-${i + 1}`;
    const matsHtml = state.materialCols.map(c =>
      `<span>${prettifyMaterialLabel(c)}: <b>${row.materials[c] || "—"}</b></span>`
    ).join("");
    card.innerHTML = `
      <div class="podium-rank">${i + 1}</div>
      <div class="podium-id">${row.ExpName}</div>
      <div class="podium-score">${row.Score.toFixed(4)}</div>
      <div class="podium-materials">${matsHtml}</div>
    `;
    card.addEventListener("click", () => {
      const idx = state.rows.indexOf(row);
      state.selectedIndex = idx;
      renderDetail(idx);
      renderTable();
    });
    podium.appendChild(card);
  });
}

// Hand-rolled canvas bar chart — deliberately no charting library, so the
// page has zero external dependencies and "nothing leaves your browser"
// (incl. no CDN fetch) stays literally true even with no internet access.
function renderChart() {
  const canvas = document.getElementById("scoreChart");
  const cssWidth = canvas.parentElement.clientWidth;
  const cssHeight = 220;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);

  const rows = sortedRowsForChart();
  if (rows.length === 0) { state.chartBars = []; return; }

  const style = getComputedStyle(document.documentElement);
  const accent = style.getPropertyValue("--accent").trim();
  const bad = style.getPropertyValue("--bad").trim();
  const dim = style.getPropertyValue("--text-dim").trim();
  const textColor = style.getPropertyValue("--text").trim();

  const padLeft = 46, padBottom = 20, padTop = 10, padRight = 6;
  const plotW = cssWidth - padLeft - padRight;
  const plotH = cssHeight - padTop - padBottom;

  // Domain comes from feasible scores only — an infeasible row's score is
  // a sentinel (ThermalSim uses -999, -Inf, etc.), not a real value on the
  // same continuous scale, and letting it into the domain would squash
  // every real bar to look identical.
  const feasibleScores = rows.filter(r => r.Feasible).map(r => r.Score).filter(isFinite);
  const dataMin = feasibleScores.length ? Math.min(0, ...feasibleScores) : 0;
  const dataMax = feasibleScores.length ? Math.max(...feasibleScores, 0.0001) : 1;
  const range = dataMax - dataMin || 1;

  // y-axis labels + gridlines
  ctx.strokeStyle = dim; ctx.globalAlpha = 0.25; ctx.lineWidth = 1;
  ctx.fillStyle = dim; ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "right"; ctx.textBaseline = "middle";
  const ticks = 4;
  for (let t = 0; t <= ticks; t++) {
    const val = dataMin + (range * t / ticks);
    const y = padTop + plotH - ((val - dataMin) / range) * plotH;
    ctx.globalAlpha = 0.18;
    ctx.beginPath(); ctx.moveTo(padLeft, y); ctx.lineTo(cssWidth - padRight, y); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.fillText(val.toFixed(2), padLeft - 8, y);
  }

  const n = rows.length;
  const gap = Math.min(3, plotW / n * 0.25);
  const barW = Math.max(1, plotW / n - gap);

  state.chartBars = [];
  rows.forEach((row, i) => {
    const x = padLeft + i * (plotW / n) + gap / 2;
    // Infeasible rows get a small fixed-height marker instead of being
    // plotted on the score scale (see domain note above).
    const h = row.Feasible
      ? Math.max(1, ((row.Score - dataMin) / range) * plotH)
      : Math.max(4, plotH * 0.06);
    const y = padTop + plotH - h;
    ctx.fillStyle = row.Feasible ? accent : bad;
    ctx.globalAlpha = (state.selectedIndex !== null && state.rows[state.selectedIndex] === row) ? 1 : 0.85;
    roundRectTop(ctx, x, y, barW, h, 3);
    ctx.fill();
    if (state.rows[state.selectedIndex] === row) {
      ctx.strokeStyle = textColor; ctx.lineWidth = 1.5; ctx.globalAlpha = 1;
      roundRectTop(ctx, x, y, barW, h, 3);
      ctx.stroke();
    }
    state.chartBars.push({ x, width: barW, row });
  });
  ctx.globalAlpha = 1;
}

function roundRectTop(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  ctx.beginPath();
  ctx.moveTo(x, y + h);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h);
  ctx.closePath();
}

function handleChartClick(evt) {
  const canvas = document.getElementById("scoreChart");
  const rect = canvas.getBoundingClientRect();
  const x = evt.clientX - rect.left;
  const hit = state.chartBars.find(b => x >= b.x - 1 && x <= b.x + b.width + 1);
  if (!hit) return;
  const realIdx = state.rows.indexOf(hit.row);
  state.selectedIndex = realIdx;
  renderDetail(realIdx);
  renderTable();
  renderChart();
}

function sortedRowsForChart() {
  return [...state.rows].sort((a, b) => b.Score - a.Score);
}

function renderTable() {
  const rows = sortedRows();
  const q = document.getElementById("searchBox").value.trim().toLowerCase();
  const filtered = q
    ? rows.filter(r =>
        r.ExpName.toLowerCase().includes(q) ||
        state.materialCols.some(c => (r.materials[c] || "").toLowerCase().includes(q))
      )
    : rows;

  const thead = document.querySelector("#resultsTable thead");
  const tbody = document.querySelector("#resultsTable tbody");

  const cols = ["ExpName", ...state.materialCols, "Score", "Feasible", ...state.metricCols];
  thead.innerHTML = "<tr>" + cols.map(c => {
    const label = c === "ExpName" ? "ID"
      : c === "Score" ? "Score"
      : c === "Feasible" ? "Feasible"
      : state.materialCols.includes(c) ? prettifyMaterialLabel(c)
      : metricMeta(c).label;
    const sortClass = state.sortKey === c ? (state.sortDir === "asc" ? "sorted-asc" : "sorted") : "";
    return `<th class="${sortClass}" data-col="${c}">${label}</th>`;
  }).join("") + "</tr>";

  thead.querySelectorAll("th").forEach(th => {
    th.addEventListener("click", () => {
      const col = th.dataset.col;
      if (state.sortKey === col) state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      else { state.sortKey = col; state.sortDir = col === "Score" ? "desc" : "asc"; }
      renderTable();
    });
  });

  tbody.innerHTML = "";
  filtered.forEach(row => {
    const realIdx = state.rows.indexOf(row);
    const tr = document.createElement("tr");
    tr.className = (row.Feasible ? "" : "infeasible") + (realIdx === state.selectedIndex ? " selected" : "");
    const rank = sortedRowsForChart().indexOf(row) + 1;
    const cells = [
      `<td class="rank-cell">#${rank}</td>`,
      ...state.materialCols.map(c => `<td>${row.materials[c] || "—"}</td>`),
      `<td class="score-cell">${isFinite(row.Score) ? row.Score.toFixed(4) : "—"}</td>`,
      `<td>${row.Feasible ? "✅" : "❌"}${row.Pareto ? " ⭐" : ""}</td>`,
      ...state.metricCols.map(c => {
        const meta = metricMeta(c);
        const v = row.metrics[c];
        return `<td>${isFinite(v) ? v.toFixed(meta.decimals) : "—"} ${meta.unit}</td>`;
      })
    ];
    tr.innerHTML = cells.join("");
    tr.addEventListener("click", () => {
      state.selectedIndex = realIdx;
      renderDetail(realIdx);
      renderTable();
    });
    tbody.appendChild(tr);
  });
}

function renderDetail(idx) {
  const body = document.getElementById("detailBody");
  const sub = document.getElementById("detailSub");
  if (idx === null || idx === undefined || !state.rows[idx]) {
    body.innerHTML = `<p class="detail-empty">Select a row or bar to inspect it.</p>`;
    sub.textContent = "Select a row or bar";
    return;
  }
  const row = state.rows[idx];
  sub.textContent = row.ExpName;

  const matsHtml = state.materialCols.map(c =>
    `<div><span>${prettifyMaterialLabel(c)}</span><span>${row.materials[c] || "—"}</span></div>`
  ).join("");

  // relative normalization across the dataset, just for the bar fill
  const metricsHtml = state.metricCols.map(c => {
    const meta = metricMeta(c);
    const vals = state.rows.map(r => r.metrics[c]).filter(isFinite);
    const min = Math.min(...vals), max = Math.max(...vals);
    const v = row.metrics[c];
    let frac = max === min ? 1 : (v - min) / (max - min);
    if (meta.goal === "min") frac = 1 - frac;
    frac = Math.max(0, Math.min(1, frac));
    return `
      <div class="metric-row">
        <div class="metric-row-head"><b>${meta.label}</b><span>${isFinite(v) ? v.toFixed(meta.decimals) : "—"} ${meta.unit}</span></div>
        <div class="metric-bar-track"><div class="metric-bar-fill" style="width:${(frac * 100).toFixed(0)}%"></div></div>
      </div>`;
  }).join("");

  body.innerHTML = `
    <div class="detail-score-row">
      <span class="detail-score">${isFinite(row.Score) ? row.Score.toFixed(4) : "—"}</span>
      <span class="badge ${row.Feasible ? "badge-good" : "badge-bad"}">${row.Feasible ? "Feasible" : "Infeasible"}</span>
      ${row.Pareto ? '<span class="badge badge-good">Pareto-optimal</span>' : ""}
    </div>
    <div class="detail-materials">${matsHtml}</div>
    ${metricsHtml}
  `;
}

// ---------------- Wiring ----------------

const dropzone = document.getElementById("dropzone"); // outer landing section (shown/hidden as a whole)
const dropzoneSecondary = document.getElementById("dropzoneSecondary"); // actual drop target
const fileInput = document.getElementById("fileInput");

document.getElementById("browseBtn").addEventListener("click", () => fileInput.click());
document.getElementById("loadAnotherBtn").addEventListener("click", () => {
  document.getElementById("results").hidden = true;
  document.getElementById("caseSwitch").hidden = true;
  dropzone.hidden = false;
});

fileInput.addEventListener("change", (e) => {
  const file = e.target.files[0];
  if (file) file.text().then(txt => loadCSVText(txt, false));
});

["dragenter", "dragover"].forEach(evt =>
  dropzoneSecondary.addEventListener(evt, (e) => { e.preventDefault(); dropzoneSecondary.classList.add("dragover"); })
);
["dragleave", "drop"].forEach(evt =>
  dropzoneSecondary.addEventListener(evt, (e) => { e.preventDefault(); dropzoneSecondary.classList.remove("dragover"); })
);
dropzoneSecondary.addEventListener("drop", (e) => {
  const file = e.dataTransfer.files[0];
  if (file) file.text().then(txt => loadCSVText(txt, false));
});
dropzoneSecondary.addEventListener("click", (e) => {
  if (e.target.closest("button")) return;
  fileInput.click();
});

// ---- Configuration dialog (GUIConfig.m replica) ----

const configDialog = document.getElementById("configDialog");

function buildMaterialChecklist() {
  const list = document.getElementById("poolMaterialsList");
  list.innerHTML = MATERIALS.map(m =>
    `<label><input type="checkbox" value="${m.name}" checked data-family="${m.family}" /> ${m.name} <span style="color:var(--text-dim);font-size:.78em;">(${m.family})</span></label>`
  ).join("");
  updatePoolCountLabel();
  list.addEventListener("change", updatePoolCountLabel);
}
function updatePoolCountLabel() {
  const n = document.querySelectorAll("#poolMaterialsList input:checked").length;
  document.getElementById("poolCountLabel").textContent = `(${n} of ${MATERIALS.length} selected)`;
}
function buildTargetMaterialRadios() {
  const list = document.getElementById("targetMaterialList");
  list.innerHTML = MATERIALS.map((m, i) =>
    `<label><input type="radio" name="targetMaterial" value="${m.name}" ${i === 0 ? "checked" : ""} /> ${m.name}</label>`
  ).join("");
}
function buildFamilyFilter() {
  const sel = document.getElementById("cfgFamilyFilter");
  sel.innerHTML = materialFamilies().map(f => `<option value="${f}">${f}</option>`).join("");
  sel.addEventListener("change", () => {
    const target = sel.value;
    document.querySelectorAll("#poolMaterialsList input[type=checkbox]").forEach(cb => {
      cb.checked = target === "All" || cb.dataset.family === target;
    });
  });
}
buildMaterialChecklist();
buildTargetMaterialRadios();
buildFamilyFilter();

// ---- Ashby pre-screening (ConfigTabMaterials.m's "Ashby Auto-Screening") ----
// Selecting a preset ranks the full material pool by that Ashby index and
// checks only the top-N candidates — a live, visual Stage 1 filter before
// any 2D simulation runs. The user can still hand-edit the checkboxes
// afterward; this just pre-fills them, same as the real GUI.
function applyAshbyScreening() {
  const presetKey = document.getElementById("cfgAshbyPreset").value;
  const infoNote = document.getElementById("ashbyPresetInfo");
  const chartWrap = document.getElementById("ashbyChartWrap");

  if (presetKey === "none") {
    infoNote.hidden = true;
    chartWrap.hidden = true;
    return;
  }

  const topN = Math.max(1, Math.min(parseInt(document.getElementById("cfgAshbyTopN").value, 10) || 4, MATERIALS.length));
  const { ranked } = ashbyScreenMaterials(MATERIALS, presetKey, topN);
  const rankedNames = ranked.map(m => m.name);

  document.querySelectorAll("#poolMaterialsList input[type=checkbox]").forEach(cb => {
    cb.checked = rankedNames.includes(cb.value);
  });
  updatePoolCountLabel();

  const meta = ASHBY_PRESETS[presetKey];
  infoNote.hidden = false;
  infoNote.innerHTML = `<b>${meta.formula}</b> — ${meta.objective}. ${meta.reference}. Shortlisted: ${rankedNames.join(", ")}`;

  chartWrap.hidden = false;
  const canvas = document.getElementById("ashbyChart");
  const result = drawAshbyChart(canvas, MATERIALS, "alpha", "k", { highlightNames: rankedNames, guidelineSlope: 1.0 });
  const legend = document.getElementById("ashbyLegend");
  legend.innerHTML = result.families.map(f =>
    `<span><i style="background:${result.colorFor(f)}"></i>${f}</span>`
  ).join("");
}
document.getElementById("cfgAshbyPreset").addEventListener("change", applyAshbyScreening);
document.getElementById("cfgAshbyTopN").addEventListener("input", applyAshbyScreening);

// Tab switching
document.querySelectorAll(".config-tab").forEach(tab => {
  tab.addEventListener("click", () => {
    document.querySelectorAll(".config-tab").forEach(t => t.classList.remove("active"));
    document.querySelectorAll(".config-panel").forEach(p => p.classList.remove("active"));
    tab.classList.add("active");
    document.querySelector(`.config-panel[data-panel="${tab.dataset.tab}"]`).classList.add("active");
  });
});

document.getElementById("cfgSimLength").addEventListener("input", (e) => {
  document.getElementById("cfgSimLengthVal").textContent = e.target.value;
});

const freeDesignCheckbox = document.getElementById("cfgFreeDesign");
const fixedRegionPanel = document.getElementById("fixedRegionPanel");
freeDesignCheckbox.addEventListener("change", () => {
  fixedRegionPanel.disabled = freeDesignCheckbox.checked;
});

document.getElementById("openConfigBtn").addEventListener("click", () => configDialog.showModal());
document.getElementById("configCloseBtn").addEventListener("click", () => configDialog.close());

// Quick-fill presets
function fillForm(values) {
  document.getElementById("cfgWidth").value = values.width;
  document.getElementById("cfgHeight").value = values.height;
  document.getElementById("cfgNX").value = values.nx;
  document.getElementById("cfgNY").value = values.ny;
  document.getElementById("cfgSimLength").value = values.simLengthHours;
  document.getElementById("cfgSimLengthVal").textContent = values.simLengthHours;
  document.getElementById("cfgDTHours").value = values.dtHours;
  document.getElementById("cfgSnapshotPeriod").value = values.snapshotPeriodProportion;
  document.getElementById("cfgMaxSnapshots").value = values.maxSnapshots;
  document.getElementById("cfgOptimize").checked = true;
  document.getElementById("cfgMetricsFamily").value = values.metricsFamily;
  document.getElementById("cfgMaxExperiments").value = values.maxExperiments;
  document.getElementById("cfgTechnique").value = values.designTechnique;
  freeDesignCheckbox.checked = values.freeDesign;
  fixedRegionPanel.disabled = values.freeDesign;
  if (!values.freeDesign) {
    document.querySelector(`input[name="targetRegion"][value="${values.fixedRegionId}"]`).checked = true;
    const matRadio = document.querySelector(`input[name="targetMaterial"][value="${values.fixedMaterialName}"]`);
    if (matRadio) matRadio.checked = true;
  }
  document.querySelectorAll("#poolMaterialsList input[type=checkbox]").forEach(cb => { cb.checked = true; });
  document.getElementById("cfgAshbyPreset").value = "none";
  document.getElementById("ashbyPresetInfo").hidden = true;
  document.getElementById("ashbyChartWrap").hidden = true;
  updatePoolCountLabel();
}
document.getElementById("presetCoolingBtn").addEventListener("click", () => fillForm(CASE_STUDY_PRESETS.cooling));
document.getElementById("presetKilnBtn").addEventListener("click", () => fillForm(CASE_STUDY_PRESETS.kiln));
document.getElementById("presetDefaultBtn").addEventListener("click", () => fillForm({
  width: 1, height: 1, nx: 25, ny: 25, simLengthHours: 12, dtHours: 0.05,
  snapshotPeriodProportion: 10, maxSnapshots: 48, maxExperiments: 2,
  designTechnique: "Monte Carlo", freeDesign: true, metricsFamily: "cooling",
}));

// Apply & Run
document.getElementById("applyRunBtn").addEventListener("click", () => {
  let selectedMaterials = Array.from(document.querySelectorAll("#poolMaterialsList input:checked")).map(el => el.value);
  if (selectedMaterials.length === 0) {
    alert("Select at least one pool material.");
    return;
  }
  const freeDesign = freeDesignCheckbox.checked;
  let fixedRegionId, fixedMaterialName;
  if (!freeDesign) {
    fixedRegionId = parseInt(document.querySelector('input[name="targetRegion"]:checked').value, 10);
    const matRadio = document.querySelector('input[name="targetMaterial"]:checked');
    fixedMaterialName = matRadio ? matRadio.value : selectedMaterials[0];
    // GUIConfig.getSelectedMaterials(): the fixed material is included in
    // the pool even if its checkbox is unchecked, so Apply & Run never
    // errors out over a material the user is deliberately fixing, not
    // sampling from.
    if (!selectedMaterials.includes(fixedMaterialName)) selectedMaterials = [...selectedMaterials, fixedMaterialName];
  }

  const cfg = {
    width: parseFloat(document.getElementById("cfgWidth").value),
    height: parseFloat(document.getElementById("cfgHeight").value),
    nx: parseInt(document.getElementById("cfgNX").value, 10),
    ny: parseInt(document.getElementById("cfgNY").value, 10),
    simLengthHours: parseInt(document.getElementById("cfgSimLength").value, 10),
    dtHours: parseFloat(document.getElementById("cfgDTHours").value),
    snapshotPeriodProportion: parseFloat(document.getElementById("cfgSnapshotPeriod").value),
    maxSnapshots: parseInt(document.getElementById("cfgMaxSnapshots").value, 10),
    maxExperiments: parseInt(document.getElementById("cfgMaxExperiments").value, 10),
    designTechnique: document.getElementById("cfgTechnique").value,
    selectedMaterials,
    freeDesign, fixedRegionId, fixedMaterialName,
    metricsFamily: document.getElementById("cfgMetricsFamily").value,
    weatherFn: realWeatherTemp,
  };

  const applyBtn = document.getElementById("applyRunBtn");
  applyBtn.disabled = true;
  applyBtn.textContent = "Running…";

  setTimeout(() => {
    try {
      const result = runLiveSimulationCustom(cfg);
      state.lastSimConfig = result.simConfig;
      loadRows(result.rows, result.materialCols, result.metricCols, {
        badge: "LIVE SIMULATION",
        caseLabel: result.caseLabel,
      });
      configDialog.close();
    } catch (err) {
      alert("Simulation failed: " + err.message);
      console.error(err);
    } finally {
      applyBtn.disabled = false;
      applyBtn.textContent = "Apply & Run";
    }
  }, 30);
});

// ---- "How it works" dialog ----

const howDialog = document.getElementById("howDialog");
document.getElementById("howLink").addEventListener("click", (e) => {
  e.preventDefault();
  howDialog.showModal();
});
document.getElementById("howCloseBtn").addEventListener("click", () => howDialog.close());

document.getElementById("searchBox").addEventListener("input", renderTable);

document.getElementById("scoreChart").addEventListener("click", handleChartClick);
window.addEventListener("resize", () => { if (state.rows.length) renderChart(); });

document.getElementById("sampleBtn").addEventListener("click", () => {
  loadCSVText(DEMO_CSV, true);
});

// Small, obviously-labelled example dataset (cooling case schema) so the UI
// can be tried before a real optimization_results.csv exists. Material
// names are deliberately generic placeholders, not a claim about real
// ThermalSim output.
const DEMO_CSV = `ExpName,Region_1_OuterWall,Region_2_InnerWall,Region_3_Cavity,Score,Feasible,peak_temp,time_above_28c,diurnal_swing,mean_afternoon_temp
Exp-DEMO1,material_a,material_b,material_demo,0.9820,true,25.10,0.00,0.42,25.30
Exp-DEMO2,material_c,material_b,material_demo,0.9710,true,25.22,0.00,0.55,25.41
Exp-DEMO3,material_a,material_d,material_demo,0.9405,true,25.48,0.00,0.88,25.60
Exp-DEMO4,material_e,material_c,material_demo,0.8890,true,25.77,0.10,1.21,25.95
Exp-DEMO5,material_d,material_e,material_demo,0.7120,true,26.30,0.60,2.05,26.70
Exp-DEMO6,material_e,material_e,material_demo,0.4010,true,27.10,2.40,3.60,27.80
Exp-DEMO7,material_f,material_f,material_demo,-999,false,31.50,10.20,6.90,30.10
`;

// ---- Download results — mirrors writeToDisk.m's results/reports/ tree ----

function buildOptimizationCSV() {
  const header = ["ExpName", ...state.materialCols, "Score", "Feasible", ...state.metricCols];
  const lines = [header.join(",")];
  for (const row of state.rows) {
    const cells = [
      row.ExpName,
      ...state.materialCols.map(c => row.materials[c] ?? ""),
      isFinite(row.Score) ? row.Score.toFixed(6) : "-Inf",
      row.Feasible ? "true" : "false",
      ...state.metricCols.map(c => (isFinite(row.metrics[c]) ? row.metrics[c] : "")),
    ];
    lines.push(cells.join(","));
  }
  return lines.join("\n");
}

function buildSimulationConfigTxt() {
  const c = state.lastSimConfig;
  if (!c) return "=== THERMALSIM GLOBAL CONFIGURATION ===\n(No simConfig available — this dataset wasn't produced by a live KelvinK run.)\n";
  return [
    "=== THERMALSIM GLOBAL CONFIGURATION ===",
    `Simulation Start Time : ${c.startTime.toFixed(2)} Hours`,
    `Simulation Stop Time  : ${c.stopTime.toFixed(2)} Hours`,
    `Simulation Length     : ${c.length.toFixed(2)} Hours`,
    `Timestep Interval     : ${c.dtSecs.toFixed(6)} Seconds`,
    `Domain Dimensions     : ${c.width} x ${c.height} m`,
    `Grid Discretization   : ${c.nx} x ${c.ny} Nodes (requested; NY unused — see engine.js)`,
    `Total Experiments     : ${c.totalExperiments}`,
    "",
  ].join("\n");
}

function buildExperimentSummaryTxt(row) {
  const lines = [
    "========================================",
    `  EXPERIMENT NAME : ${row.ExpName}`,
    "========================================",
    "",
    "--- MATERIALS CONFIGURATION ---",
  ];
  for (const c of state.materialCols) lines.push(`  ${c} : ${row.materials[c] ?? ""}`);
  lines.push("", "--- CALCULATED METRIC RESULTS ---");
  for (const c of state.metricCols) {
    const meta = metricMeta(c);
    const v = row.metrics[c];
    lines.push(`  ${meta.label}: ${isFinite(v) ? v.toFixed(meta.decimals) : "NaN"} ${meta.unit}`);
  }
  lines.push("", `Score: ${isFinite(row.Score) ? row.Score.toFixed(6) : "-Inf"}`, `Feasible: ${row.Feasible}`, "");
  return lines.join("\n");
}

function buildTimeseriesCSV(row) {
  if (!row._series) return null;
  const { t, T } = row._series;
  const lines = ["time_seconds,subregion_mean_temp_C  # subregion = region ID 2 (Inner Wall), see KelvinK README"];
  for (let i = 0; i < t.length; i++) lines.push(`${t[i]},${T[i]}`);
  return lines.join("\n");
}

document.getElementById("downloadResultsBtn").addEventListener("click", async () => {
  const btn = document.getElementById("downloadResultsBtn");
  if (typeof JSZip === "undefined") {
    alert("Couldn't load the zip library (JSZip) — check your internet connection and try again. "
      + "This is the one feature in KelvinK that needs a CDN script.");
    return;
  }
  btn.disabled = true;
  btn.textContent = "Zipping…";
  try {
    const zip = new JSZip();
    const reports = zip.folder("results").folder("reports");
    reports.file("simulation_config.txt", buildSimulationConfigTxt());
    reports.file("optimization_results.csv", buildOptimizationCSV());

    for (const row of state.rows) {
      const expFolder = reports.folder(row.ExpName).folder("reports");
      expFolder.file(`${row.ExpName}_summary.txt`, buildExperimentSummaryTxt(row));
      const tsCsv = buildTimeseriesCSV(row);
      if (tsCsv) expFolder.file(`${row.ExpName}_timeseries.csv`, tsCsv);
    }

    const blob = await zip.generateAsync({ type: "blob" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "ThermalSim_results.zip";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  } catch (err) {
    alert("Couldn't build the results zip: " + err.message);
    console.error(err);
  } finally {
    btn.disabled = false;
    btn.textContent = "Download results";
  }
});

// ---- Open in a working state, not an empty shell ----
// First view runs a real (smaller, fast) version of Case Study 1 instead of
// showing a bare "click to configure" page — genuinely computed physics,
// not placeholder numbers, so no "DEMO DATA" badge is needed for it.
(function autoRunOnFirstLoad() {
  setTimeout(() => {
    try {
      const preset = CASE_STUDY_PRESETS.cooling;
      const result = runLiveSimulationCustom({
        width: preset.width, height: preset.height, nx: preset.nx, ny: preset.ny,
        simLengthHours: preset.simLengthHours, dtHours: preset.dtHours,
        snapshotPeriodProportion: preset.snapshotPeriodProportion, maxSnapshots: preset.maxSnapshots,
        maxExperiments: 18, designTechnique: preset.designTechnique,
        selectedMaterials: MATERIALS.map(m => m.name),
        freeDesign: preset.freeDesign, fixedRegionId: preset.fixedRegionId,
        fixedMaterialName: preset.fixedMaterialName, metricsFamily: preset.metricsFamily,
        weatherFn: realWeatherTemp,
      });
      state.lastSimConfig = result.simConfig;
      loadRows(result.rows, result.materialCols, result.metricCols, {
        badge: "STARTER RUN",
        caseLabel: result.caseLabel,
      });
    } catch (err) {
      console.error("Auto-run on load failed, leaving the landing screen up:", err);
    }
  }, 10);
})();
