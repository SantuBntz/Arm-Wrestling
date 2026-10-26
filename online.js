// Levanta el servidor y un túnel de cloudflared para jugar por internet.
//   npm run online
// Necesita tener instalado cloudflared (Windows: winget install Cloudflare.cloudflared).

const { spawn } = require('child_process');
require('./server');

const PORT = process.env.PORT || 3000;
const BIN = process.env.CLOUDFLARED_BIN || 'cloudflared';
const URL_RE = /https:\/\/[a-z0-9-]+\.trycloudflare\.com/i;

console.log('Abriendo el túnel de cloudflared...');
const child = spawn(BIN, ['tunnel', '--url', `http://localhost:${PORT}`], { stdio: ['ignore', 'pipe', 'pipe'] });

let announced = false;
const onOutput = chunk => {
  const match = String(chunk).match(URL_RE);
  if (!match || announced) return;
  announced = true;
  global.PUBLIC_URL = match[0];
  console.log('');
  console.log('==================================================');
  console.log('  Arm Wrestling online listo');
  console.log('  Link para jugar:  ' + match[0]);
  console.log('');
  console.log('  1. Abrí ese link en tu navegador y creá la sala.');
  console.log('  2. Pasale a tu rival el link que aparece en pantalla.');
  console.log('  Cerrá esta ventana (Ctrl+C) para apagar el túnel.');
  console.log('==================================================');
  console.log('');
};
child.stdout.on('data', onOutput);
child.stderr.on('data', onOutput); // cloudflared escribe sus logs por stderr

child.on('error', err => {
  if (err.code === 'ENOENT') {
    console.error('\nNo encontré cloudflared. Instalalo con:  winget install Cloudflare.cloudflared');
    console.error('Después cerrá y volvé a abrir la terminal. El juego local sigue andando en http://localhost:' + PORT);
  } else {
    console.error('\nNo se pudo abrir el túnel:', err.message);
  }
});

child.on('exit', code => {
  if (code !== null) console.error(`\nEl túnel se cerró (código ${code}).`);
});

const stop = () => { child.kill(); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
