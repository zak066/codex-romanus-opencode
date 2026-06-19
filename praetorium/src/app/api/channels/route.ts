import { NextResponse } from 'next/server';
import type {
  ChannelDTO,
  ChannelMessageDTO,
  ChannelsResponse,
  ChannelDetailResponse,
} from '@/lib/types';

const TABULARIUM_URL =
  process.env.NEXT_PUBLIC_TABULARIUM_URL || 'http://localhost:3100';

async function fetchResource<T>(uri: string): Promise<T> {
  const encoded = encodeURIComponent(uri);
  const res = await fetch(`${TABULARIUM_URL}/api/resources/${encoded}`);
  if (!res.ok) throw new Error(`Tabularium returned ${res.status}`);
  const data = await res.json();
  const text: string = data.contents?.[0]?.text || '[]';
  return JSON.parse(text) as T;
}

function mapChannel(ch: Record<string, unknown>): ChannelDTO {
  const rawName = String(ch.name ?? '');
  const name = rawName.startsWith('dm-') ? rawName : `#${rawName}`;
  return {
    id: String(ch.id ?? ''),
    name,
    description: String(ch.description ?? ''),
    is_default: Boolean(ch.is_default),
    message_count: (ch.message_count as number) ?? undefined,
    last_message: ch.last_message
      ? (ch.last_message as ChannelDTO['last_message'])
      : undefined,
  };
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const channelName = searchParams.get('name');

    if (channelName) {
      const lookupName = channelName.startsWith('#') ? channelName.slice(1) : channelName;
      const data = await fetchResource<{
        channel: Record<string, unknown>;
        messages: ChannelMessageDTO[];
        total: number;
      }>(`tabularium://channels/${lookupName}/history`);

      const response: ChannelDetailResponse = {
        channel: mapChannel(data.channel ?? {}),
        messages: data.messages ?? [],
        total: data.total ?? 0,
      };
      return NextResponse.json(response);
    }

    // Fetch all channels
    const data = await fetchResource<{
      channels: Record<string, unknown>[];
      total: number;
    }>('tabularium://channels/list');

    // Enrich channels with message_count and last_message
    const enriched = await Promise.all(
      (data.channels ?? []).map(async (ch) => {
        try {
          const history = await fetchResource<{
            channel: Record<string, unknown>;
            messages: Array<{ id: string; sender: string; content: string; created_at: string }>;
            total: number;
          }>(`tabularium://channels/${ch.name}/history`);
          return {
            ...ch,
            message_count: history.total ?? history.messages?.length ?? 0,
            last_message: history.messages?.[0] ? {
              content: history.messages[0].content,
              sender: history.messages[0].sender,
              created_at: history.messages[0].created_at,
            } : undefined,
          };
        } catch {
          return ch;
        }
      }),
    );

    const channels = enriched.map(mapChannel);
    const response: ChannelsResponse = {
      channels,
      total: channels.length,
    };
    return NextResponse.json(response);
  } catch (error) {
    console.error('Channels API error:', error);
    return NextResponse.json(
      { error: 'Failed to load channels' },
      { status: 500 },
    );
  }
}
