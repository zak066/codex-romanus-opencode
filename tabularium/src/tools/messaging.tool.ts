/**
 * tools/messaging.tool.ts
 * Tool MCP per il sistema di Messaging Real-Time (R1).
 * Fornisce 8 tool per comunicazione inter-agente: send, inbox, status,
 * list_agents, channel_create, channel_list, agent_delete_message,
 * channel_delete.
 *
 * @module tools/messaging
 */

import type { ToolHandler, ToolResult } from '../types/mcp.js';
import { createChannel, getChannelByName, listChannels, getChannel, deleteChannel } from '../messaging/db-channels.js';
import { sendMessage, getMessages, getInbox, getMessage, deleteMessage, searchMessages, markMessageRead, markAllDmMessagesRead, getUnreadCount } from '../messaging/db-messages.js';
import { upsertHeartbeat, getHeartbeat, listHeartbeats, getOfflineAgents } from '../messaging/db-heartbeats.js';
import { emit } from '../messaging/event-bus.js';
import { notifyHeartbeatResume } from '../messaging/heartbeat-monitor.js';
import type { MessagingEventType } from '../messaging/event-bus.js';
import { extractMentions } from '../messaging/mentions.js';
import { checkRateLimit } from '../messaging/rate-limiter.js';
import { validateAgentName } from '../messaging/agent-validator.js';

// Tipi di messaggio validi per GAP-06
const VALID_MESSAGE_TYPES = ['text', 'alert', 'report', 'code', 'data'] as const;
type MessageType = (typeof VALID_MESSAGE_TYPES)[number];

// ---------------------------------------------------------------------------
// Tool 1: agent_send
// ---------------------------------------------------------------------------

export const agentSendToolHandler: ToolHandler = {
  name: 'agent_send',
  description: 'Send a message to a channel or DM an agent',
  inputSchema: {
    type: 'object',
    properties: {
      channel: {
        type: 'string',
        description: 'Channel name (e.g. #general) or agent name for DM',
      },
      content: {
        type: 'string',
        description: 'Message content',
      },
      sender: {
        type: 'string',
        description: 'Agent sending the message',
      },
      is_dm: {
        type: 'boolean',
        description: 'If true, send as DM to agent specified in channel',
        default: false,
      },
      type: {
        type: 'string',
        enum: ['text', 'alert', 'report', 'code', 'data'],
        description: 'Message type for structured messages (optional)',
      },
      metadata: {
        type: 'object',
        description: 'Additional structured metadata (optional)',
        additionalProperties: true,
      },
    },
    required: ['channel', 'content', 'sender'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const channel = String(args.channel ?? '');
      const content = String(args.content ?? '');
      const sender = String(args.sender ?? '');
      const isDm = args.is_dm === true || channel.startsWith('@');

      // --- Validazione di base ---
      if (!channel.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'channel is required' }, null, 2) }],
          isError: true,
        };
      }
      if (!content.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'content is required' }, null, 2) }],
          isError: true,
        };
      }
      if (!sender.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'sender is required' }, null, 2) }],
          isError: true,
        };
      }
      const senderErr = validateAgentName(sender);
      if (senderErr) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: senderErr }, null, 2) }],
          isError: true,
        };
      }

      // --- Validazione tipo messaggio (GAP-06) ---
      let msgType: string | undefined;
      if (args.type !== undefined && args.type !== null) {
        msgType = String(args.type);
        if (!VALID_MESSAGE_TYPES.includes(msgType as MessageType)) {
          return {
            content: [{ type: 'text', text: JSON.stringify({
              success: false,
              error: 'VALIDATION_ERROR',
              message: `Invalid message type '${msgType}'. Must be one of: ${VALID_MESSAGE_TYPES.join(', ')}`,
            }, null, 2) }],
            isError: true,
          };
        }
      }

      // --- Rate limiter check (GAP-09) ---
      const rateCheck = checkRateLimit(sender);
      if (!rateCheck.allowed) {
        return {
          content: [{ type: 'text', text: JSON.stringify({
            success: false,
            error: 'RATE_LIMITED',
            message: `Rate limit exceeded. Retry after ${rateCheck.retryAfter} seconds.`,
            retry_after: rateCheck.retryAfter,
          }, null, 2) }],
          isError: true,
        };
      }

      // --- Risoluzione canale/DM ---
      let channelId: string;

      if (isDm) {
        // DM mode: channel param is the agent name
        const agentName = channel.startsWith('@') ? channel.substring(1) : channel;
        const dmChannelName = `dm-${agentName}`;

        // Find or create DM channel
        let dmChannel = getChannelByName(dmChannelName);
        if (!dmChannel) {
          console.error(`[messaging.tool] Creating DM channel '${dmChannelName}' for agent '${agentName}'`);
          dmChannel = createChannel(dmChannelName, `Direct messages for ${agentName}`, 'system');
        }
        channelId = dmChannel.id;
      } else {
        // Channel mode: find channel by name (strip leading # if present)
        const channelName = channel.startsWith('#') ? channel.substring(1) : channel;
        const existingChannel = getChannelByName(channelName);
        if (!existingChannel) {
          return {
            content: [{
              type: 'text',
              text: JSON.stringify({
                success: false,
                error: 'CHANNEL_NOT_FOUND',
                message: `Channel '${channel}' not found. Use channel_list to see available channels.`,
              }, null, 2),
            }],
            isError: true,
          };
        }
        channelId = existingChannel.id;
      }

      // --- Build metadata con type (GAP-06) ---
      const messageMetadata: Record<string, unknown> = {};
      if (msgType) {
        messageMetadata.type = msgType;
      }
      if (args.metadata && typeof args.metadata === 'object' && !Array.isArray(args.metadata)) {
        Object.assign(messageMetadata, args.metadata as Record<string, unknown>);
      }
      // Extract @mentions from content (GAP-05)
      const mentionedAgents = extractMentions(content);
      if (mentionedAgents.length > 0) {
        // Add mentions to metadata
        messageMetadata.mentions = mentionedAgents;

        // Auto-create DM channels for mentioned agents
        for (const mentionedAgent of mentionedAgents) {
          const dmName = `dm-${mentionedAgent}`;
          const existing = getChannelByName(dmName);
          if (!existing) {
            console.error(`[messaging.tool] Auto-creating DM channel for mentioned agent '${mentionedAgent}'`);
            createChannel(dmName, `Direct messages for ${mentionedAgent}`, 'system');
          }
        }
      }

      // Send the message with metadata
      const message = sendMessage(channelId, sender, content, Object.keys(messageMetadata).length > 0 ? messageMetadata : undefined);

      // Emit event via EventBus
      emit({
        type: 'message_sent',
        payload: {
          id: message.id,
          channel_id: message.channel_id,
          channel_name: isDm ? channel : (channel.startsWith('#') ? channel.substring(1) : channel),
          sender: message.sender,
          content: message.content,
          created_at: message.created_at,
          metadata: message.metadata,
        },
        timestamp: message.created_at,
        agent_name: sender,
        channel_id: message.channel_id,
      });

      // Emit mention events for @mentioned agents (GAP-05)
      if (mentionedAgents.length > 0) {
        for (const mentionedAgent of mentionedAgents) {
          emit({
            type: 'mention',
            payload: {
              mentioned_agent: mentionedAgent,
              mentioned_by: sender,
              channel_id: message.channel_id,
              message_id: message.id,
              message_preview: content.substring(0, 100),
            },
            timestamp: message.created_at,
            channel_id: message.channel_id,
            agent_name: mentionedAgent,
          });
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              id: message.id,
              channel_id: message.channel_id,
              sender: message.sender,
              content: message.content,
              created_at: message.created_at,
              metadata: message.metadata,
            },
            pushed_via_sse: true,
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `agent_send failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 2: agent_inbox
// ---------------------------------------------------------------------------

export const agentInboxToolHandler: ToolHandler = {
  name: 'agent_inbox',
  description: 'Read pending messages (DM) for an agent',
  inputSchema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Agent name to read inbox for',
      },
      limit: {
        type: 'number',
        description: 'Max messages (default 20)',
        default: 20,
      },
      before: {
        type: 'string',
        description: 'Cursor for pagination (message ID)',
      },
    },
    required: ['agent'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const agent = String(args.agent ?? '');
      const limit = args.limit ? parseInt(String(args.limit), 10) : 20;

      if (!agent.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'agent is required' }, null, 2) }],
          isError: true,
        };
      }
      const inboxAgentErr = validateAgentName(agent);
      if (inboxAgentErr) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: inboxAgentErr }, null, 2) }],
          isError: true,
        };
      }

      // Use getInbox to fetch DM messages for the agent
      const messages = getInbox(agent, limit);

      // If 'before' is provided, filter in-memory (cursor pagination not yet in DB layer)
      let filteredMessages = messages;
      if (args.before) {
        const beforeId = String(args.before);
        const beforeIndex = filteredMessages.findIndex((m) => m.id === beforeId);
        if (beforeIndex >= 0) {
          filteredMessages = filteredMessages.slice(beforeIndex + 1);
        }
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              agent,
              unread_count: getUnreadCount(agent),
              messages: filteredMessages,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `agent_inbox failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 3: agent_status
// ---------------------------------------------------------------------------

export const agentStatusToolHandler: ToolHandler = {
  name: 'agent_status',
  description: 'Report or read agent heartbeat status',
  inputSchema: {
    type: 'object',
    properties: {
      agent: {
        type: 'string',
        description: 'Agent name',
      },
      status: {
        type: 'string',
        enum: ['idle', 'busy', 'error'],
        description: 'New status (omit to just read)',
      },
      current_task: {
        type: 'string',
        description: 'Current task description',
      },
    },
    required: ['agent'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const agent = String(args.agent ?? '');
      const newStatus = args.status ? String(args.status) : undefined;
      const currentTask = args.current_task ? String(args.current_task) : undefined;

      if (!agent.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'agent is required' }, null, 2) }],
          isError: true,
        };
      }
      const statusAgentErr = validateAgentName(agent);
      if (statusAgentErr) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: statusAgentErr }, null, 2) }],
          isError: true,
        };
      }

      // Get current state before any changes
      const previousHeartbeat = getHeartbeat(agent);

      if (newStatus) {
        // --- UPDATE MODE ---
        // Determine if this is a transition from offline to online
        const wasOffline = previousHeartbeat?.status === 'offline' || !previousHeartbeat;
        const isOnline = newStatus === 'idle' || newStatus === 'busy';

        // Perform the upsert
        upsertHeartbeat(agent, newStatus as 'idle' | 'busy' | 'error', currentTask);

        if (wasOffline && isOnline) {
          // Agent was offline, now online → emit resume event via heartbeat-monitor
          console.error(`[messaging.tool] Agent '${agent}' transitioning from offline to ${newStatus}`);
          notifyHeartbeatResume(agent, newStatus, currentTask);
        } else {
          // Normal status change
          const now = new Date().toISOString();
          emit({
            type: 'agent_status_change',
            payload: {
              agent_name: agent,
              status: newStatus,
              current_task: currentTask ?? null,
              last_seen: now,
            },
            timestamp: now,
            agent_name: agent,
          });
        }

        // --- GAP-03: Auto-create DM channel when agent comes online ---
        if (newStatus === 'idle' || newStatus === 'busy') {
          try {
            const dmName = `dm-${agent}`;
            const existing = getChannelByName(dmName);
            if (!existing) {
              console.error(`[messaging.tool] Auto-creating DM channel '${dmName}' for agent '${agent}'`);
              createChannel(dmName, `Direct messages for ${agent}`, 'system');
            }
          } catch (dmErr) {
            // Idempotent: if creation fails (e.g. race condition), just log
            console.error(`[messaging.tool] Failed to auto-create DM channel for '${agent}':`, dmErr);
          }
        }
      }

      // Read current state
      const heartbeat = getHeartbeat(agent);
      if (!heartbeat) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: {
                agent,
                status: 'offline',
                last_seen: null,
                current_task: null,
                is_online: false,
              },
            }, null, 2),
          }],
        };
      }

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              agent: heartbeat.agent_name,
              status: heartbeat.status,
              last_seen: heartbeat.last_seen,
              current_task: heartbeat.current_task,
              is_online: heartbeat.status !== 'offline',
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `agent_status failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 4: agent_list_agents
// ---------------------------------------------------------------------------

export const agentListAgentsToolHandler: ToolHandler = {
  name: 'agent_list_agents',
  description: 'List all agents with their heartbeat status',
  inputSchema: {
    type: 'object',
    properties: {
      status: {
        type: 'string',
        enum: ['idle', 'busy', 'error', 'offline'],
        description: 'Filter by status',
      },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const filterStatus = args.status ? String(args.status) : undefined;

      let agents;
      if (filterStatus === 'offline') {
        agents = getOfflineAgents();
      } else {
        agents = listHeartbeats();
      }

      // Apply status filter if provided (for non-offline filters)
      let filteredAgents = agents;
      if (filterStatus && filterStatus !== 'offline') {
        filteredAgents = agents.filter((a) => a.status === filterStatus);
      }

      const now = Date.now();
      const result = filteredAgents.map((a) => {
        const secondsSinceHeartbeat = a.last_seen
          ? Math.floor((now - new Date(a.last_seen).getTime()) / 1000)
          : 0;
        return {
          agent_name: a.agent_name,
          status: a.status,
          last_seen: a.last_seen,
          current_task: a.current_task,
          is_online: a.status !== 'offline',
          seconds_since_heartbeat: secondsSinceHeartbeat,
        };
      });

      const online = result.filter((a) => a.is_online).length;
      const offline = result.length - online;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              total: result.length,
              online,
              offline,
              agents: result,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `agent_list_agents failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 5: channel_create
// ---------------------------------------------------------------------------

export const channelCreateToolHandler: ToolHandler = {
  name: 'channel_create',
  description: 'Create a new channel',
  inputSchema: {
    type: 'object',
    properties: {
      name: {
        type: 'string',
        description: 'Channel name (without #, e.g. "design")',
      },
      description: {
        type: 'string',
        description: 'Channel description',
      },
      created_by: {
        type: 'string',
        description: 'Agent creating the channel',
      },
    },
    required: ['name', 'created_by'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const name = String(args.name ?? '').trim();
      const description = String(args.description ?? '');
      const createdBy = String(args.created_by ?? '');

      if (!name) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'name is required' }, null, 2) }],
          isError: true,
        };
      }
      if (!createdBy) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'created_by is required' }, null, 2) }],
          isError: true,
        };
      }
      const createdByErr = validateAgentName(createdBy);
      if (createdByErr) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: createdByErr }, null, 2) }],
          isError: true,
        };
      }

      // Validate channel name: lowercase, no special chars
      if (!/^[a-z][a-z0-9-]{1,49}$/.test(name)) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'VALIDATION_ERROR',
              message: `Channel name must match pattern: ^[a-z][a-z0-9-]{1,49}$ (got '${name}')`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      const channel = createChannel(name, description, createdBy);

      // Emit event
      emit({
        type: 'channel_created',
        payload: {
          id: channel.id,
          name: channel.name,
          description: channel.description,
          created_by: channel.created_by,
          created_at: channel.created_at,
        },
        timestamp: channel.created_at,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              id: channel.id,
              name: channel.name,
              description: channel.description,
              created_by: channel.created_by,
              created_at: channel.created_at,
              is_default: channel.is_default,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      // Map known error codes
      if (errMsg.startsWith('CHANNEL_ALREADY_EXISTS')) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'CHANNEL_ALREADY_EXISTS',
              message: errMsg.replace('CHANNEL_ALREADY_EXISTS: ', ''),
            }, null, 2),
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `channel_create failed: ${errMsg}` }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 6: channel_list
// ---------------------------------------------------------------------------

export const channelListToolHandler: ToolHandler = {
  name: 'channel_list',
  description: 'List all available channels',
  inputSchema: {
    type: 'object',
    properties: {},
  },

  handler: async (_args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const channels = listChannels();

      const defaultCount = channels.filter((c) => c.is_default === 1).length;

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              total: channels.length,
              default_count: defaultCount,
              channels: channels.map((c) => ({
                id: c.id,
                name: c.name,
                description: c.description,
                is_default: c.is_default === 1,
                created_by: c.created_by,
                created_at: c.created_at,
              })),
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `channel_list failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 7: agent_delete_message (GAP-01)
// ---------------------------------------------------------------------------

export const agentDeleteMessageToolHandler: ToolHandler = {
  name: 'agent_delete_message',
  description: 'Delete a message (only by its sender)',
  inputSchema: {
    type: 'object',
    properties: {
      message_id: {
        type: 'string',
        description: 'ID of the message to delete',
      },
      agent: {
        type: 'string',
        description: 'Agent requesting deletion (must be the sender)',
      },
    },
    required: ['message_id', 'agent'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const messageId = String(args.message_id ?? '');
      const agent = String(args.agent ?? '');

      if (!messageId.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'message_id is required' }, null, 2) }],
          isError: true,
        };
      }
      if (!agent.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'agent is required' }, null, 2) }],
          isError: true,
        };
      }
      const deleteAgentErr = validateAgentName(agent);
      if (deleteAgentErr) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: deleteAgentErr }, null, 2) }],
          isError: true,
        };
      }

      // Recupera il messaggio
      const message = getMessage(messageId);
      if (!message) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'MESSAGE_NOT_FOUND',
              message: `Message '${messageId}' not found`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      // Verifica ownership: solo il sender può eliminare
      if (message.sender !== agent) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'FORBIDDEN',
              message: `Agent '${agent}' is not the sender of message '${messageId}'`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      // Elimina il messaggio
      deleteMessage(messageId);

      // Emetti evento message_deleted via EventBus
      emit({
        type: 'message_deleted',
        payload: {
          deleted_id: messageId,
          channel_id: message.channel_id,
          sender: message.sender,
        },
        timestamp: new Date().toISOString(),
        channel_id: message.channel_id,
        agent_name: message.sender,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: { deleted_id: messageId },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{
          type: 'text',
          text: `agent_delete_message failed: ${error instanceof Error ? error.message : String(error)}`,
        }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 8: channel_delete (GAP-08)
// ---------------------------------------------------------------------------

export const channelDeleteToolHandler: ToolHandler = {
  name: 'channel_delete',
  description: 'Delete a channel (only non-default channels)',
  inputSchema: {
    type: 'object',
    properties: {
      channel_id: {
        type: 'string',
        description: 'ID of the channel to delete',
      },
      requested_by: {
        type: 'string',
        description: 'Agent requesting the deletion',
      },
    },
    required: ['channel_id', 'requested_by'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const channelId = String(args.channel_id ?? '');
      const requestedBy = String(args.requested_by ?? '');

      if (!channelId.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'channel_id is required' }, null, 2) }],
          isError: true,
        };
      }
      if (!requestedBy.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'requested_by is required' }, null, 2) }],
          isError: true,
        };
      }

      // Recupera il canale
      const channel = getChannel(channelId);
      if (!channel) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'CHANNEL_NOT_FOUND',
              message: `Channel '${channelId}' not found`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      // Verifica che non sia un canale di default
      if (channel.is_default === 1) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'CANNOT_DELETE_DEFAULT',
              message: `Cannot delete default channel '${channel.name}'`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      // Elimina il canale
      deleteChannel(channelId);

      // Emetti evento
      emit({
        type: 'channel_created',
        payload: {
          action: 'deleted',
          deleted_id: channelId,
          name: channel.name,
          requested_by: requestedBy,
        },
        timestamp: new Date().toISOString(),
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: { deleted_id: channelId },
          }, null, 2),
        }],
      };
    } catch (error) {
      const errMsg = error instanceof Error ? error.message : String(error);
      if (errMsg.includes('Cannot delete a default channel')) {
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: false,
              error: 'CANNOT_DELETE_DEFAULT',
              message: 'Cannot delete a default channel.',
            }, null, 2),
          }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `channel_delete failed: ${errMsg}` }],
        isError: true,
      };
    }
  },
};


// ---------------------------------------------------------------------------
// Tool 9: agent_search_messages (GAP-04 — FTS5 Search)
// ---------------------------------------------------------------------------

export const agentSearchMessagesToolHandler: ToolHandler = {
  name: 'agent_search_messages',
  description: 'Search messages using full-text search (FTS5)',
  inputSchema: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query (FTS5 syntax)' },
      limit: { type: 'number', description: 'Max results (default 20, max 100)', default: 20 },
      channel: { type: 'string', description: 'Filter by channel name (optional)' },
      sender: { type: 'string', description: 'Filter by sender agent name (optional)' },
    },
    required: ['query'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const query = String(args.query ?? '').trim();
      if (!query) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'query is required' }) }],
          isError: true,
        };
      }

      const limit = args.limit ? parseInt(String(args.limit), 10) : 20;

      // Resolve channel filter (name → id)
      let channelId: string | undefined;
      if (args.channel) {
        const channelName = String(args.channel).replace(/^#/, '');
        const channel = getChannelByName(channelName);
        if (!channel) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'CHANNEL_NOT_FOUND', message: `Channel '${args.channel}' not found` }) }],
            isError: true,
          };
        }
        channelId = channel.id;
      }

      const sender = args.sender ? String(args.sender) : undefined;
      if (sender) {
        const searchSenderErr = validateAgentName(sender);
        if (searchSenderErr) {
          return {
            content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: searchSenderErr }, null, 2) }],
            isError: true,
          };
        }
      }

      const results = searchMessages(query, limit, channelId, sender);

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: {
              query,
              total: results.length,
              results,
            },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `agent_search_messages failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
};

// ---------------------------------------------------------------------------
// Tool 10: agent_mark_read (GAP-02 — R2.3 Read/Unread Tracking)
// ---------------------------------------------------------------------------

export const agentMarkReadToolHandler: ToolHandler = {
  name: 'agent_mark_read',
  description: 'Mark a DM message as read',
  inputSchema: {
    type: 'object',
    properties: {
      message_id: {
        type: 'string',
        description: 'ID of the message to mark as read',
      },
      agent: {
        type: 'string',
        description: 'Agent reading the message',
      },
      all: {
        type: 'boolean',
        description: 'If true, marks ALL unread DM messages as read for this agent',
        default: false,
      },
    },
    required: ['agent'],
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const agent = String(args.agent ?? '');
      const messageId = args.message_id ? String(args.message_id) : undefined;
      const markAll = args.all === true;

      if (!agent.trim()) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'agent is required' }) }],
          isError: true,
        };
      }
      const markReadAgentErr = validateAgentName(agent);
      if (markReadAgentErr) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: markReadAgentErr }) }],
          isError: true,
        };
      }

      if (!messageId && !markAll) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'VALIDATION_ERROR', message: 'Either message_id or all=true is required' }) }],
          isError: true,
        };
      }

      if (markAll) {
        const count = markAllDmMessagesRead(agent);
        emit({
          type: 'messages_read',
          payload: { agent, count, all: true },
          timestamp: new Date().toISOString(),
          agent_name: agent,
        });
        return {
          content: [{
            type: 'text',
            text: JSON.stringify({
              success: true,
              data: { marked_read: count, all: true },
            }, null, 2),
          }],
        };
      }

      const result = markMessageRead(messageId!, agent);
      if (!result) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'MESSAGE_NOT_FOUND', message: `Message '${messageId}' not found or cannot be marked as read by '${agent}'` }) }],
          isError: true,
        };
      }

      emit({
        type: 'messages_read',
        payload: { agent, message_id: messageId, all: false },
        timestamp: new Date().toISOString(),
        agent_name: agent,
      });

      return {
        content: [{
          type: 'text',
          text: JSON.stringify({
            success: true,
            data: { marked_read: 1, message_id: messageId },
          }, null, 2),
        }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `agent_mark_read failed: ${error instanceof Error ? error.message : String(error)}` }],
        isError: true,
      };
    }
  },
};


// ---------------------------------------------------------------------------
// Tool 11: agent_event_history (GAP-07 — Event History Query)
// ---------------------------------------------------------------------------

export const agentEventHistoryToolHandler: ToolHandler = {
  name: 'agent_event_history',
  description: 'Query event history from event_log table',
  inputSchema: {
    type: 'object',
    properties: {
      type: { type: 'string', description: 'Filter by event type (optional)' },
      agent_name: { type: 'string', description: 'Filter by agent name (optional)' },
      channel_id: { type: 'string', description: 'Filter by channel ID (optional)' },
      since: { type: 'string', description: 'ISO timestamp lower bound (optional)' },
      until: { type: 'string', description: 'ISO timestamp upper bound (optional)' },
      limit: { type: 'number', description: 'Max results (default 50, max 1000)' },
      offset: { type: 'number', description: 'Offset for pagination (default 0)' },
    },
  },

  handler: async (args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      const limit = Math.min(Math.max(parseInt(String(args.limit ?? '50'), 10) || 50, 1), 1000);
      const offset = Math.max(parseInt(String(args.offset ?? '0'), 10) || 0, 0);

      // Build WHERE clauses dynamically
      const conditions: string[] = [];
      const params: Record<string, unknown> = {};

      if (args.type) { conditions.push('event_type = @type'); params.type = String(args.type); }
      if (args.agent_name) { conditions.push('agent_name = @agent_name'); params.agent_name = String(args.agent_name); }
      if (args.channel_id) { conditions.push('channel_id = @channel_id'); params.channel_id = String(args.channel_id); }
      if (args.since) { conditions.push('event_timestamp >= @since'); params.since = String(args.since); }
      if (args.until) { conditions.push('event_timestamp <= @until'); params.until = String(args.until); }

      const whereClause = conditions.length > 0 ? 'WHERE ' + conditions.join(' AND ') : '';

      const { getDatabase } = await import('../core/database.js');
      const db = getDatabase();

      // Count total
      const countRow = db.prepare(`SELECT COUNT(*) as total FROM event_log ${whereClause}`).get(params) as { total: number };
      const total = countRow?.total ?? 0;

      // Fetch paginated results
      const rows = db.prepare(`
        SELECT id, event_type, payload, channel_id, agent_name, event_timestamp, created_at
        FROM event_log ${whereClause}
        ORDER BY id DESC
        LIMIT @limit OFFSET @offset
      `).all({ ...params, limit, offset }) as Array<{
        id: number; event_type: string; payload: string;
        channel_id: string | null; agent_name: string | null;
        event_timestamp: string; created_at: string;
      }>;

      const events = rows.map(r => ({
        id: r.id,
        event_type: r.event_type,
        payload: JSON.parse(r.payload),
        channel_id: r.channel_id ?? undefined,
        agent_name: r.agent_name ?? undefined,
        event_timestamp: r.event_timestamp,
        created_at: r.created_at,
      }));

      return {
        content: [{ type: 'text', text: JSON.stringify({ success: true, data: { total, events } }, null, 2) }],
      };
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      if (msg.includes('getDatabase') || msg.includes('database') || msg.includes('prepare')) {
        return {
          content: [{ type: 'text', text: JSON.stringify({ success: false, error: 'DB_UNAVAILABLE', message: msg }, null, 2) }],
          isError: true,
        };
      }
      return {
        content: [{ type: 'text', text: `agent_event_history failed: ${msg}` }],
        isError: true,
      };
    }
  },
};
