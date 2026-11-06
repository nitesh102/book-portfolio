/* ------------------------------------------------------------------
   Nitesh — book + crane choreography
   ------------------------------------------------------------------ */

const stage = document.querySelector("#stage");
const claw = document.querySelector("#claw");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const configs = new Map();
const books = new Map();
const bookStates = new Map();

document.querySelectorAll(".book").forEach((element) => {
  const id = Number(element.dataset.id);
  const template = element.querySelector(".book-pages");
  const pages = template ? [...template.content.querySelectorAll(".book-page")] : [];

  books.set(id, element);
  configs.set(id, {
    id,
    x: Number(element.dataset.x),
    y: Number(element.dataset.y),
    px: Number(element.dataset.px),
    py: Number(element.dataset.py),
    rx: element.style.getPropertyValue("--rx").trim() || "-10deg",
    ry: element.style.getPropertyValue("--ry").trim() || "-20deg",
    rz: element.style.getPropertyValue("--rz").trim() || "5deg",
  });

  bookStates.set(id, {
    id,
    pages,
    spread: 0,
    spreadCount: Math.max(1, Math.ceil(pages.length / 2)),
    turning: false,
    left: element.querySelector(".page-left .page-inner"),
    right: element.querySelector(".page-right .page-inner"),
    leftFolio: element.querySelector(".page-left .folio"),
    rightFolio: element.querySelector(".page-right .folio"),
    turn: element.querySelector(".turn-sheet"),
    turnFront: element.querySelector(".turn-front .turn-inner"),
    turnBack: element.querySelector(".turn-back .turn-inner"),
    turnFrontFolio: element.querySelector(".turn-front .turn-folio"),
    turnBackFolio: element.querySelector(".turn-back .turn-folio"),
    prev: element.querySelector(".page-prev"),
    next: element.querySelector(".page-next"),
    count: element.querySelector(".page-count"),
  });
});

let layoutState = null;
let held = null;
let heldPhase = null;
let running = false;
let queuedId = null;
let userStarted = false;
let autoTimer = null;

const D = (milliseconds) => (reduceMotion.matches ? 0 : milliseconds);
const wait = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, D(milliseconds)));
const nextFrame = () => new Promise((resolve) => window.requestAnimationFrame(() => resolve()));

function panelOf(element) {
  return element.querySelector(".spread");
}

function headingOf(element) {
  return element.querySelector(".page-left .inside-title, .page-left .page-title");
}

function focusSpread(element) {
  const state = stateOf(element);
  const target = headingOf(element) || (state && state.left);
  if (!target) return;
  target.setAttribute("tabindex", "-1");
  target.focus({ preventScroll: true });
}

function hitOf(element) {
  return element.querySelector(".book-hit");
}

function stateOf(element) {
  return bookStates.get(Number(element.dataset.id));
}

function padPage(number) {
  return String(number).padStart(2, "0");
}

function getShelfPoint(config, metrics) {
  const rawX = (metrics.phone ? config.px : config.x) * metrics.w;
  const rawY = (metrics.phone ? config.py : config.y) * metrics.h;
  const safeX = metrics.pileW / 2 + 6;
  const safeY = metrics.pileH / 2 + 6;
  return {
    x: Math.min(Math.max(rawX, safeX), metrics.w - safeX),
    y: Math.min(Math.max(rawY, safeY), metrics.h - safeY),
  };
}

function getLiftPoint(metrics) {
  return {
    x: metrics.w / 2,
    y: metrics.liftY,
    w: metrics.grownW,
    h: metrics.grownH,
    d: metrics.grownD,
  };
}

function rodFor(centerY, height, metrics) {
  // The finger arms sit 51px below the claw's rail anchor and the book
  // hangs a hair below the arms. This makes the rod meet the cover exactly.
  return Math.max(30, centerY - height / 2 - metrics.clawTop - 52);
}

function fingerHeight(height) {
  return Math.max(38, Math.min(72, height * 0.31));
}

function setDurations(element, duration) {
  element.style.setProperty("--move-dur", `${D(duration)}ms`);
  element.style.setProperty("--size-dur", `${D(duration)}ms`);
  element.style.setProperty("--tilt-dur", `${D(duration)}ms`);
}

function setClawX(x, duration) {
  claw.style.setProperty("--travel-dur", `${D(duration)}ms`);
  claw.style.left = `${x}px`;
}

function setRod(length, duration) {
  claw.style.setProperty("--drop-dur", `${D(duration)}ms`);
  claw.style.setProperty("--rod", `${Math.max(30, length)}px`);
}

function setArm(length, duration) {
  claw.style.setProperty("--span-dur", `${D(duration)}ms`);
  claw.style.setProperty("--arm", `${length}px`);
}

function setFingerHeight(length, duration) {
  claw.style.setProperty("--span-dur", `${D(duration)}ms`);
  claw.style.setProperty("--finger-h", `${length}px`);
}

function setPileTransform(element, config, metrics, duration) {
  const point = getShelfPoint(config, metrics);
  setDurations(element, duration);
  element.style.left = `${point.x}px`;
  element.style.top = `${point.y}px`;
  element.style.setProperty("--cw", `${metrics.pileW}px`);
  element.style.setProperty("--ch", `${metrics.pileH}px`);
  element.style.setProperty("--cd", `${metrics.pileD}px`);
  element.style.setProperty("--rx", config.rx);
  element.style.setProperty("--ry", config.ry);
  element.style.setProperty("--rz", config.rz);
  element.classList.remove("is-open");
}

function setPileZ(element, config, metrics) {
  const point = getShelfPoint(config, metrics);
  const yFraction = metrics.phone ? config.py : config.y;
  element.style.zIndex = String(20 + Math.round(yFraction * 100));
  return point;
}

function setLiftTransform(element, metrics, duration) {
  const lift = getLiftPoint(metrics);
  setDurations(element, duration);
  element.style.left = `${lift.x}px`;
  element.style.top = `${lift.y}px`;
  element.style.setProperty("--cw", `${lift.w}px`);
  element.style.setProperty("--ch", `${lift.h}px`);
  element.style.setProperty("--cd", `${lift.d}px`);
  element.style.setProperty("--rx", "-3deg");
  element.style.setProperty("--ry", "-7deg");
  element.style.setProperty("--rz", "0deg");
  element.style.zIndex = "150";
}

function setCraneForLift(metrics, duration) {
  const lift = getLiftPoint(metrics);
  setClawX(lift.x, duration);
  setRod(rodFor(lift.y, lift.h, metrics), duration);
  setArm(metrics.grownW * 0.62, duration);
  setFingerHeight(fingerHeight(lift.h), duration);
}

/* ------------------------------------------------------------------
   Page rendering + turning
   ------------------------------------------------------------------ */

function pageAt(state, index) {
  return state.pages[index] || null;
}

function innerOf(page) {
  return page ? page.innerHTML : "";
}

function renderSpread(state, index) {
  const last = state.spreadCount - 1;
  const next = Math.min(Math.max(index, 0), last);
  state.spread = next;

  if (state.left) state.left.innerHTML = innerOf(pageAt(state, next * 2));
  if (state.right) state.right.innerHTML = innerOf(pageAt(state, next * 2 + 1));

  if (state.leftFolio) state.leftFolio.textContent = padPage(next * 2 + 1);
  if (state.rightFolio) state.rightFolio.textContent = padPage(next * 2 + 2);

  if (state.count) state.count.textContent = `${next + 1} / ${state.spreadCount}`;

  if (state.prev) {
    const off = next === 0;
    state.prev.setAttribute("aria-disabled", String(off));
    state.prev.tabIndex = off ? -1 : 0;
  }
  if (state.next) {
    const off = next === last;
    state.next.setAttribute("aria-disabled", String(off));
    state.next.tabIndex = off ? -1 : 0;
  }
}

function prepareTurnFaces(state, direction) {
  const i = state.spread;

  if (direction > 0) {
    if (state.turnFront) state.turnFront.innerHTML = innerOf(pageAt(state, i * 2 + 1));
    if (state.turnBack) state.turnBack.innerHTML = innerOf(pageAt(state, i * 2 + 2));
    if (state.right) state.right.innerHTML = innerOf(pageAt(state, i * 2 + 3));
    if (state.turnFrontFolio) state.turnFrontFolio.textContent = padPage(i * 2 + 2);
    if (state.turnBackFolio) state.turnBackFolio.textContent = padPage(i * 2 + 3);
  } else {
    if (state.turnFront) state.turnFront.innerHTML = innerOf(pageAt(state, i * 2 - 1));
    if (state.turnBack) state.turnBack.innerHTML = innerOf(pageAt(state, i * 2));
    if (state.left) state.left.innerHTML = innerOf(pageAt(state, i * 2 - 2));
    if (state.turnFrontFolio) state.turnFrontFolio.textContent = padPage(i * 2);
    if (state.turnBackFolio) state.turnBackFolio.textContent = padPage(i * 2 + 1);
  }
}

async function turnPage(id, direction) {
  const state = bookStates.get(Number(id));
  const element = books.get(Number(id));
  if (!state || !element || state.turning) return;
  if (!element.classList.contains("is-open")) return;

  const target = state.spread + direction;
  if (target < 0 || target >= state.spreadCount) return;

  const sheet = state.turn;
  if (!sheet) return;

  state.turning = true;
  element.classList.add("is-turning");
  const panel = panelOf(element);
  if (panel) panel.setAttribute("aria-busy", "true");
  const refocus =
    state.left?.contains(document.activeElement) ||
    state.right?.contains(document.activeElement);

  prepareTurnFaces(state, direction);

  sheet.style.transition = "none";
  sheet.classList.add("is-visible");
  if (direction < 0) sheet.classList.add("is-flipped");
  else sheet.classList.remove("is-flipped");
  void sheet.offsetWidth;
  sheet.style.transition = "";

  await nextFrame();

  if (direction < 0) sheet.classList.remove("is-flipped");
  else sheet.classList.add("is-flipped");

  await wait(820);

  renderSpread(state, target);

  sheet.style.transition = "none";
  sheet.classList.remove("is-visible");
  sheet.classList.remove("is-flipped");
  void sheet.offsetWidth;
  sheet.style.transition = "";

  state.turning = false;
  element.classList.remove("is-turning");
  if (panel) panel.removeAttribute("aria-busy");
  if (refocus) focusSpread(element);
}

/* ------------------------------------------------------------------
   Open / close
   ------------------------------------------------------------------ */

function setOpen(element, open) {
  const wasOpen = element.classList.contains("is-open");
  const panel = panelOf(element);
  const hit = hitOf(element);
  const state = stateOf(element);

  if (open === wasOpen) {
    if (panel) panel.inert = !open;
    if (hit) {
      hit.setAttribute("aria-expanded", String(open));
      if (open) hit.tabIndex = -1;
    }
    return;
  }

  if (open) {
    element.classList.remove("is-closing");
    element.classList.add("is-open");
    if (state) renderSpread(state, 0);
    if (panel) panel.inert = false;
    if (hit) {
      hit.setAttribute("aria-expanded", "true");
      hit.tabIndex = -1;
    }
  } else {
    element.classList.add("is-closing");
    element.classList.remove("is-open");
    if (panel) panel.inert = true;
    if (hit) hit.setAttribute("aria-expanded", "false");
    if (hit && element !== held) hit.tabIndex = 0;
    if (state) {
      state.spread = 0;
      state.turning = false;
      element.classList.remove("is-turning");
    }
    window.setTimeout(() => element.classList.remove("is-closing"), D(700));
  }
}

/* ------------------------------------------------------------------
   Layout
   ------------------------------------------------------------------ */

function refreshLayoutValues() {
  if (!layoutState) return;
  const metrics = layoutState;
  books.forEach((element, id) => {
    const config = configs.get(id);
    if (!config) return;

    if (element === held && (heldPhase === "open" || heldPhase === "lifting")) {
      setLiftTransform(element, metrics, 0);
    } else if (element === held && heldPhase !== "returning") {
      setPileTransform(element, config, metrics, 0);
    } else if (element !== held) {
      setPileTransform(element, config, metrics, 0);
      setPileZ(element, config, metrics);
    }
  });

  if (held && (heldPhase === "open" || heldPhase === "lifting")) {
    setCraneForLift(metrics, 0);
  } else if (!held && !running) {
    setClawX(metrics.w / 2, 0);
    setRod(Math.min(110, metrics.h * 0.18), 0);
    setArm(metrics.pileW * 0.62, 0);
    setFingerHeight(fingerHeight(metrics.pileH), 0);
  }
}

function layout() {
  if (!stage) return;
  const rect = stage.getBoundingClientRect();
  if (!rect.width || !rect.height) return;

  const phone = window.innerWidth <= 700;
  const ratio = phone ? 1.38 : 1.29;

  const pileW = phone
    ? Math.min(112, rect.width * 0.29)
    : Math.max(140, Math.min(190, rect.width * 0.14));
  const pileH = pileW * ratio;
  const pileD = Math.max(11, pileW * 0.16);

  const maxSpreadW = phone ? rect.width * 0.96 : Math.min(rect.width * 0.72, 860);
  const grownW = Math.min(maxSpreadW / 2, (rect.height * 0.64) / ratio);
  const grownH = grownW * ratio;
  const grownD = Math.max(12, pileD * 0.7);

  const clawTop = parseFloat(getComputedStyle(claw).top) || 40;
  const liftMargin = phone ? 92 : 116;
  const liftY = Math.max(grownH / 2 + liftMargin, rect.height * 0.47);

  layoutState = {
    w: rect.width,
    h: rect.height,
    phone,
    pileW,
    pileH,
    pileD,
    grownW,
    grownH,
    grownD,
    clawTop,
    liftY,
  };

  refreshLayoutValues();
}

/* ------------------------------------------------------------------
   Crane choreography
   ------------------------------------------------------------------ */

async function returnHeldBook() {
  if (!held || !layoutState || heldPhase === "returning") return;

  const element = held;
  const metrics = layoutState;
  const config = configs.get(Number(element.dataset.id));
  const state = stateOf(element);
  heldPhase = "returning";

  if (state && state.turning) await wait(850);

  setOpen(element, false);
  await wait(450);

  const point = getShelfPoint(config, metrics);
  setPileTransform(element, config, metrics, 850);
  setClawX(point.x, 850);
  setRod(rodFor(point.y, metrics.pileH, metrics), 850);
  setArm(metrics.pileW * 0.62, 850);
  setFingerHeight(fingerHeight(metrics.pileH), 850);
  await wait(850);

  claw.classList.add("is-open");
  await wait(420);

  element.classList.remove("is-picked");
  const hit = hitOf(element);
  if (hit) {
    hit.tabIndex = 0;
    hit.focus({ preventScroll: true });
  }
  setPileZ(element, config, metrics);

  held = null;
  heldPhase = null;
}

async function pickBook(id) {
  if (!layoutState) return;

  const element = books.get(Number(id));
  const config = configs.get(Number(id));
  if (!element || !config) return;

  if (element === held && element.classList.contains("is-open")) return;

  if (held) {
    await returnHeldBook();
  }

  const metrics = layoutState;
  const point = getShelfPoint(config, metrics);

  // The previous release has left the fingers open. This also covers the
  // very first automatic pick.
  claw.classList.add("is-open");

  // 1. Travel along the rail, above the selected book.
  setClawX(point.x, 750);
  setRod(Math.min(110, metrics.h * 0.18), 750);
  await wait(750);

  // 2. Drop the open fingers around the book.
  setRod(rodFor(point.y, metrics.pileH, metrics), 560);
  await wait(560);

  // 3. Close the fingers and grip.
  claw.classList.remove("is-open");
  await wait(240);

  held = element;
  heldPhase = "lifting";
  element.classList.add("is-picked");
  element.style.zIndex = "150";
  const hit = hitOf(element);
  if (hit) hit.tabIndex = -1;

  // 4. Lift, straighten and grow the real book dimensions.
  setLiftTransform(element, metrics, 950);
  setCraneForLift(metrics, 950);
  await wait(950);
  if (held !== element || heldPhase === "returning") return;

  heldPhase = "open";

  // 5. Open the cover and reveal the first spread.
  setOpen(element, true);
  await wait(750);
  if (held !== element || heldPhase === "returning") return;

  // 6. Put keyboard focus inside the freshly opened book.
  focusSpread(element);
}

async function runQueue() {
  running = true;
  while (queuedId !== null) {
    const id = queuedId;
    queuedId = null;
    await pickBook(id);
  }
  running = false;
}

function requestPick(id, options = {}) {
  if (!options.auto) {
    userStarted = true;
    if (autoTimer) {
      window.clearTimeout(autoTimer);
      autoTimer = null;
    }
  } else if (userStarted || running || queuedId !== null) {
    return;
  }

  queuedId = Number(id);
  if (!running) runQueue();
}

/* ------------------------------------------------------------------
   Events
   ------------------------------------------------------------------ */

document.querySelectorAll("[data-pick]").forEach((button) => {
  button.addEventListener("click", () => requestPick(button.dataset.pick));
});

books.forEach((element, id) => {
  const hit = hitOf(element);
  if (hit) hit.addEventListener("click", () => requestPick(id));

  const state = bookStates.get(id);
  if (!state) return;

  if (state.prev) {
    state.prev.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.prev.getAttribute("aria-disabled") === "true") return;
      turnPage(id, -1);
    });
  }

  if (state.next) {
    state.next.addEventListener("click", (event) => {
      event.stopPropagation();
      if (state.next.getAttribute("aria-disabled") === "true") return;
      turnPage(id, 1);
    });
  }
});

window.addEventListener("keydown", (event) => {
  if (event.key === "Escape") {
    if (!held || heldPhase === "returning") return;
    event.preventDefault();
    returnHeldBook();
    return;
  }

  if (event.key !== "ArrowRight" && event.key !== "ArrowLeft") return;
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  if (!held || heldPhase !== "open" || !held.classList.contains("is-open")) return;

  event.preventDefault();
  turnPage(Number(held.dataset.id), event.key === "ArrowRight" ? 1 : -1);
});

let resizeFrame = null;
window.addEventListener("resize", () => {
  if (resizeFrame) window.cancelAnimationFrame(resizeFrame);
  resizeFrame = window.requestAnimationFrame(() => {
    resizeFrame = null;
    layout();
  });
});

if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(layout);
}

window.addEventListener("load", layout);
layout();

autoTimer = window.setTimeout(() => {
  autoTimer = null;
  requestPick(1, { auto: true });
}, 500);

