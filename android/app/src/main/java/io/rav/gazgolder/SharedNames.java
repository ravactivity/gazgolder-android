package io.rav.gazgolder;

import java.util.Locale;

final class SharedNames {
    private static final int MAX_LEN = 100;

    private SharedNames() {
    }

    static boolean isImageType(String type) {
        return type == null || type.isEmpty() || type.toLowerCase(Locale.ROOT).startsWith("image/");
    }

    static String kind(String mime, String name) {
        String m = mime == null ? "" : mime.toLowerCase(Locale.ROOT);
        if (m.equals("image/jpeg") || m.equals("image/jpg") || m.equals("image/pjpeg")) return "jpg";
        if (m.equals("image/png")) return "png";
        if (m.startsWith("image/")) return "convert";
        String e = ext(name == null ? "" : name);
        if (e.equals("jpg") || e.equals("jpeg")) return "jpg";
        if (e.equals("png")) return "png";
        return "convert";
    }

    static String clean(String display, String kind, int index) {
        String n = display == null ? "" : display;
        int slash = Math.max(n.lastIndexOf('/'), n.lastIndexOf('\\'));
        if (slash >= 0) n = n.substring(slash + 1);
        String stem = n;
        int dot = n.lastIndexOf('.');
        if (dot > 0) stem = n.substring(0, dot);
        stem = stem.replaceAll("[^\\p{L}\\p{N}._ ()-]", "_").replaceAll("^[ .]+|[ .]+$", "");
        if (stem.isEmpty()) stem = "shared_" + index;
        if (stem.length() > MAX_LEN) stem = stem.substring(0, MAX_LEN);
        String e = ext(n);
        if ("jpg".equals(kind)) return stem + (e.equals("jpeg") ? ".jpeg" : ".jpg");
        if ("png".equals(kind)) return stem + ".png";
        return stem + ".jpg";
    }

    static String unique(String name, int attempt) {
        if (attempt <= 1) return name;
        int dot = name.lastIndexOf('.');
        return dot > 0 ? name.substring(0, dot) + "_" + attempt + name.substring(dot) : name + "_" + attempt;
    }

    static int sampleSize(int width, int height, int maxSide) {
        int s = 1;
        while (Math.max(width, height) / (s * 2) >= maxSide) s *= 2;
        return s;
    }

    private static String ext(String n) {
        int dot = n.lastIndexOf('.');
        return dot > 0 && dot < n.length() - 1 ? n.substring(dot + 1).toLowerCase(Locale.ROOT) : "";
    }
}
