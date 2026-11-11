package io.rav.gazgolder;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Locale;
import java.util.regex.Pattern;

final class ArchiveNames {
    static final long DAY = 86_400_000L;
    static final long SLACK = 3 * 3_600_000L;
    private static final Pattern ID = Pattern.compile("^[a-z0-9_-]{1,40}$");
    private static final Pattern UNSAFE = Pattern.compile("[\\\\/:*?\"<>|\\s]+");

    private ArchiveNames() {
    }

    static boolean validId(String id) {
        return id != null && ID.matcher(id).matches();
    }

    static String safe(String name) {
        String s = UNSAFE.matcher(name == null ? "" : name).replaceAll("_");
        if (s.length() > 60) s = s.substring(0, 60);
        return s.isEmpty() ? "gazgolder" : s;
    }

    static String prefix(String name, String pid) {
        return "gazgolder-" + safe(name) + "-" + pid + "-";
    }

    static String fileName(String name, String pid, int year, int month, int day, boolean photos) {
        return prefix(name, pid) + String.format(Locale.ROOT, "%04d-%02d-%02d", year, month, day) + (photos ? "" : "-no-photos") + ".zip";
    }

    static Pattern ownPattern(String prefix) {
        return Pattern.compile("^" + Pattern.quote(prefix) + "\\d{4}-\\d{2}-\\d{2}[^/]*\\.zip$");
    }

    static List<String> toDelete(List<String> names, String prefix, int keep) {
        Pattern own = ownPattern(prefix);
        List<String> mine = new ArrayList<>();
        for (String n : names) if (n != null && own.matcher(n).matches()) mine.add(n);
        Collections.sort(mine, Collections.reverseOrder());
        return keep >= mine.size() ? new ArrayList<>() : new ArrayList<>(mine.subList(Math.max(0, keep), mine.size()));
    }

    static boolean due(boolean force, long now, long last, int days, String sig, String lastSig) {
        if (force) return true;
        return now - last >= days * DAY - SLACK && !sig.equals(lastSig);
    }

    static boolean isPhoto(String name) {
        String n = name.toLowerCase(Locale.ROOT);
        return !n.startsWith(".") && (n.endsWith(".jpg") || n.endsWith(".jpeg") || n.endsWith(".png"));
    }

    static int clamp(int v, int lo, int hi) {
        return Math.max(lo, Math.min(hi, v));
    }

    static String signature(String name, boolean photos, List<String[]> files) {
        long h = 1125899906842597L;
        StringBuilder sb = new StringBuilder(name).append('|').append(photos);
        for (String[] f : files) sb.append('|').append(f[0]).append(':').append(f[1]).append(':').append(f[2]);
        String s = sb.toString();
        for (int i = 0; i < s.length(); i++) h = 31 * h + s.charAt(i);
        return Long.toHexString(h) + ":" + files.size();
    }
}
