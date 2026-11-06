// Run against a disposable SWADE world with id "templates-qa" and both modules enabled.
// PLAYWRIGHT_MODULE and PLAYWRIGHT_EXECUTABLE may point at an existing installation.
import assert from "node:assert/strict";
import {createRequire} from "node:module";
import {mkdir, readFile} from "node:fs/promises";
const require = createRequire(import.meta.url);
const {chromium} = require(process.env.PLAYWRIGHT_MODULE ?? "playwright");
const moduleId = "swade-better-templates", prefix = `SBT QA ${Date.now()}`;
const browser = await chromium.launch({headless: true, executablePath: process.env.PLAYWRIGHT_EXECUTABLE, args: ["--enable-unsafe-swiftshader", "--autoplay-policy=no-user-gesture-required"]});
const errors = [];
let gm, player;
const pass = message => console.log(`PASS ${message}`);
async function join(name) {
  const page = await browser.newPage({viewport: {width: 1440, height: 1100}});
  page.setDefaultTimeout(10000);
  page.on("pageerror", error => errors.push(error.stack));
  page.on("console", message => { if (message.type() === "error" && message.text().includes(moduleId)) errors.push(message.text()); });
  await page.goto(process.env.FOUNDRY_QA_URL ?? "http://localhost:30001");
  await page.locator('select[name="userId"]').selectOption({label: name});
  await page.getByRole("button", {name: "Join Game Session", exact: true}).click();
  await page.waitForFunction(() => globalThis.game?.ready, null, {timeout: 20000});
  assert.equal(await page.evaluate(() => game.world.id), "templates-qa", "Refusing to modify a non-test world");
  await page.addStyleTag({content: "#notifications {pointer-events:none !important}"});
  return page;
}
async function readyRegion(key) {
  await gm.waitForFunction(key => q[key]?.getFlag("swade-better-templates", "managed")?.initialized, key);
}
try {
  gm = await join("Gamemaster");
  assert.equal(await gm.evaluate(id => game.modules.get(id)?.active, moduleId), true);
  assert.equal(await gm.evaluate(() => game.modules.get("swade-better-effects")?.active), true);
  await gm.evaluate(async ({prefix, moduleId}) => {
    const api = game.modules.get(moduleId).api;
    globalThis.q = {prefix, api, items: [], scenes: [], errors: [], oldScrolling: game.settings.get("core", "scrollingStatusText")};
    // Native status animations continue after document updates. Keep the scene-switch
    // assertions independent of those unrelated animations; scrolling is tested below.
    await game.settings.set("core", "scrollingStatusText", false);
    const originalError = ui.notifications.error.bind(ui.notifications);
    ui.notifications.error = (message, options) => { q.errors.push(message); return originalError(message, options); };
    q.scenes = (await Scene.createDocuments(["A", "B"].map(letter => ({name: `${prefix} ${letter}`, width: 1600, height: 1200, padding: 0, grid: {size: 100, distance: 1, units: "in"}, ownership: {default: 2}})))).sort((a, b) => a.name.localeCompare(b.name));
    await q.scenes[0].activate();
    await canvas.initializing;
    await q.scenes[0].view();
    q.actor = await Actor.create({name: prefix, type: "npc"});
    await q.actor.update({"system.attributes.spirit.die.sides": 12, "system.attributes.spirit.die.modifier": 1});
    const tokens = await q.scenes[0].createEmbeddedDocuments("Token", [400, 1100].map(x => ({name: `${prefix} ${x}`, actorId: q.actor.id, actorLink: true, x, y: 400})));
    q.token = tokens.find(t => t.x === 400); q.otherToken = tokens.find(t => t.x === 1100);
    q.gear = await Item.create({name: `${prefix} Gear`, type: "gear"}); q.items.push(q.gear.id);
    q.effect = await Item.create({name: `${prefix} Ward`, type: "swade-better-effects.effect", effects: [{name: `${prefix} Resistance`, type: "base", system: {changes: []}, flags: {"swade-better-effects": {tags: ["cold"]}}}]}); q.items.push(q.effect.id);
    q.makeRegion = async (key, automation, {x = 450, y = 450, radius = 130} = {}) => {
      const [item] = await q.actor.createEmbeddedDocuments("Item", [{name: `${prefix} ${key}`, type: "power", flags: {[moduleId]: {automation}}}]);
      [q[key]] = await q.scenes[0].createEmbeddedDocuments("Region", [{name: item.name, shapes: [{type: "circle", x, y, radius}], levels: [canvas.level.id], flags: {swade: {origin: item.uuid, preset: "sbt"}}}]);
      return q[key]?.uuid;
    };
    q.gear.sheet.render({force: true});
  }, {prefix, moduleId});
  await gm.waitForFunction(() => canvas.ready && canvas.scene.id === q.scenes[0].id && canvas.tokens.placeables.length === 2);
  await gm.locator('a[data-tab="properties"]').click();
  await gm.locator(`input[name="flags.${moduleId}.templates.medium"]`).check();
  await gm.waitForFunction(() => q.gear.getFlag("swade-better-templates", "templates")?.medium);
  await gm.evaluate(() => q.token.object.control({releaseOthers: true}));
  await gm.locator(".sbt-open-builder").click();
  await gm.locator(".sbt-builder").waitFor();
  assert.deepEqual(await gm.locator(".sbt-builder [data-shape]:checked").evaluateAll(els => els.map(el => el.dataset.shape)), ["medium"]);
  assert.equal(await gm.locator('.sbt-builder [data-path="enabled"]').isChecked(), true);
  await gm.locator('.sbt-builder [data-action="addBehavior"]').click();
  await gm.locator('.sbt-builder [data-action="pickEffect"]').click();
  await gm.locator('.sbe-effect-picker input[type="search"]').fill(prefix);
  assert.equal(await gm.locator(".sbe-effect-picker-results label:visible").count(), 1);
  await gm.locator(".sbe-effect-picker-results label:visible input").check();
  await gm.getByRole("button", {name: "Insert", exact: true}).click();
  await gm.locator(".sbt-effect-preview").waitFor({state: "visible"});
  await gm.locator('.sbt-builder [data-action="aegis"]').click();
  await gm.locator('.sbe-aegis input[name="name"]').fill(`${prefix} Built Effect`);
  await gm.locator('.sbe-aegis button[type="submit"]').click();
  await gm.locator(".sbt-effect-list li").waitFor();
  await gm.locator('.sbt-builder [data-action="save"]').click();
  await gm.waitForFunction(() => q.api.readAutomation(q.gear).behaviors[0]?.system.effects.length === 1);
  await gm.evaluate(() => q.gear.update({"flags.swade-better-templates.templates.large": true}));
  await gm.waitForFunction(() => document.querySelector('.sbt-builder [data-shape="large"]').checked);
  await gm.locator('.sbt-builder [data-shape="small"]').check();
  await gm.locator('.sbt-builder [data-action="save"]').click();
  await gm.waitForFunction(() => q.gear.getFlag("swade-better-templates", "templates")?.small);
  assert.equal(await gm.evaluate(() => game.items.filter(i => i.getFlag("swade-better-templates", "scratch")).length), 0);
  pass("gear Possible Templates, enabled defaults, effect browser and A.E.G.I.S. round trip");

  const downloaded = gm.waitForEvent("download");
  await gm.locator('.sbt-builder [data-action="export"]').click();
  const exported = await readFile(await (await downloaded).path(), "utf8");
  assert.equal(JSON.parse(exported).module, moduleId);
  await gm.locator('.sbt-builder [data-action="import"]').click();
  await gm.locator('.sbt-import [name="json"]').fill(exported);
  await gm.locator('.dialog button[data-action="ok"]').click();
  await gm.locator(".sbt-effect-list li").waitFor();
  pass("JSON export download and builder import");

  await gm.locator('.sbt-builder [data-role="behavior-type"]').selectOption("removeEffect");
  await gm.locator('.sbt-builder [data-action="addBehavior"]').click();
  await gm.locator('.sbt-behavior[data-index="1"] [data-action="pickEffect"]').click();
  await gm.locator('.sbe-effect-picker input[type="search"]').fill("shaken");
  assert.ok(await gm.locator(".sbe-effect-picker-results label:visible").count());
  await gm.locator(".sbe-effect-picker-results label:visible input").first().check();
  await gm.getByRole("button", {name: "Insert", exact: true}).click();
  await gm.locator('.sbt-builder [data-action="saveCompendium"]').click();
  await gm.locator('.dialog [name="name"]').fill(`${prefix} Saved`);
  await gm.locator('.dialog button[data-action="ok"]').click();
  await gm.waitForFunction(name => game.packs.get("world.swade-better-templates")?.index.getName(name), `${prefix} Saved`);
  const catalog = await gm.evaluate(async () => ({effects: (await q.api.effectCatalog()).length, traits: (await q.api.traitCatalog()).length}));
  assert.ok(catalog.effects >= 33); assert.ok(catalog.traits > 5);
  assert.equal(await gm.evaluate(async () => {
    await Item.create({name: `${q.prefix} Compendium Ward`, type: "swade-better-effects.effect", effects: q.effect.effects.map(e => e.toObject())}, {pack: "world.swade-better-templates"});
    return (await q.api.effectCatalog()).some(e => e.name === `${q.prefix} Compendium Ward` && e.group === "Better Templates");
  }), true);
  pass("Add and Remove Effect browsers, skill compendiums, and Templates Compendium save");
  const builder = gm.locator(".sbt-builder");
  await builder.locator('[data-role="behavior-type"]').selectOption("restrict");
  await builder.locator('[data-action="addBehavior"]').click();
  const restriction = builder.locator('.sbt-behavior[data-index="2"]');
  await restriction.locator('[data-action="pickRestriction"]').click();
  const picker = gm.locator(".sbs-picker");
  await picker.locator('[data-linked-attribute="attribute:agility"]').first().check();
  await picker.locator('[data-action="choose"][data-key="attribute:agility"]').first().click();
  await restriction.getByText("agility · All linked Skills", {exact: true}).waitFor();
  await restriction.locator('[data-action="deleteBehavior"]').click();
  await gm.locator('.dialog button[data-action="no"]').click();
  await restriction.waitFor();
  await restriction.locator('[data-action="deleteBehavior"]').click();
  await gm.locator('.dialog button[data-action="yes"]').click();
  await restriction.waitFor({state: "detached"});
  await builder.locator('[data-role="behavior-type"]').selectOption("requestRoll");
  await builder.locator('[data-action="addBehavior"]').click();
  await builder.locator('[data-action="configureRequest"]').click();
  const request = gm.locator(".sbe-roll-request");
  await request.locator('[name="trait"]').fill("Spirit");
  await request.locator('[name="tn"]').fill("@spirit/2");
  assert.equal(await request.locator(".sbe-request-tn-preview").textContent(), "= 7");
  await request.getByRole("button", {name: "Use Request"}).click();
  await builder.getByText("Spirit · TN @spirit/2", {exact: true}).waitFor();
  pass("Better Setting linked skills picker, behavior delete confirmation and Better Effects request editor");
  await builder.locator('[data-path="placementRange.enabled"]').check();
  const maxRange = builder.locator('[data-path="placementRange.max"]');
  await maxRange.fill("@spirit/2");
  assert.equal(await builder.locator('[data-path="placementRange.max"] + output').textContent(), "= 7");
  await maxRange.fill("@spirit/10");
  assert.equal(await builder.locator('[data-path="placementRange.max"] + output').textContent(), "= 2");
  assert.ok(await maxRange.evaluate(input => input.nextElementSibling.getBoundingClientRect().left >= input.getBoundingClientRect().right));
  pass("formula results update to the right of the input and round down");
  await mkdir("test-results", {recursive: true});
  await gm.addStyleTag({content: "#notifications {display:none !important}"});
  await gm.evaluate(() => { document.querySelector(".sbt-tab").scrollTop = 0; });
  await gm.locator(".sbt-builder").screenshot({path: "test-results/builder.png"});
  await gm.evaluate(async () => { for (const app of [...foundry.applications.instances.values()]) if (app.constructor.name === "BetterTemplatesBuilder") await app.close({force: true}); await q.gear.sheet.close(); });
  await gm.evaluate(async () => {
    q.power = await Item.create({name: `${q.prefix} Power`, type: "power", system: {templates: {cone: true, stream: true}}});
    q.items.push(q.power.id);
    q.power.sheet.render({force: true});
  });
  await gm.locator('a[data-tab="properties"]').click();
  const sheetButton = gm.locator(".sbt-open-builder");
  assert.equal(await sheetButton.evaluate(button => {
    const heading = button.parentElement.querySelector("h4");
    const headingBounds = heading.getBoundingClientRect();
    const {paddingLeft, paddingRight} = getComputedStyle(heading);
    const sidebar = button.closest(".swade-item-sheet").querySelector(".sheet-sidebar").getBoundingClientRect();
    const bounds = button.getBoundingClientRect();
    return bounds.left > sidebar.right &&
      Math.abs(bounds.left - headingBounds.left - parseFloat(paddingLeft)) < 1 &&
      Math.abs(bounds.right - headingBounds.right + parseFloat(paddingRight)) < 1 &&
      getComputedStyle(button).animationName === "none" && getComputedStyle(button).transitionDuration === "0s";
  }), true);
  const powerRings = gm.locator('.templates input[name^="flags.swade-better-templates.templates."][name$="Ring"]');
  assert.equal(await powerRings.count(), 3);
  await gm.getByLabel("S Ring", {exact: true}).check();
  await gm.waitForFunction(() => q.power.getFlag("swade-better-templates", "templates")?.smallRing);
  await sheetButton.click();
  assert.deepEqual(await builder.locator('[data-shape]:checked').evaluateAll(els => els.map(el => el.dataset.shape)), ["cone", "stream", "smallRing"]);
  await builder.locator('[data-action="save"]').click();
  await gm.waitForFunction(() => q.power.getFlag("swade-better-templates", "automation"));
  await gm.evaluate(() => q.power.update({"system.templates.medium": true}));
  await gm.waitForFunction(() => document.querySelector('.sbt-builder [data-shape="medium"]').checked);
  await gm.evaluate(() => q.power.update({"flags.swade-better-templates.templates.mediumRing": true}));
  await gm.waitForFunction(() => document.querySelector('.sbt-builder [data-shape="mediumRing"]').checked);
  await builder.locator('[data-shape="stream"]').uncheck();
  await builder.locator('[data-shape="smallRing"]').uncheck();
  await builder.locator('[data-shape="largeRing"]').check();
  await builder.locator('[data-action="save"]').click();
  await gm.waitForFunction(() => q.power.system.templates.stream === false &&
    q.power.getFlag("swade-better-templates", "templates")?.smallRing === false &&
    q.power.getFlag("swade-better-templates", "templates")?.largeRing === true);
  await gm.evaluate(async () => { for (const app of [...foundry.applications.instances.values()]) if (app.constructor.name === "BetterTemplatesBuilder") await app.close({force: true}); await q.power.sheet.close(); });
  pass("native SWADE power shape sync and button alignment");

  await gm.evaluate(async () => {
    const a = q.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.enabled = false;
    const effect = q.api.defaultBehavior("addEffect");
    Object.assign(effect.system, {effectUuid: "status:prone", duration: {enabled: true, amount: 17, unit: "seconds"}});
    a.behaviors = [effect];
    await q.makeRegion("basic", a);
  });
  await readyRegion("basic");
  await gm.waitForFunction(() => q.actor.effects.some(e => e.getFlag("swade-better-templates", "regionUuid") === q.basic.uuid));
  assert.deepEqual(await gm.evaluate(() => {
    const {value, units} = q.actor.effects.find(e => e.getFlag("swade-better-templates", "regionUuid") === q.basic.uuid).duration;
    return [value, units];
  }), [17, "seconds"]);
  await gm.evaluate(async () => { await q.token.update({x: 900, y: 700}, {animate: false}); await q.token.movement.finished; });
  await gm.waitForFunction(() => !q.actor.effects.some(e => e.getFlag("swade-better-templates", "regionUuid") === q.basic.uuid));
  await gm.evaluate(async () => { await q.token.update({x: 400, y: 400}, {animate: false}); await q.token.movement.finished; });
  await gm.waitForFunction(() => q.actor.effects.some(e => e.getFlag("swade-better-templates", "regionUuid") === q.basic.uuid));
  pass("initial effects, leaving cleanup and re-entry application");
  await gm.waitForFunction(() => canvas.ready && canvas.scene.id === q.scenes[0].id && canvas.tokens.placeables.length === 2 && canvas.tokens.placeables.every(t => t.effects?.renderable && t.renderFlags.size === 0));
  await gm.locator(".sbt-dock-row").first().waitFor();
  await gm.evaluate(() => q.scenes[1].view());
  await gm.waitForFunction(() => canvas.ready && canvas.scene.id === q.scenes[1].id);
  assert.equal(await gm.locator(".sbt-dock").count(), 0);
  await gm.evaluate(() => q.scenes[0].view());
  await gm.waitForFunction(() => canvas.ready && canvas.scene.id === q.scenes[0].id);
  await gm.waitForFunction(() => canvas.tokens.placeables.length === 2 && canvas.tokens.placeables.every(t => t.effects?.renderable && t.renderFlags.size === 0));
  assert.equal(await gm.locator(".sbt-dock-row").count(), 1);
  await gm.locator(".sbt-dock").screenshot({path: "test-results/tracker.png"});
  pass("scene A tracker hidden on scene B and restored on scene A");

  await gm.evaluate(async () => {
    const a = q.api.defaultAutomation(); a.shapes = ["small"]; a.expiration = {enabled: true, amount: 10, unit: "seconds", currentTurnEnd: false};
    a.separateRegions = {enabled: true, lights: true, walls: true, tiles: false, audio: false};
    a.behaviors = ["attachLight", "attachWalls", "attachTile", "difficultTerrain", "adjustDarkness"].map(q.api.defaultBehavior);
    a.behaviors.find(b => b.type === "attachTile").system.tile.texture.src = "icons/svg/fire.svg";
    await q.makeRegion("media", a, {x: 1000, y: 800});
  });
  await readyRegion("media");
  await gm.waitForFunction(() => q.media.getFlag("swade-better-templates", "managed")?.contiguousGroupRegionUuids?.length === 3 && q.scenes[0].lights.size && q.scenes[0].walls.size && q.scenes[0].tiles.size);
  await gm.waitForFunction(() => !!q.scenes[0].tiles.contents[0]?.object?.mesh?.mask);
  assert.equal(await gm.locator(".sbt-dock-row").count(), 2);
  assert.deepEqual(await gm.evaluate(() => q.media.behaviors.map(b => b.type).sort()), ["adjustDarknessLevel", "modifyMovementCost"]);
  await gm.evaluate(() => q.media.update({shapes: [{type: "circle", x: 1100, y: 800, radius: 130}]}));
  await gm.waitForFunction(() => q.scenes[0].lights.some(l => Math.abs(l.x - 1100) <= 50));
  await gm.evaluate(() => game.time.advance(11));
  await gm.waitForFunction(() => !q.scenes[0].regions.has(q.media.id) && !q.scenes[0].lights.size && !q.scenes[0].walls.size && !q.scenes[0].tiles.size);
  pass("separate media regions, native darkness and difficult terrain, synchronization and expiration cleanup");

  await gm.evaluate(async () => {
    const a = q.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.enabled = false;
    a.behaviors = ["rollDamage", "rollDice", "rollTrait", "chatMessage"].map(q.api.defaultBehavior);
    for (const b of a.behaviors) b.triggers = ["onPlace"];
    a.behaviors.find(b => b.type === "rollTrait").system.prompt = false;
    a.behaviors.find(b => b.type === "rollDamage").system.flags = "cold";
    a.behaviors.find(b => b.type === "chatMessage").system.text = `${q.prefix} Chat`;
    await q.makeRegion("rolls", a);
  });
  await gm.waitForFunction(() => game.messages.some(m => m.content.includes(`${q.prefix} Chat`)));
  assert.deepEqual(await gm.evaluate(() => game.messages.filter(m => m.flavor.includes(q.prefix)).flatMap(m => m.rolls.map(r => r.constructor.name)).sort()), ["DamageRoll", "Roll", "TraitRoll"]);
  assert.ok(await gm.evaluate(() => game.messages.find(m => m.getFlag("swade-better-templates", "regionUuid") === q.rolls.uuid && m.rolls[0]?.constructor.name === "DamageRoll").getFlag("swade-better-effects", "context").roll.includes("cold")));
  pass("native SWADE damage, dice and trait rolls, Better Effects damage flags and chat");

  await gm.evaluate(async () => {
    await game.settings.set("core", "scrollingStatusText", true);
    q.macro = await Macro.create({name: q.prefix, type: "script", command: "await region.setFlag('swade-better-templates', 'testMacro', actor.name);"});
    const a = q.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.enabled = false;
    a.behaviors = ["executeMacro", "scrollingText", "playSound", "attachSound", "removeEffect", "move", "restrict"].map(q.api.defaultBehavior);
    for (const b of a.behaviors) if (b.type !== "attachSound") b.triggers = ["onPlace"];
    a.behaviors.find(b => b.type === "executeMacro").system.macroUuid = q.macro.uuid;
    a.behaviors.find(b => b.type === "scrollingText").system.duration = 100;
    Object.assign(a.behaviors.find(b => b.type === "playSound").system, {path: "systems/swade/assets/card-flip.wav", volume: 0, loop: true});
    Object.assign(a.behaviors.find(b => b.type === "attachSound").system.sound, {path: "systems/swade/assets/card-flip.wav", volume: 0});
    a.behaviors.find(b => b.type === "removeEffect").system.effect = "status:prone";
    Object.assign(a.behaviors.find(b => b.type === "move").system, {mode: "direction", direction: 0, distance: 1.5});
    Object.assign(a.behaviors.find(b => b.type === "restrict").system, {traits: ["agility"], linkedAttributes: ["agility"], rollFlags: "cold"});
    await q.api.trustAutomation(a); await q.makeRegion("extra", a);
  });
  await gm.waitForFunction(() => q.extra?.getFlag("swade-better-templates", "testMacro") && q.actor.effects.some(e => e.getFlag("swade-better-templates", "restriction") === "traits"));
  assert.equal(await gm.evaluate(() => q.token._source.x), 500);
  assert.equal(await gm.evaluate(() => q.actor.effects.some(e => e.statuses.has("prone"))), false);
  assert.equal(await gm.evaluate(() => q.actor.rollAttribute("agility", {suppressChat: true})), null);
  assert.equal(await gm.evaluate(() => q.scenes[0].sounds.size), 1);
  await gm.evaluate(async () => { await q.api.deleteManagedRegion(q.extra.uuid); await q.token.update({x: 400, y: 400}, {animate: false}); await game.settings.set("core", "scrollingStatusText", false); });
  assert.equal(await gm.evaluate(() => q.scenes[0].sounds.size), 0);
  assert.equal(await gm.evaluate(() => q.actor.effects.filter(e => e.getFlag("swade-better-templates", "restriction")).length), 0);
  pass("macro, scrolling text, attached and looped sound, effect removal, movement and trait restrictions");

  const playerName = `${prefix} Player`;
  await gm.evaluate(async name => {
    q.player = await User.create({name, role: 1, character: q.actor.id});
    await q.actor.update({[`ownership.${q.player.id}`]: 3});
    await game.settings.set("core", "permissions", {...game.settings.get("core", "permissions"), REGION_CREATE: [1, 2, 3, 4]});
    await game.togglePause(false, {broadcast: true});
  }, playerName);
  player = await join(playerName);
  await player.waitForFunction(() => canvas.ready);
  await gm.waitForFunction(name => game.users.getName(name)?.active, playerName);
  await player.evaluate(async prefix => {
    const token = game.scenes.active.tokens.find(t => t.name.startsWith(prefix) && t.x === 400); token.object.control({releaseOthers: true});
    const item = token.actor.items.find(i => i.name.endsWith(" basic"));
    [globalThis.playerRegion] = await canvas.scene.createEmbeddedDocuments("Region", [{name: `${prefix} Player Region`, shapes: [{type: "circle", x: 450, y: 450, radius: 100}], levels: [canvas.level.id], flags: {swade: {origin: item.uuid, preset: "sbt"}}}]);
  }, prefix);
  await player.waitForFunction(() => playerRegion.behaviors.size > 0);
  await gm.evaluate(() => q.api.dispatchRegionEvent(q.rolls, {name: "onPlace", data: {token: q.token}}));
  await gm.waitForFunction(name => game.messages.some(m => m.author?.name === name && m.rolls[0]?.constructor.name === "TraitRoll"), playerName);
  assert.ok(await gm.evaluate(name => game.messages.some(m => m.author?.name === name && m.rolls[0]?.constructor.name === "TraitRoll"), playerName));
  pass("player region placement and GM handoff; trait rolls routed to the player owner");

  await gm.evaluate(async () => {
    const a = q.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.enabled = false;
    await q.actor.update({"system.attributes.spirit.die.sides": 12, "system.attributes.spirit.die.modifier": 1});
    await q.otherToken.update({x: 500, y: 400}, {animate: false});
    a.behaviors = ["requestRoll", "rollDamage", "chatMessage", "executeScript"].map(q.api.defaultBehavior);
    for (const b of a.behaviors) b.triggers = ["onPlace"];
    q.requestFlag = q.prefix.toLowerCase().replaceAll(" ", "-");
    a.behaviors[0].system.request = {trait: "Spirit", tn: "@spirit/2", flags: q.requestFlag, kind: "attribute"};
    a.behaviors[1].system.formula = "@spirit/1.9";
    a.behaviors[2].system.text = `${q.prefix} Shared Chat`;
    a.behaviors[3].system.script = "await region.setFlag('swade-better-templates', 'testScript', actor.name);";
    await q.api.trustAutomation(a); await q.makeRegion("shared", a);
  });
  await readyRegion("shared");
  const shared = await gm.evaluate(() => {
    const requests = game.messages.filter(m => m.getFlag("swade-better-effects", "rollRequest")?.flags.includes(q.requestFlag));
    const damage = game.messages.filter(m => m.getFlag("swade-better-templates", "regionUuid") === q.shared.uuid && m.rolls.length);
    return {
      requests: requests.map(m => m.getFlag("swade-better-effects", "rollRequest").targetNumber),
      damage: damage.map(m => ({total: m.rolls[0].total, targets: m.getFlag("swade", "targets").length})),
      messages: game.messages.filter(m => m.content.includes(`${q.prefix} Shared Chat`)).length,
      script: q.shared.getFlag("swade-better-templates", "testScript")
    };
  });
  assert.deepEqual(shared, {requests: [7], damage: [{total: 7, targets: 2}], messages: 1, script: prefix});
  pass("grouped damage and requests resolve caster formulas and capture both triggering tokens");

  await gm.evaluate(async () => {
    q.combat = await Combat.create({scene: q.scenes[0].id, combatants: [q.token, q.otherToken].map((t, index) => ({tokenId: t.id, actorId: q.actor.id, initiative: 10 - index}))});
    await q.combat.update({round: 1, turn: 0});
    const a = q.api.defaultAutomation(); a.shapes = ["small"]; a.expiration.currentTurnEnd = true; await q.makeRegion("turn", a);
  });
  await readyRegion("turn");
  await gm.evaluate(() => q.combat.update({turn: 1}));
  await gm.waitForFunction(() => !q.scenes[0].regions.has(q.turn.id));
  pass("current-turn expiration in a real SWADE combat");
  assert.deepEqual(await gm.evaluate(() => q.errors), []);
  const nativeDrawRaces = errors.filter(error => error.includes("at RenderFlags.set") && error.includes("at SwadeToken._drawEffects") && !error.includes(`/modules/${moduleId}/`));
  assert.deepEqual(errors.filter(error => !nativeDrawRaces.includes(error)), []);
  if (nativeDrawRaces.length) console.warn(`NOTE Foundry's native token redraw race occurred ${nativeDrawRaces.length} time(s) during headless scene switches. No module errors occurred.`);
  console.log("All Foundry v14 / SWADE integration checks passed.");
} catch (error) {
  if (gm) console.error("QA state:", await gm.evaluate(() => ({errors: globalThis.q?.errors, scene: canvas.scene?.id, expectedScene: q.scenes[0]?.id, ready: canvas.ready, loading: canvas.loading, tokens: canvas.tokens?.placeables?.length,
    token: q?.token ? {source: q.token._source, movement: {state: q.token.movement.state}} : null,
    basic: q?.basic ? {active: q.basic.behaviors.map(b => ({type: b.type, active: b.active})), tokens: [...q.basic.tokens].map(t => t.id), managed: q.basic.getFlag("swade-better-templates", "managed")} : null})).catch(() => null));
  throw error;
} finally {
  await player?.close().catch(() => {});
  if (gm) await gm.evaluate(async () => {
    if (game.world.id !== "templates-qa" || !globalThis.q) return;
    await q.combat?.delete().catch(() => {});
    await q.macro?.delete().catch(() => {});
    await game.settings.set("core", "scrollingStatusText", q.oldScrolling);
    for (const scene of q.scenes ?? []) for (const region of [...scene.regions]) if (region.getFlag("swade-better-templates", "managed")?.trackInTracker !== false) await q.api.deleteManagedRegion(region.uuid);
    const pack = game.packs.get("world.swade-better-templates");
    if (pack) { const index = await pack.getIndex(); const ids = index.filter(i => i.name.startsWith(q.prefix)).map(i => i._id); if (ids.length) await Item.deleteDocuments(ids, {pack: pack.collection}); }
    if (q.items?.length) await Item.deleteDocuments(q.items.filter(id => game.items.has(id)));
    if (q.scenes?.length) await Scene.deleteDocuments(q.scenes.map(s => s.id).filter(id => game.scenes.has(id)));
    await q.actor?.delete(); await q.player?.delete();
  }).catch(error => console.error("QA cleanup:", error));
  await browser.close();
}
