const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const CHECKLISTS_PATH = path.join(__dirname, '..', 'data', 'checklists.json');

function slugId(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function normalizeStore(raw) {
  if (raw.checklists && Array.isArray(raw.checklists)) {
    return { checklists: raw.checklists };
  }
  if (raw.templates && Array.isArray(raw.templates)) {
    return {
      checklists: raw.templates.map((t) => ({
        id: t.id,
        name: t.name,
        description: t.description || '',
        kind: t.scope === 'page' ? 'optional' : 'basic',
        active: t.active !== false,
        urlHint: t.urlPattern || '',
        items: t.items || [],
      })),
    };
  }
  return { checklists: [] };
}

function loadChecklists() {
  const raw = fs.readFileSync(CHECKLISTS_PATH, 'utf8');
  return normalizeStore(JSON.parse(raw));
}

function saveChecklists(data) {
  const normalized = normalizeStore(data);
  fs.writeFileSync(CHECKLISTS_PATH, JSON.stringify(normalized, null, 2), 'utf8');
  return normalized;
}

function listChecklists({ kind, includeInactive = false } = {}) {
  const { checklists } = loadChecklists();
  let list = includeInactive ? checklists : checklists.filter((c) => c.active !== false);
  if (kind === 'basic' || kind === 'optional') {
    list = list.filter((c) => c.kind === kind);
  }
  return list;
}

function getChecklist(id) {
  const { checklists } = loadChecklists();
  return checklists.find((c) => c.id === id) || null;
}

function createChecklist(payload) {
  const data = loadChecklists();
  const kind = payload.kind === 'optional' ? 'optional' : 'basic';
  const checklist = {
    id: payload.id || slugId(kind === 'basic' ? 'basic' : 'opt'),
    name: (payload.name || '').trim() || '새 체크리스트',
    description: (payload.description || '').trim(),
    kind,
    active: payload.active !== false,
    urlHint: kind === 'optional' ? (payload.urlHint || '').trim() : '',
    items: [],
  };
  data.checklists.push(checklist);
  saveChecklists(data);
  return checklist;
}

function updateChecklist(id, payload) {
  const data = loadChecklists();
  const idx = data.checklists.findIndex((c) => c.id === id);
  if (idx < 0) return null;
  const cur = data.checklists[idx];
  if (payload.name != null) cur.name = String(payload.name).trim() || cur.name;
  if (payload.description != null) cur.description = String(payload.description).trim();
  if (payload.active != null) cur.active = !!payload.active;
  if (payload.urlHint != null && cur.kind === 'optional') {
    cur.urlHint = String(payload.urlHint).trim();
  }
  data.checklists[idx] = cur;
  saveChecklists(data);
  return cur;
}

function deleteChecklist(id) {
  const data = loadChecklists();
  const before = data.checklists.length;
  data.checklists = data.checklists.filter((c) => c.id !== id);
  if (data.checklists.length === before) return false;
  saveChecklists(data);
  return true;
}

function addItem(checklistId, payload) {
  const data = loadChecklists();
  const cl = data.checklists.find((c) => c.id === checklistId);
  if (!cl) return null;
  const item = {
    id: payload.id || slugId('item'),
    title: (payload.title || '').trim() || '새 항목',
    criteria: (payload.criteria || '').trim(),
    severity: payload.severity || 'major',
    inspectType: payload.inspectType || 'manual',
    config: payload.config || {},
  };
  cl.items.push(item);
  saveChecklists(data);
  return item;
}

function updateItem(checklistId, itemId, payload) {
  const data = loadChecklists();
  const cl = data.checklists.find((c) => c.id === checklistId);
  if (!cl) return null;
  const item = cl.items.find((i) => i.id === itemId);
  if (!item) return null;
  if (payload.title != null) item.title = String(payload.title).trim() || item.title;
  if (payload.criteria != null) item.criteria = String(payload.criteria).trim();
  if (payload.severity != null) item.severity = payload.severity;
  if (payload.inspectType != null) item.inspectType = payload.inspectType;
  if (payload.config != null) item.config = payload.config;
  saveChecklists(data);
  return item;
}

function deleteItem(checklistId, itemId) {
  const data = loadChecklists();
  const cl = data.checklists.find((c) => c.id === checklistId);
  if (!cl) return false;
  const before = cl.items.length;
  cl.items = cl.items.filter((i) => i.id !== itemId);
  if (cl.items.length === before) return false;
  saveChecklists(data);
  return true;
}

function resolveItemId(checklistId, itemId) {
  return `${checklistId}::${itemId}`;
}

function resolveMatchedItems(input) {
  const { selectedOptionalIds = [] } = input;
  const selected = new Set(
    Array.isArray(selectedOptionalIds) ? selectedOptionalIds.map(String) : [],
  );

  const { checklists } = loadChecklists();
  const active = checklists.filter((c) => c.active !== false);

  const basicLists = active.filter((c) => c.kind === 'basic');
  const optionalLists = active.filter(
    (c) => c.kind === 'optional' && selected.has(c.id),
  );

  const applied = [...basicLists, ...optionalLists];
  const items = [];

  for (const checklist of applied) {
    for (const item of checklist.items || []) {
      items.push({
        ...item,
        itemKey: resolveItemId(checklist.id, item.id),
        checklistId: checklist.id,
        checklistName: checklist.name,
        checklistKind: checklist.kind,
      });
    }
  }

  const byKey = new Map();
  for (const item of items) {
    byKey.set(item.itemKey, item);
  }
  const uniqueItems = Array.from(byKey.values());

  const counts = {
    total: uniqueItems.length,
    playwright: uniqueItems.filter((i) => i.inspectType === 'playwright').length,
    ai_code: uniqueItems.filter((i) => i.inspectType === 'ai_code').length,
    manual: uniqueItems.filter((i) => i.inspectType === 'manual').length,
    other: uniqueItems.filter(
      (i) => !['playwright', 'ai_code', 'manual'].includes(i.inspectType),
    ).length,
  };

  return {
    items: uniqueItems,
    counts,
    basicChecklists: basicLists.map((c) => ({
      id: c.id,
      name: c.name,
      itemCount: (c.items || []).length,
    })),
    optionalChecklists: active
      .filter((c) => c.kind === 'optional')
      .map((c) => ({
        id: c.id,
        name: c.name,
        description: c.description,
        urlHint: c.urlHint,
        itemCount: (c.items || []).length,
        selected: selected.has(c.id),
      })),
    appliedChecklists: applied.map((c) => ({
      id: c.id,
      name: c.name,
      kind: c.kind,
      itemCount: (c.items || []).length,
    })),
  };
}

function parseRepoRef(repoInput) {
  const raw = (repoInput || '').trim();
  if (!raw) return null;

  const ghMatch = raw.match(/github\.com[/:]([^/]+)\/([^/.]+)/i);
  if (ghMatch) {
    return { owner: ghMatch[1], repo: ghMatch[2].replace(/\.git$/, '') };
  }
  const slash = raw.match(/^([^/]+)\/([^/]+)$/);
  if (slash) {
    return { owner: slash[1], repo: slash[2].replace(/\.git$/, '') };
  }
  return null;
}

module.exports = {
  loadChecklists,
  saveChecklists,
  listChecklists,
  getChecklist,
  createChecklist,
  updateChecklist,
  deleteChecklist,
  addItem,
  updateItem,
  deleteItem,
  resolveMatchedItems,
  resolveItemId,
  parseRepoRef,
  CHECKLISTS_PATH,
};
