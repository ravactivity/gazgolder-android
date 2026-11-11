package io.rav.gazgolder;

import android.content.Intent;
import android.os.Bundle;

import com.getcapacitor.BridgeActivity;
import com.getcapacitor.PluginHandle;

public class MainActivity extends BridgeActivity {
    private boolean restored;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        restored = savedInstanceState != null;
        registerPlugin(GasNativePlugin.class);
        registerPlugin(GasDrivePlugin.class);
        registerPlugin(GasFolderPlugin.class);
        super.onCreate(savedInstanceState);
        try {
            ArchiveWorker.schedule(getApplicationContext());
        } catch (Exception ignored) {
        }
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        if (restored) {
            restored = false;
            return;
        }
        if (SharedInbox.isShare(intent)) SharedInbox.receive(this, intent, () -> runOnUiThread(this::sharedReady));
    }

    private void sharedReady() {
        try {
            PluginHandle h = getBridge() == null ? null : getBridge().getPlugin("GasNative");
            if (h != null && h.getInstance() instanceof GasNativePlugin) ((GasNativePlugin) h.getInstance()).sharedReady();
        } catch (Exception ignored) {
        }
    }
}
