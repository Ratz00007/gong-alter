-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Call" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "title" TEXT NOT NULL,
    "dealId" TEXT,
    "contactId" TEXT,
    "occurredAt" DATETIME NOT NULL,
    "durationSec" INTEGER,
    "source" TEXT NOT NULL DEFAULT 'UPLOAD',
    "status" TEXT NOT NULL DEFAULT 'UPLOADED',
    "audioSha256" TEXT,
    "mediaAssetId" TEXT,
    "normalizedAssetId" TEXT,
    "language" TEXT,
    "errorMessage" TEXT,
    "failedStage" TEXT,
    "retryCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Call_dealId_fkey" FOREIGN KEY ("dealId") REFERENCES "Deal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Call_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Call_mediaAssetId_fkey" FOREIGN KEY ("mediaAssetId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Call_normalizedAssetId_fkey" FOREIGN KEY ("normalizedAssetId") REFERENCES "MediaAsset" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);
INSERT INTO "new_Call" ("audioSha256", "contactId", "createdAt", "dealId", "durationSec", "errorMessage", "failedStage", "id", "language", "mediaAssetId", "occurredAt", "retryCount", "source", "status", "title", "updatedAt") SELECT "audioSha256", "contactId", "createdAt", "dealId", "durationSec", "errorMessage", "failedStage", "id", "language", "mediaAssetId", "occurredAt", "retryCount", "source", "status", "title", "updatedAt" FROM "Call";
DROP TABLE "Call";
ALTER TABLE "new_Call" RENAME TO "Call";
CREATE INDEX "Call_status_createdAt_idx" ON "Call"("status", "createdAt");
CREATE INDEX "Call_dealId_occurredAt_idx" ON "Call"("dealId", "occurredAt");
CREATE INDEX "Call_audioSha256_idx" ON "Call"("audioSha256");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
