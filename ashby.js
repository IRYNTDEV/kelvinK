// Ashby pre-screening — ported from the Nov 19 ThermalSim's AshbyScreening.m.
// Stage 1 of the pipeline: before any 2D simulation runs, rank the material
// pool by a simple intrinsic-property index (Ashby, 2017) and keep the top
// N candidates. Pure property math — no PDE involved — so this is a direct,
// exact port, not an approximation.

const ASHBY_PRESETS = {
  cool_outer: {
    label: "Passive Cooling Outer Wall (1/α)",
    formula: "M = 1 / α = (ρ · cp) / k",
    objective: "MAXIMIZE thermal wave penetration delay",
    reference: "Ashby (2017) Case Study 6.17",
  },
  cool_inner: {
    label: "Passive Cooling Inner Wall (ρ·cp)",
    formula: "M = ρ · cp",
    objective: "MAXIMIZE volumetric thermal energy storage capacity",
    reference: "Ashby (2017) Case Study 6.19",
  },
  kiln_outer: {
    label: "Kiln Outer Envelope (1/√(k·ρ·cp))",
    formula: "M = 1 / √(k · ρ · cp)",
    objective: "MINIMIZE cumulative envelope heat loss per unit area",
    reference: "Ashby (2017) Case Study 6.18",
  },
  kiln_inner: {
    label: "Kiln Inner Refractory (√(k·ρ·cp))",
    formula: "M = √(k · ρ · cp)",
    objective: "MAXIMIZE heat storage and high-temperature thermal distribution",
    reference: "Ashby (2017) Case Study 6.18",
  },
  radiative_cost: {
    label: "Radiative Cost Efficiency (ε/cost)",
    formula: "PI = emissivity / relative_cost",
    objective: "MAXIMIZE thermal radiation per unit material cost",
    reference: "Thesis Eq 2.12",
  },
};

// AshbyScreening.m's computePerformanceIndex
function ashbyIndex(mat, presetKey) {
  if (mat.k <= 0 || mat.rho <= 0 || mat.cp <= 0) return -Infinity;
  const alpha = materialAlpha(mat);
  switch (presetKey) {
    case "cool_outer":
      return 1.0 / alpha;
    case "cool_inner":
      return mat.rho * mat.cp;
    case "kiln_outer": {
      const effusivity = Math.sqrt(mat.k * mat.rho * mat.cp);
      return 1.0 / effusivity;
    }
    case "kiln_inner":
      return Math.sqrt(mat.k * mat.rho * mat.cp);
    case "radiative_cost": {
      const e = materialEmissivity(mat);
      return mat.cost > 0 ? e / mat.cost : e / Number.EPSILON;
    }
    default:
      throw new Error(`Unknown Ashby preset: "${presetKey}"`);
  }
}

// AshbyScreening.m's satisfiesConstraints
function ashbySatisfiesConstraints(mat, constraints) {
  if (!constraints) return true;
  const { maxCost, minCost, maxK, minK, maxRho, minRho, family } = constraints;
  if (maxCost != null && mat.cost > maxCost) return false;
  if (minCost != null && mat.cost < minCost) return false;
  if (maxK != null && mat.k > maxK) return false;
  if (minK != null && mat.k < minK) return false;
  if (maxRho != null && mat.rho > maxRho) return false;
  if (minRho != null && mat.rho < minRho) return false;
  if (family && family.length && !family.includes(mat.family)) return false;
  return true;
}

// AshbyScreening.m's screenMaterials
function ashbyScreenMaterials(materials, presetKey, topN = Infinity, constraints = null) {
  const scored = [];
  for (const mat of materials) {
    if (!ashbySatisfiesConstraints(mat, constraints)) continue;
    const score = ashbyIndex(mat, presetKey);
    if (isFinite(score)) scored.push({ mat, score });
  }
  scored.sort((a, b) => b.score - a.score);
  const kept = isFinite(topN) ? scored.slice(0, topN) : scored;
  return {
    ranked: kept.map(s => s.mat),
    scores: kept.map(s => s.score),
  };
}

// AshbyScreening.m's generateAshbyChart — log-log scatter, one color per
// family, labeled points, optional guideline slope. Hand-drawn on canvas,
// same reasoning as the score chart: no external charting dependency.
function drawAshbyChart(canvas, materials, xProp, yProp, { highlightNames = [], guidelineSlope = null } = {}) {
  const cssWidth = canvas.parentElement.clientWidth;
  const cssHeight = 320;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = cssWidth * dpr;
  canvas.height = cssHeight * dpr;
  canvas.style.width = cssWidth + "px";
  canvas.style.height = cssHeight + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, cssWidth, cssHeight);
  if (!materials.length) return;

  const getVal = (m, prop) => (prop === "alpha" ? materialAlpha(m) : prop === "emissivity" ? materialEmissivity(m) : m[prop]);
  const xs = materials.map(m => getVal(m, xProp));
  const ys = materials.map(m => getVal(m, yProp));

  const style = getComputedStyle(document.documentElement);
  const dim = style.getPropertyValue("--text-dim").trim();
  const textColor = style.getPropertyValue("--text").trim();
  const accent = style.getPropertyValue("--accent").trim();

  const padLeft = 54, padBottom = 34, padTop = 12, padRight = 12;
  const plotW = cssWidth - padLeft - padRight;
  const plotH = cssHeight - padTop - padBottom;

  const logXs = xs.map(Math.log10), logYs = ys.map(Math.log10);
  const xMin = Math.min(...logXs), xMax = Math.max(...logXs);
  const yMin = Math.min(...logYs), yMax = Math.max(...logYs);
  const xPad = (xMax - xMin || 1) * 0.08, yPad = (yMax - yMin || 1) * 0.08;
  const xDomain = [xMin - xPad, xMax + xPad];
  const yDomain = [yMin - yPad, yMax + yPad];

  const toPx = (lx, ly) => [
    padLeft + ((lx - xDomain[0]) / (xDomain[1] - xDomain[0])) * plotW,
    padTop + plotH - ((ly - yDomain[0]) / (yDomain[1] - yDomain[0])) * plotH,
  ];

  // Log-scale gridlines + tick labels at each power of ten in range.
  ctx.font = "10px ui-monospace, monospace";
  ctx.strokeStyle = dim; ctx.fillStyle = dim;
  for (let p = Math.floor(xDomain[0]); p <= Math.ceil(xDomain[1]); p++) {
    const [px] = toPx(p, 0);
    if (px < padLeft || px > cssWidth - padRight) continue;
    ctx.globalAlpha = 0.15;
    ctx.beginPath(); ctx.moveTo(px, padTop); ctx.lineTo(px, padTop + plotH); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = "center";
    ctx.fillText("1e" + p, px, cssHeight - padBottom + 14);
  }
  for (let p = Math.floor(yDomain[0]); p <= Math.ceil(yDomain[1]); p++) {
    const [, py] = toPx(0, p);
    if (py < padTop || py > padTop + plotH) continue;
    ctx.globalAlpha = 0.15;
    ctx.beginPath(); ctx.moveTo(padLeft, py); ctx.lineTo(cssWidth - padRight, py); ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.textAlign = "right";
    ctx.fillText("1e" + p, padLeft - 6, py + 3);
  }

  // Optional slope guideline through the data's centroid.
  if (guidelineSlope != null) {
    const cx = (xMin + xMax) / 2, cy = (yMin + yMax) / 2;
    const [x1, y1] = toPx(xDomain[0], cy + guidelineSlope * (xDomain[0] - cx));
    const [x2, y2] = toPx(xDomain[1], cy + guidelineSlope * (xDomain[1] - cx));
    ctx.setLineDash([5, 4]);
    ctx.strokeStyle = dim; ctx.globalAlpha = 0.6; ctx.lineWidth = 1.3;
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.setLineDash([]); ctx.globalAlpha = 1;
  }

  // One color per family.
  const families = [...new Set(materials.map(m => m.family))];
  const palette = ["#3b5bfd", "#e0944c", "#35a169", "#d1495b", "#8e5cd9", "#c9971f",
                    "#4ba3c3", "#c25ca6", "#6b9b37", "#a85a2e", "#5a7fb8", "#b03a6f"];
  const colorFor = fam => palette[families.indexOf(fam) % palette.length];
  const highlightSet = new Set(highlightNames);

  materials.forEach((m, i) => {
    const [px, py] = toPx(logXs[i], logYs[i]);
    const isHighlighted = highlightSet.size === 0 || highlightSet.has(m.name);
    ctx.globalAlpha = isHighlighted ? 1 : 0.18;
    ctx.fillStyle = colorFor(m.family);
    ctx.beginPath();
    ctx.arc(px, py, isHighlighted && highlightSet.has(m.name) ? 5.5 : 4, 0, Math.PI * 2);
    ctx.fill();
    if (isHighlighted && highlightSet.has(m.name)) {
      ctx.strokeStyle = textColor; ctx.lineWidth = 1.2; ctx.stroke();
    }
  });
  ctx.globalAlpha = 1;

  // Label only the shortlisted/highlighted points, to keep 58 materials readable.
  ctx.font = "10px -apple-system, sans-serif";
  ctx.fillStyle = textColor;
  ctx.textAlign = "left";
  materials.forEach((m, i) => {
    if (!highlightSet.has(m.name)) return;
    const [px, py] = toPx(logXs[i], logYs[i]);
    ctx.fillText(m.name, px + 7, py + 3);
  });

  ctx.fillStyle = dim;
  ctx.font = "11px -apple-system, sans-serif";
  ctx.textAlign = "center";
  ctx.fillText(`${xProp} → (log scale)`, padLeft + plotW / 2, cssHeight - 4);
  ctx.save();
  ctx.translate(12, padTop + plotH / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText(`${yProp} → (log scale)`, 0, 0);
  ctx.restore();

  return { families, colorFor };
}
