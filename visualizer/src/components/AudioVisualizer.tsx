import { useRef, useEffect } from "react";
import * as THREE from "three";
import { io, Socket } from "socket.io-client";

// ── Shaders ────────────────────────────────────────────────────────────

const vertexShader = /* glsl */ `
  uniform float u_time;
  uniform float u_frequency;

  vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
  vec4 permute(vec4 x) { return mod289(((x * 34.0) + 10.0) * x); }
  vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }
  vec3 fade(vec3 t) { return t * t * t * (t * (t * 6.0 - 15.0) + 10.0); }

  float pnoise(vec3 P, vec3 rep) {
    vec3 Pi0 = mod(floor(P), rep);
    vec3 Pi1 = mod(Pi0 + vec3(1.0), rep);
    Pi0 = mod289(Pi0);
    Pi1 = mod289(Pi1);
    vec3 Pf0 = fract(P);
    vec3 Pf1 = Pf0 - vec3(1.0);
    vec4 ix = vec4(Pi0.x, Pi1.x, Pi0.x, Pi1.x);
    vec4 iy = vec4(Pi0.yy, Pi1.yy);
    vec4 iz0 = Pi0.zzzz;
    vec4 iz1 = Pi1.zzzz;
    vec4 ixy = permute(permute(ix) + iy);
    vec4 ixy0 = permute(ixy + iz0);
    vec4 ixy1 = permute(ixy + iz1);
    vec4 gx0 = ixy0 * (1.0 / 7.0);
    vec4 gy0 = fract(floor(gx0) * (1.0 / 7.0)) - 0.5;
    gx0 = fract(gx0);
    vec4 gz0 = vec4(0.5) - abs(gx0) - abs(gy0);
    vec4 sz0 = step(gz0, vec4(0.0));
    gx0 -= sz0 * (step(0.0, gx0) - 0.5);
    gy0 -= sz0 * (step(0.0, gy0) - 0.5);
    vec4 gx1 = ixy1 * (1.0 / 7.0);
    vec4 gy1 = fract(floor(gx1) * (1.0 / 7.0)) - 0.5;
    gx1 = fract(gx1);
    vec4 gz1 = vec4(0.5) - abs(gx1) - abs(gy1);
    vec4 sz1 = step(gz1, vec4(0.0));
    gx1 -= sz1 * (step(0.0, gx1) - 0.5);
    gy1 -= sz1 * (step(0.0, gy1) - 0.5);
    vec3 g000 = vec3(gx0.x, gy0.x, gz0.x);
    vec3 g100 = vec3(gx0.y, gy0.y, gz0.y);
    vec3 g010 = vec3(gx0.z, gy0.z, gz0.z);
    vec3 g110 = vec3(gx0.w, gy0.w, gz0.w);
    vec3 g001 = vec3(gx1.x, gy1.x, gz1.x);
    vec3 g101 = vec3(gx1.y, gy1.y, gz1.y);
    vec3 g011 = vec3(gx1.z, gy1.z, gz1.z);
    vec3 g111 = vec3(gx1.w, gy1.w, gz1.w);
    vec4 norm0 = taylorInvSqrt(vec4(dot(g000,g000), dot(g010,g010), dot(g100,g100), dot(g110,g110)));
    g000 *= norm0.x; g010 *= norm0.y; g100 *= norm0.z; g110 *= norm0.w;
    vec4 norm1 = taylorInvSqrt(vec4(dot(g001,g001), dot(g011,g011), dot(g101,g101), dot(g111,g111)));
    g001 *= norm1.x; g011 *= norm1.y; g101 *= norm1.z; g111 *= norm1.w;
    float n000 = dot(g000, Pf0);
    float n100 = dot(g100, vec3(Pf1.x, Pf0.yz));
    float n010 = dot(g010, vec3(Pf0.x, Pf1.y, Pf0.z));
    float n110 = dot(g110, vec3(Pf1.xy, Pf0.z));
    float n001 = dot(g001, vec3(Pf0.xy, Pf1.z));
    float n101 = dot(g101, vec3(Pf1.x, Pf0.y, Pf1.z));
    float n011 = dot(g011, vec3(Pf0.x, Pf1.yz));
    float n111 = dot(g111, Pf1);
    vec3 fade_xyz = fade(Pf0);
    vec4 n_z = mix(vec4(n000,n100,n010,n110), vec4(n001,n101,n011,n111), fade_xyz.z);
    vec2 n_yz = mix(n_z.xy, n_z.zw, fade_xyz.y);
    float n_xyz = mix(n_yz.x, n_yz.y, fade_xyz.x);
    return 2.2 * n_xyz;
  }

  void main() {
    float noise = 3.0 * pnoise(position + u_time, vec3(10.0));
    float displacement = (u_frequency / 30.0) * (noise / 10.0);
    vec3 newPosition = position + normal * displacement;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(newPosition, 1.0);
  }
`;

const fragmentShader = /* glsl */ `
  uniform float u_red;
  uniform float u_green;
  uniform float u_blue;

  void main() {
    gl_FragColor = vec4(vec3(u_red, u_green, u_blue), 1.0);
  }
`;

// ── Constants ──────────────────────────────────────────────────────────

const SERVER_URL = "http://localhost:3001";
const CARTESIA_SAMPLE_RATE = 24000;
const JITTER_BUFFER_SAMPLES = CARTESIA_SAMPLE_RATE * 0.2;
const BATCH_MIN_SAMPLES = CARTESIA_SAMPLE_RATE * 0.08;

// ── Component ──────────────────────────────────────────────────────────

export function AudioVisualizer() {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let destroyed = false;
    let animFrameId = 0;
    let socket: Socket | null = null;
    let micStream: MediaStream | null = null;

    // Shared audio pipeline refs (accessible by Cartesia playback)
    let sharedCtx: AudioContext | null = null;
    let analyserNode: AnalyserNode | null = null;
    let nextStartTime = 0;
    const liveSourceNodes: AudioBufferSourceNode[] = [];

    // Jitter buffer state for Cartesia
    let pendingSamples: Float32Array[] = [];
    let pendingLength = 0;
    let playbackStarted = false;
    let flushTimer: ReturnType<typeof setTimeout> | null = null;

    // ── Cartesia playback (uses shared AudioContext + analyser) ─────

    function scheduleBuffer(float32: Float32Array) {
      if (!sharedCtx || !analyserNode || float32.length === 0) return;

      // createBuffer resamples from 24kHz to the context's rate automatically
      const buf = sharedCtx.createBuffer(1, float32.length, CARTESIA_SAMPLE_RATE);
      buf.getChannelData(0).set(float32);
      const src = sharedCtx.createBufferSource();
      src.buffer = buf;

      // Connect to BOTH destination (speakers) AND analyser (visualization)
      src.connect(sharedCtx.destination);
      src.connect(analyserNode);

      const now = sharedCtx.currentTime;
      const t = Math.max(now + 0.01, nextStartTime);
      src.start(t);
      nextStartTime = t + buf.duration;

      liveSourceNodes.push(src);
      src.onended = () => {
        const i = liveSourceNodes.indexOf(src);
        if (i !== -1) liveSourceNodes.splice(i, 1);
      };
    }

    function flushPending() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      if (pendingLength === 0) return;
      const merged = new Float32Array(pendingLength);
      let off = 0;
      for (const c of pendingSamples) { merged.set(c, off); off += c.length; }
      pendingSamples = [];
      pendingLength = 0;
      scheduleBuffer(merged);
    }

    function handleAudioChunk(base64: string) {
      if (!sharedCtx) return;
      if (sharedCtx.state === "suspended") sharedCtx.resume();

      const bin = atob(base64);
      const bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const i16 = new Int16Array(bytes.buffer);
      const f32 = new Float32Array(i16.length);
      for (let i = 0; i < i16.length; i++) f32[i] = i16[i] / 32768;

      pendingSamples.push(f32);
      pendingLength += f32.length;

      if (!playbackStarted) {
        if (pendingLength >= JITTER_BUFFER_SAMPLES) { playbackStarted = true; flushPending(); }
        if (!flushTimer) {
          flushTimer = setTimeout(() => {
            if (!playbackStarted && pendingLength > 0) { playbackStarted = true; flushPending(); }
          }, 300);
        }
      } else {
        if (pendingLength >= BATCH_MIN_SAMPLES) flushPending();
        else if (!flushTimer) flushTimer = setTimeout(flushPending, 50);
      }
    }

    function stopPlayback() {
      if (flushTimer) { clearTimeout(flushTimer); flushTimer = null; }
      pendingSamples = []; pendingLength = 0; playbackStarted = false;
      for (const s of liveSourceNodes) { try { s.stop(); } catch { /* */ } }
      liveSourceNodes.length = 0;
      nextStartTime = 0;
    }

    // ── Init ───────────────────────────────────────────────────────────

    async function init() {
      const w = container!.clientWidth || window.innerWidth;
      const h = container!.clientHeight || window.innerHeight;

      // Renderer — fully transparent
      const renderer = new THREE.WebGLRenderer({
        antialias: true,
        alpha: true,
        premultipliedAlpha: false,
      });
      renderer.setSize(w, h);
      renderer.setPixelRatio(window.devicePixelRatio);
      renderer.setClearColor(0x000000, 0);
      container!.appendChild(renderer.domElement);

      renderer.domElement.style.filter =
        "drop-shadow(0 0 12px rgba(0, 212, 255, 0.7)) drop-shadow(0 0 30px rgba(0, 212, 255, 0.3))";

      // Scene + Camera
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(45, w / h, 0.1, 1000);
      camera.position.set(0, -2, 14);
      camera.lookAt(0, 0, 0);

      // Shader material
      const uniforms = {
        u_time: { value: 0.0 },
        u_frequency: { value: 0.0 },
        u_red: { value: 0.0 },
        u_green: { value: 0.83 },
        u_blue: { value: 1.0 },
      };

      const mat = new THREE.ShaderMaterial({
        uniforms,
        vertexShader,
        fragmentShader,
        wireframe: true,
      });

      const geo = new THREE.IcosahedronGeometry(4, 30);
      const mesh = new THREE.Mesh(geo, mat);
      scene.add(mesh);

      // ── Shared AudioContext + Analyser ──────────────────────────────
      // Both mic AND Cartesia playback feed into this analyser
      sharedCtx = new AudioContext();
      analyserNode = sharedCtx.createAnalyser();
      analyserNode.fftSize = 512;
      analyserNode.smoothingTimeConstant = 0.8;

      const timeData = new Float32Array(analyserNode.fftSize);
      const freqData = new Uint8Array(analyserNode.frequencyBinCount);

      // Connect mic → analyser (mic doesn't go to destination to avoid feedback)
      try {
        micStream = await navigator.mediaDevices.getUserMedia({
          audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        });
        const micSource = sharedCtx.createMediaStreamSource(micStream);
        micSource.connect(analyserNode);
      } catch (err) {
        console.warn("[Visualizer] Mic not available:", err);
      }

      // ── Socket for Cartesia audio ──────────────────────────────────
      socket = io(SERVER_URL, { transports: ["websocket", "polling"] });
      socket.on("connect", () => console.log("[Visualizer] Server connected"));
      socket.on("audio_chunk", (data: string) => handleAudioChunk(data));
      socket.on("stop_audio", () => stopPlayback());

      // ── Animate ────────────────────────────────────────────────────
      const clock = new THREE.Clock();

      function animate() {
        if (destroyed) return;
        animFrameId = requestAnimationFrame(animate);

        uniforms.u_time.value = clock.getElapsedTime();

        // Read combined mic + Cartesia audio from the shared analyser
        if (analyserNode) {
          // RMS volume
          analyserNode.getFloatTimeDomainData(timeData);
          let sum = 0;
          for (let i = 0; i < timeData.length; i++) sum += timeData[i] * timeData[i];
          const rms = Math.sqrt(sum / timeData.length);
          const rmsScaled = Math.min(rms * 500, 150);

          // Frequency texture
          analyserNode.getByteFrequencyData(freqData);
          let freqSum = 0;
          for (let i = 0; i < freqData.length; i++) freqSum += freqData[i];
          const freqAvg = freqSum / freqData.length;

          // Blend + smooth
          const target = rmsScaled * 0.6 + freqAvg * 0.4;
          uniforms.u_frequency.value += (target - uniforms.u_frequency.value) * 0.15;
        }

        renderer.render(scene, camera);
      }
      animate();

      // ── Resize ─────────────────────────────────────────────────────
      function onResize() {
        const nw = container!.clientWidth || window.innerWidth;
        const nh = container!.clientHeight || window.innerHeight;
        camera.aspect = nw / nh;
        camera.updateProjectionMatrix();
        renderer.setSize(nw, nh);
      }
      window.addEventListener("resize", onResize);

      // ── Cleanup ────────────────────────────────────────────────────
      return () => {
        destroyed = true;
        cancelAnimationFrame(animFrameId);
        window.removeEventListener("resize", onResize);
        socket?.disconnect();
        stopPlayback();
        micStream?.getTracks().forEach((t) => t.stop());
        sharedCtx?.close();
        renderer.dispose();
        geo.dispose();
        mat.dispose();
        if (renderer.domElement.parentNode) {
          renderer.domElement.parentNode.removeChild(renderer.domElement);
        }
      };
    }

    let cleanup: (() => void) | undefined;
    init().then((fn) => { cleanup = fn; });

    return () => { cleanup?.(); };
  }, []);

  return (
    <div
      ref={containerRef}
      style={{
        width: "100vw",
        height: "100vh",
        background: "transparent",
        position: "relative",
        overflow: "hidden",
        // @ts-expect-error Electron drag
        WebkitAppRegion: "drag",
        cursor: "grab",
      }}
    />
  );
}
