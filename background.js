const clicksInFlight = new Set();

chrome.runtime.onInstalled.addListener(() => chrome.storage.local.remove("diagnosticLogs"));

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

function setLastAction(text, ok = true) {
  chrome.storage.local.set({ lastAction: { text, ok, time: Date.now() } });
}

function normalizedUrl(value) {
  try {
    const url = new URL(value);
    return `${url.origin}${url.pathname}${url.search}`;
  } catch {
    return String(value || "");
  }
}

function flattenFrames(frameTree, result = []) {
  if (!frameTree?.frame) return result;
  result.push(frameTree.frame);
  for (const child of frameTree.childFrames || []) flattenFrames(child, result);
  return result;
}

function quadArea(quad) {
  if (!Array.isArray(quad) || quad.length !== 8) return 0;
  let sum = 0;
  for (let index = 0; index < 4; index += 1) {
    const next = (index + 1) % 4;
    sum += quad[index * 2] * quad[next * 2 + 1] - quad[next * 2] * quad[index * 2 + 1];
  }
  return Math.abs(sum / 2);
}

function quadCenter(quad) {
  return { x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4, y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4 };
}

function pointInQuad(quad, u, v) {
  const topX = quad[0] + (quad[2] - quad[0]) * u;
  const topY = quad[1] + (quad[3] - quad[1]) * u;
  const bottomX = quad[6] + (quad[4] - quad[6]) * u;
  const bottomY = quad[7] + (quad[5] - quad[7]) * u;
  return { x: topX + (bottomX - topX) * v, y: topY + (bottomY - topY) * v };
}

async function viewportSize(target, frameId) {
  const { executionContextId } = await chrome.debugger.sendCommand(target, "Page.createIsolatedWorld", {
    frameId,
    worldName: `oba-flow-viewport-${Date.now()}`
  });
  const result = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
    contextId: executionContextId,
    expression: "({ width: window.innerWidth, height: window.innerHeight })",
    returnByValue: true
  });
  return result?.result?.value || { width: 1, height: 1 };
}

async function mapFramePointToMain(target, framesById, frameId, localPoint) {
  let currentFrame = framesById.get(frameId);
  let point = localPoint;
  while (currentFrame?.parentId) {
    const viewport = await viewportSize(target, currentFrame.id);
    const owner = await chrome.debugger.sendCommand(target, "DOM.getFrameOwner", { frameId: currentFrame.id });
    const { model } = await chrome.debugger.sendCommand(target, "DOM.getBoxModel", { backendNodeId: owner.backendNodeId });
    const content = model?.content;
    if (!content || quadArea(content) < 1) throw new Error("SCORM çerçeve alanı görünür değil");
    point = pointInQuad(
      content,
      Math.max(0, Math.min(1, point.x / Math.max(1, viewport.width))),
      Math.max(0, Math.min(1, point.y / Math.max(1, viewport.height)))
    );
    currentFrame = framesById.get(currentFrame.parentId);
  }
  return point;
}

const START_HOST_EXPRESSION = `(() => {
  const normalize = value => String(value || "").replace(/\\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
  const visible = element => {
    const rect = element.getBoundingClientRect();
    const style = getComputedStyle(element);
    return rect.width > 2 && rect.height > 2 && style.display !== "none" && style.visibility !== "hidden" && Number(style.opacity || 1) > 0;
  };
  return [...document.querySelectorAll(".slide-object-vectorshape[data-acc-text], [data-acc-text]")].find(element => {
    const label = normalize(element.getAttribute("data-acc-text"));
    return visible(element) && (label === "başlamak için tıklayınız." || label === "başlamak için tıklayınız");
  }) || null;
})()`;

async function createStorySession(target, frameUrl) {
  const { frameTree } = await chrome.debugger.sendCommand(target, "Page.getFrameTree");
  const wantedUrl = normalizedUrl(frameUrl);
  const frames = flattenFrames(frameTree);
  const frame = frames.find((item) => normalizedUrl(item.url) === wantedUrl) ||
    frames.find((item) => normalizedUrl(item.url).includes("/uploads/scorm-packages/") && item.url.includes("index_lms.html"));
  if (!frame) throw new Error("SCORM çerçevesi bulunamadı");
  const { executionContextId } = await chrome.debugger.sendCommand(target, "Page.createIsolatedWorld", {
    frameId: frame.id,
    worldName: `oba-flow-click-${Date.now()}`
  });
  return { frame, framesById: new Map(frames.map((item) => [item.id, item])), executionContextId };
}

async function evaluateStory(target, session, expression, returnByValue = false) {
  return chrome.debugger.sendCommand(target, "Runtime.evaluate", {
    expression,
    contextId: session.executionContextId,
    objectGroup: "oba-flow-click",
    returnByValue,
    awaitPromise: false
  });
}

async function findStoryHost(target, session) {
  const evaluation = await evaluateStory(target, session, START_HOST_EXPRESSION);
  const objectId = evaluation?.result?.objectId;
  return objectId && evaluation.result.subtype !== "null" ? objectId : null;
}

async function storyStartStillVisible(target, session) {
  const result = await evaluateStory(target, session, `Boolean(${START_HOST_EXPRESSION})`, true);
  return Boolean(result?.result?.value);
}

async function resolveStoryStartPoint(target, session) {
  const hostObjectId = await findStoryHost(target, session);
  if (!hostObjectId) throw new Error("Başlangıç katmanı bulunamadı");
  const targetResult = await chrome.debugger.sendCommand(target, "Runtime.callFunctionOn", {
    objectId: hostObjectId,
    objectGroup: "oba-flow-click",
    returnByValue: false,
    functionDeclaration: `function () {
      return this.querySelector("path[data-accepts='events']") || this.querySelector("g[data-accepts='events'] path") ||
        this.querySelector("[data-accepts='events']") || this;
    }`
  });
  const objectId = targetResult?.result?.objectId;
  if (!objectId) throw new Error("Başlangıç SVG öğesi bulunamadı");
  await chrome.debugger.sendCommand(target, "DOM.scrollIntoViewIfNeeded", { objectId });
  const { quads } = await chrome.debugger.sendCommand(target, "DOM.getContentQuads", { objectId });
  const quad = (quads || []).filter((item) => quadArea(item) > 1)
    .sort((left, right) => quadArea(right) - quadArea(left))[0];
  if (!quad) throw new Error("Başlangıç SVG alanı görünür değil");
  return mapFramePointToMain(target, session.framesById, session.frame.id, quadCenter(quad));
}

async function dispatchMouseActivation(target, session) {
  let point = await resolveStoryStartPoint(target, session);
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseMoved", x: point.x, y: point.y, button: "none", pointerType: "mouse"
  });
  await wait(120);
  point = await resolveStoryStartPoint(target, session);
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mousePressed", x: point.x, y: point.y, button: "left", buttons: 1, clickCount: 1, pointerType: "mouse"
  });
  await wait(130);
  try {
    point = await resolveStoryStartPoint(target, session);
  } catch {
    // Storyline basılma sırasında SVG yolunu değiştirebilir; aynı noktada bırak.
  }
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseReleased", x: point.x, y: point.y, button: "left", buttons: 0, clickCount: 1, pointerType: "mouse"
  });
}

async function dispatchTapActivation(target, session) {
  const point = await resolveStoryStartPoint(target, session);
  await chrome.debugger.sendCommand(target, "Input.synthesizeTapGesture", {
    x: point.x, y: point.y, duration: 120, tapCount: 1, gestureSourceType: "touch"
  });
}

async function dispatchKeyboardActivation(target, session) {
  const hostObjectId = await findStoryHost(target, session);
  if (!hostObjectId) return;
  const result = await chrome.debugger.sendCommand(target, "Runtime.callFunctionOn", {
    objectId: hostObjectId,
    objectGroup: "oba-flow-click",
    returnByValue: false,
    functionDeclaration: `function () {
      const modelId = this.getAttribute("data-model-id") || "";
      return [...document.querySelectorAll("button.acc-shadow-el, button[data-represents]")]
        .find(button => modelId && String(button.getAttribute("data-represents") || "").includes(modelId)) || null;
    }`
  });
  const buttonObjectId = result?.result?.objectId;
  if (!buttonObjectId || result.result.subtype === "null") return;
  await chrome.debugger.sendCommand(target, "DOM.focus", { objectId: buttonObjectId });
  const key = { key: "Enter", code: "Enter", windowsVirtualKeyCode: 13, nativeVirtualKeyCode: 13 };
  await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "rawKeyDown", ...key });
  await wait(60);
  await chrome.debugger.sendCommand(target, "Input.dispatchKeyEvent", { type: "keyUp", ...key });
}

async function activateStoryStart(target, session) {
  await dispatchMouseActivation(target, session);
  await wait(350);
  if (!await storyStartStillVisible(target, session)) return "Fare ile başlatıldı";
  await dispatchTapActivation(target, session);
  await wait(450);
  if (!await storyStartStillVisible(target, session)) return "Dokunma ile başlatıldı";
  await dispatchKeyboardActivation(target, session);
  await wait(450);
  if (!await storyStartStillVisible(target, session)) return "Klavye ile başlatıldı";
  throw new Error("Başlangıç katmanı girdiyi kabul etmedi");
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === "oba-flow-frame-ready") {
    if (message.isScormFrame) setLastAction("Oynatıcıya bağlandı");
    return false;
  }
  if (message?.type !== "oba-flow-real-click") return false;
  const tabId = sender.tab?.id;
  if (!Number.isInteger(tabId)) {
    sendResponse({ ok: false, error: "Geçersiz sekme" });
    return false;
  }
  if (clicksInFlight.has(tabId)) {
    sendResponse({ ok: false, error: "Tıklama zaten işleniyor" });
    return false;
  }
  clicksInFlight.add(tabId);
  const target = { tabId };
  (async () => {
    let attached = false;
    try {
      setLastAction("Başlatma düğmesi işleniyor…");
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      const session = await createStorySession(target, sender.url);
      const result = await activateStoryStart(target, session);
      await chrome.debugger.sendCommand(target, "Runtime.releaseObjectGroup", { objectGroup: "oba-flow-click" });
      setLastAction(result);
      sendResponse({ ok: true });
    } catch (error) {
      const messageText = String(error?.message || error);
      setLastAction(messageText, false);
      sendResponse({ ok: false, error: messageText });
    } finally {
      clicksInFlight.delete(tabId);
      if (attached) {
        try {
          await chrome.debugger.detach(target);
        } catch {
          // Sekme değişirse bağlantı zaten kapanmış olabilir.
        }
      }
    }
  })();
  return true;
});
