/**
 * Miniatura do aparelho usada nos cards do seletor. Usa a mesma geometria
 * da janela do simulador (shared/deviceGeometry.js).
 */
function applyDeviceFrame(frameEl, device, scale) {
  const g = window.DeviceGeometry.deviceGeometry(device);
  const inset = (g.rim + device.bezel.side) * scale;

  frameEl.dataset.notch = device.notch;
  frameEl.dataset.os = device.os;
  frameEl.style.width = `${g.bodyW * scale}px`;
  frameEl.style.height = `${g.bodyH * scale}px`;
  frameEl.style.borderRadius = `${g.bodyRadius * scale}px`;
  frameEl.style.padding = `${(g.rim + device.bezel.top) * scale}px ${inset}px ${(g.rim + device.bezel.bottom) * scale}px`;

  const screen = frameEl.querySelector(".phone-frame__screen");
  if (screen) screen.style.borderRadius = `${device.screenRadius * scale}px`;

  const notch = frameEl.querySelector(".phone-frame__notch");
  if (notch) {
    const top = (g.rim + device.bezel.top) * scale;
    if (device.notch === "dynamic-island") {
      Object.assign(notch.style, { top: `${top + 11 * scale}px`, width: `${124 * scale}px`, height: `${36 * scale}px`, borderRadius: "999px" });
    } else if (device.notch === "notch") {
      Object.assign(notch.style, { top: `${top}px`, width: `${162 * scale}px`, height: `${32 * scale}px`, borderRadius: `0 0 ${20 * scale}px ${20 * scale}px` });
    } else if (device.notch === "punch-hole") {
      Object.assign(notch.style, { top: `${top + 11 * scale}px`, width: `${12 * scale}px`, height: `${12 * scale}px`, borderRadius: "50%" });
    }
  }

  const home = frameEl.querySelector(".phone-frame__home-indicator");
  if (home) {
    Object.assign(home.style, {
      bottom: `${(g.rim + device.bezel.bottom + 8) * scale}px`,
      width: `${134 * scale}px`,
      height: `${Math.max(2, 5 * scale)}px`,
    });
  }

  return { outerW: g.bodyW * scale, outerH: g.bodyH * scale };
}
