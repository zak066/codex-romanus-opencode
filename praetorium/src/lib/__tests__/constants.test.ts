import { describe, it, expect } from 'vitest'
import { NAV_ITEMS, PRAETORIUM_NAME, PRAETORIUM_DESCRIPTION } from '../constants'

describe('NAV_ITEMS', () => {
  it('è un oggetto con chiavi monitoring e configuration', () => {
    // Assert
    expect(NAV_ITEMS).toHaveProperty('monitoring')
    expect(NAV_ITEMS).toHaveProperty('configuration')
  })

  it('monitoring ha almeno 6 elementi', () => {
    // Assert
    expect(NAV_ITEMS.monitoring.length).toBeGreaterThanOrEqual(6)
  })

  it('configuration ha almeno 5 elementi', () => {
    // Assert
    expect(NAV_ITEMS.configuration.length).toBeGreaterThanOrEqual(5)
  })

  it('ogni item in monitoring ha label, href e icon', () => {
    // Act & Assert
    for (const item of NAV_ITEMS.monitoring) {
      expect(typeof item.label).toBe('string')
      expect(typeof item.href).toBe('string')
      expect(item.href.startsWith('/')).toBe(true)
      expect(typeof item.icon).toBe('string')
    }
  })

  it('ogni item in configuration ha label, href e icon', () => {
    // Act & Assert
    for (const item of NAV_ITEMS.configuration) {
      expect(typeof item.label).toBe('string')
      expect(typeof item.href).toBe('string')
      expect(item.href.startsWith('/')).toBe(true)
      expect(typeof item.icon).toBe('string')
    }
  })

  it('monitoring include voci notevoli', () => {
    // Arrange
    const labels = NAV_ITEMS.monitoring.map((item) => item.label)

    // Assert
    expect(labels).toContain('Agents')
    expect(labels).toContain('Channels')
    expect(labels).toContain('Quality')
  })

  it('configuration include voci notevoli', () => {
    // Arrange
    const labels = NAV_ITEMS.configuration.map((item) => item.label)

    // Assert
    expect(labels).toContain('Models')
    expect(labels).toContain('Settings')
  })
})

describe('PRAETORIUM_NAME', () => {
  it('è la stringa "Praetorium"', () => {
    expect(PRAETORIUM_NAME).toBe('Praetorium')
  })
})

describe('PRAETORIUM_DESCRIPTION', () => {
  it('è una stringa non vuota', () => {
    expect(typeof PRAETORIUM_DESCRIPTION).toBe('string')
    expect(PRAETORIUM_DESCRIPTION.length).toBeGreaterThan(0)
  })
})
