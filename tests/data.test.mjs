import test from "node:test";
import assert from "node:assert/strict";
import {CATALOG, SHAPES, defaultAutomation, defaultBehavior, durationSeconds, itemTemplatePath, mergeModifierDraft, normalizeAutomation, exportAutomation, importAutomation, trackerEntryVisible, combatExpiry, combatHasExpired, setPath} from "../scripts/data.mjs";
import {expandTraitFormula, formulaResult, numericFormula} from "../scripts/formulas.mjs";
import {distanceInInches} from "../scripts/geometry.mjs";
import {castDefaults, hasTemplateReplacements, projectCastDamage, projectCastTemplates, resolveCastOptions, templateShapeData} from "../scripts/variants.mjs";

test("region duration adjustments honor order, unit conversion, and their scope", () => {
  const adjustment = (operation, amount, unit = "", scope = "template") => ({
    ...defaultBehavior("adjustDuration"), system: {operation, amount, unit, scope}
  });
  const automation = normalizeAutomation({shapes: ["small"], expiration: {enabled: true, amount: 2, unit: "rounds"},
    modifiers: [{id: "lengthen", options: [{id: "base", changes: [adjustment("add", 1, "minutes")]}]}],
    raises: [{level: 1, changes: [adjustment("subtract", 1, "seconds"), adjustment("override", 9, "hours", "power")]}]});
  const chosen = {baseShape: "small", modifiers: ["lengthen"], raise: 1};
  const duration = resolveCastOptions(automation, chosen).automation.expiration;
  assert.equal(durationSeconds(duration), 71);
  assert.equal(duration.unit, "seconds");
  automation.raises[0].changes.push(adjustment("override", 0));
  assert.equal(resolveCastOptions(automation, chosen).automation.expiration.removeOnPlacement, true);
});

test("first builder opening inherits every selected SWADE shape and enables automation", () => {
  const automation = defaultAutomation({system: {templates: {small: true, medium: false, large: true, scone: true, cone: true, stream: true}}});
  assert.equal(automation.enabled, true);
  assert.deepEqual(automation.shapes, ["small", "large", "scone", "cone", "stream"]);
  assert.equal(SHAPES.find(s => s.key === "cone").preset, "swcone");
});
test("ring presets round-trip independently of the native SWADE shape fields", () => {
  const item = {system: {templates: {small: true}}, getFlag: () => ({smallRing: true, largeRing: true})};
  const automation = defaultAutomation(item);
  assert.deepEqual(importAutomation(exportAutomation(automation)).shapes, ["small", "smallRing", "largeRing"]);
  const rings = SHAPES.filter(shape => shape.type === "ring");
  assert.deepEqual(rings.map(shape => [shape.radius, shape.outerWidth]), [[1, 1], [2, 1], [3, 1]]);
  assert.equal(itemTemplatePath(item, SHAPES[0]), "system.templates.small");
  assert.equal(itemTemplatePath(item, rings[0]), "flags.swade-better-templates.templates.smallRing");
  assert.equal(automation.advanced.highlightMode, "shapes");
});
test("whole-inch distance and numeric previews round down", () => {
  assert.equal(distanceInInches({x: 0, y: 0}, {x: 210, y: 0}, {size: 100, distance: 1}), 2);
  assert.equal(formulaResult("2.1"), "= 2");
  assert.equal(numericFormula("2.1"), 2);
  assert.equal(numericFormula("2.1", null, {roundDown: false}), 2.1);
});
const behavior = (type, system = {}) => {
  const entry = defaultBehavior(type);
  Object.assign(entry.system, system);
  return entry;
};

test("supplemental raises keep normal behaviors and apply dice changes after priced modifiers", () => {
  const draft = defaultAutomation();
  draft.shapes = ["small", "medium", "large"];
  draft.behaviors = [behavior("rollDamage", {formula: "2d6x + 1d4 [bonus]"}), behavior("chatMessage")];
  draft.raises = [
    {level: 1, changes: [behavior("rollDamage", {formula: "9d6"})]},
    {level: 2, changes: [behavior("changeTemplate", {replacements: {small: "mediumRing", medium: "cone"}}), behavior("modifyExpiration", {expiration: "placement"}),
      behavior("addDamageDice", {formula: "1d4"}), behavior("increaseDieType"), behavior("attachLight")]}
  ];
  draft.modifiers = [
    {id: "strong", name: "Strong", options: [{id: "base", label: "Base", cost: 0, changes: []},
      {id: "extra", label: "Extra die", cost: 2, changes: [behavior("addDamageDice", {formula: "1d6+1d6x"})]}]},
    {id: "wide", name: "Wide", options: [{id: "base", cost: 1, changes: [behavior("changeTemplate", {replacements: {large: "stream"}})]}]}
  ];
  const saved = importAutomation(exportAutomation(draft));
  const base = {baseShape: "small"};
  const normal = resolveCastOptions(saved, base);
  assert.equal(normal.automation.behaviors[0].system.formula, "2d6x + 1d4 [bonus]");
  const replacement = resolveCastOptions(saved, {...base, raise: 1});
  assert.deepEqual(replacement.automation.behaviors.map(entry => entry.system.formula), ["9d6"]);
  const selected = {...base, raise: 2, modifiers: ["wide", "strong"], modifierOptions: {strong: "extra"}};
  const cast = resolveCastOptions(saved, selected);
  assert.deepEqual(cast.choices.modifiers, ["strong", "wide"]);
  assert.deepEqual(cast.choices.modifierOptions, {strong: "extra", wide: "base"});
  assert.deepEqual(cast.automation.behaviors.map(entry => entry.type), ["rollDamage", "chatMessage", "attachLight"]);
  assert.equal(cast.automation.behaviors[0].system.formula, "((2d8x + 1d6 [bonus]) + (1d6+1d6x)) + (1d4)");
  assert.deepEqual(templateShapeData(SHAPES.find(s => s.key === cast.shapeKey), {size: 100, distance: 1}, cast.dimensions),
    {type: "ring", x: 0, y: 0, radius: 200, innerWidth: 0, outerWidth: 100});
  assert.equal(durationSeconds(cast.automation.expiration), null);
  assert.equal(resolveCastOptions(saved, {...selected, modifierOptions: {strong: "base"}}).automation.behaviors[0].system.formula, "(2d8x + 1d6 [bonus]) + (1d4)");
  assert.equal(hasTemplateReplacements(saved), true);
  const defaults = castDefaults(saved, {modifiers: ["Wide"], modifierOptions: {wide: "base"}, raises: 2});
  assert.equal(defaults.raise, 2);
  assert.deepEqual(projectCastTemplates(saved, defaults).map(({baseShape, shape}) => [baseShape, shape.key]), [["small", "mediumRing"], ["medium", "cone"], ["large", "stream"]]);
  assert.deepEqual(projectCastTemplates(saved, selected).map(({baseShape, shape}) => [baseShape, shape.key]), [["small", "mediumRing"], ["medium", "cone"], ["large", "stream"]]);
  assert.equal(saved.behaviors[0].system.formula, "2d6x + 1d4 [bonus]");
  saved.raises[1].mode = "replace";
  assert.equal(resolveCastOptions(saved, selected).automation.behaviors.some(entry => entry.type === "chatMessage"), false);
});

test("cast card and region damage share base and all-dice upgrades, including later additions", () => {
  const bonus = behavior("addDamageDice", {formula: "1d6+1d6x"});
  const automation = normalizeAutomation({shapes: ["small"], raises: [
    {level: 1, changes: [bonus, behavior("increaseDieType")]},
    {level: 2, changes: [behavior("increaseDieType", {scope: "all"}), bonus]}
  ]});
  const item = {system: {damage: "2d6"}};
  const base = projectCastDamage(automation, {raise: 1}, item.system.damage);
  assert.equal(base.formula, "(2d8) + (1d6+1d6x)");
  assert.deepEqual(base.adjustments[1], {source: "Raised 1", label: "Increase Die Type", before: "2d6", after: "2d8"});
  const all = projectCastDamage(automation, {raise: 2}, item.system.damage);
  assert.equal(all.formula, "(2d8) + (1d8+1d8x)");
  const [region] = resolveCastOptions(automation, {baseShape: "small", raise: 2}, {item}).automation.behaviors;
  assert.equal(region.system.formula, all.formula);
  assert.deepEqual(region.damageAdjustments, all.adjustments);
});

test("existing universal replacements and same-type dice counts keep working after import", () => {
  const saved = normalizeAutomation({shapes: ["small", "medium"], behaviors: [behavior("rollDamage", {formula: "2d10x"})], raises: [{level: 1, changes: [
    {type: "changeTemplate", system: {shape: "large"}}, {type: "addDamageDice", system: {count: 2}}, {type: "addNote", system: {}}
  ]}]});
  assert.deepEqual(saved.raises[0].changes.map(change => change.type), ["changeTemplate", "addDamageDice"]);
  assert.deepEqual(projectCastTemplates(saved, {raise: 1}).map(({shape}) => shape.key), ["large", "large"]);
  assert.equal(resolveCastOptions(saved, {baseShape: "medium", raise: 1}).automation.behaviors[0].system.formula, "4d10x");
});

test("saved template changes move expiration and dimensions out of the shape card", () => {
  const saved = normalizeAutomation({shapes: ["medium"], raises: [{level: 1, changes: [
    {type: "changeTemplate", id: "old", system: {replacements: {medium: "largeRing"}, range: 8, size: 4, width: 2, expiration: "timed", duration: 3, unit: "minutes"}}
  ]}]});
  const [shape, size, width, expiration] = saved.raises[0].changes;
  assert.deepEqual(Object.keys(shape.system), ["replacements", "range"]);
  assert.deepEqual([size.field, size.value, width.field, width.value], ["size", 4, "width", 2]);
  assert.deepEqual([expiration.type, expiration.id, expiration.system], ["modifyExpiration", "old-expiration", {expiration: "timed", duration: 3, unit: "minutes"}]);
  assert.deepEqual(importAutomation(exportAutomation(saved)), saved);
  const cast = resolveCastOptions(saved, {baseShape: "medium", raise: 1});
  assert.equal(cast.shapeKey, "largeRing");
  assert.deepEqual(cast.dimensions, {size: 4, width: 2});
  assert.equal(durationSeconds(cast.automation.expiration), 180);
});

test("legacy field patches migrate into priced options without applying lower raises", () => {
  const draft = defaultAutomation();
  draft.shapes = ["small"];
  const damage = defaultBehavior("rollDamage");
  Object.assign(damage.system, {formula: "4", flags: "cold, magic"});
  draft.behaviors = [damage];
  const change = (target, field, value, operation = "set") => ({target, field, value, operation});
  draft.raises = [
    {level: 2, changes: [change("template", "shape", "mediumRing"), change("template", "size", 3)]},
    {level: 1, changes: [change(damage.id, "system.formula", "2", "add")]}
  ];
  draft.modifiers = [
    {id: "fire", name: "Fire", changes: [change(damage.id, "system.flags", "fire", "add"), change(damage.id, "target", "enemies")]},
    {id: "selective", name: "Selective", changes: [change(damage.id, "system.flags", "cold", "remove"), change(damage.id, "target", "placer"),
      change("template", "expiration.removeOnPlacement", true), change("template", "__proto__.polluted", true)]}
  ];
  const saved = importAutomation(exportAutomation(draft));
  assert.equal(saved.modifiers[1].options[0].changes.length, 3);
  const normal = resolveCastOptions(saved, {baseShape: "small", raise: 0, modifiers: []});
  assert.equal(normal.shapeKey, "small");
  assert.equal(normal.automation.behaviors[0].system.formula, "4");
  const cast = resolveCastOptions(saved, {baseShape: "small", raise: 2, modifiers: ["selective", "fire", "unknown"]});
  assert.deepEqual(cast.choices.modifiers, ["fire", "selective"]);
  assert.equal(cast.shapeKey, "mediumRing");
  assert.equal(templateShapeData(SHAPES.find(shape => shape.key === cast.shapeKey), {size: 100, distance: 1}, cast.dimensions).radius, 300);
  assert.deepEqual([cast.automation.behaviors[0].target, cast.automation.behaviors[0].system.flags, cast.automation.behaviors[0].system.formula],
    ["placer", "magic, fire", "4"]);
  assert.equal(durationSeconds(cast.automation.expiration), null);
  assert.equal(combatExpiry({...cast.automation.expiration, currentTurnEnd: true}, {started: true}), null);
  assert.equal(saved.expiration.removeOnPlacement, false);
  assert.equal(saved.behaviors[0].system.flags, "cold, magic");
});
test("option changes and prices merge independently when both editors are open", () => {
  const before = [{id: "power", name: "Area", description: "", options: [{id: "base", label: "Base", cost: 1, changes: []}]}];
  const draft = structuredClone(before), saved = structuredClone(before);
  draft[0].options[0].changes.push(behavior("changeTemplate", {replacements: {small: "medium"}}));
  saved[0].options[0].cost = 3;
  saved[0].options.push({id: "extra", label: "Large", cost: 4, changes: []});
  const [merged] = mergeModifierDraft(before, draft, saved);
  assert.deepEqual(merged.options, [{...draft[0].options[0], cost: 3}, saved[0].options[1]]);
});
test("all behaviors survive export and import, including complete AEGIS and attachment data", () => {
  const automation = defaultAutomation(); automation.shapes = ["medium"];
  automation.behaviors = CATALOG.map(def => defaultBehavior(def.type));
  const effect = automation.behaviors.find(b => b.type === "addEffect");
  effect.system.effects = [{name: "Resistant", type: "base", system: {changes: [{key: "system.stats.toughness.value", value: 2, type: "add"}]}, flags: {"swade-better-effects": {rules: [{selector: "incoming-damage", value: 0.5}]}}}];
  const light = automation.behaviors.find(b => b.type === "attachLight");
  light.system.light = {config: {animation: {type: "flame", speed: 5}, dim: 6}, darkness: {min: .1, max: .9}};
  const roundtrip = importAutomation(exportAutomation(automation));
  assert.equal(roundtrip.behaviors.length, 19);
  assert.deepEqual(roundtrip.behaviors.find(b => b.type === "addEffect").system, effect.system);
  assert.deepEqual(roundtrip.behaviors.find(b => b.type === "attachLight").system, light.system);
});
test("invalid imports are rejected and unknown behaviors cannot become runtime actions", () => {
  assert.throws(() => importAutomation('{"module":"pf2e-aztecs-template-wizard","behaviors":[]}'), /not a SWADE/);
  assert.throws(() => importAutomation('{"version":9,"behaviors":[]}'), /newer version/);
  assert.throws(() => importAutomation('{"name":"invalid"}'), /Invalid template/);
  const normalized = normalizeAutomation({shapes: ["small", "small", "not-real"], behaviors: [{type: "untrusted-type"}]});
  assert.deepEqual(normalized.shapes, ["small"]); assert.deepEqual(normalized.behaviors, []);
  assert.throws(() => setPath({}, "__proto__.polluted", true), /Invalid field/);
  assert.equal({}.polluted, undefined);
  const damage = defaultBehavior("rollDamage");
  const legacy = {type: "choiceSet", enabled: true, system: {choices: [{behaviors: [damage.id]}]}};
  const clean = normalizeAutomation({behaviors: [legacy, damage]}).behaviors;
  assert.deepEqual(clean.map(b => [b.type, b.enabled]), [["rollDamage", false]]);
});
test("scene A tracker entries never appear on scene B or while no scene is loaded", () => {
  const entry = {sceneId: "A", hiddenFromPlayers: false};
  assert.equal(trackerEntryVisible(entry, "A", true), true);
  assert.equal(trackerEntryVisible(entry, "B", true), false);
  assert.equal(trackerEntryVisible(entry, null, true), false);
  assert.equal(trackerEntryVisible({sceneId: null}, "A", true), false);
  assert.equal(trackerEntryVisible({...entry, hiddenFromPlayers: true}, "A", false), false);
  assert.equal(trackerEntryVisible({...entry, hiddenFromPlayers: true}, "A", true), true);
});
test("combat expiration follows combatant identity when SWADE reshuffles initiative", () => {
  const combat = {id: "combat", started: true, round: 3, turn: 1, combatant: {id: "caster"}, turns: [{id: "other"}, {id: "caster"}]};
  const schedule = combatExpiry({enabled: true, amount: 2, unit: "rounds", currentTurnEnd: false}, combat);
  assert.equal(combatHasExpired(schedule, {...combat, round: 4}), false);
  assert.equal(combatHasExpired(schedule, {...combat, round: 5, turn: 0, turns: [{id: "other"}, {id: "caster"}]}), false);
  assert.equal(combatHasExpired(schedule, {...combat, round: 5, turn: 0, turns: [{id: "caster"}, {id: "other"}]}), true);
  assert.equal(combatHasExpired(schedule, {...combat, id: "other-combat", round: 9}), false);
});
test("current-turn expiration survives round wrap and does not expire at turn start", () => {
  const combat = {id: "combat", started: true, round: 1, turn: 1, combatant: {id: "caster"}, turns: [{id: "other"}, {id: "caster"}]};
  const schedule = combatExpiry({enabled: true, amount: 10, unit: "minutes", currentTurnEnd: true}, combat);
  assert.equal(combatHasExpired(schedule, combat), false);
  assert.equal(combatHasExpired(schedule, {...combat, round: 2, turn: 0}), true);
  assert.equal(combatExpiry({enabled: false}, combat), null);
});
test("independent builders never share mutable default effects or request recipients", () => {
  const first = defaultBehavior("addEffect"), second = defaultBehavior("addEffect");
  first.system.effects.push({name: "One"}); assert.deepEqual(second.system.effects, []);
  const requests = [defaultBehavior("requestRoll"), defaultBehavior("requestRoll")];
  requests[0].system.request.recipients.push("player");
  assert.deepEqual(requests[1].system.request.recipients, []);
});
test("trait die modifiers stay flat through arithmetic and numeric formulas survive import", () => {
  const actor = {system: {attributes: {spirit: {die: {sides: 12, modifier: 1}}}}, items: [
    {type: "skill", name: "Science, Weird", system: {die: {sides: 8, modifier: -1}}}
  ]};
  assert.equal(expandTraitFormula("@spirit/2", actor), "(12/2) + 1");
  assert.equal(expandTraitFormula("2d6x + @science-weird", actor, {roll: true}), "(2d6x + 8) - 1");
  assert.equal(expandTraitFormula("@spirit-2", actor), "(12-2) + 1");
  const draft = defaultAutomation();
  assert.deepEqual(draft.expiration, {enabled: true, currentTurnEnd: false, removeOnPlacement: false, amount: 5, unit: "rounds"});
  draft.placementRange.max = "@spirit/2";
  const terrain = defaultBehavior("difficultTerrain");
  terrain.system.multiplier = "@science-weird/4";
  draft.behaviors.push(terrain);
  const imported = importAutomation(exportAutomation(draft));
  assert.equal(imported.placementRange.max, "@spirit/2");
  assert.equal(imported.behaviors[0].system.multiplier, "@science-weird/4");
});
