import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {circleIntersectsFootprint, centeredSmallBlastContains, attachmentCandidate} from "../scripts/token-area.mjs";
import {refreshedTemplateTiming, hasActivePowerTimer, linkedPowerTimer} from "../scripts/power-maintenance.mjs";
import {normalizeAutomation, combatHasExpired} from "../scripts/data.mjs";
import {resolveCastOptions} from "../scripts/variants.mjs";

const fixture = JSON.parse(await readFile(new URL("./fixtures/damage-field.json", import.meta.url)));
test("exported Damage Field retains placer turn timing, immunity, modifiers and Heavy Weapon", () => {
  const automation = normalizeAutomation(fixture);
  for (const [modifiers, formula, heavy] of [[[], "2d4x", false], [["damage"], "2d6x", false], [["greater-damage-field"], "3d6x", true]]) {
    const cast = resolveCastOptions(automation, {baseShape: "small", modifiers}).automation;
    const damage = cast.behaviors.filter(entry => entry.type === "rollDamage");
    assert.equal(damage.length, 1);
    assert.equal(damage[0].turnEndSource, "placer");
    assert.equal(damage[0].excludedFlags, "placer");
    assert.equal(damage[0].system.formula, formula);
    assert.equal(damage[0].system.isHeavyWeapon, heavy);
  }
});

test("centered small blast overlaps all eight adjacent footprints but not distant tokens", () => {
  const circle = {x: 450, y: 450, radius: 100};
  for (const dx of [-100, 0, 100]) for (const dy of [-100, 0, 100]) {
    assert.equal(circleIntersectsFootprint(circle, {x: 400 + dx, y: 400 + dy, width: 100, height: 100}), true);
  }
  assert.equal(circleIntersectsFootprint(circle, {x: 650, y: 400, width: 100, height: 100}), false);
  const token = {_source: {x: 500, y: 500, level: "ground", elevation: 0, depth: 0}, getSize: () => ({width: 100, height: 100})};
  const region = {getFlag: () => "sbt", shapes: [{...circle, type: "circle"}], includedInLevel: level => level === "ground",
    elevation: {bottom: 0, top: 10, topInclusive: true}, parent: {grid: {size: 100, distance: 1}, tokens: [{getCenterPoint: () => circle}]},
    polygonTree: {testPoint: () => true}};
  assert.equal(centeredSmallBlastContains(token, region), true);
  assert.equal(centeredSmallBlastContains(token, region, {level: "upstairs"}), false);
  assert.equal(centeredSmallBlastContains(token, region, {elevation: 11}), false);
  region.polygonTree.testPoint = () => false;
  assert.equal(centeredSmallBlastContains(token, region), false);
  const candidate = {...token, actor: {}, hidden: true, testInsideRegion: () => true};
  assert.equal(attachmentCandidate(region, candidate, {isGM: false}), false);
});

test("distant Small Blast candidates skip the scene-wide center search", () => {
  const token = {_source: {x: 900, y: 900, level: "ground", elevation: 0, depth: 0},
    getSize: () => ({width: 100, height: 100})};
  const region = {getFlag: () => "sbt", shapes: [{type: "circle", x: 450, y: 450, radius: 100}],
    includedInLevel: () => true, elevation: {bottom: 0, top: 10, topInclusive: true},
    parent: {grid: {distance: 1}, tokens: {some: () => assert.fail("searched the scene for a distant token")}}};
  assert.equal(centeredSmallBlastContains(token, region), false);
});

test("maintenance restarts the template's duration and combat expiry from the new interval", () => {
  const managed = {durationSeconds: 18, resolvedAutomation: normalizeAutomation(fixture)};
  const combat = {id: "combat", started: true, round: 4, turn: 1, combatant: {id: "caster"}};
  const refreshed = refreshedTemplateTiming(managed, 120, combat);
  assert.equal(refreshed.placedAt, 120);
  assert.equal(refreshed.expiresAt, 138);
  assert.equal(refreshed.combatExpiration.round, 7);
  assert.equal(combatHasExpired(refreshed.combatExpiration, {...combat, round: 6}), false);
  assert.equal(combatHasExpired(refreshed.combatExpiration, {...combat, round: 7}), true);
  const previous = globalThis.foundry;
  let timer = {disabled: false, duration: {expired: false}, updateDuration: () => ({remaining: 0})};
  globalThis.foundry = {utils: {fromUuidSync: () => timer}};
  try {
    assert.equal(hasActivePowerTimer({powerTimerUuid: "timer"}), true);
    timer.updateDuration = () => ({remaining: 2});
    assert.equal(hasActivePowerTimer({powerTimerUuid: "timer"}), true, "a running cast protects the field before the maintenance prompt");
    timer.disabled = true;
    assert.equal(hasActivePowerTimer({powerTimerUuid: "timer"}), false);
    timer = null;
    assert.equal(hasActivePowerTimer({powerTimerUuid: "timer"}), false);
  } finally { globalThis.foundry = previous; }
});
