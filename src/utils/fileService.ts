
import fs from "fs";

export class FileService {
  private static basePath = "uploads/";

  static removeFile(filename: string): void {
    const path = `${this.basePath}${filename}`;
    fs.existsSync(path) && fs.unlinkSync(path);
  }

  static removeFiles(filenames: string[]): void {
    filenames.forEach(this.removeFile);
  }

  static removeFileByPath(path: string): void {
    fs.existsSync(path) && fs.unlinkSync(path);
  }
}
