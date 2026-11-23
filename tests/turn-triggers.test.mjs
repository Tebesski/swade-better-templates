import test from "node:test";
import assert from "node:assert/strict";
import {behaviorEventMatches, combatantScene, combatIncludesScene} from "../scripts/turn-triggers.mjs";
import {flagsMatch, isPlacerActor, matchesTargetFlags} from "../scripts/integrations.mjs";
import {defaultAutomation, defaultBehavior, exportAutomation, importAutomation} from "../scripts/data.mjs";

test("placer turn events and expiry schedules use token scenes in unbound combat", () => {
  const scene = {id: "field-scene"}, other = {id: "other-scene"};
  const combatant = {token: {parent: scene}, sceneId: scene.id};
  const unbound = {scene: null, combatants: [combatant]};
  assert.equal(combatantScene(unbound, combatant), scene);
  assert.equal(combatIncludesScene(unbound, scene.id), true);
  assert.equal(combatIncludesScene(unbound, other.id), false);
  assert.equal(combatantScene({scene}, {}), scene);
  assert.equal(combatIncludesScene({scene: other, combatants: [combatant]}, scene.id), false);
});

test("reserved placer target flag matches actor identity and cannot be spoofed by a custom flag", () => {
  const placer = {actor: {uuid: "Actor.source"}};
  const linked = {actor: {uuid: "Actor.source"}};
  const other = {actor: {uuid: "Actor.other"}};
  assert.equal(isPlacerActor(linked, placer), true);
  assert.equal(isPlacerActor(other, placer), false);
  assert.equal(isPlacerActor({}, null), false);
  assert.equal(matchesTargetFlags(["wildcard"], "placer,wildcard", "", true), true);
  assert.equal(matchesTargetFlags(["placer"], "placer", "", false), false);
  assert.equal(matchesTargetFlags([], "", "placer", true), false);
  assert.equal(matchesTargetFlags(["placer"], "", "placer", false), true);
});

test("empty and placer-only filters avoid Better Effects lookup", () => {
  const placer = {actor: {uuid: "Actor.source"}};
  const other = {actor: {uuid: "Actor.other"}};
  assert.equal(flagsMatch(other, "", "", placer), true);
  assert.equal(flagsMatch(other, "", "placer", placer), true);
  assert.equal(flagsMatch(placer, "", "placer", placer), false);
  assert.equal(flagsMatch(placer, "placer", "", placer), true);
});

test("placer turn-end events are distinct from affected-token turn-end events", () => {
  const entry = defaultBehavior("rollDamage");
  entry.triggers = ["tokenTurnEnd", "tokenEnter"];
  assert.equal(behaviorEventMatches(entry, "tokenTurnEnd"), true);
  assert.equal(behaviorEventMatches(entry, "sbtPlacerTurnEnd"), false);
  entry.turnEndSource = "placer";
  assert.equal(behaviorEventMatches(entry, "tokenTurnEnd"), false);
  assert.equal(behaviorEventMatches(entry, "sbtPlacerTurnEnd"), true);
  assert.equal(behaviorEventMatches(entry, "tokenEnter"), true);
  entry.triggers = ["tokenEnter"];
  assert.equal(behaviorEventMatches(entry, "sbtPlacerTurnEnd"), false);
});

test("turn-end source survives save/import while legacy and invalid values default to affected", () => {
  const entry = defaultBehavior("requestRoll");
  entry.triggers = ["tokenTurnEnd"];
  for (const source of [undefined, "placer", "invalid"]) {
    entry.turnEndSource = source;
    const restored = importAutomation(exportAutomation({...defaultAutomation(), behaviors: [entry]}));
    assert.equal(restored.behaviors[0].turnEndSource, source === "placer" ? "placer" : "affected");
  }
});

test("turn starts can follow the placer independently of turn ends and survive export", () => {
  const entry = defaultBehavior("rollDamage");
  entry.triggers = ["tokenTurnStart", "tokenTurnEnd"];
  assert.equal(entry.turnStartSource, "affected");
  assert.equal(behaviorEventMatches(entry, "tokenTurnStart"), true);
  assert.equal(behaviorEventMatches(entry, "sbtPlacerTurnStart"), false);
  entry.turnStartSource = "placer";
  const restored = importAutomation(exportAutomation({...defaultAutomation(), behaviors: [entry]})).behaviors[0];
  assert.equal(restored.turnStartSource, "placer");
  assert.equal(behaviorEventMatches(restored, "tokenTurnStart"), false);
  assert.equal(behaviorEventMatches(restored, "sbtPlacerTurnStart"), true);
  assert.equal(behaviorEventMatches(restored, "tokenTurnEnd"), true);
  assert.equal(behaviorEventMatches(restored, "sbtPlacerTurnEnd"), false);
  restored.triggers = ["tokenTurnEnd"];
  assert.equal(behaviorEventMatches(restored, "sbtPlacerTurnStart"), false);
  for (const value of [undefined, "invalid"]) {
    entry.turnStartSource = value;
    assert.equal(importAutomation(exportAutomation({...defaultAutomation(), behaviors: [entry]})).behaviors[0].turnStartSource, "affected");
  }
});
