window.STMA = (() => {
  const STORAGE_KEYS = {
    apiBase: 'stma.apiBase',
    empresaFiltro: 'stma.empresaFiltro',
    deviceIdentifier: 'stma.deviceIdentifier',
    currentUser: 'stma.currentUser'
  };

  const DEFAULT_API_BASE = 'http://127.0.0.1:3001/api';
  const DEFAULT_DEVICE = 'esp32-demo-001';

  function getApiBase() {
    return localStorage.getItem(STORAGE_KEYS.apiBase) || DEFAULT_API_BASE;
  }

  function setApiBase(value) {
    const normalized = String(value || '').trim().replace(/\/+$/, '');
    localStorage.setItem(STORAGE_KEYS.apiBase, normalized || DEFAULT_API_BASE);
  }

  function getEmpresaFiltro() {
    return localStorage.getItem(STORAGE_KEYS.empresaFiltro) || '';
  }

  function setEmpresaFiltro(value) {
    localStorage.setItem(STORAGE_KEYS.empresaFiltro, value == null ? '' : String(value));
  }

  function getDeviceIdentifier() {
    return localStorage.getItem(STORAGE_KEYS.deviceIdentifier) || DEFAULT_DEVICE;
  }

  function setDeviceIdentifier(value) {
    const normalized = String(value || '').trim();
    localStorage.setItem(STORAGE_KEYS.deviceIdentifier, normalized || DEFAULT_DEVICE);
  }

  function getCurrentUser() {
    const raw = localStorage.getItem(STORAGE_KEYS.currentUser);
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  }

  function setCurrentUser(user) {
    if (!user) {
      localStorage.removeItem(STORAGE_KEYS.currentUser);
      return;
    }
    localStorage.setItem(STORAGE_KEYS.currentUser, JSON.stringify(user));
  }

  async function request(path, options = {}) {
    const base = getApiBase();
    const url = path.startsWith('http') ? path : `${base}${path.startsWith('/') ? path : `/${path}`}`;
    const config = {
      method: options.method || 'GET',
      credentials: 'include',
      headers: {
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    };

    let response;
    try {
      response = await fetch(url, config);
    } catch (error) {
      throw new Error(`Não foi possível conectar à API em ${base}. Verifique se o backend está ativo e se a Base da API está correta.`);
    }

    const text = await response.text();
    let data = null;
    if (text) {
      try {
        data = JSON.parse(text);
      } catch {
        data = { message: text };
      }
    }

    if (!response.ok) {
      const message = data?.error || data?.message || `Falha ao acessar ${path}.`;
      const err = new Error(message);
      err.status = response.status;
      err.payload = data;
      throw err;
    }

    return data;
  }

  function normalizeUser(payload) {
    const user = payload?.usuario || payload?.data?.usuario || null;
    if (!user) return null;
    return {
      id: user.id,
      nome: user.nome || user.user_nome || 'Utilizador',
      email: user.email || user.user_email || '',
      perfil: user.perfil || 'operador',
      empresaId: user.empresaId || user.empresa_id || null,
      empresaNome: user.empresaNome || null,
      isAdmin: Boolean(user.isAdmin)
    };
  }

  function normalizeEmpresa(row) {
    return {
      empresa_id: row.empresa_id ?? row.id,
      nome_empresa: row.nome_empresa ?? row.nome ?? 'Empresa sem nome',
      endereco_empresa: row.endereco_empresa ?? row.endereco ?? ''
    };
  }

  async function login(email, senha) {
    const payload = await request('/auth/login', {
      method: 'POST',
      body: { email, senha }
    });
    const user = normalizeUser(payload);
    setCurrentUser(user);
    return user;
  }

  async function me() {
    const payload = await request('/me');
    const user = normalizeUser(payload);
    setCurrentUser(user);
    return user;
  }

  async function logout() {
    try {
      await request('/logout', { method: 'POST' });
    } finally {
      setCurrentUser(null);
    }
  }

  async function listarEmpresas() {
    const payload = await request('/empresas');
    const rows = Array.isArray(payload) ? payload : payload?.data || [];
    return rows.map(normalizeEmpresa);
  }

  async function cadastrarEmpresa(body) {
    return request('/empresas', { method: 'POST', body });
  }

  async function cadastrarUsuario(body) {
    return request('/usuarios', { method: 'POST', body });
  }

  async function cadastrarSetor(body) {
    return request('/setores', { method: 'POST', body });
  }

  async function cadastrarEquipamento(body) {
    return request('/equipamentos', { method: 'POST', body });
  }

  async function registrarMedicao(body) {
    return request('/medicoes', { method: 'POST', body });
  }

  return {
    request,
    login,
    me,
    logout,
    listarEmpresas,
    cadastrarEmpresa,
    cadastrarUsuario,
    cadastrarSetor,
    cadastrarEquipamento,
    registrarMedicao,
    getApiBase,
    setApiBase,
    getEmpresaFiltro,
    setEmpresaFiltro,
    getDeviceIdentifier,
    setDeviceIdentifier,
    getCurrentUser,
    setCurrentUser
  };
})();
