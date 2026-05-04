function safeStringify(value) {
  try {
    return JSON.stringify(value);
  } catch {
    return "[unserializable]";
  }
}

export class Logger {
  constructor({ runId }) {
    this.runId = runId;
  }

  stage(name, { input, output, latency_ms } = {}) {
    const summary =
      output && typeof output === "object"
        ? Object.entries(output)
            .slice(0, 3)
            .map(([k, v]) =>
              typeof v === "object" ? `${k}=${safeStringify(v).slice(0, 30)}` : `${k}=${v}`,
            )
            .join(" ")
        : String(output);
    console.log(`[${this.runId}] ${name} ${latency_ms}ms ${summary}`);
  }

  info(event, data = {}) {
    console.log(`[${this.runId}] ${event} ${safeStringify(data)}`);
  }

  error(event, data = {}) {
    console.error(`[${this.runId}] ERROR ${event} ${safeStringify(data)}`);
  }
}
