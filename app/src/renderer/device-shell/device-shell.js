const { deviceGeometry, chromeMetrics } = window.DeviceGeometry;

const phone = document.getElementById("phone");
const body = document.getElementById("body");
const bezel = document.getElementById("bezel");
const screenEl = document.getElementById("screen");
const statusbar = document.getElementById("statusbar");
const island = document.getElementById("island");
const viewport = document.getElementById("viewport");
const address = document.getElementById("address");
const progress = document.getElementById("progress");
const homeArea = document.getElementById("homeArea");
const homeButton = document.getElementById("homeButton");
const backBtn = document.getElementById("backBtn");
const forwardBtn = document.getElementById("forwardBtn");

let webview = null;
let currentUrl = "";
let zoom = 1;

const px = (n) => `${n}px`;

function layout(device) {
  const g = deviceGeometry(device);
  const c = chromeMetrics(device);
  document.body.dataset.os = device.os;
  document.body.dataset.category = device.category;

  phone.style.width = px(g.windowW);
  phone.style.height = px(g.windowH);

  Object.assign(body.style, {
    left: px(g.overhang),
    width: px(g.bodyW),
    height: px(g.bodyH),
    borderRadius: px(g.bodyRadius),
  });

  Object.assign(bezel.style, {
    left: px(g.rim),
    top: px(g.rim),
    width: px(g.bodyW - g.rim * 2),
    height: px(g.bodyH - g.rim * 2),
    borderRadius: px(Math.max(0, g.bodyRadius - g.rim)),
  });

  Object.assign(screenEl.style, {
    left: px(device.bezel.side),
    top: px(device.bezel.top),
    width: px(device.innerWidth),
    height: px(device.innerHeight),
    borderRadius: px(device.screenRadius),
  });

  for (const b of g.buttons) {
    const el = document.createElement("div");
    el.className = "side-button";
    el.style.top = px(Math.round(b.top * g.bodyH));
    el.style.height = px(Math.round(b.height * g.bodyH));
    if (b.side === "left") el.style.left = "0px";
    else el.style.right = "0px";
    phone.insertBefore(el, body);
  }

  const sidePad = Math.max(18, Math.round(device.screenRadius * 0.55));
  Object.assign(statusbar.style, {
    height: px(c.statusBar),
    padding: `0 ${sidePad}px`,
    paddingTop: device.notch === "dynamic-island" ? "4px" : "0",
  });
  island.dataset.kind = device.notch;
  if (device.notch === "punch-hole") island.style.top = px(Math.round((c.statusBar - 12) / 2));

  document.querySelector(".urlbar").style.height = px(c.urlBar);
  document.querySelector(".toolbar").style.height = px(c.toolbar);
  homeArea.style.height = px(c.homeArea);
  homeArea.style.display = c.homeArea ? "flex" : "none";

  if (device.homeButton) {
    homeButton.style.display = "block";
    homeButton.style.top = px(device.bezel.top + device.innerHeight + (device.bezel.bottom - 52) / 2);
  }
}

function startClock() {
  const clock = document.getElementById("clock");
  const tick = () => {
    const now = new Date();
    clock.textContent = `${now.getHours()}:${String(now.getMinutes()).padStart(2, "0")}`;
  };
  tick();
  setInterval(tick, 15000);
}

function displayUrl(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function showAddress() {
  address.value = document.activeElement === address ? currentUrl : displayUrl(currentUrl);
}

function updateNavButtons() {
  if (!webview) return;
  try {
    backBtn.disabled = !webview.canGoBack();
    forwardBtn.disabled = !webview.canGoForward();
  } catch {
    /* webview ainda não pronto */
  }
}

function setProgress(state) {
  if (state === "start") {
    progress.style.opacity = "1";
    progress.style.width = "30%";
    setTimeout(() => {
      if (progress.style.opacity === "1") progress.style.width = "75%";
    }, 300);
  } else {
    progress.style.width = "calc(100% - 20px)";
    setTimeout(() => {
      progress.style.opacity = "0";
      progress.style.width = "0";
    }, 350);
  }
}

// Celulares usam barras de rolagem sobrepostas (invisíveis em repouso).
const MOBILE_CSS = "::-webkit-scrollbar{width:0!important;height:0!important;background:transparent!important}";

function createWebview(device, url) {
  webview = document.createElement("webview");
  webview.setAttribute("partition", "persist:simulador");
  webview.setAttribute("useragent", device.userAgent);
  webview.setAttribute("webpreferences", "contextIsolation=yes, nodeIntegration=no");
  webview.setAttribute("src", url);

  webview.addEventListener("dom-ready", () => {
    // O site deve enxergar a largura real do aparelho (ex.: 402px) mesmo
    // com a janela reduzida para caber na tela.
    webview.setZoomFactor(zoom);
    webview.insertCSS(MOBILE_CSS).catch(() => {});
    // O menu nativo dos <select> não aparece na gravação: desenha-o dentro da página.
    if (window.api.guestSelectScript) webview.executeJavaScript(window.api.guestSelectScript).catch(() => {});
    updateNavButtons();
  });
  webview.addEventListener("did-start-loading", () => setProgress("start"));
  webview.addEventListener("did-stop-loading", () => {
    setProgress("stop");
    updateNavButtons();
  });
  const onNavigate = (e) => {
    if (e.isMainFrame === false) return;
    currentUrl = e.url;
    showAddress();
    updateNavButtons();
  };
  webview.addEventListener("did-navigate", onNavigate);
  webview.addEventListener("did-navigate-in-page", onNavigate);

  viewport.appendChild(webview);
}

async function go() {
  const result = await window.api.normalizeUrl(address.value);
  if (!result.ok) {
    address.value = currentUrl;
    address.blur();
    return;
  }
  currentUrl = result.url;
  webview.loadURL(result.url).catch(() => {});
  address.blur();
}

address.addEventListener("focus", () => {
  address.value = currentUrl;
  address.select();
});
address.addEventListener("blur", showAddress);
address.addEventListener("keydown", (e) => {
  if (e.key === "Enter") go();
  if (e.key === "Escape") address.blur();
});

backBtn.addEventListener("click", () => webview?.canGoBack() && webview.goBack());
forwardBtn.addEventListener("click", () => webview?.canGoForward() && webview.goForward());
document.getElementById("reloadBtn").addEventListener("click", () => webview?.reload());
document.getElementById("deviceBtn").addEventListener("click", () => window.api.changeDevice());
document.getElementById("closeBtn").addEventListener("click", () => window.api.quit());

window.api.onInit(({ device, url, scale }) => {
  zoom = scale;
  currentUrl = url;
  document.title = `PhoneFrame – ${device.name}`;
  layout(device);
  startClock();
  showAddress();
  createWebview(device, url);
});
