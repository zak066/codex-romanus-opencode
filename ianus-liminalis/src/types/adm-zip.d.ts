// Type definitions for adm-zip 0.5.x
// Based on adm-zip source inspection (CJS, no built-in types)

declare module 'adm-zip' {
  interface AdmZipEntryHeader {
    size: number;
    compressedSize: number;
    time?: Date;
    fileAttr?: number;
  }

  interface AdmZipEntry {
    entryName: string;
    header: AdmZipEntryHeader;
    isDirectory: boolean;
    getData(pass?: string): Buffer;
  }

  interface AdmZipInstance {
    addLocalFile(localPath: string, zipPath?: string, zipName?: string, comment?: string): void;
    addLocalFolder(localPath: string, zipPath?: string, filter?: RegExp | ((filename: string) => boolean)): void;
    addFile(entryName: string, content: string | Buffer, comment?: string, attr?: number): void;
    getEntries(password?: string): AdmZipEntry[];
    getEntry(name: string): AdmZipEntry | null;
    getEntryCount(): number;
    toBuffer(): Buffer;
    toBufferPromise(): Promise<Buffer>;
    extractAllTo(targetPath: string, overwrite?: boolean, keepOriginalPermission?: boolean, pass?: string): void;
    extractAllToAsync(
      targetPath: string,
      overwrite?: boolean,
      keepOriginalPermission?: boolean,
      callback?: (err: Error | null) => void,
    ): void | Promise<void>;
    writeZip(targetFileName?: string, callback?: (err: Error | null, result: string) => void): void;
    writeZipPromise(targetFileName?: string, props?: { overwrite?: boolean; perm?: boolean }): Promise<void>;
    deleteFile(entry: string | AdmZipEntry, withSubfolders?: boolean): void;
    readAsText(entry: string | AdmZipEntry, encoding?: string): string;
    readAsTextAsync(
      entry: string | AdmZipEntry,
      callback: (data: string, err: Error | null) => void,
      encoding?: string,
    ): void;
    addZipComment(comment: string): void;
  }

  interface AdmZipConstructor {
    new (input?: string | Buffer, options?: Record<string, unknown>): AdmZipInstance;
    (input?: string | Buffer, options?: Record<string, unknown>): AdmZipInstance;
  }

  const AdmZip: AdmZipConstructor;
  export default AdmZip;
}
