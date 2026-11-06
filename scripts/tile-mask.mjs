// Template Wizard's PIXI mask approach, using v14's native region polygons.
import {MODULE_ID} from "./data.mjs";
import {regionOutline} from "./geometry.mjs";

const masks = new Map();
let pending;
function clearMask(uuid) {
  const record = masks.get(uuid);
  if (!record) return;
  if (record.target?.mask === record.mask) record.target.mask = null;
  record.mask.parent?.removeChild(record.mask);
  record.mask.destroy({children: true});
  masks.delete(uuid);
}
function refreshMask(tile, attempt = 0) {
  const uuid = tile.getFlag(MODULE_ID, "attachedRegionUuid");
  if (!uuid || canvas.scene?.id !== tile.parent.id) return;
  const region = tile.parent.regions.get(uuid.split(".").at(-1));
  if (!region) { clearMask(tile.uuid); return; }
  const target = tile.object?.mesh ?? tile.object?.sprite;
  const parent = target?.parent;
  if (!parent || target.destroyed) {
    if (attempt < 8) setTimeout(() => refreshMask(tile, attempt + 1), 100);
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
function refreshAll() {
  clearTimeout(pending);
  pending = setTimeout(() => {
    const active = new Set();
    for (const tile of canvas.scene?.tiles ?? []) if (tile.getFlag(MODULE_ID, "attachedRegionUuid")) { active.add(tile.uuid); refreshMask(tile); }
    for (const uuid of masks.keys()) if (!active.has(uuid)) clearMask(uuid);
  }, 75);
}
export function registerTileMasks() {
  Hooks.on("canvasReady", refreshAll);
  for (const document of ["Tile", "Region", "Wall"]) for (const operation of ["create", "update", "delete"]) Hooks.on(`${operation}${document}`, refreshAll);
  Hooks.on("deleteTile", tile => clearMask(tile.uuid));
  Hooks.on("canvasTearDown", () => { clearTimeout(pending); for (const uuid of [...masks.keys()]) clearMask(uuid); });
}
