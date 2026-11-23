import assert from "node:assert/strict";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage();
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => game?.ready);
  assert.equal(await page.evaluate(() => game.world.id), "templates-qa");
  const result = await page.evaluate(async () => {
    const api = game.modules.get("swade-better-templates").api;
    const effects = game.modules.get("swade-better-effects").api;
    const {makeContext, traitAdjustment} = await import("/modules/swade-better-effects/scripts/roll-context.mjs");
    const prefix = `Cover QA ${Date.now()}`;
    const scene = await Scene.create({name: prefix, width: 1600, height: 1200, padding: 0, grid: {size: 100, distance: 1}});
    let actor;
    const results = {};
    try {
      await scene.activate(); await canvas.initializing; await scene.view();
      while (!canvas.ready || canvas.scene?.id !== scene.id) await new Promise(resolve => setTimeout(resolve, 50));
      actor = await Actor.create({name: prefix, type: "npc"});
      const [outside, inside, friend] = await scene.createEmbeddedDocuments("Token", [
        {name: "Outside", actorId: actor.id, actorLink: true, x: 100, y: 400},
        {name: "Inside", actorId: actor.id, actorLink: true, x: 400, y: 400},
        {name: "Friend", actorId: actor.id, actorLink: true, x: 500, y: 400}]);
      while (canvas.tokens.placeables.length !== 3) await new Promise(resolve => setTimeout(resolve, 50));
      const automation = api.defaultAutomation();
      automation.shapes = ["small"]; automation.expiration.enabled = false;
      automation.behaviors = [api.defaultBehavior("addCover")];
      automation.behaviors[0].system.level = "heavy";
      const [item] = await actor.createEmbeddedDocuments("Item", [{name: prefix, type: "power", flags: {"swade-better-templates": {automation}}}]);
      const [region] = await scene.createEmbeddedDocuments("Region", [{name: prefix,
        shapes: [{type: "circle", x: 500, y: 450, radius: 170}], levels: [scene.levels.contents[0].id], flags: {swade: {origin: item.uuid, preset: "sbt"}}}]);
      for (let n = 0; n < 100 && !region.getFlag("swade-better-templates", "managed")?.initialized; n++) await new Promise(resolve => setTimeout(resolve, 50));
      if (!region.getFlag("swade-better-templates", "managed")?.initialized) throw new Error("Region failed to initialize");
      results.targets = [...game.user.targets].map(token => token.id).sort();
      results.expected = [inside.id, friend.id].sort();
      results.flags = [effects.getFlags(inside), effects.getFlags(outside)];
      const attack = source => makeContext(actor, null, ["attack"], {token: source, kind: "trait"});
      const external = attack(outside);
      results.external = traitAdjustment(external, inside);
      results.penaltyFlag = external.attacker.includes("heavy-cover-penalty");
      results.internal = traitAdjustment(attack(friend), inside).value;
      results.outbound = traitAdjustment(attack(inside), outside).value;
      results.nonAttack = traitAdjustment(makeContext(actor, null, [], {token: outside, kind: "trait"}), inside).value;
      const app = api.openBuilder(item);
      await app.render({force: true});
      results.targetCheckbox = !!app.element.querySelector('[data-path="selectTokensOnPlacement"]:checked');
      await app.close();
      await inside.update({x: 1000});
      await new Promise(resolve => setTimeout(resolve, 150));
      results.afterExit = effects.getFlags(inside).includes("heavy-cover");
      await region.delete();
      results.afterDelete = effects.getFlags(friend).includes("heavy-cover");
      automation.expiration.removeOnPlacement = true;
      await item.setFlag("swade-better-templates", "automation", automation);
      await scene.createEmbeddedDocuments("Region", [{name: `${prefix} immediate`,
        shapes: [{type: "circle", x: 550, y: 450, radius: 120}], levels: [scene.levels.contents[0].id], flags: {swade: {origin: item.uuid, preset: "sbt"}}}]);
      for (let n = 0; n < 100 && scene.regions.size; n++) await new Promise(resolve => setTimeout(resolve, 50));
      results.immediateTargets = [...game.user.targets].map(token => token.id);
      results.friendId = friend.id;
      results.remainingRegions = scene.regions.size;
      return results;
    } finally { await scene.delete(); if (actor) await actor.delete(); }
  });
  assert.deepEqual(result.targets, result.expected);
  assert.equal(result.flags[0].includes("heavy-cover"), true);
  assert.equal(result.flags[1].includes("heavy-cover"), false);
  assert.equal(result.external.value, -6);
  assert.equal(result.penaltyFlag, true);
  assert.equal(result.internal, 0);
  assert.equal(result.outbound, 0);
  assert.equal(result.nonAttack, 0);
  assert.equal(result.targetCheckbox, true);
  assert.equal(result.afterExit, false);
  assert.equal(result.afterDelete, false);
  assert.deepEqual(result.immediateTargets, [result.friendId]);
  assert.equal(result.remainingRegions, 0);
  console.log("Cover and placement targeting passed in Foundry v14, including linked tokens, same-zone attacks, exits and immediate removal.");
} finally { await browser.close(); }
