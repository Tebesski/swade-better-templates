import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createRequire} from "node:module";
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const fixture = JSON.parse(await readFile(new URL("./fixtures/damage-field.json", import.meta.url), "utf8"));
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader"]});
const page = await browser.newPage({viewport: {width: 1440, height: 1000}});
page.on("pageerror", error => console.error("Browser error:", error.stack));
page.on("console", message => { if (message.type() === "error") console.error("Foundry error:", message.text()); });
try {
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: "Gamemaster"});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready);
  assert.equal(await page.evaluate(() => game.world.id), "templates-qa");
  if (!await page.evaluate(() => game.modules.get("swade-better-powers")?.active)) {
    await page.evaluate(async () => { const modules = game.settings.get("core", "moduleConfiguration"); await game.settings.set("core", "moduleConfiguration", {...modules, "swade-better-powers": true}); });
    await page.reload(); await page.waitForFunction(() => globalThis.game?.ready);
  }
  await page.evaluate(async ({automation, unbound}) => {
    const api = game.modules.get("swade-better-templates").api;
    globalThis.fieldQA = {api, prefix: `Damage Field QA ${Date.now()}`};
    const qa = fieldQA;
    qa.scene = await Scene.create({name: qa.prefix, width: 1800, height: 1400, padding: 0, tokenVision: false, grid: {size: 100, distance: 1}});
    await qa.scene.activate(); await qa.scene.view();
    while (!canvas.ready || canvas.scene.id !== qa.scene.id) await new Promise(resolve => setTimeout(resolve, 50));
    qa.actors = await Actor.createDocuments([{name: `${qa.prefix} Caster`, type: "npc", system: {attributes: {spirit: {die: {sides: 12}}}}}, {name: `${qa.prefix} Victim`, type: "npc"}]);
    const [caster, victim] = qa.actors;
    qa.tokens = await qa.scene.createEmbeddedDocuments("Token", [
      {name: "Caster", actorId: caster.id, actorLink: true, x: 400, y: 400},
      {name: "Recipient", actorId: victim.id, actorLink: true, x: 500, y: 400},
      {name: "Diagonal", actorId: victim.id, x: 500, y: 500},
      {name: "Adjacent to field", actorId: victim.id, x: 650, y: 400},
      {name: "Far away", actorId: victim.id, x: 1200, y: 1000}]);
    const tokenOrder = ["Caster", "Recipient", "Diagonal", "Adjacent to field", "Far away"];
    qa.tokens.sort((a, b) => tokenOrder.indexOf(a.name) - tokenOrder.indexOf(b.name));
    while (canvas.tokens.placeables.length !== 5) await new Promise(resolve => setTimeout(resolve, 50));
    qa.combat = await Combat.create({scene: unbound ? null : qa.scene.id, active: true});
    await qa.combat.createEmbeddedDocuments("Combatant", qa.tokens.slice(0, 2).map((token, i) => ({sceneId: qa.scene.id, tokenId: token.id, actorId: token.actorId, initiative: 10 - i})));
    await qa.combat.update({round: 1, turn: 0, "system.awaitingNextRound": false});
    [qa.item] = await caster.createEmbeddedDocuments("Item", [{name: qa.prefix, type: "power", system: {duration: "3"}, flags: {"swade-better-templates": {automation}}}]);
    const {createPowerTimer} = await import("/modules/swade-better-powers/scripts/maintenance.mjs");
    qa.timer = await createPowerTimer(qa.item, {value: 3, units: "rounds"}, {id: foundry.utils.randomID()});
    qa.message = await ChatMessage.create({content: qa.prefix, flags: {"swade-better-powers": {maintainedCast: qa.timer.id}}});
    [qa.region] = await qa.scene.createEmbeddedDocuments("Region", [{name: qa.prefix,
      shapes: [{type: "circle", x: 450, y: 450, radius: 100}], levels: [qa.scene.levels.contents[0].id],
      flags: {swade: {origin: qa.item.uuid, preset: "sbt"}, "swade-better-templates": {placement: {tokenId: qa.tokens[0].id}, chatMessageId: qa.message.id}}}]);
  }, {automation: fixture, unbound: process.env.SBT_QA_UNBOUND_COMBAT === "1"});
  const select = page.locator('select[name="tokenId"]');
  await select.waitFor();
  const options = await select.locator("option").allTextContents();
  assert.equal(options.includes("Far away"), false);
  assert.equal(options.includes("Caster"), true);
  assert.equal(options.includes("Recipient"), true);
  await select.selectOption({label: "Caster"});
  await page.getByRole("button", {name: "Attach", exact: true}).click();
  await page.waitForFunction(() => fieldQA.region.getFlag("swade-better-templates", "managed")?.initialized);
  assert.equal(await page.evaluate(() => fieldQA.region.attachment.token.id === fieldQA.tokens[0].id), true);
  const coverage = await page.evaluate(() => fieldQA.tokens.map(token => ({name: token.name, x: token.x, y: token.y, inside: token.testInsideRegion(fieldQA.region)})));
  assert.deepEqual(coverage.map(token => token.inside), [true, true, true, false, false], JSON.stringify(coverage));
  console.log("PASS attachment dialog limits candidates and centered SBT includes orthogonal and diagonal neighbors");
  await page.evaluate(async () => {
    const qa = fieldQA, token = qa.tokens[2];
    if (!token.regions.has(qa.region)) throw new Error("Diagonal neighbor missing from native region membership");
    await token.move([{x: 700, y: 700}], {animate: false});
    if (token.regions.has(qa.region)) throw new Error("Outside token stayed in region");
    await token.move([{x: 500, y: 500}], {animate: false});
    if (!token.regions.has(qa.region)) throw new Error("Diagonal neighbor did not re-enter region");
  });
  console.log("PASS moving into and out of a diagonal space updates native region membership");
  await page.evaluate(async () => {
    const qa = fieldQA;
    qa.oldMessages = new Set(game.messages.map(message => message.id));
    await qa.combat.nextTurn();
  });
  await page.waitForFunction(() => game.messages.some(message => !fieldQA.oldMessages.has(message.id) && message.getFlag("swade-better-templates", "regionUuid") === fieldQA.region.uuid));
  const damage = await page.evaluate(() => game.messages.filter(message => !fieldQA.oldMessages.has(message.id) && message.getFlag("swade-better-templates", "regionUuid") === fieldQA.region.uuid)
    .map(message => ({formula: message.rolls[0].formula, targets: message.getFlag("swade", "targets").map(target => target.name)})));
  assert.equal(damage.length, 1);
  assert.deepEqual(damage[0].targets.sort(), ["Diagonal", "Recipient"]);
  assert.match(damage[0].formula, /2d4x/);
  console.log("PASS actual Next Turn rolls exported Damage Field once for adjacent victims, excluding caster");
  await page.evaluate(async () => { await fieldQA.tokens[0].move([{x: 600, y: 400}], {animate: false}); });
  await page.waitForFunction(() => fieldQA.region.shapes[0].x === 650);
  console.log("PASS native v14 token movement carries attached template");
  await page.evaluate(async () => {
    const qa = fieldQA;
    const managed = qa.region.getFlag("swade-better-templates", "managed");
    if (managed.powerTimerUuid !== qa.timer.uuid) throw new Error("Template not linked to its power timer");
    await qa.combat.delete(); qa.combat = null;
    await qa.timer.update({start: {time: game.time.worldTime - 20}, "duration.expired": true}, {animate: false});
    await qa.region.update({"flags.swade-better-templates.managed.expiresAt": game.time.worldTime - 1, "flags.swade-better-templates.managed.combatExpiration": null});
    await qa.api.sweepExpiration();
    if (!qa.scene.regions.has(qa.region.id)) throw new Error("Template deleted before Maintain decision");
  });
  await page.getByRole("button", {name: "Maintain", exact: true}).click();
  await page.waitForFunction(() => fieldQA.region.getFlag("swade-better-templates", "managed")?.powerMaintenance === 1);
  assert.equal(await page.evaluate(() => fieldQA.region.getFlag("swade-better-templates", "managed").expiresAt > game.time.worldTime), true);
  console.log("PASS actual Better Powers Maintain dialog refreshes attached template duration");
  await page.evaluate(async () => { await fieldQA.timer.delete(); });
  await page.waitForFunction(() => !fieldQA.scene.regions.has(fieldQA.region.id));
  console.log("PASS ending power timer removes its maintained template");
  const playerName = await page.evaluate(async () => {
    const qa = fieldQA;
    qa.player = await User.create({name: `${qa.prefix} Player`, role: 1, character: qa.actors[0].id});
    await qa.actors[0].update({[`ownership.${qa.player.id}`]: 3});
    qa.oldPermissions = game.settings.get("core", "permissions");
    await game.settings.set("core", "permissions", {...qa.oldPermissions, REGION_CREATE: [1, 2, 3, 4]});
    qa.combat = await Combat.create({scene: null, active: true});
    await qa.combat.createEmbeddedDocuments("Combatant", qa.tokens.slice(0, 2).map((token, i) => ({sceneId: qa.scene.id, tokenId: token.id, actorId: token.actorId, initiative: 10 - i})));
    await qa.combat.update({round: 1, turn: 1, "system.awaitingNextRound": false});
    return qa.player.name;
  });
  const player = await browser.newPage();
  player.on("pageerror", error => console.error("Player error:", error.stack));
  await player.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await player.locator('select[name="userId"]').selectOption({label: playerName});
  await player.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await player.waitForFunction(() => globalThis.game?.ready && globalThis.canvas?.ready);
  await player.evaluate(async () => {
    const item = game.user.character.items.contents.find(item => item.type === "power");
    const {startCast} = await import("/modules/swade-better-powers/scripts/cast-results.mjs");
    const roll = new CONFIG.Dice.TraitRoll("{1d6min6}kh", item.actor.getRollData());
    startCast(roll, item.actor, item, true, 4);
    await roll.evaluate();
    const message = await roll.toMessage({speaker: ChatMessage.getSpeaker({actor: item.actor}), flags: {swade: {item: item.uuid}}});
    for (let n = 0; n < 100 && !message.getFlag("swade-better-powers", "maintainedCast"); n++) await new Promise(resolve => setTimeout(resolve, 50));
    if (!message.getFlag("swade-better-powers", "maintainedCast")) throw new Error("Player cast did not create a power timer");
    await canvas.scene.createEmbeddedDocuments("Region", [{name: "Player attached field", levels: [canvas.level.id],
      shapes: [{type: "circle", x: 650, y: 450, radius: 100}], flags: {swade: {origin: item.uuid, preset: "sbt"}, "swade-better-templates": {chatMessageId: message.id}}}]);
  });
  const playerSelect = player.locator('select[name="tokenId"]');
  await playerSelect.waitFor();
  assert.equal((await playerSelect.locator("option").allTextContents()).includes("Far away"), false);
  await playerSelect.selectOption({label: "Recipient"});
  await player.getByRole("button", {name: "Attach", exact: true}).click();
  await page.waitForFunction(() => fieldQA.scene.regions.some(region => region.attachment.token?.id === fieldQA.tokens[1].id
    && region.getFlag("swade-better-templates", "managed")?.initialized)).catch(async error => {
      console.error("Attachment state:", JSON.stringify(await page.evaluate(() => ({
        recipient: fieldQA.tokens[1].id, regions: fieldQA.scene.regions.map(region => ({name: region.name, attachment: region._source.attachment, managed: region.getFlag("swade-better-templates", "managed")}))
      }))));
      throw error;
    });
  console.log("PASS player-side attachment dialog can choose a nearby recipient without owning that actor");
  await page.evaluate(async () => {
    const qa = fieldQA;
    qa.playerRegion = qa.scene.regions.find(region => region.attachment.token?.id === qa.tokens[1].id);
    const managed = qa.playerRegion.getFlag("swade-better-templates", "managed");
    if (managed.combatExpiration?.combatId !== qa.combat.id) throw new Error("Unbound combat did not create a combat expiry schedule");
    qa.playerTimer = await fromUuid(managed.powerTimerUuid);
    if (!qa.playerTimer || qa.playerTimer.getFlag("swade-better-powers", "timedPower").userId !== qa.player.id) throw new Error("Player cast timer not linked");
    await qa.tokens[0].move([{x: 100, y: 100}], {animate: false});
    await qa.combat.update({round: 2, turn: 0, "system.awaitingNextRound": false});
    qa.beforePlayerDamage = new Set(game.messages.map(message => message.id));
    await qa.combat.nextTurn();
  });
  await page.waitForFunction(() => game.messages.some(message => !fieldQA.beforePlayerDamage.has(message.id) && message.getFlag("swade-better-templates", "regionUuid") === fieldQA.playerRegion.uuid));
  assert.equal(await page.evaluate(() => game.messages.filter(message => !fieldQA.beforePlayerDamage.has(message.id) && message.getFlag("swade-better-templates", "regionUuid") === fieldQA.playerRegion.uuid)
    .every(message => message.getFlag("swade", "targets").length > 0 && message.getFlag("swade", "targets").every(target => target.uuid !== fieldQA.tokens[0].uuid))), true);
  console.log("PASS player cast deals area damage when the placer ends a turn outside the field in an unbound encounter");
  await page.evaluate(async () => {
    const qa = fieldQA;
    if (qa.playerTimer.updateDuration().remaining <= 0) throw new Error("Timer must still be running to test early region expiry");
    await qa.playerRegion.update({"flags.swade-better-templates.managed.combatExpiration.round": qa.combat.round,
      "flags.swade-better-templates.managed.combatExpiration.turn": qa.combat.turn});
    await qa.api.sweepExpiration();
    if (!qa.scene.regions.has(qa.playerRegion.id)) throw new Error("Field expired ahead of the player's power timer");
    await qa.combat.update({round: 4, turn: 1, "system.awaitingNextRound": false});
  });
  assert.equal(await player.getByRole("button", {name: "Maintain", exact: true}).count(), 0);
  assert.equal(await page.evaluate(() => fieldQA.scene.regions.has(fieldQA.playerRegion.id)), true);
  await page.evaluate(async () => { await fieldQA.combat.update({round: 5, turn: 0, "system.awaitingNextRound": false}); });
  await player.getByRole("button", {name: "Maintain", exact: true}).click();
  await page.waitForFunction(() => fieldQA.playerRegion.getFlag("swade-better-templates", "managed")?.powerMaintenance === 1);
  assert.equal(await page.evaluate(() => fieldQA.playerRegion.getFlag("swade-better-templates", "managed").combatExpiration.round > fieldQA.combat.round), true);
  console.log("PASS field survives before the player prompt and actual player Maintain refreshes its combat duration");
  await page.evaluate(async () => { await fieldQA.combat.update({round: 8, turn: 0, "system.awaitingNextRound": false}); });
  await player.getByRole("button", {name: "Let Expire", exact: true}).click();
  await page.waitForFunction(() => !fieldQA.scene.regions.has(fieldQA.playerRegion.id));
  await player.close();
  console.log("PASS player Let Expire removes the field after the decision");
} finally {
  await page.evaluate(async () => {
    const qa = globalThis.fieldQA;
    if (!qa) return;
    for (const app of Object.values(ui.windows)) if (app.close) await app.close({force: true}).catch(() => {});
    if (qa.combat && game.combats.has(qa.combat.id)) await qa.combat.delete();
    await qa.scene?.delete();
    for (const actor of qa.actors ?? []) await actor.delete();
    if (qa.player) await qa.player.delete();
    if (qa.oldPermissions) await game.settings.set("core", "permissions", qa.oldPermissions);
    for (const message of game.messages.filter(message => message.content.includes(qa.prefix) || message.getFlag("swade-better-templates", "regionUuid") === qa.region?.uuid
      || message.getFlag("swade-better-powers", "powerCast")?.actorUuid === qa.actors?.[0]?.uuid)) await message.delete();
  }).catch(error => console.error("QA cleanup:", error.message));
  await browser.close();
}
