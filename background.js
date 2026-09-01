const clicksInFlight = new Set();

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== "oba-flow-real-click") return false;

  const tabId = sender.tab?.id;
  const x = Number(message.x);
  const y = Number(message.y);
  if (!Number.isInteger(tabId) || !Number.isFinite(x) || !Number.isFinite(y)) {
    sendResponse({ ok: false, error: "Geçersiz tıklama hedefi" });
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
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseMoved",
        x,
        y,
        button: "none"
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "left",
        buttons: 1,
        clickCount: 1
      });
      await chrome.debugger.sendCommand(target, "Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "left",
        buttons: 0,
        clickCount: 1
      });
      sendResponse({ ok: true });
    } catch (error) {
      sendResponse({ ok: false, error: String(error?.message || error) });
    } finally {
      clicksInFlight.delete(tabId);
      if (attached) {
        try {
          await chrome.debugger.detach(target);
        } catch {
          // Sekme tıklamayla kapanır veya değişirse bağlantı zaten düşmüş olabilir.
        }
      }
    }
  })();

  return true;
});
