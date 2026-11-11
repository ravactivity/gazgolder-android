import { test } from "node:test";
import assert from "node:assert/strict";

class Node {
  constructor(type, tag, attrs = {}, text = "") {
    this.nodeType = type; this.tagName = tag; this.attrs = { ...attrs }; this.childNodes = []; this.parentElement = null; this._text = text;
  }
  get nodeValue() { return this._text; }
  set nodeValue(v) { this._text = v; observer && observer.queue({ type: "characterData", target: this }); }
  append(...kids) { for (const k of kids) { k.parentElement = this; this.childNodes.push(k); observer && observer.queue({ type: "childList", addedNodes: [k] }); } return this; }
  hasAttribute(a) { return a in this.attrs; }
  getAttribute(a) { return this.attrs[a]; }
  setAttribute(a, v) { this.attrs[a] = v; }
  matches(sel) {
    return sel.split(",").map((s) => s.trim()).some((s) => {
      if (s.startsWith(".")) return (this.attrs.class || "").split(" ").includes(s.slice(1));
      if (s.startsWith("#")) return this.attrs.id === s.slice(1);
      if (s.startsWith("[")) return s.slice(1, -1) in this.attrs;
      return this.tagName === s.toUpperCase();
    });
  }
  closest(sel) { let n = this; while (n) { if (n.nodeType === 1 && n.matches(sel)) return n; n = n.parentElement; } return null; }
}
const el = (tag, attrs, ...kids) => new Node(1, tag.toUpperCase(), attrs).append(...kids);
const tx = (s) => new Node(3, undefined, {}, s);

let observer = null;
class FakeObserver {
  constructor(cb) { this.cb = cb; this.pending = []; this.on = false; observer = this; }
  observe() { this.on = true; }
  disconnect() { this.on = false; }
  queue(m) { if (this.on) this.pending.push(m); }
  flush() { const m = this.pending; this.pending = []; if (m.length) this.cb(m); }
}

const said = [];
const html = el("html", {});
globalThis.document = { documentElement: html };
globalThis.MutationObserver = FakeObserver;
globalThis.window = globalThis;
globalThis.alert = (m) => said.push(["alert", m]);
globalThis.confirm = (m) => { said.push(["confirm", m]); return true; };
globalThis.prompt = (m, d) => { said.push(["prompt", m, d]); return d; };
globalThis.localStorage = { getItem: () => "en", setItem() {} };

const body = el("body", {},
  el("h2", {}, tx("Сохранить")),
  el("div", { class: "note" }, tx("Сохранить")),
  el("div", { "data-noi18n": "" }, tx("Сохранить")),
  el("select", { id: "pf-sel" }, el("option", {}, tx("Основной")), el("option", {}, tx("Основной дом"))),
  el("textarea", { placeholder: "Примечание" }, tx("Сохранить")),
  el("input", { placeholder: "Примечание", title: "Сохранить" }),
  el("button", { title: "Удалить", "aria-label": "Удалить" }, tx("Удалить")),
  el("script", {}, tx("Сохранить")),
);
html.append(body);
await import("../www/js/i18n.js");
const I = globalThis.gasI18n;

test("the page is translated on start, skipping notes, scripts and marked blocks", () => {
  assert.equal(html.lang, "en");
  const [h2, note, keep, sel, ta, input, button, script] = body.childNodes;
  assert.equal(h2.childNodes[0].nodeValue, "Save");
  assert.equal(note.childNodes[0].nodeValue, "Сохранить");
  assert.equal(keep.childNodes[0].nodeValue, "Сохранить");
  assert.equal(sel.childNodes[0].childNodes[0].nodeValue, "Main");
  assert.equal(sel.childNodes[1].childNodes[0].nodeValue, "Основной дом");
  assert.equal(ta.childNodes[0].nodeValue, "Сохранить");
  assert.equal(ta.getAttribute("placeholder"), "Note");
  assert.equal(input.getAttribute("title"), "Save");
  assert.equal(button.getAttribute("aria-label"), "Delete");
  assert.equal(button.childNodes[0].nodeValue, "Delete");
  assert.equal(script.childNodes[0].nodeValue, "Сохранить");
});

test("nodes added or changed later are translated by the observer", () => {
  const p = el("p", {});
  body.append(p);
  p.append(tx("Удалить"));
  observer.flush();
  assert.equal(p.childNodes[0].nodeValue, "Delete");
  p.childNodes[0].nodeValue = "Сохранено";
  observer.flush();
  assert.equal(p.childNodes[0].nodeValue, "Saved");
  p.setAttribute("title", "Удалить");
  observer.queue({ type: "attributes", target: p });
  observer.flush();
  assert.equal(p.getAttribute("title"), "Delete");
  const orphan = tx("Сохранить");
  observer.queue({ type: "characterData", target: orphan });
  observer.flush();
  assert.equal(orphan.nodeValue, "Сохранить");
});

test("alert, confirm and prompt messages are translated line by line", () => {
  alert("Сохранить\nУдалить");
  assert.equal(confirm("Удалить"), true);
  assert.equal(prompt("Сохранить", "x"), "x");
  alert(null);
  assert.deepEqual(said, [["alert", "Save\nDelete"], ["confirm", "Delete"], ["prompt", "Save", "x"], ["alert", ""]]);
});

test("translation helpers keep unknown text and user data", () => {
  assert.equal(I.tr(""), "");
  assert.equal(I.tr("Hello"), "Hello");
  assert.equal(I.tr("Сохранить"), "Save");
  assert.equal(I.tr("Сохранить"), "Save");
  I.setLang("xx");
  I.setLang("ru");
  assert.equal(typeof I.systemLang(), "string");
});
