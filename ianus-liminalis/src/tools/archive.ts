/**
 * fs_archive — Ianus Liminalis
 *
 * Create, extract, and list .tar.gz and .zip archives.
 * Uses Node.js built-in zlib for gzip compression and adm-zip for ZIP support.
 * minimatch for glob filtering.
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import {
  readFile,
  writeFile,
  mkdir,
  opendir,
  stat,
  lstat,
} from 'node:fs/promises';
import {
  resolve,
  relative,
  sep,
  dirname,
  normalize,
} from 'node:path';
import { existsSync } from 'node:fs';
import { gzip, gunzip } from 'node:zlib';
import { minimatch } from 'minimatch';
import AdmZip from 'adm-zip';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const BLOCK_SIZE = 512;
const HEADER_SIZE = 512;
const MAX_FILE_SIZE = 500 * 1024 * 1024; // 500 MB
const VALID_OPERATIONS = ['create', 'extract', 'list'] as const;
const VALID_FORMATS = ['auto', 'tar.gz', 'zip'] as const;
const DEFAULT_COMPRESSION = 6;

type ArchiveOperation = (typeof VALID_OPERATIONS)[number];
type ArchiveFormat = (typeof VALID_FORMATS)[number];

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface ArchiveEntry {
  path: string;
  size: number;
  type: 'file' | 'directory';
  mtime: string; // ISO string
}

interface ArchiveOptions {
  operation: ArchiveOperation;
  archive: string;
  files?: string[];
  outputDir?: string;
  format?: ArchiveFormat;
  compressionLevel?: number;
  overwrite?: boolean;
  include?: string;
  exclude?: string;
  agent?: string;
}

// ---------------------------------------------------------------------------
// Tar format constants
// ---------------------------------------------------------------------------

const TAR_TYPES = {
  FILE: '0',
  DIRECTORY: '5',
} as const;

// ---------------------------------------------------------------------------
// Tar utility: encode a 512-byte POSIX tar header
// ---------------------------------------------------------------------------

function encodeTarHeader(
  name: string,
  size: number,
  mtime: number,
  type: '0' | '5',
  mode: number = 0o644,
): Buffer {
  const buf = Buffer.alloc(HEADER_SIZE, 0);

  // Normalize path separators and handle directory suffix
  const normalizedName = name.replace(/\\/g, '/');

  // name (100 bytes)
  const nameBuf = Buffer.from(normalizedName, 'ascii');
  if (nameBuf.length <= 100) {
    nameBuf.copy(buf, 0, 0, Math.min(nameBuf.length, 100));
  } else {
    // Try to split into prefix (155) + name (100)
    // Find separator to split
    const splitIdx = normalizedName.lastIndexOf('/', 155);
    if (splitIdx > 0 && splitIdx < normalizedName.length - 1) {
      const prefix = normalizedName.substring(0, splitIdx);
      const fname = normalizedName.substring(splitIdx + 1);
      if (prefix.length <= 155 && fname.length <= 100) {
        // GNU/ustar prefix field
        Buffer.from(prefix, 'ascii').copy(buf, 345, 0, prefix.length);
        Buffer.from(fname, 'ascii').copy(buf, 0, 0, fname.length);
      } else {
        // Truncate to fit
        nameBuf.copy(buf, 0, 0, 100);
      }
    } else {
      nameBuf.copy(buf, 0, 0, 100);
    }
  }

  // mode (8 bytes) — octal string, null-terminated
  const modeStr = mode.toString(8).padStart(7, '0') + '\0';
  buf.write(modeStr, 100, 8, 'ascii');

  // uid (8 bytes)
  buf.write('0000000\0', 108, 8, 'ascii');

  // gid (8 bytes)
  buf.write('0000000\0', 116, 8, 'ascii');

  // size (12 bytes) — octal, space-terminated
  const sizeStr = size.toString(8).padStart(11, '0') + ' ';
  buf.write(sizeStr, 124, 12, 'ascii');

  // mtime (12 bytes) — octal seconds, space-terminated
  const mtimeSec = Math.floor(mtime / 1000);
  const mtimeStr = mtimeSec.toString(8).padStart(11, '0') + ' ';
  buf.write(mtimeStr, 136, 12, 'ascii');

  // chksum placeholder (8 bytes) — fill with spaces
  buf.write('        ', 148, 8, 'ascii');

  // typeflag (1 byte)
  buf[156] = type.charCodeAt(0);

  // magic (6 bytes)
  buf.write('ustar\0', 257, 6, 'ascii');

  // version (2 bytes)
  buf.write('00', 263, 2, 'ascii');

  // Calculate checksum: sum of all 512 bytes
  let checksum = 0;
  for (let i = 0; i < HEADER_SIZE; i++) {
    checksum += buf[i];
  }

  // Write checksum (6 octal digits + null + space)
  const chkStr = checksum.toString(8).padStart(6, '0') + '\0 ';
  buf.write(chkStr, 148, 8, 'ascii');

  return buf;
}

// ---------------------------------------------------------------------------
// Tar utility: parse a 512-byte tar header → entry metadata or null
// ---------------------------------------------------------------------------

interface ParsedTarHeader {
  name: string;
  size: number;
  mtime: number;
  type: 'file' | 'directory';
  mode: number;
  prefix: string;
  isNullBlock: boolean;
}

function parseTarHeader(buf: Buffer): ParsedTarHeader {
  // Check for end-of-archive (all zeros)
  let allZeros = true;
  for (let i = 0; i < HEADER_SIZE; i++) {
    if (buf[i] !== 0) {
      allZeros = false;
      break;
    }
  }
  if (allZeros) {
    return {
      name: '',
      size: 0,
      mtime: 0,
      type: 'file',
      mode: 0,
      prefix: '',
      isNullBlock: true,
    };
  }

  // Read raw fields (trim null bytes)
  const rawName = buf.toString('ascii', 0, 100).replace(/\0.*$/, '');
  const rawPrefix = buf.toString('ascii', 345, 500).replace(/\0.*$/, '');
  const rawSize = buf.toString('ascii', 124, 136).trim();
  const rawMtime = buf.toString('ascii', 136, 148).trim();
  const typeFlag = String.fromCharCode(buf[156]);
  const rawMode = buf.toString('ascii', 100, 108).trim();

  // Reconstruct full path
  let fullName = rawName;
  if (rawPrefix) {
    fullName = rawPrefix + '/' + rawName;
  }

  // Parse size (octal) and mtime (octal)
  const size = parseInt(rawSize, 8) || 0;
  const mtime = parseInt(rawMtime, 8) || 0;
  const mode = parseInt(rawMode, 8) || 0;

  let entryType: 'file' | 'directory';
  if (typeFlag === '5') {
    entryType = 'directory';
  } else if (typeFlag === '2') {
    // Symlink — treat as file
    entryType = 'file';
  } else {
    entryType = 'file';
  }

  return {
    name: fullName,
    size,
    mtime: mtime * 1000, // Convert seconds → ms
    type: entryType,
    mode,
    prefix: rawPrefix,
    isNullBlock: false,
  };
}

// ---------------------------------------------------------------------------
// Security: check path traversal safety
// ---------------------------------------------------------------------------

/**
 * Verifies that a resolved path is within the expected output directory.
 * Returns the safe resolved path or throws.
 */
function safeResolvePath(targetPath: string, outputDir: string): string {
  const resolvedDir = resolve(normalize(outputDir));
  const resolvedTarget = resolve(resolvedDir, normalize(targetPath));

  const dirNorm = process.platform === 'win32'
    ? resolvedDir.toLowerCase()
    : resolvedDir;
  const targetNorm = process.platform === 'win32'
    ? resolvedTarget.toLowerCase()
    : resolvedTarget;

  if (!targetNorm.startsWith(dirNorm + sep) && targetNorm !== dirNorm) {
    throw new Error(
      `Path traversal blocked: "${targetPath}" resolves outside the output directory`,
    );
  }

  return resolvedTarget;
}

// ---------------------------------------------------------------------------
// Directory walking with include/exclude glob
// ---------------------------------------------------------------------------

interface WalkEntry {
  path: string;
  absolutePath: string;
  relativePath: string;
}

async function walkDirectory(
  dirAbs: string,
  workspaceRoot: string,
  include?: string,
  exclude?: string,
): Promise<WalkEntry[]> {
  const results: WalkEntry[] = [];
  const dir = await opendir(dirAbs);

  for await (const entry of dir) {
    const absPath = resolve(dirAbs, entry.name);
    const relPath = relative(workspaceRoot, absPath).replace(/\\/g, '/');

    // Apply include/exclude glob filters
    if (include && !minimatch(relPath, include, { dot: true })) {
      continue;
    }
    if (exclude && minimatch(relPath, exclude, { dot: true })) {
      continue;
    }

    const entryStat = await lstat(absPath);

    if (entryStat.isDirectory()) {
      // Add directory entry itself
      results.push({
        path: relPath + '/',
        absolutePath: absPath,
        relativePath: relPath + '/',
      });
      // Recurse
      const children = await walkDirectory(absPath, workspaceRoot, include, exclude);
      results.push(...children);
    } else if (entryStat.isFile() || entryStat.isSymbolicLink()) {
      if (entryStat.size > MAX_FILE_SIZE) {
        // Skip files larger than 500MB
        continue;
      }
      results.push({
        path: relPath,
        absolutePath: absPath,
        relativePath: relPath,
      });
    }
    // Skip other types (FIFO, socket, etc.)
  }

  return results;
}

// ---------------------------------------------------------------------------
// Build a complete tar archive buffer from a list of files
// ---------------------------------------------------------------------------

async function buildTar(
  files: string[],
  workspaceRoot: string,
  include?: string,
  exclude?: string,
): Promise<Buffer> {
  const chunks: Buffer[] = [];

  for (const filePath of files) {
    const safePath = resolveSafePath(filePath, workspaceRoot);
    const entryStat = await stat(safePath);

    if (entryStat.isDirectory()) {
      // Walk directory recursively
      const entries = await walkDirectory(safePath, workspaceRoot, include, exclude);

      // Add directory entry for root
      const relDirPath = relative(workspaceRoot, safePath).replace(/\\/g, '/') + '/';
      const dirHeader = encodeTarHeader(
        relDirPath,
        0,
        entryStat.mtimeMs,
        TAR_TYPES.DIRECTORY,
        entryStat.mode,
      );
      chunks.push(dirHeader);

      for (const entry of entries) {
        if (entry.path.endsWith('/')) {
          // Directory entry
          const eStat = await stat(entry.absolutePath);
          const hdr = encodeTarHeader(entry.path, 0, eStat.mtimeMs, TAR_TYPES.DIRECTORY, eStat.mode);
          chunks.push(hdr);
        } else {
          // File entry
          const eStat = await stat(entry.absolutePath);
          if (eStat.size > MAX_FILE_SIZE) continue;

          const content = await readFile(entry.absolutePath);
          const hdr = encodeTarHeader(entry.path, content.length, eStat.mtimeMs, TAR_TYPES.FILE, eStat.mode);
          chunks.push(hdr);
          chunks.push(content);

          // Pad to 512-byte boundary
          const padding = BLOCK_SIZE - (content.length % BLOCK_SIZE);
          if (padding < BLOCK_SIZE) {
            chunks.push(Buffer.alloc(padding, 0));
          }
        }
      }
    } else if (entryStat.isFile()) {
      if (entryStat.size > MAX_FILE_SIZE) {
        // Skip files larger than 500MB
        continue;
      }

      const relPath = relative(workspaceRoot, safePath).replace(/\\/g, '/');

      // Apply include/exclude glob
      if (include && !minimatch(relPath, include, { dot: true })) continue;
      if (exclude && minimatch(relPath, exclude, { dot: true })) continue;

      const content = await readFile(safePath);
      const hdr = encodeTarHeader(relPath, content.length, entryStat.mtimeMs, TAR_TYPES.FILE, entryStat.mode);
      chunks.push(hdr);
      chunks.push(content);

      // Pad to 512-byte boundary
      const padding = BLOCK_SIZE - (content.length % BLOCK_SIZE);
      if (padding < BLOCK_SIZE) {
        chunks.push(Buffer.alloc(padding, 0));
      }
    }
    // Skip non-regular-files (devices, fifo, etc.)
  }

  // End-of-archive: two 512-byte null blocks
  chunks.push(Buffer.alloc(BLOCK_SIZE, 0));
  chunks.push(Buffer.alloc(BLOCK_SIZE, 0));

  return Buffer.concat(chunks);
}

// ---------------------------------------------------------------------------
// Extract files from a tar buffer into an output directory
// ---------------------------------------------------------------------------

interface ExtractResult {
  extracted: number;
  skipped: number;
  errors: string[];
  files: string[];
}

async function extractTar(
  tarBuffer: Buffer,
  outputDir: string,
  overwrite: boolean,
): Promise<ExtractResult> {
  const result: ExtractResult = { extracted: 0, skipped: 0, errors: [], files: [] };
  let offset = 0;

  while (offset + HEADER_SIZE <= tarBuffer.length) {
    const headerBuf = tarBuffer.subarray(offset, offset + HEADER_SIZE);
    const parsed = parseTarHeader(headerBuf);

    if (parsed.isNullBlock) {
      offset += HEADER_SIZE;
      // Check if next block is also null (end-of-archive)
      if (offset + HEADER_SIZE <= tarBuffer.length) {
        const nextBuf = tarBuffer.subarray(offset, offset + HEADER_SIZE);
        let nextIsNull = true;
        for (let i = 0; i < HEADER_SIZE; i++) {
          if (nextBuf[i] !== 0) { nextIsNull = false; break; }
        }
        if (nextIsNull) break;
      }
      continue;
    }

    offset += HEADER_SIZE;

    // Skip device nodes, FIFO (typeflag '3'=character, '4'=block, '6'=FIFO)
    const rawType = String.fromCharCode(headerBuf[156]);
    if (rawType === '3' || rawType === '4' || rawType === '6') {
      result.skipped++;
      offset += Math.ceil(parsed.size / BLOCK_SIZE) * BLOCK_SIZE;
      continue;
    }

    // Skip files > 500MB
    if (parsed.size > MAX_FILE_SIZE) {
      result.skipped++;
      offset += Math.ceil(parsed.size / BLOCK_SIZE) * BLOCK_SIZE;
      result.errors.push(`Skipped "${parsed.name}": exceeds 500MB limit`);
      continue;
    }

    // Reject absolute paths
    if (parsed.name.startsWith('/')) {
      result.skipped++;
      result.errors.push(`Skipped "${parsed.name}": absolute paths are not allowed`);
      continue;
    }

    // Path traversal check
    let targetPath: string;
    try {
      targetPath = safeResolvePath(parsed.name, outputDir);
    } catch {
      result.skipped++;
      result.errors.push(`Skipped "${parsed.name}": path traversal detected`);
      offset += Math.ceil(parsed.size / BLOCK_SIZE) * BLOCK_SIZE;
      continue;
    }

    // Read data block (padded to BLOCK_SIZE)
    const dataSize = parsed.size;
    const paddedSize = Math.ceil(dataSize / BLOCK_SIZE) * BLOCK_SIZE;
    const dataBuf = tarBuffer.subarray(offset, offset + dataSize);
    offset += paddedSize;

    if (parsed.type === 'directory') {
      await mkdir(targetPath, { recursive: true });
    } else {
      // Create parent directory
      await mkdir(dirname(targetPath), { recursive: true });

      // Check if file exists and overwrite flag
      if (!overwrite && existsSync(targetPath)) {
        result.skipped++;
        result.files.push(parsed.name);
        continue;
      }

      await writeFile(targetPath, dataBuf);
      result.extracted++;
      result.files.push(parsed.name);
    }
  }

  return result;
}

// ---------------------------------------------------------------------------
// List entries in a tar archive
// ---------------------------------------------------------------------------

async function listTar(tarBuffer: Buffer): Promise<ArchiveEntry[]> {
  const entries: ArchiveEntry[] = [];
  let offset = 0;

  while (offset + HEADER_SIZE <= tarBuffer.length) {
    const headerBuf = tarBuffer.subarray(offset, offset + HEADER_SIZE);
    const parsed = parseTarHeader(headerBuf);

    if (parsed.isNullBlock) {
      offset += HEADER_SIZE;
      // Check for second null block (end)
      if (offset + HEADER_SIZE <= tarBuffer.length) {
        const nextBuf = tarBuffer.subarray(offset, offset + HEADER_SIZE);
        let nextIsNull = true;
        for (let i = 0; i < HEADER_SIZE; i++) {
          if (nextBuf[i] !== 0) { nextIsNull = false; break; }
        }
        if (nextIsNull) break;
      }
      continue;
    }

    offset += HEADER_SIZE;
    const paddedSize = Math.ceil(parsed.size / BLOCK_SIZE) * BLOCK_SIZE;
    offset += paddedSize;

    entries.push({
      path: parsed.name,
      size: parsed.size,
      type: parsed.type,
      mtime: new Date(parsed.mtime).toISOString(),
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Detect archive format from file extension
// ---------------------------------------------------------------------------

function detectFormat(archivePath: string, format?: ArchiveFormat): ArchiveFormat {
  if (format && format !== 'auto') return format;

  const lower = archivePath.toLowerCase();
  if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'tar.gz';
  if (lower.endsWith('.zip')) return 'zip';

  // Default to tar.gz
  return 'tar.gz';
}

// ---------------------------------------------------------------------------
// Permission check helper
// ---------------------------------------------------------------------------

async function checkPerm(
  deps: ToolDeps,
  agent: string,
  op: string,
  path: string,
): Promise<{ allowed: boolean; reason?: string }> {
  return deps.permission.checkOperation(agent, op, path, deps.workspaceRoot);
}

// ---------------------------------------------------------------------------
// Handler: create archive
// ---------------------------------------------------------------------------

async function handleCreate(
  args: Record<string, unknown>,
  deps: ToolDeps,
  callerAgent: string,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const archivePath = args.archive as string | undefined;
  const files = args.files as string[] | undefined;
  const formatOpt = args.format as ArchiveFormat | undefined;
  const compressionLevel = (args.compressionLevel as number) ?? DEFAULT_COMPRESSION;
  const include = args.include as string | undefined;
  const exclude = args.exclude as string | undefined;

  if (!archivePath) {
    return { content: [{ type: 'text', text: 'Missing required parameter: "archive"' }], isError: true };
  }

  if (!files || files.length === 0) {
    return { content: [{ type: 'text', text: 'Missing required parameter: "files"' }], isError: true };
  }

  // Permission check — write
  const permCheck = await checkPerm(deps, callerAgent, 'write', archivePath);
  if (!permCheck.allowed) {
    return { content: [{ type: 'text', text: `Permission denied: ${permCheck.reason}` }], isError: true };
  }

  const safeArchivePath = resolveSafePath(archivePath, deps.workspaceRoot);

  // Check if archive already exists
  if (!args.overwrite && existsSync(safeArchivePath)) {
    return {
      content: [{ type: 'text', text: `Archive already exists: "${archivePath}". Use overwrite=true to overwrite.` }],
      isError: true,
    };
  }

  const format = detectFormat(archivePath, formatOpt);

  if (format === 'zip') {
    try {
      const zip = new AdmZip();

      for (const filePath of files) {
        const safePath = resolveSafePath(filePath, deps.workspaceRoot);
        const entryStat = await stat(safePath);

        if (entryStat.isDirectory()) {
          // Walk directory and add files
          const entries = await walkDirectory(safePath, deps.workspaceRoot, include, exclude);
          for (const entry of entries) {
            if (!entry.path.endsWith('/')) {
              zip.addLocalFile(entry.absolutePath, dirname(entry.relativePath));
            }
          }
        } else if (entryStat.isFile()) {
          const relPath = relative(deps.workspaceRoot, safePath).replace(/\\/g, '/');

          // Apply include/exclude glob
          if (include && !minimatch(relPath, include, { dot: true })) continue;
          if (exclude && minimatch(relPath, exclude, { dot: true })) continue;
          if (entryStat.size > MAX_FILE_SIZE) continue;

          zip.addLocalFile(safePath);
        }
      }

      const zipData = zip.toBuffer();

      // Write archive file
      await mkdir(dirname(safeArchivePath), { recursive: true });
      await writeFile(safeArchivePath, zipData);

      // Log to journal
      await logToJournal(deps.workspaceRoot, {
        agent: 'ianus',
        operation: 'archive_create',
        path: archivePath,
        details: { format: 'zip', files: files.length, compressedSize: zipData.length },
      });

      serverStats.increment();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              archive: archivePath,
              format: 'zip',
              compressedSize: zipData.length,
              filesIncluded: files.length,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Archive creation error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }

  try {
    // Build tar archive in memory
    const tarBuffer = await buildTar(files, deps.workspaceRoot, include, exclude);

    // Compress with gzip
    const compressed = await new Promise<Buffer>((resolvePromise, reject) => {
      gzip(tarBuffer, { level: Math.min(9, Math.max(0, compressionLevel)) }, (err, result) => {
        if (err) reject(err);
        else resolvePromise(result);
      });
    });

    // Write archive file
    await mkdir(dirname(safeArchivePath), { recursive: true });
    await writeFile(safeArchivePath, compressed);

    // Log to journal
    await logToJournal(deps.workspaceRoot, {
      agent: 'ianus',
      operation: 'archive_create',
      path: archivePath,
      details: { format: 'tar.gz', files: files.length, compressedSize: compressed.length },
    });

    serverStats.increment();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            archive: archivePath,
            format: 'tar.gz',
            compressedSize: compressed.length,
            filesIncluded: files.length,
          }),
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Archive creation error: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Handler: extract archive
// ---------------------------------------------------------------------------

async function handleExtract(
  args: Record<string, unknown>,
  deps: ToolDeps,
  callerAgent: string,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const archivePath = args.archive as string | undefined;
  const outputDir = args.outputDir as string | undefined;
  const formatOpt = args.format as ArchiveFormat | undefined;
  const overwrite = (args.overwrite as boolean) ?? false;

  if (!archivePath) {
    return { content: [{ type: 'text', text: 'Missing required parameter: "archive"' }], isError: true };
  }

  if (!outputDir) {
    return { content: [{ type: 'text', text: 'Missing required parameter: "outputDir"' }], isError: true };
  }

  // Permission check — read (for archive) and write (for outputDir)
  const readPerm = await checkPerm(deps, callerAgent, 'read', archivePath);
  if (!readPerm.allowed) {
    return { content: [{ type: 'text', text: `Permission denied: ${readPerm.reason}` }], isError: true };
  }
  const writePerm = await checkPerm(deps, callerAgent, 'write', outputDir);
  if (!writePerm.allowed) {
    return { content: [{ type: 'text', text: `Permission denied: ${writePerm.reason}` }], isError: true };
  }

  const safeArchivePath = resolveSafePath(archivePath, deps.workspaceRoot);
  const safeOutputDir = resolveSafePath(outputDir, deps.workspaceRoot);

  // Verify archive exists
  try {
    await stat(safeArchivePath);
  } catch {
    return { content: [{ type: 'text', text: `Archive not found: "${archivePath}"` }], isError: true };
  }

  const format = detectFormat(archivePath, formatOpt);

  if (format === 'zip') {
    try {
      const zip = new AdmZip(safeArchivePath);
      zip.extractAllTo(safeOutputDir, overwrite);

      // Count extracted files
      const entries = zip.getEntries();
      const extracted = entries.filter(e => !e.isDirectory).length;

      // Log to journal
      await logToJournal(deps.workspaceRoot, {
        agent: 'ianus',
        operation: 'archive_extract',
        path: archivePath,
        details: { outputDir, extracted, skipped: entries.length - extracted },
      });

      serverStats.increment();

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              archive: archivePath,
              outputDir,
              extracted,
              skipped: entries.length - extracted,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Archive extraction error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }

  try {
    // Read archive file
    const archiveData = await readFile(safeArchivePath);

    // Decompress
    const tarBuffer = await new Promise<Buffer>((resolvePromise, reject) => {
      gunzip(archiveData, (err, result) => {
        if (err) reject(err);
        else resolvePromise(result);
      });
    });

    // Extract files
    const result = await extractTar(tarBuffer, safeOutputDir, overwrite);

    // Log to journal
    await logToJournal(deps.workspaceRoot, {
      agent: 'ianus',
      operation: 'archive_extract',
      path: archivePath,
      details: { outputDir, extracted: result.extracted, skipped: result.skipped },
    });

    serverStats.increment();

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            archive: archivePath,
            outputDir,
            extracted: result.extracted,
            skipped: result.skipped,
            errors: result.errors.length > 0 ? result.errors : undefined,
          }),
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Archive extraction error: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Handler: list archive contents
// ---------------------------------------------------------------------------

async function handleList(
  args: Record<string, unknown>,
  deps: ToolDeps,
  callerAgent: string,
): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }> {
  const archivePath = args.archive as string | undefined;
  const formatOpt = args.format as ArchiveFormat | undefined;

  if (!archivePath) {
    return { content: [{ type: 'text', text: 'Missing required parameter: "archive"' }], isError: true };
  }

  // Permission check — read
  const readPerm = await checkPerm(deps, callerAgent, 'read', archivePath);
  if (!readPerm.allowed) {
    return { content: [{ type: 'text', text: `Permission denied: ${readPerm.reason}` }], isError: true };
  }

  const safeArchivePath = resolveSafePath(archivePath, deps.workspaceRoot);

  // Verify archive exists
  try {
    await stat(safeArchivePath);
  } catch {
    return { content: [{ type: 'text', text: `Archive not found: "${archivePath}"` }], isError: true };
  }

  const format = detectFormat(archivePath, formatOpt);

  if (format === 'zip') {
    try {
      const zip = new AdmZip(safeArchivePath);
      const rawEntries = zip.getEntries();
      const entries = rawEntries.map(e => ({
        path: e.entryName,
        size: e.header.size,
        compressedSize: e.header.compressedSize,
        type: e.isDirectory ? 'directory' : 'file' as const,
        mtime: e.header.time ? new Date(e.header.time).toISOString() : undefined,
      }));

      // Log to journal
      await logToJournal(deps.workspaceRoot, {
        agent: 'ianus',
        operation: 'archive_list',
        path: archivePath,
        details: { totalEntries: entries.length },
      });

      serverStats.increment();

      const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

      return {
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              archive: archivePath,
              format: 'zip',
              entries,
              total: entries.length,
              totalSize,
            }),
          },
        ],
      };
    } catch (err) {
      return {
        content: [{ type: 'text', text: `Archive list error: ${(err as Error).message}` }],
        isError: true,
      };
    }
  }

  try {
    const archiveData = await readFile(safeArchivePath);

    const tarBuffer = await new Promise<Buffer>((resolvePromise, reject) => {
      gunzip(archiveData, (err, result) => {
        if (err) reject(err);
        else resolvePromise(result);
      });
    });

    const entries = await listTar(tarBuffer);

    // Log to journal
    await logToJournal(deps.workspaceRoot, {
      agent: 'ianus',
      operation: 'archive_list',
      path: archivePath,
      details: { totalEntries: entries.length },
    });

    serverStats.increment();

    const totalSize = entries.reduce((sum, e) => sum + e.size, 0);

    return {
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            archive: archivePath,
            format: 'tar.gz',
            entries,
            total: entries.length,
            totalSize,
          }),
        },
      ],
    };
  } catch (err) {
    return {
      content: [{ type: 'text', text: `Archive list error: ${(err as Error).message}` }],
      isError: true,
    };
  }
}

// ---------------------------------------------------------------------------
// Public registration function
// ---------------------------------------------------------------------------

export function registerArchive(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_archive',
    description:
      'Create, extract, and list archives. Supports .tar.gz (via Node.js zlib) and .zip (via adm-zip) formats. Glob-based include/exclude patterns for selective archiving.',
    annotations: { destructiveHint: true },
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['create', 'extract', 'list'],
          description: 'Archive operation: create (compress), extract (decompress), or list (inspect)',
        },
        archive: {
          type: 'string',
          description: 'Path to the archive file (.tar.gz or .tgz)',
        },
        files: {
          type: 'array',
          items: { type: 'string' },
          description: 'Files and directories to include in the archive (required for create)',
        },
        outputDir: {
          type: 'string',
          description: 'Output directory for extraction (required for extract)',
        },
        format: {
          type: 'string',
          enum: ['auto', 'tar.gz', 'zip'],
          default: 'auto',
          description:
            'Archive format. "auto" detects from file extension. ZIP is a stub (not yet implemented)',
        },
        compressionLevel: {
          type: 'number',
          default: 6,
          minimum: 0,
          maximum: 9,
          description: 'Gzip compression level 0-9 (0=store, 9=max, default: 6)',
        },
        overwrite: {
          type: 'boolean',
          default: false,
          description: 'Overwrite if archive file already exists (create) or overwrite existing files (extract)',
        },
        include: {
          type: 'string',
          description:
            'Glob pattern to include files (e.g., "src/**/*.ts"). Applied during create with directory walking',
        },
        exclude: {
          type: 'string',
          description:
            'Glob pattern to exclude files (e.g., "**/*.test.ts"). Applied during create with directory walking',
        },
        agent: {
          type: 'string',
          description: 'Nome dell agente chiamante (opzionale, default: "ianus")',
        },
      },
      required: ['operation', 'archive'],
    },
    handler: async (args) => {
      const operation = args.operation as string | undefined;

      if (!operation || !VALID_OPERATIONS.includes(operation as ArchiveOperation)) {
        return {
          content: [
            {
              type: 'text',
              text: `Missing or invalid required parameter: "operation". Must be one of: ${VALID_OPERATIONS.join(', ')}`,
            },
          ],
          isError: true,
        };
      }

      const archive = args.archive as string | undefined;
      if (!archive) {
        return {
          content: [{ type: 'text', text: 'Missing required parameter: "archive"' }],
          isError: true,
        };
      }

      const callerAgent = (args.agent as string) || 'ianus';

      try {
        switch (operation) {
          case 'create':
            return await handleCreate(args, deps, callerAgent);
          case 'extract':
            return await handleExtract(args, deps, callerAgent);
          case 'list':
            return await handleList(args, deps, callerAgent);
          default:
            return {
              content: [{ type: 'text', text: `Unknown operation: "${operation}"` }],
              isError: true,
            };
        }
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Archive error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}
