async function carregarMenu() {
    const container = document.getElementById('menu-container');
    if (!container) return;

    const resposta = await fetch('menu.html', { cache: 'no-store' });
    if (!resposta.ok) {
        throw new Error('Não foi possível carregar o menu.');
    }

    container.innerHTML = await resposta.text();
}

async function validarSessaoShell() {
    const res = await fetch('/api/me');
    if (!res.ok) {
        window.location.href = 'login.html';
        return null;
    }

    const data = await res.json();
    if (!data.authenticated || !data.usuario) {
        window.location.href = 'login.html';
        return null;
    }

    return data.usuario;
}

function configurarMenu(usuario) {
    const info = document.getElementById('usuario-logado-info');
    if (info) {
        info.innerText = `Usuário: ${usuario?.user_nome || 'Conectado'}`;
    }

    const isAdmin = Boolean(usuario?.isAdmin);
    const linkUsuario = document.getElementById('menu-link-usuario');
    const linkEmpresa = document.getElementById('menu-link-empresa');

    if (isAdmin) {
        if (linkUsuario) {
            linkUsuario.classList.remove('hidden');
            linkUsuario.classList.add('flex');
        }
        if (linkEmpresa) {
            linkEmpresa.classList.remove('hidden');
            linkEmpresa.classList.add('flex');
        }
    }

    const pagina = document.body.dataset.page || 'monitor';
    const linkAtivo = document.querySelector(`[data-menu="${pagina}"]`);
    if (linkAtivo) {
        linkAtivo.classList.add('active');
    }

    const logout = document.getElementById('menu-logout');
    if (logout) {
        logout.addEventListener('click', async () => {
            try {
                await fetch('/api/logout', { method: 'POST' });
            } catch (error) {}
            window.location.href = 'login.html';
        });
    }
}

function ajustarIframe() {
    const iframe = document.getElementById('page-frame');
    if (!iframe || !iframe.contentWindow) return;

    try {
        const doc = iframe.contentWindow.document;
        const bodyHeight = doc.body ? doc.body.scrollHeight : 0;
        const htmlHeight = doc.documentElement ? doc.documentElement.scrollHeight : 0;
        const altura = Math.max(bodyHeight, htmlHeight, 600);
        iframe.style.height = `${altura}px`;
    } catch (error) {}
}

async function inicializarShell() {
    try {
        await carregarMenu();
        const usuario = await validarSessaoShell();
        if (!usuario) return;

        configurarMenu(usuario);

        const iframe = document.getElementById('page-frame');
        if (iframe) {
            iframe.addEventListener('load', () => {
                ajustarIframe();
                window.setTimeout(ajustarIframe, 400);
                window.setTimeout(ajustarIframe, 1200);
            });
            window.setInterval(ajustarIframe, 1500);
        }
    } catch (error) {
        console.error('Erro ao inicializar shell:', error);
        window.location.href = 'login.html';
    }
}

window.addEventListener('load', inicializarShell);
window.addEventListener('resize', ajustarIframe);
