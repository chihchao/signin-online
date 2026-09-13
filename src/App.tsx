import { useState } from 'react'
import { CheckinView } from './CheckinView'
import { CourseManager } from './CourseManager'
import { useAuthUser } from './firebase/useAuthUser'
import { MyAttendanceView } from './MyAttendanceView'

function readCheckinParams(): { sessionId: string; tokenId: string } | null {
  const params = new URLSearchParams(window.location.search)
  const sessionId = params.get('session')
  const tokenId = params.get('token')
  return sessionId && tokenId ? { sessionId, tokenId } : null
}

function App() {
  const { user, error, signIn, signOut } = useAuthUser()
  const [checkinParams, setCheckinParams] = useState(readCheckinParams)
  const [showMyAttendance, setShowMyAttendance] = useState(false)

  function leaveCheckin() {
    window.history.replaceState(null, '', window.location.pathname)
    setCheckinParams(null)
  }

  return (
    <main className="app-shell">
      <header className="app-header">
        <span className="app-header__brand">課堂簽到系統</span>
        {user && (
          <div className="app-header__right">
            <div className="app-header__account" title={user.displayName ? `${user.displayName} ${user.email}` : user.email ?? undefined}>
              {user.displayName && <strong>{user.displayName}</strong>}
              <span>{user.email}</span>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => signOut()}>
              登出
            </button>
          </div>
        )}
      </header>

      {user ? (
        <>
          {user.email &&
            (checkinParams ? (
              <>
                <CheckinView
                  sessionId={checkinParams.sessionId}
                  tokenId={checkinParams.tokenId}
                  studentEmail={user.email}
                />
                <button type="button" className="btn btn-secondary" onClick={leaveCheckin}>
                  離開簽到頁
                </button>
              </>
            ) : (
              <>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setShowMyAttendance((current) => !current)}
                >
                  {showMyAttendance ? '返回課程管理' : '我的出席紀錄'}
                </button>
                {showMyAttendance ? (
                  <MyAttendanceView studentEmail={user.email} />
                ) : (
                  <CourseManager teacherEmail={user.email} />
                )}
              </>
            ))}
        </>
      ) : (
        <button type="button" className="btn btn-primary" onClick={() => signIn()}>
          使用 Google 登入
        </button>
      )}
      {error && (
        <p role="alert" className="status-message status-message--error">
          登入發生問題，請再試一次。
        </p>
      )}
    </main>
  )
}

export default App
