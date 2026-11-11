package io.rav.gazgolder;

import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertFalse;
import static org.junit.Assert.assertTrue;

import org.junit.Test;

public class SharedNamesTest {
    @Test
    public void onlyImagesAreAccepted() {
        assertTrue(SharedNames.isImageType("image/*"));
        assertTrue(SharedNames.isImageType("IMAGE/JPEG"));
        assertTrue(SharedNames.isImageType(null));
        assertTrue(SharedNames.isImageType(""));
        assertFalse(SharedNames.isImageType("video/mp4"));
        assertFalse(SharedNames.isImageType("text/plain"));
    }

    @Test
    public void jpegAndPngAreCopiedOtherImagesConverted() {
        assertEquals("jpg", SharedNames.kind("image/jpeg", "a.webp"));
        assertEquals("jpg", SharedNames.kind("image/pjpeg", null));
        assertEquals("png", SharedNames.kind("image/png", "a"));
        assertEquals("convert", SharedNames.kind("image/webp", "a.jpg"));
        assertEquals("convert", SharedNames.kind("image/heic", "a.heic"));
        assertEquals("jpg", SharedNames.kind(null, "IMG-20261108-WA0003.JPEG"));
        assertEquals("png", SharedNames.kind("application/octet-stream", "shot.png"));
        assertEquals("convert", SharedNames.kind(null, "noext"));
    }

    @Test
    public void namesKeepTheDateAndAreSafe() {
        assertEquals("IMG-20261108-WA0003.jpg", SharedNames.clean("IMG-20261108-WA0003.jpg", "jpg", 1));
        assertEquals("photo_2026-11-08_18-21-03.jpeg", SharedNames.clean("photo_2026-11-08_18-21-03.jpeg", "jpg", 1));
        assertEquals("снимок (1).png", SharedNames.clean("снимок (1).png", "png", 1));
        assertEquals("PXL_20261108.jpg", SharedNames.clean("PXL_20261108.heic", "convert", 1));
        assertEquals("evil.jpg", SharedNames.clean("../../files/evil.jpg", "jpg", 1));
        assertEquals("a_b_c.jpg", SharedNames.clean("a:b*c.jpg", "jpg", 1));
        assertEquals("shared_3.jpg", SharedNames.clean("", "jpg", 3));
        assertEquals("shared_4.png", SharedNames.clean(null, "png", 4));
        assertEquals("shared_5.jpg", SharedNames.clean("...", "jpg", 5));
        assertEquals(104, SharedNames.clean("x".repeat(150) + ".jpg", "jpg", 1).length());
    }

    @Test
    public void duplicatesGetASuffixAndBigImagesAreSampled() {
        assertEquals("a.jpg", SharedNames.unique("a.jpg", 1));
        assertEquals("a_2.jpg", SharedNames.unique("a.jpg", 2));
        assertEquals("a_3", SharedNames.unique("a", 3));
        assertEquals(1, SharedNames.sampleSize(4000, 3000, 4000));
        assertEquals(1, SharedNames.sampleSize(7999, 100, 4000));
        assertEquals(2, SharedNames.sampleSize(8000, 6000, 4000));
        assertEquals(4, SharedNames.sampleSize(12000, 16000, 4000));
    }
}
