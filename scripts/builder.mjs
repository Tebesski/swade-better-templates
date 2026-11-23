import {t as sbsI18n, a as sbsI18nAttribute} from "./i18n.mjs";
import {MODULE_ID, CATALOG, CAST_CATALOG, CAST_CHANGES, SHAPES, shapeTitle, TRIGGERS, TIME_UNITS, BEHAVIOR_TARGETS, clone, configuredBehaviors, defaultBehavior, defaultCostOption, escapeHTML as E, getPath, itemTemplatePath, movementTypes, setPath, readAutomation, normalizeAutomation, mergeModifierDraft, mergeRaiseDraft, exportAutomation, importAutomation, id, variantFields, variantOperations, variantLists} from "./data.mjs";
import {editAegis, editSceneObject, effectPreview, effectsAPI, flagCatalog, pickEffect, pickTrait, pickRestrictedTrait, traitCatalog} from "./integrations.mjs";
import {expandTraitFormula, formulaResult, numericFormula} from "./formulas.mjs";
import {saveToCompendium, chooseCompendiumTemplate, trustAutomation} from "./library.mjs";
import {sourceToken} from "./region-handler.mjs";
import {bindFlagSuggestions} from "../../swade-better-setting/scripts/flag-suggestions.mjs";

const Base = foundry.applications.api.HandlebarsApplicationMixin(foundry.applications.api.ApplicationV2);
const opened = new Map();
const options = (entries, selected) => entries.map(([key, label]) => `<option value="${E(key)}" ${String(key) === String(selected) ? "selected" : ""}>${E(label)}</option>`).join("");
const input = (path, value, type = sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), attrs = "") => `<input type="${type}" data-path="${E(path)}" ${type === "checkbox" ? value ? "checked" : "" : `value="${E(value)}"`} ${attrs}>`;
const check = (path, value, label, attrs = "") => `<label class="sbt-checkbox-label">${input(path, value, sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), attrs)}<span>${label}</span></label>`;
const formulaInput = (path, value, attrs) => `${input(path, value, sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.dataformulapreview_50982dfac8", {p0: (attrs)}))}<output class="sbt-formula-result" hidden></output>`;
const numberInput = (path, value, attrs = "") => formulaInput(path, value, `data-formula title="Number or formula such as @spirit/2" ${attrs}`);
const units = Object.keys(TIME_UNITS).map(unit => [unit, unit.charAt(0).toUpperCase() + unit.slice(1)]);
const row = (label, content) => `<div class="sbt-row"><span class="sbt-row-label">${label}</span>${content}</div>`;
const accordion = (key, title, content, open, attrs = "") => `<div class="sbt-section sbt-accordion ${open ? "" : "sbt-accordion-collapsed"}" data-accordion="${key}" ${attrs}><a class="sbt-accordion-header" data-action="accordion" aria-expanded="${open}"><i class="fa-solid fa-chevron-down sbt-accordion-chevron"></i><span class="sbt-accordion-title">${title}</span></a><div class="sbt-accordion-body">${content}</div></div>`;
const action = (name, icon, title, attrs = "") => `<a data-action="${name}" title="${E(title)}" aria-label="${E(title)}" ${attrs}><i class="fa-solid ${icon}"></i></a>`;

export function openBuilder(item, {modifierId} = {}) {
  if (!item?.isOwner) return ui.notifications.warn(sbsI18n("swade-better-templates.UI.Youneedownershiptoconfigurethis_650fe85e7d"));
  const existing = opened.get(item.uuid);
  if (existing) {
    if (existing.rendered) existing.capture();
    existing.accordions.clear();
    existing.openBehaviors.clear();
  }
  const app = existing ?? new BetterTemplatesBuilder(item);
  if (modifierId) {
    const index = app.draft.modifiers.findIndex(row => row.id === modifierId);
    app.accordions.add("modifiers");
    if (index >= 0) app.accordions.add(`modifiers.${index}`);
  }
  opened.set(item.uuid, app);
  app.render({force: true});
  if (existing) app.bringToFront();
  return app;
}
export function renderLibraryBehaviors(host, modifier, optionId, onSave) {
  const option = modifier.options.find(row => row.id === optionId);
  if (!option) return;
  new LibraryTemplateBehaviors(host, {...modifier, options: [option]}, onSave).render();
}

export function syncBuilderShapes(item) {
  const app = opened.get(item.uuid);
  if (!app?.rendered) return;
  const shapes = readAutomation(item).shapes;
  if (shapes.length === app.draft.shapes.length && shapes.every(shape => app.draft.shapes.includes(shape))) return;
  app.capture();
  app.draft.shapes = shapes;
  void app.render();
}
export function syncBuilderModifiers(item) {
  const app = opened.get(item.uuid);
  if (!app?.rendered || app.dirty) return;
  app.draft = readAutomation(item);
  app.savedModifiers = clone(app.draft.modifiers);
  app.savedRaises = clone(app.draft.raises);
  void app.render();
}
Hooks.on("controlToken", () => {
  for (const app of opened.values()) if (app.rendered && !app.item.actor) app.refreshFormulaPreviews();
});
export class BetterTemplatesBuilder extends Base {
  constructor(item) { super(); this.item = item; this.draft = readAutomation(item); this.savedModifiers = clone(this.draft.modifiers); this.savedRaises = clone(this.draft.raises); this.accordions = new Set(); this.openBehaviors = new Set(); this.dirty = false; }
  static DEFAULT_OPTIONS = {tag: "form", classes: ["sbt-builder"], position: {width: 680, height: 780}, window: {get title() { return sbsI18n("swade-better-templates.UI.BetterTemplates_65121bcf28"); }, icon: "fa-solid fa-wand-magic-sparkles", resizable: true},
    form: {closeOnSubmit: false, handler: async function () { await this.save(); }},
    actions: Object.fromEntries(["save", sbsI18n("swade-better-templates.UI.saveClose_50168fd54c"), "place", "export", "import", sbsI18n("swade-better-templates.UI.saveCompendium_9810208f98"), sbsI18n("swade-better-templates.UI.importCompendium_037d9a7fd8"), sbsI18n("swade-better-templates.UI.saveModifierToLibrary_a5bd901bc1"), "accordion", sbsI18n("swade-better-templates.UI.addBehavior_1e1a521a96"), sbsI18n("swade-better-templates.UI.collapseBehavior_609defe2fa"), sbsI18n("swade-better-templates.UI.deleteBehavior_0bc8af0d8b"), sbsI18n("swade-better-templates.UI.duplicateBehavior_9c8cc1bece"), sbsI18n("swade-better-templates.UI.moveUp_20556c93c6"), sbsI18n("swade-better-templates.UI.moveDown_c26d9d6362"), sbsI18n("swade-better-templates.UI.pickEffect_fae754cf29"), sbsI18n("swade-better-templates.UI.pickTrait_112673573b"), sbsI18n("swade-better-templates.UI.pickRestriction_d7e8df0b1b"), sbsI18n("swade-better-templates.UI.removeRestriction_f25ad6e509"), sbsI18n("swade-better-templates.UI.configureRequest_a6d4414cc4"), "aegis", sbsI18n("swade-better-templates.UI.deleteEffect_52f05a15a7"), sbsI18n("swade-better-templates.UI.editEffect_697e357d69"), "file", "configure", sbsI18n("swade-better-templates.UI.addVariant_8c7d33f3d2"), sbsI18n("swade-better-templates.UI.deleteVariant_177c3e6bb4"), sbsI18n("swade-better-templates.UI.deleteLegacyChange_376e6b4b46"), sbsI18n("swade-better-templates.UI.addModifierOption_b778584715"), sbsI18n("swade-better-templates.UI.deleteCostOption_69108ff609")].map(name => [name, async function (event, target) {
      try { await this.handleAction(name, event, target); } catch (error) { console.error(`${MODULE_ID} | Builder`, error); ui.notifications.error(error.message); }
    }]))};
  static PARTS = {body: {template: `modules/${MODULE_ID}/templates/builder.hbs`, scrollable: [""]}};
  get title() { return `Better Templates: ${this.item.name}${this.dirty ? " *" : ""}`; }
  get setting() { return game.modules.get("swade-better-setting")?.api; }
  get isLibraryEditor() { return false; }
  get formulaActor() { return this.item.actor ?? (canvas.ready ? sourceToken(this.item, canvas.scene)?.actor : null); }
  async _prepareContext() {
    return {content: this.renderContent()};
  }
  _onRender(context, options) {
    super._onRender(context, options);
    this.bindEditor(this.element.querySelector(".sbt-tab"));
  }
  bindEditor(body) {
    body.addEventListener("change", event => {
      if (!event.target.matches("[data-path], [data-shape], [data-trigger], [data-movement]")) return;
      try {
        this.capture(); this.dirty = true;
        if (event.target.hasAttribute("data-variant-name")) {
          const card = event.target.closest("[data-variant-index]");
          const [list, index] = card.dataset.accordion.split(".");
          const title = card.querySelector(".sbt-accordion-title");
          const handle = title.querySelector("[data-sbt-modifier-drag]");
          title.textContent = this.variantTitle(list, this.draft[list][index], Number(index));
          if (handle) title.prepend(handle, " ");
        }
        if (event.target.matches("[data-effect-reference]")) this.refreshEffectPreview(event.target);
        if (event.target.hasAttribute("data-variant-control")) {
          const change = getPath(this.draft, event.target.closest("[data-legacy-path]").dataset.legacyPath);
          const fields = variantFields(this.draft, change.target);
          if (event.target.dataset.variantControl === "target") change.field = "";
          change.operation = "set";
          change.value = fields.find(field => field.key === change.field)?.default ?? "";
          this.render();
        } else if (event.target.matches('[data-trigger][value="tokenTurnStart"], [data-trigger][value="tokenTurnEnd"], [data-shape], [data-path="expiration.enabled"], [data-path="expiration.currentTurnEnd"], [data-path="expiration.removeOnPlacement"], [data-path="advanced.enabled"], [data-path="separateRegions.enabled"], [data-path="wallRestriction.enabled"], [data-path="placementRange.enabled"], [data-path$=".duration.enabled"], [data-path^="raises."][data-path$=".mode"]')) this.render();
        else if (this.isLibraryEditor) this.persistChanges();
      } catch (error) { ui.notifications.error(error.message); }
    });
    body.addEventListener("input", event => {
      if (event.target.closest?.("[data-path]")) this.dirty = true;
      if (event.target.matches("[data-formula-preview]")) this.refreshFormulaPreview(event.target, this.formulaActor);
    });
    const canImportModifiers = !this.isLibraryEditor && this.item.type === "power";
    body.addEventListener("dragstart", event => {
      const handle = event.target.closest("[data-sbt-modifier-drag]");
      if (handle) this.setting.writeModifierDrag(event, "power", handle.dataset.sbtModifierDrag, this.item.uuid);
    });
    body.addEventListener("dragover", event => {
      if (canImportModifiers && this.setting.hasModifierDrag(event)) {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
      } else if (event.target.closest('[data-kind="uuid"], [data-kind="trait"], [data-kind="flags"]')) event.preventDefault();
    });
    body.addEventListener("drop", async event => {
      if (canImportModifiers && this.setting.hasModifierDrag(event)) {
        event.preventDefault();
        const drop = this.setting.readModifierDrag(event);
        if (drop?.source !== "library" || !drop.id) return;
        try {
          if (this.dirty) await this.save();
          await this.setting.applyLibraryModifier(this.item, drop.id);
        } catch (error) { ui.notifications.error(error.message); }
        return;
      }
      const target = event.target.closest('[data-kind="uuid"], [data-kind="trait"], [data-kind="flags"]');
      if (!target) return;
      event.preventDefault();
      try {
        const data = JSON.parse(event.dataTransfer.getData("text/plain"));
        if (!data.uuid) return;
        const doc = await fromUuid(data.uuid);
        target.value = target.dataset.kind === "trait" ? doc.name : target.dataset.kind === "flags" ? effectsAPI()?.getFlags(doc)?.join(", ") ?? doc.name : data.uuid;
        this.capture(); this.dirty = true;
        if (target.matches("[data-effect-reference]")) this.refreshEffectPreview(target);
        if (this.isLibraryEditor) this.persistChanges();
      } catch (error) { ui.notifications.warn(sbsI18n("swade-better-templates.UI.Couldnotinsertdroppeddocument_5f99a1b868", {p0: (error.message)})); }
    });
    for (const input of body.querySelectorAll('[data-kind="flags"]')) {
      bindFlagSuggestions(input, flagCatalog, {multiple: true, normalize: effectsAPI()?.normalizeFlag});
    }
    if (body.querySelector('[data-kind="trait"]')) this.updateTraitSuggestions();
    this.refreshFormulaPreviews();
    for (const el of body.querySelectorAll("[data-effect-reference]")) this.refreshEffectPreview(el);
  }
  refreshFormulaPreviews() {
    const actor = this.formulaActor;
    for (const input of this.element.querySelectorAll("[data-formula-preview]")) this.refreshFormulaPreview(input, actor);
  }
  refreshFormulaPreview(input, actor) {
    const output = input.nextElementSibling;
    output.value = formulaResult(input.value, actor, {roundDown: !input.hasAttribute("data-fractional")});
    output.hidden = !output.value;
  }
  async refreshEffectPreview(input) {
    const reference = input.value;
    const preview = input.parentElement.querySelector(".sbt-effect-preview");
    const effect = await effectPreview(reference);
    if (!input.isConnected || input.value !== reference) return;
    preview.hidden = !effect?.img && !effect?.icon;
    if (!preview.hidden) {
      preview.src = effect.img ?? effect.icon;
      preview.alt = game.i18n.localize(effect.name ?? effect.label ?? "");
      preview.title = preview.alt;
    }
  }
  updateTraitSuggestions() {
    if (this.traitOptions !== undefined) {
      const list = this.element?.querySelector(`#${this.id}-traits`);
      if (list) list.innerHTML = this.traitOptions;
      return;
    }
    this.traitRequest ??= traitCatalog().then(traits => {
      this.traitOptions = traits.map(trait => `<option value="${E(trait.value)}">${E(trait.name)}</option>`).join("");
      if (this.element?.isConnected) this.updateTraitSuggestions();
    }).catch(error => console.error(`${MODULE_ID} | Trait suggestions`, error))
      .finally(() => { this.traitRequest = null; });
  }
  capture() {
    for (const el of this.element.querySelectorAll("[data-path]")) {
      let value = el.type === "checkbox" ? el.checked : el.hasAttribute("data-duration-amount") ? el.valueAsNumber
        : el.dataset.numeric !== undefined || el.type === "number" ? Number(el.value) : el.value;
      if (el.dataset.formula !== undefined && value.trim() && Number.isFinite(Number(value))) value = Number(value);
      if (el.dataset.json !== undefined) { try { value = JSON.parse(value); } catch { throw new Error(sbsI18n("swade-better-templates.UI.EntervalidJSONintheconfiguration_13281a1884")); } }
      setPath(this.draft, el.dataset.path, value);
    }
    this.draft.shapes = [...this.element.querySelectorAll("[data-shape]:checked")].map(el => el.dataset.shape);
    for (const row of this.element.querySelectorAll("[data-behavior-path]")) {
      const entry = getPath(this.draft, row.dataset.behaviorPath);
      if (row.querySelector("[data-trigger]")) entry.triggers = [...row.querySelectorAll("[data-trigger]:checked")].map(el => el.value);
      if (entry.type === "difficultTerrain") entry.system.actions = [...row.querySelectorAll("[data-movement]:checked")].map(el => el.value);
    }
  }
  renderContent() {
    const a = this.draft;
    const expDisabled = !a.expiration.enabled || a.expiration.currentTurnEnd;
    const disabled = value => value ? "disabled" : "";
    const modifiers = this.renderVariants("modifiers", "Modifiers");
    const footer = `<footer class="sbt-builder-footer"><button type="button" data-action="place"><i class="fa-solid fa-location-crosshairs"></i> ${sbsI18n("swade-better-templates.UI.Placetemplate_6851e49d45")}</button><button type="button" data-action="save"><i class="fa-solid fa-floppy-disk"></i> ${sbsI18n("swade-better-templates.UI.Save_1509f561f2")}</button><button type="button" data-action="saveClose"><i class="fa-solid fa-check"></i> ${sbsI18n("swade-better-templates.UI.SaveClose_390dd9f696")}</button></footer>
      <datalist id="${this.id}-traits"></datalist>`;
    return `<section class="sbt-section">
      <div class="sbt-row sbt-row-actions"><a data-action="export"><i class="fa-solid fa-file-export"></i> ${sbsI18n("swade-better-templates.UI.Export_3664895579")}</a><a data-action="import"><i class="fa-solid fa-file-import"></i> ${sbsI18n("swade-better-templates.UI.Import_2cff9baabf")}</a></div>
      <div class="sbt-row sbt-row-actions"><a data-action="saveCompendium"><i class="fa-solid fa-bookmark"></i> ${sbsI18n("swade-better-templates.UI.SavetoTemplatesCompendium_430ab8ff18")}</a><a data-action="importCompendium"><i class="fa-solid fa-book-open"></i> ${sbsI18n("swade-better-templates.UI.ImportfromTemplatesCompendium_1a37d96cf9")}</a></div>
      <div class="sbt-row sbt-row-toggle">${check("enabled", a.enabled, sbsI18n("swade-better-templates.UI.Enableautomation_8e9e1f5050"))}</div>
      ${row("Label", input("label", a.label, sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.placeholder_33cdf3a055", {p0: (E(this.item.name))})))}
      <div class="sbt-row">${check("placementRange.enabled", a.placementRange.enabled, sbsI18n("swade-better-templates.UI.Maxplacementrange_4231d07e58"))}${numberInput("placementRange.max", a.placementRange.max, disabled(!a.placementRange.enabled))}</div>
      <div class="sbt-row sbt-shape-row"><span class="sbt-row-label">${sbsI18n("swade-better-templates.UI.Shape_e0e492707f")}</span><div class="sbt-shape-options">${SHAPES.map(shape => `<label class="sbt-checkbox-label"><input type="checkbox" data-shape="${shape.key}" ${a.shapes.includes(shape.key) ? "checked" : ""}><span>${shape.label}</span></label>`).join("")}</div></div>
      <div class="sbt-row">${check("selectTokensOnPlacement", a.selectTokensOnPlacement, "Select tokens on placement")}</div>
    </section>
    <fieldset class="sbt-section"><legend>${sbsI18n("swade-better-templates.UI.Expiration_f38d6e0e9b")}</legend><div class="sbt-row sbt-expiration-head">${a.expiration.removeOnPlacement ? "" : check("expiration.enabled", a.expiration.enabled, sbsI18n("swade-better-templates.UI.Regionexpires_d02bc130af")) + check("expiration.currentTurnEnd", a.expiration.currentTurnEnd, sbsI18n("swade-better-templates.UI.Oncurrentturnend_02a6db1579"), disabled(!a.expiration.enabled))}${check("expiration.removeOnPlacement", a.expiration.removeOnPlacement, sbsI18n("swade-better-templates.UI.Removeonplacement_81859429c8"))}</div>${a.expiration.removeOnPlacement ? "" : `<div class="sbt-row sbt-expiration ${expDisabled ? "sbt-disabled" : ""}">${numberInput("expiration.amount", a.expiration.amount, `aria-label="Duration" ${disabled(expDisabled)}`)}<select data-path="expiration.unit" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Durationtype_858c2765e5")}" ${disabled(expDisabled)}>${options(units, a.expiration.unit)}</select></div>`}</fieldset>
    ${this.renderAdvanced()}
    <fieldset class="sbt-section sbt-behaviors-section"><legend class="sbt-behaviors-legend">${sbsI18n("swade-better-templates.UI.RegionBehaviors_78b119e965")}</legend>${this.renderBehaviorList("behaviors")}</fieldset>
    ${this.renderVariants("raises", "Raised")}
    ${modifiers}${footer}`;
  }
  renderAdvanced() {
    const a = this.draft;
    const sub = (key, title, body) => accordion(key, title, body, this.accordions.has(key));
    return sub("advanced", "Advanced", `<div class="sbt-row">${check("attachable", a.attachable, sbsI18n("swade-better-templates.UI.Attachable_fe9534fe3e"))}</div><p class="sbt-hint">${sbsI18n("swade-better-templates.UI.Chooseatokentoattachthe_e5415c7c70")}</p><div class="sbt-row">${check("advanced.hideFromPlayers", a.advanced.hideFromPlayers, sbsI18n("swade-better-templates.UI.Hidefromplayersbydefault_06af0a6bd0"))}</div>
      ${sub("separate", sbsI18n("swade-better-templates.UI.Separateregions_88785d4530"), `<div class="sbt-row">${check("separateRegions.enabled", a.separateRegions.enabled, sbsI18n("swade-better-templates.UI.Separateregions_88785d4530"))}</div><p class="sbt-hint">${sbsI18n("swade-better-templates.UI.Keepattachedmediaonindependentregions_cd28522aff")}</p><div class="sbt-separate-options">${["audio", "tiles", "lights", "walls"].map(key => check(`separateRegions.${key}`, a.separateRegions[key], sbsI18n("swade-better-templates.UI.Attached_dd0fd1acce", {p0: (key)}), a.separateRegions.enabled ? "" : "disabled")).join("")}</div>`)}
      ${sub("walls", sbsI18n("swade-better-templates.UI.Wallrestriction_bd8637864b"), `<div class="sbt-row">${check("wallRestriction.enabled", a.wallRestriction.enabled, sbsI18n("swade-better-templates.UI.Restrictregionbywalls_1ddb6bee62"))}</div>${row("Restriction", `<select data-path="wallRestriction.type">${options(["move", "sight", "light", "sound", "darkness"].map(key => [key, key.charAt(0).toUpperCase() + key.slice(1)]), a.wallRestriction.type)}</select>`)}${row("Priority", numberInput("wallRestriction.priority", a.wallRestriction.priority))}`)}
      ${sub("appearance", "Region’s appearance", `<div class="sbt-row">${check("advanced.enabled", a.advanced.enabled, sbsI18n("swade-better-templates.UI.Overrideregionappearance_88e0cbe93c"))}</div><div class="sbt-row">${check("advanced.gridBased", a.advanced.gridBased, sbsI18n("swade-better-templates.UI.GridBased_d4d3841bcb"))}</div>${a.advanced.enabled ? row("Color", input("advanced.color", a.advanced.color, sbsI18n("swade-better-templates.UI.color_74284d9dcb"))) + row("Visibility", `<select data-path="advanced.visibility" data-numeric>${options([[0, sbsI18n("swade-better-templates.UI.Regionlayer_485b3dc127")], [4, sbsI18n("swade-better-templates.UI.Regionlayerwhenunlocked_284ec45f8f")], [1, "GM only"], [3, sbsI18n("swade-better-templates.UI.Observers_46a26d5534")], [2, sbsI18n("swade-better-templates.UI.Alwaysvisible_bc42910f32")]], a.advanced.visibility)}</select>`) + row("Highlight", `<select data-path="advanced.highlightMode">${options([["shapes", sbsI18n("swade-better-templates.UI.Trueshapes_9e3815ca68")], ["coverage", sbsI18n("swade-better-templates.UI.Coveredgridspaces_fac4c9d456")]], a.advanced.highlightMode)}</select>`) + check("advanced.displayMeasurements", a.advanced.displayMeasurements, sbsI18n("swade-better-templates.UI.Displaymeasurements_c7fe5728e3")) : ""}`)}`);
  }
  behaviorTargets(includeRaised = false) {
    const targets = this.draft.behaviors.map((behavior, index) => [behavior.id, `${index + 1}. ${behavior.label || CATALOG.find(def => def.type === behavior.type).label}`]);
    if (includeRaised) for (const raise of this.draft.raises) {
      for (const [index, behavior] of raise.changes.entries()) {
        const definition = CATALOG.find(def => def.type === behavior.type);
        if (definition) targets.push([behavior.id, `Raised ${raise.level} · ${index + 1}. ${behavior.label || definition.label}`]);
      }
    }
    return targets;
  }
  renderBehaviorList(path, {addLabel = sbsI18n("swade-better-templates.UI.Addbehavior_d557d5e8f8"), cast = false, canReplace = cast} = {}) {
    const regularOptions = options(CATALOG.map(def => [def.type, def.label]), "addEffect");
    const choices = cast ? `<optgroup label="Cast adjustments">${options(CAST_CHANGES.map(def => [def.type, def.label]))}</optgroup><optgroup label="Region behaviors">${regularOptions}</optgroup>` : regularOptions;
    const select = this.isLibraryEditor ? "" : `<select class="sbt-behavior-picker" data-role="behavior-type" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Behaviortype_8463093f9e")}">${choices}</select>`;
    return `<div class="sbt-add-row" data-add-behavior-path="${path}">${select}${cast ? `<button type="button" data-action="addBehavior"><i class="fa-solid fa-plus"></i> ${addLabel}</button>` : action("addBehavior", "fa-plus", addLabel)}</div>
      <ul class="sbt-behavior-list">${getPath(this.draft, path).map((entry, index) => entry.type ? this.renderBehavior(entry, path, index, canReplace) : this.renderLegacyChange(entry, `${path}.${index}`)).join("")}</ul>`;
  }
  renderBehavior(entry, listPath, index, canReplace) {
    const def = CAST_CATALOG.find(d => d.type === entry.type), path = `${listPath}.${index}`;
    const replacementTargets = canReplace ? this.behaviorTargets(listPath.startsWith("modifiers.")) : [];
    const open = this.openBehaviors.has(entry.id);
    return `<li class="sbt-behavior ${open ? "" : "sbt-collapsed"}" data-index="${index}" data-behavior-path="${path}"><header class="sbt-behavior-header"><input type="checkbox" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Enable_75682d6af2", {p0: (E(def.label))})}" data-path="${path}.enabled" ${entry.enabled ? "checked" : ""}><i class="sbt-behavior-icon fa-solid ${def.icon}"></i><a class="sbt-behavior-name" data-action="collapseBehavior" aria-expanded="${open}">${E(entry.label || def.label)}</a>${action("moveUp", "fa-chevron-up", sbsI18n("swade-better-templates.UI.Moveup_c66feb5eb8"))}${action("moveDown", "fa-chevron-down", sbsI18n("swade-better-templates.UI.Movedown_40bb50da16"))}${action("duplicateBehavior", "fa-copy", sbsI18n("swade-better-templates.UI.Duplicatebehavior_1fd2e46dcc"))}${action("deleteBehavior", "fa-trash", sbsI18n("swade-better-templates.UI.Removebehavior_47c549106a"))}</header>
    <div class="sbt-behavior-fields"><div class="sbt-behavior-fields-body">
      ${row("Label", input(`${path}.label`, entry.label, sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.placeholder_33cdf3a055", {p0: (E(def.label))})))}
      ${canReplace && !def.castOnly && replacementTargets.length ? row(sbsI18n("swade-better-templates.UI.Replacebehavior_afb7dc0cfc"), `<select data-path="${path}.replaces" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Replacebehavior_afb7dc0cfc")}">${options([["", sbsI18n("swade-better-templates.UI.Addasanewbehavior_6889a35111")], ...replacementTargets], entry.replaces ?? "")}</select>`) : ""}
      ${def.passive ? "" : `<div class="sbt-field"><label>${sbsI18n("swade-better-templates.UI.Triggers_e62f2148a6")}</label><div class="sbt-trigger-options">${TRIGGERS.filter(([key]) => key !== "whileWithin" || [sbsI18n("swade-better-templates.UI.addEffect_48fe869136"), "restrict", "addCover"].includes(entry.type)).map(([key, label]) => `<div class="sbt-trigger-option"><label class="sbt-checkbox-label"><input type="checkbox" data-trigger="${index}" value="${key}" ${entry.triggers.includes(key) ? "checked" : ""}><span>${label}</span></label>${["tokenTurnStart", "tokenTurnEnd"].includes(key) && entry.triggers.includes(key) ? `<select data-path="${path}.${key === "tokenTurnStart" ? "turnStartSource" : "turnEndSource"}" aria-label="${key === "tokenTurnStart" ? "Turn starts for" : "Turn ends for"}">${options([["placer", "Placer"], ["affected", "Affected NPC"]], key === "tokenTurnStart" ? entry.turnStartSource : entry.turnEndSource)}</select>` : ""}</div>`).join("")}</div></div>${row("Targets", `<select data-path="${path}.target">${options(BEHAVIOR_TARGETS, entry.target)}</select>`)}${this.renderField({key: "requiredFlags", label: sbsI18n("swade-better-templates.UI.Requiredtargetflags_4223888bcc"), type: "flags"}, entry.requiredFlags, path)}${this.renderField({key: "excludedFlags", label: sbsI18n("swade-better-templates.UI.Excludedtargetflags_d7161b7456"), type: "flags"}, entry.excludedFlags, path)}`}
      ${def.fields.map(f => this.renderField(f, entry.system[f.key], `${path}.system`, entry)).join("")}
      </div></div></li>`;
  }
  variantTitle(list, variant, index) {
    return list === "raises" ? `Raised ${variant.level}` : variant.name || `Modifier ${index + 1}`;
  }
  renderVariants(list, title) {
    const raised = list === "raises";
    const content = `<div data-variant-list="${list}">
      ${this.draft[list].map((variant, index) => {
        const path = `${list}.${index}`;
        const fields = `
          <div class="sbt-row">
            ${raised ? row(sbsI18n("swade-better-templates.UI.Raiselevel_e5a6e6f425"), input(`${path}.level`, variant.level, sbsI18n("swade-better-templates.UI.number_12886f9d00"), sbsI18n("swade-better-templates.UI.min1step1arialabel_693edaf0ab")))
            : input(`${path}.name`, variant.name, sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.arialabelModifiernameplaceholderModifier_692a479fca"))}
            ${!raised && game.user.isGM && this.setting?.saveModifierToLibrary ? action("saveModifierToLibrary", "fa-book", sbsI18n("swade-better-templates.UI.AddtoModifiersCompendium_368cecf1d8")) : ""}
            ${action("deleteVariant", "fa-trash", raised ? sbsI18n("swade-better-templates.UI.Removeraise_1179565d57") : sbsI18n("swade-better-templates.UI.Removemodifier_f66e522d96"))}
          </div>
          ${raised ? row(sbsI18n("swade-better-templates.UI.Normalbehaviors_e72226784f"), `<select data-path="${path}.mode" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Normalbehaviors_e72226784f")}">${options([["auto", sbsI18n("swade-better-templates.UI.Automatic_d461a493a3")], ["extend", sbsI18n("swade-better-templates.UI.Keepnormalbehaviors_c264fe3981")], ["replace", sbsI18n("swade-better-templates.UI.Replacenormalbehaviors_1156d2a15d")]], variant.mode)}</select>`) + this.renderBehaviorList(`${path}.changes`, {addLabel: sbsI18n("swade-better-templates.UI.Addchange_8aa5b2160d"), cast: true, canReplace: variant.mode !== "replace"}) : this.renderModifierDetails(variant, path)}`;
        const drag = !raised && this.item.type === "power" && game.user.isGM
          ? `<span draggable="true" class="sbt-modifier-drag" data-sbt-modifier-drag="${E(variant.id)}" title="${sbsI18nAttribute("swade-better-templates.UI.DragtoModifiersCompendium_97bfe347bc")}"><i class="fa-solid fa-grip-vertical" inert></i></span> ` : "";
        return accordion(path, drag + E(this.variantTitle(list, variant, index)), fields, this.accordions.has(path), `data-variant-index="${index}"`);
      }).join("")}
      <button type="button" data-action="addVariant"><i class="fa-solid fa-plus"></i> ${raised ? sbsI18n("swade-better-templates.UI.Addraise_c7ed5045f3") : sbsI18n("swade-better-templates.UI.Addmodifier_9a9d652052")}</button>
    </div>`;
    return accordion(list, title, content, this.accordions.has(list));
  }
  renderModifierDetails(variant, path) {
    return `<div class="sbt-modifier-details">
      <prose-mirror class="sbt-modifier-description" name="${path}.description" data-path="${path}.description" value="${E(variant.description)}" editable="true" toggled aria-label="${sbsI18nAttribute("swade-better-templates.UI.Modifierdescription_560e6fefe3")}">${variant.description}</prose-mirror>
      ${variant.options.map((option, index) => {
        const prefix = `${path}.options.${index}`;
        return `<fieldset class="sbt-modifier-option" data-cost-index="${index}"><legend>${index === 0 ? sbsI18n("swade-better-templates.UI.Defaultchange_9e2c0108d2") : `Change ${index + 1}`}</legend>
          <div class="sbt-row sbt-cost-option">
            ${input(`${prefix}.label`, option.label, sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.arialabelOptionnameplaceholderOption_5e55ea02ae"))}
            <label class="sbt-option-cost">${sbsI18n("swade-better-templates.UI.CostPP_4c2e77d9cb", {p0: (input(`${prefix}.cost`, option.cost, sbsI18n("swade-better-templates.UI.number_12886f9d00"), sbsI18n("swade-better-templates.UI.stepanyarialabelPowerPoint_5b16324e1d")))})}</label>
            ${variant.options.length > 1 ? action("deleteCostOption", "fa-trash", sbsI18n("swade-better-templates.UI.Removechangeoption_30b955132d")) : ""}
          </div>
          ${this.renderBehaviorList(`${prefix}.changes`, {cast: true})}
        </fieldset>`;
      }).join("")}
      <button type="button" data-action="addModifierOption"><i class="fa-solid fa-plus"></i> ${sbsI18n("swade-better-templates.UI.Addchange_8aa5b2160d")}</button>
    </div>`;
  }
  renderLegacyChange(change, path) {
    const targets = [["template", sbsI18n("swade-better-templates.UI.Template_0575f29df8")], ...this.behaviorTargets()];
    const fields = variantFields(this.draft, change.target);
    const field = fields.find(field => field.key === change.field);
    const operations = field ? variantOperations(field) : [];
    return `<li class="sbt-variant-change" data-legacy-path="${path}">
      <div class="sbt-row">
        <select data-path="${path}.target" data-variant-control="target" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Changetarget_36d36e6ba4")}">${options(targets, change.target)}</select>
        <select data-path="${path}.field" data-variant-control="field" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Changefield_491ecd5d60")}">${options([["", sbsI18n("swade-better-templates.UI.Chooseafield_f1ceaf17a2")], ...fields.map(field => [field.key, field.label])], change.field)}</select>
        ${action("deleteLegacyChange", "fa-trash", sbsI18n("swade-better-templates.UI.Removechange_7b24391bda"))}
      </div>
      ${field ? `<div class="sbt-variant-value">
        ${operations.length > 1 ? `<select data-path="${path}.operation" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Changeoperation_dadb60d8cf")}">${options(operations, change.operation)}</select>` : ""}
        ${this.renderField({...field, key: "value", label: field.type === "checkbox" ? field.label : sbsI18n("swade-better-templates.UI.Value_8e37953d23")}, change.value, path)}
      </div>` : ""}
    </li>`;
  }
  renderField(field, value, prefix, entry = null) {
    const path = `${prefix}.${field.key}`, f = field;
    let content;
    if (f.type === "checkbox") return `<div class="sbt-row">${check(path, value, E(f.label))}</div>`;
    if (["select", sbsI18n("swade-better-templates.UI.rollMode_4cbf9eec52")].includes(f.type)) content = `<select data-path="${path}" ${f.numeric ? "data-numeric" : ""}>${options(f.options ?? [["publicroll", sbsI18n("swade-better-templates.UI.Public_591935b15b")], ["gmroll", "GM roll"], ["blindroll", sbsI18n("swade-better-templates.UI.BlindGMroll_e98001cf76")], ["selfroll", sbsI18n("swade-better-templates.UI.Self_85bc0f9585")]], value)}</select>`;
    else if (f.type === "wholeDuration") content = input(path, value, sbsI18n("swade-better-templates.UI.number_12886f9d00"), sbsI18n("swade-better-templates.UI.min0step1requireddata_36497fd234"));
    else if (["textarea", "script"].includes(f.type)) content = `<textarea data-path="${path}" rows="${f.type === "script" ? 7 : 3}" ${f.type === "script" && !game.user.isGM ? "disabled" : ""} spellcheck="${f.type !== "script"}">${E(value)}</textarea>${f.type === "script" ? `<p class="sbt-field-hint">${sbsI18n("swade-better-templates.UI.GMauthoredJavaScriptAvailablevariablesare_bade812d87")}</p>` : ""}`;
    else if (f.type === "effects") content = `<div class="sbt-row"><button type="button" data-action="aegis"><i class="fa-solid fa-shield-quartered"></i> ${sbsI18n("swade-better-templates.UI.ConstructwithAEGI_621c913e88")}</button></div><ul class="sbt-effect-list">${value.map((effect, index) => `<li data-effect-index="${index}"><img src="${E(effect.img || "icons/svg/aura.svg")}" alt=""><span>${E(effect.name)}</span>${action("editEffect", "fa-pen", sbsI18n("swade-better-templates.UI.EditwithAEGI_a719f6a420"))}${action("deleteEffect", "fa-trash", sbsI18n("swade-better-templates.UI.Removeeffect_4e7556b8dd"))}</li>`).join("")}</ul>`;
    else if (f.type === "shapeReplacements") content = SHAPES.filter(shape => this.isLibraryEditor || this.draft.shapes.includes(shape.key)).map(shape => {
      const title = shapeTitle(shape);
      return row(E(title), `<select data-path="${path}.${shape.key}" aria-label="${sbsI18nAttribute("swade-better-templates.UI.replacement_e42ab74458", {p0: (E(title))})}">${options([["", sbsI18n("swade-better-templates.UI.Nochanges_c699aa00b2")], ...SHAPES.filter(other => other !== shape).map(other => [other.key, shapeTitle(other)])], value[shape.key])}</select>`);
    }).join("") || `<p class="sbt-field-hint">${sbsI18n("swade-better-templates.UI.Selectatleastoneshapeunder_d108be31ff")}</p>`;
    else if (["light", "sound", "tile", "wall"].includes(f.type)) {
      const src = value.texture?.src ?? value.path ?? "";
      content = `<div class="sbt-row"><button type="button" data-action="configure" data-kind="${f.type}" data-field="${f.key}"><i class="fa-solid fa-sliders"></i> ${sbsI18n("swade-better-templates.UI.Configure_ce4f7edfe8", {p0: (f.type)})}</button><span class="sbt-media-summary">${E(src || sbsI18n("swade-better-templates.UI.NativeFoundrysettings_4b97eb2096"))}</span></div>`;
    } else if (f.type === "movementTypes") {
      const index = prefix.split(".")[1];
      content = `<div class="sbt-trigger-options">${movementTypes().map(([key, config]) => `<label class="sbt-checkbox-label"><input type="checkbox" data-movement="${index}" value="${E(key)}" ${value.includes(key) ? "checked" : ""}><span>${E(game.i18n.localize(config.label))}</span></label>`).join("")}</div><p class="sbt-field-hint">${sbsI18n("swade-better-templates.UI.Leavealluncheckedtoaffectevery_0717fd0f08")}</p>`;
    } else if (f.type === "effectDuration") {
      const disabled = value.enabled ? "" : "disabled";
      content = `<div class="sbt-row">${check(`${path}.enabled`, value.enabled, sbsI18n("swade-better-templates.UI.Overrideduration_d9a9cb1562"))}</div>
        <div class="sbt-row sbt-expiration">${numberInput(`${path}.amount`, value.amount, `aria-label="Effect duration" ${disabled}`)}
        <select data-path="${path}.unit" aria-label="${sbsI18nAttribute("swade-better-templates.UI.Effectdurationunit_da67bb8e12")}" ${disabled}>${options(units, value.unit)}</select></div>`;
    } else if (f.type === "hidden") return "";
    else if (f.type === "traits") {
      content = `<div class="sbt-field-input"><button type="button" data-action="pickRestriction"><i class="fa-solid fa-list"></i> ${sbsI18n("swade-better-templates.UI.Choosetrait_5e263932b5")}</button></div>
        <ul class="sbt-effect-list">${value.map((trait, index) => `<li><span>${E(trait === "*" ? sbsI18n("swade-better-templates.UI.Alltraits_aa536d0ad8") : trait)}${entry.system.linkedAttributes.includes(trait) ? sbsI18n("swade-better-templates.UI.AlllinkedSkills_a460488f4b") : ""}</span>${action("removeRestriction", "fa-trash", sbsI18n("swade-better-templates.UI.Removetrait_38a4dd9879"), sbsI18n("swade-better-templates.UI.datatraitindex_5ff3bbd0af", {p0: (index)}))}</li>`).join("")}</ul>`;
    } else if (f.type === "rollRequest") {
      content = `<div class="sbt-field-input"><button type="button" data-action="configureRequest"><i class="fa-solid fa-clipboard-list"></i> ${sbsI18n("swade-better-templates.UI.ConfigureRequest_07fd4129f4")}</button>
        <span>${value.trait ? E(`${value.name || value.trait} · TN ${value.tn}`) : sbsI18n("swade-better-templates.UI.Norequestconfigured_ee7c35d5ea")}</span></div>`;
    } else {
      const kind = ["uuid", "trait", "flags"].includes(f.type) ? f.type : "";
      const attrs = `${kind ? `data-kind="${kind}"` : ""} ${kind === "trait" ? `list="${this.id}-traits"` : ""}`;
      const effectReference = entry && [sbsI18n("swade-better-templates.UI.addEffect_48fe869136"), sbsI18n("swade-better-templates.UI.removeEffect_85ddab60cc")].includes(entry.type) && [sbsI18n("swade-better-templates.UI.effectUuid_7370e4889b"), "effect"].includes(f.key);
      const editor = f.type === "number" ? numberInput(path, value, `${attrs} ${f.fractional ? "data-fractional" : ""} ${f.optional ? sbsI18n("swade-better-templates.UI.dataformulaoptionalplaceholderKeepcurrent_343c18950f") : ""}`)
        : f.key === "formula" || f.dice ? formulaInput(path, value, entry?.type === "addDamageDice" ? `${attrs} aria-label="Damage formula to add" placeholder="${entry.system.legacyCount === undefined ? 'e.g. 1d6+1d6x' : sbsI18n("swade-better-templates.UI.Keeppreviousdicecount_ded3bd2b9d")}"` : attrs)
        : input(path, value, f.type === "color" ? "color" : "text", `${attrs} ${effectReference ? "data-effect-reference" : ""}`);
      content = `<div class="sbt-field-input">${effectReference ? `<img class="sbt-effect-preview" alt="" hidden>` : ""}${editor}${f.type === "audio" ? action("file", "fa-folder-open", sbsI18n("swade-better-templates.UI.Browsesound_3012b3fb73"), sbsI18n("swade-better-templates.UI.datafield_a8f291e058", {p0: (f.key)})) : ""}${kind === "trait" && entry ? action("pickTrait", "fa-list", sbsI18n("swade-better-templates.UI.Browseattributesandskills_fb246b13d7"), sbsI18n("swade-better-templates.UI.datafield_a8f291e058", {p0: (f.key)})) : ""}${entry && [sbsI18n("swade-better-templates.UI.addEffect_48fe869136"), sbsI18n("swade-better-templates.UI.removeEffect_85ddab60cc")].includes(entry.type) && [sbsI18n("swade-better-templates.UI.effectUuid_7370e4889b"), "effect"].includes(f.key) ? `<button type="button" data-action="pickEffect" title="${sbsI18nAttribute("swade-better-templates.UI.BrowseSWADEandBetterEffects_2c82339527")}"><i class="fa-solid fa-list"></i> ${sbsI18n("swade-better-templates.UI.Browseeffects_109de40dc0")}</button>` : ""}</div>`;
    }
    return `<div class="sbt-field"><label>${E(f.label)}</label>${content}</div>`;
  }
  async handleAction(name, _event, target) {
    this.capture();
    const path = target.closest("[data-behavior-path], [data-legacy-path]")?.dataset;
    const location = (path?.behaviorPath ?? path?.legacyPath)?.split(".");
    const index = Number(location?.pop());
    const behaviors = location ? getPath(this.draft, location.join(".")) : null;
    const entry = behaviors?.[index];
    const confirmDelete = (label, type = sbsI18n("swade-better-templates.UI.behavior_08bf2418cc")) => foundry.applications.api.DialogV2.confirm({
      classes: ["sbt-library-dialog"],
      window: {title: sbsI18n("swade-better-templates.UI.Delete_0ae262c71c", {p0: (type)})}, content: `<p>${"Delete"} <strong>${E(label)}</strong> ${sbsI18n("swade-better-templates.UI.fromthistemplate_b305b94fe4")}</p>`, rejectClose: false
    });
    if (name === "accordion") {
      const card = target.closest("[data-accordion]");
      const key = card.dataset.accordion;
      const open = !this.accordions.delete(key);
      if (open) this.accordions.add(key);
      card.classList.toggle("sbt-accordion-collapsed", !open);
      target.setAttribute("aria-expanded", String(open));
      return;
    }
    if (name === "save" || name === "saveClose") { await this.save(); if (name === "saveClose") await this.close(); return; }
    if (name === "saveModifierToLibrary") {
      const index = Number(target.closest("[data-variant-index]").dataset.variantIndex);
      const modifierId = this.draft.modifiers[index].id;
      if (this.dirty) await this.save();
      await this.setting.saveModifierToLibrary(this.item, modifierId);
      return;
    }
    if (name === "place") { await this.save(); return game.modules.get(MODULE_ID).api.placeTemplate(this.item); }
    if ([sbsI18n("swade-better-templates.UI.addVariant_8c7d33f3d2"), sbsI18n("swade-better-templates.UI.deleteVariant_177c3e6bb4"), sbsI18n("swade-better-templates.UI.addModifierOption_b778584715"), sbsI18n("swade-better-templates.UI.deleteCostOption_69108ff609")].includes(name)) {
      const list = target.closest("[data-variant-list]").dataset.variantList;
      const entries = this.draft[list];
      const variantIndex = Number(target.closest("[data-variant-index]")?.dataset.variantIndex);
      const variant = entries[variantIndex];
      if (name === "addVariant") {
        this.accordions.add(`${list}.${entries.length}`);
        entries.push(list === "raises"
          ? {id: id(), level: Math.max(0, ...entries.map(entry => entry.level)) + 1, mode: "auto", changes: []}
          : {id: id(), name: sbsI18n("swade-better-templates.UI.Modifier_20ddecb0ab", {p0: (entries.length + 1)}), description: "", options: [defaultCostOption()]});
      }
      if (name === "deleteVariant") {
        if (!await confirmDelete(list === "raises" ? `Raised ${variant.level}` : variant.name || sbsI18n("swade-better-templates.UI.Modifier_42e37604b6"), list === "raises" ? "raise" : "modifier")) return;
        entries.splice(variantIndex, 1);
        for (let index = variantIndex; index <= entries.length; index++) {
          this.accordions.delete(`${list}.${index}`);
          if (this.accordions.has(`${list}.${index + 1}`)) this.accordions.add(`${list}.${index}`);
        }
      }
      if (name === "addModifierOption") variant.options.push(defaultCostOption(id()));
      if (name === "deleteCostOption") {
        const optionIndex = Number(target.closest("[data-cost-index]").dataset.costIndex);
        if (variant.options.length <= 1 || !await confirmDelete(variant.options[optionIndex].label || `Change ${optionIndex + 1}`, "change option")) return;
        variant.options.splice(optionIndex, 1);
      }
      this.dirty = true;
      return this.render();
    }
    if (name === "export") { foundry.utils.saveDataToFile(exportAutomation(this.draft, this.item.name), "application/json", `${this.item.name.replace(/[^a-z0-9-]/gi, "-")}.json`); return; }
    if (name === "import") {
      const text = await foundry.applications.api.DialogV2.prompt({classes: ["sbt-library-dialog"], window: {title: sbsI18n("swade-better-templates.UI.Importtemplateautomation_f15d84b062")}, content: `<div class="sbt-import"><input type="file" name="file" accept=".json,application/json"><p>${sbsI18n("swade-better-templates.UI.OrpasteexportedJSON_e5bedefeb0")}</p><textarea name="json" rows="8"></textarea></div>`, ok: {label: sbsI18n("swade-better-templates.UI.Import_2cff9baabf"), callback: async (_e, button) => { const file = button.form.querySelector('[name="file"]').files[0]; return file ? file.text() : button.form.querySelector('[name="json"]').value; }}, rejectClose: false});
      if (text) this.draft = importAutomation(text); else return;
    } else if (name === "saveCompendium") { await this.save(); await saveToCompendium(this.item); return; }
    else if (name === "importCompendium") { const item = await chooseCompendiumTemplate(); if (!item) return; this.draft = readAutomation(item); }
    else if (name === "addBehavior") {
      const row = target.closest("[data-add-behavior-path]");
      const type = this.isLibraryEditor ? await foundry.applications.api.DialogV2.prompt({
        classes: ["sbt-library-dialog"], window: {title: sbsI18n("swade-better-templates.UI.Addtemplatebehavior_d7ae420e49")}, rejectClose: false,
        content: `<label>${sbsI18n("swade-better-templates.UI.Behavior_edf8d3f178")} <select name="behavior"><optgroup label="Cast adjustments">${options(CAST_CHANGES.map(def => [def.type, def.label]))}</optgroup><optgroup label="Region behaviors">${options(CATALOG.map(def => [def.type, def.label]))}</optgroup></select></label>`,
        ok: {label: sbsI18n("swade-better-templates.UI.Add_9fd728c66c"), callback: (_event, button) => button.form.elements.behavior.value}
      }) : row.querySelector('[data-role="behavior-type"]').value;
      if (!type || (this.isLibraryEditor && !this.element.isConnected)) return;
      const behavior = defaultBehavior(type);
      if (this.isLibraryEditor && type === "executeMacro") behavior.enabled = false;
      getPath(this.draft, row.dataset.addBehaviorPath).push(behavior);
      this.openBehaviors.add(behavior.id);
    }
    else if (name === "collapseBehavior") {
      if (!this.openBehaviors.delete(entry.id)) this.openBehaviors.add(entry.id);
    }
    else if (name === "deleteBehavior" || name === "deleteLegacyChange") {
      const label = entry.type ? entry.label || CAST_CATALOG.find(def => def.type === entry.type).label : sbsI18n("swade-better-templates.UI.Thischange_9ed68ba82f");
      if (!await confirmDelete(label)) return;
      behaviors.splice(index, 1);
      for (const variant of variantLists(this.draft)) {
        variant.changes = variant.changes.filter(change => change.target !== entry.id);
        for (const change of variant.changes) if (change.replaces === entry.id) delete change.replaces;
      }
    }
    else if (name === "duplicateBehavior") behaviors.splice(index + 1, 0, {...clone(entry), id: id()});
    else if (name === "moveUp" || name === "moveDown") { const to = index + (name === "moveUp" ? -1 : 1); if (to >= 0 && to < behaviors.length) [behaviors[index], behaviors[to]] = [behaviors[to], behaviors[index]]; }
    else if (name === "pickEffect") { const effect = await pickEffect(); if (!effect) return; entry.system[entry.type === "addEffect" ? sbsI18n("swade-better-templates.UI.effectUuid_7370e4889b") : "effect"] = effect.value; }
    else if (name === "pickTrait") {
      const trait = await pickTrait();
      if (!trait) return;
      entry.system[target.dataset.field] = trait.value;
    } else if (name === "pickRestriction") {
      return pickRestrictedTrait((value, trait) => {
        entry.system.traits = [...new Set([...entry.system.traits, value])];
        entry.system.linkedAttributes = entry.system.linkedAttributes.filter(key => key !== value);
        if (trait.linkedSkills) entry.system.linkedAttributes.push(value);
        this.dirty = true;
        this.render();
      }, entry.system.linkedAttributes);
    } else if (name === "removeRestriction") {
      const [trait] = entry.system.traits.splice(Number(target.dataset.traitIndex), 1);
      entry.system.linkedAttributes = entry.system.linkedAttributes.filter(key => key !== trait);
    } else if (name === "configureRequest") {
      const api = effectsAPI();
      if (!api?.configureRollRequest) throw new Error(sbsI18n("swade-better-templates.UI.EnabletheupdatedSWADEBetterEffects_6472615bc6"));
      return api.configureRollRequest(entry.system.request, request => {
        numericFormula(request.tn, null, {validate: true});
        entry.system.request = request;
        this.dirty = true;
        this.render();
      }, {previewTargetNumber: value => formulaResult(value, this.formulaActor)});
    }
    else if (name === "aegis" || name === "editEffect") {
      const effectIndex = Number(target.closest("[data-effect-index]")?.dataset.effectIndex);
      const result = await editAegis(name === "editEffect" ? [entry.system.effects[effectIndex]] : [], entry.label || this.item.name);
      if (!result) return;
      if (name === "editEffect") entry.system.effects.splice(effectIndex, 1, ...result); else entry.system.effects.push(...result);
    } else if (name === "deleteEffect") entry.system.effects.splice(Number(target.closest("[data-effect-index]").dataset.effectIndex), 1);
    else if (name === "file") { new CONFIG.ux.FilePicker({type: "audio", current: entry.system[target.dataset.field], callback: path => { entry.system[target.dataset.field] = path; this.dirty = true; this.render(); }}).render({force: true}); return; }
    else if (name === "configure") { const result = await editSceneObject(target.dataset.kind, entry.system[target.dataset.field]); if (!result) return; entry.system[target.dataset.field] = result; }
    this.dirty = true; this.render();
  }
  async save() {
    for (const editor of this.element.querySelectorAll("prose-mirror.active[data-path]")) editor.save();
    this.capture();
    if (!this.item.isOwner) throw new Error(sbsI18n("swade-better-templates.UI.Younolongerhavepermissionto_d0262e154f"));
    const levels = this.draft.raises.map(raise => raise.level);
    if (levels.some(level => !Number.isSafeInteger(level) || level < 1) || new Set(levels).size !== levels.length) {
      throw new Error(sbsI18n("swade-better-templates.UI.Eachraiseneedsadifferentpositive_cfa342ad44"));
    }
    if (variantLists(this.draft).some(entry => entry.changes.some(change => !change.type && !change.field))) {
      throw new Error(sbsI18n("swade-better-templates.UI.Chooseafieldforeachraise_63117b33f6"));
    }
    const old = readAutomation(this.item);
    const modifiers = this.item.type === "power" ? mergeModifierDraft(this.savedModifiers, this.draft.modifiers, old.modifiers) : this.draft.modifiers;
    const raises = this.item.type === "power" ? mergeRaiseDraft(this.savedRaises, this.draft.raises, old.raises) : this.draft.raises;
    const draft = normalizeAutomation({...this.draft, modifiers, raises}, this.item);
    if (draft.enabled && !draft.shapes.length) throw new Error(sbsI18n("swade-better-templates.UI.Chooseatleastonetemplateshape_d2e05e3e4a"));
    const executables = automation => configuredBehaviors(automation).filter(b => [sbsI18n("swade-better-templates.UI.executeScript_b0daf0eb89"), sbsI18n("swade-better-templates.UI.executeMacro_166cc3b6bb")].includes(b.type));
    if (!game.user.isGM && JSON.stringify(executables(draft)) !== JSON.stringify(executables(old))) throw new Error(sbsI18n("swade-better-templates.UI.AGMmustconfigurescriptsand_6d55e7ec0e"));
    this.validateBehaviorFields(draft);
    const update = {[`flags.${MODULE_ID}.automation`]: draft};
    for (const shape of SHAPES) {
      const path = itemTemplatePath(this.item, shape);
      if (path) update[path] = draft.shapes.includes(shape.key);
    }
    await this.item.update(update);
    this.draft = readAutomation(this.item);
    this.savedModifiers = clone(this.draft.modifiers);
    this.savedRaises = clone(this.draft.raises);
    await trustAutomation(this.draft);
    this.dirty = false;
    ui.notifications.info(sbsI18n("swade-better-templates.UI.Templateautomationsaved_416b915e66"));
    this.render();
  }
  validateBehaviorFields(draft) {
    for (const field of this.element.querySelectorAll("[data-formula]:enabled")) {
      if (field.hasAttribute("data-formula-optional") && !field.value.trim()) continue;
      numericFormula(field.value, null, {validate: true});
    }
    for (const b of configuredBehaviors(draft)) {
      if (!b.enabled) continue;
      if (b.type === "adjustDuration" && (!Number.isSafeInteger(b.system.amount) || b.system.amount < 0)) {
        throw new Error(sbsI18n("swade-better-templates.UI.AdjustDurationrequiresanonnegativewhole_1dae6075be"));
      }
      if ([sbsI18n("swade-better-templates.UI.rollDice_c3d4cbd1d7"), sbsI18n("swade-better-templates.UI.rollDamage_fee911778b"), sbsI18n("swade-better-templates.UI.addDamageDice_83050ac532")].includes(b.type)) {
        const formula = b.system.formula.trim();
        if (b.type === "addDamageDice" && !formula && b.system.legacyCount !== undefined) continue;
        if (!formula || !Roll.validate(expandTraitFormula(formula, null, {validate: true, roll: true}))) throw new Error(sbsI18n("swade-better-templates.UI.Invaliddiceformulain_4e626cfbbc", {p0: (b.label || CAST_CATALOG.find(def => def.type === b.type).label)}));
      }
    }
    for (const variant of variantLists(draft)) for (const change of variant.changes.filter(change => !change.type)) {
      const field = variantFields(draft, change.target).find(field => field.key === change.field);
      if (field?.dice && !Roll.validate(expandTraitFormula(change.value, null, {validate: true, roll: true}))) {
        throw new Error(sbsI18n("swade-better-templates.UI.Invaliddiceformulain_4e626cfbbc", {p0: (variant.level ? `Raised ${variant.level}` : variant.label || "the default change")}));
      }
    }
  }
  async close(options = {}) {
    if (this.dirty && !options.force) {
      const result = await foundry.applications.api.DialogV2.wait({classes: ["sbt-library-dialog"], window: {title: sbsI18n("swade-better-templates.UI.Unsavedtemplateautomation_ee672570a1")}, content: `<p>${sbsI18n("swade-better-templates.UI.Saveyourchangesbeforeclosing_56ab88c224")}</p>`, buttons: [{action: "save", label: sbsI18n("swade-better-templates.UI.Save_1509f561f2"), default: true}, {action: "discard", label: sbsI18n("swade-better-templates.UI.Discard_eb1a70e392")}], rejectClose: false});
      if (!result) return this;
      if (result === "save") { try { await this.save(); } catch (error) { ui.notifications.error(error.message); return this; } }
    }
    opened.delete(this.item.uuid);
    return super.close(options);
  }
}


class LibraryTemplateBehaviors extends BetterTemplatesBuilder {
  constructor(host, modifier, onSave) {
    const draft = {enabled: false, modifiers: [modifier]};
    super({name: modifier.name, type: "power", getFlag: () => draft});
    this.host = host;
    this.onSave = onSave;
    this.pending = Promise.resolve();
    this.lastChanges = JSON.stringify(this.draft.modifiers[0].options[0].changes);
    host.classList.add("sbt-inline-behaviors");
    host.addEventListener("click", event => {
      const target = event.target.closest("[data-action]");
      if (!target) return;
      event.preventDefault();
      event.stopPropagation();
      void this.handleAction(target.dataset.action, event, target).catch(error => ui.notifications.error(error.message));
    });

  }

  get isLibraryEditor() { return true; }
  get element() { return this.host; }

  render() {
    if (!this.host.isConnected) return;
    this.host.innerHTML = `<div>${this.renderBehaviorList("modifiers.0.options.0.changes", {cast: true, addLabel: sbsI18n("swade-better-templates.UI.AddTemplateModifier_e3e20fa399")})}</div>
      <datalist id="${this.id}-traits"></datalist>`;
    this.bindEditor(this.host.firstElementChild);
    if (this.dirty) this.persistChanges();
  }

  persistChanges() {
    this.dirty = false;
    try {
      const draft = normalizeAutomation(this.draft, this.item);
      this.validateBehaviorFields(draft);
      const changes = draft.modifiers[0].options[0].changes;
      const serialized = JSON.stringify(changes);
      if (serialized === this.lastChanges) return;
      this.lastChanges = serialized;
      const next = this.pending.then(async () => {
        await trustAutomation(draft);
        await this.onSave(changes);
      });
      this.pending = next.catch(error => {
        if (this.lastChanges === serialized) this.lastChanges = undefined;
        ui.notifications.error(error.message);
      });
    } catch (error) { ui.notifications.error(error.message); }
  }
}
