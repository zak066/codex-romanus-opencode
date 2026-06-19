import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { requireAuth } from '../auth'

describe('requireAuth', () => {
  const ORIGINAL_ENV = process.env

  beforeEach(() => {
    vi.stubEnv('PRAETORIUM_API_KEY', '')
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    process.env = ORIGINAL_ENV
  })

  describe('quando PRAETORIUM_API_KEY NON è impostata (dev mode)', () => {
    it('autorizza la richiesta senza header', () => {
      // Arrange
      const request = new Request('http://localhost/api/test')

      // Act
      const result = requireAuth(request)

      // Assert
      expect(result.authorized).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('autorizza la richiesta anche con header sbagliato', () => {
      // Arrange
      const request = new Request('http://localhost/api/test', {
        headers: { 'X-API-Key': 'chiave-qualsiasi' },
      })

      // Act
      const result = requireAuth(request)

      // Assert
      expect(result.authorized).toBe(true)
      expect(result.error).toBeUndefined()
    })
  })

  describe('quando PRAETORIUM_API_KEY È impostata', () => {
    beforeEach(() => {
      vi.stubEnv('PRAETORIUM_API_KEY', 'secret-key-123')
    })

    it('autorizza con X-API-Key valida', () => {
      // Arrange
      const request = new Request('http://localhost/api/test', {
        headers: { 'X-API-Key': 'secret-key-123' },
      })

      // Act
      const result = requireAuth(request)

      // Assert
      expect(result.authorized).toBe(true)
      expect(result.error).toBeUndefined()
    })

    it('rifiuta senza header X-API-Key', () => {
      // Arrange
      const request = new Request('http://localhost/api/test')

      // Act
      const result = requireAuth(request)

      // Assert
      expect(result.authorized).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.status).toBe(401)
    })

    it('rifiuta con X-API-Key errata', () => {
      // Arrange
      const request = new Request('http://localhost/api/test', {
        headers: { 'X-API-Key': 'wrong-key' },
      })

      // Act
      const result = requireAuth(request)

      // Assert
      expect(result.authorized).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.status).toBe(401)
    })

    it('rifiuta con X-API-Key vuota', () => {
      // Arrange
      const request = new Request('http://localhost/api/test', {
        headers: { 'X-API-Key': '' },
      })

      // Act
      const result = requireAuth(request)

      // Assert
      expect(result.authorized).toBe(false)
      expect(result.error).toBeDefined()
      expect(result.error!.status).toBe(401)
    })
  })
})
