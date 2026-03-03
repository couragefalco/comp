-- RenameColumn
ALTER TABLE "IntegrationPlatformCredential" RENAME COLUMN "createdById" TO "createdByUserId";
ALTER TABLE "IntegrationPlatformCredential" RENAME COLUMN "updatedById" TO "updatedByUserId";
