import { NextResponse } from 'next/server';
import { readFile } from 'fs/promises';
import path from 'path';

export async function GET() {
  try {
    const rootPackagePath = path.resolve(
      process.cwd(),
      '..',
      'package.json',
    );
    const praetoriumPackagePath = path.resolve(
      process.cwd(),
      'package.json',
    );

    const [rootRaw, praetoriumRaw] = await Promise.all([
      readFile(rootPackagePath, 'utf-8'),
      readFile(praetoriumPackagePath, 'utf-8'),
    ]);

    const rootPackage = JSON.parse(rootRaw);
    const praetoriumPackage = JSON.parse(praetoriumRaw);

    return NextResponse.json({
      rootPackage: {
        name: rootPackage.name || null,
        version: rootPackage.version || null,
        private: rootPackage.private || false,
        description: rootPackage.description || null,
      },
      praetoriumPackage: {
        name: praetoriumPackage.name,
        version: praetoriumPackage.version,
        private: praetoriumPackage.private || false,
        description: praetoriumPackage.description || null,
      },
      dependencies: {
        ...praetoriumPackage.dependencies,
        ...(praetoriumPackage.devDependencies
          ? { devDependencies: praetoriumPackage.devDependencies }
          : {}),
      },
    });
  } catch (error) {
    console.error('Failed to load package info:', error);
    return NextResponse.json(
      { error: 'Failed to load package info' },
      { status: 500 },
    );
  }
}
