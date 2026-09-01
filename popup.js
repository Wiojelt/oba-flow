const enabled = document.querySelector("#enabled");
const courseAdvanceEnabled = document.querySelector("#courseAdvanceEnabled");
const delayMin = document.querySelector("#delayMin");
const delayMax = document.querySelector("#delayMax");
const delayValue = document.querySelector("#delayValue");
const rangeFill = document.querySelector("#rangeFill");
const saved = document.querySelector("#saved");
let lastActionText = "Son işlem: Henüz işlem yok";

chrome.storage.sync.get({
  enabled: true,
  courseAdvanceEnabled: true,
  delayMinMs: null,
  delayMaxMs: null,
  delayMs: 1000
}, (settings) => {
  enabled.checked = settings.enabled;
  courseAdvanceEnabled.checked = settings.courseAdvanceEnabled;

  const legacyDelay = Math.max(0, Math.min(10000, Number(settings.delayMs) || 1000));
  const minimum = Number.isFinite(settings.delayMinMs)
    ? settings.delayMinMs
    : Math.max(0, legacyDelay - 500);
  const maximum = Number.isFinite(settings.delayMaxMs)
    ? settings.delayMaxMs
    : Math.min(10000, legacyDelay + 500);
  delayMin.value = String(minimum / 1000);
  delayMax.value = String(maximum / 1000);
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

function localizedSeconds(value) {
  return Number(value).toLocaleString("tr-TR", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1
  });
}

function renderDelay() {
  const minimum = Number(delayMin.value);
  const maximum = Number(delayMax.value);
  delayValue.textContent = `${localizedSeconds(minimum)} — ${localizedSeconds(maximum)} sn`;
  rangeFill.style.left = `${minimum * 10}%`;
  rangeFill.style.right = `${100 - maximum * 10}%`;
}

function save() {
  chrome.storage.sync.set({
    enabled: enabled.checked,
    courseAdvanceEnabled: courseAdvanceEnabled.checked,
    delayMinMs: Math.round(Number(delayMin.value) * 1000),
    delayMaxMs: Math.round(Number(delayMax.value) * 1000)
  }, () => {
    saved.textContent = "Kaydedildi";
    setTimeout(() => { saved.textContent = lastActionText; }, 900);
  });
}

function updateMinimum() {
  if (Number(delayMin.value) > Number(delayMax.value)) delayMax.value = delayMin.value;
  renderDelay();
}

function updateMaximum() {
  if (Number(delayMax.value) < Number(delayMin.value)) delayMin.value = delayMax.value;
  renderDelay();
}

enabled.addEventListener("change", save);
courseAdvanceEnabled.addEventListener("change", save);
delayMin.addEventListener("input", updateMinimum);
delayMax.addEventListener("input", updateMaximum);
delayMin.addEventListener("change", save);
delayMax.addEventListener("change", save);
