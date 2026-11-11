package io.rav.gazgolder;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.net.Uri;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class GasWidget extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) update(ctx, mgr, id);
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, GasWidget.class))) update(ctx, mgr, id);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, GasWidgetSmall.class))) GasWidgetSmall.update(ctx, mgr, id);
    }

    static PendingIntent open(Context ctx, String action, int code) {
        Intent i = new Intent(ctx, MainActivity.class);
        if (action != null) {
            i.setAction(Intent.ACTION_VIEW);
            i.setData(Uri.parse("gazgolder://" + action));
        }
        i.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        return PendingIntent.getActivity(ctx, code, i, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    static JSONObject data(Context ctx) {
        SharedPreferences sp = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String raw = sp.getString("widget", null);
        if (raw == null) return null;
        try {
            return new JSONObject(raw);
        } catch (Exception e) {
            return null;
        }
    }

    static Locale locale(JSONObject w) {
        return "ru".equals(w.optString("lang")) ? new Locale("ru", "RU") : Locale.US;
    }

    static void update(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.gas_widget);
        v.setOnClickPendingIntent(R.id.w_root, open(ctx, null, 0));
        v.setOnClickPendingIntent(R.id.w_cam, open(ctx, "photo", 1));
        JSONObject w = data(ctx);
        try {
            if (w == null) throw new IllegalStateException();
            JSONObject labels = w.optJSONObject("labels");
            if (labels == null) labels = new JSONObject();
            Locale loc = locale(w);
            long now = System.currentTimeMillis();
            double volume = w.optDouble("volume", 0);
            double level = levelAt(w, now);
            v.setTextViewText(R.id.w_name, w.optString("name", ctx.getString(R.string.app_name)));
            if (Double.isNaN(level)) {
                v.setTextViewText(R.id.w_level, "—");
                v.setTextViewText(R.id.w_liters, "");
                v.setProgressBar(R.id.w_bar, 100, 0, false);
                v.setTextViewText(R.id.w_note, labels.optString("noData", ctx.getString(R.string.widget_no_data)));
            } else {
                NumberFormat nf = NumberFormat.getIntegerInstance(loc);
                v.setTextViewText(R.id.w_level, Math.round(level) + "%");
                v.setTextViewText(R.id.w_liters, volume > 0 ? nf.format(Math.round(level * volume / 100)) + " " + labels.optString("liters", "L") : "");
                v.setProgressBar(R.id.w_bar, 100, WidgetMath.percent(level), false);
                v.setTextViewText(R.id.w_note, note(w, labels, loc, now));
            }
        } catch (Exception e) {
            v.setTextViewText(R.id.w_name, ctx.getString(R.string.app_name));
            v.setTextViewText(R.id.w_level, "—");
            v.setTextViewText(R.id.w_liters, "");
            v.setProgressBar(R.id.w_bar, 100, 0, false);
            v.setTextViewText(R.id.w_note, ctx.getString(R.string.widget_open_app));
        }
        mgr.updateAppWidget(id, v);
    }

    static double levelAt(JSONObject w, long t) {
        JSONArray lv = w.optJSONArray("levels");
        double[] arr = new double[lv == null ? 0 : lv.length()];
        for (int i = 0; i < arr.length; i++) arr[i] = lv.optDouble(i);
        double fallback = w.has("lastLevel") && !w.isNull("lastLevel") ? w.optDouble("lastLevel") : Double.NaN;
        return WidgetMath.levelAt(arr, w.optLong("start", 0), w.optDouble("minPct", 0), t, fallback);
    }

    private static String note(JSONObject w, JSONObject labels, Locale loc, long now) {
        SimpleDateFormat df = new SimpleDateFormat("d MMM", loc);
        long hit = w.optLong("hit", 0), orderBy = w.optLong("orderBy", 0);
        StringBuilder sb = new StringBuilder();
        if (hit > 0) {
            long days = WidgetMath.daysUntil(hit, now);
            sb.append(days <= 0 ? labels.optString("refill", "time to refill")
                    : WidgetMath.fill(labels.optString("toMin", "{n} days to minimum"), "n", String.valueOf(days)));
        }
        if (orderBy > now) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append(WidgetMath.fill(labels.optString("orderBy", "order by {d}"), "d", df.format(new Date(orderBy))));
        }
        long lastT = w.optLong("lastT", 0);
        if (sb.length() == 0 && lastT > 0) sb.append(WidgetMath.fill(labels.optString("photo", "photo of {d}"), "d", df.format(new Date(lastT))));
        return sb.toString();
    }
}
