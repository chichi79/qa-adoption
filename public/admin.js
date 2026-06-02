const API = '/api';

let currentKind = 'basic';
let currentChecklistId = null;
let checklistsCache = [];

const $ = (sel, root = document) => root.querySelector(sel);

function setStatus(msg, type) {
  const el = $('#admin-status');
  if (!el) return;
  if (!msg) {
    el.textContent = '';
    el.className = '';
    el.hidden = true;
    return;
  }
  const map = {
    error: 'alert alert-danger py-2 small',
    success: 'alert alert-success py-2 small',
    loading: 'alert alert-info py-2 small',
  };
  el.textContent = msg;
  el.className = map[type] || 'alert alert-secondary py-2 small';
  el.hidden = false;
}

async function api(path, options) {
  const res = await fetch(API + path, options);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || res.statusText);
  return data;
}

async function loadNav() {
  const data = await api(`/checklists?kind=${currentKind}&all=1`);
  checklistsCache = data.checklists || [];
  const nav = $('#checklist-nav');
  nav.innerHTML = checklistsCache
    .map(
      (c) => `<button type="button" class="list-group-item list-group-item-action nav-item${c.id === currentChecklistId ? ' active' : ''}" data-id="${c.id}">
          <div class="fw-semibold">${escapeHtml(c.name)}</div>
          <div class="small text-muted">${(c.items || []).length}항 · ${c.active !== false ? '활성' : '비활성'}</div>
        </button>`,
    )
    .join('') || '<div class="list-group-item text-muted small">등록된 체크리스트가 없습니다.</div>';

  nav.querySelectorAll('.nav-item').forEach((btn) => {
    btn.addEventListener('click', () => openChecklist(btn.dataset.id));
  });
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function configFieldsForType(inspectType, config = {}) {
  if (inspectType === 'playwright') {
    const check = config.check || 'page_load';
    return `<label class="form-label">Playwright 검사</label>
      <select class="form-select" name="configCheck">
        <option value="page_load"${check === 'page_load' ? ' selected' : ''}>page_load</option>
        <option value="no_console_error"${check === 'no_console_error' ? ' selected' : ''}>no_console_error</option>
        <option value="page_title"${check === 'page_title' ? ' selected' : ''}>page_title</option>
        <option value="login_form"${check === 'login_form' ? ' selected' : ''}>login_form</option>
      </select>`;
  }
  if (inspectType === 'ai_code') {
    const rule = config.rule || 'no_console_log';
    return `<label class="form-label">코드 규칙</label>
      <select class="form-select" name="configRule">
        <option value="no_console_log"${rule === 'no_console_log' ? ' selected' : ''}>no_console_log</option>
        <option value="no_explicit_any"${rule === 'no_explicit_any' ? ' selected' : ''}>no_explicit_any</option>
      </select>`;
  }
  return '<p class="text-muted small">수동 항목은 Runner에서 사람이 확인합니다.</p>';
}

function renderEditor(cl) {
  const panel = $('#editor-panel');
  const isOptional = cl.kind === 'optional';
  panel.innerHTML = `
    <div class="card-header bg-white d-flex justify-content-between align-items-center flex-wrap gap-2">
      <h2 class="h5 mb-0">${escapeHtml(cl.name)}</h2>
      <div class="btn-group">
        <button type="button" class="btn btn-outline-danger btn-sm" id="btn-delete-cl">삭제</button>
        <button type="button" class="btn btn-primary btn-sm" id="btn-save-cl">저장</button>
      </div>
    </div>
    <div class="card-body">
    <form id="cl-form">
      <div class="row g-3">
      <div class="col-12">
        <label class="form-label">이름</label>
        <input class="form-control" name="name" value="${escapeHtml(cl.name)}" required />
      </div>
      <div class="col-12">
        <label class="form-label">설명</label>
        <input class="form-control" name="description" value="${escapeHtml(cl.description || '')}" />
      </div>
      <div class="col-md-6">
        <label class="form-label">활성</label>
        <select class="form-select" name="active">
          <option value="true"${cl.active !== false ? ' selected' : ''}>활성</option>
          <option value="false"${cl.active === false ? ' selected' : ''}>비활성</option>
        </select>
      </div>
      ${
        isOptional
          ? `<div class="col-md-6">
        <label class="form-label">URL 힌트 (선택)</label>
        <input class="form-control" name="urlHint" value="${escapeHtml(cl.urlHint || '')}" placeholder="**/login**" />
      </div>`
          : ''
      }
      </div>
    </form>
    <div id="admin-status" class="mt-3" hidden></div>

    <hr />

    <div class="d-flex justify-content-between align-items-center mb-3">
      <h3 class="h6 mb-0">점검 항목 (${(cl.items || []).length})</h3>
      <button type="button" class="btn btn-outline-primary btn-sm" id="btn-add-item">+ 항목 추가</button>
    </div>
    <div id="items-list" class="vstack gap-2">${renderItems(cl)}</div>

    <div class="card bg-light border mt-4" id="item-form-wrap" hidden>
      <div class="card-body">
      <h3 class="h6" id="item-form-title">항목 추가</h3>
      <form id="item-form">
        <input type="hidden" name="itemId" value="" />
        <div class="row g-3">
          <div class="col-12">
            <label class="form-label">제목</label>
            <input class="form-control" name="title" required />
          </div>
          <div class="col-12">
            <label class="form-label">판정 기준</label>
            <input class="form-control" name="criteria" placeholder="무엇을 pass로 볼지 한 문장으로" />
          </div>
          <div class="col-md-6">
            <label class="form-label">심각도</label>
            <select class="form-select" name="severity">
              <option value="blocker">blocker</option>
              <option value="major" selected>major</option>
              <option value="minor">minor</option>
            </select>
          </div>
          <div class="col-md-6">
            <label class="form-label">검사 방식</label>
            <select class="form-select" name="inspectType" id="item-inspect-type">
              <option value="playwright">playwright (자동·URL)</option>
              <option value="ai_code">ai_code (자동·코드)</option>
              <option value="manual">manual (수동)</option>
            </select>
          </div>
          <div class="col-12" id="item-config-fields"></div>
        </div>
        <div class="mt-3 d-flex gap-2">
          <button type="button" class="btn btn-outline-secondary btn-sm" id="btn-cancel-item">취소</button>
          <button type="submit" class="btn btn-primary btn-sm">항목 저장</button>
        </div>
      </form>
      </div>
    </div>
    </div>
  `;

  $('#btn-save-cl').addEventListener('click', () => saveChecklist(cl.id));
  $('#btn-delete-cl').addEventListener('click', () => deleteChecklist(cl.id));
  $('#btn-add-item').addEventListener('click', () => showItemForm(null, cl));
  $('#item-inspect-type').addEventListener('change', (e) => {
    $('#item-config-fields').innerHTML = configFieldsForType(e.target.value, {});
  });

  panel.querySelectorAll('[data-edit-item]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const item = cl.items.find((i) => i.id === btn.dataset.editItem);
      showItemForm(item, cl);
    });
  });
  panel.querySelectorAll('[data-del-item]').forEach((btn) => {
    btn.addEventListener('click', () => deleteItem(cl.id, btn.dataset.delItem));
  });

  $('#item-form').addEventListener('submit', (e) => {
    e.preventDefault();
    saveItem(cl.id);
  });
  $('#btn-cancel-item').addEventListener('click', () => {
    $('#item-form-wrap').hidden = true;
  });
}

function renderItems(cl) {
  if (!cl.items || !cl.items.length) {
    return '<p class="text-muted small">항목이 없습니다. 추가해 주세요.</p>';
  }
  return cl.items
    .map(
      (item) => `<div class="card">
      <div class="card-body d-flex justify-content-between gap-2 py-3">
      <div>
        <strong>${escapeHtml(item.title)}</strong>
        <div class="small text-muted">${item.inspectType} · ${item.severity}</div>
        <div class="small mt-1">${escapeHtml(item.criteria || '')}</div>
      </div>
      <div class="d-flex gap-1 flex-shrink-0">
        <button type="button" class="btn btn-outline-secondary btn-sm" data-edit-item="${item.id}">수정</button>
        <button type="button" class="btn btn-outline-danger btn-sm" data-del-item="${item.id}">삭제</button>
      </div>
      </div>
    </div>`,
    )
    .join('');
}

async function openChecklist(id) {
  currentChecklistId = id;
  await loadNav();
  const data = await api(`/checklists/${id}`);
  renderEditor(data.checklist);
}

async function saveChecklist(id) {
  const form = $('#cl-form');
  const fd = new FormData(form);
  try {
    await api(`/checklists/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: fd.get('name'),
        description: fd.get('description'),
        active: fd.get('active') === 'true',
        urlHint: fd.get('urlHint') || '',
      }),
    });
    setStatus('저장됨', 'success');
    await loadNav();
    await openChecklist(id);
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

async function deleteChecklist(id) {
  if (!confirm('이 체크리스트를 삭제할까요?')) return;
  try {
    await api(`/checklists/${id}`, { method: 'DELETE' });
    currentChecklistId = null;
    $('#editor-panel').innerHTML = '<div class="card-body d-flex align-items-center justify-content-center text-muted py-5">삭제되었습니다.</div>';
    await loadNav();
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

function showItemForm(item, cl) {
  const wrap = $('#item-form-wrap');
  wrap.hidden = false;
  $('#item-form-title').textContent = item ? '항목 수정' : '항목 추가';
  const form = $('#item-form');
  form.querySelector('[name="itemId"]').value = item ? item.id : '';
  form.querySelector('[name="title"]').value = item ? item.title : '';
  form.querySelector('[name="criteria"]').value = item ? item.criteria || '' : '';
  form.querySelector('[name="severity"]').value = item ? item.severity : 'major';
  form.querySelector('[name="inspectType"]').value = item ? item.inspectType : 'manual';
  $('#item-config-fields').innerHTML = configFieldsForType(
    item ? item.inspectType : 'manual',
    item ? item.config : {},
  );
  wrap.scrollIntoView({ behavior: 'smooth' });
}

async function saveItem(checklistId) {
  const form = $('#item-form');
  const fd = new FormData(form);
  const inspectType = fd.get('inspectType');
  const config = {};
  const configWrap = $('#item-config-fields');
  if (inspectType === 'playwright') {
    const sel = configWrap.querySelector('[name="configCheck"]');
    config.check = sel ? sel.value : 'page_load';
  } else if (inspectType === 'ai_code') {
    const sel = configWrap.querySelector('[name="configRule"]');
    config.rule = sel ? sel.value : 'no_console_log';
  }
  const payload = {
    title: fd.get('title'),
    criteria: fd.get('criteria'),
    severity: fd.get('severity'),
    inspectType,
    config,
  };
  const itemId = fd.get('itemId');
  try {
    if (itemId) {
      await api(`/checklists/${checklistId}/items/${itemId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } else {
      await api(`/checklists/${checklistId}/items`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    }
    setStatus('항목 저장됨', 'success');
    $('#item-form-wrap').hidden = true;
    await openChecklist(checklistId);
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

async function deleteItem(checklistId, itemId) {
  if (!confirm('이 항목을 삭제할까요?')) return;
  try {
    await api(`/checklists/${checklistId}/items/${itemId}`, { method: 'DELETE' });
    await openChecklist(checklistId);
  } catch (err) {
    setStatus(err.message, 'error');
  }
}

async function createChecklist() {
  try {
    const data = await api('/checklists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: currentKind, name: currentKind === 'basic' ? '새 기본 체크리스트' : '새 선택 체크리스트' }),
    });
    currentChecklistId = data.checklist.id;
    await loadNav();
    await openChecklist(data.checklist.id);
  } catch (err) {
    alert(err.message);
  }
}

document.querySelectorAll('.admin-tab').forEach((tab) => {
  tab.addEventListener('click', () => {
    document.querySelectorAll('.admin-tab').forEach((t) => {
      t.classList.remove('active');
    });
    tab.classList.add('active');
    currentKind = tab.dataset.kind;
    currentChecklistId = null;
    $('#kind-help').textContent =
      currentKind === 'basic'
        ? '모든 점검 Run에 자동 적용됩니다.'
        : 'Runner에서 필요할 때 선택해 점검에 포함합니다.';
    $('#editor-panel').innerHTML = '<div class="card-body d-flex align-items-center justify-content-center text-muted py-5">왼쪽에서 체크리스트를 선택하거나 새로 만드세요.</div>';
    loadNav();
  });
});

$('#btn-new-checklist').addEventListener('click', createChecklist);

loadNav();
