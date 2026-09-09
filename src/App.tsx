import { CourseManager } from './CourseManager'
import { useAuthUser } from './firebase/useAuthUser'

function App() {
  const { user, error, signIn, signOut } = useAuthUser()

  return (
    <main>
      {user ? (
        <>
          <p>目前登入帳號：{user.email}</p>
          <button type="button" onClick={() => signOut()}>
            登出
          </button>
          {user.email && <CourseManager teacherEmail={user.email} />}
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
