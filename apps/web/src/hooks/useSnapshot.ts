import { useEffect, useRef, useState } from 'react';
import type { RoleSnapshot } from '@quizzical/shared';
import { getToken, wsUrl, type AuthRole } from '../lib/api';

const PING_MS = 15_000;
const BASE_RETRY_MS = 1_000;
const MAX_RETRY_MS = 30_000;

export function useSnapshot(role: AuthRole, eventId?: string) {
  const [snapshot, setSnapshot] = useState<RoleSnapshot | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    const token = getToken(role);
    if (!token) return;

    let disposed = false;
    let attempt = 0;
    let pingTimer: ReturnType<typeof setInterval> | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let socket: WebSocket | null = null;

    function clearTimers() {
      if (pingTimer) {
        clearInterval(pingTimer);
        pingTimer = null;
      }
      if (retryTimer) {
        clearTimeout(retryTimer);
        retryTimer = null;
      }
    }

    function scheduleReconnect() {
      if (disposed) return;
      const delay = Math.min(
        MAX_RETRY_MS,
        BASE_RETRY_MS * 2 ** Math.min(attempt, 5),
      );
      attempt += 1;
      retryTimer = setTimeout(connect, delay);
    }

    function connect() {
      if (disposed) return;
      clearTimers();

      const authToken = getToken(role);
      if (!authToken) {
        setConnected(false);
        scheduleReconnect();
        return;
      }

      if (socket) {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }

      const ws = new WebSocket(wsUrl(authToken, eventId));
      socket = ws;
      wsRef.current = ws;

      ws.onopen = () => {
        if (disposed || socket !== ws) return;
        attempt = 0;
        setConnected(true);
        ws.send(JSON.stringify({ type: 'auth', token: authToken }));
        pingTimer = setInterval(() => {
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(JSON.stringify({ type: 'ping' }));
          }
        }, PING_MS);
      };

      ws.onmessage = (ev) => {
        if (disposed || socket !== ws) return;
        try {
          const msg = JSON.parse(ev.data);
          if (msg.type === 'snapshot') setSnapshot(msg.payload);
        } catch {
          /* ignore */
        }
      };

      ws.onerror = () => {
        // onclose handles retry
      };

      ws.onclose = () => {
        if (socket !== ws) return;
        setConnected(false);
        clearTimers();
        if (!disposed) scheduleReconnect();
      };
    }

    connect();

    // Retry when the tab comes back online / visible
    const onOnline = () => {
      if (disposed) return;
      if (socket?.readyState === WebSocket.OPEN) return;
      attempt = 0;
      connect();
    };
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return;
      onOnline();
    };
    window.addEventListener('online', onOnline);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      disposed = true;
      clearTimers();
      window.removeEventListener('online', onOnline);
      document.removeEventListener('visibilitychange', onVisible);
      if (socket) {
        socket.onopen = null;
        socket.onclose = null;
        socket.onerror = null;
        socket.onmessage = null;
        try {
          socket.close();
        } catch {
          /* ignore */
        }
      }
      wsRef.current = null;
      setConnected(false);
    };
  }, [role, eventId]);

  return { snapshot, connected };
}
