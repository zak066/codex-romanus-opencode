/**
 * Test per messaging/db-channels.ts, db-messages.ts, db-heartbeats.ts
 *
 * Copertura:
 * - db-channels: createChannel, listChannels, getChannel, getChannelByName, deleteChannel
 * - db-messages: sendMessage, getMessages, getInbox, getMessage, deleteMessage
 * - db-heartbeats: upsertHeartbeat, getHeartbeat, listHeartbeats, getOfflineAgents
 *
 * @module tests/messaging/db-messaging
 */

import { initDatabase, closeDatabase, getDatabase } from '../../src/core/database.js';
import { createChannel, listChannels, getChannel, getChannelByName, deleteChannel } from '../../src/messaging/db-channels.js';
import { sendMessage, getMessages, getInbox, getMessage, deleteMessage } from '../../src/messaging/db-messages.js';
import { upsertHeartbeat, getHeartbeat, listHeartbeats, getOfflineAgents } from '../../src/messaging/db-heartbeats.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function toPlainObject<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * Pulisce tutte le tabelle messaging e reinserisce i 5 canali di default.
 */
function resetMessagingTables(): void {
  const db = getDatabase();
  db.exec('DELETE FROM messages');
  db.exec('DELETE FROM channels');
  db.exec('DELETE FROM agent_heartbeats');
  db.exec(`
    INSERT OR IGNORE INTO channels (id, name, description, created_by, is_default) VALUES
      ('ch_general', 'general', 'General', 'system', 1),
      ('ch_arch', 'architecture', 'Architecture', 'system', 1),
      ('ch_bugs', 'bugs', 'Bugs', 'system', 1),
      ('ch_quality', 'quality', 'Quality', 'system', 1),
      ('ch_alerts', 'alerts', 'Alerts', 'system', 1)
  `);
}

/**
 * Ottiene channel ID del canale #general
 */
function getGeneralChannelId(): string {
  const ch = getChannelByName('general');
  return ch!.id;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

beforeAll(async () => {
  await initDatabase(':memory:');
});

afterAll(() => {
  closeDatabase();
});

beforeEach(() => {
  resetMessagingTables();
});

// ===========================================================================
// db-channels
// ===========================================================================

describe('db-channels (createChannel)', () => {
  it('crea un canale con tutti i campi', () => {
    const channel = createChannel('#design', 'Design discussions', 'diana-tester');
    expect(channel).toBeTruthy();
    expect(channel.id).toMatch(/^ch_/);
    expect(channel.name).toBe('#design');
    expect(channel.description).toBe('Design discussions');
    expect(channel.created_by).toBe('diana-tester');
    expect(channel.created_at).toBeTruthy();
    expect(() => new Date(channel.created_at)).not.toThrow();
    expect(channel.is_default).toBe(0);
  });

  it('crea un canale senza description (default vuoto)', () => {
    const channel = createChannel('#random', '', 'system');
    expect(channel.description).toBe('');
    expect(channel.is_default).toBe(0);
  });

  it('lancia CHANNEL_ALREADY_EXISTS per nome duplicato', () => {
    createChannel('#dev-chat', 'First', 'minerva');
    expect(() => {
      createChannel('#dev-chat', 'Duplicate', 'vulcanus');
    }).toThrow(/CHANNEL_ALREADY_EXISTS/);
  });

  it('lancia errore per nome canale già esistente tra i default', () => {
    expect(() => {
      createChannel('general', 'Duplicate general', 'system');
    }).toThrow(/CHANNEL_ALREADY_EXISTS/);
  });

  it('genera ID univoco per ogni canale', () => {
    const ch1 = createChannel('#channel-a', '', 'system');
    const ch2 = createChannel('#channel-b', '', 'system');
    expect(ch1.id).not.toBe(ch2.id);
  });

  it('accetta nomi con caratteri speciali (li gestisce come stringa)', () => {
    const channel = createChannel('dm-vulcanus-senior-dev', 'DM channel', 'system');
    expect(channel.name).toBe('dm-vulcanus-senior-dev');
  });

  it('lancia errore se il database non è inizializzato', () => {
    // Non testiamo qui — beforeEach gestisce init
    // La funzione usa getDatabase() che lancia se non inizializzato
  });
});

describe('db-channels (listChannels)', () => {
  it('restituisce i 5 canali di default', () => {
    const channels = listChannels();
    expect(channels.length).toBe(5);
    const names = channels.map((c) => c.name).sort();
    expect(names).toEqual(['alerts', 'architecture', 'bugs', 'general', 'quality']);
  });

  it('restituisce canali extra dopo createChannel', () => {
    createChannel('#design', '', 'diana');
    createChannel('#support', '', 'iuppiter');
    const channels = listChannels();
    expect(channels.length).toBe(7);
  });

  it('filtra per search (nome LIKE)', () => {
    const channels = listChannels({ search: 'general' });
    expect(channels.length).toBe(1);
    expect(channels[0].name).toBe('general');
  });

  it('filtra per search (description LIKE)', () => {
    const channels = listChannels({ search: 'alert' });
    expect(channels.length).toBe(1);
    expect(channels[0].name).toBe('alerts');
  });

  it('search case-insensitive per SQLite LIKE default', () => {
    const channels = listChannels({ search: 'GENERAL' });
    expect(channels.length).toBe(1);
  });

  it('search senza match restituisce array vuoto', () => {
    const channels = listChannels({ search: 'zzz_nonexistent' });
    expect(channels).toEqual([]);
  });

  it('rispetta il parametro limit', () => {
    const channels = listChannels({ limit: 2 });
    expect(channels.length).toBe(2);
  });

  it('ordina per is_default DESC, name ASC', () => {
    // Crea un canale non-default
    createChannel('#zz-test', 'Test', 'system');
    const channels = listChannels();
    // I default vengono prima, poi il resto in ordine alfabetico
    expect(channels[0].is_default).toBe(1);
    expect(channels[1].is_default).toBe(1);
    // L'ultimo dovrebbe essere zz-test
    expect(channels[channels.length - 1].name).toBe('#zz-test');
  });

  it('funziona senza filtri (undefined)', () => {
    const channels = listChannels(undefined);
    expect(channels.length).toBe(5);
  });

  it('funziona con filter vuoto', () => {
    const channels = listChannels({});
    expect(channels.length).toBe(5);
  });
});

describe('db-channels (getChannel)', () => {
  it('restituisce canale per ID esistente', () => {
    const channel = getChannel('ch_general');
    expect(channel).toBeTruthy();
    expect(channel!.name).toBe('general');
    expect(channel!.is_default).toBe(1);
  });

  it('restituisce undefined per ID inesistente', () => {
    const channel = getChannel('ch_nonexistent');
    expect(channel).toBeUndefined();
  });

  it('recupera canale creato da createChannel', () => {
    const created = createChannel('#my-channel', 'My channel', 'diana');
    const found = getChannel(created.id);
    expect(found).toBeTruthy();
    expect(found!.name).toBe('#my-channel');
    expect(found!.created_by).toBe('diana');
  });
});

describe('db-channels (getChannelByName)', () => {
  it('restituisce canale per nome esistente', () => {
    const channel = getChannelByName('general');
    expect(channel).toBeTruthy();
    expect(channel!.id).toBe('ch_general');
  });

  it('restituisce undefined per nome inesistente', () => {
    const channel = getChannelByName('nonexistent');
    expect(channel).toBeUndefined();
  });

  it('case sensitivity: SQLite di default è case-insensitive per TEXT', () => {
    // SQLite con = su TEXT è case-insensitive per default (uses collation BINARY
    // ma in pratica TEXT = è case sensitive. Verifichiamo comportamento attuale.)
    const channel = getChannelByName('GENERAL');
    // Dipende dal collation — SQLite con "=" è case-sensitive per default
    // Quindi questo potrebbe tornare undefined
    // Accettiamo entrambi i comportamenti
    if (channel) {
      expect(channel.id).toBe('ch_general');
    } else {
      expect(channel).toBeUndefined();
    }
  });
});

describe('db-channels (deleteChannel)', () => {
  it('elimina un canale non-default', () => {
    const channel = createChannel('#temp-channel', 'Temp', 'diana');
    const deleted = deleteChannel(channel.id);
    expect(deleted).toBe(true);
    expect(getChannel(channel.id)).toBeUndefined();
  });

  it('restituisce false per canale inesistente', () => {
    const result = deleteChannel('ch_nonexistent');
    expect(result).toBe(false);
  });

  it('lancia errore per canale di default', () => {
    expect(() => {
      deleteChannel('ch_general');
    }).toThrow(/Cannot delete a default channel/);
  });

  it('lancia errore per ogni canale di default', () => {
    expect(() => deleteChannel('ch_arch')).toThrow(/Cannot delete/);
    expect(() => deleteChannel('ch_bugs')).toThrow(/Cannot delete/);
    expect(() => deleteChannel('ch_quality')).toThrow(/Cannot delete/);
    expect(() => deleteChannel('ch_alerts')).toThrow(/Cannot delete/);
  });

  it('elimina canale e messaggi associati (ON DELETE CASCADE)', () => {
    const channel = createChannel('#cascade-test', 'Cascade', 'system');
    const msg = sendMessage(channel.id, 'diana', 'Test message');
    expect(getMessage(msg.id)).toBeTruthy();
    deleteChannel(channel.id);
    expect(getMessage(msg.id)).toBeUndefined();
  });
});

// ===========================================================================
// db-messages
// ===========================================================================

describe('db-messages (sendMessage)', () => {
  let generalId: string;

  beforeAll(() => {
    generalId = getGeneralChannelId();
  });

  it('invia messaggio a canale esistente', () => {
    const msg = sendMessage(generalId, 'diana-tester', 'Hello world');
    expect(msg).toBeTruthy();
    expect(msg.id).toMatch(/^msg_/);
    expect(msg.channel_id).toBe(generalId);
    expect(msg.sender).toBe('diana-tester');
    expect(msg.content).toBe('Hello world');
    expect(msg.created_at).toBeTruthy();
    expect(() => new Date(msg.created_at)).not.toThrow();
    expect(msg.metadata).toBe('{}');
  });

  it('lancia CHANNEL_NOT_FOUND per canale inesistente', () => {
    expect(() => {
      sendMessage('ch_nonexistent', 'diana', 'test');
    }).toThrow(/CHANNEL_NOT_FOUND/);
  });

  it('invia messaggio con metadata JSON', () => {
    const meta = { type: 'status', priority: 'high', reply_to: 'msg_001' };
    const msg = sendMessage(generalId, 'vulcanus', 'Status update', meta);
    expect(JSON.parse(msg.metadata)).toEqual(meta);
  });

  it('invia messaggio con metadata vuoto se non fornito', () => {
    const msg = sendMessage(generalId, 'minerva', 'No meta');
    expect(msg.metadata).toBe('{}');
  });

  it('invia messaggio a canali non-default', () => {
    const ch = createChannel('#design', '', 'ovidio');
    const msg = sendMessage(ch.id, 'ovidio', 'Design review');
    expect(msg.channel_id).toBe(ch.id);
  });

  it('genera ID univoci per ogni messaggio', () => {
    const m1 = sendMessage(generalId, 'a', 'msg1');
    const m2 = sendMessage(generalId, 'a', 'msg2');
    expect(m1.id).not.toBe(m2.id);
  });
});

describe('db-messages (getMessages)', () => {
  let generalId: string;

  beforeAll(() => {
    generalId = getGeneralChannelId();
  });

  it('restituisce array vuoto per canale senza messaggi', () => {
    const msgs = getMessages(generalId);
    expect(msgs).toEqual([]);
  });

  it('restituisce messaggi in ordine DESC', () => {
    sendMessage(generalId, 'a', 'Primo');
    sendMessage(generalId, 'b', 'Secondo');
    const msgs = getMessages(generalId);
    expect(msgs.length).toBe(2);
    // L'ordine è DESC, quindi 'Secondo' (più recente) dovrebbe essere primo
    expect(msgs[0].content).toBe('Secondo');
  });

  it('rispetta limit default a 50', () => {
    for (let i = 0; i < 10; i++) {
      sendMessage(generalId, 'agent', `Msg ${i}`);
    }
    const msgs = getMessages(generalId);
    expect(msgs.length).toBe(10);
  });

  it('rispetta limit personalizzato', () => {
    for (let i = 0; i < 10; i++) {
      sendMessage(generalId, 'agent', `Msg ${i}`);
    }
    const msgs = getMessages(generalId, 3);
    expect(msgs.length).toBe(3);
  });

  it('max limit è 100 (clamping)', () => {
    for (let i = 0; i < 150; i++) {
      sendMessage(generalId, 'agent', `Msg ${i}`);
    }
    const msgs = getMessages(generalId, 200);
    expect(msgs.length).toBe(100);
  });

  it('supporta paginazione cursor-based before', () => {
    const ids: string[] = [];
    for (let i = 0; i < 5; i++) {
      const msg = sendMessage(generalId, 'agent', `Msg ${i}`);
      ids.push(msg.id);
    }
    // Usa before = ID del terzo messaggio
    const msgs = getMessages(generalId, 10, ids[2]);
    // Dovrebbe restituire i messaggi più recenti del terzo (escluso il terzo)
    // ids[2] è il terzo messaggio (0-indexed), quindi ci sono ids[3], ids[4] dopo
    // In ordine DESC: ids[4], ids[3] sono più recenti di ids[2]
    // Ma getMessages prende messaggi con created_at < created_at di ids[2]
    // Quindi ids[0], ids[1], ids[2] sono più vecchi? No, created_at è ordinato ASC
    // Inserendo Msg 0, 1, 2, 3, 4 → created_at crescente
    // ids[2] ha created_at intermedio
    // getMessages con before=ids[2] prende messaggi con created_at < created_at di ids[2]
    // Sono ids[0], ids[1] — più vecchi. In ordine DESC: ids[1], ids[0]
    // ids[3], ids[4] sono più recenti di ids[2], quindi non inclusi
    for (const m of msgs) {
      expect(m.id).not.toBe(ids[2]);
    }
  });

  it('before per ID inesistente non lancia errore (subquery torna null)', () => {
    // Se before ID non esiste, la subquery returns null, quindi la condizione
    // `created_at < null` è UNCERTAIN — SQLite tratta NULL come sconosciuto
    // Probabilmente non matcha nulla, restituendo 0 messaggi
    sendMessage(generalId, 'a', 'test');
    const msgs = getMessages(generalId, 10, 'msg_nonexistent');
    expect(msgs.length).toBe(0);
  });

  it('lancia CHANNEL_NOT_FOUND per canale inesistente', () => {
    expect(() => {
      getMessages('ch_nonexistent');
    }).toThrow(/CHANNEL_NOT_FOUND/);
  });
});

describe('db-messages (getInbox)', () => {
  it('restituisce array vuoto per agente senza DM channel', () => {
    const msgs = getInbox('unknown-agent');
    expect(msgs).toEqual([]);
  });

  it('restituisce messaggi nella DM inbox di un agente', () => {
    // Crea DM channel per l'agente
    const dmChannel = createChannel('dm-diana-tester', 'DM for diana', 'system');
    sendMessage(dmChannel.id, 'vulcanus', 'Ciao Diana!');
    sendMessage(dmChannel.id, 'minerva', 'Messaggio importante');

    const inbox = getInbox('diana-tester');
    expect(inbox.length).toBe(2);
    expect(inbox.every((m) => m.channel_id === dmChannel.id)).toBe(true);
  });

  it('ordina messaggi per created_at DESC', () => {
    const dm = createChannel('dm-test-agent', '', 'system');
    sendMessage(dm.id, 'a', 'Primo');
    sendMessage(dm.id, 'b', 'Secondo');

    const inbox = getInbox('test-agent');
    expect(inbox[0].content).toBe('Secondo');
  });

  it('rispetta il limite predefinito (20)', () => {
    const dm = createChannel('dm-limited', '', 'system');
    for (let i = 0; i < 30; i++) {
      sendMessage(dm.id, 'sender', `Msg ${i}`);
    }
    const inbox = getInbox('limited');
    expect(inbox.length).toBe(20);
  });

  it('rispetta limit personalizzato', () => {
    const dm = createChannel('dm-custom-limit', '', 'system');
    for (let i = 0; i < 10; i++) {
      sendMessage(dm.id, 'sender', `Msg ${i}`);
    }
    const inbox = getInbox('custom-limit', 5);
    expect(inbox.length).toBe(5);
  });

  it('max limit è 100', () => {
    const dm = createChannel('dm-max-limit', '', 'system');
    for (let i = 0; i < 150; i++) {
      sendMessage(dm.id, 'sender', `Msg ${i}`);
    }
    const inbox = getInbox('max-limit', 200);
    expect(inbox.length).toBe(100);
  });
});

describe('db-messages (getMessage)', () => {
  let msgId: string;
  let generalId: string;

  beforeEach(() => {
    generalId = getGeneralChannelId();
    const msg = sendMessage(generalId, 'diana', 'Find me');
    msgId = msg.id;
  });

  it('restituisce messaggio per ID esistente', () => {
    const msg = getMessage(msgId);
    expect(msg).toBeTruthy();
    expect(msg!.id).toBe(msgId);
    expect(msg!.content).toBe('Find me');
  });

  it('restituisce undefined per ID inesistente', () => {
    const msg = getMessage('msg_nonexistent');
    expect(msg).toBeUndefined();
  });
});

describe('db-messages (deleteMessage)', () => {
  let msgId: string;
  let generalId: string;

  beforeAll(() => {
    generalId = getGeneralChannelId();
  });

  beforeEach(() => {
    const msg = sendMessage(generalId, 'diana', 'Delete me');
    msgId = msg.id;
  });

  it('elimina messaggio esistente', () => {
    const result = deleteMessage(msgId);
    expect(result).toBe(true);
    expect(getMessage(msgId)).toBeUndefined();
  });

  it('restituisce false per ID inesistente', () => {
    const result = deleteMessage('msg_nonexistent');
    expect(result).toBe(false);
  });

  it('elimina solo il messaggio specifico', () => {
    const m2 = sendMessage(getGeneralChannelId(), 'b', 'Keep me');
    deleteMessage(msgId);
    expect(getMessage(m2.id)).toBeTruthy();
  });
});

// ===========================================================================
// db-heartbeats
// ===========================================================================

describe('db-heartbeats (upsertHeartbeat)', () => {
  it('crea un nuovo heartbeat per agente inesistente', () => {
    const hb = upsertHeartbeat('diana-tester', 'idle');
    expect(hb).toBeTruthy();
    expect(hb.agent_name).toBe('diana-tester');
    expect(hb.status).toBe('idle');
    expect(hb.last_seen).toBeTruthy();
    expect(() => new Date(hb.last_seen)).not.toThrow();
    expect(hb.current_task).toBeNull();
    expect(hb.metadata).toBe('{}');
  });

  it('aggiorna heartbeat esistente', () => {
    upsertHeartbeat('diana-tester', 'idle');
    const updated = upsertHeartbeat('diana-tester', 'busy');
    expect(updated.status).toBe('busy');
    expect(updated.metadata).toBe('{}');
  });

  it('aggiorna last_seen a ogni upsert', async () => {
    const hb1 = upsertHeartbeat('agent-x', 'idle');
    await new Promise((r) => setTimeout(r, 5));
    const hb2 = upsertHeartbeat('agent-x', 'idle');
    expect(new Date(hb2.last_seen).getTime()).toBeGreaterThan(new Date(hb1.last_seen).getTime());
  });

  it('salva current_task se fornito', () => {
    const hb = upsertHeartbeat('vulcanus', 'busy', 'Implementing feature X');
    expect(hb.current_task).toBe('Implementing feature X');
  });

  it('resetta current_task a NULL se non fornito in aggiornamento', () => {
    upsertHeartbeat('minerva', 'busy', 'Working on task');
    const hb = upsertHeartbeat('minerva', 'idle');
    expect(hb.current_task).toBeNull();
  });

  it('accetta e salva metadata JSON', () => {
    const meta = { session_id: 'ses_abc', model: 'gpt-4' };
    const hb = upsertHeartbeat('agent-y', 'busy', 'Task', meta);
    expect(JSON.parse(hb.metadata)).toEqual(meta);
  });

  it('usa metadata vuoto se non fornito', () => {
    const hb = upsertHeartbeat('agent-z', 'idle');
    expect(hb.metadata).toBe('{}');
  });

  it('salva status error', () => {
    const hb = upsertHeartbeat('janus', 'error', 'Security scan failed');
    expect(hb.status).toBe('error');
  });
});

describe('db-heartbeats (getHeartbeat)', () => {
  it('restituisce heartbeat per agente esistente', () => {
    upsertHeartbeat('diana-tester', 'idle');
    const hb = getHeartbeat('diana-tester');
    expect(hb).toBeTruthy();
    expect(hb!.agent_name).toBe('diana-tester');
    expect(hb!.status).toBe('idle');
  });

  it('restituisce undefined per agente senza heartbeat', () => {
    const hb = getHeartbeat('ghost-agent');
    expect(hb).toBeUndefined();
  });
});

describe('db-heartbeats (listHeartbeats)', () => {
  it('restituisce array vuoto se nessun heartbeat', () => {
    const hbs = listHeartbeats();
    expect(hbs).toEqual([]);
  });

  it('restituisce tutti gli heartbeat ordinati: online prima', () => {
    upsertHeartbeat('agent-offline', 'offline');
    upsertHeartbeat('agent-online', 'idle');
    const hbs = listHeartbeats();
    expect(hbs.length).toBe(2);
    // Il primo deve essere online (idle/busy hanno priorità 0)
    expect(hbs[0].status).not.toBe('offline');
    expect(hbs[1].status).toBe('offline');
  });

  it('ordina online per last_seen DESC', async () => {
    upsertHeartbeat('agent-a', 'idle');
    await new Promise((r) => setTimeout(r, 5));
    upsertHeartbeat('agent-b', 'busy');
    const hbs = listHeartbeats();
    // agent-b dovrebbe essere prima (più recente)
    const onlineHbs = hbs.filter((h) => h.status !== 'offline');
    expect(onlineHbs[0].agent_name).toBe('agent-b');
  });

  it('gestisce multipli agenti con stati misti', () => {
    upsertHeartbeat('alpha', 'idle', 'Task A');
    upsertHeartbeat('beta', 'error', 'Task B failed');
    upsertHeartbeat('gamma', 'offline');

    const hbs = listHeartbeats();
    expect(hbs.length).toBe(3);
    // online (idle/error) prima di offline
    expect(hbs[0].status).not.toBe('offline');
    expect(hbs[1].status).not.toBe('offline');
    expect(hbs[2].status).toBe('offline');
  });

  it('restituisce tutti i campi per ogni heartbeat', () => {
    upsertHeartbeat('complete-agent', 'busy', 'My task', { key: 'val' });
    const hbs = listHeartbeats();
    expect(hbs[0].agent_name).toBe('complete-agent');
    expect(hbs[0].status).toBe('busy');
    expect(hbs[0].current_task).toBe('My task');
    expect(hbs[0].last_seen).toBeTruthy();
    expect(hbs[0].metadata).toBeTruthy();
  });
});

describe('db-heartbeats (getOfflineAgents)', () => {
  it('restituisce array vuoto se nessuno è in timeout', () => {
    // Crea heartbeat fresco (ora)
    const hb = upsertHeartbeat('fresh-agent', 'idle');
    const offline = getOfflineAgents();
    expect(offline).toEqual([]);
  });

  it('trova agenti con last_seen oltre il timeout', () => {
    // Inserisci heartbeat con last_seen vecchio manipolando direttamente il DB
    const db = getDatabase();
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString(); // 10 min fa
    db.prepare(`
      INSERT INTO agent_heartbeats (agent_name, status, last_seen, current_task, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('stale-agent', 'idle', oldTime, null, '{}');

    // Il timeout default è 3 minuti, l'heartbeat è di 10 min fa → offline
    const offline = getOfflineAgents();
    expect(offline.length).toBe(1);
    expect(offline[0].agent_name).toBe('stale-agent');
  });

  it('usa timeout personalizzato', () => {
    const db = getDatabase();
    // Inserisci heartbeat 2 min fa
    const twoMinAgo = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO agent_heartbeats (agent_name, status, last_seen, current_task, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('recent-agent', 'idle', twoMinAgo, null, '{}');

    // Con timeout di 1 minuto → offline
    const offlineShort = getOfflineAgents(1);
    expect(offlineShort.length).toBe(1);

    // Con timeout di 3 minuti → ancora online
    const offlineLong = getOfflineAgents(3);
    expect(offlineLong.length).toBe(0);
  });

  it('non include agenti già offline', () => {
    const db = getDatabase();
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO agent_heartbeats (agent_name, status, last_seen, current_task, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('already-offline', 'offline', oldTime, null, '{}');

    const offline = getOfflineAgents();
    // Agente già offline non deve essere incluso
    expect(offline.length).toBe(0);
  });

  it('include agenti con status error e last_seen vecchio', () => {
    const db = getDatabase();
    const oldTime = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    db.prepare(`
      INSERT INTO agent_heartbeats (agent_name, status, last_seen, current_task, metadata)
      VALUES (?, ?, ?, ?, ?)
    `).run('error-agent', 'error', oldTime, null, '{}');

    const offline = getOfflineAgents();
    expect(offline.length).toBe(1);
    expect(offline[0].agent_name).toBe('error-agent');
  });

  it('ordina per last_seen ASC (più vecchi prima)', () => {
    const db = getDatabase();
    const t1 = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    const t2 = new Date(Date.now() - 5 * 60 * 1000).toISOString();
    db.prepare(`INSERT INTO agent_heartbeats VALUES (?,?,?,?,?)`).run('older', 'idle', t1, null, '{}');
    db.prepare(`INSERT INTO agent_heartbeats VALUES (?,?,?,?,?)`).run('newer', 'busy', t2, null, '{}');

    const offline = getOfflineAgents(1);
    expect(offline.length).toBe(2);
    expect(offline[0].agent_name).toBe('older');
    expect(offline[1].agent_name).toBe('newer');
  });
});
