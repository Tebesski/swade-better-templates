import {t as sbsI18n} from "./i18n.mjs";
export const MODULE_ID = "swade-better-templates";
export const FLAG_SCOPE = MODULE_ID;
export const EFFECTS_ID = "swade-better-effects";
export const BEHAVIOR_TYPE = `${MODULE_ID}.automation`;
export const PACK_ID = `world.${MODULE_ID}`;
export const SUPPORTED_TYPES = new Set(["gear", "power", "action", "weapon", "consumable", "armor", "shield", "ability", "edge", "hindrance"]);
export const TIME_UNITS = {rounds: 6, seconds: 1, minutes: 60, hours: 3600, days: 86400};
export const SHAPES = [
  {key: "small", preset: "sbt", get label() { return sbsI18n("swade-better-templates.UI.SmallBlast_6713fa0daf"); }, type: "circle", radius: 1},
  {key: "medium", preset: "mbt", get label() { return sbsI18n("swade-better-templates.UI.MediumBlast_be37ac5399"); }, type: "circle", radius: 2},
  {key: "large", preset: "lbt", get label() { return sbsI18n("swade-better-templates.UI.LargeBlast_e4d5086259"); }, type: "circle", radius: 3},
  {key: "scone", preset: "swscone", get label() { return sbsI18n("swade-better-templates.UI.SmallCone_ca1d9de011"); }, type: "cone", radius: 4, angle: 37.5},
  {key: "cone", preset: "swcone", get label() { return sbsI18n("swade-better-templates.UI.Cone_3b5ebcbf43"); }, type: "cone", radius: 9, angle: 22.5},
  {key: "stream", preset: "stream", get label() { return sbsI18n("swade-better-templates.UI.Stream_1eec3071dd"); }, type: "line", length: 12, width: 1},
  {key: "smallRing", preset: "sbt-small-ring", get label() { return sbsI18n("swade-better-templates.UI.SRing_b45e4796bc"); }, type: "ring", radius: 1, outerWidth: 1},
  {key: "mediumRing", preset: "sbt-medium-ring", get label() { return sbsI18n("swade-better-templates.UI.MRing_9689e977dc"); }, type: "ring", radius: 2, outerWidth: 1},
  {key: "largeRing", preset: "sbt-large-ring", get label() { return sbsI18n("swade-better-templates.UI.LRing_15b4d0af0e"); }, type: "ring", radius: 3, outerWidth: 1}
];
export const shapeTitle = shape => shape.type === "ring" ? shape.label : `${shape.label} Template`;
export const shapeButtonLabel = shape => ({small: "SBT", medium: "MBT", large: "LBT", scone: "S Cone"})[shape.key] ?? shape.label;
export const TRIGGERS = [
  [sbsI18n("swade-better-templates.UI.onPlace_76085f67e6"), sbsI18n("swade-better-templates.UI.Onplacement_599dd9bd45")], [sbsI18n("swade-better-templates.UI.tokenEnter_e1e10c616f"), sbsI18n("swade-better-templates.UI.Tokenenters_57c48e7c74")], [sbsI18n("swade-better-templates.UI.tokenExit_ad0b811e74"), sbsI18n("swade-better-templates.UI.Tokenleaves_4239bd451f")],
  [sbsI18n("swade-better-templates.UI.tokenMoveWithin_7355208480"), sbsI18n("swade-better-templates.UI.Tokenmoveswithin_5b3ab1a957")], [sbsI18n("swade-better-templates.UI.tokenTurnStart_e28b7966a8"), sbsI18n("swade-better-templates.UI.Turnstarts_c48b98bf31")], [sbsI18n("swade-better-templates.UI.tokenTurnEnd_a46d30ebcf"), sbsI18n("swade-better-templates.UI.Turnends_a232cc4498")],
  [sbsI18n("swade-better-templates.UI.tokenRoundStart_925669060b"), sbsI18n("swade-better-templates.UI.Roundstarts_68989aa755")], [sbsI18n("swade-better-templates.UI.tokenRoundEnd_1933c8e1a3"), sbsI18n("swade-better-templates.UI.Roundends_c7378a6e52")], [sbsI18n("swade-better-templates.UI.whileWithin_4b53ad3c98"), sbsI18n("swade-better-templates.UI.Whileinside_d4e1e2bc26")]
];
export const escapeHTML = value => String(value ?? "").replace(/[&<>"']/g, c => ({"&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"})[c]);
export const clone = value => structuredClone(value);
export const id = () => globalThis.foundry?.utils?.randomID?.() ?? Math.random().toString(36).slice(2, 14);
export const splitList = value => [...new Set((Array.isArray(value) ? value : String(value ?? "").split(/[,\n]/)).map(v => String(v).trim()).filter(Boolean))];
export const normalizeName = value => String(value ?? "").trim().toLowerCase();
export function movementTypes() {
  return Object.entries(CONFIG.Token.movement.actions).filter(([, action]) =>
    action.terrainAction === undefined && action.deriveTerrainDifficulty == null);
}
export function itemTemplatePath(item, shape) {
  if (item?.system?.templates && shape.type !== "ring") return `system.templates.${shape.key}`;
  if (item?.system?.templates || item?.type === "gear") return `flags.${MODULE_ID}.templates.${shape.key}`;
  return null;
}
export function itemTemplateSelected(item, shape) {
  if (item?.system?.templates && shape.type !== "ring") return Boolean(item.system.templates[shape.key]);
  return Boolean(item?.getFlag?.(MODULE_ID, "templates")?.[shape.key]);
}
export function setPath(object, path, value) {
  const keys = path.split(".");
  if (keys.some(k => ["__proto__", "prototype", "constructor"].includes(k))) throw new Error(sbsI18n("swade-better-templates.UI.Invalidfieldpath_8988bc41cf"));
  const last = keys.pop(); let cursor = object;
  for (const key of keys) cursor = cursor[key] ??= {};
  cursor[last] = value;
}
export function getPath(object, path) { return path.split(".").reduce((value, key) => value?.[key], object); }
export function defaultAutomation(item = null) {
  return {version: 1, enabled: true, label: "", placementRange: {enabled: false, max: 0},
    shapes: SHAPES.filter(shape => itemTemplateSelected(item, shape)).map(shape => shape.key),
    selectTokensOnPlacement: true,
    expiration: {enabled: true, currentTurnEnd: false, removeOnPlacement: false, amount: 5, unit: "rounds"}, attachable: false,
    separateRegions: {enabled: false, audio: false, tiles: false, lights: false, walls: false},
    wallRestriction: {enabled: false, type: "move", priority: 0},
    advanced: {hideFromPlayers: false, enabled: false, gridBased: true, color: "#a728cc", visibility: 0, highlightMode: "shapes", displayMeasurements: true},
    behaviors: [], raises: [], modifiers: []};
}
const field = (key, label, type = sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), value = "", extra = {}) => ({key, label, type, default: value, ...extra});
export const CATALOG = [
  {type: "addCover", label: "Add Cover", icon: "fa-shield-halved", fields: [field("level", "Cover", "select", "light", {options: [["light", "Light (−2)"], ["medium", "Medium (−4)"], ["heavy", "Heavy (−6)"], ["near-total", "Near Total (−8)"]]})]},
  {type: "addEffect", get label() { return sbsI18n("swade-better-templates.UI.AddEffect_86e0214437"); }, icon: "fa-person-rays", fields: [field("effectUuid", sbsI18n("swade-better-templates.UI.EffectUUID_8eb7fd794c"), sbsI18n("swade-better-templates.UI.uuid_75666699b7")), field("effects", sbsI18n("swade-better-templates.UI.Effects_358511c8c0"), sbsI18n("swade-better-templates.UI.effects_888ad3a8bb"), []), field("duration", sbsI18n("swade-better-templates.UI.Customeffectduration_9f2f033a5a"), sbsI18n("swade-better-templates.UI.effectDuration_f5ca757d02"), {enabled: false, amount: 5, unit: "rounds"}), field("removeOnExit", sbsI18n("swade-better-templates.UI.Removeonleaving_a27b931d93"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), true)]},
  {type: "adjustDarkness", get label() { return sbsI18n("swade-better-templates.UI.AdjustDarknessLevel_026f752f58"); }, icon: "fa-moon", passive: true, fields: [field("mode", sbsI18n("swade-better-templates.UI.Mode_5e23ec6a30"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), 0, {options: [[0, sbsI18n("swade-better-templates.UI.Override_43bc0f5fc0")], [1, sbsI18n("swade-better-templates.UI.Brighten_1f0fdb9a84")], [2, sbsI18n("swade-better-templates.UI.Darken_d540e5346b")]], numeric: true}), field("modifier", sbsI18n("swade-better-templates.UI.Darknesslevelmodifier_9dc9f6c16a"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 0.5, {min: 0, max: 1, fractional: true})]},
  {type: "attachLight", get label() { return sbsI18n("swade-better-templates.UI.AttachLightSource_33d4cd9b5c"); }, icon: "fa-lightbulb", passive: true, fields: [field("light", sbsI18n("swade-better-templates.UI.Lightsource_62aaca8dfa"), sbsI18n("swade-better-templates.UI.light_99a7026172"), {config: {dim: 6, bright: 3, color: "#ffffff", alpha: 0.5}})]},
  {type: "attachSound", get label() { return sbsI18n("swade-better-templates.UI.AttachSound_9a0583dd61"); }, icon: "fa-volume-high", passive: true, fields: [field("sound", sbsI18n("swade-better-templates.UI.Ambientsound_8213ed8d2c"), sbsI18n("swade-better-templates.UI.sound_dd29442dec"), {path: "", radius: 6, volume: 0.5})]},
  {type: "attachTile", get label() { return sbsI18n("swade-better-templates.UI.AttachTile_1c67d875d3"); }, icon: "fa-image", passive: true, fields: [field("tile", sbsI18n("swade-better-templates.UI.Tile_6ea3c1948e"), sbsI18n("swade-better-templates.UI.tile_8b668b8994"), {texture: {src: ""}, alpha: 1})]},
  {type: "attachWalls", get label() { return sbsI18n("swade-better-templates.UI.AttachWalls_573bc9ac14"); }, icon: "fa-block-brick", passive: true, fields: [field("wall", sbsI18n("swade-better-templates.UI.Wallconfiguration_aad3383dca"), sbsI18n("swade-better-templates.UI.wall_4d8aaa64f6"), {move: 20, sight: 20, light: 20, sound: 20}), field("segments", sbsI18n("swade-better-templates.UI.Curvededgesegments_6b39f998af"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 32, {min: 8, max: 128})]},
  {type: "rollDamage", get label() { return sbsI18n("swade-better-templates.UI.RollDamage_ecc37350f4"); }, icon: "fa-burst", fields: [field("formula", sbsI18n("swade-better-templates.UI.Damageformula_c6292464ab"), sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.2d6x_089ad7f65a")), field("isHeavyWeapon", sbsI18n("swade-better-templates.UI.HeavyWeapon"), "checkbox", false), field("ap", sbsI18n("swade-better-templates.UI.Armorpiercing_3997da7298"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 0, {min: 0}), field("flags", sbsI18n("swade-better-templates.UI.Damageflags_e15936d915"), sbsI18n("swade-better-templates.UI.flags_2934fb49d6")), field("flavor", sbsI18n("swade-better-templates.UI.Chatlabel_02d440bc5f")), field("rollMode", sbsI18n("swade-better-templates.UI.Rollmode_315010d16a"), sbsI18n("swade-better-templates.UI.rollMode_4cbf9eec52"), sbsI18n("swade-better-templates.UI.publicroll_147da79397"))]},
  {type: "difficultTerrain", get label() { return sbsI18n("swade-better-templates.UI.DifficultTerrain_956716de0e"); }, icon: "fa-person-hiking", passive: true, fields: [field("multiplier", sbsI18n("swade-better-templates.UI.Movementcostmultiplier_5e4a9580eb"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 2, {min: 0, max: 5, fractional: true}), field("actions", sbsI18n("swade-better-templates.UI.Movementtypes_95812bc28b"), sbsI18n("swade-better-templates.UI.movementTypes_817e56bd10"), [])]},
  {type: "scrollingText", get label() { return sbsI18n("swade-better-templates.UI.DisplayScrollingText_99978f66ff"); }, icon: "fa-text", fields: [field("text", sbsI18n("swade-better-templates.UI.Text_71988c4d8e"), sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.Affected_39ec27b85a")), field("color", sbsI18n("swade-better-templates.UI.Color_6b73191a0a"), sbsI18n("swade-better-templates.UI.color_74284d9dcb"), sbsI18n("swade-better-templates.UI.ffffff_f2074b6cef")), field("duration", sbsI18n("swade-better-templates.UI.Durationms_35d6a4d315"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 2000, {min: 100})]},
  {type: "executeMacro", get label() { return sbsI18n("swade-better-templates.UI.ExecuteMacro_d3d8ff34d0"); }, icon: "fa-code", fields: [field("macroUuid", sbsI18n("swade-better-templates.UI.MacroUUID_2c8e908655"), sbsI18n("swade-better-templates.UI.uuid_75666699b7"))]},
  {type: "executeScript", get label() { return sbsI18n("swade-better-templates.UI.ExecuteScript_98025a5b1a"); }, icon: "fa-code", fields: [field("script", sbsI18n("swade-better-templates.UI.Script_102acc10e6"), sbsI18n("swade-better-templates.UI.script_21a0270b7f"), sbsI18n("swade-better-templates.UI.Availabletokenactorregionitemevent_a189cd03d7"))]},
  {type: "move", get label() { return sbsI18n("swade-better-templates.UI.Move_6ecc3df6bf"); }, icon: "fa-arrows-up-down-left-right", fields: [field("mode", sbsI18n("swade-better-templates.UI.Direction_9c8a9579ab"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), sbsI18n("swade-better-templates.UI.away_378ce56a9d"), {options: [["away", sbsI18n("swade-better-templates.UI.Awayfromregion_009c564a38")], ["toward", sbsI18n("swade-better-templates.UI.Towardregion_bbc3d95bc2")], ["direction", sbsI18n("swade-better-templates.UI.Fixeddirection_9b6d2b1d56")]]}), field("distance", sbsI18n("swade-better-templates.UI.Distance_4f16a68b77"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 1, {min: 0}), field("direction", sbsI18n("swade-better-templates.UI.Directiondegrees_b5d16c05c5"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 0), field("walls", sbsI18n("swade-better-templates.UI.Respectwalls_9596c5c4ea"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), true)]},
  {type: "playSound", get label() { return sbsI18n("swade-better-templates.UI.PlaySound_35bc71602b"); }, icon: "fa-music", fields: [field("path", sbsI18n("swade-better-templates.UI.Soundfile_fa4a3968df"), sbsI18n("swade-better-templates.UI.audio_6ed8919ce2")), field("volume", sbsI18n("swade-better-templates.UI.Volume_b10fb966d7"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 0.5, {min: 0, max: 1, fractional: true}), field("loop", sbsI18n("swade-better-templates.UI.Loopuntilregionexpires_42052c1f78"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), false)]},
  {type: "removeEffect", get label() { return sbsI18n("swade-better-templates.UI.RemoveEffect_cb1db795a7"); }, icon: "fa-person-circle-minus", fields: [field("effect", sbsI18n("swade-better-templates.UI.EffectnameUUIDstatusorflag_6e36070cf1"), sbsI18n("swade-better-templates.UI.flags_2934fb49d6"))]},
  {type: "restrict", get label() { return sbsI18n("swade-better-templates.UI.Restrict_26f2f6e68e"); }, icon: "fa-ban", fields: [field("traits", sbsI18n("swade-better-templates.UI.Traits_e0ab4adb01"), sbsI18n("swade-better-templates.UI.traits_9e27940861"), []), field("linkedAttributes", sbsI18n("swade-better-templates.UI.Linkedattributes_86fd821a0f"), sbsI18n("swade-better-templates.UI.hidden_e564b4081d"), []), field("rollFlags", sbsI18n("swade-better-templates.UI.Restrictedrollflags_f0a6cd0c31"), sbsI18n("swade-better-templates.UI.flags_2934fb49d6")), field("label", sbsI18n("swade-better-templates.UI.Effectlabel_3cf6918fda"), sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.Restricted_a00571bcb2"))]},
  {type: "requestRoll", get label() { return sbsI18n("swade-better-templates.UI.RequestRoll_f3e4f31128"); }, icon: "fa-clipboard-list", fields: [field("request", sbsI18n("swade-better-templates.UI.Rollrequest_6d48510198"), sbsI18n("swade-better-templates.UI.rollRequest_d3e3d75245"), {trait: "", tn: 4, penalty: 0, description: "", flags: "", kind: "", attribute: "", recipients: [], name: ""})]},
  {type: "rollDice", get label() { return sbsI18n("swade-better-templates.UI.RollDice_3cac2f7e27"); }, icon: "fa-dice", fields: [field("formula", sbsI18n("swade-better-templates.UI.Formula_d00bd4ec32"), sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.1d6x_0462e57885")), field("flavor", sbsI18n("swade-better-templates.UI.Chatlabel_02d440bc5f")), field("flags", sbsI18n("swade-better-templates.UI.Rollflags_f324559efa"), sbsI18n("swade-better-templates.UI.flags_2934fb49d6")), field("rollMode", sbsI18n("swade-better-templates.UI.Rollmode_315010d16a"), sbsI18n("swade-better-templates.UI.rollMode_4cbf9eec52"), sbsI18n("swade-better-templates.UI.publicroll_147da79397"))]},
  {type: "rollTrait", get label() { return sbsI18n("swade-better-templates.UI.RollTrait_4aba0d4bbd"); }, icon: "fa-dice-d6", fields: [field("trait", sbsI18n("swade-better-templates.UI.Attributeorskill_5b7a66c540"), sbsI18n("swade-better-templates.UI.trait_982055e51c"), sbsI18n("swade-better-templates.UI.agility_b22bacd700")), field("modifier", sbsI18n("swade-better-templates.UI.Modifier_42e37604b6"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 0), field("tn", sbsI18n("swade-better-templates.UI.Targetnumber_7edd3afa64"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 4, {min: 1}), field("flags", sbsI18n("swade-better-templates.UI.Rollflags_f324559efa"), sbsI18n("swade-better-templates.UI.flags_2934fb49d6")), field("prompt", sbsI18n("swade-better-templates.UI.ShowSWADErolldialog_59ce77ee13"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), true), field("rollMode", sbsI18n("swade-better-templates.UI.Rollmode_315010d16a"), sbsI18n("swade-better-templates.UI.rollMode_4cbf9eec52"), sbsI18n("swade-better-templates.UI.publicroll_147da79397"))]},
  {type: "chatMessage", get label() { return sbsI18n("swade-better-templates.UI.SendChatMessage_78605c4cd0"); }, icon: "fa-message", fields: [field("text", sbsI18n("swade-better-templates.UI.Message_2f77668a9d"), sbsI18n("swade-better-templates.UI.textarea_ee67f93d65")), field("rollMode", sbsI18n("swade-better-templates.UI.Visibility_7448611d5f"), sbsI18n("swade-better-templates.UI.rollMode_4cbf9eec52"), sbsI18n("swade-better-templates.UI.publicroll_147da79397"))]}
];
export const CAST_CHANGES = [
  {type: "changeTemplate", get label() { return sbsI18n("swade-better-templates.UI.ChangeTemplate_8fa9267602"); }, icon: "fa-shapes", castOnly: true, passive: true, fields: [
    field("replacements", sbsI18n("swade-better-templates.UI.Templatereplacements_4a8030f422"), sbsI18n("swade-better-templates.UI.shapeReplacements_51aebd6341"), Object.fromEntries(SHAPES.map(shape => [shape.key, ""]))),
    field("range", sbsI18n("swade-better-templates.UI.Maxplacementrange_4231d07e58"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), "", {optional: true})
  ]},
  {type: "modifyExpiration", get label() { return sbsI18n("swade-better-templates.UI.ModifyExpiration_a0602c5569"); }, icon: "fa-hourglass-half", castOnly: true, passive: true, fields: [
    field("expiration", sbsI18n("swade-better-templates.UI.Expiration_f38d6e0e9b"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), "", {options: [["", sbsI18n("swade-better-templates.UI.Keepcurrentexpiration_670d519900")], ["timed", sbsI18n("swade-better-templates.UI.Useduration_e488e6294b")], ["turn", sbsI18n("swade-better-templates.UI.Oncurrentturnend_02a6db1579")], ["placement", sbsI18n("swade-better-templates.UI.Removeonplacement_81859429c8")], ["never", sbsI18n("swade-better-templates.UI.Doesnotexpire_9edea97b85")]]}),
    field("duration", sbsI18n("swade-better-templates.UI.Duration_4fc52a3c4c"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), "", {optional: true}),
    field("unit", sbsI18n("swade-better-templates.UI.Durationtype_858c2765e5"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), "", {options: [["", sbsI18n("swade-better-templates.UI.Keepcurrentdurationtype_073a87bb17")], ...Object.keys(TIME_UNITS).map(unit => [unit, unit])]})
  ]},
  {type: "adjustDuration", get label() { return sbsI18n("swade-better-templates.UI.AdjustDuration_583b9b5f41"); }, icon: "fa-hourglass-half", castOnly: true, passive: true, fields: [
    field("scope", sbsI18n("swade-better-templates.UI.Applyto_aab0d28eb7"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), sbsI18n("swade-better-templates.UI.template_5cde0f1298"), {options: [["template", sbsI18n("swade-better-templates.UI.Templateexpiration_3bb053dcc6")], ["power", sbsI18n("swade-better-templates.UI.Powertimer_7f9ae2136b")]]}),
    field("operation", sbsI18n("swade-better-templates.UI.Operation_0f044feb6c"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), sbsI18n("swade-better-templates.UI.override_ce60377413"), {options: [["override", sbsI18n("swade-better-templates.UI.Override_43bc0f5fc0")], ["add", sbsI18n("swade-better-templates.UI.Add_9fd728c66c")], ["subtract", sbsI18n("swade-better-templates.UI.Subtract_63df016f96")]]}),
    field("amount", sbsI18n("swade-better-templates.UI.Amount_49e96d7cdf"), sbsI18n("swade-better-templates.UI.wholeDuration_8e1d6f4554"), 1),
    field("unit", sbsI18n("swade-better-templates.UI.Durationunit_7ba318feac"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), "", {options: [["", sbsI18n("swade-better-templates.UI.Currentunit_104a1f56b2")], ...Object.keys(TIME_UNITS).map(unit => [unit, unit])]})
  ]},
  {type: "increaseDieType", get label() { return sbsI18n("swade-better-templates.UI.IncreaseDieType_26ecc75f97"); }, icon: "fa-dice-d12", castOnly: true, passive: true, fields: [
    field("scope", sbsI18n("swade-better-templates.UI.Dicetoincrease_14e29d3778"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), sbsI18n("swade-better-templates.UI.base_cae662172f"), {options: [["base", sbsI18n("swade-better-templates.UI.BaseDieSet_bc51a3ffda")], ["all", sbsI18n("swade-better-templates.UI.AllDice_c8852eda01")]]}),
    field("steps", sbsI18n("swade-better-templates.UI.Diesteps_ac5dd9b5e3"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 1),
    field("flatOverflow", sbsI18n("swade-better-templates.UI.Addflatmodifierifdieincreases_60ab9c5148"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), false)
  ]},
  {type: "addDamageDice", get label() { return sbsI18n("swade-better-templates.UI.AddDamageDice_73624e9689"); }, icon: "fa-dice", castOnly: true, passive: true, fields: [field("formula", sbsI18n("swade-better-templates.UI.Damageformulatoadd_33750a322d"), sbsI18n("swade-better-templates.UI.text_982d9e3eb9"), sbsI18n("swade-better-templates.UI.1d6_44868e6ec0"))]}
];
export const CAST_CATALOG = [...CATALOG, ...CAST_CHANGES];
export function defaultBehavior(type) {
  const def = CAST_CATALOG.find(d => d.type === type);
  if (!def) throw new Error(sbsI18n("swade-better-templates.UI.Unknownbehavior_5640e8ab84", {p0: (type)}));
  const entry = {id: id(), type, enabled: true, collapsed: false, label: "", triggers: [[sbsI18n("swade-better-templates.UI.addEffect_48fe869136"), "restrict", "addCover"].includes(type) ? sbsI18n("swade-better-templates.UI.whileWithin_4b53ad3c98") : sbsI18n("swade-better-templates.UI.tokenEnter_e1e10c616f")], turnEndSource: "affected", turnStartSource: "affected", target: "all", requiredFlags: "", excludedFlags: "", system: Object.fromEntries(def.fields.map(f => [f.key, clone(f.default)]))};
  return entry;
}
export const BEHAVIOR_TARGETS = [["all", sbsI18n("swade-better-templates.UI.Alltokens_229c8c1441")], ["allies", sbsI18n("swade-better-templates.UI.Allies_177fd547e1")], ["enemies", sbsI18n("swade-better-templates.UI.Enemies_5ad26002ad")], ["placer", sbsI18n("swade-better-templates.UI.Placer_1cf7e782b5")]];
const templateChangeFields = [
  field("shape", sbsI18n("swade-better-templates.UI.Templateshape_ad9fc79f41"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), sbsI18n("swade-better-templates.UI.small_81db8ebbbb"), {options: SHAPES.map(shape => [shape.key, shape.label])}),
  field("size", sbsI18n("swade-better-templates.UI.Size_dd635eac3c"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 1),
  field("width", sbsI18n("swade-better-templates.UI.Streamorringwidth_43350a8b65"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 1),
  field("placementRange.enabled", sbsI18n("swade-better-templates.UI.Limitplacementrange_c75453bc89"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), true),
  field("placementRange.max", sbsI18n("swade-better-templates.UI.Maxplacementrange_4231d07e58"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 1),
  field("expiration.enabled", sbsI18n("swade-better-templates.UI.Regionexpires_d02bc130af"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), true),
  field("expiration.amount", sbsI18n("swade-better-templates.UI.Duration_4fc52a3c4c"), sbsI18n("swade-better-templates.UI.number_12886f9d00"), 5),
  field("expiration.unit", sbsI18n("swade-better-templates.UI.Durationtype_858c2765e5"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), sbsI18n("swade-better-templates.UI.rounds_206cd5ee00"), {options: Object.keys(TIME_UNITS).map(unit => [unit, unit])}),
  field("expiration.currentTurnEnd", sbsI18n("swade-better-templates.UI.Oncurrentturnend_02a6db1579"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), true),
  field("expiration.removeOnPlacement", sbsI18n("swade-better-templates.UI.Removeonplacement_81859429c8"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), true)
];
const variantFieldTypes = new Set(["checkbox", "color", "flags", "number", sbsI18n("swade-better-templates.UI.rollMode_4cbf9eec52"), "select", "text", "textarea", "trait", "uuid"]);
export function variantFields(automation, target) {
  if (target === "template") return templateChangeFields;
  const behavior = automation.behaviors.find(entry => entry.id === target);
  if (!behavior) return [];
  const definition = CATALOG.find(def => def.type === behavior.type);
  const fields = [field("enabled", sbsI18n("swade-better-templates.UI.Enablebehavior_1bd15f1bef"), sbsI18n("swade-better-templates.UI.checkbox_6fe9eb8f46"), true)];
  if (!definition.passive) fields.push(
    field("target", sbsI18n("swade-better-templates.UI.Targets_27445f6ab6"), sbsI18n("swade-better-templates.UI.select_b1a36d25d9"), sbsI18n("swade-better-templates.UI.all_5ef5ef0364"), {options: BEHAVIOR_TARGETS}),
    field("requiredFlags", sbsI18n("swade-better-templates.UI.Requiredtargetflags_4223888bcc"), sbsI18n("swade-better-templates.UI.flags_2934fb49d6")),
    field("excludedFlags", sbsI18n("swade-better-templates.UI.Excludedtargetflags_d7161b7456"), sbsI18n("swade-better-templates.UI.flags_2934fb49d6"))
  );
  return fields.concat(definition.fields.filter(f => variantFieldTypes.has(f.type)).map(f => ({
    ...f, key: `system.${f.key}`, dice: f.key === "formula"
  })));
}
export function variantOperations(field) {
  const operations = [["set", sbsI18n("swade-better-templates.UI.Set_b6f6f3ad07")]];
  if (field.type === "flags" || field.type === "number" || field.dice) operations.push(["add", sbsI18n("swade-better-templates.UI.Add_9fd728c66c")]);
  if (field.type === "flags") operations.push(["remove", sbsI18n("swade-better-templates.UI.Remove_c3812fc4ac")]);
  return operations;
}
function normalizeChanges(automation, raw, seen, includeRaised = false) {
  if (!Array.isArray(raw)) return [];
  // An old list could have 100 cards, each splitting into up to four changes.
  const limit = 400;
  return raw.slice(0, limit).flatMap(change => {
    const definition = CAST_CATALOG.find(def => def.type === change?.type);
    if (definition) {
      const entry = normalizeBehavior(change, definition);
      if (entry.type === "changeTemplate") {
        const previous = change.system?.replacements ? "" : change.system?.shape;
        for (const shape of SHAPES) {
          const value = previous && automation.shapes.includes(shape.key) ? previous : entry.system.replacements[shape.key];
          entry.system.replacements[shape.key] = SHAPES.some(s => s.key === value && s.key !== shape.key) ? value : "";
        }
      }
      if (entry.type === "addDamageDice") {
        const count = change.system?.legacyCount ?? change.system?.count;
        if (!change.system?.formula?.trim?.() && (typeof count === "string" || Number.isFinite(count))) {
          entry.system.formula = "";
          entry.system.legacyCount = count;
        }
      }
      const targets = includeRaised ? [...automation.behaviors, ...automation.raises.flatMap(raise => raise.changes)] : automation.behaviors;
      if (typeof change.replaces === "string" && targets.some(b => b.id === change.replaces && CATALOG.some(def => def.type === b.type))) entry.replaces = change.replaces;
      assignBehaviorId(entry, seen);
      return entry.type === "changeTemplate" ? migrateTemplateChange(entry, change.system ?? {}, seen) : [entry];
    }
    const field = variantFields(automation, change?.target).find(field => field.key === change?.field);
    if (!field) return [];
    const {value} = change;
    const valid = field.options ? field.options.some(([key]) => key === value)
      : field.type === "number" ? typeof value === "string" || Number.isFinite(value)
      : typeof value === typeof field.default;
    if (!valid) return [];
    const operation = variantOperations(field).some(([key]) => key === change.operation) ? change.operation : "set";
    return [{target: change.target, field: change.field, operation, value}];
  }).slice(0, limit);
}

function migrateTemplateChange(entry, previous, seen) {
  // Keep dimensions from old cards as editable legacy field changes.
  const dimensions = [];
  if (entry.enabled) for (const key of ["size", "width"]) {
    const value = previous[key];
    if (Number.isFinite(value) || typeof value === "string" && value.trim()) dimensions.push({target: "template", field: key, operation: "set", value});
  }
  if ([previous.expiration, previous.duration, previous.unit].every(value => value === undefined || value === "")) return [entry, ...dimensions];
  const definition = CAST_CHANGES.find(def => def.type === "modifyExpiration");
  const expiration = normalizeBehavior({...entry, type: definition.type, system: previous}, definition);
  if (Object.values(expiration.system).every(value => value === "")) return [entry, ...dimensions];
  const keepTemplate = entry.system.range !== "" || Object.values(entry.system.replacements).some(Boolean);
  if (!keepTemplate) return [...dimensions, expiration];
  expiration.id = `${entry.id.slice(0, 53)}-expiration`;
  expiration.label = "";
  assignBehaviorId(expiration, seen);
  return [entry, ...dimensions, expiration];
}
function mergeDefaults(base, source) {
  if (!source || typeof source !== "object" || Array.isArray(source)) return base;
  for (const key of Object.keys(base)) {
    if (!Object.hasOwn(source, key)) continue;
    const value = source[key];
    if (Array.isArray(base[key])) { if (Array.isArray(value)) base[key] = clone(value); }
    else if (base[key] && typeof base[key] === "object") mergeDefaults(base[key], value);
    else if (typeof base[key] === typeof value || typeof base[key] === "number" && typeof value === "string") base[key] = value;
  }
  return base;
}
function normalizeBehavior(source, definition) {
  const entry = mergeDefaults(defaultBehavior(definition.type), source);
  // Media configurations are native Foundry document data, not a fixed subset of fields.
  for (const f of definition.fields) {
    const value = source.system?.[f.key];
    if (["light", "sound", "tile", "wall"].includes(f.type) && value && typeof value === "object") entry.system[f.key] = clone(value);
    if ((f.optional && Number.isFinite(value)) || f.options?.some(([key]) => key === value)) entry.system[f.key] = value;
    else if (f.options && !f.options.some(([key]) => key === entry.system[f.key])) entry.system[f.key] = clone(f.default);
  }
  entry.triggers = entry.triggers.filter(t => TRIGGERS.some(([key]) => key === t));
  entry.turnEndSource = entry.turnEndSource === "placer" ? "placer" : "affected";
  entry.turnStartSource = entry.turnStartSource === "placer" ? "placer" : "affected";
  entry.target = BEHAVIOR_TARGETS.some(([key]) => key === entry.target) ? entry.target : "all";
  if (entry.type === "restrict") {
    if (typeof source.system?.traits === "string") entry.system.traits = splitList(source.system.traits);
    if (source.system?.restriction === "all") entry.system.traits = ["*"];
    if (source.system?.restriction === "movement") entry.enabled = false;
  }
  return entry;
}
function assignBehaviorId(entry, seen) {
  if (entry.id === "template" || !/^[a-z0-9_-]{1,64}$/i.test(entry.id) || seen.has(entry.id)) entry.id = id();
  seen.add(entry.id);
}
export const defaultCostOption = (key = sbsI18n("swade-better-templates.UI.base_cae662172f")) => ({id: key, label: "", cost: 0, changes: []});
export function variantLists(automation) {
  return [...(automation.raises ?? []), ...(automation.modifiers ?? []).flatMap(modifier => modifier.options ?? [modifier])];
}
export function configuredBehaviors(automation) {
  return [...automation.behaviors, ...variantLists(automation).flatMap(option => (option.changes ?? []).filter(change => change.type))];
}
export function normalizeAutomation(raw, item = null) {
  const result = mergeDefaults(defaultAutomation(item), raw);
  result.shapes = [...new Set(result.shapes.filter(s => SHAPES.some(d => d.key === s)))];
  result.expiration.unit = Object.hasOwn(TIME_UNITS, result.expiration.unit) ? result.expiration.unit : "rounds";
  result.wallRestriction.type = ["move", "sight", "sound", "light", "darkness"].includes(result.wallRestriction.type) ? result.wallRestriction.type : "move";
  const behaviors = Array.isArray(raw?.behaviors) ? raw.behaviors : [];
  const choiceChildren = new Set(behaviors.filter(b => b?.type === "choiceSet" && b.enabled && Array.isArray(b.system?.choices))
    .flatMap(b => b.system.choices.flatMap(choice => Array.isArray(choice?.behaviors) ? choice.behaviors : [])));
  result.behaviors = behaviors.filter(b => CATALOG.some(d => d.type === b?.type)).slice(0, 100).map(b => {
    const entry = normalizeBehavior(b, CATALOG.find(d => d.type === b.type));
    // Former choice-only actions need explicit enabling once the choice is removed.
    if (choiceChildren.has(entry.id)) entry.enabled = false;
    return entry;
  });
  const seen = new Set();
  for (const entry of result.behaviors) assignBehaviorId(entry, seen);
  const levels = new Set();
  result.raises = result.raises.slice(0, 100).flatMap(raise => {
    if (!Number.isSafeInteger(raise?.level) || raise.level < 1 || levels.has(raise.level)) return [];
    levels.add(raise.level);
    return [{id: typeof raise.id === "string" && /^[a-z0-9_-]{1,64}$/i.test(raise.id) ? raise.id : `raise-${raise.level}`,
      level: raise.level, mode: ["extend", "replace"].includes(raise.mode) ? raise.mode : "auto", changes: normalizeChanges(result, raise.changes, seen)}];
  }).sort((a, b) => a.level - b.level);
  const modifierIds = new Set();
  result.modifiers = result.modifiers.slice(0, 100).flatMap(modifier => {
    if (!modifier || typeof modifier !== "object") return [];
    const validId = typeof modifier.id === "string" && /^[a-z0-9_-]{1,64}$/i.test(modifier.id);
    const key = validId && !modifierIds.has(modifier.id) ? modifier.id : id();
    modifierIds.add(key);
    const description = typeof modifier.description === "string" ? modifier.description : "";
    const entry = {id: key, name: typeof modifier.name === "string" ? modifier.name.trim() : "",
      description: globalThis.foundry?.utils?.cleanHTML?.(description) ?? description};
    const ids = new Set();
    const options = (Array.isArray(modifier.options) ? modifier.options : []).filter(option => option && typeof option === "object").slice(0, 100);
    const legacy = options.some(option => Array.isArray(option.changes)) ? [] : modifier.changes;
    entry.options = options.map(option => {
      const optionId = typeof option.id === "string" && /^[a-z0-9_-]{1,64}$/i.test(option.id) && !ids.has(option.id) ? option.id : id();
      ids.add(optionId);
      return {id: optionId, label: typeof option.label === "string" ? option.label : "", cost: Number.isFinite(Number(option.cost)) ? Number(option.cost) : 0,
        changes: normalizeChanges(result, option.changes ?? legacy, seen, true)};
    });
    if (!entry.options.length) entry.options.push({...defaultCostOption(), changes: normalizeChanges(result, legacy, seen, true)});
    return [entry];
  });
  return result;
}
export function readAutomation(item) { return normalizeAutomation(item?.getFlag?.(MODULE_ID, "automation"), item); }

export function readCastAutomation(item) {
  const saved = item?.getFlag?.(MODULE_ID, "automation");
  const setting = globalThis.game?.modules?.get?.("swade-better-setting");
  const globals = setting?.active ? setting.api?.getGlobalModifiers?.(item, "templates", saved?.modifiers ?? []) ?? [] : [];
  const changes = globals.filter(row => row.options?.some(option => option.changes?.length) || row.changes?.length);
  if (!changes.length) return readAutomation(item);
  // With only global modifiers, start with the native shapes and no default expiration.
  const base = saved && saved.enabled !== false ? saved : {expiration: {enabled: false}};
  return normalizeAutomation({...base, modifiers: [...(base.modifiers ?? []), ...changes]}, item);
}

export function readRegionAutomation(item, selection) {
  if (selection?.modifiers?.length) {
    const cast = readCastAutomation(item);
    if (cast.modifiers.some(row => selection.modifiers.includes(row.id))) return cast;
  }
  return item?.getFlag?.(MODULE_ID, "automation") ? readAutomation(item) : null;
}

// Apply edits made in an open builder without overwriting changes saved in the power sheet.
export function mergeModifierDraft(baseline, draft, saved) {
  return mergeRows(baseline, draft, saved, ["name", "description"], "options");
}
export function mergeRaiseDraft(baseline, draft, saved) {
  return mergeRows(baseline, draft, saved, ["level", "mode", "changes"]);
}

export const isPowerDurationChange = change => change?.type === "adjustDuration" && change.system?.scope === "power";

function mergeScopedChanges(before, draft, saved) {
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const power = draft.filter(isPowerDurationChange);
  const template = draft.filter(change => !isPowerDurationChange(change));
  const nextPower = same(power, before.filter(isPowerDurationChange)) ? saved.filter(isPowerDurationChange) : power;
  const nextTemplate = same(template, before.filter(change => !isPowerDurationChange(change)))
    ? saved.filter(change => !isPowerDurationChange(change)) : template;
  return same(power, nextPower) && same(template, nextTemplate) ? draft : [...nextTemplate, ...nextPower];
}
function mergeRows(baseline, draft, saved, fields, nested) {
  const before = new Map(baseline.map(entry => [entry.id, entry]));
  const current = new Map(saved.map(entry => [entry.id, entry]));
  const local = new Set(draft.map(entry => entry.id));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  return [...draft.flatMap(entry => {
    const old = before.get(entry.id);
    if (!old) return [entry];
    const latest = current.get(entry.id);
    if (!latest) return equal(entry, old) ? [] : [entry];
    const result = {...latest};
    for (const key of fields) {
      if (!equal(entry[key], old[key])) result[key] = key === "changes"
        ? mergeScopedChanges(old[key] ?? [], entry[key] ?? [], latest[key] ?? []) : entry[key];
    }
    if (nested) result[nested] = mergeRows(old[nested], entry[nested], latest[nested], ["label", "cost", "changes"]);
    return [result];
  }), ...saved.filter(entry => !before.has(entry.id) && !local.has(entry.id))];
}
export function getRingTemplates(item) {
  const selected = item?.getFlag?.(MODULE_ID, "automation")?.shapes;
  return SHAPES.filter(shape => shape.type === "ring" && (
    Array.isArray(selected) ? selected.includes(shape.key) : itemTemplateSelected(item, shape)
  ));
}
export function exportAutomation(automation, name = sbsI18n("swade-better-templates.UI.Template_0575f29df8")) { return JSON.stringify({module: MODULE_ID, version: 1, name, automation: normalizeAutomation(automation)}, null, 2); }
export function importAutomation(text) {
  if (text.length > 2_000_000) throw new Error(sbsI18n("swade-better-templates.UI.Templatefilesmustbesmallerthan_9aa42bb953"));
  const parsed = JSON.parse(text);
  if (parsed.module && parsed.module !== MODULE_ID) throw new Error(sbsI18n("swade-better-templates.UI.ThisfileisnotaSWADE_2df4cffd61"));
  if ((parsed.version ?? 1) > 1) throw new Error(sbsI18n("swade-better-templates.UI.Thistemplateneedsanewerversion_8eedeb1e5a"));
  const raw = parsed.automation ?? parsed;
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.behaviors)) throw new Error(sbsI18n("swade-better-templates.UI.Invalidtemplateautomationfile_24f8dee5e2"));
  return normalizeAutomation(raw);
}
export function durationSeconds(expiration) { return expiration.enabled && !expiration.removeOnPlacement ? expiration.amount * TIME_UNITS[expiration.unit] : null; }
export function trackerEntryVisible(entry, sceneId, isGM) { return !!sceneId && entry?.sceneId === sceneId && (isGM || !entry.hiddenFromPlayers); }
export function combatExpiry(expiration, combat) {
  if (!expiration.enabled || expiration.removeOnPlacement || !combat?.started) return null;
  const rounds = expiration.currentTurnEnd ? 1 : Math.ceil(durationSeconds(expiration) / 6);
  return {combatId: combat.id, combatantId: combat.combatant?.id ?? null, round: combat.round + (expiration.currentTurnEnd ? 0 : rounds), turn: combat.turn, currentTurnEnd: expiration.currentTurnEnd, remainingRounds: rounds, totalRounds: rounds};
}
export function combatHasExpired(schedule, combat) {
  if (!schedule || schedule.combatId !== combat?.id) return false;
  if (combat.round > schedule.round) return true;
  if (combat.round < schedule.round) return false;
  const index = combat.turns?.findIndex(c => c.id === schedule.combatantId);
  const turn = index >= 0 ? index : schedule.turn;
  return schedule.currentTurnEnd ? combat.turn > turn : combat.turn >= turn;
}
