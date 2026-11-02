/**
 * Geometria da moldura e da interface do navegador simulado.
 * Compartilhado entre o processo principal (tamanho da janela) e o
 * renderer (layout do celular), para os dois usarem os mesmos números.
 * Todos os valores estão em "pontos de design" (tamanho real, sem escala).
 */
(function (root) {
  const RIM = 4; // aro metálico
  const BUTTON_OVERHANG = 3; // quanto os botões laterais saltam do corpo

  /** Botões laterais: posição/altura como fração da altura do corpo. */
  function sideButtonsFor(device) {
    if (device.category === "tablet") return [];
    if (device.homeButton) {
      return [
        { side: "left", top: 0.13, height: 0.035 },
        { side: "left", top: 0.2, height: 0.06 },
        { side: "left", top: 0.28, height: 0.06 },
        { side: "right", top: 0.2, height: 0.07 },
      ];
    }
    if (device.os === "ios") {
      return [
        { side: "left", top: 0.155, height: 0.036 },
        { side: "left", top: 0.215, height: 0.066 },
        { side: "left", top: 0.295, height: 0.066 },
        { side: "right", top: 0.245, height: 0.105 },
      ];
    }
    return [
      { side: "right", top: 0.2, height: 0.11 },
      { side: "right", top: 0.35, height: 0.06 },
    ];
  }

  function deviceGeometry(device) {
    const { bezel } = device;
    const bodyW = device.innerWidth + bezel.side * 2 + RIM * 2;
    const bodyH = device.innerHeight + bezel.top + bezel.bottom + RIM * 2;
    const bodyRadius = device.bodyRadius ?? device.screenRadius + bezel.side + RIM;
    const buttons = sideButtonsFor(device);
    const overhang = buttons.length ? BUTTON_OVERHANG : 0;
    return {
      rim: RIM,
      overhang,
      bodyW,
      bodyH,
      bodyRadius,
      buttons,
      windowW: bodyW + overhang * 2,
      windowH: bodyH,
    };
  }

  /** Alturas das barras do navegador simulado (estilo Safari / Chrome). */
  function chromeMetrics(device) {
    const ios = device.os === "ios";
    const tablet = device.category === "tablet";
    let statusBar;
    if (device.notch === "dynamic-island") statusBar = 54;
    else if (device.notch === "notch") statusBar = 47;
    else if (device.notch === "punch-hole") statusBar = 34;
    else statusBar = tablet ? 24 : ios ? 20 : 28;

    return {
      statusBar,
      urlBar: ios ? 46 : 56,
      toolbar: ios ? 46 : 50,
      homeArea: device.homeButton ? 0 : ios ? (tablet ? 20 : 30) : 20,
    };
  }

  const api = { deviceGeometry, chromeMetrics };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DeviceGeometry = api;
})(this);
