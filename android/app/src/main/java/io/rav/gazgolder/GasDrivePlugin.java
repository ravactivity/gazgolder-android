package io.rav.gazgolder;

import android.accounts.Account;
import android.app.PendingIntent;
import android.os.Bundle;

import androidx.activity.result.ActivityResult;
import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.IntentSenderRequest;
import androidx.activity.result.contract.ActivityResultContracts;

import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import com.google.android.gms.auth.api.identity.AuthorizationClient;
import com.google.android.gms.auth.api.identity.AuthorizationRequest;
import com.google.android.gms.auth.api.identity.AuthorizationResult;
import com.google.android.gms.auth.api.identity.ClearTokenRequest;
import com.google.android.gms.auth.api.identity.Identity;
import com.google.android.gms.common.api.ApiException;
import com.google.android.gms.common.api.Scope;

import org.json.JSONException;

import java.util.Collections;
import java.util.List;

@CapacitorPlugin(name = "GasDrive")
public class GasDrivePlugin extends Plugin {
    private static final Scope DRIVE_FILE = new Scope("https://www.googleapis.com/auth/drive.file");

    private ActivityResultLauncher<IntentSenderRequest> launcher;
    private PluginCall pending;

    @Override
    public void load() {
        launcher = bridge.registerForActivityResult(new ActivityResultContracts.StartIntentSenderForResult(), this::onResult);
    }

    private AuthorizationClient client() {
        return Identity.getAuthorizationClient(getActivity());
    }

    private static AuthorizationRequest.Builder base(PluginCall call) {
        AuthorizationRequest.Builder b = AuthorizationRequest.builder().setRequestedScopes(Collections.singletonList(DRIVE_FILE));
        String account = call.getString("account", "");
        if (account != null && !account.isEmpty()) b.setAccount(new Account(account, "com.google"));
        return b;
    }

    @PluginMethod
    public void authorize(PluginCall call) {
        AuthorizationRequest.Builder b = base(call);
        if (Boolean.TRUE.equals(call.getBoolean("selectAccount", false))) b.setPrompt(AuthorizationRequest.Prompt.SELECT_ACCOUNT);
        run(call, b.build(), Boolean.TRUE.equals(call.getBoolean("interactive", false)));
    }

    @PluginMethod
    public void pick(PluginCall call) {
        AuthorizationRequest.Builder b = base(call)
                .setOptOutIncludingGrantedScopes(true)
                .setPrompt(AuthorizationRequest.Prompt.CONSENT)
                .addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_OAUTH_TRIGGER, "true");
        if (Boolean.TRUE.equals(call.getBoolean("multiple", false))) {
            b.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_ALLOW_MULTIPLE, "true");
        }
        if (Boolean.TRUE.equals(call.getBoolean("folders", false))) {
            b.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_ALLOW_FOLDER_SELECTION, "true");
        }
        String mime = call.getString("mimeTypes", "");
        if (mime != null && !mime.isEmpty()) b.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_MIMETYPES, mime);
        JSArray ids = call.getArray("fileIds", new JSArray());
        if (ids != null && ids.length() > 0) {
            try {
                List<String> list = ids.toList();
                b.addResourceParameter(AuthorizationRequest.ResourceParameter.PICKER_FILE_IDS, String.join(",", list));
            } catch (JSONException e) {
                call.reject("Bad fileIds");
                return;
            }
        }
        run(call, b.build(), true);
    }

    @PluginMethod
    public void clearToken(PluginCall call) {
        String token = call.getString("token", "");
        if (token == null || token.isEmpty()) {
            call.resolve();
            return;
        }
        client().clearToken(ClearTokenRequest.builder().setToken(token).build())
                .addOnSuccessListener(v -> call.resolve())
                .addOnFailureListener(e -> call.resolve());
    }

    private void run(PluginCall call, AuthorizationRequest req, boolean interactive) {
        client().authorize(req)
                .addOnSuccessListener(result -> {
                    if (!result.hasResolution()) {
                        call.resolve(toJs(result));
                        return;
                    }
                    if (!interactive) {
                        call.reject("Google access needs confirmation", "NEED_CONSENT");
                        return;
                    }
                    PendingIntent pi = result.getPendingIntent();
                    if (pi == null) {
                        call.reject("No authorization intent");
                        return;
                    }
                    if (pending != null) pending.reject("Cancelled", "CANCELLED");
                    pending = call;
                    getActivity().runOnUiThread(() -> {
                        try {
                            launcher.launch(new IntentSenderRequest.Builder(pi.getIntentSender()).build());
                        } catch (Exception e) {
                            PluginCall c = pending;
                            pending = null;
                            if (c != null) c.reject("Cannot open Google authorization: " + e.getMessage());
                        }
                    });
                })
                .addOnFailureListener(e -> call.reject("Google authorization failed: " + e.getMessage(), code(e)));
    }

    private void onResult(ActivityResult r) {
        PluginCall call = pending;
        pending = null;
        if (call == null) return;
        if (r.getData() == null) {
            call.reject("Cancelled", "CANCELLED");
            return;
        }
        try {
            AuthorizationResult result = client().getAuthorizationResultFromIntent(r.getData());
            call.resolve(toJs(result));
        } catch (ApiException e) {
            call.reject(e.getStatusCode() == 16 ? "Cancelled" : "Google authorization failed: " + e.getMessage(), e.getStatusCode() == 16 ? "CANCELLED" : code(e));
        }
    }

    private static String code(Exception e) {
        return e instanceof ApiException ? "API_" + ((ApiException) e).getStatusCode() : "FAILED";
    }

    private static JSObject toJs(AuthorizationResult result) {
        JSObject ret = new JSObject();
        ret.put("accessToken", result.getAccessToken());
        JSArray picked = new JSArray();
        Bundle params = result.getTokenResponseParams();
        String ids = params == null ? null : params.getString("picked_file_ids");
        if (ids != null) {
            for (String id : ids.split(",")) {
                String s = id.trim();
                if (!s.isEmpty()) picked.put(s);
            }
        }
        ret.put("picked", picked);
        return ret;
    }
}
