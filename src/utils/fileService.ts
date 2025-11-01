import fs from "fs";
import path from "path";
import { uploadsDir } from "../config/storage.config";

export class FileService {
  private static isUrl(maybeUrl: string): boolean {
    return /^https?:\/\//i.test(maybeUrl);
  }

  private static normalizeToDiskPath(input: string): string | undefined {
    if (!input || typeof input !== "string") return undefined;
    if (this.isUrl(input)) return undefined;

    let filename = input.replace(/^[/\\]?uploads[/\\]/i, "");
    filename = filename.replace(/^[/\\]+/, "");
    if (!filename) return undefined;

    return path.join(uploadsDir, filename);
  }

  static removeFile(filenameOrUrl: string): void {
    const absPath = this.normalizeToDiskPath(filenameOrUrl);
    if (!absPath) return;
    try {
      if (fs.existsSync(absPath)) {
        fs.unlinkSync(absPath);
      }
    } catch (_) {}
  }

  static removeFiles(filenamesOrUrls: string[]): void {
    filenamesOrUrls.forEach((f) => this.removeFile(f));
  }

  static removeFileByPath(filePath: string): void {
    try {
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch (_) {}
  }

  static avatarUrl(avatar: string): string {
    return `https://deficall.defilinkteam.org/api/${avatar}`;
  }
}
