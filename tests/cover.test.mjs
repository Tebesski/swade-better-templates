import test from "node:test";
import assert from "node:assert/strict";
import {coverAgainst, COVER_LEVELS, placementTokens, selectPlacementTokens} from "../scripts/cover.mjs";
import {defaultAutomation, defaultBehavior, exportAutomation, importAutomation} from "../scripts/data.mjs";

test("instant placement targets geometry even before membership is cached and after deletion", async () => {
  const inside = {id: "inside", testInsideRegion: () => true};
  const outside = {id: "outside", testInsideRegion: () => false};
  const region = {parent: {id: "scene", tokens: [inside, outside]}, tokens: new Set()};
  assert.deepEqual(placementTokens(region), [inside]);
  const previousGame = globalThis.game, previousCanvas = globalThis.canvas;
  const selected = [];
  globalThis.game = {user: {id: "gm"}};
  globalThis.canvas = {scene: {id: "scene"}, tokens: {setTargets: ids => selected.push(ids)}};
  try {
    await selectPlacementTokens(region, game.user);
    const ids = placementTokens(region).map(token => token.id);
    region.parent.tokens = [];
    await selectPlacementTokens(region, game.user, ids);
    assert.deepEqual(selected, [["inside"], ["inside"]]);
  } finally { globalThis.game = previousGame; globalThis.canvas = previousCanvas; }
});

test("cover applies only across zone boundaries and overlaps use the strongest cover", () => {
  const light = {regionUuid: "Scene.A.Region.light", level: "light"};
  const heavy = {regionUuid: "Scene.A.Region.heavy", level: "heavy"};
  for (const [level, penalty] of Object.entries({light: -2, medium: -4, heavy: -6, "near-total": -8})) {
    const zone = {...light, level};
    assert.equal(COVER_LEVELS[coverAgainst([], [zone]).level].penalty, penalty);
    assert.equal(coverAgainst([zone], [zone]), null);
  }
  assert.equal(coverAgainst([], [light, heavy]), heavy);
  assert.equal(coverAgainst([heavy], [light, heavy]), light);
  assert.equal(coverAgainst([light], [heavy]), heavy);
  assert.equal(coverAgainst([heavy], []), null);
});

test("cover levels and opt-out placement targeting survive export and legacy defaults", () => {
  assert.equal(defaultAutomation().selectTokensOnPlacement, true);
  const behavior = defaultBehavior("addCover");
  assert.deepEqual(behavior.triggers, ["whileWithin"]);
  behavior.system.level = "near-total";
  const restored = importAutomation(exportAutomation({...defaultAutomation(), selectTokensOnPlacement: false, behaviors: [behavior]}));
  assert.equal(restored.selectTokensOnPlacement, false);
  assert.equal(restored.behaviors[0].system.level, "near-total");
});
