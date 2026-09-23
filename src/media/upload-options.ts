import { diskStorage } from 'multer';
import { randomUUID } from 'node:crypto';
import { tmpdir } from 'node:os';
import { extname } from 'node:path';

// Keep raw multipart bodies out of the Node heap. The cleanup interceptor
// removes these temporary files after the request, including failed requests.
export const uploadStorage = diskStorage({
  destination: tmpdir(),
  filename: (_request, file, callback) => {
    callback(
      null,
      `${randomUUID()}${extname(file.originalname).toLowerCase()}`,
    );
  },
});

export const uploadCleanup = {
  storage: uploadStorage,
};
