import { useState } from 'react'
import { CheckinView } from './CheckinView'
import { CourseManager } from './CourseManager'
import { useAuthUser } from './firebase/useAuthUser'

function readCheckinParams(): { sessionId: string; tokenId: string } | null {
  const params = new URLSearchParams(window.location.search)
  const sessionId = params.get('session')
  const tokenId = params.get('token')
  return sessionId && tokenId ? { sessionId, tokenId } : null
}

function App() {
  const { user, error, signIn, signOut } = useAuthUser()
  const [checkinParams, setCheckinParams] = useState(readCheckinParams)

  function leaveCheckin() {
    window.history.replaceState(null, '', window.location.pathname)
    setCheckinParams(null)
  }

  return (
    <main>
      {user ? (
        <>
          <p>目前登入帳號：{user.email}</p>
          <button type="button" onClick={() => signOut()}>
            登出
          </button>
          {user.email &&
            (checkinParams ? (
              <>
                <CheckinView
                  sessionId={checkinParams.sessionId}
                  tokenId={checkinParams.tokenId}
                  studentEmail={user.email}
                />
                <button type="button" onClick={leaveCheckin}>
                  離開簽到頁
                </button>
              </>
            ) : (
              <CourseManager teacherEmail={user.email} />
            ))}
        </>
      ) : (
        <button type="button" onClick={() => signIn()}>
          使用 Google 登入
        </button>
      )}
      {error && <p role="alert">登入發生問題，請再試一次。</p>}
    </main>
  )
}

export default App
