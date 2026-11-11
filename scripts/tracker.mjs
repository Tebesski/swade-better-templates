// Adapted from PF2e Aztec's Template Wizard; preserve tracker UI and interactions.
import { FLAG_SCOPE, MODULE_ID, trackerEntryVisible } from "./data.mjs";
import { deleteManagedRegion } from "./region-handler.mjs";

const storageKey = () => `${MODULE_ID}.${game.world.id}.${game.user.id}.trackedRegions`;
const positionBaseKey = () => `${MODULE_ID}.${game.world.id}.${game.user.id}.trackerPos`;
const ENTRIES = new Map();

let dockEl = null;
let dockSceneId = null;
let tickHandle = null;

export function trackRegion({
  regionUuid,
  itemName,
  durationSeconds = null,
  durationRounds = null,
  remainingRounds = null,
  totalRounds = null,
  sustained = false,
  placedAt,
  sceneId,
  groupRegionUuids = null,
  hiddenFromPlayers = false
}) {
  ENTRIES.set(regionUuid, {
    itemName,
    durationSeconds,
    durationRounds,
    remainingRounds,
    totalRounds,
    sustained,
    placedAt,
    sceneId,
    hiddenFromPlayers: !!hiddenFromPlayers,
    groupRegionUuids: Array.isArray(groupRegionUuids)
      ? groupRegionUuids.filter((uuid) => typeof uuid === "string" && uuid)
      : null
  });
  persist();
  renderSceneTracker();
}

export function untrackRegion(regionUuid) {
  if (!ENTRIES.has(regionUuid)) return;
  ENTRIES.delete(regionUuid);
  persist();
  renderSceneTracker();
}

export function restoreTrackedRegions() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem(storageKey()) ?? "[]"); }
  catch {}
  for (const e of saved) {
    if (!e?.regionUuid || !foundry.utils.fromUuidSync(e.regionUuid)) continue;
    ENTRIES.set(e.regionUuid, {
      itemName: e.itemName,
      durationSeconds: e.durationSeconds,
      durationRounds: e.durationRounds,
      remainingRounds: e.remainingRounds,
      totalRounds: e.totalRounds,
      sustained: !!e.sustained,
      placedAt: e.placedAt,
      sceneId: e.sceneId,
      hiddenFromPlayers: !!e.hiddenFromPlayers,
      groupRegionUuids: Array.isArray(e.groupRegionUuids)
        ? e.groupRegionUuids.filter((uuid) => typeof uuid === "string" && uuid)
        : null
    });
  }
  for (const scene of game.scenes) syncTrackedRegionsFromScene(scene);
  renderSceneTracker();
  if (!tickHandle) tickHandle = setInterval(tick, 1000);
}

export function registerTrackerCleanup() {
  Hooks.on("canvasTearDown", hideDock);
  Hooks.on("deleteScene", scene => {
    for (const [uuid, entry] of ENTRIES) if (entry.sceneId === scene.id) ENTRIES.delete(uuid);
    persist();
    renderSceneTracker();
  });
  Hooks.on("canvasReady", () => {
    syncTrackedRegionsFromScene(canvas?.scene);
    renderSceneTracker();
  });
  Hooks.on("createRegion", (region) => syncRegionToTracker(region));
  Hooks.on("updateRegion", (region, changes) => {
    if (changes?.flags) syncRegionToTracker(region);
  });
  Hooks.on("deleteRegion", (region) => {
    if (ENTRIES.has(region.uuid)) untrackRegion(region.uuid);
    cleanupDeletedGroupEntry(region);
  });
}

function syncTrackedRegionsFromScene(scene) {
  if (!scene) return;
  for (const region of scene.regions ?? []) syncRegionToTracker(region);
}

function syncRegionToTracker(region) {
  const flag = region?.getFlag?.(FLAG_SCOPE, "managed");
  if (!flag) {
    if (region?.uuid && ENTRIES.has(region.uuid)) untrackRegion(region.uuid);
    return;
  }
  if (flag.trackInTracker === false) {
    if (region?.uuid && ENTRIES.has(region.uuid)) untrackRegion(region.uuid);
    return;
  }
  const placedAt = Number(flag.placedAt ?? game.time.worldTime);
  const hasExpiresAt = flag.expiresAt !== null && flag.expiresAt !== undefined && flag.expiresAt !== "";
  const expiresAt = Number(flag.expiresAt);
  const storedDuration = flag.durationSeconds;
  const durationSeconds = hasExpiresAt && Number.isFinite(expiresAt)
    ? Math.max(0, expiresAt - placedAt)
    : isLimitedDuration(storedDuration)
      ? Math.max(0, Number(storedDuration))
      : null;
  const schedule = flag.combatExpiration;
  const scheduleRemaining = schedule?.remainingRounds ?? flag.remainingRounds;
  const scheduleTotal = schedule?.totalRounds ?? flag.totalRounds;
  const remainingRounds = isLimitedDuration(scheduleRemaining)
    ? Math.max(0, Math.floor(Number(scheduleRemaining)))
    : null;
  const totalRounds = isLimitedDuration(scheduleTotal)
    ? Math.max(1, Math.floor(Number(scheduleTotal)))
    : isLimitedDuration(flag.durationRounds)
      ? Math.max(1, Math.floor(Number(flag.durationRounds)))
      : remainingRounds;
  trackRegion({
    regionUuid: region.uuid,
    itemName: flag.itemName ?? flag.itemUuid ?? "Region",
    durationSeconds,
    durationRounds: flag.durationRounds,
    remainingRounds,
    totalRounds,
    sustained: !!(schedule?.sustained ?? flag.resolvedAutomation?.expiration?.sustained),
    placedAt,
    sceneId: region.parent?.id ?? null,
    groupRegionUuids: flag.contiguousGroupRegionUuids,
    hiddenFromPlayers: !!flag.hiddenFromPlayers
  });
}

function cleanupDeletedGroupEntry(region) {
  const managed = region?.getFlag?.(FLAG_SCOPE, "managed");
  const groupUuids = Array.isArray(managed?.contiguousGroupRegionUuids)
    ? managed.contiguousGroupRegionUuids
    : [];
  if (!groupUuids.length) return;
  const remaining = Array.from(region.parent?.regions ?? []).some(
    (candidate) =>
      candidate.uuid !== region.uuid && groupUuids.includes(candidate.uuid)
  );
  if (remaining) return;
  for (const [uuid, entry] of Array.from(ENTRIES.entries())) {
    const entryGroup = Array.isArray(entry.groupRegionUuids)
      ? entry.groupRegionUuids
      : [];
    if (uuid === region.uuid || entryGroup.some((id) => groupUuids.includes(id))) {
      untrackRegion(uuid);
    }
  }
}

function persist() {
  const list = Array.from(ENTRIES.entries()).map(([regionUuid, v]) => ({
    regionUuid, ...v
  }));
  try { localStorage.setItem(storageKey(), JSON.stringify(list)); }
  catch (e) { undefined; }
}

function currentSceneId() {
  return canvas?.scene?.id ?? null;
}

function positionKey(sceneId = currentSceneId()) {
  return `${positionBaseKey()}.${sceneId ?? "global"}`;
}

function readPosition(sceneId = currentSceneId()) {
  try {
    const scenePosition = localStorage.getItem(positionKey(sceneId));
    if (scenePosition) return JSON.parse(scenePosition);
    return JSON.parse(localStorage.getItem(positionBaseKey()) ?? "null");
  }
  catch { return null; }
}

function writePosition(pos, sceneId = currentSceneId()) {
  try { localStorage.setItem(positionKey(sceneId), JSON.stringify(pos)); }
  catch {}
}

function loc(key) { return game.i18n.localize(key); }

function ensureDock() {
  const sceneId = currentSceneId();
  if (dockEl) {
    if (dockSceneId !== sceneId) applyDockPosition(sceneId);
    dockSceneId = sceneId;
    return;
  }

  dockEl = document.createElement("div");
  dockSceneId = sceneId;
  dockEl.className = "sbt-dock";
  dockEl.innerHTML = `
    <header class="sbt-dock-grip">
      <i class="fa-solid fa-hourglass-half"></i>
      <span class="sbt-dock-title">${loc("SBT.Tracker.Title")}</span>
      <a class="sbt-dock-collapse"
         data-tooltip="${loc("SBT.Tracker.Collapse")}">
        <i class="fa-solid fa-chevron-up"></i>
      </a>
    </header>
    <ul class="sbt-dock-list"></ul>
  `;

  applyDockPosition(sceneId);

  document.body.appendChild(dockEl);
  wireDockDrag();
  wireDockCollapse();
  wireDockActions();
}

function hideDock() {
  if (dockEl?.parentElement) dockEl.remove();
  dockEl = null;
  dockSceneId = null;
}

function applyDockPosition(sceneId = currentSceneId()) {
  if (!dockEl) return;
  const pos = readPosition(sceneId);
  dockEl.style.left = `${pos?.x ?? Math.max(20, window.innerWidth - 320)}px`;
  dockEl.style.top  = `${pos?.y ?? 120}px`;
}

function renderSceneTracker() {
  if (currentSceneEntries().length === 0) {
    hideDock();
    return;
  }
  ensureDock();
  renderRows();
}

function renderRows() {
  if (!dockEl) return;
  const ul = dockEl.querySelector(".sbt-dock-list");
  if (!ul) return;
  const rows = [];
  for (const [uuid, entry] of currentSceneEntries()) rows.push(rowHtml(uuid, entry));
  ul.innerHTML = rows.join("");
}

function currentSceneEntries() {
  const sceneId = currentSceneId();
  return Array.from(ENTRIES.entries()).filter(([_uuid, entry]) =>
    entryVisibleInCurrentScene(entry, sceneId)
  );
}

function entryVisibleInCurrentScene(entry, sceneId = currentSceneId()) {
  return trackerEntryVisible(entry, sceneId, !!game.user?.isGM);
}

function rowHtml(regionUuid, entry) {
  const rounds = entryRounds(entry);
  const time = formatRounds(rounds.remaining, rounds.total, entry.sustained);
  const expired = isLimitedDuration(rounds.remaining) && rounds.remaining <= 0 ? "sbt-expired" : "";
  const sustained = entry.sustained ? "sbt-sustained" : "sbt-unsustained";
  const itemName = entry.itemName ?? "Region";
  const panTooltip = loc("SBT.Tracker.PanToName").replace("{name}", itemName);
  const hiddenFromPlayers = !!entry.hiddenFromPlayers;
  const hiddenIcon = hiddenFromPlayers ? "fa-eye-slash" : "fa-eye";
  const hiddenTooltip = hiddenFromPlayers
    ? loc("SBT.Tracker.ShowToPlayers")
    : loc("SBT.Tracker.HideFromPlayers");
  const gmControls = game.user?.isGM
    ? `<a class="sbt-dock-player-visibility ${hiddenFromPlayers ? "sbt-hidden-from-players" : ""}"
         data-action="toggle-player-visibility"
         data-tooltip="${escapeHTML(hiddenTooltip)}">
        <i class="fa-solid ${hiddenIcon}"></i>
      </a>
      <a data-action="open-settings"
         data-tooltip="${loc("SBT.Tracker.Settings")}">
        <i class="fa-solid fa-gear"></i>
      </a>
      <a class="sbt-dock-delete" data-action="delete"
         data-tooltip="${loc("SBT.Tracker.Delete")}">
        <i class="fa-solid fa-trash"></i>
      </a>`
    : "";
  return `
    <li class="sbt-dock-row ${expired} ${sustained}" data-uuid="${regionUuid}">
      <a class="sbt-dock-name" data-action="pan-to"
         data-tooltip="${escapeHTML(panTooltip)}"><span class="sbt-dock-name-text">${escapeHTML(itemName)}</span></a>
      <span class="sbt-dock-time">${time}</span>
      <a data-action="select-region"
         data-tooltip="${loc("SBT.Tracker.SelectRegion")}">
        <i class="fa-solid fa-arrow-pointer"></i>
      </a>
      ${gmControls}
    </li>
  `;
}

function escapeHTML(s) {
  return String(s ?? "").replace(/[&<>"']/g, c => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[c]);
}

function tick() {
  if (!dockEl || currentSceneEntries().length === 0) return;
  const ul = dockEl.querySelector(".sbt-dock-list");
  for (const li of ul.querySelectorAll(".sbt-dock-row")) {
    const uuid = li.dataset.uuid;
    const entry = ENTRIES.get(uuid);
    if (!entry) continue;
    const rounds = entryRounds(entry);
    const out = li.querySelector(".sbt-dock-time");
    if (out) out.textContent = formatRounds(rounds.remaining, rounds.total, entry.sustained);
    li.classList.toggle(
      "sbt-expired",
      isLimitedDuration(rounds.remaining) && rounds.remaining <= 0
    );
  }
}

function entryRounds(entry) {
  if (isLimitedDuration(entry.remainingRounds)) {
    return {
      remaining: Math.max(0, Math.floor(Number(entry.remainingRounds))),
      total: isLimitedDuration(entry.totalRounds)
        ? Math.max(1, Math.floor(Number(entry.totalRounds)))
        : null
    };
  }
  if (isLimitedDuration(entry.durationSeconds)) {
    const elapsed = Math.max(0, game.time.worldTime - entry.placedAt);
    const remainingSeconds = Math.max(0, entry.durationSeconds - elapsed);
    return {
      remaining: secondsToRounds(remainingSeconds),
      total: isLimitedDuration(entry.totalRounds)
        ? Math.max(1, Math.floor(Number(entry.totalRounds)))
        : secondsToRounds(entry.durationSeconds)
    };
  }
  if (isLimitedDuration(entry.durationRounds)) {
    const rounds = Math.max(0, Math.floor(Number(entry.durationRounds)));
    return { remaining: rounds, total: rounds };
  }
  return { remaining: null, total: null };
}

function formatRounds(remaining, total, sustained = false) {
  if (!isLimitedDuration(remaining)) return "∞";
  const current = Math.max(0, Math.floor(Number(remaining)));
  if (sustained && isLimitedDuration(total)) {
    const max = Math.max(1, Math.floor(Number(total)));
    return `${current} / ${max} rnds`;
  }
  return `${current} ${current === 1 ? "rnd" : "rnds"}`;
}

function isLimitedDuration(value) {
  return value !== null && value !== undefined && Number.isFinite(Number(value));
}

function secondsToRounds(seconds) {
  return Math.max(0, Math.ceil(Math.max(0, Number(seconds) || 0) / 6));
}

function wireDockDrag() {
  const grip = dockEl.querySelector(".sbt-dock-grip");
  let dragging = false, offX = 0, offY = 0;

  grip.addEventListener("pointerdown", (ev) => {
    if (ev.target.closest("a, button")) return;
    dragging = true;
    grip.setPointerCapture(ev.pointerId);
    const r = dockEl.getBoundingClientRect();
    offX = ev.clientX - r.left;
    offY = ev.clientY - r.top;
    dockEl.classList.add("sbt-dock-dragging");
  });

  grip.addEventListener("pointermove", (ev) => {
    if (!dragging) return;
    const x = Math.max(0, Math.min(window.innerWidth - dockEl.offsetWidth, ev.clientX - offX));
    const y = Math.max(0, Math.min(window.innerHeight - dockEl.offsetHeight, ev.clientY - offY));
    dockEl.style.left = `${x}px`;
    dockEl.style.top  = `${y}px`;
  });

  const end = (ev) => {
    if (!dragging) return;
    dragging = false;
    try { grip.releasePointerCapture(ev.pointerId); } catch {}
    dockEl.classList.remove("sbt-dock-dragging");
    writePosition({
      x: parseFloat(dockEl.style.left),
      y: parseFloat(dockEl.style.top)
    }, dockSceneId);
  };
  grip.addEventListener("pointerup", end);
  grip.addEventListener("pointercancel", end);
}

function wireDockCollapse() {
  dockEl.querySelector(".sbt-dock-collapse").addEventListener("click", () => {
    dockEl.classList.toggle("sbt-dock-collapsed");
  });
}

function wireDockActions() {
  dockEl.addEventListener("click", async (ev) => {
    const action = ev.target.closest("[data-action]")?.dataset.action;
    if (!action) return;
    const row = ev.target.closest(".sbt-dock-row");
    if (!row) return;
    const uuid = row.dataset.uuid;
    const region = await fromUuid(uuid).catch(() => null);

    if (action === "pan-to") {
      ev.preventDefault();
      if (!region) {
        ui.notifications?.warn(loc("SBT.Tracker.NotFound"));
        untrackRegion(uuid);
        return;
      }
      await panToRegion(region);
      return;
    }
    if (action === "select-region") {
      ev.preventDefault();
      if (!region) {
        ui.notifications?.warn(loc("SBT.Tracker.NotFound"));
        untrackRegion(uuid);
        return;
      }
      await selectRegion(region);
      return;
    }
    if (action === "open-settings") {
      if (!region) return ui.notifications?.warn(loc("SBT.Tracker.NotFound"));
      region.sheet?.render(true);
      return;
    }
    if (action === "toggle-player-visibility") {
      ev.preventDefault();
      if (!game.user?.isGM) return;
      if (!region) return ui.notifications?.warn(loc("SBT.Tracker.NotFound"));
      const hidden = !ENTRIES.get(uuid)?.hiddenFromPlayers;
      await setHiddenFromPlayers(region, hidden);
      const entry = ENTRIES.get(uuid);
      if (entry) entry.hiddenFromPlayers = hidden;
      persist();
      renderSceneTracker();
      return;
    }
    if (action === "delete") {
      if (!game.user.isGM) return;
      const itemName = ENTRIES.get(uuid)?.itemName ?? loc("SBT.Tracker.UnnamedRegion");
      const confirmed = await dialogConfirm({
        title: loc("SBT.Tracker.DeleteConfirmTitle"),
        content: `<p>${loc("SBT.Tracker.DeleteConfirm").replace("{name}", escapeHTML(itemName))}</p>`
      });
      if (!confirmed) return;
      await deleteManagedRegion(uuid);
      untrackRegion(uuid);
      return;
    }
  });
}

async function setHiddenFromPlayers(region, hidden) {
  const entry = ENTRIES.get(region.uuid);
  const groupUuids = Array.isArray(entry?.groupRegionUuids)
    ? entry.groupRegionUuids
    : [];
  const targets = new Map();
  targets.set(region.uuid, region);
  for (const uuid of groupUuids) {
    const target = await fromUuid(uuid).catch(() => null);
    if (target?.parent) targets.set(target.uuid, target);
  }
  for (const target of targets.values()) {
    const managed = target.getFlag?.(FLAG_SCOPE, "managed");
    if (!managed) continue;
    const next = foundry.utils.deepClone(managed);
    next.hiddenFromPlayers = !!hidden;
    try {
      await target.setFlag(FLAG_SCOPE, "managed", next);
    } catch (_e) {}
  }
}

async function dialogConfirm({ title, content }) {
  const DV2 = foundry?.applications?.api?.DialogV2;
  if (DV2?.confirm) {
    try {
      return await DV2.confirm({
        classes: ["sbt-library-dialog"],
        window: { title },
        content,
        rejectClose: false,
        modal: true
      });
    } catch (_e) {
      return false;
    }
  }
  try {
    return await Dialog.confirm({title, content, defaultYes: false, options: {classes: ["dialog", "sbt-library-dialog"]}});
  } catch (_e) {
    return false;
  }
}

async function selectRegion(region) {
  const scene = region.parent;
  if (!scene) return;
  if (scene.id !== canvas.scene?.id) {
    await scene.view();
    await new Promise(r => requestAnimationFrame(r));
  }
  const layer = canvas.regions;
  if (layer?.activate) layer.activate();
  await panToRegion(region);
  try {
    const obj = region.object;
    if (obj?.control) {
      layer?.releaseAll?.();
      obj.control({ releaseOthers: true });
    } else if (layer?.controllable) {
      layer.controlObject?.(region.object);
    }
  } catch (e) {
    undefined;
  }
}

async function panToRegion(region) {
  const scene = region.parent;
  if (!scene) return;
  if (scene.id !== canvas.scene?.id) {
    await scene.view();
    await new Promise(r => requestAnimationFrame(r));
  }
  const bounds = region.object?.bounds;
  let x, y;
  if (bounds) {
    x = bounds.x + bounds.width / 2;
    y = bounds.y + bounds.height / 2;
  } else {
    const shape = region.shapes?.[0];
    x = shape?.x ?? canvas.dimensions.width / 2;
    y = shape?.y ?? canvas.dimensions.height / 2;
  }
  canvas.animatePan({ x, y, duration: 250 });
}
