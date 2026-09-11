import {
  GoogleAuthProvider,
  getRedirectResult,
  onAuthStateChanged,
  signInWithRedirect,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { useEffect, useState } from 'react'
import { describeError } from '../errors'
import { auth } from './config'

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    // signInWithPopup relies on sessionStorage being shared between the
    // popup and opener, which mobile Safari partitions away — the
    // primary way students reach this app is scanning a QR code, which
    // opens mobile Safari, so signInWithRedirect is required here, not
    // just a preference. getRedirectResult() picks up the result (or
    // error) once the browser navigates back from Google.
    getRedirectResult(auth).catch((err) => {
      if (!cancelled) setError(describeError(err))
    })

    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      if (cancelled) return
      setUser(nextUser as User | null)
      // A successful sign-in supersedes any error from a previous
      // attempt (including a stale getRedirectResult rejection above).
      if (nextUser) setError(null)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [])

  async function signIn() {
    setError(null)
    try {
      await signInWithRedirect(auth, new GoogleAuthProvider())
    } catch (err) {
      setError(describeError(err))
    }
  }

  async function signOut() {
    setError(null)
    try {
      await firebaseSignOut(auth)
    } catch (err) {
      setError(describeError(err))
    }
  }

  return { user, error, signIn, signOut }
}
