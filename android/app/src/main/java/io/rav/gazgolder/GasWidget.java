package io.rav.gazgolder;

import android.app.PendingIntent;
import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.ComponentName;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.widget.RemoteViews;

import org.json.JSONArray;
import org.json.JSONObject;

import java.text.NumberFormat;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class GasWidget extends AppWidgetProvider {
    private static final long DAY = 86_400_000L;

    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) update(ctx, mgr, id);
    }

    static void updateAll(Context ctx) {
        AppWidgetManager mgr = AppWidgetManager.getInstance(ctx);
        for (int id : mgr.getAppWidgetIds(new ComponentName(ctx, GasWidget.class))) update(ctx, mgr, id);
    }

    static void update(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.gas_widget);
        Intent open = new Intent(ctx, MainActivity.class);
        open.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP);
        v.setOnClickPendingIntent(R.id.w_root, PendingIntent.getActivity(ctx, 0, open,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE));

        SharedPreferences sp = ctx.getSharedPreferences("CapacitorStorage", Context.MODE_PRIVATE);
        String raw = sp.getString("widget", null);
        try {
            if (raw == null) throw new IllegalStateException();
            JSONObject w = new JSONObject(raw);
            JSONObject labels = w.optJSONObject("labels");
            if (labels == null) labels = new JSONObject();
            Locale loc = "ru".equals(w.optString("lang")) ? new Locale("ru", "RU") : Locale.US;
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
                v.setProgressBar(R.id.w_bar, 100, (int) Math.max(0, Math.min(100, Math.round(level))), false);
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

    private static double levelAt(JSONObject w, long t) {
        JSONArray lv = w.optJSONArray("levels");
        long start = w.optLong("start", 0);
        double min = w.optDouble("minPct", 0);
        if (lv != null && lv.length() > 0 && start > 0) {
            if (t <= start) return lv.optDouble(0);
            double x = (t - start) / (double) DAY;
            int i = (int) Math.floor(x);
            if (i >= lv.length() - 1) return Math.max(min, lv.optDouble(lv.length() - 1));
            double a = lv.optDouble(i), b = lv.optDouble(i + 1);
            return Math.max(min, a + (b - a) * (x - i));
        }
        return w.has("lastLevel") && !w.isNull("lastLevel") ? w.optDouble("lastLevel") : Double.NaN;
    }

    private static String fill(String tpl, String key, String value) {
        return tpl.replace("{" + key + "}", value);
    }

    private static String note(JSONObject w, JSONObject labels, Locale loc, long now) {
        SimpleDateFormat df = new SimpleDateFormat("d MMM", loc);
        long hit = w.optLong("hit", 0), orderBy = w.optLong("orderBy", 0);
        StringBuilder sb = new StringBuilder();
        if (hit > 0) {
            long days = Math.round((hit - now) / (double) DAY);
            sb.append(days <= 0 ? labels.optString("refill", "time to refill")
                    : fill(labels.optString("toMin", "{n} days to minimum"), "n", String.valueOf(days)));
        }
        if (orderBy > now) {
            if (sb.length() > 0) sb.append(" · ");
            sb.append(fill(labels.optString("orderBy", "order by {d}"), "d", df.format(new Date(orderBy))));
        }
        long lastT = w.optLong("lastT", 0);
        if (sb.length() == 0 && lastT > 0) sb.append(fill(labels.optString("photo", "photo of {d}"), "d", df.format(new Date(lastT))));
        return sb.toString();
    }
}
