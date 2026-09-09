import { act, renderHook, waitFor } from '@testing-library/react'
import { GoogleAuthProvider, signInWithPopup, signOut as firebaseSignOut } from 'firebase/auth'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAuthUser } from './useAuthUser'

let authStateCallback: ((user: unknown) => void) | undefined

vi.mock('firebase/auth', () => ({
  GoogleAuthProvider: vi.fn(),
  signInWithPopup: vi.fn(),
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
  })

  it('starts as logged out with no user', () => {
    const { result } = renderHook(() => useAuthUser())

    expect(result.current.user).toBeNull()
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

  it('signs in with Google when signIn is called', async () => {
    const { result } = renderHook(() => useAuthUser())

    await act(async () => {
      await result.current.signIn()
    })

    expect(signInWithPopup).toHaveBeenCalledWith(expect.anything(), expect.any(GoogleAuthProvider))
  })

  it('surfaces an error instead of throwing when signIn fails (e.g. popup closed by the user)', async () => {
    vi.mocked(signInWithPopup).mockRejectedValueOnce(new Error('auth/popup-closed-by-user'))
    const { result } = renderHook(() => useAuthUser())

    await act(async () => {
      await result.current.signIn()
    })

    expect(result.current.error).toBe('auth/popup-closed-by-user')
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
