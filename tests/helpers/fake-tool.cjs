// A stand-in "formatter" used by the tests. It never touches anything but its own arguments.
const fs = require('node:fs');

const [mode, ...rest] = process.argv.slice(2);

function readStdin() {
  return fs.readFileSync(0, 'utf8');
}

switch (mode) {
  case '--version':
    process.stdout.write('faketool 1.2.3\n');
    break;
  case 'upper':
    process.stdout.write(readStdin().toUpperCase());
    break;
  case 'echo':
    process.stdout.write(readStdin());
    break;
  case 'args':
    readStdin();
    process.stdout.write(JSON.stringify(rest));
    break;
  case 'env':
    readStdin();
    process.stdout.write(String(process.env[rest[0]] ?? ''));
    break;
  case 'fail':
    readStdin();
    process.stderr.write('input.txt:3:7: error: unexpected token\nsecond line of detail\n');
    process.exit(3);
    break;
  case 'empty':
    readStdin();
    break;
  case 'hang':
    setInterval(() => undefined, 1000);
    break;
  case 'rewrite': {
    const file = rest[0];
    fs.writeFileSync(file, fs.readFileSync(file, 'utf8').toUpperCase());
    break;
  }
  case 'cwd':
    readStdin();
    process.stdout.write(process.cwd());
    break;
  default:
    process.stderr.write(`unknown mode ${mode}\n`);
    process.exit(64);
}
