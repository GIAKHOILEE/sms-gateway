import { GatewayConnectionState } from '../types/sms.types';

export interface GatewaySocketClientOptions {
  serverUrl: string;
  deviceId: string;
  deviceSecret: string;
  appVersion?: string;
  defaultSmsSubId?: number;
  connectTimeoutMs?: number;
  heartbeatIntervalMs?: number;
  heartbeatTimeoutMs?: number;
  stableResetMs?: number;
  maxRetryDelayMs?: number;
  allowInsecureWsInDev?: boolean;
  onStateChange?: (
    state: GatewayConnectionState,
    statusMessage: string,
  ) => void;
  onLog?: (
    level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS',
    message: string,
  ) => void;
  onAuthenticated?: (data: Record<string, any>) => void;
  onServerEvent?: (event: string, data: any) => void;
}

const TERMINAL_CLOSE_CODES = new Set([4001, 4003, 4009]);

export function computeBackoffDelayWithJitter(
  attempt: number,
  maxRetryDelayMs = 60_000,
  randomFn: () => number = Math.random,
): number {
  const safeAttempt = Math.max(0, Math.min(attempt, 10));
  // 1s, 2s, 4s, 8s, 16s, 32s, capped at maxRetryDelayMs (default 60s)
  const baseDelayMs = Math.min(maxRetryDelayMs, 1000 * Math.pow(2, safeAttempt));
  // Apply +/- 20% random jitter, capped at maxRetryDelayMs
  const jitterFactor = 0.8 + randomFn() * 0.4;
  return Math.min(
    maxRetryDelayMs,
    Math.max(500, Math.round(baseDelayMs * jitterFactor)),
  );
}

export class GatewaySocketClient {
  private options: GatewaySocketClientOptions;
  private state: GatewayConnectionState = 'DISCONNECTED';
  private userRequestedConnect = false;
  private isNetworkAvailable = true;
  private socket: WebSocket | null = null;
  private currentAttemptToken = 0;
  private retryAttempt = 0;

  private connectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private pongTimeoutTimer: ReturnType<typeof setTimeout> | null = null;
  private stabilityResetTimer: ReturnType<typeof setTimeout> | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options: GatewaySocketClientOptions) {
    this.options = options;
  }

  public updateOptions(partial: Partial<GatewaySocketClientOptions>): void {
    const prevUrl = this.options.serverUrl;
    const prevDeviceId = this.options.deviceId;
    const prevSecret = this.options.deviceSecret;
    this.options = { ...this.options, ...partial };

    // If currently reconnecting and credentials/URL changed, trigger immediate reconnect with new config
    if (
      this.userRequestedConnect &&
      (this.state === 'RECONNECTING' || this.state === 'CONNECTING') &&
      (this.options.serverUrl !== prevUrl ||
        this.options.deviceId !== prevDeviceId ||
        this.options.deviceSecret !== prevSecret)
    ) {
      this.retryAttempt = 0;
      this.clearReconnectTimer();
      this.openSocketInternal(true);
    }
  }

  public getState(): GatewayConnectionState {
    return this.state;
  }

  public getRetryAttempt(): number {
    return this.retryAttempt;
  }

  public isUserActive(): boolean {
    return this.userRequestedConnect;
  }

  /**
   * Explicitly initiated by the user tapping Connect.
   * Protected against duplicate connections.
   */
  public connect(): void {
    if (
      this.state === 'CONNECTING' ||
      this.state === 'AUTHENTICATING' ||
      this.state === 'CONNECTED'
    ) {
      this.log('WARN', `Bỏ qua lệnh kết nối trùng lặp (đang ở trạng thái ${this.state}).`);
      return;
    }

    const url = (this.options.serverUrl || '').trim();
    const deviceId = (this.options.deviceId || '').trim();
    const secret = (this.options.deviceSecret || '').trim();

    if (!url || !deviceId || !secret) {
      this.log(
        'ERROR',
        'Thiếu cấu hình địa chỉ máy chủ, Mã thiết bị hoặc Khóa bí mật.',
      );
      this.setState(
        'DISCONNECTED',
        'Thiếu địa chỉ máy chủ, Mã thiết bị hoặc Khóa bí mật.',
      );
      return;
    }

    const isPrivateLanWs =
      /^ws:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/i.test(
        url,
      );
    const allowWs =
      (this.options.allowInsecureWsInDev ?? __DEV__) || isPrivateLanWs;
    if (!url.startsWith('wss://') && !(allowWs && url.startsWith('ws://'))) {
      this.log(
        'ERROR',
        'Địa chỉ kết nối phải sử dụng giao thức bảo mật wss:// (TLS).',
      );
      this.setState(
        'DISCONNECTED',
        'Địa chỉ không hợp lệ: bắt buộc dùng giao thức wss://.',
      );
      return;
    }

    this.userRequestedConnect = true;
    this.retryAttempt = 0;
    this.clearReconnectTimer();
    this.openSocketInternal(false);
  }

  /**
   * Explicitly initiated by the user tapping Disconnect or closing the app.
   */
  public disconnect(reason = 'USER_DISCONNECT'): void {
    this.userRequestedConnect = false;
    this.retryAttempt = 0;
    this.clearAllTimers();

    const activeSocket = this.socket;
    this.socket = null;
    this.currentAttemptToken++;

    if (activeSocket) {
      try {
        if (activeSocket.readyState === WebSocket.OPEN) {
          activeSocket.send(
            JSON.stringify({
              event: 'device:disconnect',
              data: { reason },
              timestamp: Date.now(),
            }),
          );
        }
        activeSocket.onopen = null;
        activeSocket.onmessage = null;
        activeSocket.onerror = null;
        activeSocket.onclose = null;
        activeSocket.close(1000, reason);
      } catch {
        // Ignore close errors
      }
    }

    this.setState('DISCONNECTED', 'Chưa kết nối. Trạm SMS đang ngoại tuyến.');
    this.log('INFO', `Đã đóng kết nối WebSocket (${reason}).`);
  }

  /**
   * Called when native network state changes while the app is open.
   */
  public handleNetworkChange(isConnected: boolean, transport: string): void {
    const prev = this.isNetworkAvailable;
    this.isNetworkAvailable = isConnected;

    if (!this.userRequestedConnect) {
      return;
    }

    if (!isConnected && prev) {
      this.log(
        'WARN',
        `Mạng thiết bị bị gián đoạn (${transport}). Chờ có mạng lại để kết nối...`,
      );
      this.clearConnectionTimers();
      this.disposeCurrentSocket();
      this.setState(
        'RECONNECTING',
        'Mất kết nối mạng. Đang chờ mạng phục hồi...',
      );
      return;
    }

    if (isConnected && !prev) {
      this.log(
        'INFO',
        `Đã có kết nối mạng trở lại (${transport}). Thực hiện kết nối lại ngay...`,
      );
      if (this.state !== 'CONNECTED' && this.state !== 'CONNECTING') {
        this.clearReconnectTimer();
        this.openSocketInternal(true);
      }
    }
  }

  public sendEvent(event: string, data: Record<string, any>): boolean {
    if (
      !this.socket ||
      this.socket.readyState !== WebSocket.OPEN ||
      this.state !== 'CONNECTED'
    ) {
      return false;
    }
    try {
      this.socket.send(
        JSON.stringify({
          event,
          data,
          timestamp: Date.now(),
        }),
      );
      return true;
    } catch (err: any) {
      this.log('ERROR', `Lỗi gửi gói tin '${event}': ${err?.message}`);
      return false;
    }
  }

  private openSocketInternal(isReconnect: boolean): void {
    if (!this.userRequestedConnect) {
      return;
    }

    // Prevent any duplicate socket from lingering
    this.clearConnectionTimers();
    this.disposeCurrentSocket();

    const attemptToken = ++this.currentAttemptToken;
    let url = this.options.serverUrl.trim();
    const allowWs = this.options.allowInsecureWsInDev ?? __DEV__;
    if (
      allowWs &&
      url.startsWith('wss://') &&
      /^wss:\/\/(localhost|127\.0\.0\.1|10\.|192\.168\.|172\.(1[6-9]|2[0-9]|3[0-1])\.)/i.test(
        url,
      )
    ) {
      url = 'ws://' + url.slice('wss://'.length);
      this.log(
        'INFO',
        `Phát hiện IP LAN/Local ở chế độ DEV (không dùng TLS): tự động chuyển sang ${url}`,
      );
    }
    const connectTimeoutMs = this.options.connectTimeoutMs ?? 10_000;

    this.setState(
      isReconnect ? 'RECONNECTING' : 'CONNECTING',
      isReconnect
        ? `Đang kết nối lại máy chủ (lần #${this.retryAttempt + 1})...`
        : 'Đang kết nối tới máy chủ...',
    );

    this.log(
      'INFO',
      `${isReconnect ? 'Đang kết nối lại' : 'Đang mở kết nối'} tới ${url}...`,
    );

    let ws: WebSocket;
    try {
      ws = new WebSocket(url);
    } catch (err: any) {
      this.log('ERROR', `Không thể khởi tạo WebSocket: ${err?.message}`);
      this.scheduleReconnect('WS_CONSTRUCTOR_ERROR');
      return;
    }

    this.socket = ws;

    this.connectTimer = setTimeout(() => {
      if (this.currentAttemptToken !== attemptToken) {
        return;
      }
      this.log('WARN', `Quá thời gian chờ kết nối/xác thực (${connectTimeoutMs}ms).`);
      this.disposeCurrentSocket();
      this.scheduleReconnect('CONNECT_TIMEOUT');
    }, connectTimeoutMs);

    ws.onopen = () => {
      if (this.currentAttemptToken !== attemptToken) {
        return;
      }
      this.setState('AUTHENTICATING', 'Đang xác thực thiết bị...');
      this.log('INFO', 'Đã mở kênh kết nối. Đang gửi thông tin xác thực thiết bị...');

      try {
        ws.send(
          JSON.stringify({
            event: 'device:auth',
            data: {
              deviceId: this.options.deviceId.trim(),
              secret: this.options.deviceSecret.trim(),
              appVersion: this.options.appVersion ?? '1.0.0',
              defaultSmsSubId: this.options.defaultSmsSubId,
            },
            timestamp: Date.now(),
          }),
        );
      } catch (err: any) {
        this.log('ERROR', `Gửi gói xác thực thất bại: ${err?.message}`);
        this.disposeCurrentSocket();
        this.scheduleReconnect('AUTH_SEND_FAILED');
      }
    };

    ws.onmessage = (evt: WebSocketMessageEvent) => {
      if (this.currentAttemptToken !== attemptToken) {
        return;
      }
      this.handleRawMessage(String(evt.data || ''));
    };

    ws.onerror = (evt: any) => {
      if (this.currentAttemptToken !== attemptToken) {
        return;
      }
      const errMsg = evt?.message || 'Lỗi kết nối WebSocket';
      this.log('WARN', `Lỗi WebSocket: ${errMsg}`);
    };

    ws.onclose = (evt: WebSocketCloseEvent) => {
      if (this.currentAttemptToken !== attemptToken) {
        return;
      }
      this.clearConnectionTimers();
      this.socket = null;

      const code = evt?.code ?? 1006;
      const reason = evt?.reason || 'SOCKET_CLOSED';

      if (!this.userRequestedConnect) {
        this.setState('DISCONNECTED', 'Chưa kết nối. Trạm SMS đang ngoại tuyến.');
        return;
      }

      if (TERMINAL_CLOSE_CODES.has(code)) {
        this.userRequestedConnect = false;
        this.retryAttempt = 0;
        this.log(
          'ERROR',
          `Kết nối bị từ chối bởi máy chủ (mã=${code}, lý do=${reason}). Đã dừng tự động kết nối lại.`,
        );
        this.setState(
          'DISCONNECTED',
          `Ngắt kết nối (${reason}). Vui lòng kiểm tra lại Mã thiết bị và Khóa bí mật.`,
        );
        return;
      }

      this.log(
        'WARN',
        `Kết nối WebSocket bị đóng (mã=${code}, lý do=${reason}).`,
      );
      this.scheduleReconnect(`CLOSED_${code}`);
    };
  }

  private handleRawMessage(raw: string): void {
    let parsed: { event?: string; data?: any };
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }

    const event = parsed?.event;
    const data = parsed?.data || {};

    if (!event) {
      return;
    }

    if (event === 'device:auth:ok') {
      if (this.connectTimer) {
        clearTimeout(this.connectTimer);
        this.connectTimer = null;
      }

      this.setState('CONNECTED', 'Đã kết nối máy chủ. Sẵn sàng gửi SMS.');
      this.log(
        'SUCCESS',
        `Xác thực thành công (${data.deviceId || this.options.deviceId}). Đã kết nối máy chủ, sẵn sàng gửi SMS.`,
      );

      this.startHeartbeatLoop();
      this.startStabilityResetTimer();
      this.options.onAuthenticated?.(data);
      return;
    }

    if (event === 'device:auth:error') {
      this.log(
        'ERROR',
        `Xác thực thiết bị thất bại (${data.reason || 'UNAUTHORIZED'}): ${data.message || ''}`,
      );
      if (TERMINAL_CLOSE_CODES.has(Number(data.code))) {
        this.userRequestedConnect = false;
        this.disposeCurrentSocket();
        this.setState(
          'DISCONNECTED',
          `Xác thực thất bại: ${data.reason || 'Sai thông tin thiết bị'}`,
        );
      }
      return;
    }

    if (event === 'device:pong') {
      if (this.pongTimeoutTimer) {
        clearTimeout(this.pongTimeoutTimer);
        this.pongTimeoutTimer = null;
      }
      return;
    }

    if (event === 'device:disconnect_notice') {
      this.log(
        'WARN',
        `Máy chủ yêu cầu ngắt kết nối: ${data.reason || 'SERVER_NOTICE'}`,
      );
      return;
    }

    this.options.onServerEvent?.(event, data);
  }

  private startHeartbeatLoop(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
    }
    const intervalMs = this.options.heartbeatIntervalMs ?? 20_000;
    const pongTimeoutMs = this.options.heartbeatTimeoutMs ?? 10_000;

    this.heartbeatTimer = setInterval(() => {
      if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
        return;
      }
      const token = this.currentAttemptToken;
      this.sendEvent('device:ping', { timestamp: Date.now() });

      if (this.pongTimeoutTimer) {
        clearTimeout(this.pongTimeoutTimer);
      }
      this.pongTimeoutTimer = setTimeout(() => {
        if (this.currentAttemptToken !== token) {
          return;
        }
        this.log('WARN', 'Không nhận được phản hồi nhịp tim từ máy chủ. Đang kết nối lại...');
        this.disposeCurrentSocket();
        this.scheduleReconnect('HEARTBEAT_TIMEOUT');
      }, pongTimeoutMs);
    }, intervalMs);
  }

  private startStabilityResetTimer(): void {
    if (this.stabilityResetTimer) {
      clearTimeout(this.stabilityResetTimer);
    }
    const stableMs = this.options.stableResetMs ?? 10_000;
    this.stabilityResetTimer = setTimeout(() => {
      if (this.state === 'CONNECTED' && this.retryAttempt > 0) {
        this.retryAttempt = 0;
        this.log('INFO', 'Kết nối ổn định: đã đặt lại bộ đếm thử lại về 0.');
      }
    }, stableMs);
  }

  private scheduleReconnect(triggerReason: string): void {
    if (!this.userRequestedConnect) {
      this.setState('DISCONNECTED', 'Chưa kết nối. Trạm SMS đang ngoại tuyến.');
      return;
    }

    if (!this.isNetworkAvailable) {
      this.setState(
        'RECONNECTING',
        'Mất kết nối mạng. Đang chờ mạng phục hồi...',
      );
      return;
    }

    this.clearReconnectTimer();
    const maxRetryDelayMs = this.options.maxRetryDelayMs ?? 60_000;
    const delayMs = computeBackoffDelayWithJitter(
      this.retryAttempt,
      maxRetryDelayMs,
    );
    this.retryAttempt++;

    const delaySec = (delayMs / 1000).toFixed(1);
    this.setState(
      'RECONNECTING',
      `Tự động kết nối lại sau ${delaySec} giây (lần #${this.retryAttempt})...`,
    );
    this.log(
      'INFO',
      `[${triggerReason}] Sẽ thử kết nối lại sau ${delaySec} giây (lần thử #${this.retryAttempt})...`,
    );

    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.openSocketInternal(true);
    }, delayMs);
  }

  private disposeCurrentSocket(): void {
    const ws = this.socket;
    this.socket = null;
    if (!ws) {
      return;
    }
    try {
      ws.onopen = null;
      ws.onmessage = null;
      ws.onerror = null;
      ws.onclose = null;
      ws.close();
    } catch {
      // Ignore
    }
  }

  private clearConnectionTimers(): void {
    if (this.connectTimer) {
      clearTimeout(this.connectTimer);
      this.connectTimer = null;
    }
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
    if (this.pongTimeoutTimer) {
      clearTimeout(this.pongTimeoutTimer);
      this.pongTimeoutTimer = null;
    }
    if (this.stabilityResetTimer) {
      clearTimeout(this.stabilityResetTimer);
      this.stabilityResetTimer = null;
    }
  }

  private clearReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private clearAllTimers(): void {
    this.clearConnectionTimers();
    this.clearReconnectTimer();
  }

  private setState(
    nextState: GatewayConnectionState,
    statusMessage: string,
  ): void {
    this.state = nextState;
    this.options.onStateChange?.(nextState, statusMessage);
  }

  private log(
    level: 'INFO' | 'WARN' | 'ERROR' | 'SUCCESS',
    message: string,
  ): void {
    this.options.onLog?.(level, message);
  }
}

