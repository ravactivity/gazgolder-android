package io.rav.gazgolder;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(GasNativePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
