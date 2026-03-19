import { describe, it, expect } from 'vitest'
import { getAddress } from 'viem'
import { parseAccountId } from '../server/utils/find-account'

describe('parseAccountId', () => {
  it('parses a valid eip155 account ID', () => {
    const result = parseAccountId(
      'eip155:1:0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
    )
    expect(result.chainId).toBe(1)
    expect(result.address).toBe(
      getAddress('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'),
    )
  })

  it('handles different chain IDs', () => {
    const addr = '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045'
    expect(parseAccountId(`eip155:42161:${addr}`).chainId).toBe(42161)
    expect(parseAccountId(`eip155:137:${addr}`).chainId).toBe(137)
  })

  it('checksums the address', () => {
    const result = parseAccountId(
      'eip155:1:0xd8da6bf26964af9d7eed9e03e53415d37aa96045',
    )
    expect(result.address).toBe('0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045')
  })

  it('throws on invalid address', () => {
    expect(() => parseAccountId('eip155:1:0xinvalid')).toThrow()
  })
})
