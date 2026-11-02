// Painel lateral: ajustes do vídeo (sem seleção) ou da região selecionada.
import { GRADIENTS, TRACK_LABELS } from "./project.js";
import { fmtTime } from "./timeline.js";

const SPEEDS = [0.25, 0.5, 0.75, 1.5, 2, 3, 4];

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") node.className = v;
    else if (k === "text") node.textContent = v;
    else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) node.setAttribute(k, v === true ? "" : v);
  }
  for (const c of [].concat(children)) if (c) node.append(c);
  return node;
}

export class Inspector {
  /**
   * @param {HTMLElement} root
   * @param {import('./project.js').Store} store
   * @param {{seek:(ms:number)=>void, generateZooms:()=>number, chooseBackground:(file:File)=>Promise<void>, getDuration:()=>number}} host
   */
  constructor(root, store, host) {
    this.root = root;
    this.store = store;
    this.host = host;
    store.subscribe((reason) => {
      if (reason === "inspector") return;
      this.render();
    });
    this.render();
  }

  /** Mudança vinda deste painel (não reconstrói o painel, para não perder o foco). */
  set(mutator, commit = true) {
    this.store.change(mutator, { commit, reason: "inspector" });
  }

  setRegion(fn, commit = true) {
    const sel = this.store.selection;
    if (!sel) return;
    this.set((e) => {
      const r = e[sel.track].find((x) => x.id === sel.id);
      if (r) fn(r);
    }, commit);
  }

  // ---- controles -----------------------------------------------------------
  section(title, children) {
    return el("section", { class: "insp-section" }, [el("h3", { text: title }), ...children]);
  }

  row(label, control, hint) {
    return el("label", { class: "insp-row" }, [el("span", { class: "insp-row__label", text: label }), control, hint ? el("small", { text: hint }) : null]);
  }

  range(label, value, { min, max, step, format = (v) => String(v) }, apply) {
    const out = el("span", { class: "insp-value", text: format(value) });
    const input = el("input", { type: "range", min, max, step, value });
    input.addEventListener("input", () => {
      out.textContent = format(Number(input.value));
      apply(Number(input.value), false);
    });
    input.addEventListener("change", () => apply(Number(input.value), true));
    return el("div", { class: "insp-row insp-row--range" }, [el("span", { class: "insp-row__label", text: label }), input, out]);
  }

  toggle(label, checked, apply) {
    const input = el("input", { type: "checkbox", checked });
    input.addEventListener("change", () => apply(input.checked));
    return el("label", { class: "insp-toggle" }, [input, el("span", { text: label })]);
  }

  segmented(label, value, options, apply) {
    const wrap = el("div", { class: "insp-seg" });
    for (const opt of options) {
      const b = el("button", { type: "button", class: opt.value === value ? "is-on" : "", text: opt.label, title: opt.title });
      b.addEventListener("click", () => {
        wrap.querySelectorAll("button").forEach((x) => x.classList.toggle("is-on", x === b));
        apply(opt.value);
      });
      wrap.append(b);
    }
    return label ? el("div", { class: "insp-row" }, [el("span", { class: "insp-row__label", text: label }), wrap]) : wrap;
  }

  color(label, value, apply) {
    const input = el("input", { type: "color", value });
    input.addEventListener("input", () => apply(input.value, false));
    input.addEventListener("change", () => apply(input.value, true));
    return el("label", { class: "insp-row insp-row--color" }, [el("span", { class: "insp-row__label", text: label }), input]);
  }

  button(text, onClick, cls = "") {
    return el("button", { type: "button", class: `insp-btn ${cls}`, text, onclick: onClick });
  }

  // ---- painéis ---------------------------------------------------------------
  render() {
    const region = this.store.selected();
    this.root.textContent = "";
    this.root.append(region ? this.regionPanel(this.store.selection.track, region) : this.projectPanel());
  }

  regionPanel(track, r) {
    const head = el("div", { class: "insp-head" }, [
      el("h2", { text: TRACK_LABELS[track] }),
      el("span", { class: "insp-times", text: `${fmtTime(r.startMs)} – ${fmtTime(r.endMs)} (${((r.endMs - r.startMs) / 1000).toFixed(1)} s)` }),
    ]);
    const body = [];

    if (track === "zooms") {
      body.push(
        this.range("Intensidade", r.scale, { min: 1.1, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}×` }, (v, c) =>
          this.setRegion((x) => {
            x.scale = v;
            x.auto = false;
          }, c),
        ),
        this.segmented("Foco", r.follow ? "follow" : "fixed", [
          { value: "follow", label: "Segue o toque", title: "A câmera acompanha o toque" },
          { value: "fixed", label: "Ponto fixo", title: "Escolha o ponto clicando na prévia" },
        ], (v) => {
          this.setRegion((x) => {
            x.follow = v === "follow";
            x.auto = false;
          });
          this.render();
        }),
      );
      body.push(
        el("p", {
          class: "insp-hint",
          text: r.follow
            ? "Começa no ponto do toque e acompanha o dedo enquanto durar o zoom."
            : "Clique ou arraste na prévia para posicionar a área do zoom.",
        }),
      );
    } else if (track === "cuts") {
      body.push(el("p", { class: "insp-hint", text: "Este trecho fica de fora do vídeo final. Na prévia ele é pulado." }));
    } else if (track === "speeds") {
      body.push(
        this.segmented("Velocidade", r.speed, SPEEDS.map((s) => ({ value: s, label: `${s}×` })), (v) => this.setRegion((x) => (x.speed = v))),
        el("p", { class: "insp-hint", text: "O áudio acompanha a velocidade sem mudar o tom." }),
      );
    } else if (track === "texts") {
      const ta = el("textarea", { rows: 3 });
      ta.value = r.text;
      ta.addEventListener("input", () => this.setRegion((x) => (x.text = ta.value), false));
      ta.addEventListener("change", () => this.store.commit());
      body.push(
        this.row("Texto", ta),
        this.range("Tamanho", r.size, { min: 0.02, max: 0.14, step: 0.005, format: (v) => `${Math.round(v * 1000) / 10}%` }, (v, c) =>
          this.setRegion((x) => (x.size = v), c),
        ),
        this.color("Cor", r.color, (v, c) => this.setRegion((x) => (x.color = v), c)),
        this.toggle("Fundo escuro atrás do texto", r.box, (v) => this.setRegion((x) => (x.box = v))),
        this.segmented("Posição", null, [
          { value: 0.12, label: "Topo" },
          { value: 0.5, label: "Centro" },
          { value: 0.88, label: "Base" },
        ], (v) => this.setRegion((x) => {
          x.y = v;
          x.x = 0.5;
        })),
        el("p", { class: "insp-hint", text: "Também dá para arrastar o texto direto na prévia." }),
      );
    }

    const actions = el("div", { class: "insp-actions" }, [
      this.button("Ir para o início", () => this.host.seek(r.startMs)),
      this.button("Excluir", () => this.store.removeRegion(track, r.id), "insp-btn--danger"),
    ]);
    return el("div", { class: "insp-panel" }, [head, ...body, actions, this.button("‹ Ajustes do vídeo", () => this.store.select(null), "insp-btn--link")]);
  }

  projectPanel() {
    const e = this.store.edit;
    const bg = e.background;

    const swatches = el("div", { class: "insp-swatches" });
    for (const [key, g] of Object.entries(GRADIENTS)) {
      const b = el("button", {
        type: "button",
        title: g.name,
        class: bg.type === "gradient" && bg.preset === key ? "is-on" : "",
        style: `background: linear-gradient(${g.angle}deg, ${g.stops.join(", ")})`,
      });
      b.addEventListener("click", () => {
        this.set((x) => Object.assign(x.background, { type: "gradient", preset: key }));
        this.render();
      });
      swatches.append(b);
    }
    const colorInput = el("input", { type: "color", value: bg.color, title: "Cor sólida" });
    colorInput.addEventListener("input", () => this.set((x) => Object.assign(x.background, { type: "color", color: colorInput.value }), false));
    colorInput.addEventListener("change", () => {
      this.store.commit();
      this.render();
    });
    const colorWrap = el("label", { class: `insp-swatch-color${bg.type === "color" ? " is-on" : ""}`, title: "Cor sólida" }, [colorInput]);
    const file = el("input", { type: "file", accept: "image/png,image/jpeg,image/webp", hidden: true });
    file.addEventListener("change", async () => {
      if (file.files[0]) await this.host.chooseBackground(file.files[0]);
      this.render();
    });
    const imgBtn = el("button", { type: "button", class: `insp-swatch-img${bg.type === "image" ? " is-on" : ""}`, title: "Imagem de fundo", text: "Imagem" });
    imgBtn.addEventListener("click", () => file.click());
    swatches.append(colorWrap, imgBtn, file);

    const sections = [
      this.section("Vídeo", [
        this.segmented("Formato", e.format, [
          { value: "16:9", label: "16:9 Horizontal" },
          { value: "9:16", label: "9:16 Vertical" },
        ], (v) => this.set((x) => (x.format = v))),
        this.segmented("Resolução", e.resolution, [
          { value: 720, label: "720p" },
          { value: 1080, label: "1080p" },
        ], (v) => this.set((x) => (x.resolution = v))),
        this.segmented("Quadros/s", e.fps, [
          { value: 30, label: "30" },
          { value: 60, label: "60" },
        ], (v) => this.set((x) => (x.fps = v))),
        this.range("Nitidez", e.sharpen ?? 0.5, { min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }, (v, c) => this.set((x) => (x.sharpen = v), c)),
      ]),
      this.section("Fundo", [
        swatches,
        bg.type === "image"
          ? this.range("Desfoque", bg.blur || 0, { min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }, (v, c) => this.set((x) => (x.background.blur = v), c))
          : null,
        this.range("Margem", e.padding, { min: 0, max: 0.25, step: 0.01, format: (v) => `${Math.round(v * 100)}%` }, (v, c) => this.set((x) => (x.padding = v), c)),
        this.range("Sombra", e.shadow, { min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }, (v, c) => this.set((x) => (x.shadow = v), c)),
      ]),
      this.section("Toque", [
        this.toggle("Mostrar o toque no vídeo", e.touch.show, (v) => this.set((x) => (x.touch.show = v))),
        this.range("Tamanho", e.touch.size, { min: 0.5, max: 2, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }, (v, c) => this.set((x) => (x.touch.size = v), c)),
        this.color("Cor", e.touch.color, (v, c) => this.set((x) => (x.touch.color = v), c)),
        this.toggle("Onda ao tocar", e.touch.ripple, (v) => this.set((x) => (x.touch.ripple = v))),
        this.range("Suavidade do movimento", e.touch.smoothing, { min: 0, max: 2, step: 0.05, format: (v) => v.toFixed(2) }, (v, c) => this.set((x) => (x.touch.smoothing = v), c)),
      ]),
      this.section("Zoom", [
        this.range("Zoom padrão", e.zoom.defaultScale, { min: 1.1, max: 3, step: 0.05, format: (v) => `${v.toFixed(2)}×` }, (v, c) =>
          this.set((x) => {
            x.zoom.defaultScale = v;
            for (const z of x.zooms) if (z.auto) z.scale = v; // zooms automáticos seguem o padrão
          }, c),
        ),
        this.range("Suavidade", e.zoom.smoothness, { min: 0, max: 1, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }, (v, c) => this.set((x) => (x.zoom.smoothness = v), c)),
        this.toggle("Emendar zooms próximos (a câmera desliza de um para o outro)", e.zoom.connect, (v) => this.set((x) => (x.zoom.connect = v))),
        el("div", { class: "insp-actions" }, [
          this.button("Gerar zooms automáticos", () => {
            const n = this.host.generateZooms();
            this.flash(n ? `${n} zoom(s) criados a partir dos toques.` : "Nenhum toque novo para criar zoom.");
          }),
          this.button("Remover todos", () => this.set((x) => (x.zooms = [])), "insp-btn--danger"),
        ]),
        el("p", { class: "insp-hint", text: "Os zooms automáticos substituem os que ainda não foram editados. Os que você ajustou ficam." }),
      ]),
      this.section("Áudio do site", [
        this.toggle("Sem som", e.audio.muted, (v) => this.set((x) => (x.audio.muted = v))),
        this.range("Volume", e.audio.volume, { min: 0, max: 2, step: 0.05, format: (v) => `${Math.round(v * 100)}%` }, (v, c) => this.set((x) => (x.audio.volume = v), c)),
      ]),
    ];
    this.flashEl = el("div", { class: "insp-flash" });
    return el("div", { class: "insp-panel" }, [...sections, this.flashEl]);
  }

  flash(text) {
    if (!this.flashEl) return;
    this.flashEl.textContent = text;
    this.flashEl.classList.add("is-on");
    clearTimeout(this.flashTimer);
    this.flashTimer = setTimeout(() => this.flashEl.classList.remove("is-on"), 2600);
  }
}
