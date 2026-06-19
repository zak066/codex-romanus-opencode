'use client';

import React from 'react';
import { type NodeProps, type Node } from '@xyflow/react';

// ─── Custom Node Types ───────────────────────────────────────────────────────

export type GraphNode = Node<{ label: string }>;

export function CustomNode({ data }: NodeProps<GraphNode>) {
  return (
    <div className="px-4 py-2 bg-surface-raised border border-border-default rounded-lg shadow-lg">
      <div className="text-text-primary text-sm whitespace-pre-line">{data.label}</div>
    </div>
  );
}

export function CustomInputNode({ data }: NodeProps<GraphNode>) {
  return (
    <div className="px-4 py-2 bg-surface-overlay border-2 border-roman-gold rounded-lg shadow-lg">
      <div className="text-roman-gold text-sm font-semibold whitespace-pre-line">
        {data.label}
      </div>
    </div>
  );
}

export function CustomOutputNode({ data }: NodeProps<GraphNode>) {
  return (
    <div className="px-4 py-2 bg-surface-overlay border border-border-default rounded-lg shadow-lg">
      <div className="text-text-primary text-sm whitespace-pre-line">{data.label}</div>
    </div>
  );
}
