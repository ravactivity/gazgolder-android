package io.rav.gazgolder;

import android.content.Context;

import androidx.annotation.NonNull;
import androidx.work.Constraints;
import androidx.work.ExistingPeriodicWorkPolicy;
import androidx.work.PeriodicWorkRequest;
import androidx.work.WorkManager;
import androidx.work.Worker;
import androidx.work.WorkerParameters;

import java.util.concurrent.TimeUnit;

public class ArchiveWorker extends Worker {
    static final String NAME = "gas-archive";

    public ArchiveWorker(@NonNull Context ctx, @NonNull WorkerParameters params) {
        super(ctx, params);
    }

    @NonNull
    @Override
    public Result doWork() {
        try {
            ArchiveJob.run(getApplicationContext(), false);
            return Result.success();
        } catch (SecurityException e) {
            return Result.success();
        } catch (Exception e) {
            return getRunAttemptCount() < 3 ? Result.retry() : Result.success();
        }
    }

    static void schedule(Context ctx) {
        WorkManager wm = WorkManager.getInstance(ctx);
        if (!ArchiveJob.config(ctx).optBoolean("on", false)) {
            wm.cancelUniqueWork(NAME);
            return;
        }
        Constraints c = new Constraints.Builder().setRequiresBatteryNotLow(true).setRequiresStorageNotLow(true).build();
        PeriodicWorkRequest req = new PeriodicWorkRequest.Builder(ArchiveWorker.class, 12, TimeUnit.HOURS).setConstraints(c).build();
        wm.enqueueUniquePeriodicWork(NAME, ExistingPeriodicWorkPolicy.UPDATE, req);
    }
}
