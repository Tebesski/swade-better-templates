import {isBasicSwadePack} from "../../swade-better-setting/scripts/compendium-sources.mjs";
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
    await pack.configure({locked: false, ownership: {PLAYER: "OBSERVER", TRUSTED: "OBSERVER", ASSISTANT: "OWNER"}});
  }
  return pack;
}
const setting = () => game.modules.get("swade-better-setting").api;
const Dialog = foundry.applications.api.DialogV2;
const report = error => ui.notifications.error(error.message);
let writes = Promise.resolve();
function writeTemplate(operation) {
  const next = writes.then(async () => {
    if (!game.user.isGM) throw new Error("A GM must manage the Templates Compendium.");
    const pack = await templatesPack(true);
    if (pack.locked) throw new Error("Unlock the Better Templates compendium before editing.");
    return operation(pack);
  });
  writes = next.catch(() => {});
  return next;
}

async function storeTemplate(pack, name, {automation, img}) {
  const index = await pack.getIndex();
  const choice = await setting().resolveCompendiumName(name, index.map(item => ({id: item._id, name: item.name})), "template",
    {classes: ["sbt-library-dialog"]});
  if (!choice) return;
  name = choice.name;
  const data = {name, type: "gear", img: img || "icons/svg/aura.svg", flags: {[MODULE_ID]: {template: true}},
    system: {description: `Reusable template automation: ${name}`}};
  if (automation) {
    await trustAutomation(automation);
    data.flags[MODULE_ID].automation = clone(automation);
  }
  if (!choice.replace) return Item.create(data, {pack: pack.collection});
  const existing = await pack.getDocument(choice.replace.id);
  if (!automation) data.flags[MODULE_ID]["-=automation"] = null;
  return existing.update(data, {recursive: false});
}

function templateName(title, value, label) {
  return Dialog.prompt({classes: ["sbt-library-dialog"], window: {title}, rejectClose: false,
    content: `<label class="sbt-row"><span>Name</span><input name="name" value="${E(value)}" required></label>`,
    ok: {label, callback: (_event, button) => button.form.elements.name.value.trim()}});
}

export async function saveToCompendium(item) {
  const automation = readAutomation(item);
  const name = await templateName("Save to Templates Compendium", automation.label || item.name, "Save");
  if (!name) return;
  const result = await writeTemplate(pack => storeTemplate(pack, name, {automation, img: item.img}));
  if (result) ui.notifications.info(`Saved ${result.name} to Better Templates.`);
  return result;
}
export async function chooseCompendiumTemplate() {
  const packs = [...game.packs].filter(p => p.documentName === "Item" && p.visible && !isBasicSwadePack(p) && p.collection !== "world.better-setting-modifiers");
  const entries = [];
  for (const pack of packs) {
    const index = await pack.getIndex({fields: [`flags.${MODULE_ID}.automation`]});
    for (const item of index) if (item.flags?.[MODULE_ID]?.automation) entries.push({value: `Compendium.${pack.collection}.Item.${item._id}`, name: item.name, img: item.img, group: pack.title});
  }
  const selected = await pickFromCatalog("Import from Templates Compendium", entries);
  return selected ? fromUuid(selected.value) : null;
}
const libraryActions = {
  async editTemplate(item) {
    if (item.isOwner && !item.compendium?.locked) {
      const {openBuilder} = await import("./builder.mjs");
      openBuilder(item);
    } else item.sheet.render({force: true});
  },
  async placeTemplate(item) { await game.modules.get(MODULE_ID).api.placeTemplate(item); },
  async newTemplate() {
    const name = await templateName("New template", "", "Create");
    if (!name) return;
    const item = await writeTemplate(pack => storeTemplate(pack, name, {}));
    if (!item) return;
    await libraryActions.editTemplate(item);
    await this.render();
  },
  async removeTemplate(item) {
    if (!await Dialog.confirm({classes: ["sbt-library-dialog"], window: {title: "Remove template"}, rejectClose: false,
      content: `<p>Remove “${E(item.name)}” from the Templates Compendium?</p>`})) return;
    await writeTemplate(() => item.delete());
    await this.render();
  },
  async editIcon(item) {
    new CONFIG.ux.FilePicker({type: "image", current: item.img, callback: img => {
      void writeTemplate(() => item.update({img})).then(() => this.render()).catch(report);
    }}).render({force: true});
  }
};

export class TemplatesLibrary extends foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2) {
  static DEFAULT_OPTIONS = {classes: ["sbt-library"], window: {title: "Better Templates Compendium", icon: "fa-solid fa-book-open", resizable: true},
    position: {width: 500, height: 500}, actions: Object.fromEntries(Object.entries(libraryActions).map(([name, action]) => [name,
      async function (_event, target) {
        try {
          const uuid = target.closest("[data-uuid]")?.dataset.uuid;
          const item = uuid && await fromUuid(uuid);
          if (name === "newTemplate" || item) await action.call(this, item);
        } catch (error) { report(error); }
      }]))};
  static PARTS = {body: {template: `modules/${MODULE_ID}/templates/library.hbs`, scrollable: [".sbt-library-list"]}};
  async _prepareContext() {
    const pack = await templatesPack();
    const index = await pack?.getIndex({fields: [`flags.${MODULE_ID}.automation`, `flags.${MODULE_ID}.template`]});
    return {editable: game.user.isGM && !pack?.locked, search: this.element?.querySelector('[name="search"]')?.value ?? "",
      entries: index?.filter(item => item.flags?.[MODULE_ID]?.automation || item.flags?.[MODULE_ID]?.template)
        .map(item => ({name: item.name, img: item.img, uuid: `Compendium.${pack.collection}.Item.${item._id}`}))
        .sort((a, b) => a.name.localeCompare(b.name)) ?? []};
  }
  _onRender(context, options) {
    super._onRender(context, options);
    const input = this.element.querySelector('[name="search"]');
    const filter = () => {
      for (const row of this.element.querySelectorAll("[data-uuid]")) row.hidden = !row.dataset.name.toLowerCase().includes(input.value.trim().toLowerCase());
    };
    input.addEventListener("input", filter);
    filter();
  }
}
