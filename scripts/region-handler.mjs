import {MODULE_ID, FLAG_SCOPE, SHAPES, readAutomation, clone, durationSeconds, combatExpiry, combatHasExpired, escapeHTML as E} from "./data.mjs";
import {automationBehavior, buildBehaviorData, cleanupRegionEffects, initializeInsideTokens, isActiveGM, runtimeAutomation, stopRegionSounds, dispatchRegionEvent} from "./runtime.mjs";
import {fittedLights, placementDistance, regionBounds, regionCenter, regionOutline} from "./geometry.mjs";
import {numericFormula} from "./formulas.mjs";
import {registerPlacementPreview, templateAppearance} from "./placement.mjs";
import {hasCastOptions, resolveCastOptions, templateShapeData} from "./variants.mjs";

const deleting = new Set(), initializing = new Set(), syncing = new Map();
const initializationDone = new Map();
const attempt = work => Promise.resolve().then(work).catch(error => { console.error(`${MODULE_ID} | Region automation`, error); ui.notifications.error(`Better Templates: ${error.message}`); });
export function sourceToken(item, scene, user = game.user) {
  const selected = canvas.scene?.id === scene.id ? canvas.tokens.controlled.find(t => t.document.testUserPermission(user, "OWNER") && (!item.actor || t.actor?.uuid === item.actor.uuid))?.document : null;
  if (selected) return selected;
  const contextual = item.actor?.token;
  if (contextual?.parent?.id === scene.id && contextual.testUserPermission(user, "OWNER")) return contextual;
  return item.actor ? scene.tokens.find(t => t.actor?.uuid === item.actor.uuid && t.testUserPermission(user, "OWNER")) : null;
}
export async function placeTemplate(itemOrUuid, shapeKey = null, {castContext, castChoices} = {}) {
  const item = typeof itemOrUuid === "string" ? await fromUuid(itemOrUuid) : itemOrUuid;
  if (!item || !item.testUserPermission(game.user, "LIMITED")) throw new Error("You cannot access this template item.");
  if (!canvas.ready || !canvas.scene) return ui.notifications.warn("View a scene before placing a template.");
  const automation = readAutomation(item);
  if (item.getFlag(MODULE_ID, "automation") && automation.enabled && !game.user.isGM && !game.users.activeGM) return ui.notifications.warn("An active GM is required for template automation.");
  const shapes = SHAPES.filter(shape => automation.shapes.includes(shape.key));
  if (!shapes.length) return ui.notifications.warn("Choose at least one shape in Better Templates.");
  let shape = shapes.find(shape => shape.key === shapeKey);
  if (!shape && shapes.length === 1) shape = shapes[0];
  const chooseCastShape = !shape && hasCastOptions(automation);
  if (chooseCastShape) shape = shapes[0];
  if (!shape) {
    const selected = await foundry.applications.api.DialogV2.wait({window: {title: automation.label || item.name}, content: "<p>Choose a template shape.</p>", buttons: shapes.map(s => ({action: s.key, label: s.label})), rejectClose: false});
    shape = shapes.find(s => s.key === selected);
  }
  if (!shape) return;
  if (shape.type === "ring" || chooseCastShape || (castContext || castChoices) && hasCastOptions(automation)) {
    return canvas.regions.placeRegion({
      name: shape.label, color: game.user.color, levels: [canvas.level.id], visibility: CONST.REGION_VISIBILITY.ALWAYS,
      shapes: [templateShapeData(shape, canvas.grid)],
      flags: {swade: {preset: shape.preset, origin: item.uuid}}
    }, {chooseCastShape, castContext, castChoices});
  }
  return game.swade.util.createRegionFromPreset(shape.preset, item);
}
function regionAutomation(automation, region, item, actor) {
  const selection = region.getFlag(MODULE_ID, "cast");
  if (!selection || !automation.enabled) return automation;
  const resolved = resolveCastOptions(automation, selection, {item, actor});
  const preset = SHAPES.find(shape => shape.preset === region.getFlag("swade", "preset"));
  if (!resolved.choices.baseShape || resolved.shapeKey !== preset?.key) {
    throw new Error("The selected cast options no longer match this power. Place its template again.");
  }
  return resolved.automation;
}
export async function applyRegionAutomation(region, item, userId = game.user.id) {
  if (!isActiveGM() || initializing.has(region.uuid) || region.getFlag(MODULE_ID, "managed")?.initialized || automationBehavior(region)) return;
  const saved = readAutomation(item);
  if (!saved.enabled) return;
  initializing.add(region.uuid);
  let finish;
  initializationDone.set(region.uuid, new Promise(resolve => { finish = resolve; }));
  try {
    const scene = region.parent, user = game.users.get(userId);
    if (!user || !item.testUserPermission(user, "LIMITED")) return;
    const pending = region.getFlag(MODULE_ID, "placement") ?? {};
    const token = scene.tokens.get(pending.tokenId);
    const validToken = token?.testUserPermission(user, "OWNER") && (!item.actor || token.actor?.uuid === item.actor.uuid);
    const placerToken = validToken ? token : sourceToken(item, scene, user);
    const actor = item.actor ?? placerToken?.actor;
    const automation = regionAutomation(saved, region, item, actor);
    if (automation.placementRange.enabled) {
      const max = numericFormula(automation.placementRange.max, actor, {min: 0});
      if (!placerToken || placementDistance(region, placerToken) > max) {
        throw new Error(`Place within ${max}″ of the placing token.`);
      }
    }
    const removeOnPlacement = automation.expiration.removeOnPlacement;
    if (automation.expiration.enabled && !automation.expiration.currentTurnEnd && !removeOnPlacement) {
      automation.expiration.amount = numericFormula(automation.expiration.amount, actor, {min: 1});
    }
    if (automation.wallRestriction.enabled) {
      automation.wallRestriction.priority = numericFormula(automation.wallRestriction.priority, actor, {min: 0});
    }
    for (const entry of automation.behaviors.filter(b => b.enabled && b.type === "attachWalls")) {
      entry.system.segments = numericFormula(entry.system.segments, actor, {min: 8, max: 128});
    }
    const combat = game.combats.find(c => c.scene?.id === scene.id && c.started);
    const schedule = combatExpiry(automation.expiration, combat);
    if (automation.expiration.enabled && automation.expiration.currentTurnEnd && !schedule && !removeOnPlacement) throw new Error("Current-turn expiration requires an active combat on this scene.");
    const placedAt = game.time.worldTime, seconds = durationSeconds(automation.expiration);
    const managed = {itemUuid: item.uuid, itemName: automation.label || item.name, ownerId: userId, placedAt, durationSeconds: seconds, expiresAt: seconds === null ? null : placedAt + seconds,
      combatExpiration: schedule, durationRounds: seconds === null ? null : Math.ceil(seconds / 6), hiddenFromPlayers: automation.advanced.hideFromPlayers, resolvedAutomation: automation, trackInTracker: !removeOnPlacement};
    const update = {name: managed.itemName, ...templateAppearance(automation, region.shapes), [`flags.${FLAG_SCOPE}.managed`]: managed};
    if (automation.wallRestriction.enabled) update.restriction = automation.wallRestriction;
    if (automation.advanced.enabled) Object.assign(update, {color: automation.advanced.color, visibility: automation.advanced.visibility, highlightMode: automation.advanced.highlightMode, displayMeasurements: automation.advanced.displayMeasurements});
    if (automation.wallRestriction.enabled && region.levels.size !== 1) update.levels = [placerToken?.level ?? scene.levels.contents[0]?.id].filter(Boolean);
    await region.update(update);
    const behaviors = buildBehaviorData(automation, {itemUuid: item.uuid, placerTokenUuid: placerToken?.uuid ?? "", ownerId: userId, actor});
    if (behaviors.length) await region.createEmbeddedDocuments("RegionBehavior", behaviors);
    await createAttachments(region, automation);
    await initializeInsideTokens(region);
    await Promise.all([...region.tokens].map(token => dispatchRegionEvent(region, {name: "onPlace", data: {token}})));
    if (removeOnPlacement) return await deleteManagedRegion(region.uuid, {skipInitialization: true});
    if (automation.attachable) {
      const recipient = user.active ? user : game.user;
      const tokenId = recipient.id === game.user.id ? await chooseAttachment({regionUuid: region.uuid}, {user: game.user}) : await recipient.query(`${MODULE_ID}.attach`, {regionUuid: region.uuid}, {timeout: 120000});
      if (tokenId && scene.tokens.has(tokenId) && scene.tokens.get(tokenId).testUserPermission(user, "OWNER")) await region.setFlag(MODULE_ID, "managed.attachedTokenId", tokenId);
    }
    await region.setFlag(MODULE_ID, "managed.initialized", true);
    Hooks.callAll(`${MODULE_ID}.regionReady`, region);
  } catch (error) {
    if (!region.parent.regions.has(region.id)) return;
    // Roll back partial initialization rather than leaving an apparently automated region.
    await deleteManagedRegion(region.uuid, {skipInitialization: true}).catch(() => {});
    throw error;
  } finally { initializing.delete(region.uuid); initializationDone.delete(region.uuid); finish(); }
}
function attachmentType(entry) { return {attachLight: ["AmbientLight", "lights"], attachSound: ["AmbientSound", "audio"], attachTile: ["Tile", "tiles"], attachWalls: ["Wall", "walls"]}[entry.type]; }
async function createAttachments(primary, automation) {
  const scene = primary.parent;
  const children = [];
  const owners = new Map();
  for (const entry of automation.behaviors.filter(b => b.enabled && attachmentType(b))) {
    const [documentName, category] = attachmentType(entry);
    let owner = primary;
    if (automation.separateRegions.enabled && automation.separateRegions[category]) {
      if (owners.has(category)) owner = owners.get(category);
      else {
        [owner] = await scene.createEmbeddedDocuments("Region", [{name: `${primary.name} · ${category}`, shapes: primary.shapes.map(s => s.toObject()), levels: [...primary.levels], elevation: clone(primary._source.elevation), color: primary.color, highlightMode: primary.highlightMode, visibility: CONST.REGION_VISIBILITY.GAMEMASTER, flags: {[MODULE_ID]: {managed: {trackInTracker: false, primaryRegionUuid: primary.uuid, itemName: primary.name, hiddenFromPlayers: automation.advanced.hideFromPlayers}}}}]);
        owners.set(category, owner); children.push(owner.uuid);
      }
    }
    const data = attachmentSources(primary, owner, entry);
    if (data.length) await scene.createEmbeddedDocuments(documentName, data);
  }
  if (children.length) await primary.update({[`flags.${MODULE_ID}.managed.contiguousGroupRegionUuids`]: [primary.uuid, ...children]});
}
function attachmentData(region, entry) {
  const b = regionBounds(region), center = regionCenter(region), s = entry.system;
  if (entry.type === "attachLight") return fittedLights(region, s.light).map(light => ({...clone(s.light), ...light}));
  if (entry.type === "attachSound") return s.sound.path ? [{...clone(s.sound), ...center}] : [];
  if (entry.type === "attachTile") return s.tile.texture?.src ? [{...clone(s.tile), ...b, texture: {...s.tile.texture, anchorX: 0, anchorY: 0}}] : [];
  if (entry.type === "attachWalls") {
    const data = [];
    for (const points of regionOutline(region, Math.max(8, Math.min(128, Number(s.segments) || 32)))) for (let i = 0; i < points.length; i += 2) {
      const j = (i + 2) % points.length;
      data.push({...clone(s.wall), c: [points[i], points[i + 1], points[j], points[j + 1]]});
    }
    return data;
  }
  return [];
}
function attachmentSources(primary, owner, entry) {
  const geometry = entry.type === "attachLight" && primary.restriction.enabled ? primary : owner;
  return attachmentData(geometry, entry).map(doc => ({
    ...doc,
    flags: {...doc.flags, [MODULE_ID]: {...doc.flags?.[MODULE_ID], attachedRegionUuid: owner.uuid, primaryRegionUuid: primary.uuid, behaviorId: entry.id}},
    ...(entry.type === "attachWalls" ? {} : {levels: [...owner.levels]})
  }));
}
export async function syncAttachments(region) {
  const managed = region.getFlag(MODULE_ID, "managed");
  if (!managed || deleting.has(region.uuid)) return;
  const primary = managed.primaryRegionUuid ? await fromUuid(managed.primaryRegionUuid) : region;
  const automation = primary?.getFlag(MODULE_ID, "managed")?.resolvedAutomation ?? runtimeAutomation(primary);
  if (!automation) return;
  if (region.uuid === primary.uuid) for (const uuid of managed.contiguousGroupRegionUuids ?? []) {
    if (uuid === primary.uuid) continue;
    const child = await fromUuid(uuid).catch(() => null);
    if (child) await child.update({shapes: region.shapes.map(s => s.toObject()), levels: [...region.levels], elevation: clone(region._source.elevation)});
  }
  for (const entry of automation.behaviors.filter(b => attachmentType(b) && b.enabled)) {
    const [name] = attachmentType(entry);
    const documents = region.parent.getEmbeddedCollection(name).filter(doc => doc.getFlag(MODULE_ID, "attachedRegionUuid") === region.uuid && doc.getFlag(MODULE_ID, "behaviorId") === entry.id);
    if (!documents.length) continue;
    const data = attachmentSources(primary, region, entry);
    if (data.length === documents.length) await region.parent.updateEmbeddedDocuments(name, documents.map((doc, index) => ({_id: doc.id, ...data[index]})));
    else {
      await region.parent.deleteEmbeddedDocuments(name, documents.map(d => d.id));
      if (data.length) await region.parent.createEmbeddedDocuments(name, data);
    }
  }
}
export async function deleteManagedRegion(uuid, {skipInitialization = false} = {}) {
  if (!game.user.isGM) return;
  if (!skipInitialization && initializationDone.has(uuid)) await initializationDone.get(uuid);
  const region = await fromUuid(uuid).catch(() => null);
  if (!region || deleting.has(uuid)) return;
  const managed = region.getFlag(MODULE_ID, "managed");
  if (managed?.primaryRegionUuid) return deleteManagedRegion(managed.primaryRegionUuid);
  deleting.add(uuid);
  try {
    await cleanupRegionEffects(region); await stopRegionSounds(region);
    for (const name of ["AmbientLight", "AmbientSound", "Tile", "Wall"]) {
      const ids = region.parent.getEmbeddedCollection(name).filter(d => d.getFlag(MODULE_ID, "primaryRegionUuid") === uuid || d.getFlag(MODULE_ID, "attachedRegionUuid") === uuid).map(d => d.id);
      if (ids.length) await region.parent.deleteEmbeddedDocuments(name, ids);
    }
    const children = (managed?.contiguousGroupRegionUuids ?? []).filter(id => id !== uuid).map(id => id.split(".").at(-1)).filter(id => region.parent.regions.has(id));
    if (children.length) await region.parent.deleteEmbeddedDocuments("Region", children);
    if (region.parent.regions.has(region.id)) await region.delete();
  } finally { deleting.delete(uuid); }
}
async function deletedRegionCleanup(region) {
  if (!isActiveGM() || deleting.has(region.uuid) || !region.getFlag(MODULE_ID, "managed")) return;
  if (initializationDone.has(region.uuid)) await initializationDone.get(region.uuid);
  const managed = region.getFlag(MODULE_ID, "managed");
  if (managed.primaryRegionUuid) return deleteManagedRegion(managed.primaryRegionUuid);
  // The document is already absent from the collection, so clean against its saved UUID.
  await cleanupRegionEffects(region); await stopRegionSounds(region);
  for (const name of ["AmbientLight", "AmbientSound", "Tile", "Wall"]) {
    const ids = region.parent.getEmbeddedCollection(name).filter(d => d.getFlag(MODULE_ID, "primaryRegionUuid") === region.uuid || d.getFlag(MODULE_ID, "attachedRegionUuid") === region.uuid).map(d => d.id);
    if (ids.length) await region.parent.deleteEmbeddedDocuments(name, ids);
  }
  deleting.add(region.uuid);
  try {
    const ids = (managed.contiguousGroupRegionUuids ?? []).map(uuid => uuid.split(".").at(-1)).filter(id => region.parent.regions.has(id));
    if (ids.length) await region.parent.deleteEmbeddedDocuments("Region", ids);
  } finally { deleting.delete(region.uuid); }
}
export async function sweepExpiration(combat = null) {
  if (!isActiveGM()) return;
  for (const scene of game.scenes) for (const region of [...scene.regions]) {
    const flag = region.getFlag(MODULE_ID, "managed");
    if (!flag || flag.trackInTracker === false) continue;
    const schedule = flag.combatExpiration;
    if (schedule && game.combats.get(schedule.combatId)?.started) {
      const active = game.combats.get(schedule.combatId);
      if (combatHasExpired(schedule, active)) { await deleteManagedRegion(region.uuid); continue; }
      const remaining = Math.max(0, schedule.round - active.round);
      if (remaining !== schedule.remainingRounds) await region.update({[`flags.${MODULE_ID}.managed.combatExpiration.remainingRounds`]: remaining});
    } else if (flag.expiresAt !== null && flag.expiresAt !== undefined && game.time.worldTime >= flag.expiresAt) await deleteManagedRegion(region.uuid);
  }
}
async function chooseAttachment(data, {user}) {
  if (!user.isGM) return null;
  const region = await fromUuid(data.regionUuid);
  if (!region) return null;
  const candidates = region.parent.tokens.filter(t => t.isOwner);
  return foundry.applications.api.DialogV2.prompt({window: {title: "Attach template to token"}, content: `<p>Select a token for ${E(region.name)} to follow.</p><select name="tokenId"><option value="">None</option>${candidates.map(t => `<option value="${t.id}">${E(t.name)}</option>`).join("")}</select>`, ok: {label: "Attach", callback: (_event, button) => button.form.elements.tokenId.value}, rejectClose: false});
}
export function registerRegionHooks() {
  Hooks.once("setup", () => registerPlacementPreview(sourceToken));
  CONFIG.queries[`${MODULE_ID}.attach`] = chooseAttachment;
  Hooks.on("preCreateRegion", (region, _data, _options, userId) => {
    if (region.getFlag(MODULE_ID, "scratch")) return;
    const origin = region.getFlag("swade", "origin");
    if (!origin && !region.getFlag("swade", "preset")) return;
    const item = origin ? foundry.utils.fromUuidSync(origin) : null;
    let automation;
    try { automation = item?.getFlag?.(MODULE_ID, "automation") ? regionAutomation(readAutomation(item), region) : null; }
    catch (error) { ui.notifications.warn(error.message); return false; }
    region.updateSource(templateAppearance(automation, region.shapes));
    if (!automation?.enabled) return;
    const shape = SHAPES.find(s => s.preset === region.getFlag("swade", "preset"));
    if (shape && !automation.shapes.includes(shape.key) && !region.getFlag(MODULE_ID, "cast")) { ui.notifications.warn("This shape is not enabled in Better Templates."); return false; }
    const selected = region.parent.tokens.get(region.getFlag(MODULE_ID, "placement")?.tokenId);
    const token = selected?.testUserPermission(game.user, "OWNER") && (!item.actor || selected.actor?.uuid === item.actor.uuid)
      ? selected : sourceToken(item, region.parent);
    if (automation.placementRange.enabled) {
      try {
        const max = numericFormula(automation.placementRange.max, item.actor ?? token?.actor, {min: 0});
        if (!token || placementDistance(region, token) > max) {
          ui.notifications.warn(`Place within ${max}″ of the placing token.`);
          return false;
        }
      } catch (error) { ui.notifications.warn(error.message); return false; }
    }
    region.updateSource({[`flags.${MODULE_ID}.placement`]: {tokenId: token?.id ?? null, userId}});
  });
  Hooks.on("createRegion", (region, _options, userId) => {
    const origin = region.getFlag("swade", "origin");
    if (!origin || !isActiveGM() || region.getFlag(MODULE_ID, "scratch")) return;
    attempt(async () => { const item = await fromUuid(origin); if (item?.getFlag(MODULE_ID, "automation")) await applyRegionAutomation(region, item, userId); });
  });
  Hooks.on("updateRegion", (region, changes) => {
    if (!isActiveGM() || !(changes.shapes || changes.levels || changes.elevation || changes.restriction)) return;
    const previous = syncing.get(region.uuid) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(() => syncAttachments(region)); syncing.set(region.uuid, next);
    next.catch(error => console.error(`${MODULE_ID} | Attachment sync`, error)).finally(() => { if (syncing.get(region.uuid) === next) syncing.delete(region.uuid); });
  });
  Hooks.on("deleteRegion", region => attempt(() => deletedRegionCleanup(region)));
  Hooks.on("deleteScene", scene => {
    if (!isActiveGM()) return;
    attempt(async () => { for (const region of scene.regions) if (region.getFlag(MODULE_ID, "managed")) { await cleanupRegionEffects(region); await stopRegionSounds(region); } });
  });
  Hooks.on("preUpdateToken", (token, changes, options) => { if (changes.x !== undefined || changes.y !== undefined) options.sbtOrigin = {x: token.x, y: token.y}; });
  Hooks.on("updateToken", (token, changes, options) => {
    if (!isActiveGM() || !options.sbtOrigin) return;
    const dx = token.x - options.sbtOrigin.x, dy = token.y - options.sbtOrigin.y;
    attempt(async () => { for (const region of token.parent.regions.filter(r => r.getFlag(MODULE_ID, "managed")?.attachedTokenId === token.id)) await region.update({shapes: region.shapes.map(s => ({...s.toObject(), x: s.x + dx, y: s.y + dy}))}); });
  });
  Hooks.on("deleteToken", token => { if (isActiveGM()) attempt(async () => { for (const region of token.parent.regions.filter(r => r.getFlag(MODULE_ID, "managed")?.attachedTokenId === token.id)) await deleteManagedRegion(region.uuid); }); });
  Hooks.on("updateWorldTime", () => attempt(() => sweepExpiration()));
  Hooks.on("updateCombat", combat => attempt(() => sweepExpiration(combat)));
  Hooks.on("deleteCombat", combat => { if (isActiveGM()) attempt(async () => { for (const scene of game.scenes) for (const region of scene.regions) { const flag = region.getFlag(MODULE_ID, "managed"); if (flag?.combatExpiration?.combatId !== combat.id) continue; if (flag.combatExpiration.currentTurnEnd) await deleteManagedRegion(region.uuid); else await region.update({[`flags.${MODULE_ID}.managed.combatExpiration`]: null, [`flags.${MODULE_ID}.managed.expiresAt`]: game.time.worldTime + flag.combatExpiration.remainingRounds * 6}); } }); });
}
