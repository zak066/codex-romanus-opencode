/**
 * Test per messaging/event-bus.ts — EventBus in-memory
 *
 * Copertura:
 * - emit: listener riceve evento, listener filtrato non riceve, listener multipli
 * - subscribe: con filtro channel_id, agent_name, types (singolo e multiplo)
 * - unsubscribe: unsubscribe funziona, unsubscribe doppio non rompe
 * - clear: tutti i listener rimossi, emit dopo clear
 * - listenerCount: incrementa/decrementa
 * - totalEventsEmitted: conteggio corretto
 * - Gestione errori: listener che lancia eccezione non blocca gli altri
 *
 * @module tests/messaging/event-bus
 */

import {
  emit,
  subscribe,
  clear,
  listenerCount,
  totalEventsEmitted,
} from '../../src/messaging/event-bus.js';
import type { MessagingEvent } from '../../src/messaging/event-bus.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Crea un evento base per test.
 */
function makeEvent(overrides: Partial<MessagingEvent> = {}): MessagingEvent {
  return {
    type: 'message_sent',
    payload: { test: true },
    timestamp: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Helper per creare un listener spy.
 */
function createSpyListener(): jest.Mock {
  return jest.fn();
}

// ---------------------------------------------------------------------------
// Setup & Teardown
// ---------------------------------------------------------------------------

beforeEach(() => {
  // Pulisce tutti i listener e resetta il contatore
  clear();
  // Nota: clear() resetta i listener ma non eventCounter.
  // Dobbiamo resettare manualmente eventCounter chiamando emit (non è esposto).
  // In alternativa, accettiamo che il contatore sia cumulativo.
  // La funzione clear stampa "[event-bus] Cleared all listeners (0 remaining)"
  // ma non resetta eventCounter — lo verifichiamo nei test.
});

afterAll(() => {
  clear();
});

// ===========================================================================
// Suite: emit
// ===========================================================================

describe('emit', () => {
  it('chiama il listener registrato', () => {
    const spy = createSpyListener();
    subscribe(spy);

    const event = makeEvent({ type: 'message_sent' });
    emit(event);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith(event);
  });

  it('chiama listener multipli', () => {
    const spy1 = createSpyListener();
    const spy2 = createSpyListener();
    subscribe(spy1);
    subscribe(spy2);

    emit(makeEvent());

    expect(spy1).toHaveBeenCalledTimes(1);
    expect(spy2).toHaveBeenCalledTimes(1);
  });

  it('non chiama listener dopo unsubscribe', () => {
    const spy = createSpyListener();
    const unsub = subscribe(spy);
    unsub();

    emit(makeEvent());

    expect(spy).not.toHaveBeenCalled();
  });

  it('chiama solo listener il cui filtro matcha', () => {
    const spyMatch = createSpyListener();
    const spyNoMatch = createSpyListener();

    subscribe(spyMatch, { channel_id: 'ch_general' });
    subscribe(spyNoMatch, { channel_id: 'ch_arch' });

    emit(makeEvent({ channel_id: 'ch_general' }));

    expect(spyMatch).toHaveBeenCalledTimes(1);
    expect(spyNoMatch).not.toHaveBeenCalled();
  });

  it('passa l\'evento completo al listener', () => {
    const spy = createSpyListener();
    subscribe(spy);

    const event = makeEvent({
      type: 'agent_status_change',
      payload: { agent_name: 'diana', status: 'busy' },
      channel_id: 'ch_general',
      agent_name: 'diana',
    });
    emit(event);

    expect(spy).toHaveBeenCalledWith(event);
  });

  it('incrementa totalEventsEmitted', () => {
    const before = totalEventsEmitted();
    emit(makeEvent());
    emit(makeEvent());
    expect(totalEventsEmitted()).toBe(before + 2);
  });
});

// ===========================================================================
// Suite: subscribe
// ===========================================================================

describe('subscribe', () => {
  it('registra un listener senza filtro (riceve tutti)', () => {
    const spy = createSpyListener();
    subscribe(spy);

    emit(makeEvent({ type: 'message_sent' }));
    emit(makeEvent({ type: 'channel_created' }));

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('filtra per channel_id', () => {
    const spy = createSpyListener();
    subscribe(spy, { channel_id: 'ch_general' });

    emit(makeEvent({ channel_id: 'ch_general' }));
    emit(makeEvent({ channel_id: 'ch_arch' }));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('filtra per agent_name', () => {
    const spy = createSpyListener();
    subscribe(spy, { agent_name: 'vulcanus' });

    emit(makeEvent({ agent_name: 'vulcanus' }));
    emit(makeEvent({ agent_name: 'diana' }));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('filtra per tipo singolo via types', () => {
    const spy = createSpyListener();
    subscribe(spy, { types: ['agent_heartbeat_timeout'] });

    emit(makeEvent({ type: 'agent_heartbeat_timeout' }));
    emit(makeEvent({ type: 'message_sent' }));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('filtra per tipi multipli via types', () => {
    const spy = createSpyListener();
    subscribe(spy, { types: ['message_sent', 'channel_created'] });

    emit(makeEvent({ type: 'message_sent' }));
    emit(makeEvent({ type: 'channel_created' }));
    emit(makeEvent({ type: 'agent_status_change' }));

    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('applica AND logico tra filtri (tutti devono matchare)', () => {
    const spy = createSpyListener();
    subscribe(spy, {
      channel_id: 'ch_general',
      agent_name: 'diana',
      types: ['message_sent'],
    });

    // Matcha tutti i criteri
    emit(makeEvent({
      type: 'message_sent',
      channel_id: 'ch_general',
      agent_name: 'diana',
    }));
    // Non matcha per channel diverso
    emit(makeEvent({
      type: 'message_sent',
      channel_id: 'ch_arch',
      agent_name: 'diana',
    }));
    // Non matcha per tipo diverso
    emit(makeEvent({
      type: 'channel_created',
      channel_id: 'ch_general',
      agent_name: 'diana',
    }));

    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('restituisce una funzione unsubscribe', () => {
    const spy = createSpyListener();
    const unsub = subscribe(spy);
    expect(typeof unsub).toBe('function');
  });
});

// ===========================================================================
// Suite: unsubscribe
// ===========================================================================

describe('unsubscribe', () => {
  it('rimuove il listener (O(1))', () => {
    const spy = createSpyListener();
    const unsub = subscribe(spy);

    emit(makeEvent());
    expect(spy).toHaveBeenCalledTimes(1);

    unsub();
    emit(makeEvent());
    // Non deve essere chiamato di nuovo
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('unsubscribe multiplo non lancia errori', () => {
    const spy = createSpyListener();
    const unsub = subscribe(spy);

    unsub();
    // Chiamare unsubscribe due volte è safe
    expect(() => unsub()).not.toThrow();
  });

  it('unsubscribe non influisce su altri listener', () => {
    const spy1 = createSpyListener();
    const spy2 = createSpyListener();

    const unsub1 = subscribe(spy1);
    subscribe(spy2);

    unsub1();
    emit(makeEvent());

    expect(spy1).not.toHaveBeenCalled();
    expect(spy2).toHaveBeenCalledTimes(1);
  });

  it('unsub dopo clear non lancia errori', () => {
    const spy = createSpyListener();
    const unsub = subscribe(spy);
    clear();
    expect(() => unsub()).not.toThrow();
  });
});

// ===========================================================================
// Suite: clear
// ===========================================================================

describe('clear', () => {
  it('rimuove tutti i listener', () => {
    subscribe(createSpyListener());
    subscribe(createSpyListener());
    subscribe(createSpyListener());

    clear();
    expect(listenerCount()).toBe(0);
  });

  it('emit dopo clear non chiama nessun listener', () => {
    const spy = createSpyListener();
    subscribe(spy);
    clear();

    emit(makeEvent());
    expect(spy).not.toHaveBeenCalled();
  });

  it('è safe chiamare clear su EventBus vuoto', () => {
    clear();
    clear();
    expect(listenerCount()).toBe(0);
  });
});

// ===========================================================================
// Suite: listenerCount
// ===========================================================================

describe('listenerCount', () => {
  it('parte da 0', () => {
    clear();
    expect(listenerCount()).toBe(0);
  });

  it('incrementa con subscribe', () => {
    clear();
    subscribe(createSpyListener());
    expect(listenerCount()).toBe(1);

    subscribe(createSpyListener());
    expect(listenerCount()).toBe(2);
  });

  it('decrementa con unsubscribe', () => {
    clear();
    const unsub = subscribe(createSpyListener());
    subscribe(createSpyListener());
    expect(listenerCount()).toBe(2);

    unsub();
    expect(listenerCount()).toBe(1);
  });

  it('si resetta a 0 con clear', () => {
    subscribe(createSpyListener());
    subscribe(createSpyListener());
    clear();
    expect(listenerCount()).toBe(0);
  });
});

// ===========================================================================
// Suite: totalEventsEmitted
// ===========================================================================

describe('totalEventsEmitted', () => {
  it('parte da 0 e incrementa', () => {
    // Nota: eventCounter è cumulativo in questo modulo.
    // Usiamo i valori relativi.
    const before = totalEventsEmitted();
    emit(makeEvent());
    expect(totalEventsEmitted()).toBe(before + 1);

    emit(makeEvent());
    emit(makeEvent());
    expect(totalEventsEmitted()).toBe(before + 3);
  });

  it('non viene resettato da clear', () => {
    const before = totalEventsEmitted();
    emit(makeEvent());
    clear();
    // clear non resetta il contatore
    expect(totalEventsEmitted()).toBe(before + 1);
  });
});

// ===========================================================================
// Suite: Gestione errori
// ===========================================================================

describe('Gestione errori', () => {
  it('listener che lancia eccezione non blocca altri listener', () => {
    const brokenSpy = jest.fn().mockImplementation(() => {
      throw new Error('Listener error');
    });
    const goodSpy = createSpyListener();

    subscribe(brokenSpy);
    subscribe(goodSpy);

    // Non deve lanciare — l'errore è catturato e loggato su stderr
    expect(() => emit(makeEvent())).not.toThrow();

    // Il listener "buono" deve comunque ricevere l'evento
    expect(goodSpy).toHaveBeenCalledTimes(1);
  });

  it('multiple eccezioni — tutti i listener continuano', () => {
    const spy1 = jest.fn().mockImplementation(() => { throw new Error('Err1'); });
    const spy2 = jest.fn().mockImplementation(() => { throw new Error('Err2'); });
    const spy3 = createSpyListener();

    subscribe(spy1);
    subscribe(spy2);
    subscribe(spy3);

    expect(() => emit(makeEvent())).not.toThrow();
    expect(spy3).toHaveBeenCalledTimes(1);
  });

  it('listener con undefined filter non causa errori', () => {
    const spy = createSpyListener();
    subscribe(spy, undefined);
    expect(() => emit(makeEvent())).not.toThrow();
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('subscribe con filter parziale (solo types vuoto) funziona', () => {
    const spy = createSpyListener();
    subscribe(spy, { types: [] });
    // types Set è vuoto, nessun tipo matcha
    emit(makeEvent({ type: 'message_sent' }));
    expect(spy).not.toHaveBeenCalled();
  });
});
