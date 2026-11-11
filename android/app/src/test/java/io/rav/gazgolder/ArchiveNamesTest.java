package io.rav.gazgolder;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertNotEquals;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

import java.util.Arrays;
import java.util.Collections;
import java.util.List;

public class ArchiveNamesTest {
    @Test
    public void namesAreSafeAndCarryTheTankId() {
        assertEquals("Дача_у_реки", ArchiveNames.safe("Дача у реки"));
        assertEquals("a_b_c", ArchiveNames.safe("a/b\\c"));
        assertEquals("gazgolder", ArchiveNames.safe(""));
        assertEquals("gazgolder", ArchiveNames.safe(null));
        assertEquals(60, ArchiveNames.safe("x".repeat(80)).length());
        assertEquals("gazgolder-Дом-default-2026-03-07.zip", ArchiveNames.fileName("Дом", "default", 2026, 3, 7, true));
        assertEquals("gazgolder-Дом-p1-2026-11-04-no-photos.zip", ArchiveNames.fileName("Дом", "p1", 2026, 11, 4, false));
    }

    @Test
    public void onlyOwnOldArchivesAreDeleted() {
        String prefix = ArchiveNames.prefix("Дача", "p1");
        List<String> names = Arrays.asList(
                "gazgolder-Дача-p1-2026-01-01.zip", "gazgolder-Дача-p1-2026-03-01.zip", "gazgolder-Дача-p1-2026-02-01-no-photos.zip",
                "gazgolder-Дача-p12-2026-01-01.zip", "gazgolder-Дача-p1-backup.zip", "notes.txt", null);
        assertEquals(Collections.singletonList("gazgolder-Дача-p1-2026-01-01.zip"), ArchiveNames.toDelete(names, prefix, 2));
        assertTrue(ArchiveNames.toDelete(names, prefix, 3).isEmpty());
        assertEquals(3, ArchiveNames.toDelete(names, prefix, 0).size());
    }

    @Test
    public void dueOnlyAfterThePeriodAndAChange() {
        long now = 100 * ArchiveNames.DAY;
        assertTrue(ArchiveNames.due(true, now, now, 7, "a", "a"));
        assertFalse(ArchiveNames.due(false, now, now - 2 * ArchiveNames.DAY, 7, "a", "b"));
        assertFalse(ArchiveNames.due(false, now, now - 8 * ArchiveNames.DAY, 7, "a", "a"));
        assertTrue(ArchiveNames.due(false, now, now - 7 * ArchiveNames.DAY + ArchiveNames.SLACK, 7, "a", "b"));
        assertTrue(ArchiveNames.due(false, now, 0, 1, "a", ""));
    }

    @Test
    public void signatureChangesWithFilesAndOptions() {
        List<String[]> a = Collections.singletonList(new String[]{"gas_levels.csv", "10", "1"});
        List<String[]> b = Collections.singletonList(new String[]{"gas_levels.csv", "11", "1"});
        assertEquals(ArchiveNames.signature("Дом", true, a), ArchiveNames.signature("Дом", true, a));
        assertNotEquals(ArchiveNames.signature("Дом", true, a), ArchiveNames.signature("Дом", true, b));
        assertNotEquals(ArchiveNames.signature("Дом", true, a), ArchiveNames.signature("Дом", false, a));
        assertNotEquals(ArchiveNames.signature("Дом", true, a), ArchiveNames.signature("Дача", true, a));
    }

    @Test
    public void helpers() {
        assertTrue(ArchiveNames.validId("default"));
        assertTrue(ArchiveNames.validId("p20261104120000"));
        assertFalse(ArchiveNames.validId("../x"));
        assertFalse(ArchiveNames.validId(null));
        assertTrue(ArchiveNames.isPhoto("IMG_1.JPG"));
        assertTrue(ArchiveNames.isPhoto("plate.png"));
        assertFalse(ArchiveNames.isPhoto(".hidden.jpg"));
        assertFalse(ArchiveNames.isPhoto("x.jpg.tmp"));
        assertEquals(1, ArchiveNames.clamp(-5, 1, 100));
        assertEquals(100, ArchiveNames.clamp(500, 1, 100));
        assertEquals(7, ArchiveNames.clamp(7, 1, 100));
    }
}
