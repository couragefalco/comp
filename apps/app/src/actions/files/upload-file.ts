'use server';

console.log('[uploadFile] Upload action module is being loaded...');

console.log('[uploadFile] Importing auth and logger...');
import { storage, STORAGE_BUCKETS } from '@/app/storage';
import { auth } from '@/utils/auth';
import { logger } from '@/utils/logger';
import { AttachmentEntityType, AttachmentType, db } from '@db';
import { revalidatePath } from 'next/cache';
import { headers } from 'next/headers';
import { z } from 'zod';

console.log('[uploadFile] Importing storage client...');

console.log('[uploadFile] Importing database...');

console.log('[uploadFile] All imports successful');

// This log will run as soon as the module is loaded.
logger.info('[uploadFile] Module loaded.');

function mapFileTypeToAttachmentType(fileType: string): AttachmentType {
  const type = fileType.split('/')[0];
  switch (type) {
    case 'image':
      return AttachmentType.image;
    case 'video':
      return AttachmentType.video;
    case 'audio':
      return AttachmentType.audio;
    case 'application':
      return AttachmentType.document;
    default:
      return AttachmentType.other;
  }
}

const uploadAttachmentSchema = z.object({
  fileName: z.string(),
  fileType: z.string(),
  fileData: z.string(),
  entityId: z.string(),
  entityType: z.nativeEnum(AttachmentEntityType),
  pathToRevalidate: z.string().optional(),
});

export const uploadFile = async (input: z.infer<typeof uploadAttachmentSchema>) => {
  console.log('[uploadFile] Function called - starting execution');
  logger.info(`[uploadFile] Starting upload for ${input.fileName}`);

  console.log('[uploadFile] Checking storage availability');
  try {
    console.log('[uploadFile] Parsing input schema');
    const { fileName, fileType, fileData, entityId, entityType, pathToRevalidate } =
      uploadAttachmentSchema.parse(input);

    console.log('[uploadFile] Getting user session');
    const session = await auth.api.getSession({ headers: await headers() });
    const organizationId = session?.session.activeOrganizationId;

    if (!organizationId) {
      logger.error('[uploadFile] Not authorized - no organization found');
      return {
        success: false,
        error: 'Not authorized - no organization found',
      } as const;
    }

    logger.info(`[uploadFile] Starting upload for ${fileName} in org ${organizationId}`);

    console.log('[uploadFile] Converting file data to buffer');
    const fileBuffer = Buffer.from(fileData, 'base64');

    const MAX_FILE_SIZE_MB = 100;
    const MAX_FILE_SIZE_BYTES = MAX_FILE_SIZE_MB * 1024 * 1024;
    if (fileBuffer.length > MAX_FILE_SIZE_BYTES) {
      logger.warn(
        `[uploadFile] File size ${fileBuffer.length} exceeds the ${MAX_FILE_SIZE_MB}MB limit.`,
      );
      return {
        success: false,
        error: `File exceeds the ${MAX_FILE_SIZE_MB}MB limit.`,
      } as const;
    }

    const timestamp = Date.now();
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, '_');
    const pathname = `${STORAGE_BUCKETS.ATTACHMENTS}/${organizationId}/attachments/${entityType}/${entityId}/${timestamp}-${sanitizedFileName}`;

    logger.info(`[uploadFile] Uploading to storage with pathname: ${pathname}`);
    await storage.upload(pathname, fileBuffer, {
      contentType: fileType,
    });
    logger.info(`[uploadFile] Storage upload successful for pathname: ${pathname}`);

    logger.info(`[uploadFile] Creating attachment record in DB for pathname: ${pathname}`);
    const attachment = await db.attachment.create({
      data: {
        name: fileName,
        url: pathname,
        type: mapFileTypeToAttachmentType(fileType),
        entityId: entityId,
        entityType: entityType,
        organizationId: organizationId,
      },
    });
    logger.info(`[uploadFile] DB record created with id: ${attachment.id}`);

    logger.info(`[uploadFile] Generating URL for pathname: ${pathname}`);
    const signedUrl = await storage.getUrl(pathname, {
      expiresIn: 900,
    });
    logger.info(`[uploadFile] URL generated for pathname: ${pathname}`);

    if (pathToRevalidate) {
      revalidatePath(pathToRevalidate);
    }

    return {
      success: true,
      data: {
        ...attachment,
        signedUrl,
      },
    } as const;
  } catch (error) {
    logger.error(`[uploadFile] Error during upload process:`, error);
    return {
      success: false,
      error: error instanceof Error ? error.message : 'An unknown error occurred.',
    } as const;
  }
};
