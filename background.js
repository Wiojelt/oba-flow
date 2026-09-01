const clicksInFlight = new Set();

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove("diagnosticLogs");
});

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
  return {
    x: (quad[0] + quad[2] + quad[4] + quad[6]) / 4,
    y: (quad[1] + quad[3] + quad[5] + quad[7]) / 4
  };
}

async function resolveStoryStartPoint(target, frameUrl) {
  const { frameTree } = await chrome.debugger.sendCommand(target, "Page.getFrameTree");
  const wantedUrl = normalizedUrl(frameUrl);
  const frames = flattenFrames(frameTree);
  const frame = frames.find((item) => normalizedUrl(item.url) === wantedUrl) ||
    frames.find((item) => normalizedUrl(item.url).includes("/uploads/scorm-packages/") && item.url.includes("index_lms.html"));
  if (!frame) throw new Error("SCORM çerçevesi bulunamadı");

  const { executionContextId } = await chrome.debugger.sendCommand(target, "Page.createIsolatedWorld", {
    frameId: frame.id,
    worldName: `oba-flow-${Date.now()}`
  });

  const expression = `(() => {
    const normalize = value => String(value || "").replace(/\\s+/g, " ").trim().toLocaleLowerCase("tr-TR");
    const hosts = [...document.querySelectorAll(".slide-object-vectorshape[data-acc-text], [data-acc-text]")];
    const host = hosts.find(element => {
      const label = normalize(element.getAttribute("data-acc-text"));
      return label === "başlamak için tıklayınız." || label === "başlamak için tıklayınız";
    });
    if (!host) return null;
    return host.querySelector("path[data-accepts='events']") ||
      host.querySelector("g[data-accepts='events'] path") ||
      host.querySelector("[data-accepts='events']") ||
      host;
  })()`;

  const evaluation = await chrome.debugger.sendCommand(target, "Runtime.evaluate", {
    expression,
    contextId: executionContextId,
    objectGroup: "oba-flow-click",
    returnByValue: false,
    awaitPromise: false
  });
  const objectId = evaluation?.result?.objectId;
  if (!objectId || evaluation.result.subtype === "null") {
    throw new Error("Başlangıç SVG öğesi bulunamadı");
  }

  await chrome.debugger.sendCommand(target, "DOM.scrollIntoViewIfNeeded", { objectId });
  const { quads } = await chrome.debugger.sendCommand(target, "DOM.getContentQuads", { objectId });
  const quad = (quads || []).filter((item) => quadArea(item) > 1)
    .sort((left, right) => quadArea(right) - quadArea(left))[0];
  if (!quad) throw new Error("Başlangıç SVG alanı görünür değil");
  return quadCenter(quad);
}

async function dispatchRealClick(target, point) {
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseMoved",
    x: point.x,
    y: point.y,
    button: "none",
    pointerType: "mouse"
  });
  await new Promise((resolve) => setTimeout(resolve, 80));
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mousePressed",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 1,
    clickCount: 1,
    pointerType: "mouse"
  });
  await new Promise((resolve) => setTimeout(resolve, 90));
  await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
    type: "mouseReleased",
    x: point.x,
    y: point.y,
    button: "left",
    buttons: 0,
    clickCount: 1,
    pointerType: "mouse"
  });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
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
      await chrome.debugger.attach(target, "1.3");
      attached = true;
      const point = await resolveStoryStartPoint(target, sender.url);
      await dispatchRealClick(target, point);
      await chrome.debugger.sendCommand(target, "Runtime.releaseObjectGroup", { objectGroup: "oba-flow-click" });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
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
