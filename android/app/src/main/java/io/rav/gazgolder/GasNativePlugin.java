package io.rav.gazgolder;

import android.content.ContentResolver;
import android.content.ContentValues;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.graphics.Bitmap;
import android.graphics.BitmapFactory;
import android.graphics.Matrix;
import android.graphics.Rect;
import android.net.Uri;
import android.os.Environment;
import android.provider.MediaStore;

import androidx.activity.result.ActivityResult;
import androidx.appcompat.app.AppCompatDelegate;
import androidx.core.os.LocaleListCompat;
import androidx.exifinterface.media.ExifInterface;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.mlkit.vision.common.InputImage;
import com.google.mlkit.vision.text.Text;
import com.google.mlkit.vision.text.TextRecognition;
import com.google.mlkit.vision.text.TextRecognizer;
import com.google.mlkit.vision.text.latin.TextRecognizerOptions;

import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.io.OutputStream;

@CapacitorPlugin(name = "GasNative")
public class GasNativePlugin extends Plugin {
    private static final int MAX_SIDE = 1600;

    @PluginMethod
    public void updateWidget(PluginCall call) {
        GasWidget.updateAll(getContext());
        call.resolve();
    }

    @PluginMethod
    public void takeShared(PluginCall call) {
        JSObject ret = new JSObject();
        ret.put("files", SharedInbox.take());
        call.resolve(ret);
    }

    void sharedReady() {
        notifyListeners("shared", new JSObject(), true);
    }

    @PluginMethod
    public void capture(PluginCall call) {
        Intent intent = new Intent(getContext(), GasCameraActivity.class);
        intent.putExtra(GasCameraActivity.EXTRA_HINT, call.getString("hint", ""));
        startActivityForResult(call, intent, "captured");
    }

    @ActivityCallback
    private void captured(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        String path = data == null ? null : data.getStringExtra(GasCameraActivity.EXTRA_PATH);
        if (result.getResultCode() != android.app.Activity.RESULT_OK || path == null) {
            String err = data == null ? null : data.getStringExtra("error");
            call.reject(err == null ? "Cancelled" : err, err == null ? "CANCELLED" : err);
            return;
        }
        JSObject ret = new JSObject();
        ret.put("path", "file://" + path);
        call.resolve(ret);
    }

    @PluginMethod
    public void saveToGallery(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) {
            call.reject("Android 10+", "UNSUPPORTED");
            return;
        }
        String path = call.getString("path", "");
        String name = call.getString("name", "");
        String album = "app".equals(call.getString("album", "camera")) ? Environment.DIRECTORY_PICTURES + "/Gazgolder" : Environment.DIRECTORY_DCIM + "/Camera";
        new Thread(() -> {
            try {
                File src = appFile(getContext(), path);
                String display = name.isEmpty() ? src.getName() : name.replaceAll("[\\\\/:*?\"<>|]", "_");
                String mime = display.toLowerCase().endsWith(".png") ? "image/png" : "image/jpeg";
                ContentResolver cr = getContext().getContentResolver();
                ContentValues v = new ContentValues();
                v.put(MediaStore.Images.Media.DISPLAY_NAME, display);
                v.put(MediaStore.Images.Media.MIME_TYPE, mime);
                v.put(MediaStore.Images.Media.RELATIVE_PATH, album);
                v.put(MediaStore.Images.Media.IS_PENDING, 1);
                Uri uri = cr.insert(MediaStore.Images.Media.EXTERNAL_CONTENT_URI, v);
                if (uri == null) throw new IllegalStateException("MediaStore insert failed");
                try (InputStream in = new FileInputStream(src); OutputStream out = cr.openOutputStream(uri)) {
                    if (out == null) throw new IllegalStateException("MediaStore stream failed");
                    byte[] buf = new byte[65536];
                    for (int n; (n = in.read(buf)) > 0; ) out.write(buf, 0, n);
                } catch (Exception e) {
                    cr.delete(uri, null, null);
                    throw e;
                }
                v.clear();
                v.put(MediaStore.Images.Media.IS_PENDING, 0);
                cr.update(uri, v, null, null);
                JSObject ret = new JSObject();
                ret.put("uri", uri.toString());
                call.resolve(ret);
            } catch (Exception e) {
                call.reject(e.getMessage() == null ? e.toString() : e.getMessage(), "FAILED");
            }
        }).start();
    }

    @PluginMethod
    public void pinWidget(PluginCall call) {
        JSObject ret = new JSObject();
        boolean ok = false;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            android.appwidget.AppWidgetManager m = android.appwidget.AppWidgetManager.getInstance(getContext());
            Class<?> cls = Boolean.TRUE.equals(call.getBoolean("small", false)) ? GasWidgetSmall.class : GasWidget.class;
            if (m.isRequestPinAppWidgetSupported()) ok = m.requestPinAppWidget(new android.content.ComponentName(getContext(), cls), null, null);
        }
        ret.put("ok", ok);
        call.resolve(ret);
    }

    @PluginMethod
    public void getLanguage(PluginCall call) {
        getActivity().runOnUiThread(() -> {
            JSObject ret = new JSObject();
            LocaleListCompat locales = AppCompatDelegate.getApplicationLocales();
            ret.put("lang", locales.isEmpty() ? "" : locales.get(0).getLanguage());
            call.resolve(ret);
        });
    }

    @PluginMethod
    public void setLanguage(PluginCall call) {
        String lang = call.getString("lang", "");
        if (!"ru".equals(lang) && !"en".equals(lang)) {
            call.reject("Unsupported language");
            return;
        }
        getActivity().runOnUiThread(() -> {
            LocaleListCompat current = AppCompatDelegate.getApplicationLocales();
            if (current.isEmpty() || !lang.equals(current.get(0).getLanguage())) {
                AppCompatDelegate.setApplicationLocales(LocaleListCompat.forLanguageTags(lang));
            }
            call.resolve();
        });
    }

    @PluginMethod
    public void recognizeText(PluginCall call) {
        String path = call.getString("path");
        if (path == null || path.isEmpty()) {
            call.reject("No photo path");
            return;
        }
        final Bitmap bmp;
        try {
            bmp = loadUpright(getContext(), path);
        } catch (Exception e) {
            call.reject("Cannot open photo: " + e.getMessage());
            return;
        }
        if (bmp == null) {
            call.reject("Cannot open photo");
            return;
        }
        final TextRecognizer recognizer = TextRecognition.getClient(TextRecognizerOptions.DEFAULT_OPTIONS);
        recognizer.process(InputImage.fromBitmap(bmp, 0))
                .addOnSuccessListener(text -> {
                    JSObject ret = new JSObject();
                    ret.put("width", bmp.getWidth());
                    ret.put("height", bmp.getHeight());
                    JSArray lines = new JSArray();
                    for (Text.TextBlock block : text.getTextBlocks()) {
                        for (Text.Line line : block.getLines()) {
                            JSObject l = new JSObject();
                            l.put("text", line.getText());
                            l.put("box", box(line.getBoundingBox()));
                            JSArray els = new JSArray();
                            for (Text.Element el : line.getElements()) {
                                JSObject e = new JSObject();
                                e.put("text", el.getText());
                                e.put("box", box(el.getBoundingBox()));
                                els.put(e);
                            }
                            l.put("elements", els);
                            lines.put(l);
                        }
                    }
                    ret.put("lines", lines);
                    recognizer.close();
                    call.resolve(ret);
                })
                .addOnFailureListener(e -> {
                    recognizer.close();
                    call.reject("Text recognition failed: " + e.getMessage());
                });
    }

    private static JSArray box(Rect r) {
        JSArray a = new JSArray();
        if (r == null) r = new Rect();
        a.put(r.left);
        a.put(r.top);
        a.put(r.right);
        a.put(r.bottom);
        return a;
    }

    static File appFile(Context ctx, String path) throws Exception {
        Uri uri = path.startsWith("/") ? Uri.fromFile(new File(path)) : Uri.parse(path);
        if (!"file".equals(uri.getScheme()) || uri.getPath() == null) throw new SecurityException("an app file path is expected");
        File f = new File(uri.getPath()).getCanonicalFile();
        String canon = f.getPath();
        String own = ctx.getFilesDir().getCanonicalPath();
        String cache = ctx.getCacheDir().getCanonicalPath();
        if (!canon.startsWith(own + File.separator) && !canon.startsWith(cache + File.separator)) {
            throw new SecurityException("file outside the app folder");
        }
        return f;
    }

    static Bitmap loadUpright(Context ctx, String path) throws Exception {
        Uri uri = Uri.fromFile(appFile(ctx, path));
        BitmapFactory.Options o = new BitmapFactory.Options();
        o.inJustDecodeBounds = true;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            BitmapFactory.decodeStream(in, null, o);
        }
        int sample = 1;
        while (Math.max(o.outWidth, o.outHeight) / (sample * 2) >= MAX_SIDE) sample *= 2;
        BitmapFactory.Options o2 = new BitmapFactory.Options();
        o2.inSampleSize = sample;
        Bitmap bmp;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            bmp = BitmapFactory.decodeStream(in, null, o2);
        }
        if (bmp == null) return null;
        int orientation;
        try (InputStream in = ctx.getContentResolver().openInputStream(uri)) {
            orientation = new ExifInterface(in).getAttributeInt(ExifInterface.TAG_ORIENTATION, ExifInterface.ORIENTATION_NORMAL);
        }
        Matrix m = new Matrix();
        switch (orientation) {
            case ExifInterface.ORIENTATION_ROTATE_90: m.postRotate(90); break;
            case ExifInterface.ORIENTATION_ROTATE_180: m.postRotate(180); break;
            case ExifInterface.ORIENTATION_ROTATE_270: m.postRotate(270); break;
            case ExifInterface.ORIENTATION_FLIP_HORIZONTAL: m.postScale(-1, 1); break;
            case ExifInterface.ORIENTATION_FLIP_VERTICAL: m.postScale(1, -1); break;
            case ExifInterface.ORIENTATION_TRANSPOSE: m.postRotate(90); m.postScale(-1, 1); break;
            case ExifInterface.ORIENTATION_TRANSVERSE: m.postRotate(270); m.postScale(-1, 1); break;
            default: break;
        }
        float k = Math.min(1f, (float) MAX_SIDE / Math.max(bmp.getWidth(), bmp.getHeight()));
        if (k < 1f) m.postScale(k, k);
        if (m.isIdentity()) return bmp;
        Bitmap out = Bitmap.createBitmap(bmp, 0, 0, bmp.getWidth(), bmp.getHeight(), m, true);
        if (out != bmp) bmp.recycle();
        return out;
    }
}
