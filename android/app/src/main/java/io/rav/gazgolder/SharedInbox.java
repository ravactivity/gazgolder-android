package io.rav.gazgolder;

import android.content.ClipData;
import android.content.ContentResolver;
import android.content.Context;
import android.content.Intent;
import android.database.Cursor;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.net.Uri;
import android.provider.OpenableColumns;

import androidx.core.content.IntentCompat;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;

import java.io.File;
import java.io.FileOutputStream;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

final class SharedInbox {
    private static final long MAX_BYTES = 40L * 1024 * 1024;
    private static final long MAX_AGE_MS = 24L * 3600 * 1000;
    private static final int MAX_FILES = 50;
    private static final int MAX_SIDE = 4000;
    private static final List<JSObject> pending = new ArrayList<>();

    private SharedInbox() {
    }

    static boolean isShare(Intent intent) {
        if (intent == null) return false;
        String a = intent.getAction();
        if (!Intent.ACTION_SEND.equals(a) && !Intent.ACTION_SEND_MULTIPLE.equals(a)) return false;
        if ((intent.getFlags() & Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return false;
        return SharedNames.isImageType(intent.getType());
    }

    static void receive(Context ctx, Intent intent, Runnable done) {
        final List<Uri> list = uris(intent);
        if (list.isEmpty()) return;
        final Context app = ctx.getApplicationContext();
        new Thread(() -> {
            File root = new File(app.getCacheDir(), "shared");
            cleanup(root);
            File dir = new File(root, String.valueOf(System.currentTimeMillis()));
            if (!dir.mkdirs() && !dir.isDirectory()) return;
            List<JSObject> got = new ArrayList<>();
            int n = 0;
            for (Uri u : list) {
                if (n >= MAX_FILES) break;
                n++;
                try {
                    JSObject f = copy(app, u, dir, n);
                    if (f != null) got.add(f);
                } catch (Exception ignored) {
                }
            }
            if (got.isEmpty()) return;
            synchronized (SharedInbox.class) {
                pending.addAll(got);
            }
            done.run();
        }, "gas-share").start();
    }

    static synchronized JSArray take() {
        JSArray a = new JSArray();
        for (JSObject f : pending) a.put(f);
        pending.clear();
        return a;
    }

    private static List<Uri> uris(Intent intent) {
        Set<Uri> out = new LinkedHashSet<>();
        if (Intent.ACTION_SEND.equals(intent.getAction())) {
            Uri u = IntentCompat.getParcelableExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (u != null) out.add(u);
        } else {
            ArrayList<Uri> l = IntentCompat.getParcelableArrayListExtra(intent, Intent.EXTRA_STREAM, Uri.class);
            if (l != null) out.addAll(l);
        }
        ClipData clip = intent.getClipData();
        if (clip != null) {
            for (int i = 0; i < clip.getItemCount(); i++) {
                Uri u = clip.getItemAt(i).getUri();
                if (u != null) out.add(u);
            }
        }
        List<Uri> res = new ArrayList<>();
        for (Uri u : out) if (ContentResolver.SCHEME_CONTENT.equals(u.getScheme())) res.add(u);
        return res;
    }

    private static JSObject copy(Context ctx, Uri uri, File dir, int index) throws Exception {
        ContentResolver cr = ctx.getContentResolver();
        String mime = cr.getType(uri);
        if (mime != null && !SharedNames.isImageType(mime) && !"application/octet-stream".equals(mime)) return null;
        String display = displayName(cr, uri);
        String kind = SharedNames.kind(mime, display);
        String base = SharedNames.clean(display, kind, index);
        File out = new File(dir, base);
        for (int i = 2; out.exists(); i++) out = new File(dir, SharedNames.unique(base, i));
        boolean ok = "convert".equals(kind) ? convert(cr, uri, out) : copyBytes(cr, uri, out);
        if (!ok) {
            out.delete();
            return null;
        }
        JSObject f = new JSObject();
        f.put("path", "file://" + out.getAbsolutePath());
        f.put("name", out.getName());
        f.put("type", "png".equals(kind) ? "image/png" : "image/jpeg");
        return f;
    }

    private static boolean copyBytes(ContentResolver cr, Uri uri, File out) throws Exception {
        long total = 0;
        try (InputStream in = cr.openInputStream(uri); OutputStream os = new FileOutputStream(out)) {
            if (in == null) return false;
            byte[] buf = new byte[64 * 1024];
            int r;
            while ((r = in.read(buf)) > 0) {
                total += r;
                if (total > MAX_BYTES) return false;
                os.write(buf, 0, r);
            }
        }
        return total > 0;
    }

    private static boolean convert(ContentResolver cr, Uri uri, File out) throws Exception {
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        try (InputStream in = cr.openInputStream(uri)) {
            if (in == null) return false;
            BitmapFactory.decodeStream(in, null, o);
        }
        if (o.outWidth <= 0 || o.outHeight <= 0) return false;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = SharedNames.sampleSize(o.outWidth, o.outHeight, MAX_SIDE);
        Bitmap bmp;
        try (InputStream in = cr.openInputStream(uri)) {
            bmp = BitmapFactory.decodeStream(in, null, o2);
        }
        if (bmp == null) return false;
        try (OutputStream os = new FileOutputStream(out)) {
            return bmp.compress(Bitmap.CompressFormat.JPEG, 92, os);
        } finally {
            bmp.recycle();
        }
    }

    private static String displayName(ContentResolver cr, Uri uri) {
        try (Cursor c = cr.query(uri, new String[]{OpenableColumns.DISPLAY_NAME}, null, null, null)) {
            if (c != null && c.moveToFirst() && !c.isNull(0)) return c.getString(0);
        } catch (Exception ignored) {
        }
        String last = uri.getLastPathSegment();
        return last == null ? "" : last;
    }

    private static void cleanup(File root) {
        File[] dirs = root.listFiles();
        if (dirs == null) return;
        long now = System.currentTimeMillis();
        for (File d : dirs) {
            if (now - d.lastModified() < MAX_AGE_MS) continue;
            File[] fs = d.listFiles();
            if (fs != null) for (File f : fs) f.delete();
            d.delete();
        }
    }
}
