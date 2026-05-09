export class HalfInningMemory {
  constructor({ cap = 12 } = {}) {
    this.cap = cap;
    this.scripts = [];
    this._key = null;
  }

  observe({ inning, half }) {
    const key = `${inning}-${half}`;
    if (this._key !== null && this._key !== key) {
      this.scripts = [];
    }
    this._key = key;
  }

  push(script) {
    this.scripts.push(script);
    if (this.scripts.length > this.cap) this.scripts.shift();
  }
}
