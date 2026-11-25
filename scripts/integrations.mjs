import {t as sbsI18n, a as sbsI18nAttribute} from "./i18n.mjs";
import {MODULE_ID, EFFECTS_ID, clone, escapeHTML as E, normalizeName, splitList} from "./data.mjs";
import {isBasicSwadePack} from "../../swade-better-setting/scripts/compendium-sources.mjs";

export const effectsAPI = () => game.modules.get(EFFECTS_ID)?.active ? game.modules.get(EFFECTS_ID).api : null;
const BASIC_FLAGS = ["placer", "agility", "smarts", "spirit", "strength", "vigor", "wildcard", "extra", "attack", "damage", "trait", "skill", "power"].sort();
export function flagCatalog() {
  const effects = effectsAPI();
  if (effects?.catalogFlags) return [...new Set(["placer", ...effects.catalogFlags()])].sort();
  if (!effects) return BASIC_FLAGS;
  return [...new Set([...BASIC_FLAGS, ...game.settings.get(EFFECTS_ID, "flagLibrary")])].sort();
}
export async function traitCatalog() {
  const result = new Map(Object.entries(CONFIG.SWADE.attributes).map(([key, attr]) => [key, {value: key, name: game.i18n.localize(attr.long), group: "Attributes", img: "icons/svg/dice-target.svg"}]));
  const add = (skill, group) => {
    const key = normalizeName(skill.name);
    if (!result.has(key)) result.set(key, {value: skill.name, name: skill.name, group, uuid: skill.uuid, img: skill.img});
  };
  for (const actor of game.actors) for (const skill of actor.items.filter(i => i.type === "skill")) add(skill, sbsI18n("swade-better-templates.UI.Worldskills_423706a40d"));
  for (const skill of game.items.filter(i => i.type === "skill")) add(skill, sbsI18n("swade-better-templates.UI.Worldskills_423706a40d"));
  const results = await Promise.allSettled([...game.packs].filter(p => p.documentName === "Item" && p.visible && !isBasicSwadePack(p)).map(async pack => {
    const index = await pack.getIndex({fields: ["type", "system.swid"]});
    for (const skill of index.filter(i => i.type === "skill")) add({...skill, uuid: `Compendium.${pack.collection}.Item.${skill._id}`}, pack.title);
  }));
  for (const result of results) if (result.status === "rejected") console.warn(`${MODULE_ID} | Could not index a skill pack`, result.reason);
  return [...result.values()].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}
export async function effectCatalog() {
  const shared = effectsAPI()?.effectCatalog;
  if (shared) return shared();
  const isDurationTracker = game.modules.get("swade-better-powers")?.api?.isDurationTracker;
  const entries = CONFIG.statusEffects.map(effect => ({value: `status:${effect.id}`, name: game.i18n.localize(effect.name ?? effect.label), img: effect.img ?? effect.icon, group: "SWADE conditions"}));
  const addItem = (item, group) => {
    if (item.getFlag?.(MODULE_ID, "scratch")) return;
    if (item.type === `${EFFECTS_ID}.effect`) entries.push({value: item.uuid, name: item.name, img: item.img, group});
    else for (const effect of item.effects ?? []) entries.push({value: effect.uuid, name: `${item.name} · ${effect.name}`, img: effect.img ?? item.img, group});
  };
  for (const item of game.items.filter(i => i.visible)) addItem(item, sbsI18n("swade-better-templates.UI.Worldeffects_edd9ce45af"));
  for (const actor of game.actors.filter(a => a.visible)) {
    for (const effect of actor.effects) {
      if (effect.getFlag(MODULE_ID, "regionUuid") || isDurationTracker?.(effect)) continue;
      entries.push({value: effect.uuid, name: effect.name, img: effect.img, group: `${actor.name} · Actor effects`});
    }
    for (const item of actor.items) addItem(item, `${actor.name} · Item effects`);
  }
  const results = await Promise.allSettled([...game.packs].filter(p => p.documentName === "Item" && p.visible && !isBasicSwadePack(p)).map(async pack => {
    const index = await pack.getIndex({fields: ["type", "effects"]});
    for (const item of index) {
      const uuid = `Compendium.${pack.collection}.Item.${item._id}`;
      if (item.type === `${EFFECTS_ID}.effect`) entries.push({value: uuid, name: item.name, img: item.img, group: pack.title});
      else if (Array.isArray(item.effects)) for (const effect of item.effects) entries.push({value: `${uuid}.ActiveEffect.${effect._id}`, name: `${item.name} · ${effect.name}`, img: effect.img ?? item.img, group: pack.title});
    }
  }));
  for (const result of results) if (result.status === "rejected") console.warn(`${MODULE_ID} | Could not index an effects pack`, result.reason);
  return [...new Map(entries.map(e => [e.value, e])).values()].sort((a, b) => a.group.localeCompare(b.group) || a.name.localeCompare(b.name));
}
export async function pickFromCatalog(title, entries, {multiple = false} = {}) {
  const content = `<div class="sbt-catalog"><input type="search" placeholder="${sbsI18nAttribute("swade-better-templates.UI.Search_7336265a04")}" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Search_49c266baaa")}"><div class="sbt-catalog-list">${entries.map((entry, index) => `<label class="sbt-catalog-entry" data-search="${E(`${entry.name} ${entry.group}`.toLowerCase())}"><input type="${multiple ? "checkbox" : "radio"}" name="entry" value="${index}"><img src="${E(entry.img || "icons/svg/aura.svg")}" alt=""><span>${E(entry.name)}<small>${E(entry.group)}</small></span></label>`).join("") || `<p class="sbt-hint">${sbsI18n("swade-better-templates.UI.Noaccessibleentriesfound_7cc24183ff")}</p>`}</div></div>`;
  return foundry.applications.api.DialogV2.prompt({window: {title, icon: "fa-solid fa-list"}, position: {width: 480}, classes: ["sbt-catalog-dialog"], content,
    render: (_event, dialog) => {
      dialog.element.querySelector('input[type="search"]').addEventListener("input", event => {
        const query = event.target.value.trim().toLowerCase();
        for (const row of dialog.element.querySelectorAll("[data-search]")) row.hidden = !row.dataset.search.includes(query);
      });
    }, ok: {label: sbsI18n("swade-better-templates.UI.Insert_8aa318eb7e"), callback: (_event, button) => {
      const selected = [...button.form.querySelectorAll('input[name="entry"]:checked')].map(input => entries[Number(input.value)]);
      return multiple ? selected : selected[0];
    }}, rejectClose: false});
}
export const pickEffect = () => effectsAPI()?.pickEffect?.() ?? effectCatalog().then(entries => pickFromCatalog(sbsI18n("swade-better-templates.UI.Chooseaneffect_2e51d20c1d"), entries));
export const pickTrait = () => traitCatalog().then(entries => pickFromCatalog(sbsI18n("swade-better-templates.UI.Chooseanattributeorskill_f942c3fb13"), entries));
export async function effectPreview(reference) {
  if (reference.startsWith("status:")) return CONFIG.statusEffects.find(e => e.id === reference.slice(7));
  if (reference.includes(".")) return fromUuid(reference).catch(() => null);
  return CONFIG.statusEffects.find(e => e.id === reference);
}

export function pickRestrictedTrait(onSelect, linkedAttributes) {
  const setting = game.modules.get("swade-better-setting");
  if (setting?.active && setting.api?.openTraitPicker) {
    return setting.api.openTraitPicker(onSelect, {includeLinkedSkills: true, linkedAttributes, classes: ["sbt-catalog-dialog"]});
  }
  return pickTrait().then(entry => entry && onSelect(entry.value, entry));
}
export async function resolveEffects(reference) {
  if (!reference) return [];
  if (reference.startsWith("status:")) {
    const status = CONFIG.statusEffects.find(e => e.id === reference.slice(7));
    if (!status) throw new Error(sbsI18n("swade-better-templates.UI.UnknownSWADEcondition_c5e3d1f86c", {p0: (reference)}));
    return [(await CONFIG.ActiveEffect.documentClass.fromStatusEffect(status.id)).toObject()];
  }
  const document = await fromUuid(reference);
  if (!document) throw new Error(sbsI18n("swade-better-templates.UI.Effectnotfound_a1d5304c53", {p0: (reference)}));
  if (document.documentName === "ActiveEffect") return [document.toObject()];
  if (document.documentName === "Item") return [...document.effects].map(effect => effect.toObject());
  throw new Error(sbsI18n("swade-better-templates.UI.ChooseanActiveEffectora_92b0a7169b"));
}
export async function editAegis(effects, name) {
  const api = effectsAPI();
  if (!api?.openAegis) { ui.notifications.warn(sbsI18n("swade-better-templates.UI.EnableSWADEBetterEffectstoconstruct_cd421e6ba2")); return null; }
  const scratch = await Item.create({name: name || sbsI18n("swade-better-templates.UI.TemplateEffect_be14000901"), type: "gear", img: "icons/svg/aura.svg", effects: clone(effects), flags: {[MODULE_ID]: {scratch: true}}, ownership: {[game.user.id]: 3}});
  if (!scratch) return null;
  let app;
  try { app = api.openAegis(scratch, scratch.effects.contents[0]); }
  catch (error) { await scratch.delete(); throw error; }
  if (!app) { await scratch.delete(); return null; }
  return new Promise(resolve => {
    const hook = Hooks.on("closeApplicationV2", async closed => {
      if (closed !== app) return;
      Hooks.off("closeApplicationV2", hook);
      const data = scratch.effects.map(effect => { const source = effect.toObject(); delete source._id; delete source._stats; return source; });
      try { await scratch.delete(); } finally { resolve(data); }
    });
  });
}
export async function editSceneObject(kind, source) {
  if (!canvas.scene) { ui.notifications.warn(sbsI18n("swade-better-templates.UI.Viewascenetoconfigurean_07972e2cc9")); return null; }
  const names = {light: sbsI18n("swade-better-templates.UI.AmbientLight_36fccd8a0f"), sound: sbsI18n("swade-better-templates.UI.AmbientSound_d3e5c36921"), tile: sbsI18n("swade-better-templates.UI.Tile_6ea3c1948e"), wall: sbsI18n("swade-better-templates.UI.Wall_f76ea921ed")};
  const documentName = names[kind];
  const data = clone(source);
  delete data._id; delete data._stats;
  Object.assign(data, {flags: {...data.flags, [MODULE_ID]: {scratch: true}}});
  if (kind === "wall") data.c = [-10000, -10000, -9900, -10000];
  else Object.assign(data, {x: -10000, y: -10000, hidden: true});
  if (kind === "tile") Object.assign(data, {width: 100, height: 100});
  const [scratch] = await canvas.scene.createEmbeddedDocuments(documentName, [data]);
  const app = scratch.sheet;
  return new Promise(resolve => {
    const hook = Hooks.on("closeApplicationV2", async closed => {
      if (closed !== app) return;
      Hooks.off("closeApplicationV2", hook);
      const saved = scratch.toObject();
      for (const key of ["_id", "_stats", "x", "y", "width", "height", "c", "hidden", "sort", "levels"]) delete saved[key];
      if (saved.flags) delete saved.flags[MODULE_ID];
      try { await scratch.delete(); } finally { resolve(saved); }
    });
    app.render({force: true});
  });
}
export function isPlacerActor(token, placer, actor = token?.actor) {
  const source = placer === token ? actor : placer?.actor ?? placer;
  return !!actor?.uuid && actor.uuid === source?.uuid;
}
function testTargetFlags(flags, required, excluded, placer) {
  const has = flag => flag === "placer" ? placer : flags.has(flag);
  return required.every(has) && !excluded.some(has);
}
export function matchesTargetFlags(values, required, excluded, placer = false) {
  return testTargetFlags(new Set(values), splitList(required), splitList(excluded), placer);
}
export function flagsMatch(token, required, excluded, placer = null, actor) {
  const requiredFlags = splitList(required), excludedFlags = splitList(excluded);
  if (!requiredFlags.length && !excludedFlags.length) return true;
  const isPlacer = !!placer && (requiredFlags.includes("placer") || excludedFlags.includes("placer")) && isPlacerActor(token, placer, actor);
  if (isPlacer ? excludedFlags.includes("placer") : requiredFlags.includes("placer")) return false;
  if (!requiredFlags.some(flag => flag !== "placer") && !excludedFlags.some(flag => flag !== "placer")) return true;
  const api = effectsAPI();
  actor ??= token.actor;
  const flags = new Set([...(api?.getFlags(actor, token) ?? actor?.getFlag(EFFECTS_ID, "tags") ?? []), ...(api?.getFlags(token) ?? [])]);
  return testTargetFlags(flags, requiredFlags, excludedFlags, isPlacer);
}
