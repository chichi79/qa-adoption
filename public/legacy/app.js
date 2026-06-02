const API = '/api';

const $ = (id) => document.getElementById(id);

// 생성된 테스트 케이스 (테스트 실행 시 서버로 전송)
let currentTestCases = [];

// 위저드용: 필드명 → Playwright에서 쓸 selector (tc-generator와 동일한 규칙)
function getSelectorForField(fieldLabel) {
  const map = {
    아이디: 'input#username, input[name="username"], input[placeholder*="아이디"], [data-testid="username-input"]',
    비밀번호: 'input#password, input[name="password"], input[placeholder*="비밀번호"], [data-testid="password-input"]',
    이메일: 'input#email, input[name="email"], input[type="email"], [data-testid="email-input"]',
  };
  return map[fieldLabel] || '';
}

function setStatus(el, text, type = '') {
  const status = $('run-status');
  status.textContent = text;
  status.className = 'status ' + type;
}

function setResult(textOrHtml, asHtml = false) {
  const el = $('run-result');
  if (asHtml) {
    el.innerHTML = textOrHtml || '';
  } else {
    el.textContent = textOrHtml || '';
  }
}

// 탭 전환
document.querySelectorAll('.tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach((t) => t.classList.remove('active'));
    document.querySelectorAll('.panel').forEach((p) => p.classList.remove('active'));
    tab.classList.add('active');
    const panel = document.getElementById('panel-' + tab.dataset.tab);
    if (panel) panel.classList.add('active');
    if (tab.dataset.tab === 'wizard') syncWizardFromEditor();
  });
});

// ---------- 스텝 위저드 ----------
function showWizardFields(action) {
  document.querySelectorAll('.wizard-fields').forEach((el) => {
    el.style.display = el.id === 'wizard-fields-' + action ? 'block' : 'none';
  });
  const fillField = $('wizard-fill-field');
  const selectorRow = $('label-wizard-fill-selector');
  const selectorInput = $('wizard-fill-selector');
  if (fillField && selectorRow && selectorInput) {
    const isSelector = fillField.value === 'selector';
    selectorRow.style.display = isSelector ? 'block' : 'none';
    selectorInput.style.display = isSelector ? 'block' : 'none';
  }
  const clickType = $('wizard-click-type');
  const labelText = $('label-wizard-click-text');
  const labelSel = $('label-wizard-click-selector');
  const inputText = $('wizard-click-text');
  const inputSel = $('wizard-click-selector');
  if (clickType && labelText && labelSel && inputText && inputSel) {
    const useSelector = clickType.value === 'selector';
    labelText.style.display = useSelector ? 'none' : 'block';
    inputText.style.display = useSelector ? 'none' : 'block';
    labelSel.style.display = useSelector ? 'block' : 'none';
    inputSel.style.display = useSelector ? 'block' : 'none';
  }
  const waitForType = $('wizard-waitFor-type');
  const labelWaitForText = $('label-wizard-waitFor-text');
  const labelWaitForSel = $('label-wizard-waitFor-selector');
  const inputWaitForText = $('wizard-waitFor-text');
  const inputWaitForSel = $('wizard-waitFor-selector');
  if (waitForType && labelWaitForText && labelWaitForSel && inputWaitForText && inputWaitForSel) {
    const waitForSelector = waitForType.value === 'selector';
    labelWaitForText.style.display = waitForSelector ? 'none' : 'block';
    inputWaitForText.style.display = waitForSelector ? 'none' : 'block';
    labelWaitForSel.style.display = waitForSelector ? 'block' : 'none';
    inputWaitForSel.style.display = waitForSelector ? 'block' : 'none';
  }
}

function buildStepFromWizard() {
  const action = ($('wizard-action') && $('wizard-action').value) || 'goto';
  const baseURL = $('target-url') && $('target-url').value.trim();

  if (action === 'goto') {
    const url = ($('wizard-url') && $('wizard-url').value.trim()) || baseURL || '';
    return { action: 'goto', url, description: '페이지 이동' };
  }
  if (action === 'fill') {
    const fieldOpt = $('wizard-fill-field') && $('wizard-fill-field').value;
    const value = ($('wizard-fill-value') && $('wizard-fill-value').value.trim()) || '';
    let selector = '';
    if (fieldOpt === 'selector') {
      selector = ($('wizard-fill-selector') && $('wizard-fill-selector').value.trim()) || 'input';
    } else {
      selector = getSelectorForField(fieldOpt);
    }
    return {
      action: 'fill',
      selector,
      value,
      description: `${fieldOpt} 입력: ${value}`,
    };
  }
  if (action === 'click') {
    const clickType = $('wizard-click-type') && $('wizard-click-type').value;
    if (clickType === 'selector') {
      const selector = ($('wizard-click-selector') && $('wizard-click-selector').value.trim()) || '';
      return { action: 'click', selector, description: '클릭' };
    }
    const text = ($('wizard-click-text') && $('wizard-click-text').value.trim()) || '';
    return { action: 'click', text, description: `${text} 클릭` };
  }
  if (action === 'wait') {
    const sec = parseInt(($('wizard-wait-sec') && $('wizard-wait-sec').value) || 2, 10);
    const ms = Math.min(Math.max(sec, 1), 30) * 1000;
    return { action: 'wait', timeout: ms, description: `${sec}초 대기` };
  }
  if (action === 'waitFor') {
    const type = ($('wizard-waitFor-type') && $('wizard-waitFor-type').value) || 'text';
    const sec = parseInt(($('wizard-waitFor-timeout') && $('wizard-waitFor-timeout').value) || 15, 10);
    const timeout = Math.min(Math.max(sec, 1), 60) * 1000;
    if (type === 'selector') {
      const selector = ($('wizard-waitFor-selector') && $('wizard-waitFor-selector').value.trim()) || '';
      return { action: 'waitFor', selector, timeout, description: `요소 나타날 때까지 대기 (최대 ${sec}초): ${selector}` };
    }
    const text = ($('wizard-waitFor-text') && $('wizard-waitFor-text').value.trim()) || '';
    return { action: 'waitFor', text, timeout, description: `"${text}" 나타날 때까지 대기 (최대 ${sec}초)` };
  }
  if (action === 'screenshot') {
    const name = ($('wizard-screenshot-name') && $('wizard-screenshot-name').value.trim()) || 'capture';
    return { action: 'screenshot', name, description: `화면 캡처: ${name}` };
  }
  return null;
}

function syncEditorFromSteps() {
  currentTestCases = currentTestCases || [];
  const editor = $('tc-editor');
  if (editor) {
    editor.value = currentTestCases.length
      ? JSON.stringify(currentTestCases, null, 2)
      : '(스텝 위저드에서 스텝을 추가하거나, 기획서/DSL로 생성하세요)';
  }
  const countEl = $('step-count');
  if (countEl) countEl.textContent = currentTestCases.length;
  renderStepList();
}

function renderStepList() {
  const list = $('step-list');
  if (!list) return;
  list.innerHTML = '';
  (currentTestCases || []).forEach((step, i) => {
    const stepIndex = i;
    const li = document.createElement('li');
    const desc = step.description || step.action || '';
    const short = step.action === 'goto' ? (step.url || '') : step.action === 'fill' ? (step.value || '') : step.action === 'click' ? (step.text || step.selector || '') : step.action === 'wait' ? (step.timeout / 1000 + '초') : step.action === 'waitFor' ? (step.text || step.selector || step.timeout / 1000 + '초') : step.action === 'screenshot' ? (step.name || '') : '';
    li.textContent = `${i + 1}. ${desc}${short ? ' — ' + short : ''}`;
    const wrap = document.createElement('span');
    wrap.className = 'step-actions';
    const btnUp = document.createElement('button');
    btnUp.type = 'button';
    btnUp.className = 'btn-step-up';
    btnUp.title = '위로';
    btnUp.textContent = '↑';
    btnUp.disabled = stepIndex === 0;
    btnUp.addEventListener('click', () => {
      if (stepIndex <= 0) return;
      const arr = currentTestCases;
      [arr[stepIndex - 1], arr[stepIndex]] = [arr[stepIndex], arr[stepIndex - 1]];
      syncEditorFromSteps();
    });
    wrap.appendChild(btnUp);
    const btnDown = document.createElement('button');
    btnDown.type = 'button';
    btnDown.className = 'btn-step-down';
    btnDown.title = '아래로';
    btnDown.textContent = '↓';
    btnDown.disabled = stepIndex === currentTestCases.length - 1;
    btnDown.addEventListener('click', () => {
      if (stepIndex >= currentTestCases.length - 1) return;
      const arr = currentTestCases;
      [arr[stepIndex], arr[stepIndex + 1]] = [arr[stepIndex + 1], arr[stepIndex]];
      syncEditorFromSteps();
    });
    wrap.appendChild(btnDown);
    const btnRemove = document.createElement('button');
    btnRemove.type = 'button';
    btnRemove.className = 'btn-step-remove';
    btnRemove.textContent = '삭제';
    btnRemove.addEventListener('click', () => {
      currentTestCases.splice(stepIndex, 1);
      syncEditorFromSteps();
    });
    wrap.appendChild(btnRemove);
    const canRepick = step.action === 'click' || step.action === 'fill' || (step.action === 'waitFor' && (step.selector != null || step.text != null));
    if (canRepick) {
      const btnPicker = document.createElement('button');
      btnPicker.type = 'button';
      btnPicker.className = 'btn-step-picker';
      btnPicker.textContent = '픽커로 다시 선택';
      btnPicker.addEventListener('click', () => runPickerForStep(stepIndex));
      wrap.appendChild(btnPicker);
    }
    if (step.action === 'fill') {
      const btnEditValue = document.createElement('button');
      btnEditValue.type = 'button';
      btnEditValue.className = 'btn-step-edit-value';
      btnEditValue.textContent = '입력값 수정';
      btnEditValue.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        editFillValueForStep(stepIndex);
      });
      wrap.appendChild(btnEditValue);
    }
    li.appendChild(wrap);
    list.appendChild(li);
  });
}

async function runPickerForStep(stepIndex) {
  const urlInput = $('target-url');
  const url = urlInput && urlInput.value.trim();
  if (!url) {
    alert('대상 페이지 URL을 먼저 입력해 주세요.');
    return;
  }
  const step = currentTestCases[stepIndex];
  if (!step) return;
  setStatus('run-status', 'Edge 창에서 대상 페이지가 열립니다. 선택할 요소를 클릭하세요.', 'loading');
  try {
    const res = await fetch(API + '/picker-pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    setStatus('run-status', '');
    if (!res.ok || !data.success) {
      alert(data.error || '요소 선택에 실패했습니다.');
      return;
    }
    const selector = (data.selector && data.selector.trim()) || '';
    const text = (data.text && data.text.trim()) || '';
    if (step.action === 'fill') {
      step.selector = selector || step.selector;
    } else if (step.action === 'click') {
      if (text) {
        step.text = text;
        step.selector = selector || step.selector;
      } else {
        step.selector = selector || step.selector;
        step.text = '';
      }
    } else if (step.action === 'waitFor') {
      if (selector) {
        step.selector = selector;
        if (text) step.text = text;
      } else if (text) {
        step.text = text;
        step.selector = '';
      }
    }
    syncEditorFromSteps();
  } catch (e) {
    setStatus('run-status', '');
    alert('요소 선택 중 오류: ' + (e.message || e));
  }
}

let editFillValueStepIndex = -1;

function editFillValueForStep(stepIndex) {
  const step = currentTestCases[stepIndex];
  if (!step || step.action !== 'fill') return;
  editFillValueStepIndex = stepIndex;
  const input = $('edit-value-input');
  const overlay = $('edit-value-overlay');
  if (!input || !overlay) return;
  input.value = step.value != null ? String(step.value) : '';
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  input.focus();
}

function closeEditValueModal() {
  const overlay = $('edit-value-overlay');
  const input = $('edit-value-input');
  if (overlay) {
    overlay.style.display = 'none';
    overlay.setAttribute('aria-hidden', 'true');
  }
  if (input) input.value = '';
  editFillValueStepIndex = -1;
}

function confirmEditValueModal() {
  if (editFillValueStepIndex < 0) {
    closeEditValueModal();
    return;
  }
  const step = currentTestCases[editFillValueStepIndex];
  const input = $('edit-value-input');
  const newVal = input ? input.value : '';
  if (step && step.action === 'fill') {
    step.value = newVal;
    if (step.description && /입력:.*필드:/.test(step.description)) {
      const label = step.description.replace(/\s*필드:.*$/, '').trim() || '입력';
      step.description = `${label} 필드: ${newVal}`;
    }
    syncEditorFromSteps();
  }
  closeEditValueModal();
}

// 입력값 수정 모달: 확인/취소/오버레이 클릭/Esc
$('edit-value-confirm').addEventListener('click', confirmEditValueModal);
$('edit-value-cancel').addEventListener('click', closeEditValueModal);
$('edit-value-overlay').addEventListener('click', (e) => {
  if (e.target.id === 'edit-value-overlay') closeEditValueModal();
});
$('edit-value-input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') confirmEditValueModal();
  if (e.key === 'Escape') closeEditValueModal();
});

function syncWizardFromEditor() {
  const editor = $('tc-editor');
  if (!editor || !editor.value || editor.value.trim().startsWith('(')) return;
  try {
    const parsed = JSON.parse(editor.value);
    if (Array.isArray(parsed)) {
      currentTestCases = parsed;
      const countEl = $('step-count');
      if (countEl) countEl.textContent = currentTestCases.length;
      renderStepList();
    }
  } catch (e) {
    // ignore invalid JSON
  }
}

$('wizard-action').addEventListener('change', () => showWizardFields($('wizard-action').value));
$('wizard-fill-field').addEventListener('change', () => showWizardFields($('wizard-action').value));
$('wizard-click-type').addEventListener('change', () => showWizardFields($('wizard-action').value));
$('wizard-waitFor-type').addEventListener('change', () => showWizardFields($('wizard-action').value));

$('btn-wizard-add').addEventListener('click', () => {
  const step = buildStepFromWizard();
  if (!step) return;
  currentTestCases = currentTestCases || [];
  currentTestCases.push(step);
  syncEditorFromSteps();
});

$('btn-wizard-clear').addEventListener('click', () => {
  if (!confirm('모든 스텝을 지우시겠습니까?')) return;
  currentTestCases = [];
  syncEditorFromSteps();
});

// 요소 선택기(픽커): 대상 페이지에서 클릭한 요소로 필드 채우기
async function runPicker(mode) {
  const urlInput = $('target-url');
  const url = urlInput && urlInput.value.trim();
  if (!url) {
    alert('대상 페이지 URL을 먼저 입력해 주세요.');
    return;
  }
  setStatus('run-status', 'Edge 창에서 대상 페이지가 열립니다. 선택할 요소를 클릭하세요.', 'loading');
  try {
    const res = await fetch(API + '/picker-pick', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    setStatus('run-status', '');
    if (!res.ok || !data.success) {
      alert(data.error || '요소 선택에 실패했습니다.');
      return;
    }
    const selector = (data.selector && data.selector.trim()) || '';
    const text = (data.text && data.text.trim()) || '';
    if (mode === 'fill') {
      $('wizard-fill-field').value = 'selector';
      showWizardFields('fill');
      $('wizard-fill-selector').value = selector || '';
    } else {
      if (text) {
        $('wizard-click-type').value = 'text';
        $('wizard-click-text').value = text;
        $('wizard-click-selector').value = '';
      } else {
        $('wizard-click-type').value = 'selector';
        $('wizard-click-selector').value = selector || '';
        $('wizard-click-text').value = '';
      }
      showWizardFields('click');
    }
  } catch (e) {
    setStatus('run-status', '');
    alert('요소 선택 중 오류: ' + (e.message || e));
  }
}

$('btn-picker-fill').addEventListener('click', () => runPicker('fill'));
$('btn-picker-click').addEventListener('click', () => runPicker('click'));

showWizardFields('goto');

// 기획서 업로드
$('btn-upload').addEventListener('click', async () => {
  const fileInput = $('spec-file');
  if (!fileInput.files || !fileInput.files[0]) {
    alert('파일을 선택해주세요.');
    return;
  }
  const formData = new FormData();
  formData.append('file', fileInput.files[0]);
  setStatus('run-status', '업로드 중...', 'loading');
  try {
    const res = await fetch(API + '/upload-spec', { method: 'POST', body: formData });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '업로드 실패');
    currentTestCases = Array.isArray(data.testCases) ? data.testCases : [];
    const editor = $('tc-editor');
    if (editor) {
      const json = currentTestCases.length ? JSON.stringify(currentTestCases, null, 2) : '';
      editor.value = json || '(생성된 TC가 없습니다. 규칙을 조정하거나 입력을 확인해 주세요.)';
    }
    setStatus('run-status', '');
  } catch (e) {
    setStatus('run-status', e.message, 'error');
  }
});

// QA 자동 분석: URL로 자동 스텝 생성 (공통 로직). replace: true면 기존 대체, false면 뒤에 추가
let lastAutoDiscoverUrl = '';

async function runAutoDiscoverForUrl(options = {}) {
  const { replace = true } = options;
  const url = $('target-url') && $('target-url').value.trim();
  if (!url) {
    if (!replace) return;
    alert('대상 페이지 URL을 입력한 뒤 자동 스텝 생성을 눌러 주세요.');
    return;
  }
  setStatus('run-status', '페이지 분석 중... (QA 자동 분석)', 'loading');
  try {
    const res = await fetch(API + '/auto-discover-steps', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '자동 스텝 생성 실패');
    const newSteps = Array.isArray(data.testCases) ? data.testCases : [];
    currentTestCases = replace ? newSteps : [...(currentTestCases || []), ...newSteps];
    const editor = $('tc-editor');
    if (editor) {
      const json = currentTestCases.length ? JSON.stringify(currentTestCases, null, 2) : '';
      editor.value = json || (replace ? '(생성된 스텝이 없습니다.)' : editor.value);
    }
    const countEl = $('step-count');
    if (countEl) countEl.textContent = currentTestCases.length;
    renderStepList();
    setStatus('run-status', data.message || '자동 스텝 생성 완료', 'success');
    lastAutoDiscoverUrl = url;
  } catch (e) {
    setStatus('run-status', e.message, 'error');
    alert(e.message);
  }
}

$('btn-auto-discover').addEventListener('click', () => runAutoDiscoverForUrl({ replace: true }));

// 대상 URL 확정 시 자동 TC 생성 (체크 시 blur/Enter에 반응)
function maybeAutoDiscoverOnUrlConfirm() {
  const url = $('target-url') && $('target-url').value.trim();
  const checked = $('auto-tc-on-url') && $('auto-tc-on-url').checked;
  if (!checked || !url || url === lastAutoDiscoverUrl) return;
  runAutoDiscoverForUrl({ replace: true });
}

$('target-url').addEventListener('blur', maybeAutoDiscoverOnUrlConfirm);
$('target-url').addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    maybeAutoDiscoverOnUrlConfirm();
  }
});

// 자연어 TC 생성
$('btn-generate').addEventListener('click', async () => {
  const text = $('natural-input').value.trim();
  if (!text) {
    alert('자연어로 시나리오를 입력해주세요.');
    return;
  }
  setStatus('run-status', 'TC 생성 중...', 'loading');
  try {
    const baseURL = $('target-url').value.trim();
    const res = await fetch(API + '/generate-tc', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ naturalLanguage: text, baseURL }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '생성 실패');
    currentTestCases = Array.isArray(data.testCases) ? data.testCases : [];
    const editor = $('tc-editor');
    if (editor) {
      const json = currentTestCases.length ? JSON.stringify(currentTestCases, null, 2) : '';
      editor.value = json || '(생성된 TC가 없습니다. 규칙을 조정하거나 입력을 확인해 주세요.)';
    }
    setStatus('run-status', '');
  } catch (e) {
    setStatus('run-status', e.message, 'error');
  }
});

// 테스트 실행
$('btn-run').addEventListener('click', async () => {
  const url = $('target-url').value.trim();
  if (!url) {
    alert('대상 페이지 URL을 입력해주세요.');
    return;
  }
  setStatus('run-status', '테스트 실행 중...', 'loading');
  setResult('');
  try {
    // 사용자가 JSON을 직접 수정할 수 있도록, 우선 에디터 내용을 시도해 본다.
    let testCasesToRun = currentTestCases;
    const editor = $('tc-editor');
    if (editor && editor.value && editor.value.trim() && !editor.value.trim().startsWith('(')) {
      try {
        const parsed = JSON.parse(editor.value);
        if (Array.isArray(parsed)) {
          testCasesToRun = parsed;
        } else {
          alert('TC JSON은 배열 형식이어야 합니다. (예: [ { "action": "goto", ... }, ... ])\n에디터 내용을 확인해 주세요.');
          setStatus('run-status', 'TC JSON 형식 오류', 'error');
          return;
        }
      } catch (parseErr) {
        alert('TC JSON을 파싱하는 중 오류가 발생했습니다. JSON 형식을 확인해 주세요.\n\n' + parseErr.message);
        setStatus('run-status', 'TC JSON 파싱 오류', 'error');
        return;
      }
    }

    const res = await fetch(API + '/run-test', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        url,
        testCases: testCasesToRun,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || '실행 실패');

    const passed = data.passed;
    setStatus('run-status', passed ? '완료 (성공)' : '완료 (오류)', passed ? 'success' : 'error');

    // 리포트 HTML 생성
    const duration = data.duration || 0;
    const screenshots = Array.isArray(data.screenshots) ? data.screenshots : [];
    const stepResults = Array.isArray(data.stepResults) ? data.stepResults : [];

    let html = '';
    html += `<div class="report-summary">`;
    html += `<div><strong>소요 시간:</strong> ${duration}ms</div>`;
    html += `<div><strong>최종 결과:</strong> ${passed ? '성공' : '실패'}</div>`;
    if (data.error) {
      html += `<div class="report-error"><strong>오류 메시지:</strong> ${escapeHtml(data.error)}</div>`;
    }
    html += `</div>`;

    if (stepResults.length) {
      html += `<h3>스텝 리포트</h3>`;
      html += `<table class="report-table"><thead><tr>`;
      html += `<th>#</th><th>액션</th><th>설명</th><th>입력값</th><th>상태</th><th>오류</th><th>스크린샷</th>`;
      html += `</tr></thead><tbody>`;
      for (const step of stepResults) {
        const statusLabel = step.status === 'passed' ? '성공' : step.status === 'failed' ? '실패' : step.status;
        const statusClass = step.status === 'passed' ? 'status-pass' : step.status === 'failed' ? 'status-fail' : '';
        const input = step.input || {};
        const inputText = [
          input.url ? `url=${escapeHtml(input.url)}` : '',
          input.name ? `name=${escapeHtml(input.name)}` : '',
          input.testId ? `testId=${escapeHtml(input.testId)}` : '',
          input.text ? `text=${escapeHtml(input.text)}` : '',
          input.selector ? `selector=${escapeHtml(input.selector)}` : '',
          input.value != null ? `value=${escapeHtml(String(input.value))}` : '',
        ].filter(Boolean).join(', ');
        const screenshot = step.screenshot || null;
        const screenshotCell = screenshot
          ? `<a href="${escapeHtml(screenshot.path)}" target="_blank">${escapeHtml(screenshot.name || '보기')}</a>`
          : '';
        html += `<tr>`;
        html += `<td>${step.index + 1}</td>`;
        html += `<td>${escapeHtml(step.action || '')}</td>`;
        html += `<td>${escapeHtml(step.description || '')}</td>`;
        html += `<td>${escapeHtml(inputText)}</td>`;
        html += `<td><span class="${statusClass}">${statusLabel}</span></td>`;
        html += `<td>${step.error ? escapeHtml(step.error) : ''}</td>`;
        html += `<td>${screenshotCell}</td>`;
        html += `</tr>`;
      }
      html += `</tbody></table>`;
    } else if (screenshots.length) {
      html += `<div class="report-screenshots"><strong>스크린샷:</strong> `;
      html += screenshots.map((s) => `<a href="${escapeHtml(s.path)}" target="_blank">${escapeHtml(s.name || 'shot')}</a>`).join(', ');
      html += `</div>`;
    }

    setResult(html, true);
  } catch (e) {
    setStatus('run-status', e.message, 'error');
    setResult(e.message);
  }
});

// 간단한 HTML escape 유틸
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
