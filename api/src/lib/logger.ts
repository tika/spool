type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_COLORS: Record<LogLevel, string> = {
  debug: "\x1b[90m", // gray
  info: "\x1b[36m", // cyan
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
};

const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";

function formatTimestamp(): string {
  return new Date().toISOString().slice(11, 23); // HH:mm:ss.mmm
}

function formatPrefix(prefix: string): string {
  return `${BOLD}[${prefix}]${RESET}`;
}

function formatLevel(level: LogLevel): string {
  const color = LEVEL_COLORS[level];
  return `${color}${level.toUpperCase().padEnd(5)}${RESET}`;
}

function formatMessage(level: LogLevel, prefix: string, message: string, meta?: Record<string, unknown>): string {
  const timestamp = `${DIM}${formatTimestamp()}${RESET}`;
  const parts = [timestamp, formatLevel(level), formatPrefix(prefix), message];

  if (meta && Object.keys(meta).length > 0) {
    const metaStr = Object.entries(meta)
      .map(([k, v]) => `${DIM}${k}=${RESET}${JSON.stringify(v)}`)
      .join(" ");
    parts.push(metaStr);
  }

  return parts.join(" ");
}

export interface Logger {
  debug(message: string, meta?: Record<string, unknown>): void;
  info(message: string, meta?: Record<string, unknown>): void;
  warn(message: string, meta?: Record<string, unknown>): void;
  error(message: string, meta?: Record<string, unknown>): void;
  child(subPrefix: string): Logger;
}

export function createLogger(prefix: string): Logger {
  const log = (level: LogLevel, message: string, meta?: Record<string, unknown>) => {
    const formatted = formatMessage(level, prefix, message, meta);
    if (level === "error") {
      console.error(formatted);
    } else if (level === "warn") {
      console.warn(formatted);
    } else {
      console.log(formatted);
    }
  };

  return {
    debug: (message, meta) => log("debug", message, meta),
    info: (message, meta) => log("info", message, meta),
    warn: (message, meta) => log("warn", message, meta),
    error: (message, meta) => log("error", message, meta),
    child: (subPrefix) => createLogger(`${prefix}:${subPrefix}`),
  };
}

// Pre-configured loggers for different subsystems
export const log = {
  queue: createLogger("queue"),
  worker: createLogger("worker"),
  video: createLogger("video"),
  curriculum: createLogger("curriculum"),
  api: createLogger("api"),
  db: createLogger("db"),
};
