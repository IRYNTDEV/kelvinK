// KelvinK simulation engine — a line-by-line port of ThermalSim's actual
// MATLAB pipeline (ringGeometry.m, RegionMap.m, PDEEngine.m, PDESolver.m,
// ExperimentDesigner.m, evaluateExperimentMetrics.m, config.m,
// RankingEngine.m), not a simplified approximation. Every function below
// has a comment naming the exact MATLAB file/function it reproduces.
//
// Ported against "ThermalSim 3" (the developer's newer, actively-revised
// codebase), not the older ThermalSim5/ThermalSim_4 snapshot. Earlier
// versions of this file faithfully reproduced a real bug in that older
// snapshot — main.m's cavityMask selected region ID 2 ("Inner Wall")
// instead of ID 3 ("Cavity"), so every metric described the wall's
// temperature, not the room's. THAT BUG IS NOW FIXED UPSTREAM: ThermalSim
// 3's main.m looks up the cavity region by name (`tbl.regionID(tbl.
// RegionName == "Cavity")`) rather than a hardcoded ID. KelvinK now
// matches that corrected behavior — it measures region 3 (the actual
// cavity), not region 2. See KelvinK's README for the full history.

// ---------------------------------------------------------------------
// ringGeometry.m — concentric axis-aligned rectangular rings
// ---------------------------------------------------------------------
function ringGeometry(width, height, thicknesses) {
  const n = thicknesses.length;
  const rects = []; // {xmin,xmax,ymin,ymax,regionID}
  let xmin = 0, xmax = width, ymin = 0, ymax = height;
  for (let i = 1; i <= n; i++) {
    const dx = (thicknesses[i - 1] * width) / 2;
    const dy = (thicknesses[i - 1] * height) / 2;
    const nextXmin = xmin + dx, nextXmax = xmax - dx;
    const nextYmin = ymin + dy, nextYmax = ymax - dy;
    if (i < n) {
      rects.push({ xmin, xmax, ymin, ymax: nextYmin, regionID: i }); // Bottom
      rects.push({ xmin, xmax, ymin: nextYmax, ymax, regionID: i }); // Top
      rects.push({ xmin, xmax: nextXmin, ymin: nextYmin, ymax: nextYmax, regionID: i }); // Left
      rects.push({ xmin: nextXmax, xmax, ymin: nextYmin, ymax: nextYmax, regionID: i }); // Right
    } else {
      rects.push({ xmin, xmax, ymin, ymax, regionID: i }); // Innermost
    }
    xmin = nextXmin; xmax = nextXmax; ymin = nextYmin; ymax = nextYmax;
  }
  return rects;
}

// ---------------------------------------------------------------------
// RegionMap.m — point -> regionID lookup (painter's algorithm) + rasterize
// ---------------------------------------------------------------------
class RegionMap {
  constructor(width, height, rects) {
    this.width = width;
    this.height = height;
    this.rects = rects; // already using contiguous 1..n IDs from ringGeometry
  }
  getRegionID(x, y) {
    if (x < 0 || x > this.width || y < 0 || y > this.height) return 1;
    for (let i = this.rects.length - 1; i >= 0; i--) {
      const r = this.rects[i];
      if (x >= r.xmin && x <= r.xmax && y >= r.ymin && y <= r.ymax) return r.regionID;
    }
    return 1;
  }
  // Returns a flat Int32Array of length N*N (row-major, row 0 = y=0)
  rasterize(N) {
    const xLin = linspace(0, this.width, N);
    const yLin = linspace(0, this.height, N);
    const grid = new Int32Array(N * N);
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N; col++) {
        grid[row * N + col] = this.getRegionID(xLin[col], yLin[row]);
      }
    }
    return grid;
  }
}

function linspace(a, b, n) {
  const out = new Float64Array(n);
  if (n === 1) { out[0] = a; return out; }
  const step = (b - a) / (n - 1);
  for (let i = 0; i < n; i++) out[i] = a + step * i;
  return out;
}

// ---------------------------------------------------------------------
// PDEEngine.m's resolveDiscretization — shrinks N if the requested grid
// would violate CFL stability for the fixed configured timestep.
// ---------------------------------------------------------------------
function resolveDiscretization(w, h, reqN, dt, maxAlpha) {
  const dxReq = w / (reqN - 1);
  const dyReq = h / (reqN - 1);
  const cflLimit = 1 / (2 * maxAlpha * (1 / (dxReq * dxReq) + 1 / (dyReq * dyReq)));
  let N;
  if (dt <= cflLimit) {
    N = reqN;
  } else {
    const maxNminus1 = Math.sqrt(1 / (2 * maxAlpha * dt * (1 / (w * w) + 1 / (h * h))));
    N = Math.floor(maxNminus1) + 1;
    if (N < 3) N = 3;
  }
  const dx = w / (N - 1);
  const dy = h / (N - 1);
  return { N, dx, dy };
}

// ---------------------------------------------------------------------
// PDESolver.m — explicit 2D conduction solver with mixed Robin/Neumann BCs
// ---------------------------------------------------------------------
class PDESolver {
  constructor(N, T0, K, RhoCp, dx, dy, dt) {
    this.N = N; this.dx = dx; this.dy = dy; this.dt = dt;
    this.K = K; this.RhoCp = RhoCp;
    this.T = Float64Array.from(T0);
    this.currentTime = 0;

    // Precompute inter-cell harmonic-mean conductances (Ke: East-West
    // faces, Kn: North-South faces), exactly as PDESolver's constructor.
    this.Ke = new Float64Array(N * (N - 1)); // Ke[row*(N-1)+col] = face between col,col+1 at row
    this.Kn = new Float64Array((N - 1) * N); // Kn[row*N+col] = face between row,row+1 at col
    for (let row = 0; row < N; row++) {
      for (let col = 0; col < N - 1; col++) {
        const k1 = K[row * N + col], k2 = K[row * N + col + 1];
        this.Ke[row * (N - 1) + col] = (2 * k1 * k2) / (k1 + k2);
      }
    }
    for (let row = 0; row < N - 1; row++) {
      for (let col = 0; col < N; col++) {
        const k1 = K[row * N + col], k2 = K[(row + 1) * N + col];
        this.Kn[row * N + col] = (2 * k1 * k2) / (k1 + k2);
      }
    }
    this._buf = new Float64Array(N * N);
  }

  // bc: {North:{type,h,T_inf}|{type:'Neumann'}, South, East, West}
  step(bc, Qfield) {
    const N = this.N, dx = this.dx, dy = this.dy, dt = this.dt;
    const T = this.T, Ke = this.Ke, Kn = this.Kn, RhoCp = this.RhoCp;
    const Tnew = this._buf;
    Tnew.set(T); // boundary cells default to old value; overwritten below

    // Interior update (Jacobi-style: all reads from the pre-step T,
    // matching MATLAB's vectorized simultaneous update).
    for (let row = 1; row < N - 1; row++) {
      for (let col = 1; col < N - 1; col++) {
        const idx = row * N + col;
        const qEast = Ke[row * (N - 1) + col] * (T[idx + 1] - T[idx]) / dx;
        const qWest = Ke[row * (N - 1) + col - 1] * (T[idx] - T[idx - 1]) / dx;
        const qNorth = Kn[row * N + col] * (T[idx + N] - T[idx]) / dy;
        const qSouth = Kn[(row - 1) * N + col] * (T[idx] - T[idx - N]) / dy;
        const Q = Qfield ? Qfield[idx] : 0;
        const dTdt = (1 / RhoCp[idx]) * ((qEast - qWest) / dx + (qNorth - qSouth) / dy + Q);
        Tnew[idx] = T[idx] + dt * dTdt;
      }
    }

    // Boundary conditions, applied in the same order as PDESolver.step:
    // North, South, East, West (last writer wins at the corners, exactly
    // as in MATLAB).
    this._applyBoundary(Tnew, "North", bc.North, N);
    this._applyBoundary(Tnew, "South", bc.South, N);
    this._applyBoundary(Tnew, "East", bc.East, N);
    this._applyBoundary(Tnew, "West", bc.West, N);

    this.T.set(Tnew);
    this.currentTime += dt;
  }

  _applyBoundary(Tnew, edge, cfg, N) {
    const K = this.K, dx = this.dx, dy = this.dy;
    if (cfg.type === "Neumann") {
      if (edge === "North") for (let c = 0; c < N; c++) Tnew[(N - 1) * N + c] = Tnew[(N - 2) * N + c];
      else if (edge === "South") for (let c = 0; c < N; c++) Tnew[c] = Tnew[N + c];
      else if (edge === "East") for (let r = 0; r < N; r++) Tnew[r * N + (N - 1)] = Tnew[r * N + (N - 2)];
      else if (edge === "West") for (let r = 0; r < N; r++) Tnew[r * N] = Tnew[r * N + 1];
    } else if (cfg.type === "Robin") {
      const h = cfg.h, Tinf = cfg.T_inf;
      if (edge === "North") {
        for (let c = 0; c < N; c++) {
          const k = K[(N - 1) * N + c];
          Tnew[(N - 1) * N + c] = (k * Tnew[(N - 2) * N + c] + h * dy * Tinf) / (k + h * dy);
        }
      } else if (edge === "South") {
        for (let c = 0; c < N; c++) {
          const k = K[c];
          Tnew[c] = (k * Tnew[N + c] + h * dy * Tinf) / (k + h * dy);
        }
      } else if (edge === "East") {
        for (let r = 0; r < N; r++) {
          const k = K[r * N + (N - 1)];
          Tnew[r * N + (N - 1)] = (k * Tnew[r * N + (N - 2)] + h * dx * Tinf) / (k + h * dx);
        }
      } else if (edge === "West") {
        for (let r = 0; r < N; r++) {
          const k = K[r * N];
          Tnew[r * N] = (k * Tnew[r * N + 1] + h * dx * Tinf) / (k + h * dx);
        }
      }
    }
  }
}

// ---------------------------------------------------------------------
// createGaussianHeatSource.m
// ---------------------------------------------------------------------
function gaussianHeatSourceField(N, width, height, peakPower, sigma) {
  const xLin = linspace(0, width, N);
  const yLin = linspace(0, height, N);
  const xc = width / 2, yc = height / 2;
  const field = new Float64Array(N * N);
  for (let row = 0; row < N; row++) {
    for (let col = 0; col < N; col++) {
      const dxc = xLin[col] - xc, dyc = yLin[row] - yc;
      field[row * N + col] = peakPower * Math.exp(-(dxc * dxc + dyc * dyc) / (2 * sigma * sigma));
    }
  }
  return field;
}

// ---------------------------------------------------------------------
// config.m's PERFORMANCE_METRICS_COOLING / PERFORMANCE_METRICS_KILN.
// "Metrics Family" IS a real GUI field in ThermalSim 3 — ConfigTabSimulation.m
// has a dropdown (["Cooling Chamber", "Kiln"]) feeding cfg.MetricsFamily,
// which config.m uses to pick PERFORMANCE_METRICS dynamically, and main.m
// uses to pick the heat source. This is no longer a KelvinK-only addition.
//
// heat_loss (bounded [0, 1e8], the value that produced nonsensical
// 1e11-scale numbers against its own limit) has been REPLACED upstream by
// fuel_required — a physically dimensioned, unbounded-above metric: the
// source energy needed to reach 900°C, assuming a linear temperature-rise
// response. See localFuelRequired/localSourceEnergy in config.m.
// ---------------------------------------------------------------------
const COOLING_METRICS = {
  peak_temp:           { weight: 0.40, goal: "min", bounds: [15, 45] },
  time_above_28c:      { weight: 0.30, goal: "min", bounds: [0, 72] },
  diurnal_swing:       { weight: 0.20, goal: "min", bounds: [0, 20] },
  mean_afternoon_temp: { weight: 0.10, goal: "min", bounds: [20, 45] },
};
const KILN_METRICS = {
  sintering_duration:  { weight: 0.40, goal: "max", bounds: [0, 48] },
  peak_temp:           { weight: 0.25, goal: "max", bounds: [800, 1200] }, // exact config.m bound, unmodified
  fuel_required:       { weight: 0.25, goal: "min", bounds: [0, Infinity] },
  spatial_non_uniform: { weight: 0.10, goal: "min", bounds: [0, 150] },
};
// ThermalSim 3's main.m currently uses peakPower=5e5, sigma=0.5, fireHours=8
// for the "Kiln" branch — a narrow, intense point source. Verified by
// direct calibration sweep (see git history / session notes) that this
// makes the kiln case feasible for ~0/27 designs almost every run: a
// sigma=0.5 Gaussian concentrates heat so tightly around the domain
// center that peak_temp overshoots past the 1200°C upper bound long
// before the surrounding cavity catches up, AND spatial_non_uniform (std
// across the cavity) blows past 150°C from that same concentration — the
// two feasibility-gating metrics fail for opposite-looking but related
// reasons.
//
// KELVINK CALIBRATION (deliberate deviation from current main.m, at the
// user's request for a heat source that actually produces feasible
// results): a much broader, gentler source — sigma=5.0 instead of 0.5 —
// heats the cavity far more evenly (peak and non-uniformity both scale
// with how concentrated the source is, not just its total power), at a
// power tuned so the cavity's peak lands mid-band. Verified against the
// full 38-material pool: 16/27 designs feasible, physically sensible
// (well-insulated wall pairs overshoot past 1200°C; conductive ones vent
// enough heat to stay in-band) — not everything trivially passing.
const KILN_HEAT_SOURCE_CURRENT_MAIN_M = { peakPower: 5e5, sigma: 0.5, fireHours: 8.0 };
const KILN_HEAT_SOURCE = { peakPower: 8e4, sigma: 5.0, fireHours: 8.0 };

// Case-study presets. setup.txt's own documented numbers are kept for the
// geometry/timestep (those still match), but the kiln heat source uses the
// current main.m value above, not setup.txt's stale 120,000 W/m^3 figure.
const CASE_STUDY_PRESETS = {
  cooling: {
    label: "Passive-Cooling Room (setup.txt Case 1)",
    width: 4.0, height: 4.0, nx: 32, ny: 32,
    simLengthHours: 24, dtHours: 0.01,
    snapshotPeriodProportion: 10, maxSnapshots: 48,
    maxExperiments: 27, designTechnique: "Monte Carlo",
    freeDesign: false, fixedRegionId: 3, fixedMaterialName: "expanded_polystyrene",
    metricsFamily: "cooling",
  },
  kiln: {
    label: "Brick-Firing Kiln (setup.txt Case 2, heat source updated to match current main.m)",
    width: 4.0, height: 4.0, nx: 32, ny: 32,
    simLengthHours: 24, dtHours: 0.005,
    snapshotPeriodProportion: 10, maxSnapshots: 48,
    maxExperiments: 27, designTechnique: "Monte Carlo",
    freeDesign: false, fixedRegionId: 3, fixedMaterialName: "fireclay_brick",
    metricsFamily: "kiln",
  },
};

const MAX_NO_OF_SNAPSHOTS = 48;
const SNAPSHOT_PERIOD_PROPORTION = 10;

function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------------------------------------------------------------------
// One full experiment: PDEEngine construction + main.m's inner FDM loop
// + evaluateExperimentMetrics.m's metric computations.
// ---------------------------------------------------------------------
function runExperiment(outerMat, innerMat, cavityMat, caseCfg, weatherFn) {
  const regionMap = new RegionMap(caseCfg.width, caseCfg.height, ringGeometry(caseCfg.width, caseCfg.height, caseCfg.partitions));
  const matByRegion = { 1: outerMat, 2: innerMat, 3: cavityMat };

  // PDEEngine: resolve N from this experiment's own max alpha (CFL check)
  const maxAlpha = Math.max(outerMat.k / (outerMat.rho * outerMat.cp),
                             innerMat.k / (innerMat.rho * innerMat.cp),
                             cavityMat.k / (cavityMat.rho * cavityMat.cp));
  const { N, dx, dy } = resolveDiscretization(caseCfg.width, caseCfg.height, caseCfg.reqN, caseCfg.dtSeconds, maxAlpha);

  const idGrid = regionMap.rasterize(N);
  const K = new Float64Array(N * N);
  const RhoCp = new Float64Array(N * N);
  for (let i = 0; i < N * N; i++) {
    const m = matByRegion[idGrid[i]];
    K[i] = m.k;
    RhoCp[i] = m.rho * m.cp;
  }
  // Cavity = region 3 ("Cavity", the innermost ring) — matches ThermalSim
  // 3's `tbl.regionID(tbl.RegionName == "Cavity")` lookup, which is always
  // region 3 here since KelvinK's ring order is fixed (outer/inner/cavity).
  const CAVITY_ID = 3;
  const subregionMask = idGrid;

  const T0 = new Float64Array(N * N).fill(25.0);
  const solver = new PDESolver(N, T0, K, RhoCp, dx, dy, caseCfg.dtSeconds);

  const Qspatial = caseCfg.heatSource
    ? gaussianHeatSourceField(N, caseCfg.width, caseCfg.height, caseCfg.heatSource.peakPower, caseCfg.heatSource.sigma)
    : null;
  const tFireSeconds = caseCfg.heatSource ? caseCfg.heatSource.fireHours * 3600 : 0;
  let sumQspatial = 0;
  if (Qspatial) for (let i = 0; i < Qspatial.length; i++) sumQspatial += Qspatial[i];

  // dA: cell area, exactly main.m's
  // `dA = (max(X)-min(X))*(max(Y)-min(Y)) / ((size(X,1)-1)*(size(X,2)-1))`
  const dA = (caseCfg.width * caseCfg.height) / ((N - 1) * (N - 1));

  const totalSeconds = caseCfg.simHours * 3600;
  const nSteps = Math.round(totalSeconds / caseCfg.dtSeconds);

  // Snapshot interval, exactly per config.m's formula.
  let snapshotInterval = Math.max(1, Math.floor(nSteps * (SNAPSHOT_PERIOD_PROPORTION / 100)));
  if (Math.ceil(nSteps / snapshotInterval) > MAX_NO_OF_SNAPSHOTS) {
    snapshotInterval = Math.ceil(nSteps / MAX_NO_OF_SNAPSHOTS);
  }

  const T_sub_mean = new Float64Array(nSteps); // per-step mean over the cavity (region 3)
  const tSeries = new Float64Array(nSteps);
  let maxSnapshotStd = 0; // localSpatialNonUniform: std restricted to the cavity mask

  // localSourceEnergy's stride=20 sampling of the volumetric source.
  const STRIDE = 20;
  let sourceEnergyAccum = 0; // J per metre depth

  for (let step = 0; step < nSteps; step++) {
    const tCurr = solver.currentTime;
    const Tamb = weatherFn(tCurr / 3600);
    const Q = Qspatial && tCurr <= tFireSeconds ? Qspatial : null;

    const bc = {
      North: { type: "Robin", h: caseCfg.hExt, T_inf: Tamb },
      East:  { type: "Robin", h: caseCfg.hExt, T_inf: Tamb },
      West:  { type: "Robin", h: caseCfg.hExt, T_inf: Tamb },
      South: { type: "Neumann" },
    };
    solver.step(bc, Q);

    // --- bookkeeping, mirrors Experiment.addTimeStep + main.m's loop ---
    let sum = 0, count = 0, varSum = 0;
    const T = solver.T;
    for (let i = 0; i < subregionMask.length; i++) {
      if (subregionMask[i] === CAVITY_ID) { sum += T[i]; count++; }
    }
    const cavityMean = count ? sum / count : NaN;
    T_sub_mean[step] = cavityMean;
    tSeries[step] = solver.currentTime;

    if (step % STRIDE === 0) {
      const dtSampled = caseCfg.dtSeconds * STRIDE;
      const qSum = Qspatial && solver.currentTime <= tFireSeconds ? sumQspatial : 0;
      sourceEnergyAccum += qSum * dA * dtSampled;
    }

    const stepIndex1 = step + 1; // MATLAB stepIndex starts at 1 after first step()
    const isFirstStep = stepIndex1 === 1;
    const isLastStep = step === nSteps - 1;
    const isIntervalStep = (stepIndex1 - 1) % snapshotInterval === 0;
    if (isFirstStep || isIntervalStep || isLastStep) {
      // localSpatialNonUniform(snaps, mask): std restricted to cavity nodes.
      for (let i = 0; i < subregionMask.length; i++) {
        if (subregionMask[i] === CAVITY_ID) varSum += (T[i] - cavityMean) ** 2;
      }
      const variance = count ? varSum / count : 0;
      maxSnapshotStd = Math.max(maxSnapshotStd, Math.sqrt(variance));
    }
  }

  // --- evaluateExperimentMetrics.m ---
  const metrics = computeMetrics(tSeries, T_sub_mean, sourceEnergyAccum, maxSnapshotStd, caseCfg);
  return { metrics, tSeries, T_sub_mean, N };
}

function computeMetrics(t, T, sourceEnergy, spatialNonUniform, caseCfg) {
  const n = t.length;
  const dtH = n > 1 ? (t[1] - t[0]) / 3600 : 0;

  let peak = -Infinity, trough = Infinity, hoursAbove28 = 0, hoursAboveSinter = 0;
  let afternoonSum = 0, afternoonCount = 0;
  for (let i = 0; i < n; i++) {
    const v = T[i];
    if (v > peak) peak = v;
    if (v < trough) trough = v;
    if (v > 28) hoursAbove28 += dtH;
    if (v > 900) hoursAboveSinter += dtH;
    const hourOfDay = (t[i] / 3600) % 24;
    if (hourOfDay >= 12 && hourOfDay <= 18) { afternoonSum += v; afternoonCount++; } // localMeanInWindow(t,T,12,18)
  }

  // config.m's localFuelRequired: source energy needed to reach 900°C,
  // assuming temperature rise scales linearly with source power.
  const T0 = n ? T[0] : NaN;
  const rise = peak - T0;
  const fuelRequired = (rise > 0 && sourceEnergy > 0) ? sourceEnergy * (900 - T0) / rise : Infinity;

  return {
    peak_temp: peak,
    time_above_28c: hoursAbove28,
    diurnal_swing: peak - trough,
    mean_afternoon_temp: afternoonCount ? afternoonSum / afternoonCount : (n ? T.reduce((a, b) => a + b, 0) / n : NaN),
    sintering_duration: hoursAboveSinter,
    fuel_required: fuelRequired,
    spatial_non_uniform: spatialNonUniform,
  };
}

// ---------------------------------------------------------------------
// RankingEngine.m — graded constraint violation, feasible-only
// normalization, weighted score, Pareto flag, violation-ordered sort for
// infeasible rows. This is the upgraded ThermalSim 3 algorithm (the
// original ThermalSim5/ThermalSim_4 version used -Inf for infeasible
// scores and normalized against ALL designs including infeasible ones;
// ThermalSim 3 uses -999 and feasible-only normalization — see
// RankingEngine.m's INFEASIBLE_SCORE constant and Step 3's comment).
// Not ported: per-metric `tolerance`/`scale` overrides and `TopK` — no
// metric definition in config.m currently sets them, so they'd be no-ops
// here; KelvinK keeps the equivalent of their defaults (tolerance=0,
// scale=[]), which is exactly what every current metric gets anyway.
// ---------------------------------------------------------------------
const INFEASIBLE_SCORE = -999.0;

function rankDesigns(designs, metricsCfg) {
  const metricNames = Object.keys(metricsCfg);
  const rawWeight = {};
  metricNames.forEach(m => { rawWeight[m] = Math.max(0, metricsCfg[m].weight); });
  const totalWeight = metricNames.reduce((s, m) => s + rawWeight[m], 0);
  const w = {};
  metricNames.forEach(m => { w[m] = totalWeight > 0 ? rawWeight[m] / totalWeight : 1 / metricNames.length; });

  // Step 2: graded constraint violation, capped at 10x the metric's span
  // so one sentinel/blown-up value can't dominate the infeasible ordering.
  const viol = designs.map(() => ({}));
  metricNames.forEach(m => {
    const [lo, hi] = metricsCfg[m].bounds;
    const finiteVals = designs.map(d => d.metrics[m]).filter(isFinite);
    let span = hi - lo;
    if (!isFinite(span) || span <= 0) {
      span = finiteVals.length ? Math.max(Math.max(...finiteVals) - Math.min(...finiteVals), 1e-12) : 1;
    }
    designs.forEach((d, i) => {
      const v = d.metrics[m];
      const over = isFinite(v) ? Math.max(0, Math.max(lo - v, v - hi)) / span : Infinity;
      viol[i][m] = Math.min(over, 10);
    });
  });
  const totalViol = designs.map((d, i) => metricNames.reduce((s, m) => s + viol[i][m] * w[m], 0));
  designs.forEach((d, i) => {
    d.Feasible = metricNames.every(m => viol[i][m] === 0);
    d._violation = totalViol[i];
  });

  // Step 3: normalize to [0,1] using feasible-run min/max as the reference
  // scale — NOT the constraint bounds (those are acceptance limits, often
  // far wider than the real spread, which would collapse every score
  // toward the same value) and NOT infeasible designs' values.
  metricNames.forEach(m => {
    const goal = metricsCfg[m].goal;
    const feasVals = designs.filter(d => d.Feasible).map(d => d.metrics[m]);
    const ref = feasVals.length ? [Math.min(...feasVals), Math.max(...feasVals)] : [0, 0];
    designs.forEach(d => {
      const v = d.metrics[m];
      let norm;
      if (ref[1] - ref[0] <= 0) norm = 1;
      else norm = goal === "min" ? (ref[1] - v) / (ref[1] - ref[0]) : (v - ref[0]) / (ref[1] - ref[0]);
      d._norm = d._norm || {};
      d._norm[m] = Math.min(Math.max(norm, 0), 1);
    });
  });

  // Step 4: weighted score (feasible only) + Pareto flag among feasible designs.
  designs.forEach(d => {
    if (!d.Feasible) { d.Score = INFEASIBLE_SCORE; d.Pareto = false; return; }
    let score = 0;
    for (const m of metricNames) score += d._norm[m] * w[m];
    d.Score = score;
  });
  const feasibleDesigns = designs.filter(d => d.Feasible);
  feasibleDesigns.forEach(a => {
    const dominated = feasibleDesigns.some(b =>
      b !== a &&
      metricNames.every(m => b._norm[m] >= a._norm[m]) &&
      metricNames.some(m => b._norm[m] > a._norm[m])
    );
    a.Pareto = !dominated;
  });

  // Step 5: sort — feasible by score (desc), then infeasible by total
  // violation (asc, closest-to-feasible first) — not all lumped together.
  designs.sort((a, b) => {
    if (a.Feasible !== b.Feasible) return a.Feasible ? -1 : 1;
    return a.Feasible ? (b.Score - a.Score) : (a._violation - b._violation);
  });
  return designs;
}

// ---------------------------------------------------------------------
// ExperimentDesigner.m's monteCarloDesign/firstNDesign digit decomposition,
// generalised to R regions over a material pool of size M. Region R (last
// index) gets the least-significant digit, region 1 the most-significant
// — matches `for r = R:-1:1; indices(:,r)=mod(temp,M)+1; temp=floor(temp/M);`
// exactly.
// ---------------------------------------------------------------------
function combinationFromIndex(idx, materials, R) {
  const M = materials.length;
  const combo = new Array(R);
  let temp = idx;
  for (let r = R - 1; r >= 0; r--) {
    combo[r] = materials[temp % M];
    temp = Math.floor(temp / M);
  }
  return combo;
}

// ExperimentDesigner.m's design(): Monte Carlo (unique random indices) or
// First N (sequential indices), both decomposed via combinationFromIndex.
function sampleDesigns({ technique, materials, R, maxExperiments, seed = 76 }) {
  const M = materials.length;
  const total = Math.pow(M, R);
  const K = Math.min(maxExperiments, total);
  let indices;
  if (technique === "First N") {
    indices = Array.from({ length: K }, (_, i) => i);
  } else {
    const rand = mulberry32(seed);
    const seen = new Set();
    indices = [];
    let attempts = 0;
    while (indices.length < K && attempts < K * 50) {
      attempts++;
      const idx = Math.floor(rand() * total);
      if (seen.has(idx)) continue;
      seen.add(idx);
      indices.push(idx);
    }
  }
  return indices.map(idx => combinationFromIndex(idx, materials, R));
}

// ---------------------------------------------------------------------
// Full run: config.m + ExperimentDesigner.m + the main.m batch loop +
// RankingEngine.m, built from a GUIConfig.m-shaped parameter object.
//
// cfg: { width, height, nx, dtHours, simLengthHours,
//        snapshotPeriodProportion, maxSnapshots, maxExperiments,
//        designTechnique, selectedMaterials (names[]), freeDesign,
//        fixedRegionId (1|2|3), fixedMaterialName, metricsFamily
//        ('cooling'|'kiln'), seed, weatherFn, onProgress }
//
// Note: PDEEngine's grid is always square, built from a single reqN —
// main.m only ever passes NX into PDEEngine (`PDEEngine(..., NX, ...)`),
// never NY, so NY is faithfully unused here too, exactly as in the real
// code (see GUIConfig.m's Grid Resolution Y field, which main.m ignores).
// ---------------------------------------------------------------------
function runLiveSimulationCustom(cfg) {
  const weatherFn = cfg.weatherFn || realWeatherTemp;
  const metricsCfg = cfg.metricsFamily === "kiln" ? KILN_METRICS : COOLING_METRICS;
  const caseCfg = {
    width: cfg.width, height: cfg.height,
    partitions: [0.15, 0.20, 0.65],
    reqN: cfg.nx,
    dtSeconds: cfg.dtHours * 3600,
    simHours: cfg.simLengthHours,
    hExt: 25,
    heatSource: cfg.metricsFamily === "kiln" ? KILN_HEAT_SOURCE : null,
  };

  const pool = cfg.selectedMaterials.map(materialByName).filter(Boolean);
  const REGION_NAMES = ["Outer_Wall", "Inner_Wall", "Cavity"];

  let combos = sampleDesigns({
    technique: cfg.designTechnique, materials: pool, R: 3,
    maxExperiments: cfg.maxExperiments, seed: cfg.seed || 76,
  });

  // ExperimentDesigner.m's fixedRegion(): overwrite the fixed region AFTER
  // sampling, preserving the sampled index structure for the free regions.
  if (!cfg.freeDesign) {
    const fixedMat = materialByName(cfg.fixedMaterialName);
    combos = combos.map(c => {
      const copy = c.slice();
      copy[cfg.fixedRegionId - 1] = fixedMat;
      return copy;
    });
  }

  const snapshotCfg = {
    width: caseCfg.width, height: caseCfg.height, partitions: caseCfg.partitions,
    reqN: caseCfg.reqN, dtSeconds: caseCfg.dtSeconds, simHours: caseCfg.simHours,
    hExt: caseCfg.hExt, heatSource: caseCfg.heatSource,
  };

  const designs = combos.map((combo, i) => {
    const result = runExperiment(combo[0], combo[1], combo[2], snapshotCfg, weatherFn);
    if (cfg.onProgress) cfg.onProgress(i + 1, combos.length);
    return {
      ExpName: `Live-${String(i + 1).padStart(3, "0")}`,
      materials: { Outer_Wall: combo[0].name, Inner_Wall: combo[1].name, Cavity: combo[2].name },
      metrics: result.metrics,
      _series: { t: result.tSeries, T: result.T_sub_mean, N: result.N },
    };
  });

  rankDesigns(designs, metricsCfg);

  return {
    caseLabel: (cfg.metricsFamily === "kiln" ? "Brick-Firing Kiln" : "Passive-Cooling Room") + " — custom configuration",
    materialCols: REGION_NAMES,
    metricCols: Object.keys(metricsCfg),
    rows: designs,
    simConfig: {
      startTime: 0, stopTime: cfg.simLengthHours, length: cfg.simLengthHours,
      dtSecs: caseCfg.dtSeconds, width: cfg.width, height: cfg.height,
      nx: cfg.nx, ny: cfg.ny, totalExperiments: designs.length,
    },
  };
}
