"use strict";
(function (root) {
  const ACTIONS = ["photo", "reading", "refuel"];
  function parse(url) {
    const m = /^gazgolder:\/\/([a-z]+)\/?(?:[?#].*)?$/i.exec(String(url || "").trim());
    const a = m && m[1].toLowerCase();
    return a && ACTIONS.includes(a) ? a : null;
  }
  root.gasLink = { parse, ACTIONS };
})(typeof window !== "undefined" ? window : globalThis);
