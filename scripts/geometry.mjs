export function regionBounds(region) {
  const bounds = region.bounds ?? region.object?.bounds;
  if (bounds?.width > 0 && bounds?.height > 0) return {x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height};
  const boxes = [...region.shapes].map(s => s.bounds).filter(Boolean);
  if (!boxes.length) return {x: 0, y: 0, width: 100, height: 100};
  const x = Math.min(...boxes.map(b => b.x)), y = Math.min(...boxes.map(b => b.y));
  return {x, y, width: Math.max(...boxes.map(b => b.x + b.width)) - x, height: Math.max(...boxes.map(b => b.y + b.height)) - y};
}
export function regionCenter(region) { const b = regionBounds(region); return {x: b.x + b.width / 2, y: b.y + b.height / 2}; }
export function tokenCenter(token) { return token.getCenterPoint(token._source); }
export function distanceInInches(origin, destination, grid) {
  return Math.floor(Math.hypot(origin.x - destination.x, origin.y - destination.y) * grid.distance / grid.size + 1e-9);
}
export function placementDistance(region, token) {
  const origin = tokenCenter(token), anchor = region.shapes[0];
  return anchor ? distanceInInches(origin, anchor, region.parent.grid) : Infinity;
}
export function regionOutline(region, segments = 32) {
  // Native polygons include wall clipping, curved edges, rotation, and grid coverage.
  const tree = region.polygonTree;
  if (tree?.polygons) return tree.polygons.map(poly => poly.points);
  const paths = [];
  for (const s of region.shapes) {
    if (s.type === "polygon") { paths.push(Array.from(s.points)); continue; }
    const points = [];
    const rotation = (s.rotation ?? 0) * Math.PI / 180;
    const point = (x, y) => { points.push(s.x + x * Math.cos(rotation) - y * Math.sin(rotation), s.y + x * Math.sin(rotation) + y * Math.cos(rotation)); };
    if (s.type === "circle" || s.type === "ellipse") {
      for (let i = 0; i < segments; i++) { const angle = 2 * Math.PI * i / segments; point(Math.cos(angle) * (s.radius ?? s.radiusX), Math.sin(angle) * (s.radius ?? s.radiusY)); }
    } else if (s.type === "cone") {
      point(0, 0);
      for (let i = 0; i <= segments; i++) { const angle = (-s.angle / 2 + s.angle * i / segments) * Math.PI / 180; point(Math.cos(angle) * s.radius, Math.sin(angle) * s.radius); }
    } else if (s.type === "line") { point(0, -s.width / 2); point(s.length, -s.width / 2); point(s.length, s.width / 2); point(0, s.width / 2); }
    else if (s.type === "rectangle") { const x = -s.width * (s.anchorX ?? 0), y = -s.height * (s.anchorY ?? 0); point(x, y); point(x + s.width, y); point(x + s.width, y + s.height); point(x, y + s.height); }
    if (points.length >= 6) paths.push(points);
  }
  return paths;
}

function edgeClearance(point, outlines) {
  let clearance = Infinity;
  for (const points of outlines) {
    for (let i = 0; i < points.length; i += 2) {
      const j = (i + 2) % points.length;
      const ax = points[i], ay = points[i + 1];
      const dx = points[j] - ax, dy = points[j + 1] - ay;
      const projection = ((point.x - ax) * dx + (point.y - ay) * dy) / (dx * dx + dy * dy || 1);
      const t = Math.max(0, Math.min(1, projection));
      clearance = Math.min(clearance, Math.hypot(point.x - ax - t * dx, point.y - ay - t * dy));
    }
  }
  return clearance;
}

// Template Wizard's greedy footprint cover, using the native SWADE region boundary.
export function fittedLights(region, light) {
  const bounds = regionBounds(region);
  const outlines = regionOutline(region);
  if (!outlines.length) return [];
  const {size, distance} = region.parent.grid;
  const scale = distance / size;
  const config = light.config ?? {};
  const nominal = Math.max(config.dim ?? 0, config.bright ?? 0);
  const dim = nominal || distance * 1.5;
  const brightRatio = nominal ? Math.max(0, config.bright ?? 0) / nominal : 0.5;
  const shape = region.shapes.length === 1 ? region.shapes[0] : null;
  const ring = shape?.type === "ring" && shape.radius > shape.innerWidth;
  const extent = Math.max(bounds.width, bounds.height);
  const step = ring
    ? Math.max(Math.min(size / 6, (shape.innerWidth + shape.outerWidth) / 6, dim / scale), extent / 64)
    : Math.max(size / 2, extent / 32);
  const offset = ring ? step : step / 2;
  const candidates = [regionCenter(region)];
  for (let y = bounds.y + offset; y < bounds.y + bounds.height; y += step) {
    for (let x = bounds.x + offset; x < bounds.x + bounds.width; x += step) candidates.push({x, y});
  }
  const inside = candidates.filter(point => region.polygonTree.testPoint(point));
  const circles = inside.map(({x, y}) => ({x: Math.round(x), y: Math.round(y)}))
    .filter(point => region.polygonTree.testPoint(point))
    .map(point => {
      // Foundry stores light radii in hundredths. Round down to keep the light inside the footprint.
      const dimUnits = Math.floor(Math.min(dim, edgeClearance(point, outlines) * scale) * 100) / 100;
      return {...point, dim: dimUnits, radius: dimUnits / scale};
    }).filter(circle => circle.dim > 0);
  // Fit rings along the middle of the band so tiny lights at the edges don't use up the budget.
  const minRadius = ring ? Math.max(0, ...circles.map(circle => circle.radius)) * 0.6 : 0;
  const sources = circles.filter(circle => circle.radius >= minRadius);
  const samples = ring ? sources : inside;
  for (const circle of sources) {
    const coverageRadius = ring ? circle.radius * 0.8 : circle.radius;
    circle.coverage = samples.filter(point => (point.x - circle.x) ** 2 + (point.y - circle.y) ** 2 <= coverageRadius ** 2);
  }
  const uncovered = new Set(samples);
  const fitted = [];
  const budget = ring ? 48 : 20;
  while (uncovered.size && sources.length && fitted.length < budget) {
    let best, covered = [];
    for (const circle of sources) {
      const points = circle.coverage.filter(point => uncovered.has(point));
      if (points.length > covered.length || points.length === covered.length && circle.radius > (best?.radius ?? 0)) {
        best = circle;
        covered = points;
      }
    }
    if (!covered.length) break;
    fitted.push({x: best.x, y: best.y,
      config: {...config, dim: best.dim, bright: best.dim * brightRatio}});
    for (const point of covered) uncovered.delete(point);
    sources.splice(sources.indexOf(best), 1);
  }
  return fitted;
}

export function movementDestination(token, region, {mode, direction, distance}) {
  if (!distance) return null;
  const origin = tokenCenter(token);
  const center = regionCenter(region);
  const dx = origin.x - center.x, dy = origin.y - center.y;
  const separation = Math.hypot(dx, dy);
  const {size, distance: gridDistance, type} = region.parent.grid;
  let pixels = distance * size / gridDistance;
  let angle = direction * Math.PI / 180;
  if (mode !== "direction") {
    if (!separation) return null;
    if (mode === "toward") pixels = Math.min(pixels, separation);
    angle = Math.atan2(dy, dx) + (mode === "toward" ? Math.PI : 0);
  }
  const current = {x: token._source.x, y: token._source.y};
  const desired = {x: current.x + Math.cos(angle) * pixels, y: current.y + Math.sin(angle) * pixels};
  if (mode === "direction" || type === CONST.GRID_TYPES.GRIDLESS) return desired;

  // Check nearby snapped positions for one that still moves in the requested direction.
  const candidates = [];
  for (const x of [-size / 2, 0, size / 2]) {
    for (const y of [-size / 2, 0, size / 2]) {
      const position = token.getSnappedPosition({x: desired.x + x, y: desired.y + y});
      const moved = Math.hypot(position.x - current.x, position.y - current.y);
      if (!moved || moved > pixels + size / 2) continue;
      const after = Math.hypot(dx + position.x - current.x, dy + position.y - current.y);
      if (mode === "toward" ? after >= separation : after <= separation) continue;
      candidates.push(position);
    }
  }
  candidates.sort((a, b) => Math.hypot(a.x - desired.x, a.y - desired.y) - Math.hypot(b.x - desired.x, b.y - desired.y));
  const best = candidates[0];
  return best ? {x: best.x, y: best.y} : null;
}
