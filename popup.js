const enabled = document.querySelector("#enabled");
const courseAdvanceEnabled = document.querySelector("#courseAdvanceEnabled");
const delaySeconds = document.querySelector("#delaySeconds");
const delayValue = document.querySelector("#delayValue");
const saved = document.querySelector("#saved");
let lastActionText = "Son işlem: Henüz işlem yok";

chrome.storage.sync.get({ enabled: true, delayMs: 1000, courseAdvanceEnabled: true }, (settings) => {
  enabled.checked = settings.enabled;
  courseAdvanceEnabled.checked = settings.courseAdvanceEnabled;
  delaySeconds.value = String(settings.delayMs / 1000);
  renderDelay();
});

chrome.storage.local.get({ lastAction: null }, ({ lastAction }) => {
  if (lastAction?.text) lastActionText = `Son işlem: ${lastAction.text}`;
  saved.textContent = lastActionText;
});

chrome.storage.onChanged.addListener((changes, areaName) => {
  if (areaName !== "local" || !changes.lastAction?.newValue?.text) return;
  lastActionText = `Son işlem: ${changes.lastAction.newValue.text}`;
  saved.textContent = lastActionText;
});

function renderDelay() {
  const seconds = Number(delaySeconds.value);
  delayValue.textContent = `${seconds.toLocaleString("tr-TR", { minimumFractionDigits: 1 })} sn`;
}

function save() {
  chrome.storage.sync.set({
    enabled: enabled.checked,
    courseAdvanceEnabled: courseAdvanceEnabled.checked,
    delayMs: Math.round(Number(delaySeconds.value) * 1000)
  }, () => {
    saved.textContent = "Kaydedildi";
    setTimeout(() => { saved.textContent = lastActionText; }, 1200);
  });
}

enabled.addEventListener("change", save);
courseAdvanceEnabled.addEventListener("change", save);
delaySeconds.addEventListener("input", renderDelay);
delaySeconds.addEventListener("change", save);
