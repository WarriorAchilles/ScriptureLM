-- Step 09: store failure detail on jobs for operator visibility.
ALTER TABLE "jobs" ADD COLUMN "last_error" TEXT;
