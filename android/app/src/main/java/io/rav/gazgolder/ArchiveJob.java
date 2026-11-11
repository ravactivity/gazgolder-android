package io.rav.gazgolder;

import android.content.ContentResolver;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.text.SimpleDateFormat;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Calendar;
import java.util.Date;
import java.util.List;
import java.util.Locale;
import java.util.TimeZone;
import java.util.zip.Deflater;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

final class ArchiveJob {
    static final String PREFS = "CapacitorStorage";
    static final String CFG = "gas-archive";
    static final String STATE = "gas-archive-state";
    private static final String[] DATA_FILES = {"gas_levels.csv", "refuels.csv", "settings.json", "passport.json"};
    private static final Object LOCK = new Object();

    private ArchiveJob() {
    }

    static JSONObject config(Context ctx) {
        try {
            return new JSONObject(ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE).getString(CFG, "{}"));
        } catch (Exception e) {
            return new JSONObject();
        }
    }

    static JSONObject run(Context ctx, boolean force) throws Exception {
        synchronized (LOCK) {
            SharedPreferences sp = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
            JSONObject cfg = config(ctx);
            JSONObject res = new JSONObject();
            res.put("saved", 0);
            String treeStr = cfg.optString("tree", "");
            if (!cfg.optBoolean("on", false) || !treeStr.startsWith("content://")) return res;
            Uri tree = Uri.parse(treeStr);
            if (!hasAccess(ctx, tree)) throw new SecurityException("NO_ACCESS");
            JSONObject st;
            try {
                st = new JSONObject(sp.getString(STATE, "{}"));
            } catch (Exception e) {
                st = new JSONObject();
            }
            JSONObject last = st.optJSONObject("last") != null ? st.optJSONObject("last") : new JSONObject();
            JSONObject sigs = st.optJSONObject("sig") != null ? st.optJSONObject("sig") : new JSONObject();
            boolean photos = cfg.optBoolean("photos", true);
            int days = ArchiveNames.clamp(cfg.optInt("days", 7), 1, 365);
            int keep = ArchiveNames.clamp(cfg.optInt("keep", 5), 1, 100);
            File data = new File(ctx.getFilesDir(), "data"), media = new File(ctx.getFilesDir(), "media");
            long now = System.currentTimeMillis();
            int saved = 0;
            for (String[] p : profiles(data, cfg.optString("defaultName", "Основной"))) {
                String pid = p[0], name = p[1];
                File dir = new File(data, pid);
                if (!dir.isDirectory()) continue;
                List<Object[]> files = collect(dir, new File(media, pid), photos);
                List<String[]> sigParts = new ArrayList<>();
                for (Object[] f : files) {
                    File file = (File) f[1];
                    sigParts.add(new String[]{(String) f[0], String.valueOf(file.length()), String.valueOf(file.lastModified())});
                }
                String sig = ArchiveNames.signature(name, photos, sigParts);
                if (!ArchiveNames.due(force, now, last.optLong(pid, 0), days, sig, sigs.optString(pid, ""))) continue;
                Calendar c = Calendar.getInstance();
                String prefix = ArchiveNames.prefix(name, pid);
                String fname = ArchiveNames.fileName(name, pid, c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH), photos);
                write(ctx, tree, fname, name, photos, files);
                prune(ctx, tree, prefix, keep);
                last.put(pid, now);
                sigs.put(pid, sig);
                saved++;
            }
            st.put("last", last);
            st.put("sig", sigs);
            if (saved > 0) st.put("time", now);
            sp.edit().putString(STATE, st.toString()).apply();
            res.put("saved", saved);
            res.put("time", now);
            return res;
        }
    }

    static boolean hasAccess(Context ctx, Uri tree) {
        for (UriPermission p : ctx.getContentResolver().getPersistedUriPermissions()) {
            if (p.getUri().equals(tree) && p.isWritePermission()) return true;
        }
        return false;
    }

    private static List<String[]> profiles(File data, String defaultName) {
        List<String[]> out = new ArrayList<>();
        String defName = "Основной";
        List<String[]> rest = new ArrayList<>();
        try (InputStream in = new FileInputStream(new File(data, "profiles.json"))) {
            JSONArray items = new JSONObject(new String(readAll(in), StandardCharsets.UTF_8)).optJSONArray("profiles");
            for (int i = 0; items != null && i < items.length(); i++) {
                JSONObject it = items.optJSONObject(i);
                if (it == null) continue;
                String id = it.optString("id", ""), name = it.optString("name", "");
                if ("default".equals(id)) defName = name.isEmpty() ? defName : name;
                else if (ArchiveNames.validId(id)) rest.add(new String[]{id, name.isEmpty() ? id : name});
            }
        } catch (Exception ignored) {
        }
        out.add(new String[]{"default", "Основной".equals(defName) ? defaultName : defName});
        out.addAll(rest);
        return out;
    }

    private static List<Object[]> collect(File dir, File media, boolean photos) {
        List<Object[]> out = new ArrayList<>();
        for (String f : DATA_FILES) {
            File file = new File(dir, f);
            if (file.isFile()) out.add(new Object[]{f, file});
        }
        if (!photos) return out;
        for (String sub : new String[]{"img", "passport"}) {
            File[] list = new File(media, sub).listFiles();
            if (list == null) continue;
            Arrays.sort(list);
            for (File f : list) if (f.isFile() && ArchiveNames.isPhoto(f.getName())) out.add(new Object[]{sub + "/" + f.getName(), f});
        }
        return out;
    }

    private static void write(Context ctx, Uri tree, String fname, String name, boolean photos, List<Object[]> files) throws Exception {
        ContentResolver cr = ctx.getContentResolver();
        String rootId = DocumentsContract.getTreeDocumentId(tree);
        Uri dir = DocumentsContract.buildDocumentUriUsingTree(tree, rootId);
        for (String[] child : children(ctx, tree, rootId)) {
            if (fname.equals(child[1])) DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, child[0]));
        }
        Uri out = DocumentsContract.createDocument(cr, dir, "application/zip", fname);
        if (out == null) throw new IllegalStateException("Cannot create the file");
        try (OutputStream os = cr.openOutputStream(out, "w")) {
            if (os == null) throw new IllegalStateException("Cannot write the file");
            try (ZipOutputStream zip = new ZipOutputStream(os)) {
                SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
                iso.setTimeZone(TimeZone.getTimeZone("UTC"));
                JSONObject meta = new JSONObject();
                meta.put("format", "gazgolder");
                meta.put("version", 1);
                meta.put("name", name);
                meta.put("exported", iso.format(new Date()));
                meta.put("photos", photos);
                zip.setLevel(6);
                zip.putNextEntry(new ZipEntry("gazgolder.json"));
                zip.write(meta.toString(2).getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
                byte[] buf = new byte[1 << 16];
                for (Object[] f : files) {
                    String entry = (String) f[0];
                    zip.setLevel(ArchiveNames.isPhoto(entry.substring(entry.lastIndexOf('/') + 1)) ? Deflater.NO_COMPRESSION : 6);
                    zip.putNextEntry(new ZipEntry(entry));
                    try (InputStream in = new FileInputStream((File) f[1])) {
                        int n;
                        while ((n = in.read(buf)) > 0) zip.write(buf, 0, n);
                    }
                    zip.closeEntry();
                }
            }
        }
    }

    private static void prune(Context ctx, Uri tree, String prefix, int keep) {
        try {
            ContentResolver cr = ctx.getContentResolver();
            String rootId = DocumentsContract.getTreeDocumentId(tree);
            List<String[]> kids = children(ctx, tree, rootId);
            List<String> names = new ArrayList<>();
            for (String[] k : kids) names.add(k[1]);
            List<String> del = ArchiveNames.toDelete(names, prefix, keep);
            for (String[] k : kids) {
                if (del.contains(k[1])) DocumentsContract.deleteDocument(cr, DocumentsContract.buildDocumentUriUsingTree(tree, k[0]));
            }
        } catch (Exception ignored) {
        }
    }

    static List<String[]> children(Context ctx, Uri tree, String parentId) {
        List<String[]> out = new ArrayList<>();
        Uri uri = DocumentsContract.buildChildDocumentsUriUsingTree(tree, parentId);
        String[] cols = {DocumentsContract.Document.COLUMN_DOCUMENT_ID, DocumentsContract.Document.COLUMN_DISPLAY_NAME};
        try (Cursor c = ctx.getContentResolver().query(uri, cols, null, null, null)) {
            while (c != null && c.moveToNext()) {
                String id = c.getString(0), name = c.getString(1);
                if (id != null && name != null) out.add(new String[]{id, name});
            }
        }
        return out;
    }

    private static byte[] readAll(InputStream in) throws Exception {
        java.io.ByteArrayOutputStream bo = new java.io.ByteArrayOutputStream();
        byte[] buf = new byte[8192];
        int n;
        while ((n = in.read(buf)) > 0) bo.write(buf, 0, n);
        return bo.toByteArray();
    }
}
