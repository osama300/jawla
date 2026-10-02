// إدارة ترمينالات xterm في الواجهة: نسخة واحدة لكل ترمينال في الخادم، تبقى في الذاكرة عند التنقل.

import { t } from "./i18n.js";

const THEMES = {
  dark: {
    background: "#0c0d10",
    foreground: "#e6e8ee",
    cursor: "#34e3a6",
    cursorAccent: "#0c0d10",
    selectionBackground: "rgba(52,227,166,.28)",
    black: "#1b1e24", red: "#ff6b7a", green: "#34e3a6", yellow: "#f5b84a", blue: "#7aa7ff", magenta: "#c792ea", cyan: "#5ad4e6", white: "#d7dae0",
    brightBlack: "#5c6370", brightRed: "#ff8a96", brightGreen: "#6af0c0", brightYellow: "#ffd27a", brightBlue: "#9dbdff", brightMagenta: "#ddb0f5", brightCyan: "#8ce4f0", brightWhite: "#ffffff",
  },
  light: {
    background: "#ffffff",
    foreground: "#1d2128",
    cursor: "#0fa678",
    cursorAccent: "#ffffff",
    selectionBackground: "rgba(15,166,120,.22)",
    black: "#1d2128", red: "#d43c4f", green: "#0f8a64", yellow: "#a86a00", blue: "#2f63d6", magenta: "#8e44ad", cyan: "#0e7c8c", white: "#c9ccd3",
    brightBlack: "#6b7280", brightRed: "#e5566a", brightGreen: "#13a679", brightYellow: "#c27c00", brightBlue: "#4a7be6", brightMagenta: "#a35bc4", brightCyan: "#1597a8", brightWhite: "#ffffff",
  },
};

export class TermManager {
  constructor(host) {
    this.host = host; // العنصر الذي تُرسم فيه الترمينالات
    this.items = new Map(); // tid -> { term, fit, ws, el, state }
    this.active = null;
    this.theme = "dark";
    new ResizeObserver(() => this.fitActive()).observe(host);
  }

  ensure(tid) {
    if (this.items.has(tid)) return this.items.get(tid);
    const el = document.createElement("div");
    el.className = "xterm-host";
    el.dir = "ltr";
    el.hidden = true;
    this.host.appendChild(el);
    const term = new window.Terminal({
      fontFamily: '"IBM Plex Mono", "SF Mono", Menlo, monospace',
      fontSize: 13.5,
      lineHeight: 1.25,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 8000,
      macOptionIsMeta: true,
      theme: THEMES[this.theme],
    });
    const fit = new window.FitAddon.FitAddon();
    term.loadAddon(fit);
    term.loadAddon(new window.WebLinksAddon.WebLinksAddon((e, uri) => window.open(uri, "_blank", "noopener")));
    term.open(el);
    const item = { tid, term, fit, el, ws: null, state: "connecting" };
    term.onData((d) => this.send(item, { t: "i", d }));
    term.onResize(({ cols, rows }) => this.send(item, { t: "r", cols, rows }));
    this.items.set(tid, item);
    this.connect(item);
    return item;
  }

  connect(item) {
    const ws = new WebSocket(`ws://${location.host}/ws/terminals/${item.tid}`);
    item.ws = ws;
    ws.onopen = () => {
      item.state = "open";
      item.term.reset();
      this.send(item, { t: "r", cols: item.term.cols, rows: item.term.rows });
    };
    ws.onmessage = (ev) => {
      const m = JSON.parse(ev.data);
      if (m.t === "o") item.term.write(m.d);
      else if (m.t === "exit") item.term.write(`\r\n\x1b[2m${t("term.exited", { c: m.code })}\x1b[0m\r\n`);
      else if (m.t === "gone") {
        item.state = "gone";
        item.term.write(`\r\n\x1b[2m${t("term.gone")}\x1b[0m\r\n`);
      }
    };
    ws.onclose = () => {
      if (item.state === "gone" || item.disposed) return;
      item.state = "reconnecting";
      setTimeout(() => !item.disposed && this.connect(item), 1500);
    };
  }

  send(item, msg) {
    if (item.ws?.readyState === 1) item.ws.send(JSON.stringify(msg));
  }

  show(tid) {
    const item = this.ensure(tid);
    for (const it of this.items.values()) it.el.hidden = it !== item;
    this.active = item;
    requestAnimationFrame(() => {
      this.fitActive();
      item.term.focus();
    });
    return item;
  }

  fitActive() {
    const it = this.active;
    if (!it || it.el.hidden || !this.host.offsetParent) return;
    try {
      it.fit.fit();
    } catch {}
  }

  /** يرسل نصًا كأنه لُصق ثم Enter (bracketed paste يحافظ على الأسطر المتعددة) */
  paste(tid, text, submit = true) {
    const item = this.items.get(tid);
    if (!item) return;
    this.send(item, { t: "i", d: `\x1b[200~${text}\x1b[201~` });
    if (submit) setTimeout(() => this.send(item, { t: "i", d: "\r" }), 60);
    item.term.focus();
  }

  dispose(tid) {
    const item = this.items.get(tid);
    if (!item) return;
    item.disposed = true;
    item.ws?.close();
    item.term.dispose();
    item.el.remove();
    this.items.delete(tid);
    if (this.active === item) this.active = null;
  }

  /** يحذف النسخ المحلية لترمينالات لم تعد موجودة في الخادم */
  sync(serverTids) {
    for (const tid of [...this.items.keys()]) if (!serverTids.has(tid)) this.dispose(tid);
  }

  setTheme(name) {
    this.theme = name;
    for (const it of this.items.values()) it.term.options.theme = THEMES[name];
  }
}
