import { describe, it, expect } from 'vitest'
import {
  getAgentColor,
  getAgentEmoji,
  getAgentAccentClass,
  getAgentIcon,
  AGENT_COLORS,
  AGENT_EMOJIS,
  AGENT_IDS,
  SHORT_TO_FULL,
} from '../agent-colors'

describe('getAgentColor', () => {
  it('restituisce il colore corretto per iuppiter-orchestrator', () => {
    // Act & Assert
    expect(getAgentColor('iuppiter-orchestrator')).toBe('#f59e0b')
  })

  it('restituisce il colore corretto per minerva-architect', () => {
    expect(getAgentColor('minerva-architect')).toBe('#60a5fa')
  })

  it('restituisce il colore corretto per vulcanus-senior-dev', () => {
    expect(getAgentColor('vulcanus-senior-dev')).toBe('#f87171')
  })

  it('restituisce il colore default per nome sconosciuto', () => {
    expect(getAgentColor('agente-sconosciuto')).toBe('#6b7280')
  })

  it('supporta il nome breve (short name)', () => {
    expect(getAgentColor('iuppiter')).toBe('#f59e0b')
  })

  it('tutti i colori in AGENT_COLORS sono hex validi', () => {
    // Arrange
    const hexRegex = /^#[0-9a-fA-F]{6}$/

    // Act & Assert
    for (const [agent, color] of Object.entries(AGENT_COLORS)) {
      expect(color).toMatch(hexRegex)
    }
  })
})

describe('getAgentEmoji', () => {
  it('restituisce ⚡ per iuppiter-orchestrator', () => {
    expect(getAgentEmoji('iuppiter-orchestrator')).toBe('⚡')
  })

  it('restituisce 🦉 per minerva-architect', () => {
    expect(getAgentEmoji('minerva-architect')).toBe('🦉')
  })

  it('restituisce 🔥 per vulcanus-senior-dev', () => {
    expect(getAgentEmoji('vulcanus-senior-dev')).toBe('🔥')
  })

  it('restituisce ❓ per nome sconosciuto', () => {
    expect(getAgentEmoji('agente-sconosciuto')).toBe('❓')
  })

  it('supporta il nome breve', () => {
    expect(getAgentEmoji('iuppiter')).toBe('⚡')
  })

  it('tutte le emoji in AGENT_EMOJIS sono stringhe non vuote', () => {
    for (const [agent, emoji] of Object.entries(AGENT_EMOJIS)) {
      expect(typeof emoji).toBe('string')
      expect(emoji.length).toBeGreaterThan(0)
    }
  })
})

describe('getAgentAccentClass', () => {
  it('restituisce una classe Tailwind per iuppiter-orchestrator', () => {
    const result = getAgentAccentClass('iuppiter-orchestrator')
    expect(result).toContain('amber')
  })

  it('restituisce la classe default per nome sconosciuto', () => {
    const result = getAgentAccentClass('agente-sconosciuto')
    expect(result).toBe('border-border-default')
  })

  it('supporta il nome breve', () => {
    const result = getAgentAccentClass('iuppiter')
    expect(result).toContain('amber')
  })
})

describe('getAgentIcon', () => {
  it('restituisce una funzione (componente Lucide) per iuppiter-orchestrator', () => {
    const Icon = getAgentIcon('iuppiter-orchestrator')
    expect(typeof Icon).toBe('object')
  })

  it('restituisce Crown come default per nome sconosciuto', () => {
    const Icon = getAgentIcon('agente-sconosciuto')
    // Crown è il default fallback
    expect(typeof Icon).toBe('object')
  })
})

describe('AGENT_IDS', () => {
  it('contiene tutti e 12 gli agenti', () => {
    expect(AGENT_IDS.length).toBe(12)
  })

  it('contiene iuppiter-orchestrator', () => {
    expect(AGENT_IDS).toContain('iuppiter-orchestrator')
  })

  it('contiene mercurius-junior-dev', () => {
    expect(AGENT_IDS).toContain('mercurius-junior-dev')
  })
})

describe('SHORT_TO_FULL', () => {
  it('mappa iuppiter a iuppiter-orchestrator', () => {
    expect(SHORT_TO_FULL['iuppiter']).toBe('iuppiter-orchestrator')
  })

  it('mappa mercurius a mercurius-junior-dev', () => {
    expect(SHORT_TO_FULL['mercurius']).toBe('mercurius-junior-dev')
  })

  it('ha una entry per ogni agente', () => {
    expect(Object.keys(SHORT_TO_FULL).length).toBe(12)
  })
})
