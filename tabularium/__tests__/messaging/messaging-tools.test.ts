/**
 * Test per tools/messaging.tool.ts — Tool MCP per Messaging Real-Time (R1+R2.1).
 *
 * Copertura R1:
 * - agent_send: invio a canale, DM, validazione errori
 * - agent_inbox: lettura DM inbox, messaggi, validazione
 * - agent_status: update e read heartbeat, validazione
 * - agent_list_agents: lista agenti con filtri
 * - channel_create: creazione canale, duplicati, validazione nome
 * - channel_list: lista canali default e creati
 * - heartbeat-monitor: notifyHeartbeatResume
 *
 * Copertura R2.1:
 * - agent_delete_message (GAP-01): cancellazione messaggi (solo sender)
 * - agent_status — DM pre-init (GAP-03): auto-creazione DM channel al primo heartbeat
 * - agent_send — messaggi strutturati (GAP-06): type e metadata
 * - channel_delete (GAP-08): cancellazione canali (solo non-default)
 * - rate-limiter (GAP-09): token bucket 20 msg/min
 *
 * @module tests/messaging/messaging-tools
 */

import { initDatabase, closeDatabase, getDatabase } from '../../src/core/database.js';
import {
  agentSendToolHandler,
  agentInboxToolHandler,
  agentStatusToolHandler,
  agentListAgentsToolHandler,
  channelCreateToolHandler,
  channelListToolHandler,
  agentDeleteMessageToolHandler,
  channelDeleteToolHandler,
  agentMarkReadToolHandler,
  agentSearchMessagesToolHandler,
} from '../../src/tools/messaging.tool.js';
import {
  markMessageRead,
  markAllDmMessagesRead,
  getUnreadCount,
  searchMessages,
} from '../../src/messaging/db-messages.js';
import { notifyHeartbeatResume } from '../../src/messaging/heartbeat-monitor.js';
import {
  checkRateLimit,
  resetRateLimit,
  resetAllRateLimits,
} from '../../src/messaging/rate-limiter.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Estrae il contenuto JSON dal risultato di un tool handler.
 */
function parseResult(result: any): any {
  try {
    return JSON.parse(result.content[0].text);
  } catch {
    return { error: result.content[0].text };
  }
}

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await initDatabase(':memory:');
});

afterAll(() => closeDatabase());

beforeEach(() => {
  const db = getDatabase();
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM channels WHERE is_default = 0');
  db.exec('DELETE FROM agent_heartbeats');
  // Reset rate limit buckets for clean state between tests
  resetAllRateLimits();
});

// ===========================================================================
// agent_send
// ===========================================================================

describe('agent_send', () => {
  test('send to existing channel', async () => {
    const r = await agentSendToolHandler.handler({ channel: 'general', content: 'Hello', sender: 'diana' });
    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.success).toBe(true);
    expect(d.data.sender).toBe('diana');
    expect(d.data.content).toBe('Hello');
    expect(d.data.channel_id).toBeTruthy();
  });

  test('send channel without # prefix', async () => {
    const r = await agentSendToolHandler.handler({ channel: 'general', content: 'test', sender: 'diana' });
    expect(r.isError).toBeFalsy();
  });

  test('channel not found returns error', async () => {
    const r = await agentSendToolHandler.handler({ channel: 'nonexistent', content: 'test', sender: 'diana' });
    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.error).toBe('CHANNEL_NOT_FOUND');
  });

  test('DM mode creates dm channel', async () => {
    const r = await agentSendToolHandler.handler({ channel: '@vulcanus', content: 'DM test', sender: 'diana' });
    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.success).toBe(true);
  });

  test('missing channel returns validation error', async () => {
    const r = await agentSendToolHandler.handler({ content: 'test', sender: 'diana' });
    expect(r.isError).toBe(true);
  });

  test('missing content returns validation error', async () => {
    const r = await agentSendToolHandler.handler({ channel: 'general', sender: 'diana' });
    expect(r.isError).toBe(true);
  });

  test('missing sender returns validation error', async () => {
    const r = await agentSendToolHandler.handler({ channel: 'general', content: 'test' });
    expect(r.isError).toBe(true);
  });

  test('isError false on success', async () => {
    const r = await agentSendToolHandler.handler({ channel: 'general', content: 'ok', sender: 'diana' });
    expect(r.isError).toBeUndefined();
  });
});

// ===========================================================================
// agent_inbox
// ===========================================================================

describe('agent_inbox', () => {
  test('empty inbox returns no messages', async () => {
    const r = await agentInboxToolHandler.handler({ agent: 'diana' });
    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.data.unread_count).toBe(0);
  });

  test('inbox after DM shows messages', async () => {
    await agentSendToolHandler.handler({ channel: '@diana', content: 'Hello DM', sender: 'vulcanus' });
    const r = await agentInboxToolHandler.handler({ agent: 'diana' });
    const d = parseResult(r);
    expect(d.data.unread_count).toBe(1);
    expect(d.data.messages[0].content).toBe('Hello DM');
  });

  test('missing agent returns validation error', async () => {
    const r = await agentInboxToolHandler.handler({});
    expect(r.isError).toBe(true);
  });
});

// ===========================================================================
// agent_status
// ===========================================================================

describe('agent_status', () => {
  test('update to idle', async () => {
    const r = await agentStatusToolHandler.handler({ agent: 'diana', status: 'idle' });
    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.data.status).toBe('idle');
    expect(d.data.is_online).toBe(true);
  });

  test('update with current_task', async () => {
    await agentStatusToolHandler.handler({ agent: 'diana', status: 'busy', current_task: 'testing' });
    const r = await agentStatusToolHandler.handler({ agent: 'diana' });
    const d = parseResult(r);
    expect(d.data.current_task).toBe('testing');
  });

  test('unknown agent returns offline', async () => {
    const r = await agentStatusToolHandler.handler({ agent: 'unknown' });
    const d = parseResult(r);
    expect(d.data.status).toBe('offline');
    expect(d.data.is_online).toBe(false);
  });

  test('missing agent returns error', async () => {
    const r = await agentStatusToolHandler.handler({});
    expect(r.isError).toBe(true);
  });
});

// ===========================================================================
// agent_list_agents
// ===========================================================================

describe('agent_list_agents', () => {
  test('empty list when no heartbeats', async () => {
    const r = await agentListAgentsToolHandler.handler({});
    const d = parseResult(r);
    expect(d.data.total).toBe(0);
    expect(d.data.online).toBe(0);
  });

  test('lists agents after status updates', async () => {
    await agentStatusToolHandler.handler({ agent: 'diana', status: 'idle' });
    await agentStatusToolHandler.handler({ agent: 'vulcanus', status: 'busy' });
    const r = await agentListAgentsToolHandler.handler({});
    const d = parseResult(r);
    expect(d.data.total).toBe(2);
    expect(d.data.online).toBe(2);
  });

  test('filter by status', async () => {
    await agentStatusToolHandler.handler({ agent: 'diana', status: 'idle' });
    await agentStatusToolHandler.handler({ agent: 'vulcanus', status: 'busy' });
    const r = await agentListAgentsToolHandler.handler({ status: 'idle' });
    const d = parseResult(r);
    expect(d.data.total).toBe(1);
  });
});

// ===========================================================================
// channel_create
// ===========================================================================

describe('channel_create', () => {
  test('create valid channel', async () => {
    const r = await channelCreateToolHandler.handler({ name: 'design', description: 'Design discussions', created_by: 'diana' });
    const d = parseResult(r);
    expect(d.data.name).toBe('design');
    expect(d.data.is_default).toBe(0);
  });

  test('duplicate name returns CHANNEL_ALREADY_EXISTS', async () => {
    await channelCreateToolHandler.handler({ name: 'design', created_by: 'diana' });
    const r = await channelCreateToolHandler.handler({ name: 'design', created_by: 'diana' });
    const d = parseResult(r);
    expect(d.error).toBe('CHANNEL_ALREADY_EXISTS');
  });

  test('name with spaces returns validation error', async () => {
    const r = await channelCreateToolHandler.handler({ name: 'my channel', created_by: 'diana' });
    const d = parseResult(r);
    expect(d.error).toBe('VALIDATION_ERROR');
  });

  test('name with uppercase returns validation error', async () => {
    const r = await channelCreateToolHandler.handler({ name: 'Design', created_by: 'diana' });
    const d = parseResult(r);
    expect(d.error).toBe('VALIDATION_ERROR');
  });

  test('empty name returns validation error', async () => {
    const r = await channelCreateToolHandler.handler({ name: '', created_by: 'diana' });
    const d = parseResult(r);
    expect(d.error).toBe('VALIDATION_ERROR');
  });

  test('missing created_by returns error', async () => {
    const r = await channelCreateToolHandler.handler({ name: 'test' });
    const d = parseResult(r);
    expect(d.error).toBe('VALIDATION_ERROR');
  });
});

// ===========================================================================
// channel_list
// ===========================================================================

describe('channel_list', () => {
  test('default channels = 5', async () => {
    const r = await channelListToolHandler.handler({});
    const d = parseResult(r);
    expect(d.data.total).toBe(5);
    expect(d.data.default_count).toBe(5);
  });

  test('after creating a new channel total = 6', async () => {
    await channelCreateToolHandler.handler({ name: 'design', created_by: 'diana' });
    const r = await channelListToolHandler.handler({});
    const d = parseResult(r);
    expect(d.data.total).toBe(6);
  });
});

// ===========================================================================
// agent_delete_message (GAP-01)
// ===========================================================================

describe('agent_delete_message', () => {
  test('delete own message returns success', async () => {
    // Arrange: send a message first to get an ID
    const send = await agentSendToolHandler.handler({ channel: 'general', content: 'delete me', sender: 'diana' });
    const sendData = parseResult(send);
    const messageId = sendData.data.id;

    // Act: delete the message as the sender
    const r = await agentDeleteMessageToolHandler.handler({ message_id: messageId, agent: 'diana' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBeFalsy();
    expect(d.success).toBe(true);
    expect(d.data.deleted_id).toBe(messageId);
  });

  test('delete message of another agent returns FORBIDDEN', async () => {
    // Arrange: send a message as vulcanus
    const send = await agentSendToolHandler.handler({ channel: 'general', content: 'vulcanus message', sender: 'vulcanus' });
    const sendData = parseResult(send);
    const messageId = sendData.data.id;

    // Act: try to delete as diana (not the sender)
    const r = await agentDeleteMessageToolHandler.handler({ message_id: messageId, agent: 'diana' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBe(true);
    expect(d.error).toBe('FORBIDDEN');
    expect(d.message).toContain('not the sender');
  });

  test('delete non-existent message returns MESSAGE_NOT_FOUND', async () => {
    const r = await agentDeleteMessageToolHandler.handler({ message_id: 'fake-id-12345', agent: 'diana' });
    const d = parseResult(r);
    expect(r.isError).toBe(true);
    expect(d.error).toBe('MESSAGE_NOT_FOUND');
  });

  test('missing message_id returns VALIDATION_ERROR', async () => {
    const r = await agentDeleteMessageToolHandler.handler({ agent: 'diana' });
    const d = parseResult(r);
    expect(r.isError).toBe(true);
    expect(d.error).toBe('VALIDATION_ERROR');
    expect(d.message).toContain('message_id');
  });

  test('missing agent returns VALIDATION_ERROR', async () => {
    const r = await agentDeleteMessageToolHandler.handler({ message_id: 'some-id' });
    const d = parseResult(r);
    expect(r.isError).toBe(true);
    expect(d.error).toBe('VALIDATION_ERROR');
    expect(d.message).toContain('agent');
  });
});

// ===========================================================================
// agent_status — DM pre-init (GAP-03)
// ===========================================================================

describe('agent_status — DM pre-init', () => {
  test('first heartbeat idle creates DM channel', async () => {
    // Act: first heartbeat as idle (triggers DM auto-creation)
    await agentStatusToolHandler.handler({ agent: 'iuppiter', status: 'idle' });

    // Assert: check channel_list contains dm-iuppiter
    const list = await channelListToolHandler.handler({});
    const listData = parseResult(list);
    const dmChannel = listData.data.channels.find((c: any) => c.name === 'dm-iuppiter');
    expect(dmChannel).toBeDefined();
    expect(dmChannel.name).toBe('dm-iuppiter');
    expect(dmChannel.is_default).toBe(false);
  });

  test('first heartbeat busy creates DM channel', async () => {
    // Act: first heartbeat as busy (also triggers DM auto-creation)
    await agentStatusToolHandler.handler({ agent: 'minerva', status: 'busy' });

    // Assert
    const list = await channelListToolHandler.handler({});
    const listData = parseResult(list);
    const dmChannel = listData.data.channels.find((c: any) => c.name === 'dm-minerva');
    expect(dmChannel).toBeDefined();
  });

  test('repeated heartbeat is idempotent (DM channel already exists)', async () => {
    // Act: first idle creates DM
    await agentStatusToolHandler.handler({ agent: 'catone', status: 'idle' });
    const list1 = await channelListToolHandler.handler({});
    const listData1 = parseResult(list1);
    const count1 = listData1.data.total;

    // Act: second idle should be idempotent (no new channel created)
    await agentStatusToolHandler.handler({ agent: 'catone', status: 'idle' });
    const list2 = await channelListToolHandler.handler({});
    const listData2 = parseResult(list2);
    const count2 = listData2.data.total;

    // Assert: total count unchanged (no duplicate DM channel)
    expect(count2).toBe(count1);
    const dmChannel = listData2.data.channels.find((c: any) => c.name === 'dm-catone');
    expect(dmChannel).toBeDefined();
  });
});

// ===========================================================================
// agent_send — messaggi strutturati (GAP-06)
// ===========================================================================

describe('agent_send — messaggi strutturati', () => {
  test('send with type=alert sets metadata.type', async () => {
    const r = await agentSendToolHandler.handler({
      channel: 'general',
      content: 'Alert message',
      sender: 'diana',
      type: 'alert',
    });
    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.data.metadata).toBeDefined();
    expect(d.data.metadata.type).toBe('alert');
  });

  test('send with type=report + additional metadata', async () => {
    const r = await agentSendToolHandler.handler({
      channel: 'general',
      content: 'Coverage report',
      sender: 'diana',
      type: 'report',
      metadata: { coverage: 87, branch: 'main' },
    });
    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    expect(d.data.metadata).toBeDefined();
    expect(d.data.metadata.type).toBe('report');
    expect(d.data.metadata.coverage).toBe(87);
    expect(d.data.metadata.branch).toBe('main');
  });

  test('invalid type returns VALIDATION_ERROR', async () => {
    const r = await agentSendToolHandler.handler({
      channel: 'general',
      content: 'bad type',
      sender: 'diana',
      type: 'invalid_type_xyz',
    });
    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.error).toBe('VALIDATION_ERROR');
    expect(d.message).toContain('Invalid message type');
  });

  test('send without type has no metadata.type', async () => {
    const r = await agentSendToolHandler.handler({
      channel: 'general',
      content: 'plain text',
      sender: 'diana',
    });
    expect(r.isError).toBeFalsy();
    const d = parseResult(r);
    // Without type and metadata, metadata should be undefined
    expect(d.data.metadata).toBeUndefined();
  });
});

// ===========================================================================
// channel_delete (GAP-08)
// ===========================================================================

describe('channel_delete', () => {
  test('delete non-default channel returns success', async () => {
    // Arrange: create a custom channel first
    const create = await channelCreateToolHandler.handler({ name: 'my-channel', description: 'test', created_by: 'diana' });
    const createData = parseResult(create);
    const channelId = createData.data.id;

    // Act: delete it
    const r = await channelDeleteToolHandler.handler({ channel_id: channelId, requested_by: 'diana' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBeFalsy();
    expect(d.success).toBe(true);
    expect(d.data.deleted_id).toBe(channelId);
  });

  test('delete default channel returns CANNOT_DELETE_DEFAULT', async () => {
    // Arrange: get the ID of a default channel
    const list = await channelListToolHandler.handler({});
    const listData = parseResult(list);
    const defaultChannel = listData.data.channels.find((c: any) => c.is_default === true);
    expect(defaultChannel).toBeDefined();

    // Act: try to delete it
    const r = await channelDeleteToolHandler.handler({ channel_id: defaultChannel.id, requested_by: 'diana' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBe(true);
    expect(d.error).toBe('CANNOT_DELETE_DEFAULT');
  });

  test('delete non-existent channel returns CHANNEL_NOT_FOUND', async () => {
    const r = await channelDeleteToolHandler.handler({ channel_id: 'nonexistent-channel-id', requested_by: 'diana' });
    const d = parseResult(r);
    expect(r.isError).toBe(true);
    expect(d.error).toBe('CHANNEL_NOT_FOUND');
  });

  test('missing channel_id returns VALIDATION_ERROR', async () => {
    const r = await channelDeleteToolHandler.handler({ requested_by: 'diana' });
    const d = parseResult(r);
    expect(r.isError).toBe(true);
    expect(d.error).toBe('VALIDATION_ERROR');
    expect(d.message).toContain('channel_id');
  });

  test('missing requested_by returns VALIDATION_ERROR', async () => {
    const r = await channelDeleteToolHandler.handler({ channel_id: 'some-id' });
    const d = parseResult(r);
    expect(r.isError).toBe(true);
    expect(d.error).toBe('VALIDATION_ERROR');
    expect(d.message).toContain('requested_by');
  });
});

// ===========================================================================
// rate-limiter (GAP-09)
// ===========================================================================

describe('rate-limiter', () => {
  afterEach(() => {
    resetAllRateLimits();
  });

  test('first check returns allowed', () => {
    const result = checkRateLimit('test-agent');
    expect(result.allowed).toBe(true);
    expect(result.retryAfter).toBeUndefined();
  });

  test('after 20 messages next is rate limited', () => {
    const agent = 'high-volume-agent';
    // Consume all 20 tokens
    for (let i = 0; i < 20; i++) {
      const result = checkRateLimit(agent);
      expect(result.allowed).toBe(true);
    }
    // 21st should be rate limited
    const result = checkRateLimit(agent);
    expect(result.allowed).toBe(false);
    expect(result.retryAfter).toBeGreaterThanOrEqual(1);
  });

  test('after reset, rate limit is cleared', () => {
    const agent = 'reset-agent';
    // Exhaust the tokens
    for (let i = 0; i < 20; i++) {
      checkRateLimit(agent);
    }
    expect(checkRateLimit(agent).allowed).toBe(false);

    // Reset
    resetRateLimit(agent);

    // Now allowed again
    const result = checkRateLimit(agent);
    expect(result.allowed).toBe(true);
  });

  test('agent_send returns RATE_LIMITED after too many messages', async () => {
    const agent = 'spammer';
    // Send 20 messages to exhaust the rate limit
    for (let i = 0; i < 20; i++) {
      const r = await agentSendToolHandler.handler({ channel: 'general', content: `msg ${i}`, sender: agent });
      expect(r.isError).toBeFalsy();
    }

    // The 21st should be rate-limited
    const r = await agentSendToolHandler.handler({ channel: 'general', content: 'too many', sender: agent });
    expect(r.isError).toBe(true);
    const d = parseResult(r);
    expect(d.error).toBe('RATE_LIMITED');
    expect(d.retry_after).toBeGreaterThanOrEqual(1);
  });
});

// ===========================================================================
// heartbeat-monitor
// ===========================================================================

describe('heartbeat-monitor', () => {
  test('notifyHeartbeatResume exists and works', () => {
    expect(() => notifyHeartbeatResume('diana', 'idle', 'testing')).not.toThrow();
  });
});

// ===========================================================================
// agent_mark_read (GAP-02 — R2.3 Read/Unread Tracking)
// ===========================================================================

describe('agent_mark_read', () => {
  test('markMessageRead() sets read_at on a DM message', async () => {
    // Arrange: send a DM to diana
    const send = await agentSendToolHandler.handler({ channel: '@diana', content: 'Secret DM', sender: 'vulcanus' });
    const sendData = parseResult(send);
    const messageId = sendData.data.id;

    // The message should have no read_at initially
    expect(sendData.data.read_at).toBeUndefined();

    // Act: mark it as read
    const result = markMessageRead(messageId, 'diana');

    // Assert
    expect(result).toBe(true);
  });

  test('markAllDmMessagesRead() marks all unread DM messages', async () => {
    // Arrange: send two DMs to diana
    await agentSendToolHandler.handler({ channel: '@diana', content: 'DM one', sender: 'vulcanus' });
    await agentSendToolHandler.handler({ channel: '@diana', content: 'DM two', sender: 'vulcanus' });
    expect(getUnreadCount('diana')).toBe(2);

    // Act: mark all as read
    const count = markAllDmMessagesRead('diana');

    // Assert
    expect(count).toBe(2);
    expect(getUnreadCount('diana')).toBe(0);
  });

  test('getUnreadCount() returns correct unread count', async () => {
    // Arrange: initially 0
    expect(getUnreadCount('diana')).toBe(0);

    // Act: send a DM
    await agentSendToolHandler.handler({ channel: '@diana', content: 'New DM', sender: 'vulcanus' });

    // Assert: unread count is 1
    expect(getUnreadCount('diana')).toBe(1);
  });

  test('tool handler marks a single message as read', async () => {
    // Arrange: send a DM to diana
    const send = await agentSendToolHandler.handler({ channel: '@diana', content: 'Read me', sender: 'vulcanus' });
    const sendData = parseResult(send);
    const messageId = sendData.data.id;

    // Act: call the tool handler
    const r = await agentMarkReadToolHandler.handler({ message_id: messageId, agent: 'diana' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBeFalsy();
    expect(d.success).toBe(true);
    expect(d.data.marked_read).toBe(1);
    expect(d.data.message_id).toBe(messageId);
  });

  test('already read message is a no-op (returns true)', async () => {
    // Arrange: send a DM and mark it read
    const send = await agentSendToolHandler.handler({ channel: '@diana', content: 'Already read', sender: 'vulcanus' });
    const sendData = parseResult(send);
    const messageId = sendData.data.id;
    markMessageRead(messageId, 'diana');

    // Act: mark it read again
    const result = markMessageRead(messageId, 'diana');

    // Assert: still true (just updates read_at timestamp)
    expect(result).toBe(true);
  });

  test('non-existent message returns MESSAGE_NOT_FOUND', async () => {
    // Act: try to mark a nonexistent message
    const r = await agentMarkReadToolHandler.handler({ message_id: 'msg_nonexistent_123', agent: 'diana' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBe(true);
    expect(d.error).toBe('MESSAGE_NOT_FOUND');
  });

  test('missing agent returns VALIDATION_ERROR', async () => {
    // Act: call without agent
    const r = await agentMarkReadToolHandler.handler({ message_id: 'msg_some_id' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBe(true);
    expect(d.error).toBe('VALIDATION_ERROR');
  });

  test('missing message_id and all=false returns VALIDATION_ERROR', async () => {
    // Act: call with only agent, no message_id and no all=true
    const r = await agentMarkReadToolHandler.handler({ agent: 'diana' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBe(true);
    expect(d.error).toBe('VALIDATION_ERROR');
    expect(d.message).toContain('Either message_id or all=true');
  });

  test('markAll via tool handler works', async () => {
    // Arrange: send multiple DMs
    await agentSendToolHandler.handler({ channel: '@diana', content: 'Batch 1', sender: 'vulcanus' });
    await agentSendToolHandler.handler({ channel: '@diana', content: 'Batch 2', sender: 'vulcanus' });

    // Act: use the tool handler with all=true
    const r = await agentMarkReadToolHandler.handler({ agent: 'diana', all: true });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBeFalsy();
    expect(d.success).toBe(true);
    expect(d.data.marked_read).toBe(2);
    expect(d.data.all).toBe(true);
    expect(getUnreadCount('diana')).toBe(0);
  });
});

// ===========================================================================
// agent_search_messages (GAP-04 — FTS5 Search)
// ===========================================================================

describe('agent_search_messages', () => {
  test('searchMessages() finds messages by text content', async () => {
    // Arrange: send a message with distinctive content
    await agentSendToolHandler.handler({ channel: 'general', content: 'The quick brown fox jumps', sender: 'diana' });

    // Act: search for it
    const results = searchMessages('quick brown fox');

    // Assert
    expect(results.length).toBeGreaterThanOrEqual(1);
    expect(results[0].content).toContain('quick brown fox');
    expect(results[0].sender).toBe('diana');
    expect(results[0].channel_name).toBe('general');
  });

  test('tool handler returns search results', async () => {
    // Arrange: send a message
    await agentSendToolHandler.handler({ channel: 'general', content: 'UniqueSearchTermXYZ', sender: 'diana' });

    // Act: call the tool handler
    const r = await agentSearchMessagesToolHandler.handler({ query: 'UniqueSearchTermXYZ' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBeFalsy();
    expect(d.success).toBe(true);
    expect(d.data.total).toBeGreaterThanOrEqual(1);
    expect(d.data.results[0].content).toContain('UniqueSearchTermXYZ');
  });

  test('filter by channel name', async () => {
    // Arrange: send to general
    await agentSendToolHandler.handler({ channel: 'general', content: 'Channel specific message', sender: 'diana' });

    // Act: search with channel filter
    const r = await agentSearchMessagesToolHandler.handler({ query: 'Channel specific', channel: 'general' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBeFalsy();
    expect(d.data.total).toBeGreaterThanOrEqual(1);
    expect(d.data.results[0].channel_name).toBe('general');
  });

  test('filter by sender', async () => {
    // Arrange: send messages from different senders
    await agentSendToolHandler.handler({ channel: 'general', content: 'Message from diana', sender: 'diana' });
    await agentSendToolHandler.handler({ channel: 'general', content: 'Message from vulcanus', sender: 'vulcanus' });

    // Act: search filtered by sender
    const r = await agentSearchMessagesToolHandler.handler({ query: 'Message from', sender: 'vulcanus' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBeFalsy();
    expect(d.data.total).toBeGreaterThanOrEqual(1);
    for (const msg of d.data.results) {
      expect(msg.sender).toBe('vulcanus');
    }
  });

  test('limit parameter restricts results', async () => {
    // Arrange: send multiple matching messages
    await agentSendToolHandler.handler({ channel: 'general', content: 'Limit test msg', sender: 'diana' });
    await agentSendToolHandler.handler({ channel: 'general', content: 'Limit test msg', sender: 'vulcanus' });

    // Act: search with limit=1
    const r = await agentSearchMessagesToolHandler.handler({ query: 'Limit test', limit: 1 });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBeFalsy();
    expect(d.data.results.length).toBeLessThanOrEqual(1);
  });

  test('query with no match returns empty array', async () => {
    // Act: search for something that doesn't exist
    const r = await agentSearchMessagesToolHandler.handler({ query: 'zzzzzzzzzzzzzzzznonexistent' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBeFalsy();
    expect(d.data.total).toBe(0);
    expect(d.data.results).toEqual([]);
  });

  test('empty query returns VALIDATION_ERROR', async () => {
    // Act: call with empty query
    const r = await agentSearchMessagesToolHandler.handler({ query: '' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBe(true);
    expect(d.error).toBe('VALIDATION_ERROR');
    expect(d.message).toContain('query is required');
  });

  test('non-existent channel returns CHANNEL_NOT_FOUND', async () => {
    // Act: search with a non-existent channel filter
    const r = await agentSearchMessagesToolHandler.handler({ query: 'test', channel: 'nonexistent-channel' });
    const d = parseResult(r);

    // Assert
    expect(r.isError).toBe(true);
    expect(d.error).toBe('CHANNEL_NOT_FOUND');
  });

  test('query with special FTS5 characters does not crash', async () => {
    // Act: search with special FTS5 wildcard (not a VALIDATION_ERROR but a tool error)
    const r = await agentSearchMessagesToolHandler.handler({ query: '*' });
    const d = parseResult(r);

    // Assert: should not crash — may return FTS error but not throw
    expect(r.isError).toBe(true);
    expect(d.error || '').toBeTruthy();
  });
});
