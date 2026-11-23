-- Per-major catalog extraction state, for the background catalog worker.
-- Additive only: three new columns, no data removed.

-- AlterTable
ALTER TABLE "Major" ADD COLUMN     "catalogError" TEXT,
ADD COLUMN     "catalogProcessedAt" TIMESTAMP(3),
ADD COLUMN     "catalogStatus" "ProcessingStatus" NOT NULL DEFAULT 'PENDING';

-- Backfill: v1 extracted every existing major during the request, so none is pending.
-- A major with courses finished; one without any found nothing.
UPDATE "Major" m
SET "catalogStatus" = 'COMPLETED', "catalogProcessedAt" = m."updatedAt"
WHERE EXISTS (SELECT 1 FROM "Course" c WHERE c."majorId" = m."id");

UPDATE "Major" m
SET "catalogStatus" = 'FAILED',
    "catalogError" = 'No course information was found for this major',
    "catalogProcessedAt" = m."updatedAt"
WHERE NOT EXISTS (SELECT 1 FROM "Course" c WHERE c."majorId" = m."id");
