// Template Wizard's PIXI mask approach, using v14's native region polygons.
import {MODULE_ID} from "./data.mjs";
import {regionOutline} from "./geometry.mjs";

const masks = new Map();
let pending;
const dirtyTiles = new Set();
const dirtyRegions = new Set();
const retries = new Map();
let refreshScene = false;
let refreshRestricted = false;

const regionIdForTile = tile => tile.getFlag(MODULE_ID, "attachedRegionUuid")?.split(".").at(-1);
function cancelRetry(id) {
  clearTimeout(retries.get(id));
  retries.delete(id);
}
function clearMask(uuid) {
  const record = masks.get(uuid);
  if (!record) return;
  if (record.target?.mask === record.mask) record.target.mask = null;
  record.mask.parent?.removeChild(record.mask);
  record.mask.destroy({children: true});
  masks.delete(uuid);
}
function refreshMask(tile, attempt = 0) {
  cancelRetry(tile.uuid);
  if (canvas.scene?.id !== tile.parent.id || !tile.parent.tiles.has(tile.id)) return;
  const region = tile.parent.regions.get(regionIdForTile(tile));
  if (!region) { clearMask(tile.uuid); return; }
  const target = tile.object?.mesh ?? tile.object?.sprite;
  const parent = target?.parent;
  if (!parent || target.destroyed) {
    if (attempt < 8) retries.set(tile.uuid, setTimeout(() => refreshMask(tile, attempt + 1), 100));
    return;
  }
  clearMask(tile.uuid);
  const mask = new PIXI.Graphics();
  mask.eventMode = "none"; mask.renderable = false;
  for (const outline of regionOutline(region)) {
    const points = [];
    for (let i = 0; i < outline.length; i += 2) {
      const p = parent.toLocal(new PIXI.Point(outline[i], outline[i + 1]), canvas.stage);
      points.push(p.x, p.y);
    }
    if (points.length < 6) continue;
    mask.beginFill(0xffffff, 1); mask.drawPolygon(points); mask.endFill();
  }
  parent.addChild(mask); target.mask = mask;
  masks.set(tile.uuid, {mask, target});
}
function scheduleRefresh() {
  if (pending !== undefined) return;
  pending = setTimeout(() => {
    pending = undefined;
    const scene = canvas.scene;
    if (scene && (refreshScene || dirtyRegions.size || refreshRestricted)) {
      for (const tile of scene.tiles) {
        const id = regionIdForTile(tile);
        if (id && (refreshScene || dirtyRegions.has(id) || refreshRestricted && scene.regions.get(id)?.restriction.enabled)) dirtyTiles.add(tile.id);
      }
    }
    for (const id of dirtyTiles) {
      const tile = scene?.tiles.get(id);
      if (tile) refreshMask(tile);
    }
    dirtyTiles.clear();
    dirtyRegions.clear();
    refreshScene = refreshRestricted = false;
  }, 75);
}
export function registerTileMasks() {
  const onScene = doc => doc.parent.id === canvas.scene?.id;
  Hooks.on("canvasReady", () => { refreshScene = true; scheduleRefresh(); });
  const tileChanged = tile => {
    if (!onScene(tile) || !(regionIdForTile(tile) || masks.has(tile.uuid) || retries.has(tile.uuid))) return;
    dirtyTiles.add(tile.id);
    scheduleRefresh();
  };
  Hooks.on("createTile", tileChanged);
  Hooks.on("updateTile", tileChanged);
  Hooks.on("deleteTile", tile => {
    cancelRetry(tile.uuid);
    clearMask(tile.uuid);
  });
  const regionChanged = region => {
    if (!onScene(region)) return;
    dirtyRegions.add(region.id);
    scheduleRefresh();
  };
  Hooks.on("createRegion", regionChanged);
  Hooks.on("deleteRegion", regionChanged);
  Hooks.on("updateRegion", (region, changes) => {
    if (changes.shapes || changes.elevation || changes.levels || changes.restriction || changes._shapeConstraints) regionChanged(region);
  });
  for (const event of ["createWall", "updateWall", "deleteWall"]) Hooks.on(event, wall => {
    if (!onScene(wall)) return;
    refreshRestricted = true;
    scheduleRefresh();
  });
  Hooks.on("canvasTearDown", () => {
    clearTimeout(pending);
    pending = undefined;
    dirtyTiles.clear();
    dirtyRegions.clear();
    refreshScene = refreshRestricted = false;
    for (const uuid of retries.keys()) cancelRetry(uuid);
    for (const uuid of masks.keys()) clearMask(uuid);
  });
}
