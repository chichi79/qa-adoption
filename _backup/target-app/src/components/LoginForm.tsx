import React, { useState } from 'react';

export const LoginForm: React.FC = () => {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [message, setMessage] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);
    setMessage('');

    // ⏳ 비동기 API 호출 시뮬레이션 (2초 지연)
    setTimeout(() => {
      setIsLoading(false);
      if (username === 'testuser' && password === 'password123') {
        setMessage('로그인 성공!');
      } else {
        setMessage('아이디 또는 비밀번호가 잘못되었습니다.');
      }
    }, 2000);
  };

  return (
    <div style={{ maxWidth: '300px', margin: '2rem auto', padding: '2rem', border: '1px solid #ccc', borderRadius: '8px' }}>
      <h2>로그인</h2>
      <form onSubmit={handleSubmit}>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="username" style={{ display: 'block', marginBottom: '0.5rem' }}>아이디</label>
          <input
            id="username"
            type="text"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{ width: '100%', padding: '0.5rem' }}
            data-testid="username-input"
          />
        </div>
        <div style={{ marginBottom: '1rem' }}>
          <label htmlFor="password" style={{ display: 'block', marginBottom: '0.5rem' }}>비밀번호</label>
          <input
            id="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{ width: '100%', padding: '0.5rem' }}
            data-testid="password-input"
          />
        </div>
        <button
          type="submit"
          disabled={isLoading}
          style={{
            width: '100%',
            padding: '0.75rem',
            backgroundColor: isLoading ? '#ccc' : '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '4px',
            cursor: isLoading ? 'not-allowed' : 'pointer'
          }}
          data-testid="login-button"
        >
          {isLoading ? '로그인 중...' : '로그인'}
        </button>
      </form>
      {message && <p data-testid="login-message" style={{ marginTop: '1rem', fontWeight: 'bold' }}>{message}</p>}
    </div>
  );
};
