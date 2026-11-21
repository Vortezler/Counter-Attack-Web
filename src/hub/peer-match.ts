const publishedHub = "https://kumori1313.github.io";
const localHubs = ["http://127.0.0.1:5173", "http://127.0.0.1:4175"];
const maxPacket = 32000;

interface Setup {
  kind: "ready" | "offer" | "answer" | "relay" | "relay-ready";
  from: string;
  to?: string;
  sdp?: string;
  candidates?: RTCIceCandidateInit[];
}
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
  private readonly remoteCandidates = new Set<string>();

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
    this.remoteCandidates.clear();
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: "stun:stun.l.google.com:19302" },
        { urls: "stun:stun.cloudflare.com:3478" },
      ],
    });
    this.connection = pc;
    pc.onconnectionstatechange = () => {
      if (this.connection !== pc || this.ended) return;
      if (pc.connectionState === "connected" && this.channel?.readyState === "open") {
        clearTimeout(this.fallbackTimer);
        this.onStatus?.("");
      } else if (pc.connectionState === "failed" || pc.connectionState === "disconnected") {
        this.onStatus?.("Peer connection interrupted. Waiting for the host…");
        if (this.launch.host && this.opened) {
          clearTimeout(this.fallbackTimer);
          const epoch = this.epoch;
          this.fallbackTimer = window.setTimeout(() => {
            if (this.connection === pc && pc.connectionState !== "connected") this.requestRelay(epoch);
          }, 5000);
        }
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

  private async sendDescription(
    pc: RTCPeerConnection, kind: "offer" | "answer", from: string, to: string,
  ) {
    const description = kind === "offer" ? await pc.createOffer() : await pc.createAnswer();
    if (this.connection !== pc || this.ended) return;
    const candidates: RTCIceCandidateInit[] = [];
    let published = false;
    let flushTimer = 0;
    const publish = () => {
      flushTimer = 0;
      if (!published || this.connection !== pc || this.ended) return;
      this.sendSetup({ kind, from, to, sdp: pc.localDescription?.sdp ?? description.sdp, candidates });
    };
    pc.onicecandidate = ({ candidate }) => {
      if (!candidate || this.connection !== pc || candidates.length >= 24) return;
      candidates.push(candidate.toJSON());
      if (!flushTimer) flushTimer = window.setTimeout(publish, 100);
    };
    await pc.setLocalDescription(description);
    published = true;
    clearTimeout(flushTimer);
    publish();
  }

  private async addCandidates(pc: RTCPeerConnection, message: Setup) {
    if (!Array.isArray(message.candidates)) return;
    for (const candidate of message.candidates.slice(0, 24)) {
      if (this.connection !== pc || this.ended) return;
      if (!candidate || typeof candidate.candidate !== "string"
        || candidate.candidate.length > 1024) continue;
      const key = candidate.candidate;
      if (this.remoteCandidates.has(key) || pc.remoteDescription?.sdp.includes(key)) continue;
      this.remoteCandidates.add(key);
      // A network interface may disappear while gathering. Keep processing
      // the other candidates if this one cannot be added.
      try { await pc.addIceCandidate(candidate); } catch { /* Unusable candidate. */ }
    }
  }

  private async receive(message: Setup) {
    if (this.ended) return;
    if (this.launch.host) {
      if (message.from !== this.remote) {
        if (message.kind !== "ready" && message.kind !== "answer" && message.kind !== "relay-ready") return;
        this.remote = message.from;
        this.epoch = crypto.randomUUID();
        this.relayEpoch = "";
        this.relayActive = false;
        clearTimeout(this.fallbackTimer);
        const epoch = this.epoch;
        this.fallbackTimer = window.setTimeout(() => this.requestRelay(epoch), 18000);
        const pc = this.makeConnection();
        this.bindChannel(pc.createDataChannel("match"));
        await this.sendDescription(pc, "offer", epoch, message.from);
      } else if (message.kind === "relay-ready" && message.to === this.relayEpoch && this.relayOpen) {
        this.relayActive = true;
        this.activate(this.relayEpoch);
      } else if (message.kind === "answer" && message.to === this.epoch && message.sdp && this.connection) {
        const pc = this.connection;
        if (pc.signalingState === "have-local-offer") {
          await pc.setRemoteDescription({ type: "answer", sdp: message.sdp });
        }
        await this.addCandidates(pc, message);
      }
    } else if (message.kind === "relay" && message.to === this.epoch) {
      this.requestRelay(message.from);
    } else if (message.kind === "offer" && message.to === this.epoch && message.sdp) {
      if (this.remoteOffer === message.from) {
        if (this.connection) await this.addCandidates(this.connection, message);
        return;
      }
      this.remoteOffer = message.from;
      this.relayEpoch = "";
      this.relayActive = false;
      const pc = this.makeConnection();
      pc.ondatachannel = ({ channel }) => {
        if (this.connection === pc && channel.label === "match") this.bindChannel(channel);
        else channel.close();
      };
      await pc.setRemoteDescription({ type: "offer", sdp: message.sdp });
      await this.addCandidates(pc, message);
      await this.sendDescription(pc, "answer", this.epoch, message.from);
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
