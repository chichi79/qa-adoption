/**
 * 테스트 케이스 생성: 자연어/기획서 텍스트 → Playwright 스텝 배열
 * 스텝 형식: { action: 'goto'|'screenshot'|'click'|'fill'|'wait', ... }
 */

/**
 * 자연어 문장에서 동작 키워드 추출 후 스텝으로 변환
 * @param {string} text - 사용자 입력 (여러 줄 가능)
 * @param {string} [baseURL] - 기본 URL (goto용)
 * @returns {Array<object>} steps
 */
function generateFromNaturalLanguage(text, baseURL = '') {
  const steps = [];
  const lines = text
    .split(/\n|\.|;/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const line of lines) {
    const lower = line.toLowerCase();

    // 0. DSL 스타일 우선 처리
    // 예)
    //   입력: 아이디=testuser, 비밀번호=password123
    //   클릭: [로그인]
    //   화면캡처: 로그인 성공 화면
    const inputDslMatch = line.match(/^입력\s*:\s*(.+)$/i);
    if (inputDslMatch) {
      const pairs = inputDslMatch[1]
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean);
      for (const pair of pairs) {
        const kv = pair.match(/(.+?)\s*=\s*(.+)/);
        if (!kv) continue;
        const fieldLabel = kv[1].trim();
        const value = kv[2].trim();
        const fieldKey = toTestId(fieldLabel, true);
        const selector = buildSelectorForField(fieldKey);
        steps.push({
          action: 'fill',
          selector,
          value,
          description: `${fieldLabel} 입력: ${value}`,
        });
      }
      if (pairs.length > 0) continue;
    }

    const clickDslMatch = line.match(/^클릭\s*:\s*(.+)$/i);
    if (clickDslMatch) {
      let name = clickDslMatch[1].trim();
      const bracket = name.match(/^\[([^\]]+)\]$/);
      if (bracket) {
        name = bracket[1].trim();
      }
      if (name) {
        steps.push({
          action: 'click',
          text: name,
          description: `${name} 클릭`,
        });
        continue;
      }
    }

    const shotDslMatch =
      line.match(/^화면\s*캡처\s*:\s*(.+)$/i) ||
      line.match(/^(스크린샷|캡처)\s*:\s*(.+)$/i);
    if (shotDslMatch) {
      const label = (shotDslMatch[2] || shotDslMatch[1] || '').trim();
      const name = label ? label.replace(/\s+/g, '-').slice(0, 30) : 'capture';
      steps.push({
        action: 'screenshot',
        name,
        description: label || '화면 캡처',
      });
      continue;
    }

    // 특화: 로그인 문장 한 줄에 아이디/비밀번호/입력/로그인 버튼이 함께 있는 경우
    // 예) "로그인 폼에서 아이디 testuser, 비밀번호 123 입력 후 로그인 버튼 클릭"
    const hasInputVerb = /(입력)/.test(line);
    const usernameMatchInline = line.match(/아이디\s*([^\s,]+)/);
    const passwordMatchInline = line.match(/비밀번호\s*([^\s,]+)/);
    if (hasInputVerb && usernameMatchInline && passwordMatchInline) {
      const usernameValue = usernameMatchInline[1].trim();
      const passwordValue = passwordMatchInline[1].trim();
      const formIdMatch = line.match(/id=["']([^"']+)["']/i);
      const scope = formIdMatch ? `#${formIdMatch[1].trim()}` : '';
      const usernameSelectorInline = scopeSelectors(buildSelectorForField('username-input'), scope);
      const passwordSelectorInline = scopeSelectors(buildSelectorForField('password-input'), scope);
      steps.push({
        action: 'fill',
        selector: usernameSelectorInline,
        value: usernameValue,
        description: `아이디 입력: ${usernameValue}`,
      });
      steps.push({
        action: 'fill',
        selector: passwordSelectorInline,
        value: passwordValue,
        description: `비밀번호 입력: ${passwordValue}`,
      });
      if (/로그인/.test(line)) {
        steps.push({ action: 'click', text: '로그인', description: '로그인 버튼 클릭' });
      }
      continue;
    }

    // 이동: "~페이지 이동", "~로 가서", "접속", "열기"
    if (
      /(페이지\s*이동|로\s*가서|접속|열기|이동|가기|진입)/.test(line) ||
      /(go to|navigate|open|visit)/i.test(line)
    ) {
      const pathMatch = line.match(/(\/[\w\-/]*)/);
      const path = pathMatch ? pathMatch[1] : '';
      steps.push({ action: 'goto', url: baseURL ? baseURL.replace(/\/$/, '') + path : path || baseURL });
      continue;
    }

    // 입력: "아이디 입력", "비밀번호에 xxx 입력", "username: test"
    const fillMatch =
      line.match(/(아이디|id|username|이메일|email|비밀번호|password|패스워드)\s*(?:에|을|를)?\s*(?:입력|입력해|쓰기)?\s*(?:한다|할 때)?\s*[:\s]*([^\s,]+)?/i) ||
      line.match(/(.+?)\s*(?:에|을|를)\s*(.+?)\s*(?:입력|입력해)/);
    if (fillMatch) {
      const field = (fillMatch[1] || '').trim();
      const value = (fillMatch[2] || '').trim() || '(값 입력)';
      const fieldKey = toTestId(field, true);
      const selector = buildSelectorForField(fieldKey);
      steps.push({ action: 'fill', selector, value, description: `${field} 입력: ${value}` });
      continue;
    }

    // 클릭: "로그인 버튼 클릭", "제출 클릭", "확인 버튼 누르기"
    // 대괄호로 버튼명이 명시된 경우 우선 사용 (예: "[보내기] 클릭")
    const bracketClickMatch = line.match(/\[([^\]]+)\]\s*(?:버튼)?\s*(?:을|를)?\s*(?:클릭|누르기|선택)/);
    let clickMatch = null;
    let clickName = '';
    if (bracketClickMatch) {
      clickName = bracketClickMatch[1].trim();
    } else {
      clickMatch =
        line.match(/(로그인|제출|확인|취소|검색|등록|저장|다음|이전|메뉴|닫기)\s*(?:버튼)?\s*(?:을|를)?\s*(?:클릭|누르기|선택)/i) ||
        line.match(/(.+?)\s*(?:버튼|링크)?\s*(?:을|를)?\s*(?:클릭|누르기|선택)/);
      if (clickMatch) {
        clickName = (clickMatch[1] || line).trim();
      }
    }
    if (clickName) {
      // 버튼/링크는 화면에 보이는 텍스트 기반으로 찾는다.
      steps.push({ action: 'click', text: clickName, description: `${clickName} 클릭` });
      continue;
    }
    // "버튼 동작/오류/체크" 형태 (클릭 단어 없이 버튼 동작을 확인하는 문장)
    if (/버튼/.test(line) && /(동작|오류|체크|확인)/.test(line)) {
      const beforeBtn = line.split('버튼')[0] || line;
      const names = beforeBtn
        .split(/[,，]|그리고|및|와|과/)
        .map((s) => s.trim())
        .filter(Boolean);
      if (names.length > 0) {
        for (const name of names) {
          // 버튼 동작 확인도 텍스트 기반으로 클릭
          steps.push({ action: 'click', text: name, description: `${name} 버튼 동작 확인` });
        }
        continue;
      }
    }

    // 스크린샷: "화면 캡처", "스크린샷"
    if (/(스크린샷|캡처|스냅샷|확인\s*화면)/.test(line) || /screenshot|capture/i.test(line)) {
      const name = line.replace(/\s+/g, '-').slice(0, 30) || 'capture';
      steps.push({ action: 'screenshot', name, description: line });
      continue;
    }

    // 대기: "1초 대기", "2초 기다리기"
    const waitMatch = line.match(/(\d+)\s*(초|초간)?\s*(?:대기|기다리기|wait)/) || line.match(/wait\s*(\d+)/i);
    if (waitMatch) {
      const sec = Math.min(parseInt(waitMatch[1], 10) || 1, 30);
      steps.push({ action: 'wait', timeout: sec * 1000, description: `${sec}초 대기` });
      continue;
    }
  }

  // 한 줄만 있거나 매칭이 거의 없으면 기본 시나리오 생성
  if (steps.length === 0 && text.trim()) {
    // 최소한 페이지 이동 + 결과 화면 캡처
    steps.push({ action: 'goto', url: baseURL || '', description: '페이지 이동' });
    if (/로그인|login/i.test(text)) {
      const usernameSelector = buildSelectorForField('username-input');
      const passwordSelector = buildSelectorForField('password-input');
      steps.push({ action: 'fill', selector: usernameSelector, value: '(아이디)', description: '아이디 입력' });
      steps.push({ action: 'fill', selector: passwordSelector, value: '(비밀번호)', description: '비밀번호 입력' });
      steps.push({ action: 'click', text: '로그인', description: '로그인 버튼 클릭' });
    }
    steps.push({ action: 'screenshot', name: 'result', description: '결과 화면' });
    return steps;
  }

  // 일부 스텝이라도 있으면, goto/스크린샷이 없을 때 보강
  if (steps.length > 0) {
    if (baseURL && !steps.some((s) => s.action === 'goto')) {
      steps.unshift({ action: 'goto', url: baseURL, description: '페이지 이동' });
    }
    if (!steps.some((s) => s.action === 'screenshot')) {
      steps.push({ action: 'screenshot', name: 'result', description: '결과 화면' });
    }
  }

  return steps;
}

/**
 * 기획서/문서 텍스트에서 번호·불릿 목록 파싱 후 스텝 변환
 * @param {string} content - 파일 내용 (TXT/MD)
 * @param {string} [baseURL]
 * @returns {Array<object>} steps
 */
function generateFromSpecContent(content, baseURL = '') {
  const lines = content
    .split(/\r?\n/)
    .map((s) => s.replace(/^[\s\-*#\d.)]+/, '').trim())
    .filter((s) => s.length > 2);

  const steps = [];
  for (const line of lines) {
    const fromNatural = generateFromNaturalLanguage(line, baseURL);
    if (fromNatural.length > 0) {
      steps.push(...fromNatural);
    } else {
      // 매칭 안 되면 설명만 있는 goto + 스크린샷으로 처리
      steps.push({ action: 'goto', url: baseURL, description: line });
      steps.push({ action: 'screenshot', name: line.slice(0, 20).replace(/\s+/g, '-'), description: line });
    }
  }

  if (steps.length === 0) {
    steps.push({ action: 'goto', url: baseURL });
    steps.push({ action: 'screenshot', name: 'spec-page' });
  }
  return steps;
}

/**
 * 자연어 여러 개를 구분자로 나눈 뒤 각각 TC로 생성해 하나의 스텝 배열로 합침
 * 구분자: --- (앞뒤로 줄바꿈 또는 공백 있으면 시나리오 구분)
 * @param {string} text - 사용자 입력 (시나리오마다 --- 로 구분)
 * @param {string} [baseURL]
 * @returns {Array<object>} steps (각 시나리오 스텝 + 시나리오 사이에 goto 로 초기화)
 */
function generateFromNaturalLanguageMulti(text, baseURL = '') {
  const raw = text.trim();
  if (!raw) return [];

  // --- 앞뒤로 줄바꿈/공백이 하나라도 있으면 구분 (Windows \r\n 포함)
  const segments = raw
    .split(/\s*[\r\n]+\s*---+\s*[\r\n]+\s*|\s+---+\s+/)
    .map((s) => s.trim())
    .filter(Boolean);

  const allSteps = [];
  for (let i = 0; i < segments.length; i++) {
    if (i > 0 && baseURL) {
      allSteps.push({ action: 'goto', url: baseURL, description: '다음 시나리오 시작' });
    }
    const steps = generateFromNaturalLanguage(segments[i], baseURL);
    allSteps.push(...steps);
  }
  return allSteps;
}

function toTestId(name, forInput = false) {
  const map = {
    아이디: forInput ? 'username-input' : 'username',
    id: forInput ? 'username-input' : 'username',
    username: forInput ? 'username-input' : 'username',
    이메일: 'email-input',
    email: 'email-input',
    비밀번호: forInput ? 'password-input' : 'password',
    password: forInput ? 'password-input' : 'password',
    패스워드: forInput ? 'password-input' : 'password',
    로그인: 'login',
    제출: 'submit',
    확인: 'confirm',
    검색: 'search',
  };
  const key = Object.keys(map).find((k) => name.toLowerCase().includes(k));
  return key ? map[key] : name.replace(/\s+/g, '-').toLowerCase().replace(/[^a-z0-9-]/g, '');
}

/**
 * 필드 키에 대응하는 CSS selector 생성
 * - data-testid 가 없어도 id/name/placeholder/aria-label 등으로 최대한 찾을 수 있도록 복수 셀렉터를 조합한다.
 * - 최후 수단으로 data-testid 도 함께 포함해 두되, 실제 DOM 에 없으면 무시된다.
 * @param {string} fieldKey
 * @returns {string}
 */
function buildSelectorForField(fieldKey) {
  switch (fieldKey) {
    case 'username-input':
    case 'username':
      return [
        'input#username',
        'input[name="username"]',
        'input[placeholder*="아이디"]',
        'input[placeholder*="ID"]',
        'input[aria-label*="아이디"]',
        'input[aria-label*="ID"]',
        '[data-testid="username-input"]',
      ].join(', ');
    case 'password-input':
    case 'password':
      return [
        'input#password',
        'input[name="password"]',
        'input[placeholder*="비밀번호"]',
        'input[placeholder*="패스워드"]',
        'input[aria-label*="비밀번호"]',
        'input[aria-label*="패스워드"]',
        '[data-testid="password-input"]',
      ].join(', ');
    default:
      return [
        `input[name="${fieldKey}"]`,
        `input#${fieldKey}`,
        `[data-testid="${fieldKey}"]`,
      ].join(', ');
  }
}

/**
 * 셀렉터 목록을 특정 scope (예: #f_login) 아래로 한정
 * @param {string} selectorList - 콤마로 구분된 셀렉터 문자열
 * @param {string} scope - 예: '#f_login'
 * @returns {string}
 */
function scopeSelectors(selectorList, scope) {
  if (!scope) return selectorList;
  return selectorList
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((s) => `${scope} ${s}`)
    .join(', ');
}

module.exports = {
  generateFromNaturalLanguage,
  generateFromNaturalLanguageMulti,
  generateFromSpecContent,
};
