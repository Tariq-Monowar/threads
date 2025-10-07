import path from "path";
import fs from "fs";
import { v4 as uuidv4 } from "uuid";
import multer from "fastify-multer";
import multipart from "@fastify/multipart";

export const uploadsDir = path.join(__dirname, "../../uploads");

if (!fs.existsSync(uploadsDir)) {
  fs.mkdirSync(uploadsDir, { recursive: true });
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, uploadsDir),
  filename: (req, file, cb) => {
    const uniqueSuffix = uuidv4();
    const ext = path.extname(file.originalname);
    cb(null, `${uniqueSuffix}${ext}`);
  },
});

export const upload = multer({
  storage,
  fileFilter: (req, file, cb) => {
    // Accept all file types
    cb(null, true);
  },
  limits: {
    fileSize: Infinity, // No file size limit
  }
});

export const registerMultipart = (fastify) => {
  fastify.register(multipart, {
    limits: {
      fileSize: Infinity, // No file size limit
      files: Infinity,    // No limit on number of files
      fields: Infinity,   // No limit on number of fields
      parts: Infinity     // No limit on total parts
    }
  });
};