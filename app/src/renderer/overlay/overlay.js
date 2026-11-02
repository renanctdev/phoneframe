// Círculo de toque que o usuário vê enquanto grava. Esta janela não entra
// na captura; no vídeo final o editor desenha o próprio indicador.
const touch = document.getElementById("touch");
let size = 34;

function place(el, x, y, s) {
  el.style.width = `${s}px`;
  el.style.height = `${s}px`;
  const t = `translate(${x - s / 2}px, ${y - s / 2}px)`;
  el.style.transform = t;
  return t;
}

window.overlay.onInit((p) => {
  size = Math.max(22, p.size || 34);
});

window.overlay.onCursor(({ x, y, inside, pressed }) => {
  touch.style.opacity = inside ? "1" : "0";
  touch.classList.toggle("pressed", !!pressed);
  place(touch, x, y, pressed ? size * 0.85 : size);
});

window.overlay.onTap(({ x, y }) => {
  const r = document.createElement("div");
  r.className = "ripple";
  r.style.width = `${size}px`;
  r.style.height = `${size}px`;
  r.style.setProperty("--t", `translate(${x - size / 2}px, ${y - size / 2}px)`);
  document.body.appendChild(r);
  r.addEventListener("animationend", () => r.remove());
});
