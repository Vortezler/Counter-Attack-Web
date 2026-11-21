const publishedHub = "https://kumori1313.github.io";
const localHubs = ["http://127.0.0.1:5173", "http://127.0.0.1:4175"];
const maxPacket = 32000;

interface Setup { kind: "ready" | "offer" | "answer"; from: string; to?: string; sdp?: string }
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
  private timeout: number;
  onPacket?: (packet: unknown) => void;
  onOpen?: () => void;
  onStatus?: (message: string) => void;
  onEnd?: (message: string) => void;

  constructor(private port: MessagePort, public readonly launch: Launch) {
    this.timeout = window.setTimeout(() => {
      this.onStatus?.("No direct connection yet. Check that both players opened the match. Some networks block direct peer connections.");
    }, 25000);
    port.onmessage = ({ data }) => {
      if (data?.type === "ended") {
        this.close();
        this.onEnd?.(String(data.message || "The lobby ended."));
      } else if (data?.type === "error") {
        this.onStatus?.("Game Hub could not exchange connection details. Check the lobby tab.");
      } else if (data?.type === "signal" && typeof data.message?.from === "string") {
        this.queue = this.queue.then(() => this.receive(data.message)).catch(() => {
          this.onStatus?.("Could not connect. Reload this tab to try again.");
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
        this.onStatus?.("Peer connection lost. Keep the lobby open and reload this game tab to reconnect.");
      }
    };
    return pc;
  }

  private bindChannel(channel: RTCDataChannel) {
    this.channel = channel;
    channel.onopen = () => {
      if (this.ended || this.channel !== channel) return;
      clearTimeout(this.timeout);
      this.onStatus?.("");
      // The host keeps its simulation on a guest reconnect. A guest recreates
      // its view if the creator starts a new peer session.
      if (!this.opened || !this.launch.host) this.onOpen?.();
      this.opened = true;
    };
    channel.onmessage = event => {
      if (this.ended || this.channel !== channel || typeof event.data !== "string" || event.data.length > maxPacket) return;
      let packet: unknown;
      try { packet = JSON.parse(event.data); } catch { return; }
      this.onPacket?.(packet);
    };
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
        const pc = this.makeConnection();
        this.bindChannel(pc.createDataChannel("match"));
        const sdp = await this.description(pc, await pc.createOffer());
        if (sdp) this.sendSetup({ kind: "offer", from: this.epoch, to: message.from, sdp });
      } else if (message.kind === "answer" && message.to === this.epoch && message.sdp
        && this.connection?.signalingState === "have-local-offer") {
        await this.connection.setRemoteDescription({ type: "answer", sdp: message.sdp });
      }
    } else if (message.kind === "offer" && message.to === this.epoch && message.sdp && this.remoteOffer !== message.from) {
      this.remoteOffer = message.from;
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
  const parent = window.opener as Window | null;
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
