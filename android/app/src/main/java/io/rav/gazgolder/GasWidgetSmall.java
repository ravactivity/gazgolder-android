package io.rav.gazgolder;

import android.appwidget.AppWidgetManager;
import android.appwidget.AppWidgetProvider;
import android.content.Context;
import android.widget.RemoteViews;

import org.json.JSONObject;

public class GasWidgetSmall extends AppWidgetProvider {
    @Override
    public void onUpdate(Context ctx, AppWidgetManager mgr, int[] ids) {
        for (int id : ids) update(ctx, mgr, id);
    }

    static void update(Context ctx, AppWidgetManager mgr, int id) {
        RemoteViews v = new RemoteViews(ctx.getPackageName(), R.layout.gas_widget_small);
        v.setOnClickPendingIntent(R.id.ws_root, GasWidget.open(ctx, null, 2));
        JSONObject w = GasWidget.data(ctx);
        double level = w == null ? Double.NaN : GasWidget.levelAt(w, System.currentTimeMillis());
        if (Double.isNaN(level)) {
            v.setTextViewText(R.id.ws_level, "—");
            v.setProgressBar(R.id.ws_bar, 100, 0, false);
        } else {
            v.setTextViewText(R.id.ws_level, WidgetMath.percent(level) + "%");
            v.setProgressBar(R.id.ws_bar, 100, WidgetMath.percent(level), false);
        }
        v.setTextViewText(R.id.ws_name, w == null ? ctx.getString(R.string.app_name) : w.optString("name", ctx.getString(R.string.app_name)));
        mgr.updateAppWidget(id, v);
    }
}
