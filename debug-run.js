process.env.NODE_ENV = 'test';
process.env.PORT = '49991';
process.env.JWT_SECRET = 'a'.repeat(64);
process.env.MONGODB_URI = 'mongodb://localhost:1/test';
process.env.REDIS_HOST = '127.0.0.1';
process.env.REDIS_PORT = '6379';
require('./server/index.js');
