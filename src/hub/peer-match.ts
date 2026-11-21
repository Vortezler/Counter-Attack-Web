const publishedHub = "https://kumori1313.github.io";
const localHubs = ["http://127.0.0.1:5173", "http://127.0.0.1:4175"];
const maxPacket = 32000;

interface Setup { kind: "ready" | "offer" | "answer" | "relay" | "relay-ready"; from: string; to?: string; sdp?: string }
interface Launch { host: boolean; hostName: string; peerName: string }

export class PeerMatch {
  private connection?: RTCPeerConnection;
  private channel?: RTCDataChannel;
  private remote = "";
  private remoteOffer = "";
  private epoch = crypto.randomUUID();
  private queue = Promise.resolve();
  private ended = false;
  private opened = false;
  private openedEpoch = "";
  private relayOpen = false;
  private relayRequested = false;
  private relayEpoch = "";
  private relayActive = false;
  private relayTimer = 0;
  private fallbackTimer = 0;

  get relayed() { return this.relayActive; }
  private timeout: number;
  onPacket?: (packet: unknown) => void;
  onOpen?: () => void;
  onStatus?: (message: string) => void;
  onEnd?: (message: string) => void;

  constructor(private port: MessagePort, public readonly launch: Launch) {
    this.timeout = window.setTimeout(() => {
      this.onStatus?.("Still connecting. Make sure both players have opened the match.");
    }, 25000);
    port.onmessage = ({ data }) => {
      if (data?.type === "ended") {
        this.close();
        this.onEnd?.(String(data.message || "The lobby ended."));
      } else if (data?.type === "error") {
        this.onStatus?.("Game Hub could not exchange connection details. Check the lobby tab.");
      } else if (data?.type === "relay-open") {
        this.relayOpen = true;
        clearTimeout(this.relayTimer);
        this.negotiateRelay();
      } else if (data?.type === "relay-wait") {
        this.relayOpen = false;
        this.onStatus?.("Connecting through the Game Hub relay…");
        clearTimeout(this.relayTimer);
        this.relayTimer = window.setTimeout(() => {
          if (!this.relayOpen && !this.ended) this.onStatus?.("The relay is unavailable. Return to the lobby and reopen the match.");
        }, 12000);
      } else if (data?.type === "relay-packet" && this.relayActive && data.envelope?.epoch === this.relayEpoch) {
        this.onPacket?.(data.envelope.packet);
      } else if (data?.type === "signal" && typeof data.message?.from === "string") {
        this.queue = this.queue.then(() => this.receive(data.message)).catch(() => {
          if (this.launch.host) this.requestRelay(this.epoch);
          else this.onStatus?.("Waiting for the host to try the Game Hub relay…");
        });
      }
    };
    if (!launch.host) this.sendSetup({ kind: "ready", from: this.epoch });
  }

  private sendSetup(message: Setup) {
    if (!this.ended) this.port.postMessage({ type: "signal", message });
  }

  private makeConnection() {
    this.connection?.close();
    this.channel = undefined;
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
    });
    this.connection = pc;
    pc.onconnectionstatechange = () => {
      if (this.connection !== pc || this.ended) return;
      if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        if (this.launch.host && pc.connectionState === "failed") this.requestRelay(this.epoch);
        else if (!this.relayActive) this.onStatus?.("Peer connection interrupted. Waiting for the host…");
      }
    };
    return pc;
  }

  private bindChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => {
      if (this.ended || this.channel !== channel || this.relayEpoch) return;
      clearTimeout(this.fallbackTimer);
      this.activate(this.launch.host ? this.epoch : this.remoteOffer);
    };
    channel.onmessage = event => {
      if (this.ended || this.relayActive || this.channel !== channel || typeof event.data !== "string" || event.data.length > maxPacket) return;
      let packet: unknown;
      try { packet = JSON.parse(event.data); } catch { return; }
      this.onPacket?.(packet);
    };
  }

  private activate(epoch: string) {
    clearTimeout(this.timeout);
    this.onStatus?.("");
    if (!this.opened || (!this.launch.host && this.openedEpoch !== epoch)) {
      this.opened = true;
      this.openedEpoch = epoch;
      this.onOpen?.();
    }
  }

  private requestRelay(epoch: string) {
    if (this.ended || this.relayEpoch === epoch) return;
    clearTimeout(this.fallbackTimer);
    this.relayEpoch = epoch;
    this.relayActive = false;
    this.connection?.close();
    this.connection = undefined;
    this.channel = undefined;
    this.onStatus?.("Connecting through the Game Hub relay…");
    clearTimeout(this.timeout);
    if (!this.relayRequested) {
      this.relayRequested = true;
      this.port.postMessage({ type: "relay-start" });
    }
    this.negotiateRelay();
  }

  private negotiateRelay() {
    if (this.ended || !this.relayOpen || !this.relayEpoch) return;
    if (this.launch.host) {
      this.sendSetup({ kind: "relay", from: this.relayEpoch, to: this.remote });
    } else {
      this.sendSetup({ kind: "relay-ready", from: this.epoch, to: this.relayEpoch });
      this.relayActive = true;
      this.activate(this.relayEpoch);
    }
  }

  private async description(pc: RTCPeerConnection, desc: RTCSessionDescriptionInit) {
    await pc.setLocalDescription(desc);
    if (pc.iceGatheringState !== "complete") {
      await new Promise<void>(resolve => {
        const done = () => {
          clearTimeout(timer);
          pc.removeEventListener("icegatheringstatechange", changed);
          resolve();
        };
        const changed = () => { if (pc.iceGatheringState === "complete") done(); };
        const timer = window.setTimeout(done, 4000);
        pc.addEventListener("icegatheringstatechange", changed);
        changed();
      });
    }
    if (this.connection !== pc || this.ended) return undefined;
    return pc.localDescription?.sdp;
  }

  private async receive(message: Setup) {
    if (this.ended) return;
    if (this.launch.host) {
      if (message.from !== this.remote) {
        this.remote = message.from;
        this.epoch = crypto.randomUUID();
        this.relayEpoch = "";
        this.relayActive = false;
        clearTimeout(this.fallbackTimer);
        this.fallbackTimer = window.setTimeout(() => this.requestRelay(this.epoch), 15000);
        const pc = this.makeConnection();
        this.bindChannel(pc.createDataChannel("match"));
        const sdp = await this.description(pc, await pc.createOffer());
        if (sdp) this.sendSetup({ kind: "offer", from: this.epoch, to: message.from, sdp });
      } else if (message.kind === "relay-ready" && message.to === this.relayEpoch && this.relayOpen) {
        this.relayActive = true;
        this.activate(this.relayEpoch);
      } else if (message.kind === "answer" && message.to === this.epoch && message.sdp
        && this.connection?.signalingState === "have-local-offer") {
        await this.connection.setRemoteDescription({ type: "answer", sdp: message.sdp });
      }
    } else if (message.kind === "relay" && message.to === this.epoch) {
      this.requestRelay(message.from);
    } else if (message.kind === "offer" && message.to === this.epoch && message.sdp && this.remoteOffer !== message.from) {
      this.remoteOffer = message.from;
      this.relayEpoch = "";
      this.relayActive = false;
      const pc = this.makeConnection();
      pc.ondatachannel = ({ channel }) => {
        if (this.connection === pc && channel.label === "match") this.bindChannel(channel);
        else channel.close();
      };
      await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
      const sdp = await this.description(pc, await pc.createAnswer());
      if (sdp) this.sendSetup({ kind: "answer", from: this.epoch, to: message.from, sdp });
    }
  }

  send(packet: object) {
    if (this.relayActive && this.relayOpen) {
      this.port.postMessage({ type: "relay-packet", envelope: { epoch: this.relayEpoch, packet } });
      return;
    }
    const channel = this.channel;
    if (channel?.readyState !== "open" || channel.bufferedAmount > maxPacket) return;
    const data = JSON.stringify(packet);
    if (data.length <= maxPacket) {
      try { channel.send(data); } catch { /* Closed during delivery. */ }
    }
  }

  close(leave = false) {
    if (this.ended) return;
    this.ended = true;
    clearTimeout(this.timeout);
    clearTimeout(this.fallbackTimer);
    clearTimeout(this.relayTimer);
    if (leave) this.port.postMessage({ type: "exit" });
    this.connection?.close();
    this.port.close();
  }
}

export function connectHubLaunch(): Promise<PeerMatch> | null {
  const params = new URLSearchParams(location.hash.slice(1));
  const launch = params.get("game-hub");
  if (!launch) return null;
  const origin = params.get("parent") ?? "";
  const parent = window.parent !== window ? window.parent : window.opener as Window | null;
  if (!parent || ![publishedHub, ...(location.hostname === "127.0.0.1" ? localHubs : [])].includes(origin)) {
    return Promise.reject(new Error("Open the match from its Game Hub lobby."));
  }
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => {
      window.removeEventListener("message", accept);
      reject(new Error("The lobby did not respond. Reopen the match from Game Hub."));
    }, 12000);
    function accept(event: MessageEvent) {
      if (event.origin !== origin || event.source !== parent || event.data?.type !== "cs-web-connect"
        || event.data.launch !== launch || event.ports.length !== 1 || typeof event.data.host !== "boolean") return;
      clearTimeout(timer);
      window.removeEventListener("message", accept);
      resolve(new PeerMatch(event.ports[0], event.data));
    }
    window.addEventListener("message", accept);
    parent.postMessage({ type: "cs-web-ready", launch }, origin);
  });
}
