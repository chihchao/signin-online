export function buildCheckinUrl(origin: string, sessionId: string, tokenId: string): string {
  const url = new URL(origin)
  url.searchParams.set('session', sessionId)
  url.searchParams.set('token', tokenId)
  return url.toString()
}
