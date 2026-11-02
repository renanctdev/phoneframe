const devices = window.api.devices;

const grid = document.getElementById("deviceGrid");
const tabsNav = document.getElementById("tabs");
const customPanel = document.getElementById("customPanel");
const urlInput = document.getElementById("urlInput");
const openButton = document.getElementById("openButton");
const errorMessage = document.getElementById("errorMessage");
const customWidth = document.getElementById("customWidth");
const customHeight = document.getElementById("customHeight");

let activeCategory = "iphone";
let selectedDeviceId = null;

function thumbScaleFor(device) {
  const maxBox = 120;
  const g = window.DeviceGeometry.deviceGeometry(device);
  return Math.min(maxBox / g.bodyW, maxBox / g.bodyH, 1);
}

function buildCard(device) {
  const card = document.createElement("div");
  card.className = "device-card" + (device.id === selectedDeviceId ? " selected" : "");
  card.dataset.id = device.id;

  const thumbWrap = document.createElement("div");
  thumbWrap.className = "thumb-wrap";

  const frame = document.createElement("div");
  frame.className = "phone-frame";
  frame.innerHTML = `
    <div class="phone-frame__notch"></div>
    <div class="phone-frame__screen"></div>
    <div class="phone-frame__home-indicator"></div>
  `;
  applyDeviceFrame(frame, device, thumbScaleFor(device));
  thumbWrap.appendChild(frame);

  const name = document.createElement("div");
  name.className = "device-name";
  name.textContent = device.name;

  const dims = document.createElement("div");
  dims.className = "device-dims";
  dims.textContent = `${device.innerWidth}×${device.innerHeight}`;

  card.appendChild(thumbWrap);
  card.appendChild(name);
  card.appendChild(dims);

  card.addEventListener("click", () => {
    selectedDeviceId = device.id;
    renderGrid();
  });
  return card;
}

function renderGrid() {
  grid.innerHTML = "";
  customPanel.hidden = activeCategory !== "custom";
  if (activeCategory === "custom") {
    selectedDeviceId = "custom";
    return;
  }

  const list = devices.filter((d) => d.category === activeCategory);
  for (const device of list) {
    grid.appendChild(buildCard(device));
  }
}

tabsNav.addEventListener("click", (event) => {
  const btn = event.target.closest(".tab");
  if (!btn) return;
  activeCategory = btn.dataset.category;
  selectedDeviceId = activeCategory === "custom" ? "custom" : null;
  [...tabsNav.children].forEach((t) => t.classList.toggle("active", t === btn));
  renderGrid();
});

openButton.addEventListener("click", async () => {
  errorMessage.hidden = true;
  if (!selectedDeviceId) {
    errorMessage.textContent = "Escolha um aparelho primeiro.";
    errorMessage.hidden = false;
    return;
  }
  if (!urlInput.value.trim()) {
    errorMessage.textContent = "Digite o link do site.";
    errorMessage.hidden = false;
    return;
  }

  openButton.disabled = true;
  const result = await window.api.openSimulator(
    selectedDeviceId,
    urlInput.value.trim(),
    customWidth.value,
    customHeight.value
  );
  openButton.disabled = false;

  if (!result.ok) {
    errorMessage.textContent = result.error;
    errorMessage.hidden = false;
  }
});

renderGrid();

document.getElementById("recordingsButton").addEventListener("click", async () => {
  errorMessage.hidden = true;
  const result = await window.api.openRecording();
  if (!result.ok && result.error) {
    errorMessage.textContent = result.error;
    errorMessage.hidden = false;
  }
});
