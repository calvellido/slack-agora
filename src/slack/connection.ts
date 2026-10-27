/** The connection to Slack, as the Socket Mode client reports its state. */
export interface Connection {
  on(state: string, listener: () => void): unknown;
}

/** Calls `up` when Slack connects, and again after each reconnection, and `down` when the connection is lost or closes. */
export function followConnection(connection: Connection, up: () => void, down: () => void): void {
  connection.on('connected', up);
  for (const state of ['disconnecting', 'disconnected', 'reconnecting']) connection.on(state, down);
}
