"use strict";
(function (root) {
  function fakeCloud() {
    const files = new Map(), access = new Map();
    let seq = 0;
    const grant = (user, id) => { if (!access.has(user)) access.set(user, new Set()); access.get(user).add(id); };
    const shared = (f, user) => f.owner === user || f.perms.some((p) => p.email === user) || (f.parents || []).some((pid) => files.get(pid) && shared(files.get(pid), user));
    const can = (user, id) => access.get(user)?.has(id) && files.has(id) && shared(files.get(id), user);
    const err = (status) => { const e = new Error("HTTP " + status); e.status = status; return e; };
    const meta = (f, user) => ({ id: f.id, name: f.name, version: String(f.version), trashed: f.trashed, parents: f.parents, appProperties: f.appProperties, mimeType: f.mimeType, ownedByMe: f.owner === user });
    const bytes = async (b) => (b instanceof Uint8Array ? b.slice() : new Uint8Array(await b.arrayBuffer()));
    function client(user) {
      const touch = (f) => { f.version++; };
      return {
        async about() { return { email: user }; },
        async get(id) { if (!can(user, id)) throw err(404); return meta(files.get(id), user); },
        async download(id) { if (!can(user, id)) throw err(404); return files.get(id).content.slice(); },
        async list(q) {
          const m = /value='(\w+)'/.exec(q);
          return [...files.values()].filter((f) => can(user, f.id) && !f.trashed && (!m || f.appProperties?.gazgolder === m[1])).map((f) => meta(f, user));
        },
        async createFolder(name, parent, appProperties) { return this.create({ name, parents: parent ? [parent] : [], appProperties, mimeType: "application/vnd.google-apps.folder" }, new Uint8Array(0)); },
        async create(m, body) {
          for (const p of m.parents || []) if (!can(user, p) || !shared(files.get(p), user)) throw err(404);
          const id = "file" + String(++seq).padStart(8, "0");
          const f = { id, name: m.name, parents: m.parents || [], appProperties: m.appProperties || {}, mimeType: m.mimeType, version: 1, content: await bytes(body), owner: user, perms: [], trashed: false };
          files.set(id, f); grant(user, id);
          return meta(f, user);
        },
        async update(id, m, body) {
          if (!can(user, id)) throw err(404);
          const f = files.get(id);
          if (m.name) f.name = m.name;
          f.content = await bytes(body); touch(f);
          return meta(f, user);
        },
        async rename(id, name) { if (!can(user, id)) throw err(404); const f = files.get(id); f.name = name; touch(f); return meta(f, user); },
        async share(id, email, { role = "writer" } = {}) { if (!can(user, id)) throw err(404); const f = files.get(id); f.perms.push({ id: "perm" + ++seq, email, role }); touch(f); return {}; },
        async permissions(id) { if (!can(user, id)) throw err(404); return files.get(id).perms.map((p) => ({ id: p.id, emailAddress: p.email, role: p.role })); },
        async unshare(id, pid) { const f = files.get(id); f.perms = f.perms.filter((p) => p.id !== pid); touch(f); },
      };
    }
    return { files, client, pick: (user, ids) => ids.forEach((id) => grant(user, id)), trash: (id) => { files.get(id).trashed = true; } };
  }
  root.gasFakeCloud = fakeCloud;
})(typeof window !== "undefined" ? window : globalThis);
