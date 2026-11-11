package io.rav.gazgolder;

import android.Manifest;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Path;
import android.graphics.Typeface;
import android.os.Bundle;
import android.util.TypedValue;
import android.view.Gravity;
import android.view.View;
import android.view.WindowManager;
import android.widget.Button;
import android.widget.FrameLayout;
import android.widget.LinearLayout;
import android.widget.TextView;
import android.widget.Toast;

import androidx.activity.result.ActivityResultLauncher;
import androidx.activity.result.contract.ActivityResultContracts;
import androidx.appcompat.app.AppCompatActivity;
import androidx.camera.core.Camera;
import androidx.camera.core.CameraSelector;
import androidx.camera.core.ImageCapture;
import androidx.camera.core.ImageCaptureException;
import androidx.camera.core.Preview;
import androidx.camera.lifecycle.ProcessCameraProvider;
import androidx.camera.view.PreviewView;
import androidx.core.content.ContextCompat;
import androidx.exifinterface.media.ExifInterface;

import com.google.common.util.concurrent.ListenableFuture;

import java.io.File;
import java.text.SimpleDateFormat;
import java.util.Date;
import java.util.Locale;

public class GasCameraActivity extends AppCompatActivity {
    static final String EXTRA_HINT = "hint";
    static final String EXTRA_PATH = "path";

    private PreviewView preview;
    private ImageCapture capture;
    private Camera camera;
    private boolean torch;
    private Button shoot;
    private final ActivityResultLauncher<String> permission = registerForActivityResult(new ActivityResultContracts.RequestPermission(), granted -> {
        if (granted) start();
        else {
            setResult(RESULT_CANCELED, new Intent().putExtra("error", "NO_PERMISSION"));
            finish();
        }
    });

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        FrameLayout root = new FrameLayout(this);
        root.setBackgroundColor(Color.BLACK);
        preview = new PreviewView(this);
        preview.setScaleType(PreviewView.ScaleType.FILL_CENTER);
        root.addView(preview, new FrameLayout.LayoutParams(-1, -1));
        String hint = getIntent().getStringExtra(EXTRA_HINT);
        if (hint == null || hint.isEmpty()) hint = getString(R.string.camera_hint);
        root.addView(new GuideView(this, hint), new FrameLayout.LayoutParams(-1, -1));

        LinearLayout bar = new LinearLayout(this);
        bar.setOrientation(LinearLayout.HORIZONTAL);
        bar.setGravity(Gravity.CENTER);
        int pad = dp(16);
        bar.setPadding(pad, pad, pad, dp(32));
        Button cancel = button("✕");
        cancel.setOnClickListener(v -> {
            setResult(RESULT_CANCELED);
            finish();
        });
        shoot = button("●");
        shoot.setTextSize(TypedValue.COMPLEX_UNIT_SP, 40);
        shoot.setOnClickListener(v -> takePicture());
        Button flash = button("⚡");
        flash.setOnClickListener(v -> {
            torch = !torch;
            if (camera != null && camera.getCameraInfo().hasFlashUnit()) camera.getCameraControl().enableTorch(torch);
            flash.setAlpha(torch ? 1f : 0.6f);
        });
        flash.setAlpha(0.6f);
        bar.addView(cancel, new LinearLayout.LayoutParams(dp(72), dp(72)));
        LinearLayout.LayoutParams mid = new LinearLayout.LayoutParams(dp(96), dp(96));
        mid.setMargins(dp(32), 0, dp(32), 0);
        bar.addView(shoot, mid);
        bar.addView(flash, new LinearLayout.LayoutParams(dp(72), dp(72)));
        root.addView(bar, new FrameLayout.LayoutParams(-1, -2, Gravity.BOTTOM));
        setContentView(root);

        if (ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) start();
        else permission.launch(Manifest.permission.CAMERA);
    }

    private Button button(String text) {
        Button b = new Button(this);
        b.setText(text);
        b.setTextColor(Color.WHITE);
        b.setTextSize(TypedValue.COMPLEX_UNIT_SP, 24);
        b.setBackgroundColor(Color.TRANSPARENT);
        return b;
    }

    private int dp(int v) {
        return Math.round(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, v, getResources().getDisplayMetrics()));
    }

    private void start() {
        ListenableFuture<ProcessCameraProvider> future = ProcessCameraProvider.getInstance(this);
        future.addListener(() -> {
            try {
                ProcessCameraProvider provider = future.get();
                Preview p = new Preview.Builder().build();
                p.setSurfaceProvider(preview.getSurfaceProvider());
                capture = new ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MAXIMIZE_QUALITY).build();
                provider.unbindAll();
                camera = provider.bindToLifecycle(this, CameraSelector.DEFAULT_BACK_CAMERA, p, capture);
            } catch (Exception e) {
                setResult(RESULT_CANCELED, new Intent().putExtra("error", "NO_CAMERA"));
                finish();
            }
        }, ContextCompat.getMainExecutor(this));
    }

    private void takePicture() {
        if (capture == null) return;
        shoot.setEnabled(false);
        File dir = new File(getCacheDir(), "camera");
        File[] old = dir.listFiles();
        if (old != null) for (File f : old) f.delete();
        dir.mkdirs();
        Date now = new Date();
        File out = new File(dir, "IMG_" + new SimpleDateFormat("yyyyMMdd_HHmmss", Locale.ROOT).format(now) + ".jpg");
        capture.takePicture(new ImageCapture.OutputFileOptions.Builder(out).build(), ContextCompat.getMainExecutor(this), new ImageCapture.OnImageSavedCallback() {
            @Override
            public void onImageSaved(ImageCapture.OutputFileResults results) {
                stamp(out, now);
                setResult(RESULT_OK, new Intent().putExtra(EXTRA_PATH, out.getAbsolutePath()));
                finish();
            }

            @Override
            public void onError(ImageCaptureException e) {
                shoot.setEnabled(true);
                Toast.makeText(GasCameraActivity.this, e.getMessage(), Toast.LENGTH_LONG).show();
            }
        });
    }

    private static void stamp(File f, Date when) {
        try {
            ExifInterface exif = new ExifInterface(f.getAbsolutePath());
            if (exif.getAttribute(ExifInterface.TAG_DATETIME_ORIGINAL) == null) {
                String s = new SimpleDateFormat("yyyy:MM:dd HH:mm:ss", Locale.ROOT).format(when);
                exif.setAttribute(ExifInterface.TAG_DATETIME_ORIGINAL, s);
                exif.setAttribute(ExifInterface.TAG_DATETIME, s);
                exif.saveAttributes();
            }
        } catch (Exception ignored) {
        }
    }

    static final class GuideView extends View {
        private final Paint shade = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint ring = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final Paint text = new Paint(Paint.ANTI_ALIAS_FLAG);
        private final String hint;
        private final Path path = new Path();

        GuideView(Context ctx, String hint) {
            super(ctx);
            this.hint = hint;
            shade.setColor(0x88000000);
            ring.setColor(Color.WHITE);
            ring.setStyle(Paint.Style.STROKE);
            ring.setStrokeWidth(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, 2, ctx.getResources().getDisplayMetrics()));
            text.setColor(Color.WHITE);
            text.setTextAlign(Paint.Align.CENTER);
            text.setTypeface(Typeface.DEFAULT_BOLD);
            text.setTextSize(TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_SP, 16, ctx.getResources().getDisplayMetrics()));
        }

        @Override
        protected void onDraw(Canvas c) {
            float w = getWidth(), h = getHeight(), r = Math.min(w, h) * 0.4f, cx = w / 2f, cy = h * 0.45f;
            path.reset();
            path.setFillType(Path.FillType.EVEN_ODD);
            path.addRect(0, 0, w, h, Path.Direction.CW);
            path.addCircle(cx, cy, r, Path.Direction.CW);
            c.drawPath(path, shade);
            c.drawCircle(cx, cy, r, ring);
            if (!hint.isEmpty()) c.drawText(hint, cx, cy - r - text.getTextSize(), text);
        }
    }
}
