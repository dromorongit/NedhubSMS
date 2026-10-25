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

async function createAdmin({ email, password, reset = false, forceProduction = false, env = process.env, UserModel = User }) {
  if (env.NODE_ENV === 'production' && !forceProduction) {
    throw new Error('Refusing to run in production without --force-production');
  }

  if (!email) {
    throw new Error('Usage: node scripts/create-admin.js <email> [--reset] [--force-production]');
  }

  if (typeof password !== 'string' || password.length < 14) {
    throw new Error('Password must be at least 14 characters');
  }

  const existing = await UserModel.findOne({ email });

  if (existing && ADMIN_ROLES.has(existing.role) && !reset) {
    throw new Error('Admin already exists for this email. Use --reset to overwrite.');
  }

  if (existing && !reset) {
    existing.role = 'super_admin';
    existing.status = 'active';
    existing.password = password;
    await existing.save();
    return { action: 'promoted', email };
  }

  if (existing && reset) {
    existing.role = 'super_admin';
    existing.status = 'active';
    existing.password = password;
    await existing.save();
    return { action: 'reset', email };
  }

  const admin = new UserModel({
    name: 'Admin',
    email,
    password,
    phone: '0000000000',
    role: 'super_admin',
    status: 'active'
  });
  await admin.save();
  return { action: 'created', email };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const email = args.positional[0];

  let password = process.env.ADMIN_PASSWORD;
  if (!password) {
    password = await promptHidden('Password: ');
  }

  try {
    const result = await createAdmin({
      email,
      password,
      reset: args.reset,
      forceProduction: args.forceProduction,
      env: process.env,
      UserModel: User
    });
    if (result.action === 'promoted') console.log('Promoted existing user to admin:', result.email);
    else if (result.action === 'reset') console.log('Admin reset:', result.email);
    else console.log('Admin created:', result.email);
    process.exit(0);
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error('Failed to create admin:', err.message);
    process.exit(1);
  });
}

module.exports = { createAdmin, parseArgs };
