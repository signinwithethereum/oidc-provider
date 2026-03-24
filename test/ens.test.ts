import { describe, it, expect, vi, beforeEach, afterAll } from 'vitest'

vi.useFakeTimers()

// Mock viem before importing the module under test
const mockGetEnsName = vi.fn()
const mockGetEnsAvatar = vi.fn()

vi.mock('viem', async (importOriginal) => {
  const actual = await importOriginal<typeof import('viem')>()
  return {
    ...actual,
    createPublicClient: () => ({
      getEnsName: mockGetEnsName,
      getEnsAvatar: mockGetEnsAvatar,
    }),
  }
})

const { resolveEnsName, resolveEnsAvatar, clearEnsCache } = await import(
  '../server/utils/ens'
)

afterAll(() => {
  vi.useRealTimers()
})

describe('resolveEnsName', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEnsCache()
  })

  it('returns ENS name when found', async () => {
    mockGetEnsName.mockResolvedValue('vitalik.eth')

    const result = await resolveEnsName('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    expect(result).toBe('vitalik.eth')
    expect(mockGetEnsName).toHaveBeenCalledWith({
      address: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    })
  })

  it('returns null when no ENS name exists', async () => {
    mockGetEnsName.mockResolvedValue(null)

    const result = await resolveEnsName('0x0000000000000000000000000000000000000001')
    expect(result).toBeNull()
  })

  it('returns null and logs on error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetEnsName.mockRejectedValue(new Error('RPC timeout'))

    const result = await resolveEnsName('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to resolve ENS name:',
      expect.any(Error),
    )

    consoleSpy.mockRestore()
  })

  it('returns cached result on second call', async () => {
    mockGetEnsName.mockResolvedValue('vitalik.eth')

    const addr = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    await resolveEnsName(addr)
    const result = await resolveEnsName(addr)

    expect(result).toBe('vitalik.eth')
    expect(mockGetEnsName).toHaveBeenCalledTimes(1)
  })

  it('re-fetches after cache expires', async () => {
    mockGetEnsName.mockResolvedValue('vitalik.eth')

    const addr = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    await resolveEnsName(addr)

    // Advance time past the 5-minute TTL
    vi.advanceTimersByTime(5 * 60 * 1000 + 1)

    mockGetEnsName.mockResolvedValue('newname.eth')
    const result = await resolveEnsName(addr)

    expect(result).toBe('newname.eth')
    expect(mockGetEnsName).toHaveBeenCalledTimes(2)
  })
})

describe('resolveEnsAvatar', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    clearEnsCache()
  })

  it('returns avatar URL when found', async () => {
    mockGetEnsAvatar.mockResolvedValue('https://example.com/avatar.png')

    const result = await resolveEnsAvatar('vitalik.eth')
    expect(result).toBe('https://example.com/avatar.png')
  })

  it('returns null when no avatar exists', async () => {
    mockGetEnsAvatar.mockResolvedValue(null)

    const result = await resolveEnsAvatar('noavatar.eth')
    expect(result).toBeNull()
  })

  it('returns null and logs on error', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
    mockGetEnsAvatar.mockRejectedValue(new Error('RPC timeout'))

    const result = await resolveEnsAvatar('vitalik.eth')
    expect(result).toBeNull()
    expect(consoleSpy).toHaveBeenCalledWith(
      'Failed to resolve ENS avatar:',
      expect.any(Error),
    )

    consoleSpy.mockRestore()
  })

  it('returns cached result on second call', async () => {
    mockGetEnsAvatar.mockResolvedValue('https://example.com/avatar.png')

    await resolveEnsAvatar('vitalik.eth')
    const result = await resolveEnsAvatar('vitalik.eth')

    expect(result).toBe('https://example.com/avatar.png')
    expect(mockGetEnsAvatar).toHaveBeenCalledTimes(1)
  })
})
