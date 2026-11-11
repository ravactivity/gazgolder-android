package io.rav.gazgolder;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.provider.DocumentsContract;

import androidx.activity.result.ActivityResult;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.ActivityCallback;
import com.getcapacitor.annotation.CapacitorPlugin;

import org.json.JSONObject;

import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

@CapacitorPlugin(name = "GasFolder")
public class GasFolderPlugin extends Plugin {
    private static final int RW = Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_GRANT_WRITE_URI_PERMISSION;
    private final ExecutorService io = Executors.newSingleThreadExecutor();

    @PluginMethod
    public void pick(PluginCall call) {
        Intent intent = new Intent(Intent.ACTION_OPEN_DOCUMENT_TREE);
        intent.addFlags(RW | Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION | Intent.FLAG_GRANT_PREFIX_URI_PERMISSION);
        try {
            startActivityForResult(call, intent, "picked");
        } catch (Exception e) {
            call.reject("No folder picker on this phone", "UNSUPPORTED");
        }
    }

    @ActivityCallback
    private void picked(PluginCall call, ActivityResult result) {
        if (call == null) return;
        Intent data = result.getData();
        Uri tree = data == null ? null : data.getData();
        if (tree == null) {
            call.reject("Cancelled", "CANCELLED");
            return;
        }
        try {
            getContext().getContentResolver().takePersistableUriPermission(tree, RW);
        } catch (SecurityException e) {
            call.reject("The folder cannot be kept: " + e.getMessage(), "NO_ACCESS");
            return;
        }
        JSObject ret = new JSObject();
        ret.put("uri", tree.toString());
        ret.put("name", folderName(tree));
        call.resolve(ret);
    }

    @PluginMethod
    public void info(PluginCall call) {
        Uri tree = parse(call);
        JSObject ret = new JSObject();
        ret.put("ok", tree != null && ArchiveJob.hasAccess(getContext(), tree));
        ret.put("name", tree == null ? "" : folderName(tree));
        call.resolve(ret);
    }

    @PluginMethod
    public void release(PluginCall call) {
        Uri tree = parse(call);
        if (tree != null) {
            try {
                getContext().getContentResolver().releasePersistableUriPermission(tree, RW);
            } catch (SecurityException ignored) {
            }
        }
        call.resolve();
    }

    @PluginMethod
    public void schedule(PluginCall call) {
        try {
            ArchiveWorker.schedule(getContext());
            call.resolve();
        } catch (Exception e) {
            call.reject("Cannot schedule: " + e.getMessage());
        }
    }

    @PluginMethod
    public void run(PluginCall call) {
        boolean force = Boolean.TRUE.equals(call.getBoolean("force", false));
        io.execute(() -> {
            try {
                JSONObject r = ArchiveJob.run(getContext(), force);
                JSObject ret = new JSObject();
                ret.put("saved", r.optInt("saved", 0));
                ret.put("time", r.optLong("time", 0));
                call.resolve(ret);
            } catch (SecurityException e) {
                call.reject("No access to the folder", "NO_ACCESS");
            } catch (Exception e) {
                call.reject("Cannot save the archive: " + e.getMessage());
            }
        });
    }

    private Uri parse(PluginCall call) {
        String s = call.getString("tree", "");
        if (s == null || !s.startsWith("content://")) return null;
        return Uri.parse(s);
    }

    private String folderName(Uri tree) {
        try {
            Uri doc = DocumentsContract.buildDocumentUriUsingTree(tree, DocumentsContract.getTreeDocumentId(tree));
            try (Cursor c = getContext().getContentResolver().query(doc, new String[]{DocumentsContract.Document.COLUMN_DISPLAY_NAME}, null, null, null)) {
                if (c != null && c.moveToFirst() && c.getString(0) != null) return c.getString(0);
            }
        } catch (Exception ignored) {
        }
        return "";
    }
}
