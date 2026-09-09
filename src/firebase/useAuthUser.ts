import {
  GoogleAuthProvider,
  onAuthStateChanged,
  signInWithPopup,
  signOut as firebaseSignOut,
  type User,
} from 'firebase/auth'
import { useEffect, useState } from 'react'
import { auth } from './config'

export function useAuthUser() {
  const [user, setUser] = useState<User | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser as User | null)
    })
  }, [])

  async function signIn() {
    setError(null)
    try {
      await signInWithPopup(auth, new GoogleAuthProvider())
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  async function signOut() {
    setError(null)
    try {
      await firebaseSignOut(auth)
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err))
    }
  }

  return { user, error, signIn, signOut }
}
