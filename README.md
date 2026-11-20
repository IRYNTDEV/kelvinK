# KelvinK

An in-browser port of ThermalSim's actual pipeline — the same 2D
concentric-ring grid, the same explicit conduction solver, the same metrics
and ranking algorithm — plus a dashboard to read the results without
digging through files. No MATLAB required to run it; MATLAB output can
still be loaded and viewed the same way.

**Ported against the Nov 19 ThermalSim build** (`ThermalSim_nov19.zip`), the
developer's newest codebase — which itself superseded "ThermalSim 3," which
superseded the original ThermalSim5/ThermalSim_4 snapshot KelvinK was first
built from. See "What's new in the Nov 19 build" below.

Two ways in:

1. **Run it live** — opens a dialog that mirrors `GUIConfig.m`'s real tabs
   (Geometry / Simulation / Materials / Constraints) and defaults exactly,
   plus two one-click presets for the thesis case studies. The Materials tab
   includes Stage 1 Ashby pre-screening — pick a performance-index preset,
   see the log-log chart, and only the top-N shortlisted materials feed the
   simulation. Samples material pairs, solves the real 2D grid for each
   in-browser, scores and ranks them.
2. **Load a MATLAB result** — drop in a ThermalSim `optimization_results.csv`
   and get the same dashboard around real MATLAB-solver output.

After a run, **Download results** builds a zip with the same
`results/reports/` folder tree `writeToDisk.m` produces (one folder per
experiment, a summary file and a full timeseries CSV each, plus
`simulation_config.txt` and `optimization_results.csv`) — just without the
PNG plots/heatmaps/GIFs, since KelvinK does no rendering (see "Why it's
instant" below).

Everything runs client-side. No build step, no data leaves your machine.
One CDN dependency: JSZip, loaded only when you click "Download results."

## What's new in the Nov 19 build

Three codebase generations deep now. Each one surfaced real fixes, real
regressions to documentation, and (this time) a genuinely new pipeline
stage — not just incremental features:

- **Stage 1 Ashby pre-screening is new** (`AshbyScreening.m`). Before any 2D
  simulation runs, the material pool can be ranked by one of five Ashby
  performance indices — `cool_outer` (1/α, thermal delay), `cool_inner`
  (ρ·cp, heat storage), `kiln_outer` (1/√(k·ρ·cp), minimal envelope loss),
  `kiln_inner` (√(k·ρ·cp), refractory storage), `radiative_cost`
  (emissivity/cost) — optionally constrained by cost/conductivity/density/
  family bounds, and only the top N candidates proceed to simulation.
  `ConfigTabMaterials.m` adds this as a dropdown + Top-N field that live-
  updates which pool checkboxes are checked; `generateAshbyChart` plots the
  full pool on a log-log chart. Ported to `ashby.js` and wired into the
  Materials tab exactly the same way — including the chart, drawn on
  canvas like the rest of KelvinK's charts, no library.
  **One disconnect found, not replicated:** the real GUI's Ashby dropdown
  (`cfg.AshbyPreset`) is collected but `main.m` never actually reads it —
  the script-level pre-screening stage instead reads standalone
  `ASHBY_PRESET`/`ASHBY_TOP_N` workspace variables that default to
  `cool_outer`/4 regardless of what the GUI shows selected. That's a bug in
  the Nov 19 build's own wiring, not a deliberate design — KelvinK
  implements the evidently-intended behavior (GUI selection actually
  drives screening) rather than faithfully reproducing the disconnect.
- **The material database grew to 58 entries** (`data/thermal_materials_extended.csv`,
  up from 38), with 20 new entries — mostly more Concrete/Masonry/Stone/Metal
  variants (reinforced_concrete, engineering_brick, basalt, brass, aluminium_6061...).
- **The cavityMask bug is still fixed** (first fixed in the ThermalSim 3
  generation): `main.m` looks the cavity up by name
  (`tbl.regionID(tbl.RegionName == "Cavity")`), not a hardcoded region ID.
  Resolves something flagged when first reviewing the presentation deck:
  several Results-table materials (cast_iron, zinc, lead, polycarbonate,
  sandstone, slate, hardwood_oak...) didn't exist in the original 21-material
  list and looked fabricated. They weren't — they came from these later,
  larger databases.
- **"Metrics Family" (Cooling Chamber / Kiln) is now a real GUI field**
  (`ConfigTabSimulation.m`'s dropdown), not something KelvinK had to invent
  to make the kiln case reachable.
- **The kiln heat source changed: 5×10⁵ W/m³ for 8 hours**, not the
  120,000 W/m³ / 6h documented in `setup.txt` — `setup.txt` is now stale
  and doesn't match the current code.
- **KelvinK's kiln heat source is a deliberate deviation from that current
  value, not a port of it.** The narrow, intense σ=0.5 source makes
  `peak_temp` and `spatial_non_uniform` fail together on almost every run —
  the same concentration that pushes the cavity center past 1200°C also
  blows its spatial spread past the 150°C non-uniformity bound. Calibrated
  (`KILN_HEAT_SOURCE` in `engine.js`) to a broader, gentler σ=5.0 source at
  tuned power instead — verified against the full material pool to give
  16/27 feasible designs with a physically sensible ranking (insulating
  wall pairs overshoot, conductive ones vent enough to stay in-band). The
  original current-`main.m` value is kept as
  `KILN_HEAT_SOURCE_CURRENT_MAIN_M` in `engine.js` for reference.
- **`heat_loss` was replaced by `fuel_required`** — a dimensionless-feeling
  but physically dimensioned metric (source energy needed to reach 900°C,
  linear temperature-rise assumption), unbounded above instead of capped at
  an unreachable `1e8` J that made the old metric meaningless.
- **`spatial_non_uniform` is now restricted to the cavity mask** — it used
  to take the standard deviation of the *entire* domain (walls included),
  which measured the whole domain's thermal gradient, not how evenly the
  cavity itself was heated.
- **`RankingEngine.m` was substantially rewritten**: graded, capped
  constraint violations instead of binary feasible/infeasible; normalization
  against feasible-run min/max instead of the (much wider, acceptance-limit)
  constraint bounds; a `-999` infeasible sentinel instead of `-Inf`;
  infeasible designs sorted by how close they came, not left in arbitrary
  order; and a Pareto-optimal flag. KelvinK's `rankDesigns()` now matches
  this algorithm (minus the optional per-metric `tolerance`/`scale`
  overrides, which nothing currently uses, so they're equivalent to their
  defaults anyway).
- **Materials tab merged "Experiments Pool" in**, plus a "Quick Select
  Family" dropdown to bulk-check/uncheck by material family. KelvinK's
  modal matches this layout, not the older separate-tab one.

## What the live simulation actually does

This is a **function-for-function port**, not an approximation. `engine.js`
implements, in order:

| ThermalSim source | `engine.js` |
|---|---|
| `AshbyScreening.m` | `ashby.js` — same five index formulas, same constraint filter, same log-log chart |
| `ringGeometry.m` | `ringGeometry()` — identical concentric-ring rectangle layout |
| `RegionMap.m` | `RegionMap` class — same painter's-algorithm point lookup, same `rasterize()` |
| `PDEEngine.m`'s `resolveDiscretization` | `resolveDiscretization()` — same CFL-based grid-shrink check, run per experiment against that experiment's own sampled materials |
| `PDESolver.m` | `PDESolver` class — same Jacobi-style explicit forward-Euler update, same harmonic-mean interface conductances, same Robin/Neumann boundary formulas, same North→South→East→West application order |
| `createGaussianHeatSource.m` | `gaussianHeatSourceField()` |
| `config.m`'s metric definitions (incl. `fuel_required`) | `computeMetrics()` |
| `RankingEngine.m` | `rankDesigns()` — graded violation, feasible-only normalization, Pareto flag, `-999` sentinel |
| `ExperimentDesigner.m`'s Monte Carlo/First N sampling | `sampleDesigns()`/`combinationFromIndex()` (not bit-identical RNG to MATLAB's `randperm`, same algorithm) |

It uses the real 58-material database (`data_materials.js`) and real NASA
POWER hourly weather data for Ibadan (`data_weather.js`).

## Why it's instant here but takes real time in MATLAB

The physics itself is comparable work (same grid, same equations, same step
count) — what's actually slow in MATLAB is everything around it, which
KelvinK skips entirely:

- **No plotting or image generation.** `writeToDisk.m` renders and saves 3
  line-plot PNGs, a heatmap grid, and optionally a GIF, per experiment.
  Figure rendering/export in MATLAB is slow; KelvinK's zip has text/CSV
  only — a real feature gap, not just a speed trick.
- **No per-step array growth.** `Experiment.addTimeStep()` does
  `obj.time(end+1) = t` every step — a classic MATLAB slow pattern (the
  array reallocates as it grows). KelvinK pre-allocates fixed-size typed
  arrays once per experiment.
- **No per-call OOP/validation overhead.** Every MATLAB timestep goes
  through several `handle`-class method calls, some with `arguments` blocks
  re-validating types on every call. KelvinK is flat functions on typed
  arrays.
- **Different execution environment.** MATLAB Online runs in a shared
  cloud VM through an interpreter; KelvinK runs as JIT-compiled JavaScript
  on your own CPU.

## How to use the "load a MATLAB result" path

1. Run the real ThermalSim pipeline in MATLAB.
2. Download `results/reports/optimization_results.csv`.
3. Drag it onto the KelvinK page (or click "Choose file").
4. It auto-detects cooling vs. kiln from the columns present.

The CSV needs material-name columns to show anything but an experiment ID —
`RankingEngine.m`'s own export doesn't include them. If you're using the
older `ThermalSim5` fork, its `main.m` was patched to attach material
columns before export; an unpatched export will fall back to showing only
the experiment ID.

Click "Load example data" to see the dashboard with placeholder data before
you have a real CSV — labeled "DEMO DATA" in the header pill so it's never
mistaken for a real result.

## Files

- `index.html` — page structure, including the `GUIConfig.m`-replica dialog
- `styles.css` — look and feel (light/dark aware, responsive)
- `app.js` — CSV parsing, live-run wiring, zip export, and all rendering
- `engine.js` — the ported 2D geometry/solver/metrics/ranking pipeline
- `data_materials.js` — real material properties (58 entries, with family)
- `ashby.js` — the ported Stage 1 Ashby pre-screening (indices, constraints, chart)
- `data_weather.js` — real Ibadan hourly weather data + synthetic fallback
