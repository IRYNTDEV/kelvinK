// Real material properties, copied from the Nov 19 ThermalSim's
// data/thermal_materials_extended.csv (58 entries — up from the 38-entry
// database the previous ThermalSim 3 port used; 20 new entries added,
// mostly more Concrete/Masonry/Stone/Metal variants).
// k = W/mK, rho = kg/m^3, cp = J/kgK, cost = relative to steel.
const MATERIALS = [
  { name: "concrete_dense",          k: 1.4,   rho: 2300,  cp: 880,  cost: 0.25, family: "Concrete" },
  { name: "common_brick",            k: 0.72,  rho: 1920,  cp: 835,  cost: 0.2,  family: "Masonry" },
  { name: "softwood_pine",           k: 0.12,  rho: 510,   cp: 1380, cost: 0.4,  family: "Wood" },
  { name: "gypsum_board",            k: 0.17,  rho: 800,   cp: 1090, cost: 0.3,  family: "Plaster" },
  { name: "mineral_wool",            k: 0.04,  rho: 40,    cp: 840,  cost: 0.8,  family: "Insulation - Mineral" },
  { name: "mild_steel",              k: 50.0,  rho: 7850,  cp: 500,  cost: 1.0,  family: "Metal" },
  { name: "aluminium",               k: 237.0, rho: 2700,  cp: 900,  cost: 1.8,  family: "Metal" },
  { name: "expanded_polystyrene",    k: 0.035, rho: 20,    cp: 1400, cost: 0.6,  family: "Polymer" },
  { name: "cork",                    k: 0.04,  rho: 120,   cp: 1800, cost: 1.2,  family: "Insulation - Natural" },
  { name: "fireclay_brick",          k: 1.3,   rho: 2200,  cp: 960,  cost: 0.9,  family: "Masonry" },
  { name: "ceramic_fibre",           k: 0.1,   rho: 128,   cp: 1000, cost: 2.5,  family: "Insulation - Mineral" },
  { name: "marble",                  k: 2.8,   rho: 2700,  cp: 880,  cost: 1.5,  family: "Stone" },
  { name: "adobe",                   k: 0.52,  rho: 1600,  cp: 920,  cost: 0.08, family: "Earth" },
  { name: "bamboo",                  k: 0.17,  rho: 700,   cp: 1500, cost: 0.35, family: "Wood" },
  { name: "stucco",                  k: 0.72,  rho: 1858,  cp: 840,  cost: 0.4,  family: "Plaster" },
  { name: "float_glass",             k: 1.0,   rho: 2500,  cp: 750,  cost: 1.2,  family: "Glass" },
  { name: "copper",                  k: 385.0, rho: 8900,  cp: 385,  cost: 4.0,  family: "Metal" },
  { name: "granite",                 k: 3.0,   rho: 2700,  cp: 790,  cost: 1.5,  family: "Stone" },
  { name: "xps_insulation",          k: 0.033, rho: 35,    cp: 1400, cost: 1.2,  family: "Polymer" },
  { name: "pvc_rigid",               k: 0.17,  rho: 1380,  cp: 900,  cost: 1.5,  family: "Polymer" },
  { name: "cross_laminated_timber",  k: 0.13,  rho: 500,   cp: 1600, cost: 1.1,  family: "Wood" },
  { name: "aerogel_blanket",         k: 0.015, rho: 150,   cp: 840,  cost: 18.0, family: "Insulation - Advanced" },
  { name: "stainless_steel_316",     k: 16.0,  rho: 8000,  cp: 500,  cost: 3.5,  family: "Metal" },
  { name: "cast_iron",               k: 50.0,  rho: 7200,  cp: 460,  cost: 0.8,  family: "Metal" },
  { name: "zinc",                    k: 116.0, rho: 7135,  cp: 388,  cost: 2.5,  family: "Metal" },
  { name: "lead",                    k: 35.3,  rho: 11340, cp: 128,  cost: 2.8,  family: "Metal" },
  { name: "titanium",                k: 22.0,  rho: 4510,  cp: 520,  cost: 12.0, family: "Metal" },
  { name: "limestone",               k: 1.5,   rho: 2180,  cp: 910,  cost: 0.9,  family: "Stone" },
  { name: "sandstone",               k: 2.0,   rho: 2200,  cp: 710,  cost: 0.75, family: "Stone" },
  { name: "slate",                   k: 2.0,   rho: 2700,  cp: 760,  cost: 1.8,  family: "Stone" },
  { name: "aerated_concrete",        k: 0.18,  rho: 500,   cp: 1000, cost: 0.35, family: "Concrete" },
  { name: "polycarbonate",           k: 0.2,   rho: 1200,  cp: 1200, cost: 2.0,  family: "Polymer" },
  { name: "hdpe",                    k: 0.5,   rho: 955,   cp: 1800, cost: 1.0,  family: "Polymer" },
  { name: "polyurethane_foam",       k: 0.026, rho: 35,    cp: 1400, cost: 1.6,  family: "Polymer" },
  { name: "epoxy_resin",             k: 0.35,  rho: 1200,  cp: 1100, cost: 5.0,  family: "Polymer" },
  { name: "hardwood_oak",            k: 0.18,  rho: 720,   cp: 1630, cost: 1.2,  family: "Wood" },
  { name: "plywood",                 k: 0.13,  rho: 540,   cp: 1600, cost: 0.7,  family: "Wood" },
  { name: "mdf",                     k: 0.14,  rho: 750,   cp: 1700, cost: 0.5,  family: "Wood" },
  { name: "reinforced_concrete",             k: 2.3,  rho: 2400, cp: 1000, cost: 0.35, family: "Concrete" },
  { name: "lightweight_aggregate_concrete",  k: 0.7,  rho: 1400, cp: 1000, cost: 0.3,  family: "Concrete" },
  { name: "high_strength_concrete",          k: 1.8,  rho: 2450, cp: 880,  cost: 0.45, family: "Concrete" },
  { name: "engineering_brick",       k: 1.15, rho: 2300, cp: 840,  cost: 0.3,  family: "Masonry" },
  { name: "sand_lime_brick",         k: 1.1,  rho: 1900, cp: 920,  cost: 0.22, family: "Masonry" },
  { name: "clay_hollow_block",       k: 0.4,  rho: 800,  cp: 840,  cost: 0.3,  family: "Masonry" },
  { name: "terracotta_tile",         k: 0.9,  rho: 1800, cp: 840,  cost: 0.5,  family: "Masonry" },
  { name: "cement_mortar",           k: 1.0,  rho: 1800, cp: 1000, cost: 0.15, family: "Plaster" },
  { name: "rammed_earth",            k: 1.1,  rho: 1900, cp: 900,  cost: 0.1,  family: "Earth" },
  { name: "basalt",                  k: 2.0,  rho: 2900, cp: 840,  cost: 1.2,  family: "Stone" },
  { name: "quartzite",               k: 5.0,  rho: 2650, cp: 750,  cost: 1.6,  family: "Stone" },
  { name: "travertine",              k: 2.2,  rho: 2400, cp: 830,  cost: 1.4,  family: "Stone" },
  { name: "soapstone",               k: 6.4,  rho: 2980, cp: 980,  cost: 2.2,  family: "Stone" },
  { name: "brass",                   k: 120.0, rho: 8500, cp: 380,  cost: 3.2,  family: "Metal" },
  { name: "bronze",                  k: 60.0,  rho: 8800, cp: 380,  cost: 3.8,  family: "Metal" },
  { name: "stainless_steel_304",     k: 16.2,  rho: 8000, cp: 500,  cost: 3.0,  family: "Metal" },
  { name: "aluminium_6061",          k: 167.0, rho: 2700, cp: 896,  cost: 2.0,  family: "Metal" },
  { name: "weathering_steel",        k: 45.0,  rho: 7850, cp: 490,  cost: 1.3,  family: "Metal" },
  { name: "wrought_iron",            k: 59.0,  rho: 7750, cp: 450,  cost: 1.1,  family: "Metal" },
  { name: "magnesium_az31",          k: 96.0,  rho: 1770, cp: 1000, cost: 3.5,  family: "Metal" },
];

// emissivity/solar absorptivity (not used by the thermal solver, but used
// by Ashby's radiative_cost index) — same CSV, columns 6 and 7.
const EMISSIVITY_BY_NAME = {
  concrete_dense: 0.9, common_brick: 0.93, softwood_pine: 0.9, gypsum_board: 0.9,
  mineral_wool: 0.9, mild_steel: 0.8, aluminium: 0.1, expanded_polystyrene: 0.9,
  cork: 0.85, fireclay_brick: 0.85, ceramic_fibre: 0.8, marble: 0.9, adobe: 0.91,
  bamboo: 0.9, stucco: 0.9, float_glass: 0.84, copper: 0.65, granite: 0.88,
  xps_insulation: 0.9, pvc_rigid: 0.91, cross_laminated_timber: 0.9,
  aerogel_blanket: 0.85, stainless_steel_316: 0.28, cast_iron: 0.81, zinc: 0.45,
  lead: 0.35, titanium: 0.12, limestone: 0.9, sandstone: 0.9, slate: 0.85,
  aerated_concrete: 0.9, polycarbonate: 0.9, hdpe: 0.9, polyurethane_foam: 0.9,
  epoxy_resin: 0.85, hardwood_oak: 0.9, plywood: 0.9, mdf: 0.9,
  reinforced_concrete: 0.9, lightweight_aggregate_concrete: 0.9, high_strength_concrete: 0.9,
  engineering_brick: 0.93, sand_lime_brick: 0.9, clay_hollow_block: 0.92, terracotta_tile: 0.9,
  cement_mortar: 0.9, rammed_earth: 0.91, basalt: 0.9, quartzite: 0.9, travertine: 0.9,
  soapstone: 0.9, brass: 0.3, bronze: 0.35, stainless_steel_304: 0.28, aluminium_6061: 0.1,
  weathering_steel: 0.8, wrought_iron: 0.8, magnesium_az31: 0.1,
};

function materialByName(name) {
  return MATERIALS.find(m => m.name === name);
}

function materialFamilies() {
  return ["All", ...new Set(MATERIALS.map(m => m.family))];
}

function materialAlpha(m) {
  return m.k / (m.rho * m.cp);
}

function materialEmissivity(m) {
  return EMISSIVITY_BY_NAME[m.name] ?? 0.9;
}
