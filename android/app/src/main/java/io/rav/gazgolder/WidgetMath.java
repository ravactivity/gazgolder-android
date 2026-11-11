package io.rav.gazgolder;

final class WidgetMath {
    static final long DAY = 86_400_000L;

    private WidgetMath() {
    }

    static double levelAt(double[] levels, long start, double min, long t, double fallback) {
        if (levels != null && levels.length > 0 && start > 0) {
            if (t <= start) return levels[0];
            double x = (t - start) / (double) DAY;
            int i = (int) Math.floor(x);
            if (i >= levels.length - 1) return Math.max(min, levels[levels.length - 1]);
            double a = levels[i], b = levels[i + 1];
            return Math.max(min, a + (b - a) * (x - i));
        }
        return fallback;
    }

    static long daysUntil(long when, long now) {
        return Math.round((when - now) / (double) DAY);
    }

    static int percent(double level) {
        return (int) Math.max(0, Math.min(100, Math.round(level)));
    }

    static String fill(String tpl, String key, String value) {
        return tpl.replace("{" + key + "}", value);
    }
}
