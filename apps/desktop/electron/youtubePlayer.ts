import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

/*
 * Local HTTP host for the YouTube IFrame player page.
 *
 * WHY THIS EXISTS: YouTube's IFrame Player refuses to initialise (onReady never fires) when embedded
 * from a file:// origin — the app's renderer origin. Served from an http://127.0.0.1 origin it works
 * perfectly (verified). So we host a one-page player here and the renderer drives it through a hidden
 * cross-origin iframe via postMessage (the same shape as the SoundCloud widget bridge).
 *
 * The page only loads YouTube's official iframe_api and relays play/pause/seek/volume commands to it
 * plus state/position/error events back — it streams nothing itself, so there's no anti-bot surface.
 */

const PLAYER_HTML = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>AMP YouTube</title>
<style>html,body{margin:0;background:#000;overflow:hidden}#p{width:100vw;height:100vh}</style></head>
<body>
<div id="p"></div>
<script>
  var player = null;
  function post(m){ try { parent.postMessage(Object.assign({ __ampyt: true }, m), "*"); } catch (e) {} }
  function readPos(){ try { return { position: player.getCurrentTime() * 1000, duration: (player.getDuration() || 0) * 1000 }; } catch (e) { return { position: 0, duration: 0 }; } }
  window.onYouTubeIframeAPIReady = function(){
    player = new YT.Player("p", {
      height: "100%", width: "100%",
      playerVars: { autoplay: 0, controls: 0, disablekb: 1, fs: 0, iv_load_policy: 3, modestbranding: 1, playsinline: 1, rel: 0, origin: location.origin },
      events: {
        onReady: function(){ post({ type: "ready" }); },
        onStateChange: function(e){ var p = readPos(); post({ type: "state", state: e.data, position: p.position, duration: p.duration }); },
        onError: function(e){ post({ type: "error", code: e.data }); }
      }
    });
  };
  window.addEventListener("message", function(ev){
    var d = ev.data; if (!d || !d.__ampytcmd || !player) return;
    try {
      switch (d.cmd) {
        case "load": player.loadVideoById({ videoId: d.videoId, startSeconds: d.startSeconds || 0 }); break;
        case "play": player.playVideo(); break;
        case "pause": player.pauseVideo(); break;
        case "seek": player.seekTo(d.seconds, true); break;
        case "volume": player.setVolume(d.volume); break;
        case "stop": player.stopVideo(); break;
      }
    } catch (e) {}
  });
  setInterval(function(){ if (player && player.getCurrentTime) { var p = readPos(); post({ type: "tick", position: p.position, duration: p.duration }); } }, 250);
  var s = document.createElement("script"); s.src = "https://www.youtube.com/iframe_api"; document.head.appendChild(s);
</script>
</body>
</html>`;

let server: Server | undefined;
let originPromise: Promise<string> | undefined;

/** Start (once) the loopback player host and resolve its origin, e.g. "http://127.0.0.1:53187". */
export function ensureYouTubePlayerOrigin(): Promise<string> {
  if (originPromise) {
    return originPromise;
  }
  originPromise = new Promise<string>((resolve, reject) => {
    const srv = createServer((req, res) => {
      // Single page, any path. Frame-ancestors left open so the file:// renderer can embed it.
      res.writeHead(200, {
        "Content-Type": "text/html; charset=utf-8",
        "Cache-Control": "no-store"
      });
      res.end(PLAYER_HTML);
    });
    srv.on("error", reject);
    // Port 0 = OS-assigned free port, bound to loopback only.
    srv.listen(0, "127.0.0.1", () => {
      server = srv;
      const { port } = srv.address() as AddressInfo;
      resolve(`http://127.0.0.1:${port}`);
    });
  });
  return originPromise;
}

export function stopYouTubePlayerServer(): void {
  server?.close();
  server = undefined;
  originPromise = undefined;
}
