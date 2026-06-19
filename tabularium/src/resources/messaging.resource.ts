/**
 * resources/messaging.resource.ts
 * Resource MCP per il sistema di Messaging Real-Time (R1).
 *
 * Supporta:
 * - tabularium://agents/status — stato in tempo reale di tutti gli agenti
 * - tabularium://agents/status/{name} — stato di un agente specifico
 * - tabularium://agents/{name}/inbox — messaggi pendenti per un agente
 * - tabularium://channels/list — elenco completo dei canali
 * - tabularium://channels/{name}/history — storico messaggi di un canale
 *
 * @module resources/messaging
 */

import type { ResourceContent, ResourceHandler } from '../types/mcp.js';
import { listHeartbeats, getHeartbeat } from '../messaging/db-heartbeats.js';
import { getInbox } from '../messaging/db-messages.js';
import { getChannelByName, listChannels } from '../messaging/db-channels.js';
import { getMessages } from '../messaging/db-messages.js';
import { getAllAgents } from '../core/agent-reader.js';

// ---------------------------------------------------------------------------
// Patterns URI
// ---------------------------------------------------------------------------

const URI_PATTERNS = [
  {
    pattern: /^tabularium:\/\/agents\/status(?:\/([^/]+))?$/,
    handler: 'agentStatus',
  },
  {
    pattern: /^tabularium:\/\/agents\/([^/]+)\/inbox$/,
    handler: 'agentInbox',
  },
  {
    pattern: /^tabularium:\/\/channels\/list$/,
    handler: 'channelsList',
  },
  {
    pattern: /^tabularium:\/\/channels\/([^/]+)\/history(?:\?(.+))?$/,
    handler: 'channelHistory',
  },
];

// ---------------------------------------------------------------------------
// Resource Handler (static)
// ---------------------------------------------------------------------------

/**
 * Resource handler statico per tabularium://agents/status.
 * Restituisce lo stato in tempo reale di tutti gli agenti,
 * incluso il modello LLM associato (da agent-reader).
 */
export const messagingResourceHandler: ResourceHandler = {
  uri: 'tabularium://agents/status',
  name: 'Agent Status',
  description: 'Real-time status of all agents: heartbeat, current task, online/offline, last seen',
  mimeType: 'application/json',

  handler: async (): Promise<ResourceContent[]> => {
    try {
      const heartbeats = listHeartbeats();
      const now = Date.now();
      const agentList = await getAllAgents();
      const agentModelMap = new Map(agentList.map(a => [a.name, a.model]));

      const agents = heartbeats.map((hb) => ({
        agent_name: hb.agent_name,
        status: hb.status,
        current_task: hb.current_task,
        last_seen: hb.last_seen,
        is_online: hb.status !== 'offline',
        seconds_since_heartbeat: hb.last_seen
          ? Math.floor((now - new Date(hb.last_seen).getTime()) / 1000)
          : 0,
        model: agentModelMap.get(hb.agent_name) || 'unknown',
      }));

      const online = agents.filter((a) => a.is_online).length;
      const offline = agents.length - online;

      return [
        {
          uri: 'tabularium://agents/status',
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              total: agents.length,
              online,
              offline,
              agents,
            },
            null,
            2
          ),
        },
      ];
    } catch {
      return [
        {
          uri: 'tabularium://agents/status',
          mimeType: 'application/json',
          text: JSON.stringify({
            status: 'unavailable',
            message: 'Heartbeat database not initialized',
          }),
        },
      ];
    }
  },
};

// ---------------------------------------------------------------------------
// URI Resolution
// ---------------------------------------------------------------------------

/**
 * Risolve un URI specifico di messaging e restituisce i contenuti.
 * Chiamato dal router centrale in resources/index.ts per URI
 * che iniziano con tabularium://agents/ o tabularium://channels/.
 *
 * @param uri - URI completo da risolvere
 * @returns Array di ResourceContent
 */
export async function resolveMessagingUri(uri: string): Promise<ResourceContent[]> {
  // Cerca pattern corrispondente
  for (const { pattern, handler } of URI_PATTERNS) {
    const match = uri.match(pattern);
    if (!match) continue;

    switch (handler) {
      case 'agentStatus':
        return handleAgentStatus(match[1]);
      case 'agentInbox':
        return handleAgentInbox(match[1]);
      case 'channelsList':
        return handleChannelsList();
      case 'channelHistory':
        return handleChannelHistory(match[1], match[2]);
    }
  }

  // Nessun pattern corrisponde: restituisci panoramica agenti
  return messagingResourceHandler.handler();
}

// ---------------------------------------------------------------------------
// Handler interni
// ---------------------------------------------------------------------------

/**
 * Gestisce: tabularium://agents/status (all) o tabularium://agents/status/{name}
 * Incluso modello LLM per ogni agente.
 */
async function handleAgentStatus(agentName?: string): Promise<ResourceContent[]> {
  try {
    const agentList = await getAllAgents();
    const agentModelMap = new Map(agentList.map(a => [a.name, a.model]));

    if (agentName) {
      // Agente specifico
      const hb = getHeartbeat(agentName);
      if (!hb) {
        return [
          {
            uri: `tabularium://agents/status/${agentName}`,
            mimeType: 'application/json',
            text: JSON.stringify({ error: `Agent not found: ${agentName}` }),
          },
        ];
      }

      const now = Date.now();
      return [
        {
          uri: `tabularium://agents/status/${agentName}`,
          mimeType: 'application/json',
          text: JSON.stringify(
            {
              agent_name: hb.agent_name,
              status: hb.status,
              current_task: hb.current_task,
              last_seen: hb.last_seen,
              is_online: hb.status !== 'offline',
              seconds_since_heartbeat: hb.last_seen
                ? Math.floor((now - new Date(hb.last_seen).getTime()) / 1000)
                : 0,
              model: agentModelMap.get(hb.agent_name) || 'unknown',
            },
            null,
            2
          ),
        },
      ];
    }

    // Tutti gli agenti
    const heartbeats = listHeartbeats();
    const now = Date.now();

    const agents = heartbeats.map((hb) => ({
      agent_name: hb.agent_name,
      status: hb.status,
      current_task: hb.current_task,
      last_seen: hb.last_seen,
      is_online: hb.status !== 'offline',
      seconds_since_heartbeat: hb.last_seen
        ? Math.floor((now - new Date(hb.last_seen).getTime()) / 1000)
        : 0,
      model: agentModelMap.get(hb.agent_name) || 'unknown',
    }));

    const online = agents.filter((a) => a.is_online).length;
    const offline = agents.length - online;

    return [
      {
        uri: 'tabularium://agents/status',
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            total: agents.length,
            online,
            offline,
            agents,
          },
          null,
          2
        ),
      },
    ];
  } catch {
    return [
      {
        uri: agentName
          ? `tabularium://agents/status/${agentName}`
          : 'tabularium://agents/status',
        mimeType: 'application/json',
        text: JSON.stringify({ error: 'Failed to retrieve agent status' }),
      },
    ];
  }
}

/**
 * Gestisce: tabularium://agents/{name}/inbox
 */
function handleAgentInbox(agentName: string): ResourceContent[] {
  try {
    const messages = getInbox(agentName, 20);

    return [
      {
        uri: `tabularium://agents/${agentName}/inbox`,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            agent: agentName,
            unread_count: messages.length,
            messages: messages.map((m) => ({
              id: m.id,
              channel_id: m.channel_id,
              sender: m.sender,
              content: m.content,
              created_at: m.created_at,
              metadata: m.metadata,
            })),
          },
          null,
          2
        ),
      },
    ];
  } catch {
    return [
      {
        uri: `tabularium://agents/${agentName}/inbox`,
        mimeType: 'application/json',
        text: JSON.stringify({ error: `Failed to retrieve inbox for agent: ${agentName}` }),
      },
    ];
  }
}

/**
 * Gestisce: tabularium://channels/list
 * Restituisce l'elenco completo dei canali di comunicazione.
 */
function handleChannelsList(): ResourceContent[] {
  try {
    const channels = listChannels();

    return [{
      uri: 'tabularium://channels/list',
      mimeType: 'application/json',
      text: JSON.stringify({
        channels: channels.map(ch => ({
          id: ch.id,
          name: ch.name,
          description: ch.description,
          is_default: ch.is_default === 1,
          created_at: ch.created_at,
        })),
        total: channels.length,
      }, null, 2),
    }];
  } catch (error) {
    return [{
      uri: 'tabularium://channels/list',
      mimeType: 'application/json',
      text: JSON.stringify({
        error: 'Failed to retrieve channels list',
        channels: [],
        total: 0,
      }),
    }];
  }
}

/**
 * Gestisce: tabularium://channels/{name}/history
 */
function handleChannelHistory(channelName: string, queryString?: string): ResourceContent[] {
  try {
    const channel = getChannelByName(channelName);
    if (!channel) {
      return [
        {
          uri: `tabularium://channels/${channelName}/history`,
          mimeType: 'application/json',
          text: JSON.stringify({ error: `Channel not found: ${channelName}` }),
        },
      ];
    }

    // Parse query params (limit, before, after)
    const params = parseQueryString(queryString ?? '');
    const limit = params.limit ? parseInt(params.limit, 10) : 50;
    const before = params.before ?? undefined;
    const _after = params.after ?? undefined; // Reserved for future use

    const messages = getMessages(channel.id, limit, before);

    return [
      {
        uri: `tabularium://channels/${channelName}/history`,
        mimeType: 'application/json',
        text: JSON.stringify(
          {
            channel: {
              id: channel.id,
              name: channel.name,
              description: channel.description,
            },
            messages: messages.map((m) => ({
              id: m.id,
              sender: m.sender,
              content: m.content,
              created_at: m.created_at,
              metadata: m.metadata,
            })),
            total: messages.length,
            limit,
          },
          null,
          2
        ),
      },
    ];
  } catch {
    return [
      {
        uri: `tabularium://channels/${channelName}/history`,
        mimeType: 'application/json',
        text: JSON.stringify({ error: `Failed to retrieve history for channel: ${channelName}` }),
      },
    ];
  }
}

// ---------------------------------------------------------------------------
// Utility
// ---------------------------------------------------------------------------

/**
 * Parser semplice di query string.
 * Converte "?limit=10&before=msg_123" in { limit: '10', before: 'msg_123' }
 */
function parseQueryString(queryString: string): Record<string, string> {
  const params: Record<string, string> = {};

  if (!queryString) return params;

  // Rimuovi eventuale ? iniziale
  const qs = queryString.startsWith('?') ? queryString.substring(1) : queryString;

  for (const part of qs.split('&')) {
    const [key, value] = part.split('=');
    if (key && value !== undefined) {
      try {
        params[decodeURIComponent(key)] = decodeURIComponent(value);
      } catch {
        params[key] = value;
      }
    }
  }

  return params;
}
