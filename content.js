(() => {
  "use strict";

  const DEFAULTS = {
    enabled: true,
    delayMs: 1000,
    courseAdvanceEnabled: true
  };

  const NEXT_LABELS = [
    "ileri",
    "devam",
    "devam et",
    "sonraki",
    "sonraki video",
    "sonraki ders",
    "eğitime devam et",
    "başlamak için tıklayınız.",
    "başlamak için tıklayınız"
  ];

  let settings = { ...DEFAULTS };
  let lastHandledVideo = null;
  let lastHandledAt = 0;
  let scanTimer = null;
  let clickTimer = null;
  let lastClickedElement = null;
  let lastClickAt = 0;
  let lastClickedUrl = "";
  let courseAdvanceTimer = null;
  let lastCourseNavigation = "";

  chrome.storage.sync.get(DEFAULTS, (saved) => {
    settings = { ...DEFAULTS, ...saved };
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    if (changes.enabled) settings.enabled = changes.enabled.newValue;
    if (changes.delayMs) settings.delayMs = changes.delayMs.newValue;
    if (changes.courseAdvanceEnabled) {
      settings.courseAdvanceEnabled = changes.courseAdvanceEnabled.newValue;
    }
  });

  function normalize(value) {
    return String(value || "")
      .replace(/\s+/g, " ")
      .trim()
      .toLocaleLowerCase("tr-TR")
      .replace(/[›»→]+$/g, "")
      .trim();
  }

  function visible(element) {
    if (!(element instanceof HTMLElement)) return false;
    const style = getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.display !== "none" &&
      style.visibility !== "hidden" &&
      style.opacity !== "0" &&
      rect.width > 0 &&
      rect.height > 0;
  }

  function enabled(element) {
    if (!(element instanceof HTMLElement)) return false;
    let current = element;
    let depth = 0;

    while (current && current !== document.body && depth < 10) {
      const className = String(current.className || "").toLocaleLowerCase("tr-TR");
      if (current.matches?.(":disabled, [disabled]")) return false;
      if (current.getAttribute?.("aria-disabled") === "true") return false;
      if (/disabled|pasif|inactive/.test(className)) return false;
      if (getComputedStyle(current).pointerEvents === "none") return false;
      current = current.parentElement;
      depth += 1;
    }

    return true;
  }

  function labelOf(element) {
    if (element instanceof HTMLInputElement) return normalize(element.value);
    return normalize(
      element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      element.textContent
    );
  }

  function scoreCandidate(element) {
    const label = labelOf(element);
    const index = NEXT_LABELS.findIndex((wanted) =>
      label === wanted || label.startsWith(`${wanted} `)
    );
    if (index < 0 || !visible(element) || !enabled(element)) return -1;

    let score = 100 - index;
    if (element.tagName === "BUTTON") score += 20;
    if (element.getAttribute("role") === "button") score += 10;

    const rect = element.getBoundingClientRect();
    score += Math.min(10, Math.max(0, rect.left / Math.max(innerWidth, 1) * 10));
    return score;
  }

  function resolveClickTarget(seed) {
    let current = seed;
    let classBasedTarget = seed;
    let depth = 0;

    while (current && current !== document.body && depth < 10) {
      if (current.matches?.("button, a[href], input, [role='button']")) {
        return current;
      }

      const className = String(current.className || "").toLocaleLowerCase("tr-TR");
      if (classBasedTarget === seed && /(^|[\s_-])(btn|button|next)([\s_-]|$)/.test(className)) {
        classBasedTarget = current;
      }

      current = current.parentElement;
      depth += 1;
    }

    // Özel oynatıcı tıklamayı üst öğede dinliyorsa span.click() olayı
    // yukarı kabarcıklanır; uygun kapsayıcı bulunduysa doğrudan onu kullanırız.
    return classBasedTarget;
  }

  function findNextButton() {
    const selectors = [
      "button",
      "a[href]",
      "[role='button']",
      "input[type='button']",
      "input[type='submit']",
      "span[data-ref='label']",
      ".view-content"
    ];

    const resolved = [...document.querySelectorAll(selectors.join(","))]
      .filter((seed) => {
        const label = labelOf(seed);
        return NEXT_LABELS.some((wanted) => label === wanted || label.startsWith(`${wanted} `));
      })
      .map(resolveClickTarget);

    return [...new Set(resolved)]
      .map((element) => ({ element, score: scoreCandidate(element) }))
      .filter(({ score }) => score >= 0)
      .sort((a, b) => b.score - a.score)[0]?.element || null;
  }

  function normalizedPath(value) {
    try {
      return new URL(value, location.href).pathname.replace(/\/$/, "");
    } catch {
      return "";
    }
  }

  function courseItemCompleted(link) {
    const unit = link.closest(".meta-info-unit");
    if (!unit) return false;
    return [...unit.querySelectorAll(".material-icons")]
      .some((icon) => normalize(icon.textContent).includes("check_circle"));
  }

  function courseItemUnlocked(link) {
    const unit = link.closest(".meta-info-unit");
    const classNames = `${link.className || ""} ${unit?.className || ""}`
      .toLocaleLowerCase("tr-TR");
    return !classNames.includes("isdisabled") &&
      link.getAttribute("aria-disabled") !== "true";
  }

  function findNextCourseItem() {
    if (window.top !== window) return null;

    const links = [...document.querySelectorAll("a.course-player-object-item[href]")];
    const currentPath = normalizedPath(location.href);
    const currentIndex = links.findIndex((link) => normalizedPath(link.href) === currentPath);
    if (currentIndex < 0) return null;

    const current = links[currentIndex];
    if (!courseItemCompleted(current)) return null;

    const next = links[currentIndex + 1];
    if (!next || !courseItemUnlocked(next)) return null;
    return next;
  }

  function scheduleCourseAdvance() {
    if (!settings.enabled || !settings.courseAdvanceEnabled || window.top !== window) return;
    const next = findNextCourseItem();
    if (!next || courseAdvanceTimer || normalizedPath(next.href) === lastCourseNavigation) return;

    courseAdvanceTimer = setTimeout(() => {
      courseAdvanceTimer = null;
      if (!settings.enabled || !settings.courseAdvanceEnabled) return;
      const stillNext = findNextCourseItem();
      if (!stillNext) return;

      lastCourseNavigation = normalizedPath(stillNext.href);
      showStatus("ÖBA Flow: sıradaki içeriğe geçiliyor");
      stillNext.click();
    }, Math.max(0, Number(settings.delayMs) || 0));
  }

  function showStatus(message) {
    if (window.top !== window) return;

    let badge = document.querySelector("#mebbis-video-next-status");
    if (!badge) {
      badge = document.createElement("div");
      badge.id = "mebbis-video-next-status";
      Object.assign(badge.style, {
        position: "fixed",
        right: "12px",
        bottom: "12px",
        zIndex: "2147483647",
        padding: "7px 10px",
        borderRadius: "7px",
        background: "rgba(23, 32, 42, .88)",
        color: "#fff",
        font: "12px/1.3 system-ui, sans-serif",
        boxShadow: "0 2px 10px rgba(0,0,0,.25)",
        pointerEvents: "none",
        transition: "opacity .2s ease"
      });
      document.documentElement.appendChild(badge);
    }

    badge.textContent = message;
    badge.style.opacity = "1";
    clearTimeout(showStatus.hideTimer);
    showStatus.hideTimer = setTimeout(() => { badge.style.opacity = "0"; }, 2500);
  }

  function safeClick(button) {
    const now = Date.now();
    const sameUnchangedButton = button === lastClickedElement &&
      location.href === lastClickedUrl &&
      now - lastClickAt < 15000;
    if (sameUnchangedButton) return false;

    lastClickedElement = button;
    lastClickAt = now;
    lastClickedUrl = location.href;
    button.scrollIntoView({ block: "center", behavior: "smooth" });
    button.click();
    const clickedLabel = labelOf(button);
    showStatus(clickedLabel.startsWith("başlamak için")
      ? "ÖBA Flow: içerik başlatıldı"
      : "ÖBA Flow: İLERİ tıklandı");
    console.info("[MEBBIS Video Sonunda İleri] Tıklandı:", labelOf(button));
    return true;
  }

  function scheduleActiveButtonClick() {
    if (!settings.enabled || clickTimer) return;
    const button = findNextButton();
    if (!button) return;

    clickTimer = setTimeout(() => {
      clickTimer = null;
      if (!settings.enabled) return;
      const stillActive = findNextButton();
      if (stillActive) safeClick(stillActive);
    }, Math.max(0, Number(settings.delayMs) || 0));
  }

  function scanSoon() {
    clearTimeout(scanTimer);
    scanTimer = setTimeout(() => {
      scheduleActiveButtonClick();
      scheduleCourseAdvance();
    }, 80);
  }

  function clickWhenReady(attempt = 0) {
    if (!settings.enabled) return;

    const button = findNextButton();
    if (button) {
      safeClick(button);
      return;
    }

    // Bazı oynatıcılar düğmeyi video biter bitmez değil, birkaç saniye sonra açıyor.
    if (attempt < 24) {
      setTimeout(() => clickWhenReady(attempt + 1), 500);
    } else {
      console.info("[MEBBIS Video Sonunda İleri] Etkin İleri/Devam düğmesi bulunamadı.");
    }
  }

  function videoReallyEnded(video) {
    if (!(video instanceof HTMLVideoElement)) return false;
    if (video.ended) return true;
    return Number.isFinite(video.duration) &&
      video.duration > 0 &&
      video.currentTime >= video.duration - 0.25;
  }

  document.addEventListener("ended", (event) => {
    const video = event.target;
    if (!settings.enabled || !videoReallyEnded(video)) return;

    const now = Date.now();
    if (video === lastHandledVideo && now - lastHandledAt < 5000) return;
    lastHandledVideo = video;
    lastHandledAt = now;

    setTimeout(() => clickWhenReady(), Math.max(0, Number(settings.delayMs) || 0));
  }, true);

  // ÖBA'nın bazı oynatıcıları standart video `ended` olayını üst sayfaya
  // iletmiyor. Bu nedenle düğmenin pasiften aktife geçişini de doğrudan izleriz.
  const observer = new MutationObserver(scanSoon);
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["class", "disabled", "aria-disabled", "style"]
  });

  setInterval(() => {
    scheduleActiveButtonClick();
    scheduleCourseAdvance();
  }, 750);
  setTimeout(() => {
    showStatus("ÖBA Flow 2.0.1 hazır");
    scheduleActiveButtonClick();
    scheduleCourseAdvance();
  }, 400);

  console.info("[MEBBIS Video Sonunda İleri] Hazır.");
})();
