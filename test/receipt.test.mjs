import { test } from "node:test";
import assert from "node:assert/strict";

await import("../www/js/receipt.js");
const { parseReceipt, findDate, numbers } = globalThis.gasReceipt;

test("a gas station style receipt: liters × price = total", () => {
  const r = parseReceipt(["АЗС № 12 ООО ГАЗ-СЕРВИС", "ИНН 7701234567", "СУГ (пропан-бутан)", "2 150,00 л x 32,50", "= 69 875,00", "ИТОГО 69 875,00", "12.10.2026 14:31"]);
  assert.deepEqual(r, { liters: 2150, price: 32.5, total: 69875, date: "2026-10-12", sure: true });
});

test("an invoice with labels on separate lines and Latin-model OCR garbage", () => {
  const r = parseReceipt({ lines: [{ text: "Haклaднaя Nº 418 oт 03/09/2026" }, { text: "Koл-вo 1800 n" }, { text: "Цeнa 28.90 py6" }, { text: "Cyммa 52020.00" }, { text: "Tел. 8 800 555 35 35" }] });
  assert.equal(r.liters, 1800);
  assert.equal(r.price, 28.9);
  assert.equal(r.total, 52020);
  assert.equal(r.date, "2026-09-03");
  assert.equal(r.sure, true);
});

test("rounding in the total is tolerated", () => {
  const r = parseReceipt(["1234,5 л", "33,33", "41146,89"]);
  assert.equal(r.liters, 1234.5);
  assert.equal(r.price, 33.33);
  assert.equal(r.total, 41146.89);
});

test("without a consistent triple, keywords give the total and liters, the price is derived", () => {
  const r = parseReceipt(["Отпущено 2000 л", "ИТОГО 61000"]);
  assert.equal(r.liters, 2000);
  assert.equal(r.total, 61000);
  assert.equal(r.price, 30.5);
  assert.equal(r.sure, false);
});

test("nothing useful: empty result, no exception", () => {
  assert.deepEqual(parseReceipt({ lines: [] }), { liters: null, price: null, total: null, date: "", sure: false });
  assert.deepEqual(parseReceipt(null), { liters: null, price: null, total: null, date: "", sure: false });
  assert.equal(parseReceipt(["Спасибо за покупку!"]).total, null);
});

test("dates: dd.mm.yyyy, dd/mm/yy, invalid dates skipped", () => {
  assert.equal(findDate(["31.02.2026", "01/03/26"]), "2026-03-01");
  assert.equal(findDate(["нет даты"]), "");
  assert.equal(findDate(["12.13.2026"]), "");
});

test("numbers: thousands separators, decimal comma, O misread as 0, parts of dates and times skipped", () => {
  assert.deepEqual(numbers(["69 875,00 и 1O5,5"]).map((n) => n.v), [69875, 105.5]);
  assert.deepEqual(numbers(["12.10.2026 14:31"]).map((n) => n.v), []);
});
