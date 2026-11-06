// A first-come, first-served line in front of the model. HFee answers a few
// conversations at once (MAX_PARALLEL); everyone else waits here and is told their place.

const slots = Number(process.env.MAX_PARALLEL) || 1;
let running = 0;
const waiting = [];

function announce() {
  waiting.forEach((w, i) => w.onPosition(i + 1));
}

function next() {
  while (running < slots && waiting.length) {
    running++;
    waiting.shift().start();
  }
  announce();
}

// acquire resolves with a release function once it's the caller's turn.
// onPosition is called with the caller's place in line while waiting.
export function acquire(onPosition, signal) {
  return new Promise((resolve, reject) => {
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      running--;
      next();
    };

    const entry = { onPosition, start: () => resolve(release) };
    waiting.push(entry);

    signal?.addEventListener('abort', () => {
      const i = waiting.indexOf(entry);
      if (i >= 0) {
        waiting.splice(i, 1);
        announce();
        reject(signal.reason);
      }
    });

    next();
  });
}
