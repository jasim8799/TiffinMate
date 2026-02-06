const userMutexes = new Map();

class UserMutex {
  constructor(userId) {
    this.userId = userId;
    this.queue = [];
    this.processing = false;
  }

  async acquire() {
    return new Promise((resolve) => {
      this.queue.push(resolve);
      this.process();
    });
  }

  async process() {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;
    const resolve = this.queue.shift();
    resolve();
  }

  release() {
    this.processing = false;
    this.process();
  }
}

function getUserMutex(userId) {
  if (!userMutexes.has(userId)) {
    userMutexes.set(userId, new UserMutex(userId));
  }
  return userMutexes.get(userId);
}

module.exports = { getUserMutex };
