const path = require('path');
const readline = require('readline');
const { connectDB } = require(path.join(__dirname, '..', 'backend', 'utils', 'database'));
const { hashPassword } = require(path.join(__dirname, '..', 'backend', 'utils', 'auth'));
const User = require(path.join(__dirname, '..', 'backend', 'models', 'User'));

const ADMIN_ROLES = new Set(['admin', 'super_admin']);

function parseArgs(argv) {
  const args = { reset: false, forceProduction: false, positional: [] };
  for (const a of argv) {
    if (a === '--reset') args.reset = true;
    else if (a === '--force-production') args.forceProduction = true;
    else args.positional.push(a);
  }
  return args;
}

function promptHidden(question) {
  return new Promise((resolve) => {
    process.stdout.write(question);
    const stdin = process.stdin;
    if (!stdin.isTTY) {
      let data = '';
      stdin.setEncoding('utf8');
      stdin.on('data', (chunk) => { data += chunk; });
      stdin.on('end', () => resolve(data.replace(/\r?\n$/, '')));
      return;
    }
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding('utf8');
    let password = '';
    const onData = (char) => {
      if (char === '\r' || char === '\n') {
        stdin.setRawMode(false);
        stdin.pause();
        stdin.removeListener('data', onData);
        process.stdout.write('\n');
        resolve(password);
      } else if (char === '\u0003') {
        process.exit(130);
      } else if (char === '\u007f' || char === '\b') {
        if (password.length > 0) {
          password = password.slice(0, -1);
          process.stdout.write('\b \b');
        }
      } else {
        password += char;
        process.stdout.write('*');
      }
    };
    stdin.on('data', onData);
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.positional[0];

  if (process.env.NODE_ENV === 'production' && !args.forceProduction) {
    console.error('Refusing to run in production without --force-production');
    process.exit(1);
  }

  if (!email) {
    console.error('Usage: node scripts/create-admin.js <email> [--reset] [--force-production]');
    process.exit(1);
  }

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden('Password: ');
  }

  if (typeof password !== 'string' || password.length < 14) {
    console.error('Password must be at least 14 characters');
    process.exit(1);
  }

  await connectDB();

  const existing = await User.findOne({ email });

  if (existing && ADMIN_ROLES.has(existing.role) && !args.reset) {
    console.error('Admin already exists for this email. Use --reset to overwrite.');
    process.exit(1);
  }

  if (existing && !args.reset) {
    existing.role = 'super_admin';
    existing.status = 'active';
    existing.password = password;
    await existing.save();
    console.log('Promoted existing user to admin:', email);
    process.exit(0);
  }

  if (existing && args.reset) {
    existing.role = 'super_admin';
    existing.status = 'active';
    existing.password = password;
    await existing.save();
    console.log('Admin reset:', email);
    process.exit(0);
  }

  const admin = new User({
    name: 'Admin',
    email,
    password,
    phone: '0000000000',
    role: 'super_admin',
    status: 'active'
  });
  await admin.save();
  console.log('Admin created:', email);
  process.exit(0);
}

main().catch((err) => {
  console.error('Failed to create admin:', err.message);
  process.exit(1);
});
