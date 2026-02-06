import { Injectable, NotFoundException, Logger } from '@nestjs/common';
import { Readable } from 'stream';
import { storage, STORAGE_BUCKETS } from '../app/storage';

@Injectable()
export class DeviceAgentService {
  private readonly logger = new Logger(DeviceAgentService.name);

  constructor() {
    // Storage is now handled by the storage abstraction
  }

  async downloadMacAgent(): Promise<{
    stream: Readable;
    filename: string;
    contentType: string;
  }> {
    try {
      const macosPackageFilename = 'Comp AI Agent-1.0.0-arm64.dmg';
      const packageKey = `macos/${macosPackageFilename}`;
      const pathname = `${STORAGE_BUCKETS.FLEET_AGENTS}/${packageKey}`;

      this.logger.log(`Downloading macOS agent from storage: ${packageKey}`);

      const readableStream = await storage.downloadStream(pathname);

      // Convert Web ReadableStream to Node.js Readable
      const nodeStream = Readable.fromWeb(readableStream as any);

      this.logger.log(
        `Successfully retrieved macOS agent: ${macosPackageFilename}`,
      );

      return {
        stream: nodeStream,
        filename: macosPackageFilename,
        contentType: 'application/x-apple-diskimage',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to download macOS agent from storage:', error);
      throw new NotFoundException('macOS agent DMG file not found');
    }
  }

  async downloadWindowsAgent(): Promise<{
    stream: Readable;
    filename: string;
    contentType: string;
  }> {
    try {
      const windowsPackageFilename = 'Comp AI Agent 1.0.0.exe';
      const packageKey = `windows/${windowsPackageFilename}`;
      const pathname = `${STORAGE_BUCKETS.FLEET_AGENTS}/${packageKey}`;

      this.logger.log(`Downloading Windows agent from storage: ${packageKey}`);

      const readableStream = await storage.downloadStream(pathname);

      // Convert Web ReadableStream to Node.js Readable
      const nodeStream = Readable.fromWeb(readableStream as any);

      this.logger.log(
        `Successfully retrieved Windows agent: ${windowsPackageFilename}`,
      );

      return {
        stream: nodeStream,
        filename: windowsPackageFilename,
        contentType: 'application/octet-stream',
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      this.logger.error('Failed to download Windows agent from storage:', error);
      throw new NotFoundException('Windows agent executable file not found');
    }
  }
}
