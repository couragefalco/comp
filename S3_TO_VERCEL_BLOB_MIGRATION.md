# S3 to Vercel Blob Migration Plan

## Executive Summary

Migration of AWS S3 storage to Vercel Blob across 3 applications (app, api, portal) affecting **40 files**. This plan provides a phased approach with risk mitigation strategies.

**Estimated Effort:** 12-16 hours
**Risk Level:** Medium-High
**Recommendation:** Keep Fleet Agent storage on S3, migrate everything else

---

## Current Architecture

### Buckets → Vercel Blob Path Prefixes

| AWS Bucket | Purpose | Vercel Blob Prefix | Migrate? |
|------------|---------|-------------------|----------|
| `APP_AWS_BUCKET_NAME` | Task attachments, policies | `attachments/` | YES |
| `APP_AWS_QUESTIONNAIRE_UPLOAD_BUCKET` | Questionnaire uploads | `questionnaires/` | YES |
| `APP_AWS_KNOWLEDGE_BASE_BUCKET` | Knowledge base docs | `knowledge-base/` | YES |
| `APP_AWS_ORG_ASSETS_BUCKET` | Logos, favicons, certs | `org-assets/` | YES |
| `FLEET_AGENT_BUCKET_NAME` | Device agent binaries | N/A | **NO - Keep S3** |

### Environment Variables

**Before (S3):**
```env
APP_AWS_BUCKET_NAME=
APP_AWS_QUESTIONNAIRE_UPLOAD_BUCKET=
APP_AWS_KNOWLEDGE_BASE_BUCKET=
APP_AWS_ORG_ASSETS_BUCKET=
APP_AWS_REGION=
APP_AWS_ACCESS_KEY_ID=
APP_AWS_SECRET_ACCESS_KEY=
APP_AWS_ENDPOINT=
FLEET_AGENT_BUCKET_NAME=  # Keep for S3
```

**After (Vercel Blob + S3 for Fleet):**
```env
BLOB_READ_WRITE_TOKEN=vercel_blob_rw_...
# Keep for Fleet Agent only:
FLEET_AWS_BUCKET_NAME=
FLEET_AWS_REGION=
FLEET_AWS_ACCESS_KEY_ID=
FLEET_AWS_SECRET_ACCESS_KEY=
```

---

## Migration Phases

### Phase 1: Storage Abstraction Layer (2-3 hours)

Create a unified storage interface that can use either S3 or Vercel Blob.

**Files to create:**
```
packages/storage/
├── package.json
├── src/
│   ├── index.ts           # Exports
│   ├── types.ts           # StorageProvider interface
│   ├── blob-provider.ts   # Vercel Blob implementation
│   ├── s3-provider.ts     # S3 implementation (for Fleet)
│   └── utils.ts           # Path utilities
```

**Interface Design:**
```typescript
interface StorageProvider {
  upload(path: string, data: Buffer | Blob, options?: UploadOptions): Promise<UploadResult>;
  download(path: string): Promise<Buffer>;
  getUrl(path: string, options?: UrlOptions): Promise<string>;
  delete(path: string): Promise<void>;
  copy(sourcePath: string, destPath: string): Promise<void>;
  exists(path: string): Promise<boolean>;
}

interface UploadOptions {
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  metadata?: Record<string, string>;
}

interface UrlOptions {
  expiresIn?: number;  // seconds
  download?: boolean;  // force download vs inline
  filename?: string;   // custom download filename
}
```

---

### Phase 2: Core Client Migration (2 hours)

Replace S3 clients with storage abstraction.

**Files to modify:**

| File | Changes |
|------|---------|
| `apps/app/src/app/s3.ts` | Replace with storage provider import |
| `apps/api/src/app/s3.ts` | Replace with storage provider import |
| `apps/portal/src/utils/s3.ts` | Replace with storage provider import |

**Before:**
```typescript
import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
const s3Client = new S3Client({...});
```

**After:**
```typescript
import { storage } from '@comp/storage';
// storage is pre-configured Vercel Blob provider
```

---

### Phase 3: Low-Risk Migrations (2-3 hours)

Simple upload/download operations with no streaming.

#### 3.1 Organization Assets
- `apps/app/src/actions/organization/update-organization-logo-action.ts`
- `apps/app/src/app/(app)/[orgId]/trust/portal-settings/actions/update-trust-favicon.ts`
- `apps/app/src/app/api/get-image-url/route.ts`

#### 3.2 Basic Attachments
- `apps/app/src/actions/files/upload-file.ts`
- `apps/app/src/app/(app)/[orgId]/tasks/actions/deleteTaskAttachment.ts`
- `apps/app/src/app/(app)/[orgId]/tasks/actions/getTaskAttachmentUrl.ts`

#### 3.3 Policy URLs
- `apps/app/src/app/(app)/[orgId]/policies/[policyId]/actions/get-policy-pdf-url.ts`
- `apps/app/src/app/(app)/[orgId]/policies/[policyId]/actions/delete-policy-pdf.ts`
- `apps/portal/src/app/(app)/(home)/actions/getPolicyPdfUrl.ts`

**Pattern transformation:**
```typescript
// Before (S3)
await s3Client.send(new PutObjectCommand({
  Bucket: BUCKET_NAME,
  Key: `org/${orgId}/logo.png`,
  Body: buffer,
  ContentType: 'image/png',
}));
const url = await getSignedUrl(s3Client, new GetObjectCommand({...}), { expiresIn: 3600 });

// After (Vercel Blob)
const { url } = await storage.upload(`org-assets/${orgId}/logo.png`, buffer, {
  contentType: 'image/png',
});
// Vercel Blob URLs are public by default, or use:
const signedUrl = await storage.getUrl(`org-assets/${orgId}/logo.png`, { expiresIn: 3600 });
```

---

### Phase 4: Medium-Risk Migrations (3-4 hours)

Attachment services and knowledge base with more complex patterns.

#### 4.1 Attachment Services
- `apps/api/src/attachments/attachments.service.ts`
- `apps/api/src/tasks/attachments.service.ts`

**Special handling needed:**
- `getObjectBuffer()` - Vercel Blob returns Buffer directly
- `copyPolicyVersionPdf()` - Implement as download + upload

#### 4.2 Knowledge Base
- `apps/api/src/knowledge-base/utils/s3-operations.ts`
- `apps/api/src/vector-store/lib/sync/sync-utils.ts`
- `apps/api/src/trigger/vector-store/process-knowledge-base-document.ts`

#### 4.3 Questionnaire Storage
- `apps/api/src/questionnaire/utils/questionnaire-storage.ts`
- `apps/api/src/trigger/questionnaire/parse-questionnaire.ts`

#### 4.4 Trust Portal Uploads
- `apps/api/src/trust-portal/trust-portal.service.ts`

#### 4.5 Portal Fleet Policy
- `apps/portal/src/app/api/confirm-fleet-policy/route.ts`

**Bulk delete transformation:**
```typescript
// Before (S3)
await s3Client.send(new DeleteObjectsCommand({
  Bucket: BUCKET_NAME,
  Delete: { Objects: keys.map(Key => ({ Key })) }
}));

// After (Vercel Blob)
await Promise.all(keys.map(key => storage.delete(key)));
```

---

### Phase 5: High-Risk Migrations (3-4 hours)

Complex streaming and copy operations.

#### 5.1 Policy Copy Operations
- `apps/app/src/actions/policies/create-version.ts`

**Copy transformation:**
```typescript
// Before (S3 native copy)
await s3Client.send(new CopyObjectCommand({
  Bucket: BUCKET_NAME,
  CopySource: `${BUCKET_NAME}/${sourceKey}`,
  Key: destKey,
}));

// After (Vercel Blob - download + upload)
const data = await storage.download(sourceKey);
await storage.upload(destKey, data);
```

#### 5.2 Trust Document Streaming (COMPLEX)
- `apps/api/src/trust-portal/trust-access.service.ts`

**Current behavior:**
- Creates ZIP files with `archiver` streaming to S3
- Merges PDFs with `pdf-lib` and streams result
- Watermarking pipeline

**Migration strategy:**
- Buffer entire ZIP in memory before upload
- Max expected size: ~50-100MB (within Vercel Blob limit)
- Add memory monitoring

```typescript
// Before: Stream directly to S3
const archive = archiver('zip');
const passThrough = new PassThrough();
archive.pipe(passThrough);
await s3Client.send(new PutObjectCommand({ Body: passThrough, ... }));

// After: Buffer then upload
const chunks: Buffer[] = [];
archive.on('data', chunk => chunks.push(chunk));
await new Promise(resolve => archive.on('end', resolve));
const buffer = Buffer.concat(chunks);
await storage.upload(path, buffer);
```

#### 5.3 Browser Automation
- `apps/api/src/browserbase/browserbase.service.ts`

---

### Phase 6: Fleet Agent (DO NOT MIGRATE)

Keep these files using S3:
- `apps/api/src/device-agent/device-agent.service.ts`
- `apps/portal/src/app/api/download-agent/route.ts`
- `apps/app/src/app/s3.ts` (only `getFleetAgent()` function)

**Reason:** Large binary files (50-100MB+) with streaming requirements.

**Changes needed:**
- Extract fleet-specific S3 code to separate module
- Rename env vars to `FLEET_AWS_*`
- Keep minimal S3 client just for fleet downloads

---

## File Change Summary

### Files to Modify (37 files)

| App | File Count | Complexity |
|-----|------------|------------|
| apps/app | 15 | Low-Medium |
| apps/api | 17 | Medium-High |
| apps/portal | 5 | Low-Medium |

### Detailed File List

#### apps/app (15 files)
```
src/app/s3.ts                                                    [HIGH - core client]
src/actions/files/upload-file.ts                                 [LOW]
src/actions/organization/update-organization-logo-action.ts      [LOW]
src/actions/policies/create-version.ts                           [HIGH - copy op]
src/actions/policies/delete-policy.ts                            [MEDIUM]
src/actions/policies/delete-version.ts                           [LOW]
src/app/(app)/[orgId]/policies/[policyId]/actions/upload-policy-pdf.ts    [MEDIUM]
src/app/(app)/[orgId]/policies/[policyId]/actions/delete-policy-pdf.ts    [LOW]
src/app/(app)/[orgId]/policies/[policyId]/actions/get-policy-pdf-url.ts   [LOW]
src/app/(app)/[orgId]/tasks/actions/deleteTaskAttachment.ts      [LOW]
src/app/(app)/[orgId]/tasks/actions/getTaskAttachmentUrl.ts      [LOW]
src/app/(app)/[orgId]/trust/portal-settings/actions/update-trust-favicon.ts [LOW]
src/app/api/get-image-url/route.ts                               [LOW]
src/trigger/tasks/onboarding/update-policies-helpers.ts          [MEDIUM]
src/env.mjs                                                      [LOW - env validation]
```

#### apps/api (17 files)
```
src/app/s3.ts                                                    [HIGH - core client]
src/attachments/attachments.service.ts                           [HIGH]
src/tasks/attachments.service.ts                                 [MEDIUM]
src/trust-portal/trust-portal.service.ts                         [MEDIUM]
src/trust-portal/trust-access.service.ts                         [VERY HIGH - streaming]
src/knowledge-base/utils/s3-operations.ts                        [MEDIUM]
src/vector-store/lib/sync/sync-utils.ts                          [MEDIUM]
src/trigger/vector-store/process-knowledge-base-document.ts      [MEDIUM]
src/questionnaire/utils/questionnaire-storage.ts                 [LOW]
src/trigger/questionnaire/parse-questionnaire.ts                 [MEDIUM]
src/browserbase/browserbase.service.ts                           [MEDIUM]
src/device-agent/device-agent.service.ts                         [KEEP S3]
src/config/aws.config.ts                                         [MEDIUM]
```

#### apps/portal (5 files)
```
src/utils/s3.ts                                                  [HIGH - core client]
src/app/api/confirm-fleet-policy/route.ts                        [MEDIUM]
src/app/api/download-agent/route.ts                              [KEEP S3]
src/app/(app)/(home)/actions/getPolicyPdfUrl.ts                  [LOW]
src/app/api/fleet-policies/route.ts                              [CHECK]
```

---

## Risk Mitigation

### Rollback Strategy

1. **Feature flag approach:**
```typescript
const USE_VERCEL_BLOB = process.env.USE_VERCEL_BLOB === 'true';

export const storage = USE_VERCEL_BLOB
  ? new VercelBlobProvider()
  : new S3Provider();
```

2. **Keep S3 credentials in env** until migration is proven stable

3. **Database URLs unchanged** - existing file URLs in database continue working since we're not migrating existing files

### Testing Checklist

- [ ] Upload file <1MB
- [ ] Upload file ~50MB
- [ ] Download file with custom filename
- [ ] Delete single file
- [ ] Delete multiple files (bulk)
- [ ] Generate signed URL with expiry
- [ ] Copy file (policy versioning)
- [ ] ZIP bundle generation
- [ ] PDF merge + watermark
- [ ] Logo/favicon upload and display
- [ ] Task attachment upload/download
- [ ] Knowledge base document processing

### Monitoring

Add logging for:
- Upload duration and size
- Failed operations
- URL generation

---

## Dependencies to Add

```json
// apps/app/package.json
{
  "@vercel/blob": "^0.27.0"
}

// apps/api/package.json
{
  "@vercel/blob": "^0.27.0"
}

// apps/portal/package.json
{
  "@vercel/blob": "^0.27.0"
}
```

---

## Implementation Order

```
1. [ ] Create packages/storage abstraction layer
2. [ ] Add @vercel/blob to all apps
3. [ ] Implement VercelBlobProvider
4. [ ] Implement S3Provider (for Fleet)
5. [ ] Add feature flag (USE_VERCEL_BLOB)
6. [ ] Migrate apps/app/src/app/s3.ts
7. [ ] Migrate apps/api/src/app/s3.ts
8. [ ] Migrate apps/portal/src/utils/s3.ts
9. [ ] Migrate low-risk files (Phase 3)
10. [ ] Migrate medium-risk files (Phase 4)
11. [ ] Migrate high-risk files (Phase 5)
12. [ ] Extract Fleet-only S3 code
13. [ ] Test all operations
14. [ ] Remove S3 dependencies (except Fleet)
15. [ ] Update documentation
```

---

## Questions Before Proceeding

1. **Existing files migration?**
   - Option A: Keep existing S3 files, only new uploads go to Blob
   - Option B: Migrate all existing files (adds complexity)

2. **Fleet agents decision confirmed?**
   - Keeping on S3 as recommended?

3. **Staging environment?**
   - Test on staging before production?

---

## Approval Checklist

- [ ] Plan reviewed
- [ ] Fleet agent decision confirmed
- [ ] Existing files strategy decided
- [ ] Ready to proceed

**Say "go" to begin implementation.**
