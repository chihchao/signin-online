import { describe, expect, it } from 'vitest'
import { buildCheckinUrl } from './checkinUrl'

describe('buildCheckinUrl', () => {
  it('encodes the session and token as query params on the given origin', () => {
    expect(buildCheckinUrl('https://signin-online.web.app', 'session-1', 'token-1')).toBe(
      'https://signin-online.web.app/?session=session-1&token=token-1',
    )
  })

  it('URL-encodes ids that contain special characters', () => {
    expect(buildCheckinUrl('https://signin-online.web.app', 'a b', 'c&d')).toBe(
      'https://signin-online.web.app/?session=a+b&token=c%26d',
    )
  })
})
