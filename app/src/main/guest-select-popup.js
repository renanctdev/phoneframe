// Executado dentro do site (no <webview>) a cada página carregada.
//
// O menu de um <select> é desenhado pelo sistema, numa janela própria fora da
// janela do celular, e por isso não aparece na gravação. Este script troca esse
// menu por um desenhado dentro da página (num Shadow DOM, sem mexer no CSS do
// site), que a captura enxerga. O <select> continua sendo o dono do valor:
// escolher uma opção dispara os eventos "input" e "change" como no navegador.
//
// Fica de fora (continua nativo): <select multiple> e <select size="N">, que
// já são listas dentro da página.
(() => {
  if (window.__simSelectPopup) return;
  window.__simSelectPopup = true;

  const ACCENT = "#2f6fde";
  const CSS = `
    :host { all: initial; }
    .menu {
      position: fixed; box-sizing: border-box; overflow-y: auto; overscroll-behavior: contain;
      border-radius: 10px; padding: 4px; user-select: none; -webkit-user-select: none;
      font-weight: 400; line-height: 1.3; text-align: left; letter-spacing: normal;
      scrollbar-width: thin;
    }
    .item { padding: 8px 12px; border-radius: 7px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; cursor: default; }
    .group { padding: 8px 12px 4px; font-size: 0.85em; font-weight: 600; opacity: 0.65; cursor: default; }
    .indent { padding-left: 24px; }
    .disabled { opacity: 0.4; }
  `;

  const host = document.createElement("div");
  Object.assign(host.style, { position: "fixed", left: "0", top: "0", width: "0", height: "0", zIndex: "2147483647" });
  const root = host.attachShadow({ mode: "closed" });
  try {
    const sheet = new CSSStyleSheet();
    sheet.replaceSync(CSS);
    root.adoptedStyleSheets = [sheet];
  } catch {
    const style = document.createElement("style");
    style.textContent = CSS;
    root.append(style);
  }
  const menu = document.createElement("div");
  menu.className = "menu";
  menu.setAttribute("role", "listbox");
  root.append(menu);

  /** { select, rows: [{opt, el}], index } enquanto aberto */
  let current = null;
  let typed = "";
  let typedAt = 0;

  // ---- cores ---------------------------------------------------------------
  const parseColor = (value) => {
    const m = /rgba?\(([^)]+)\)/.exec(value || "");
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const luminance = ({ r, g, b }) => (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  const mix = (a, b, t) => ({ r: a.r + (b.r - a.r) * t, g: a.g + (b.g - a.g) * t, b: a.b + (b.b - a.b) * t, a: 1 });
  const css = ({ r, g, b, a }) => `rgba(${Math.round(r)},${Math.round(g)},${Math.round(b)},${a ?? 1})`;

  function backgroundOf(el) {
    for (let e = el; e; e = e.parentElement) {
      const c = parseColor(getComputedStyle(e).backgroundColor);
      if (c && c.a > 0.9) return c;
    }
    const dark = window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches;
    return dark ? { r: 32, g: 33, b: 36, a: 1 } : { r: 255, g: 255, b: 255, a: 1 };
  }

  // ---- abrir / fechar ----------------------------------------------------------
  function readOptions(select) {
    const rows = [];
    const add = (opt, indent) => rows.push({ opt, indent, label: (opt.label || opt.text || "").trim() });
    for (const child of select.children) {
      if (child.tagName === "OPTION") add(child, false);
      else if (child.tagName === "OPTGROUP") {
        rows.push({ group: child.label || "" });
        for (const o of child.children) if (o.tagName === "OPTION") add(o, true);
      }
    }
    return rows;
  }

  function open(select) {
    close();
    const cs = getComputedStyle(select);
    const bg = backgroundOf(select);
    const fg = parseColor(cs.color) || (luminance(bg) < 0.5 ? { r: 240, g: 240, b: 240, a: 1 } : { r: 20, g: 20, b: 20, a: 1 });
    const dark = luminance(bg) < 0.5;
    const hover = mix(bg, fg, 0.14);

    Object.assign(menu.style, {
      background: css(dark ? mix(bg, { r: 255, g: 255, b: 255, a: 1 }, 0.05) : bg),
      color: css(fg),
      border: `1px solid ${css({ ...fg, a: 0.22 })}`,
      boxShadow: dark ? "0 10px 30px rgba(0,0,0,.6)" : "0 10px 30px rgba(0,0,0,.25)",
      fontFamily: cs.fontFamily,
      fontSize: `${Math.max(14, parseFloat(cs.fontSize) || 15)}px`,
    });
    menu.textContent = "";

    const rows = [];
    for (const r of readOptions(select)) {
      const el = document.createElement("div");
      if (r.group !== undefined) {
        el.className = "group";
        el.textContent = r.group;
        menu.append(el);
        continue;
      }
      el.className = `item${r.indent ? " indent" : ""}${r.opt.disabled ? " disabled" : ""}`;
      el.textContent = r.label || "\u00a0";
      el.setAttribute("role", "option");
      menu.append(el);
      const row = { opt: r.opt, el };
      rows.push(row);
      el.addEventListener("mousedown", (e) => e.preventDefault());
      el.addEventListener("mousemove", () => highlight(rows.indexOf(row)));
      el.addEventListener("click", () => commit(row.opt));
    }

    current = { select, rows, index: Math.max(0, select.selectedIndex), hover, fg };
    document.documentElement.append(host);
    place(select);
    highlight(rows.findIndex((r) => r.opt.selected) >= 0 ? rows.findIndex((r) => r.opt.selected) : 0);
    const sel = current.rows[current.index];
    if (sel) menu.scrollTop = Math.max(0, sel.el.offsetTop - menu.clientHeight / 2 + sel.el.offsetHeight / 2);

    window.addEventListener("mousedown", onOutside, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", close, true);
    window.addEventListener("blur", close);
    window.addEventListener("wheel", onWheel, { capture: true, passive: true });
    document.addEventListener("scroll", close, true);
  }

  function place(select) {
    const r = select.getBoundingClientRect();
    const vw = document.documentElement.clientWidth || innerWidth;
    const vh = document.documentElement.clientHeight || innerHeight;
    const margin = 8;
    const width = Math.min(vw - margin * 2, Math.max(r.width, 160));
    menu.style.width = `${width}px`;
    menu.style.maxHeight = "none";
    const natural = menu.scrollHeight + 8; // folga p/ arredondamentos (evita barra de rolagem à toa)
    const below = vh - r.bottom - margin;
    const above = r.top - margin;
    const cap = 360;
    let top;
    let height;
    if (natural <= below || below >= above) {
      height = Math.min(natural, below, cap);
      top = r.bottom + 4;
    } else {
      height = Math.min(natural, above, cap);
      top = r.top - 4 - height;
    }
    menu.style.maxHeight = `${Math.max(80, height)}px`;
    menu.style.left = `${Math.max(margin, Math.min(r.left, vw - width - margin))}px`;
    menu.style.top = `${Math.max(margin, top)}px`;
  }

  function close() {
    if (!current) return;
    current = null;
    host.remove();
    window.removeEventListener("mousedown", onOutside, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("resize", close, true);
    window.removeEventListener("blur", close);
    window.removeEventListener("wheel", onWheel, true);
    document.removeEventListener("scroll", close, true);
  }

  function highlight(i) {
    if (!current) return;
    current.index = i;
    current.rows.forEach((row, n) => {
      const on = n === i && !row.opt.disabled;
      row.el.style.background = on ? ACCENT : "transparent";
      row.el.style.color = on ? "#fff" : "";
    });
    const row = current.rows[i];
    if (row) {
      const top = row.el.offsetTop;
      const bottom = top + row.el.offsetHeight;
      if (top < menu.scrollTop) menu.scrollTop = top - 4;
      else if (bottom > menu.scrollTop + menu.clientHeight) menu.scrollTop = bottom - menu.clientHeight + 4;
    }
  }

  function commit(opt) {
    if (!current) return;
    const select = current.select;
    close();
    if (opt.disabled) return;
    const changed = !opt.selected;
    opt.selected = true;
    if (changed) {
      select.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
      select.dispatchEvent(new Event("change", { bubbles: true }));
    }
    select.focus({ preventScroll: true });
  }

  // ---- eventos ----------------------------------------------------------------
  function onOutside(e) {
    if (e.composedPath().includes(host)) return;
    // clicar no próprio select de novo fecha (o handler do gatilho trata do resto)
    close();
  }

  function onWheel(e) {
    if (!e.composedPath().includes(host)) close();
  }

  function step(from, dir) {
    const rows = current.rows;
    for (let i = from + dir; i >= 0 && i < rows.length; i += dir) if (!rows[i].opt.disabled) return i;
    return from;
  }

  function onKey(e) {
    if (!current) return;
    const rows = current.rows;
    let handled = true;
    switch (e.key) {
      case "ArrowDown": highlight(step(current.index, 1)); break;
      case "ArrowUp": highlight(step(current.index, -1)); break;
      case "Home": highlight(step(-1, 1)); break;
      case "End": highlight(step(rows.length, -1)); break;
      case "Enter":
      case " ": {
        if (e.key === " " && typed) { typed += " "; break; }
        const row = rows[current.index];
        if (row) commit(row.opt);
        break;
      }
      case "Escape": close(); break;
      case "Tab": close(); handled = false; break;
      default:
        if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
          const now = Date.now();
          typed = now - typedAt > 800 ? e.key.toLowerCase() : typed + e.key.toLowerCase();
          typedAt = now;
          const start = typed.length === 1 ? current.index + 1 : current.index;
          for (let k = 0; k < rows.length; k++) {
            const i = (start + k) % rows.length;
            if (!rows[i].opt.disabled && rows[i].opt.text.trim().toLowerCase().startsWith(typed)) { highlight(i); break; }
          }
        } else handled = false;
    }
    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  const selectFrom = (e) => {
    for (const n of e.composedPath()) if (n instanceof HTMLSelectElement) return n;
    return null;
  };
  const supported = (s) => s && !s.disabled && !s.multiple && !(s.size > 1);

  // Gatilho: botão esquerdo no <select> (em vez do menu nativo).
  window.addEventListener(
    "mousedown",
    (e) => {
      if (e.button !== 0) return;
      const select = selectFrom(e);
      if (!supported(select)) return;
      e.preventDefault();
      select.focus({ preventScroll: true });
      if (current && current.select === select) close();
      else open(select);
    },
    true,
  );

  // Gatilho pelo teclado, como no navegador: Alt+Seta, F4 ou Espaço com o select focado.
  window.addEventListener(
    "keydown",
    (e) => {
      if (current) return;
      const el = document.activeElement;
      if (!(el instanceof HTMLSelectElement) || !supported(el)) return;
      if (e.key === "F4" || (e.altKey && (e.key === "ArrowDown" || e.key === "ArrowUp")) || (e.key === " " && !e.ctrlKey && !e.metaKey)) {
        e.preventDefault();
        open(el);
      }
    },
    true,
  );
})();
