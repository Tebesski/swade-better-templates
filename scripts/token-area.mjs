function footprint(token, data = {}) {
  const source = {...token._source, ...data};
  const size = token.getSize(source);
  return {x: source.x, y: source.y, width: size.width, height: size.height};
}

export function circleIntersectsFootprint(circle, box) {
  const x = Math.max(box.x, Math.min(circle.x, box.x + box.width));
  const y = Math.max(box.y, Math.min(circle.y, box.y + box.height));
  return (circle.x - x) ** 2 + (circle.y - y) ** 2 < circle.radius ** 2;
}

function smallBlastCircle(region) {
  if (region.getFlag("swade", "preset") !== "sbt") return null;
  const shapes = region.shapes;
  return shapes.length === 1 && shapes[0].type === "circle" ? shapes[0] : null;
}

function hasCenteredToken(region, circle) {
  return region.parent.tokens.some(candidate => {
    const center = candidate.getCenterPoint(candidate._source);
    return (center.x - circle.x) ** 2 + (center.y - circle.y) ** 2 < 0.75 ** 2;
  });
}

function footprintSamples(width, height) {
  return [0.75, width / 2, width - 0.75].flatMap(x => [0.75, height / 2, height - 0.75].map(y => ({x, y})));
}

export function centeredSmallBlastContains(token, region, data = {}) {
  const circle = smallBlastCircle(region);
  if (!circle) return false;
  const source = {...token._source, ...data};
  if (!region.includedInLevel(source.level)) return false;
  const head = source.elevation + source.depth * region.parent.grid.distance;
  const {bottom, top, topInclusive} = region.elevation;
  if (source.elevation > top || !topInclusive && source.elevation === top && source.elevation !== bottom
    || (source.depth === 0 ? head < bottom : head <= bottom)) return false;
  const size = token.getSize(source);
  const box = {x: source.x, y: source.y, width: size.width, height: size.height};
  if (!circleIntersectsFootprint(circle, box)) return false;
  if (!hasCenteredToken(region, circle)) return false;
  // Use the actual clipped polygon so walls still block coverage.
  const polygon = region.polygonTree;
  return footprintSamples(box.width, box.height).some(point => polygon.testPoint({x: box.x + point.x, y: box.y + point.y}, 0.75));
}

export function registerSmallBlastContainment() {
  const prototype = CONFIG.Token.documentClass.prototype;
  const original = prototype.testInsideRegion;
  prototype.testInsideRegion = function (region, data = {}) {
    return original.call(this, region, data) || centeredSmallBlastContains(this, region, data);
  };
  // Foundry uses a separate sample set for movement. Keep entry/exit events
  // consistent with footprint containment while retaining its level/teleport logic.
  const contexts = new WeakMap();
  const segmentizeToken = prototype.segmentizeRegionMovementPath;
  prototype.segmentizeRegionMovementPath = function (region, waypoints) {
    const circle = smallBlastCircle(region);
    if (!circle) return segmentizeToken.call(this, region, waypoints);
    const previous = contexts.get(region);
    contexts.set(region, {circle, centered: undefined});
    try { return segmentizeToken.call(this, region, waypoints); }
    finally { if (previous) contexts.set(region, previous); else contexts.delete(region); }
  };
  const regionPrototype = CONFIG.Region.documentClass.prototype;
  const segmentizeRegion = regionPrototype.segmentizeMovementPath;
  regionPrototype.segmentizeMovementPath = function (waypoints, samples, tolerance) {
    const context = contexts.get(this);
    if (context && samples.length === 1) {
      const pivot = samples[0];
      const [from, to] = waypoints;
      const box = {x: Math.min(from.x, to.x), y: Math.min(from.y, to.y),
        width: Math.abs(to.x - from.x) + pivot.x * 2, height: Math.abs(to.y - from.y) + pivot.y * 2};
      if (circleIntersectsFootprint(context.circle, box)) {
        context.centered ??= hasCenteredToken(this, context.circle);
        if (context.centered) samples = footprintSamples(pivot.x * 2, pivot.y * 2);
      }
    }
    return segmentizeRegion.call(this, waypoints, samples, tolerance);
  };
}

export function attachmentCandidate(region, token, user) {
  if (!token.actor || !user.isGM && (token.hidden || token.object?.visible === false)) return false;
  const source = token._source;
  if (!region.includedInLevel(source.level)) return false;
  if (token.testInsideRegion(region)) return true;
  const box = footprint(token);
  const step = region.parent.grid.size;
  const polygon = region.polygonTree;
  // Test the boundary of the footprint with one grid space of proximity.
  for (const x of [box.x, box.x + box.width / 2, box.x + box.width]) {
    for (const y of [box.y, box.y + box.height / 2, box.y + box.height]) {
      if (polygon.testPoint({x, y}, step)) return true;
    }
  }
  return false;
}
