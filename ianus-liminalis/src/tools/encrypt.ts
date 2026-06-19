/**
 * fs_encrypt - Ianus Liminalis
 *
 * Encrypt/decrypt files with AES-256-GCM using Node.js built-in crypto.
 * Format: [salt 16B][IV 12B][ciphertext][authTag 16B]
 */

import type { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { readFile, writeFile, stat } from 'node:fs/promises';
import { createCipheriv, createDecipheriv, randomBytes, pbkdf2Sync, type CipherGCM, type DecipherGCM } from 'node:crypto';
import { resolveSafePath } from '../core/path-utils.js';
import { logToJournal } from '../core/journal-logger.js';
import { stats as serverStats } from '../core/stats.js';
import { toolRegistry } from './registry.js';
import type { ToolDeps } from './types.js';

// Constants
const SALT_LENGTH = 16;
const IV_LENGTH = 12;
const AUTH_TAG_LENGTH = 16;
const PBKDF2_ITERATIONS = 100_000;
const PBKDF2_DIGEST = 'sha512';
const CHUNK_SIZE = 64 * 1024; // 64KB

// Helpers
function getCipherAlgorithm(keyLength: number): string {
  switch (keyLength) {
    case 16: return 'aes-128-gcm';
    case 24: return 'aes-192-gcm';
    case 32: return 'aes-256-gcm';
    default: return 'aes-256-gcm';
  }
}

function deriveKey(password: string, salt: Buffer, keyLength: number): Buffer {
  return pbkdf2Sync(password, salt, PBKDF2_ITERATIONS, keyLength, PBKDF2_DIGEST);
}

// Encryption
async function encryptFile(
  inputPath: string,
  outputPath: string,
  password: string,
  keyLength: number,
): Promise<{ inputSize: number; outputSize: number }> {
  const salt = randomBytes(SALT_LENGTH);
  const iv = randomBytes(IV_LENGTH);
  const key = deriveKey(password, salt, keyLength);
  const algorithm = getCipherAlgorithm(keyLength);

  const cipher = createCipheriv(algorithm, key, iv) as CipherGCM;

  const inputContent = await readFile(inputPath);
  const inputSize = inputContent.length;

  // Prepend salt + IV to output
  const outputParts: Buffer[] = [salt, iv];

  // Encrypt data
  const encrypted = Buffer.concat([cipher.update(inputContent), cipher.final()]);
  outputParts.push(encrypted);

  // Append auth tag
  const authTag = cipher.getAuthTag();
  outputParts.push(authTag);

  const outputBuffer = Buffer.concat(outputParts);
  await writeFile(outputPath, outputBuffer);

  return { inputSize, outputSize: outputBuffer.length };
}

// Decryption
async function decryptFile(
  inputPath: string,
  outputPath: string,
  password: string,
  keyLength: number,
): Promise<{ inputSize: number; outputSize: number }> {
  const inputContent = await readFile(inputPath);
  const inputSize = inputContent.length;

  if (inputSize < SALT_LENGTH + IV_LENGTH + AUTH_TAG_LENGTH + 1) {
    throw new Error('Encrypted file is too small or corrupt');
  }

  const salt = inputContent.subarray(0, SALT_LENGTH);
  const iv = inputContent.subarray(SALT_LENGTH, SALT_LENGTH + IV_LENGTH);
  const authTag = inputContent.subarray(inputContent.length - AUTH_TAG_LENGTH);
  const ciphertext = inputContent.subarray(SALT_LENGTH + IV_LENGTH, inputContent.length - AUTH_TAG_LENGTH);

  const key = deriveKey(password, salt, keyLength);
  const algorithm = getCipherAlgorithm(keyLength);

  const decipher = createDecipheriv(algorithm, key, iv) as DecipherGCM;
  decipher.setAuthTag(authTag);

  const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
  await writeFile(outputPath, decrypted);

  return { inputSize, outputSize: decrypted.length };
}

// Tool Registration
export function registerEncrypt(_server: Server, deps: ToolDeps): void {
  toolRegistry.register({
    name: 'fs_encrypt',
    description:
      'Encrypt or decrypt a file with AES-GCM using password-based key derivation (PBKDF2). ' +
      'Uses Node.js built-in crypto module with zero external dependencies. ' +
      'Encrypted file format: [salt 16B][IV 12B][ciphertext][authTag 16B].',
    inputSchema: {
      type: 'object',
      properties: {
        operation: {
          type: 'string',
          enum: ['encrypt', 'decrypt'],
          description: 'Encrypt or decrypt (required)',
        },
        path: {
          type: 'string',
          description: 'Input file path (required)',
        },
        output: {
          type: 'string',
          description: 'Output file path (required)',
        },
        password: {
          type: 'string',
          description: 'Password for key derivation (required)',
        },
        keyLength: {
          type: 'number',
          enum: [16, 24, 32],
          default: 32,
          description: 'Key length: 16 (AES-128), 24 (AES-192), 32 (AES-256) (default: 32)',
        },
        overwrite: {
          type: 'boolean',
          default: false,
          description: 'Overwrite output if exists (default: false)',
        },
      },
      required: ['operation', 'path', 'output', 'password'],
    },
    handler: async (args) => {
      const operation = args.operation as string;
      const inputPath = args.path as string;
      const outputPath = args.output as string;
      const password = args.password as string;
      const keyLength = (args.keyLength as number) ?? 32;
      const overwrite = (args.overwrite as boolean) ?? false;

      // Validation
      if (!inputPath || !outputPath || !password) {
        return {
          content: [{ type: 'text', text: 'Missing required parameters: path, output, password' }],
          isError: true,
        };
      }

      if (operation !== 'encrypt' && operation !== 'decrypt') {
        return {
          content: [{ type: 'text', text: 'Invalid operation: must be "encrypt" or "decrypt"' }],
          isError: true,
        };
      }

      if (![16, 24, 32].includes(keyLength)) {
        return {
          content: [{ type: 'text', text: 'Invalid keyLength: must be 16, 24, or 32' }],
          isError: true,
        };
      }

      try {
        const safeInput = resolveSafePath(inputPath, deps.workspaceRoot);
        const safeOutput = resolveSafePath(outputPath, deps.workspaceRoot);

        // Check output exists
        if (!overwrite) {
          try {
            await stat(safeOutput);
            return {
              content: [{ type: 'text', text: `Output file already exists: "${outputPath}". Use overwrite=true to override.` }],
              isError: true,
            };
          } catch {
            // Does not exist - OK
          }
        }

        // Check input exists
        try {
          await stat(safeInput);
        } catch {
          return {
            content: [{ type: 'text', text: `Input file not found: "${inputPath}"` }],
            isError: true,
          };
        }

        let result: { inputSize: number; outputSize: number };

        if (operation === 'encrypt') {
          result = await encryptFile(safeInput, safeOutput, password, keyLength);
        } else {
          result = await decryptFile(safeInput, safeOutput, password, keyLength);
        }

        const algorithm = getCipherAlgorithm(keyLength);

        // Log to journal (with obscured password)
        await logToJournal(deps.workspaceRoot, {
          agent: 'ianus',
          operation: `encrypt_${operation}`,
          path: inputPath,
          details: {
            operation,
            inputSize: result.inputSize,
            outputSize: result.outputSize,
            algorithm,
            outputPath,
          },
        });

        serverStats.increment();

        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify({
                operation,
                path: inputPath,
                output: outputPath,
                algorithm,
                inputSize: result.inputSize,
                outputSize: result.outputSize,
                success: true,
              }),
            },
          ],
        };
      } catch (err) {
        return {
          content: [{ type: 'text', text: `Encryption error: ${(err as Error).message}` }],
          isError: true,
        };
      }
    },
  });
}