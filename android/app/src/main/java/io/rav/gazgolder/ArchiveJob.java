package io.rav.gazgolder;

import android.content.ContentResolver;
import android.content.ContentUris;
import android.content.ContentValues;
import android.content.Context;
import android.content.SharedPreferences;
import android.content.UriPermission;
import android.database.Cursor;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.provider.DocumentsContract;
import android.provider.MediaStore;

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
    static final String FOLDER = "Gazgolder";
    private static final String[] DATA_FILES = {"gas_levels.csv", "refuels.csv", "settings.json", "passport.json", "services.json"};
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
            if (!cfg.optBoolean("on", false)) return res;
            Target target = target(ctx, cfg);
            if (target == null) return res;
            JSONObject st;
            try {
                st = new JSONObject(sp.getString(STATE, "{}"));
            } catch (Exception e) {
                st = new JSONObject();
            }
            JSONObject last = st.optJSONObject("last") != null ? st.optJSONObject("last") : new JSONObject();
            JSONObject sigs = st.optJSONObject("sig") != null ? st.optJSONObject("sig") : new JSONObject();
            boolean photos = cfg.optBoolean("photos", true), withData = cfg.optBoolean("data", true);
            String app = cfg.optString("app", "");
            JSONArray pids = cfg.optJSONArray("pids");
            JSONObject curSup = cfg.optJSONObject("curSup") != null ? cfg.optJSONObject("curSup") : new JSONObject();
            int days = ArchiveNames.clamp(cfg.optInt("days", 7), 1, 365);
            int keep = ArchiveNames.clamp(cfg.optInt("keep", 5), 1, 100);
            File data = new File(ctx.getFilesDir(), "data"), media = new File(ctx.getFilesDir(), "media");
            long now = System.currentTimeMillis();
            int saved = 0;
            List<String[]> list = new ArrayList<>();
            if (!withData && !photos) {
                if (!app.isEmpty()) list.add(new String[]{"app", "settings"});
            } else {
                for (String[] p : profiles(data, cfg.optString("defaultName", "Основной"))) if (chosen(pids, p[0])) list.add(p);
            }
            for (String[] p : list) {
                String pid = p[0], name = p[1];
                boolean appOnly = "app".equals(pid) && !withData && !photos;
                File dir = new File(data, pid);
                if (!appOnly && !dir.isDirectory()) continue;
                List<Object[]> files = appOnly ? new ArrayList<>() : collect(dir, new File(media, pid), withData, photos);
                File sups = new File(data, "suppliers.json");
                if (!appOnly && withData && sups.isFile()) files.add(0, new Object[]{"suppliers.json", sups});
                String supplier = appOnly || !withData ? "" : curSup.optString(pid, "");
                List<String[]> sigParts = new ArrayList<>();
                for (Object[] f : files) {
                    File file = (File) f[1];
                    sigParts.add(new String[]{(String) f[0], String.valueOf(file.length()), String.valueOf(file.lastModified())});
                }
                String sig = ArchiveNames.signature(name + "|" + withData + "|" + app.hashCode() + "|" + supplier, photos, sigParts);
                if (!ArchiveNames.due(force, now, last.optLong(pid, 0), days, sig, sigs.optString(pid, ""))) continue;
                Calendar c = Calendar.getInstance();
                String prefix = ArchiveNames.prefix(name, pid);
                String fname = ArchiveNames.fileName(name, pid, c.get(Calendar.YEAR), c.get(Calendar.MONTH) + 1, c.get(Calendar.DAY_OF_MONTH), photos || appOnly);
                write(target, fname, name, photos, files, app, !appOnly && "default".equals(pid), supplier);
                prune(target, prefix, keep);
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

    private static boolean chosen(JSONArray pids, String pid) {
        if (pids == null) return true;
        for (int i = 0; i < pids.length(); i++) if (pid.equals(pids.optString(i))) return true;
        return false;
    }

    interface Target {
        List<String> names() throws Exception;

        void delete(String name) throws Exception;

        OutputStream create(String name) throws Exception;

        void done(String name) throws Exception;
    }

    static Target target(Context ctx, JSONObject cfg) {
        String treeStr = cfg.optString("tree", "");
        if (!"default".equals(cfg.optString("where", "tree")) && treeStr.startsWith("content://")) {
            Uri tree = Uri.parse(treeStr);
            if (!hasAccess(ctx, tree)) throw new SecurityException("NO_ACCESS");
            return new TreeTarget(ctx, tree);
        }
        if (!"default".equals(cfg.optString("where", "tree"))) return null;
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) throw new UnsupportedOperationException("UNSUPPORTED");
        return new MediaTarget(ctx);
    }

    static final class TreeTarget implements Target {
        private final Context ctx;
        private final Uri tree;
        private final String rootId;

        TreeTarget(Context ctx, Uri tree) {
            this.ctx = ctx;
            this.tree = tree;
            this.rootId = DocumentsContract.getTreeDocumentId(tree);
        }

        public List<String> names() {
            List<String> out = new ArrayList<>();
            for (String[] k : children(ctx, tree, rootId)) out.add(k[1]);
            return out;
        }

        public void delete(String name) throws Exception {
            for (String[] k : children(ctx, tree, rootId)) {
                if (name.equals(k[1])) DocumentsContract.deleteDocument(ctx.getContentResolver(), DocumentsContract.buildDocumentUriUsingTree(tree, k[0]));
            }
        }

        public OutputStream create(String name) throws Exception {
            Uri dir = DocumentsContract.buildDocumentUriUsingTree(tree, rootId);
            Uri out = DocumentsContract.createDocument(ctx.getContentResolver(), dir, "application/zip", name);
            if (out == null) throw new IllegalStateException("Cannot create the file");
            OutputStream os = ctx.getContentResolver().openOutputStream(out, "w");
            if (os == null) throw new IllegalStateException("Cannot write the file");
            return os;
        }

        public void done(String name) {
        }
    }

    @androidx.annotation.RequiresApi(Build.VERSION_CODES.Q)
    static final class MediaTarget implements Target {
        private final Context ctx;
        private final Uri coll = MediaStore.Files.getContentUri("external_primary");
        private final String rel = Environment.DIRECTORY_DOCUMENTS + "/" + FOLDER + "/";
        private Uri pending;

        MediaTarget(Context ctx) {
            this.ctx = ctx;
        }

        private List<Object[]> rows() {
            List<Object[]> out = new ArrayList<>();
            String[] cols = {MediaStore.MediaColumns._ID, MediaStore.MediaColumns.DISPLAY_NAME};
            try (Cursor c = ctx.getContentResolver().query(coll, cols, MediaStore.MediaColumns.RELATIVE_PATH + "=?", new String[]{rel}, null)) {
                while (c != null && c.moveToNext()) if (c.getString(1) != null) out.add(new Object[]{c.getLong(0), c.getString(1)});
            }
            return out;
        }

        public List<String> names() {
            List<String> out = new ArrayList<>();
            for (Object[] r : rows()) out.add((String) r[1]);
            return out;
        }

        public void delete(String name) {
            for (Object[] r : rows()) {
                if (name.equals(r[1])) ctx.getContentResolver().delete(ContentUris.withAppendedId(coll, (Long) r[0]), null, null);
            }
        }

        public OutputStream create(String name) throws Exception {
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.DISPLAY_NAME, name);
            v.put(MediaStore.MediaColumns.MIME_TYPE, "application/zip");
            v.put(MediaStore.MediaColumns.RELATIVE_PATH, rel);
            v.put(MediaStore.MediaColumns.IS_PENDING, 1);
            pending = ctx.getContentResolver().insert(coll, v);
            if (pending == null) throw new IllegalStateException("Cannot create the file");
            OutputStream os = ctx.getContentResolver().openOutputStream(pending, "w");
            if (os == null) throw new IllegalStateException("Cannot write the file");
            return os;
        }

        public void done(String name) {
            if (pending == null) return;
            ContentValues v = new ContentValues();
            v.put(MediaStore.MediaColumns.IS_PENDING, 0);
            ctx.getContentResolver().update(pending, v, null, null);
            pending = null;
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

    private static List<Object[]> collect(File dir, File media, boolean withData, boolean photos) {
        List<Object[]> out = new ArrayList<>();
        for (String f : withData ? DATA_FILES : new String[0]) {
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

    private static void write(Target target, String fname, String name, boolean photos, List<Object[]> files, String app, boolean main, String supplier) throws Exception {
        target.delete(fname);
        try (OutputStream os = target.create(fname)) {
            try (ZipOutputStream zip = new ZipOutputStream(os)) {
                SimpleDateFormat iso = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.ROOT);
                iso.setTimeZone(TimeZone.getTimeZone("UTC"));
                JSONObject meta = new JSONObject();
                meta.put("format", "gazgolder");
                meta.put("version", 1);
                meta.put("name", name);
                meta.put("exported", iso.format(new Date()));
                meta.put("photos", photos);
                meta.put("main", main);
                if (!supplier.isEmpty()) meta.put("currentSupplier", supplier);
                zip.setLevel(6);
                zip.putNextEntry(new ZipEntry("gazgolder.json"));
                zip.write(meta.toString(2).getBytes(StandardCharsets.UTF_8));
                zip.closeEntry();
                if (!app.isEmpty()) {
                    zip.putNextEntry(new ZipEntry("app-settings.json"));
                    zip.write(app.getBytes(StandardCharsets.UTF_8));
                    zip.closeEntry();
                }
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
        target.done(fname);
    }

    private static void prune(Target target, String prefix, int keep) {
        try {
            for (String n : ArchiveNames.toDelete(target.names(), prefix, keep)) target.delete(n);
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
