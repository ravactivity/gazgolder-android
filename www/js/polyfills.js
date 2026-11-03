"use strict";
(function () {
  function def(obj, name, fn) { if (!obj[name]) Object.defineProperty(obj, name, { value: fn, writable: true, configurable: true }); }
  function at(i) { i = Math.trunc(i) || 0; if (i < 0) i += this.length; return i < 0 || i >= this.length ? undefined : this[i]; }
  def(Array.prototype, "at", at);
  def(String.prototype, "at", at);
  def(Array.prototype, "findLast", function (f, t) { for (let i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return this[i]; });
  def(Array.prototype, "findLastIndex", function (f, t) { for (let i = this.length - 1; i >= 0; i--) if (f.call(t, this[i], i, this)) return i; return -1; });
  def(String.prototype, "replaceAll", function (a, b) { return a instanceof RegExp ? this.replace(a, b) : this.split(a).join(b); });
  def(Object, "hasOwn", function (o, k) { return Object.prototype.hasOwnProperty.call(o, k); });
  def(Array.prototype, "toSorted", function (f) { return this.slice().sort(f); });
  if (typeof structuredClone !== "function") self.structuredClone = (v) => JSON.parse(JSON.stringify(v));
})();
