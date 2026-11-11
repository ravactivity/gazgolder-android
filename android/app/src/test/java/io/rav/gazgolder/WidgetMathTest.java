package io.rav.gazgolder;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class WidgetMathTest {
    private static final long D = WidgetMath.DAY;

    @Test
    public void levelIsInterpolatedFromTheDailyForecast() {
        double[] lv = {80, 78, 76, 74};
        long start = 10 * D;
        assertEquals(80, WidgetMath.levelAt(lv, start, 20, start - D, Double.NaN), 1e-9);
        assertEquals(79, WidgetMath.levelAt(lv, start, 20, start + D / 2, Double.NaN), 1e-9);
        assertEquals(76, WidgetMath.levelAt(lv, start, 20, start + 2 * D, Double.NaN), 1e-9);
        assertEquals(74, WidgetMath.levelAt(lv, start, 20, start + 30 * D, Double.NaN), 1e-9);
    }

    @Test
    public void levelNeverGoesBelowTheMinimumAndFallsBackWithoutAForecast() {
        double[] lv = {25, 15};
        assertEquals(20, WidgetMath.levelAt(lv, D, 20, D + D, Double.NaN), 1e-9);
        assertEquals(42, WidgetMath.levelAt(new double[0], D, 20, 5 * D, 42), 1e-9);
        assertEquals(42, WidgetMath.levelAt(null, 0, 20, 5 * D, 42), 1e-9);
        assertTrue(Double.isNaN(WidgetMath.levelAt(null, 0, 20, 5 * D, Double.NaN)));
    }

    @Test
    public void helpers() {
        assertEquals(3, WidgetMath.daysUntil(13 * D, 10 * D));
        assertEquals(0, WidgetMath.daysUntil(10 * D + 1000, 10 * D));
        assertEquals(100, WidgetMath.percent(130.2));
        assertEquals(0, WidgetMath.percent(-3));
        assertEquals(57, WidgetMath.percent(56.6));
        assertEquals("до минимума 5 дн.", WidgetMath.fill("до минимума {n} дн.", "n", "5"));
    }
}
