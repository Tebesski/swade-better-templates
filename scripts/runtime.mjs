import {MODULE_ID, EFFECTS_ID, BEHAVIOR_TYPE, CATALOG, clone, escapeHTML as E, splitList, normalizeName, movementTypes, normalizeAutomation, TIME_UNITS} from "./data.mjs";
import {effectsAPI, flagsMatch, resolveEffects} from "./integrations.mjs";
import {codeTrusted} from "./library.mjs";
import {movementDestination} from "./geometry.mjs";
import {expandTraitFormula, numericFormula, traitKey} from "./formulas.mjs";
import {applyCastDamageOptions, registerDamageChat} from "./damage-chat.mjs";

const queues = new Map();
const actorQueues = new Map();
const movingTokens = new Map();
const pendingEvents = new Map();
const sharedBehaviors = new Set(["rollDamage", "requestRoll", "chatMessage"]);
const messageMode = mode => ({publicroll: "public", gmroll: "gm", blindroll: "blind", selfroll: "self"})[mode] ?? mode;
export const isActiveGM = () => game.user.isGM && (!game.users.activeGM || game.users.activeGM.id === game.user.id);
export const automationBehavior = region => region?.behaviors.find(b => b.type === BEHAVIOR_TYPE);
export function runtimeAutomation(region) {
  const automation = automationBehavior(region)?.system.automation;
  if (automation?.behaviors.some(b => b.type === "choiceSet" || b.type === "addNote" || b.type === "restrict" && !Array.isArray(b.system.traits))) {
    return normalizeAutomation(automation);
  }
  return automation;
}
async function mutateEffects(actor, work) {
  const previous = actorQueues.get(actor.uuid) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(work);
  actorQueues.set(actor.uuid, next);
  try { return await next; } finally { if (actorQueues.get(actor.uuid) === next) actorQueues.delete(actor.uuid); }
}
export function registerBehaviorModel() {
  class BetterTemplatesBehavior extends foundry.data.regionBehaviors.RegionBehaviorType {
    static defineSchema() {
      const f = foundry.data.fields;
      return {events: this._createEventsField({initial: Object.values(CONST.REGION_EVENTS).filter(e => e.startsWith("token"))}), automation: new f.ObjectField(), itemUuid: new f.StringField(), placerTokenUuid: new f.StringField(), ownerId: new f.StringField()};
    }
    async _handleRegionEvent(event) {
      if (isActiveGM() && this.behavior.active) await dispatchRegionEvent(this.region, event);
    }
    static events = {
      [CONST.REGION_EVENTS.BEHAVIOR_DEACTIVATED]: async function () { if (isActiveGM()) await cleanupRegionEffects(this.region); },
      [CONST.REGION_EVENTS.BEHAVIOR_ACTIVATED]: async function () { if (isActiveGM()) await initializeInsideTokens(this.region); }
    };
  }
  CONFIG.RegionBehavior.dataModels[BEHAVIOR_TYPE] = BetterTemplatesBehavior;
  CONFIG.RegionBehavior.typeLabels[BEHAVIOR_TYPE] = "SWADE Better Templates";
  CONFIG.RegionBehavior.typeIcons ??= {}; CONFIG.RegionBehavior.typeIcons[BEHAVIOR_TYPE] = "fa-solid fa-wand-magic-sparkles";
}
export function buildBehaviorData(automation, {itemUuid = "", placerTokenUuid = "", ownerId = "", actor} = {}) {
  const enabled = automation.behaviors.filter(b => b.enabled);
  const data = [];
  if (enabled.some(b => !CATALOG.find(def => def.type === b.type)?.passive)) {
    data.push({name: "Better Templates Automation", type: BEHAVIOR_TYPE, system: {automation: clone(automation), itemUuid, placerTokenUuid, ownerId}});
  }
  for (const entry of enabled) {
    if (entry.type === "adjustDarkness") data.push({name: entry.label || "Adjust Darkness Level", type: "adjustDarknessLevel", system: {mode: entry.system.mode, modifier: numericFormula(entry.system.modifier, actor, {min: 0, max: 1, roundDown: false})}});
    if (entry.type === "difficultTerrain") {
      const multiplier = numericFormula(entry.system.multiplier, actor, {min: 0, max: 5, roundDown: false});
      const selected = entry.system.actions ?? [];
      const difficulties = Object.fromEntries(movementTypes().map(([key]) => [key, !selected.length || selected.includes(key) ? multiplier : 1]));
      data.push({name: entry.label || "Difficult Terrain", type: "modifyMovementCost", system: {difficulties}});
    }
  }
  return data;
}
export async function dispatchRegionEvent(region, event) {
  const token = event.data?.token?.document ?? event.data?.token;
  if (!isActiveGM() || !token?.actor || !automationBehavior(region)?.active) return;
  const forced = movingTokens.has(`${region.uuid}:${token.uuid}`);
  if (!runtimeAutomation(region)?.behaviors.some(b => b.enabled && sharedBehaviors.has(b.type) && b.triggers.includes(event.name))) {
    return queueEvent(region, token, event, forced);
  }
  const batchKey = `${region.uuid}:${event.name}:${event.user?.id ?? ""}`;
  let batch = pendingEvents.get(batchKey);
  if (!batch || batch.events.some(trigger => trigger.token.id === token.id)) {
    batch = {events: [], runs: new Map(), done: Promise.withResolvers()};
    pendingEvents.set(batchKey, batch);
    const group = batch;
    setTimeout(async () => {
      if (pendingEvents.get(batchKey) === group) pendingEvents.delete(batchKey);
      const result = await Promise.allSettled(group.events.map(trigger => queueEvent(region, trigger.token, trigger.event, trigger.forced, group)));
      group.done.resolve(result);
    }, 0);
  }
  batch.events.push({token, event, forced});
  return batch.done.promise;
}
async function queueEvent(region, token, event, forced, batch) {
  const key = `${region.uuid}:${token.id}`;
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.catch(() => {}).then(() => processEvent(region, token, event, forced, batch));
  queues.set(key, next);
  try { await next; } finally { if (queues.get(key) === next) queues.delete(key); }
}
async function processEvent(region, token, event, forced, batch) {
  if (!region.parent.regions.has(region.id)) return;
  const automation = runtimeAutomation(region);
  if (!automation?.enabled) return;
  for (const entry of automation.behaviors.filter(b => b.enabled && !CATALOG.find(d => d.type === b.type)?.passive)) {
    try {
      const lifecycle = entry.triggers.includes("whileWithin");
      if (event.name === "tokenExit" && (entry.type === "restrict" || entry.type === "addEffect" && entry.system.removeOnExit)) await removeManagedEffects(region, token.actor, entry.id, token.id);
      const triggered = entry.triggers.includes(event.name) || lifecycle && ["tokenEnter", "sbtInitialInside"].includes(event.name);
      if (!triggered || forced && entry.type === "move" || !targetMatches(entry, region, token)) continue;
      if (batch && sharedBehaviors.has(entry.type)) {
        if (batch.runs.has(entry.id)) { await batch.runs.get(entry.id).catch(() => {}); continue; }
        const targets = batch.events.map(trigger => trigger.token).filter(target => targetMatches(entry, region, target));
        const run = executeBehavior(entry, {region, token, event, targets});
        batch.runs.set(entry.id, run);
        await run;
      } else await executeBehavior(entry, {region, token, event});
    } catch (error) { console.error(`${MODULE_ID} | ${entry.type} in ${region.name}`, error); ui.notifications.error(`Better Templates · ${entry.label || entry.type}: ${error.message}`); }
  }
}
function targetMatches(entry, region, token) {
  if (!flagsMatch(token, entry.requiredFlags, entry.excludedFlags)) return false;
  const model = automationBehavior(region)?.system;
  const placer = model?.placerTokenUuid ? foundry.utils.fromUuidSync(model.placerTokenUuid) : null;
  if (entry.target === "placer") return placer?.uuid === token.uuid;
  if (entry.target === "all") return true;
  const sourceDisposition = placer?.disposition ?? 1;
  const ally = sourceDisposition === token.disposition;
  return entry.target === "allies" ? ally : !ally;
}
async function effectData(entry) {
  const effects = clone(entry.system.effects ?? []);
  if (entry.system.effectUuid) effects.push(...await resolveEffects(entry.system.effectUuid));
  return effects;
}
function restrictionDescription(data) {
  const traits = (data.restriction === "all" ? ["*"] : splitList(data.traits)).map(trait => {
    if (trait === "*") return "All traits";
    const name = game.i18n.localize(CONFIG.SWADE.attributes[trait]?.long ?? trait);
    return data.linkedAttributes?.includes(trait) ? `${name} (including all linked skills)` : name;
  });
  const flags = splitList(data.rollFlags);
  return [
    traits.length ? `<p><strong>Restricted traits</strong> ${E(traits.join(", "))}</p>` : "",
    flags.length ? `<p><strong>Restricted roll flags</strong> ${E(flags.join(", "))}</p>` : ""
  ].join("");
}
async function applyManagedEffects(region, token, entry, sources, sourceActor) {
  const actor = token.actor;
  return mutateEffects(actor, async () => {
    if (!region.parent.regions.has(region.id)) return;
    if (actor.effects.some(effect => effect.active && effect.getFlag(MODULE_ID, "regionUuid") === region.uuid && effect.getFlag(MODULE_ID, "behaviorId") === entry.id)) return;
    const combat = game.combats.find(c => c.scene?.id === region.parent.id && c.started) ?? null;
    const data = sources.map(effect => {
      const source = clone(effect);
      for (const key of ["_id", "_stats", "folder", "sort"]) delete source[key];
      source.transfer = false;
      source.disabled = false;
      source.origin = automationBehavior(region).system.itemUuid || null;
      source.start = CONFIG.ActiveEffect.documentClass.getEffectStart(combat);
      source.duration = {...source.duration, expired: false};
      if (entry.system.duration?.enabled) {
        const {amount, unit} = entry.system.duration;
        const units = Object.hasOwn(TIME_UNITS, unit) ? unit : "rounds";
        source.duration = {value: numericFormula(amount, sourceActor, {min: 1}), units, expiry: null, expired: false};
      }
      source.flags ??= {};
      source.flags[MODULE_ID] = {...source.flags[MODULE_ID], regionUuid: region.uuid, behaviorId: entry.id, tokenUuid: token.uuid, effectReference: entry.system.effectUuid ?? ""};
      if (entry.system.duration?.enabled && !entry.system.removeOnExit) source.flags[MODULE_ID].persistAfterRegion = true;
      if (entry.system.effectUuid && !entry.system.effectUuid.startsWith("status:")) source.flags[EFFECTS_ID] = {...source.flags[EFFECTS_ID], templateUuid: entry.system.effectUuid};
      return source;
    });
    if (data.length) {
      const created = await actor.createEmbeddedDocuments("ActiveEffect", data);
      if (!region.parent.regions.has(region.id)) await actor.deleteEmbeddedDocuments("ActiveEffect", created.filter(e => actor.effects.has(e.id)).map(e => e.id));
    }
  });
}
export async function removeManagedEffects(region, actor, behaviorId = null, leavingTokenId = null) {
  return mutateEffects(actor, async () => {
    // A linked actor remains affected while another of its tokens stays in the region.
    if (leavingTokenId && [...region.tokens].some(t => t.id !== leavingTokenId && t.actor?.uuid === actor.uuid)) return;
    const ids = actor.effects.filter(effect => effect.getFlag(MODULE_ID, "regionUuid") === region.uuid
      && (behaviorId ? effect.getFlag(MODULE_ID, "behaviorId") === behaviorId : !effect.getFlag(MODULE_ID, "persistAfterRegion"))).map(e => e.id);
    if (ids.length) await actor.deleteEmbeddedDocuments("ActiveEffect", ids);
  });
}
function effectActors() {
  const actors = new Map(game.actors.map(a => [a.uuid, a]));
  for (const scene of game.scenes) for (const token of scene.tokens) if (token.actor) actors.set(token.actor.uuid, token.actor);
  return actors.values();
}
export async function cleanupRegionEffects(region) {
  for (const actor of effectActors()) await removeManagedEffects(region, actor);
}
export async function cleanupRemovedNotes(region) {
  const behavior = automationBehavior(region);
  const automation = behavior?.system.automation;
  const removed = automation?.behaviors.filter(entry => entry.type === "addNote");
  if (!removed?.length) return;
  for (const actor of effectActors()) for (const entry of removed) await removeManagedEffects(region, actor, entry.id);
  await behavior.update({"system.automation.behaviors": automation.behaviors.filter(entry => entry.type !== "addNote")});
}
export async function initializeInsideTokens(region) {
  if (!runtimeAutomation(region)) return;
  for (const token of region.tokens) await dispatchRegionEvent(region, {name: "sbtInitialInside", data: {token}});
  for (const actor of new Set([...region.tokens].map(token => token.actor).filter(Boolean))) {
    const updates = actor.effects.contents.flatMap(effect => {
      const data = effect.flags[MODULE_ID];
      if (data?.regionUuid !== region.uuid || !["traits", "all"].includes(data.restriction) || effect._source.description) return [];
      const description = restrictionDescription(data);
      return description ? [{_id: effect.id, description}] : [];
    });
    if (updates.length) await actor.updateEmbeddedDocuments("ActiveEffect", updates);
  }
}
async function sendVisual(region, payload) {
  const users = game.users.filter(user => user.active);
  const data = {...payload, regionUuid: region.uuid, sceneId: region.parent.id};
  const results = await Promise.allSettled(users.map(async user => {
    if (user.id === game.user.id) return handleVisual(data, {user: game.user});
    let timer;
    try {
      return await Promise.race([user.query(`${MODULE_ID}.visual`, data, {timeout: 5000}), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("Visual recipient disconnected or did not respond.")), 5000); })]);
    } finally { clearTimeout(timer); }
  }));
  for (const result of results) if (result.status === "rejected") console.warn(`${MODULE_ID} | Visual delivery failed`, result.reason);
}
function recipientFor(token, requested = "owner") {
  if (requested === "gm") return game.user;
  return game.users.find(u => u.active && !u.isGM && token.actor.testUserPermission(u, "OWNER")) ?? game.user;
}
async function interactive(kind, entry, context) {
  const recipient = recipientFor(context.token, entry.system.recipient);
  const data = {kind, regionUuid: context.region.uuid, tokenUuid: context.token.uuid, entryId: entry.id};
  return recipient.id === game.user.id ? handleInteractive(data, {user: game.user}) : recipient.query(`${MODULE_ID}.interactive`, data, {timeout: 120000});
}
export async function executeBehavior(entry, context) {
  const {region, token, event} = context, actor = token.actor, s = entry.system;
  const model = automationBehavior(region)?.system;
  if (!model || !region.parent.regions.has(region.id)) return;
  const item = await fromUuid(model.itemUuid).catch(() => null);
  const placerUuid = model.placerTokenUuid;
  const placer = placerUuid ? await fromUuid(placerUuid).catch(() => null) : null;
  if (!region.parent.regions.has(region.id)) return;
  const sourceActor = item?.actor ?? placer?.actor ?? actor;
  if (entry.type === "addEffect") return applyManagedEffects(region, token, entry, await effectData(entry), sourceActor);
  if (entry.type === "removeEffect") {
    const reference = s.effect, status = reference.startsWith("status:") ? reference.slice(7) : reference;
    if (!reference.trim()) return;
    let sourceName = reference;
    if (reference.includes(".")) sourceName = (await fromUuid(reference).catch(() => null))?.name ?? reference;
    return mutateEffects(actor, async () => {
      const ids = actor.effects.filter(effect => effect.uuid === reference || effect.origin === reference
        || effect.getFlag(EFFECTS_ID, "templateUuid") === reference || effect.getFlag(MODULE_ID, "effectReference") === reference
        || effect.statuses.has(status) || normalizeName(effect.name) === normalizeName(sourceName) || effectsAPI()?.getFlags(effect)?.includes(reference)).map(e => e.id);
      if (ids.length) return actor.deleteEmbeddedDocuments("ActiveEffect", ids);
    });
  }
  if (entry.type === "restrict" && (s.traits.length || s.rollFlags.trim())) {
    const restriction = {restriction: "traits", traits: s.traits, linkedAttributes: s.linkedAttributes, rollFlags: splitList(s.rollFlags)};
    return applyManagedEffects(region, token, entry, [{
      name: s.label || "Restricted", description: restrictionDescription(restriction),
      img: "icons/svg/net.svg", type: "base", system: {changes: []}, flags: {[MODULE_ID]: restriction}
    }]);
  }
  if (entry.type === "requestRoll") {
    const api = effectsAPI();
    if (!api?.buildRollRequest || !api?.generateRollRequest) throw new Error("Enable the updated SWADE Better Effects module to post this roll request.");
    if (!s.request.trait) return;
    const request = api.buildRollRequest({...s.request, tn: numericFormula(s.request.tn, sourceActor)});
    return api.generateRollRequest(request);
  }
  if (entry.type === "rollDice" || entry.type === "rollDamage") {
    const DamageRoll = CONFIG.Dice.rolls.find(cls => cls.name === "DamageRoll") ?? Roll;
    const RollClass = entry.type === "rollDamage" ? DamageRoll : Roll;
    const targets = context.targets?.length ? context.targets : [token];
    const targetUuids = targets.map(target => target.uuid);
    const expanded = expandTraitFormula(s.formula, sourceActor, {roll: true});
    const formula = /[/.]/.test(expanded) ? `floor(${expanded})` : expanded;
    const roll = new RollClass(formula, {...sourceActor.getRollData(), actor: actor.getRollData(), placer: sourceActor.getRollData(), item: item?.getRollData?.() ?? {}});
    if (rollRestricted(sourceActor, null, {item, effectFlags: splitList(s.flags)}, entry.type === "rollDamage" ? "damage" : "dice")) return;
    const flags = {[MODULE_ID]: {regionUuid: region.uuid, targetTokenUuid: token.uuid, targetTokenUuids: targetUuids, behaviorId: entry.id}};
    if (entry.type === "rollDamage") {
      if (entry.damageAdjustments?.length) flags[MODULE_ID].damageAdjustments = entry.damageAdjustments;
      if (canvas.ready && canvas.scene.id === region.parent.id) canvas.tokens.setTargets(targets.map(target => target.id));
      roll.ap = numericFormula(s.ap, sourceActor, {min: 0});
      effectsAPI()?.tagRoll(roll, splitList(s.flags), {actor: sourceActor, item, token: placer, targetUuids});
      const damageContext = roll.options[EFFECTS_ID];
      if (damageContext) {
        damageContext.targetUuids = targetUuids;
        flags[EFFECTS_ID] = {context: damageContext};
      }
      flags.swade = {ap: roll.ap, targets: targets.map(target => ({name: target.name, uuid: target.uuid}))};
    }
    else if (effectsAPI()) flags[EFFECTS_ID] = {context: {version: 1, hasRoll: true, rollType: "dice", roll: splitList(s.flags), actorUuid: sourceActor.uuid, tokenUuid: placer?.uuid ?? token.uuid, itemUuid: item?.uuid ?? null}};
    await roll.evaluate();
    return roll.toMessage({speaker: ChatMessage.getSpeaker({actor: sourceActor, token: placer ?? token}), flavor: E(s.flavor || `${region.name} → ${targets.map(target => target.name).join(", ")}`), flags}, {messageMode: messageMode(s.rollMode)});
  }
  if (entry.type === "rollTrait") return interactive("trait", entry, context);
  if (entry.type === "scrollingText") return sendVisual(region, {kind: "scroll", tokenUuid: token.uuid, text: s.text, color: s.color, duration: numericFormula(s.duration, sourceActor, {min: 100})});
  if (entry.type === "playSound") return sendVisual(region, {kind: "sound", entryId: entry.id, path: s.path, volume: numericFormula(s.volume, sourceActor, {min: 0, max: 1, roundDown: false}), loop: s.loop});
  if (entry.type === "executeMacro" || entry.type === "executeScript") {
    if (!await codeTrusted(entry)) throw new Error("A GM must save this script or macro in the builder before it can run.");
    if (entry.type === "executeMacro") { const macro = await fromUuid(s.macroUuid); if (!macro || macro.documentName !== "Macro") throw new Error("Macro not found."); return macro.execute({token: token.object ?? token, actor, region, item, event, choice: context.choice}); }
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    return new AsyncFunction("token", "actor", "region", "item", "event", "choice", s.script)(token.object ?? token, actor, region, item, event, context.choice);
  }
  if (entry.type === "move") {
    const destination = movementDestination(token, region, {mode: s.mode, direction: s.mode === "direction" ? numericFormula(s.direction, sourceActor) : 0, distance: numericFormula(s.distance, sourceActor, {min: 0})});
    if (!destination) return;
    const key = `${region.uuid}:${token.uuid}`;
    const marker = {};
    movingTokens.set(key, marker);
    const release = () => { if (movingTokens.get(key) === marker) movingTokens.delete(key); };
    try {
      return await token.move(destination, {constrainOptions: {ignoreWalls: !s.walls, ignoreCost: true}});
    } finally { release(); }
  }
  if (entry.type === "chatMessage") {
    const content = await foundry.applications.ux.TextEditor.implementation.enrichHTML(s.text, {async: true, relativeTo: item});
    const data = {content, speaker: ChatMessage.getSpeaker({actor, token}), flags: {[MODULE_ID]: {regionUuid: region.uuid}}};
    return ChatMessage.create(data, {messageMode: messageMode(s.rollMode)});
  }
}
export async function handleInteractive(data, {user: sender}) {
  if (!sender?.isGM) throw new Error("Only a GM may request a region roll.");
  const region = await fromUuid(data.regionUuid), token = await fromUuid(data.tokenUuid);
  const entry = runtimeAutomation(region)?.behaviors.find(b => b.id === data.entryId && b.enabled);
  if (!entry || !token?.actor?.isOwner || token.parent.id !== region.parent.id) return null;
  const s = entry.system, actor = token.actor;
  if (data.kind !== "trait" || entry.type !== "rollTrait") return null;
  let trait = s.trait;
  if (trait.includes(".")) trait = (await fromUuid(trait).catch(() => null))?.name ?? trait;
  const attr = Object.entries(CONFIG.SWADE.attributes).find(([key, value]) => [key, game.i18n.localize(value.long)].some(name => normalizeName(name) === normalizeName(trait)))?.[0];
  const skill = actor.items.find(i => i.type === "skill" && [i.name, i.system.swid].some(name => normalizeName(name) === normalizeName(trait)));
  const model = automationBehavior(region).system;
  const item = await fromUuid(model.itemUuid).catch(() => null);
  const placer = model.placerTokenUuid ? await fromUuid(model.placerTokenUuid).catch(() => null) : null;
  const sourceActor = item?.actor ?? placer?.actor ?? actor;
  const tn = numericFormula(s.tn, sourceActor, {min: 1});
  const options = {suppressChat: !s.prompt, effectFlags: splitList(s.flags), additionalMods: [{label: region.name, value: numericFormula(s.modifier, sourceActor)}], flavour: `${region.name} · TN ${tn}`};
  let roll = attr ? await actor.rollAttribute(attr, options) : skill ? await actor.rollSkill(skill.id, options) : await actor.makeUnskilledAttempt(options);
  if (!roll) return null;
  if (!s.prompt) { await roll.evaluate(); await roll.toMessage({speaker: ChatMessage.getSpeaker({actor, token}), flavor: E(`${trait} · ${region.name} · TN ${tn}`)}, {messageMode: messageMode(s.rollMode)}); }
  const total = Number(roll.total ?? roll.roll?.total);
  return Number.isFinite(total) ? {total, success: total >= tn, raises: Math.max(0, Math.floor((total - tn) / 4))} : null;
}
const sounds = new Map();
export async function handleVisual(data, {user: sender}) {
  if (!sender?.isGM) return;
  if (data.kind === "stop") { for (const [key, sound] of sounds) if (key.startsWith(`${data.regionUuid}:`)) { await sound.stop(); sounds.delete(key); } return; }
  if (canvas.scene?.id !== data.sceneId) return;
  if (data.kind === "scroll") {
    const token = await fromUuid(data.tokenUuid);
    if (token?.object?.visible) {
      try { await canvas.interface.createScrollingText(token.object.center, data.text, {duration: data.duration, fill: data.color, fontSize: 28, stroke: "#000000", strokeThickness: 4}); }
      catch (error) { if (canvas.ready && canvas.scene?.id === data.sceneId) throw error; }
    }
  }
  if (data.kind === "sound" && data.path) { const key = `${data.regionUuid}:${data.entryId}`; await sounds.get(key)?.stop(); const sound = await foundry.audio.AudioHelper.play({src: data.path, volume: data.volume, loop: data.loop}, false); if (data.loop) sounds.set(key, sound); }
}
export const stopRegionSounds = region => {
  const behaviors = runtimeAutomation(region)?.behaviors ?? region.getFlag(MODULE_ID, "managed")?.resolvedAutomation?.behaviors ?? [];
  if (!behaviors.some(b => b.enabled && b.type === "playSound" && b.system.loop)) return Promise.resolve();
  return sendVisual(region, {kind: "stop"});
};
function rollRestricted(actor, trait, options, kind = "trait") {
  const effects = actor?.effects.filter(effect => effect.active && ["traits", "all"].includes(effect.getFlag(MODULE_ID, "restriction"))) ?? [];
  if (!effects.length) return false;
  const isAttribute = kind === "trait" && typeof trait === "string";
  const attribute = isAttribute ? trait : trait?.system?.attribute;
  const keys = isAttribute ? [traitKey(trait), traitKey(game.i18n.localize(CONFIG.SWADE.attributes[trait]?.long ?? trait))]
    : [traitKey(trait?.name), traitKey(trait?.system?.swid)].filter(Boolean);
  const api = effectsAPI();
  let flags;
  const blocked = effects.some(effect => {
    const data = effect.flags[MODULE_ID];
    if (kind === "trait") {
      if (data.restriction === "all" || splitList(data.traits).some(name => name === "*" || keys.includes(traitKey(name)))) return true;
      if (trait?.system && data.linkedAttributes?.includes(attribute)) return true;
    }
    if (!data.rollFlags?.length) return false;
    flags ??= new Set(api?.makeRollContext?.(actor, options.item, options.effectFlags ?? [], {
      kind, attribute, skill: isAttribute ? null : trait
    }).roll ?? [kind, ...keys, ...(options.effectFlags ?? [])].map(traitKey));
    return data.rollFlags.some(flag => flags.has(api?.normalizeFlag(flag) ?? traitKey(flag)));
  });
  if (blocked) ui.notifications.warn("This roll is restricted by a template region.");
  return blocked;
}

export function registerRuntimeHooks() {
  registerDamageChat();
  CONFIG.queries[`${MODULE_ID}.interactive`] = handleInteractive;
  CONFIG.queries[`${MODULE_ID}.visual`] = handleVisual;
  const restrictTrait = (actor, trait, _roll, _modifiers, options = {}) => {
    if (rollRestricted(actor, trait, options)) return false;
  };
  Hooks.on("swadePreRollAttribute", restrictTrait); Hooks.on("swadePreRollSkill", restrictTrait);
  Hooks.once("setup", () => {
    const prototype = CONFIG.Item.documentClass.prototype;
    const original = prototype.rollDamage;
    if (!original) return;
    prototype.rollDamage = async function (options = {}) {
      if (rollRestricted(this.actor, null, {...options, item: this}, "damage")) return null;
      return original.call(this, applyCastDamageOptions(this, options));
    };
  });
  Hooks.on("canvasTearDown", () => { for (const sound of sounds.values()) sound.stop(); sounds.clear(); });
}
