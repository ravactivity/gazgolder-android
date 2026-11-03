import { test } from "node:test";
import assert from "node:assert/strict";

globalThis.localStorage = { store: { "gas-lang": "en" }, getItem(k) { return this.store[k] ?? null; }, setItem(k, v) { this.store[k] = String(v); } };
await import("../www/js/i18n.js");
const I = globalThis.gasI18n;

test("language comes from storage", () => {
  assert.equal(I.lang, "en");
  assert.equal(I.chosen, true);
  assert.equal(I.locale, "en-US");
});

test("exact phrases and parameters", () => {
  assert.equal(I.t("Сохранить"), "Save");
  assert.equal(I.t("Подставить {v}%", { v: 42 }), "Use 42%");
  assert.equal(I.t("Неизвестная строка {x}", { x: 1 }), "Неизвестная строка 1");
});

test("phrases inside composed text, with word boundaries", () => {
  assert.equal(I.tr("через 12 дн."), "in 12 days");
  assert.equal(I.tr("  Минимум 20%  "), "  Minimum 20%  ");
  assert.equal(I.tr("2 990 л"), "2 990 L");
  assert.equal(I.tr("только ГВС"), "hot water only");
  assert.equal(I.tr("Дача"), "Дача");
});

test("numbers and dates use the English locale", () => {
  assert.equal((4600).toLocaleString("ru-RU"), "4,600");
  assert.match(new Date(2027, 4, 27).toLocaleDateString("ru-RU", { day: "numeric", month: "short", year: "numeric" }), /May 27, 2027/);
});
