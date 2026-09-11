import { act, renderHook, waitFor } from '@testing-library/react'
import {
  GoogleAuthProvider,
  getRedirectResult,
  signInWithRedirect,
  signOut as firebaseSignOut,
} from 'firebase/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthUser } from './useAuthUser'

let authStateCallback: ((user: unknown) => void) | undefined

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(),
  signInWithRedirect: vi.fn(),
  getRedirectResult: vi.fn().mockResolvedValue(null),
  signOut: vi.fn(),
  onAuthStateChanged: vi.fn((_auth, callback) => {
    authStateCallback = callback
    return vi.fn()
  }),
}))

vi.mock('./config', () => ({
  auth: {},
}))

describe('useAuthUser', () => {
  beforeEach(() => {
    authStateCallback = undefined
    vi.clearAllMocks()
    vi.mocked(getRedirectResult).mockResolvedValue(null)
  })

  it('starts as logged out with no user', () => {
    const { result } = renderHook(() => useAuthUser())

    expect(result.current.user).toBeNull()
  })

  it('checks for a pending redirect result on mount (mobile browsers cannot use signInWithPopup reliably)', () => {
    renderHook(() => useAuthUser())

    expect(getRedirectResult).toHaveBeenCalled()
  })

  it('reflects the signed-in user once Firebase reports an auth state change', async () => {
    const { result } = renderHook(() => useAuthUser())

    act(() => {
      authStateCallback?.({ email: 'teacher@example.com' })
    })

    await waitFor(() => {
      expect(result.current.user?.email).toBe('teacher@example.com')
    })
  })

  it('signs in with Google via redirect (not a popup) when signIn is called', async () => {
    const { result } = renderHook(() => useAuthUser())

    await act(async () => {
      await result.current.signIn()
    })

    expect(signInWithRedirect).toHaveBeenCalledWith(expect.anything(), expect.any(GoogleAuthProvider))
  })

  it('surfaces an error instead of throwing when signIn fails', async () => {
    vi.mocked(signInWithRedirect).mockRejectedValueOnce(new Error('auth/network-request-failed'))
    const { result } = renderHook(() => useAuthUser())

    await act(async () => {
      await result.current.signIn()
    })

    expect(result.current.error).toBe('auth/network-request-failed')
  })

  it('surfaces an error when a completed redirect sign-in itself failed', async () => {
    vi.mocked(getRedirectResult).mockRejectedValueOnce(new Error('auth/missing-initial-state'))

    const { result } = renderHook(() => useAuthUser())

    await waitFor(() => {
      expect(result.current.error).toBe('auth/missing-initial-state')
    })
  })

  it('clears a stale redirect-result error once an auth state change reports a signed-in user', async () => {
    vi.mocked(getRedirectResult).mockRejectedValueOnce(new Error('auth/missing-initial-state'))
    const { result } = renderHook(() => useAuthUser())

    await waitFor(() => {
      expect(result.current.error).toBe('auth/missing-initial-state')
    })

    act(() => {
      authStateCallback?.({ email: 'teacher@example.com' })
    })

    await waitFor(() => {
      expect(result.current.user?.email).toBe('teacher@example.com')
    })
    expect(result.current.error).toBeNull()
  })

  it('signs out and clears the user when signOut is called', async () => {
    const { result } = renderHook(() => useAuthUser())

    act(() => {
      authStateCallback?.({ email: 'teacher@example.com' })
    })
    await waitFor(() => {
      expect(result.current.user?.email).toBe('teacher@example.com')
    })

    await act(async () => {
      await result.current.signOut()
    })

    expect(firebaseSignOut).toHaveBeenCalled()
  })
})
