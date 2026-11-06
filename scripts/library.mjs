import {MODULE_ID, PACK_ID, clone, configuredBehaviors, readAutomation, variantLists, escapeHTML as E} from "./data.mjs";
import {pickFromCatalog} from "./integrations.mjs";

export async function trustAutomation(automation) {
  if (!game.user.isGM) return;
  const old = game.settings.get(MODULE_ID, "trustedCode");
  const next = new Set(old);
  const enabledByChoice = new Set(variantLists(automation)
    .flatMap(option => (option.changes ?? []).filter(change => change.field === "enabled" && change.value === true).map(change => change.target)));
  for (const entry of configuredBehaviors(automation)) {
    if ((entry.enabled || enabledByChoice.has(entry.id)) && ["executeScript", "executeMacro"].includes(entry.type)) {
      next.add(await codeSignature(entry));
    }
  }
  if (next.size !== old.length) await game.settings.set(MODULE_ID, "trustedCode", [...next]);
}
async function codeSignature(entry) {
  if (entry.type === "executeMacro") {
    const macro = await fromUuid(entry.system.macroUuid).catch(() => null);
    if (macro?.documentName !== "Macro") throw new Error("Choose an existing macro before saving.");
    return JSON.stringify([entry.type, entry.system.macroUuid, macro.type, macro.command]);
  }
  return JSON.stringify([entry.type, entry.system]);
}
export async function codeTrusted(entry) { return game.settings.get(MODULE_ID, "trustedCode").includes(await codeSignature(entry)); }
export async function templatesPack(create = false) {
  let pack = game.packs.get(PACK_ID);
  if (!pack && create) {
    if (!game.user.isGM) throw new Error("A GM must create the Templates Compendium first.");
    pack = await foundry.documents.collections.CompendiumCollection.createCompendium({name: MODULE_ID, label: "Better Templates", type: "Item", package: "world", system: "swade"});
    await pack.configure({ownership: {PLAYER: "OBSERVER", TRUSTED: "OBSERVER", ASSISTANT: "OWNER"}});
  }
  return pack;
}
export async function saveToCompendium(item) {
  if (!game.user.isGM) throw new Error("A GM must save templates to the shared compendium.");
  const pack = await templatesPack(true);
  if (pack.locked) throw new Error("Unlock the Better Templates compendium before saving.");
  const name = await foundry.applications.api.DialogV2.prompt({window: {title: "Save to Templates Compendium"}, content: `<label class="sbt-row"><span>Name</span><input name="name" value="${E(readAutomation(item).label || item.name)}" required></label>`, ok: {label: "Save", callback: (_event, button) => button.form.elements.name.value.trim()}, rejectClose: false});
  if (!name) return;
  const automation = readAutomation(item);
  await trustAutomation(automation);
  const index = await pack.getIndex(), existing = index.getName(name);
  if (existing && !await foundry.applications.api.DialogV2.confirm({window: {title: "Replace template?"}, content: `<p>Replace ${E(name)} in the Templates Compendium?</p>`, rejectClose: false})) return;
  const data = {name, type: "gear", img: item.img || "icons/svg/aura.svg", flags: {[MODULE_ID]: {template: true, automation: clone(automation)}}, system: {description: `Reusable template automation: ${name}`}};
  const result = existing ? await (await pack.getDocument(existing._id)).update(data) : await Item.create(data, {pack: pack.collection});
  ui.notifications.info(`Saved ${name} to Better Templates.`);
  return result;
}
export async function chooseCompendiumTemplate() {
  const packs = [...game.packs].filter(p => p.documentName === "Item" && p.visible);
  const entries = [];
  for (const pack of packs) {
    const index = await pack.getIndex({fields: [`flags.${MODULE_ID}.automation`]});
    for (const item of index) if (item.flags?.[MODULE_ID]?.automation) entries.push({value: `Compendium.${pack.collection}.Item.${item._id}`, name: item.name, img: item.img, group: pack.title});
  }
  const selected = await pickFromCatalog("Import from Templates Compendium", entries);
  return selected ? fromUuid(selected.value) : null;
}
export class TemplatesLibrary extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {classes: ["sbt-library"], window: {title: "Better Templates Compendium", icon: "fa-solid fa-book-open", resizable: true}, position: {width: 500, height: 500}, actions: {
    editTemplate: async function (_event, target) { const item = await fromUuid(target.closest("[data-uuid]").dataset.uuid); const {openBuilder} = await import("./builder.mjs"); if (item.isOwner) openBuilder(item); else item.sheet.render({force: true}); },
    placeTemplate: async function (_event, target) { const item = await fromUuid(target.closest("[data-uuid]").dataset.uuid); await game.modules.get(MODULE_ID).api.placeTemplate(item); },
    newTemplate: async function () {
      if (!game.user.isGM) return ui.notifications.warn("A GM must create shared templates.");
      const pack = await templatesPack(true);
      const item = await Item.create({name: "New Template", type: "gear", img: "icons/svg/aura.svg", flags: {[MODULE_ID]: {template: true}}}, {pack: pack.collection});
      const {openBuilder} = await import("./builder.mjs"); openBuilder(item); this.render();
    }
  }};
  static PARTS = {body: {template: `modules/${MODULE_ID}/templates/library.hbs`, scrollable: [".sbt-library-list"]}};
  async _prepareContext() {
    const pack = await templatesPack();
    const index = await pack?.getIndex({fields: [`flags.${MODULE_ID}.automation`, `flags.${MODULE_ID}.template`]});
    return {entries: index?.filter(item => item.flags?.[MODULE_ID]?.automation || item.flags?.[MODULE_ID]?.template).map(item => ({name: item.name, img: item.img, uuid: `Compendium.${pack.collection}.Item.${item._id}`})).sort((a, b) => a.name.localeCompare(b.name)) ?? []};
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.element.querySelector('[name="search"]').addEventListener("input", event => {
      for (const row of this.element.querySelectorAll("[data-uuid]")) row.hidden = !row.textContent.toLowerCase().includes(event.target.value.toLowerCase());
    });
  }
}
