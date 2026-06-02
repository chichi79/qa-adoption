import './App.css'
import { LoginForm } from './components/LoginForm'

function App() {
  return (
    <>
      <div className="App">
        <h1>QA 자동화 테스트 (POC)</h1>
        <p>아래 로그인 폼을 통해 자동화 테스트를 검증합니다.</p>

        {/* 테스트 대상 컴포넌트 */}
        <LoginForm />

        <div style={{ marginTop: '2rem', fontSize: '0.8rem', color: '#666' }}>
          <p>테스트 계정: testuser / password123</p>
        </div>
      </div>
    </>
  )
}

export default App
