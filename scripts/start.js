// Sobe backend e frontend juntos, carregando o arquivo de configuracao
// escolhido pelo ambiente. Usado por: npm run dev | npm run prod
//
// O ambiente NAO altera codigo: apenas qual arquivo de configuracao e lido.
//   development -> config/.env.development
//   production  -> config/.env.production

const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const AMBIENTES = ['development', 'production'];

const ambiente = String(process.argv[2] || '').trim();

if (!AMBIENTES.includes(ambiente)) {
  console.error('Ambiente invalido ou ausente: "' + ambiente + '".');
  console.error('Use os atalhos: npm run dev  ou  npm run prod');
  process.exit(1);
}

const arquivoConfig = path.join(ROOT, 'config', '.env.' + ambiente);

if (!fs.existsSync(arquivoConfig)) {
  console.error('Arquivo de configuracao nao encontrado:');
  console.error('  ' + arquivoConfig);
  console.error('Copie config/.env.example, renomeie para .env.' + ambiente + ' e preencha os valores.');
  process.exit(1);
}

const SERVICOS = [
  {
    nome: 'backend',
    diretorio: path.join(ROOT, 'backend'),
    argumentos: ['src/server.js']
  },
  {
    nome: 'frontend',
    diretorio: path.join(ROOT, 'frontend'),
    argumentos: ['server.js']
  }
];

// Em desenvolvimento cada servico reinicia sozinho ao salvar um arquivo.
if (ambiente === 'development') {
  SERVICOS.forEach((servico) => servico.argumentos.unshift('--watch'));
}

const filhos = [];
let encerrando = false;

function repassarSaida(nome, origem, destino) {
  let pendente = '';

  origem.on('data', (pedaco) => {
    pendente += pedaco.toString();
    const linhas = pendente.split(/\r?\n/);
    pendente = linhas.pop();

    linhas.forEach((linha) => {
      if (linha.trim()) destino.write('[' + nome + '] ' + linha + '\n');
    });
  });
}

// Encerra o processo E toda a sua arvore. Os atalhos npm x dev usam "node --watch",
// que cria um processo filho; um kill simples no Windows deixaria esse filho vivo,
// segurando as portas 3001/5500 e quebrando a proxima execucao (EADDRINUSE).
function matarProcesso(filho) {
  if (!filho || filho.exitCode !== null || filho.killed) return;

  if (process.platform === 'win32') {
    spawn('taskkill', ['/pid', String(filho.pid), '/T', '/F'], { stdio: 'ignore' });
    return;
  }

  filho.kill('SIGTERM');
}

function encerrar(codigo) {
  if (encerrando) return;
  encerrando = true;

  filhos.forEach(matarProcesso);

  // Pequena espera para a saida dos filhos ser drenada antes de sair.
  setTimeout(() => process.exit(codigo), 300);
}

console.log('STMA - ambiente: ' + ambiente);
console.log('Configuracao:   ' + arquivoConfig);
console.log('');

SERVICOS.forEach((servico) => {
  const filho = spawn(process.execPath, servico.argumentos, {
    cwd: servico.diretorio,
    env: {
      ...process.env,
      STMA_ENV: ambiente,
      STMA_ENV_FILE: arquivoConfig
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });

  repassarSaida(servico.nome, filho.stdout, process.stdout);
  repassarSaida(servico.nome, filho.stderr, process.stderr);

  filho.on('error', (erro) => {
    console.error('[' + servico.nome + '] falha ao iniciar: ' + erro.message);
    encerrar(1);
  });

  filho.on('exit', (codigo) => {
    if (encerrando) return;
    console.error('[' + servico.nome + '] encerrou (codigo ' + codigo + '). Parando os demais servicos.');
    encerrar(codigo === 0 ? 1 : (codigo || 1));
  });

  filhos.push(filho);
});

process.on('SIGINT', () => encerrar(0));
process.on('SIGTERM', () => encerrar(0));
