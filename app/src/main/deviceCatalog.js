/**
 * Catálogo de dispositivos.
 *
 * innerWidth/innerHeight = viewport CSS real do aparelho (pontos).
 * screenRadius           = raio dos cantos da tela.
 * bezel                  = borda preta entre o aro metálico e a tela.
 * bodyRadius (opcional)  = raio externo do corpo, quando não for concêntrico
 *                          à tela (ex.: iPhone SE, que tem tela reta).
 * homeButton (opcional)  = aparelho com botão home físico.
 * notch: "dynamic-island" | "notch" | "punch-hole" | "none"
 *
 * A moldura é desenhada em CSS a partir desses números (ver
 * src/renderer/device-shell e src/shared/deviceGeometry.js).
 */

const IOS_UA =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

const IPAD_UA =
  "Mozilla/5.0 (iPad; CPU OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Mobile/15E148 Safari/604.1";

const ANDROID_UA = (model) =>
  `Mozilla/5.0 (Linux; Android 15; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Mobile Safari/537.36`;

const ANDROID_TABLET_UA = (model) =>
  `Mozilla/5.0 (Linux; Android 15; ${model}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36`;

const iphone = (id, name, w, h, screenRadius, notch, bezel = 10) => ({
  id, name, category: "iphone", os: "ios",
  innerWidth: w, innerHeight: h, pixelRatio: 3, userAgent: IOS_UA,
  notch, screenRadius, bezel: { top: bezel, bottom: bezel, side: bezel },
});

const android = (id, name, model, w, h, screenRadius, bezel = 7) => ({
  id, name, category: "android", os: "android",
  innerWidth: w, innerHeight: h, pixelRatio: 3, userAgent: ANDROID_UA(model),
  notch: "punch-hole", screenRadius, bezel: { top: bezel, bottom: bezel, side: bezel },
});

/** @type {object[]} */
const DEVICES = [
  // ---- iPhone ----
  iphone("iphone-18-pro", "iPhone 18 Pro", 402, 874, 62, "dynamic-island"),
  iphone("iphone-18-pro-max", "iPhone 18 Pro Max", 440, 956, 68, "dynamic-island"),
  iphone("iphone-17-pro", "iPhone 17 Pro", 402, 874, 62, "dynamic-island"),
  iphone("iphone-17-pro-max", "iPhone 17 Pro Max", 440, 956, 68, "dynamic-island"),
  iphone("iphone-17", "iPhone 17", 402, 874, 62, "dynamic-island", 11),
  iphone("iphone-air", "iPhone Air", 420, 912, 63, "dynamic-island", 9),
  iphone("iphone-16-pro", "iPhone 16 Pro", 402, 874, 62, "dynamic-island"),
  iphone("iphone-16-pro-max", "iPhone 16 Pro Max", 440, 956, 68, "dynamic-island"),
  iphone("iphone-16", "iPhone 16", 393, 852, 56, "dynamic-island", 11),
  iphone("iphone-15-pro", "iPhone 14 / 15 Pro", 393, 852, 53, "dynamic-island", 11),
  iphone("iphone-14-13", "iPhone 13 / 14", 390, 844, 46, "notch", 12),
  iphone("iphone-13-mini", "iPhone 12 / 13 mini", 375, 812, 44, "notch", 12),
  iphone("iphone-x", "iPhone X / XS / 11 Pro", 375, 812, 39, "notch", 12),
  {
    id: "iphone-se", name: "iPhone SE (2020/2022)", category: "iphone", os: "ios",
    innerWidth: 375, innerHeight: 667, pixelRatio: 2, userAgent: IOS_UA,
    notch: "none", screenRadius: 0, bodyRadius: 56, homeButton: true,
    bezel: { top: 66, bottom: 66, side: 14 },
  },

  // ---- Android ----
  android("galaxy-s26", "Samsung Galaxy S26", "SM-S941B", 360, 773, 44),
  android("galaxy-s26-ultra", "Samsung Galaxy S26 Ultra", "SM-S948B", 480, 1040, 50),
  android("galaxy-s25", "Samsung Galaxy S25", "SM-S931B", 360, 780, 38),
  android("galaxy-s25-ultra", "Samsung Galaxy S25 Ultra", "SM-S938B", 480, 1040, 21),
  android("pixel-9", "Google Pixel 9", "Pixel 9", 360, 808, 49, 9),
  android("pixel-9-pro", "Google Pixel 9 Pro", "Pixel 9 Pro", 427, 952, 58, 9),
  android("pixel-9-pro-xl", "Google Pixel 9 Pro XL", "Pixel 9 Pro XL", 448, 997, 61, 9),
  android("xiaomi-17", "Xiaomi 17", "25113PN0EG", 407, 885, 64),

  // ---- Tablets ----
  {
    id: "ipad-10", name: "iPad (10ª geração)", category: "tablet", os: "ios",
    innerWidth: 820, innerHeight: 1180, pixelRatio: 2, userAgent: IPAD_UA,
    notch: "none", screenRadius: 18, bezel: { top: 22, bottom: 22, side: 22 },
  },
  {
    id: "ipad-pro-13", name: "iPad Pro 13\"", category: "tablet", os: "ios",
    innerWidth: 1032, innerHeight: 1376, pixelRatio: 2, userAgent: IPAD_UA,
    notch: "none", screenRadius: 18, bezel: { top: 18, bottom: 18, side: 18 },
  },
  {
    id: "galaxy-tab-s9", name: "Samsung Galaxy Tab S9", category: "tablet", os: "android",
    innerWidth: 753, innerHeight: 1205, pixelRatio: 2, userAgent: ANDROID_TABLET_UA("SM-X710"),
    notch: "none", screenRadius: 12, bezel: { top: 16, bottom: 16, side: 16 },
  },
];

function getDeviceById(id) {
  return DEVICES.find((d) => d.id === id) || null;
}

module.exports = { DEVICES, getDeviceById };
