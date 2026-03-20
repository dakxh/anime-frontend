'use client';

import { useEffect, useRef, useState } from 'react';

const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

const proxyCache = new Map<string, string>();

function generateProperResolvedHfPath(u: string): string {
  if (!u || typeof u !== 'string') return u;
  let sanitized = u.split('?download=true')[0].split('&download=true')[0];
  if (!sanitized.startsWith('https://huggingface.co/buckets/') || sanitized.includes('/resolve/')) {
    return sanitized;
  }
  const parts = sanitized.split('/');
  if (parts.length > 6) {
    parts.splice(6, 0, 'resolve');
    return parts.join('/');
  }
  return sanitized;
}

function ensureCorsHeaderProxy(rawAbsoluteUrl: string): string {
  if (proxyCache.has(rawAbsoluteUrl)) return proxyCache.get(rawAbsoluteUrl)!;
  const urlToFetch = generateProperResolvedHfPath(rawAbsoluteUrl);
  let finalUrl = urlToFetch;
  if (urlToFetch.includes('huggingface.co/buckets/')) {
    finalUrl = CORS_PROXY_BASE + encodeURIComponent(urlToFetch);
  }
  proxyCache.set(rawAbsoluteUrl, finalUrl);
  return finalUrl;
}

export default function PlayerUI({ streamInfo }: { streamInfo: any }) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);

  // UI State
  const [isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Track State
  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [activeAudio, setActiveAudio] = useState<number>(0);
  const [subTracks, setSubTracks] = useState<{ url: string; label: string }[]>([]);
  const [activeSub, setActiveSub] = useState<string>('');

  useEffect(() => {
    let isMounted = true;

    const initializePlayer = async () => {
      try {
        let manifestUrl = streamInfo.hls_manifest_url;
        if (manifestUrl) {
          manifestUrl = generateProperResolvedHfPath(manifestUrl);
          manifestUrl = ensureCorsHeaderProxy(manifestUrl); 
        }

        const fonts = (streamInfo.fonts || []).map((f: string) => ensureCorsHeaderProxy(f));

        const parsedSubs = (streamInfo.ass_subtitles || []).map((sub: any) => {
          const rawUrl = generateProperResolvedHfPath(typeof sub === 'string' ? sub : sub.url);
          const safeUrl = ensureCorsHeaderProxy(rawUrl);
          const label = typeof sub === 'string' ? 'Subtitle' : sub.label;
          return { url: safeUrl, label };
        });

        if (parsedSubs.length > 0) {
          setSubTracks(parsedSubs);
          setActiveSub(parsedSubs[0].url);
        }

        const Artplayer = (await import('artplayer')).default;
        const Hls = (await import('hls.js')).default;
        const artplayerPluginJassub = (await import('artplayer-plugin-jassub')).default;

        if (!isMounted || !playerContainerRef.current) return;

        class HfBucketsProxyLoader extends Hls.DefaultConfig.loader {
          load(context: any, config: any, callbacks: any) {
            if (context.url) {
              context.url = ensureCorsHeaderProxy(context.url);
            }
            super.load(context, config, callbacks);
          }
        }

        const artOptions: any = {
          container: playerContainerRef.current,
          url: manifestUrl,
          type: 'm3u8',
          volume: 0.7,
          autoplay: true,
          setting: true,
          fullscreen: true,
          customType: {
            m3u8: function (video: HTMLVideoElement, url: string, artInstance: any) {
              if (Hls.isSupported()) {
                if (artInstance.hls) artInstance.hls.destroy();

                const hls = new Hls({
                  loader: HfBucketsProxyLoader as any,
                  enableWorker: true,
                  maxBufferLength: 120,
                  maxMaxBufferLength: 180,
                  maxBufferSize: 100 * 1024 * 1024,
                  manifestLoadingTimeOut: 15000,
                  fragLoadingTimeOut: 30000,
                  lowLatencyMode: false
                });

                hlsRef.current = hls;
                hls.loadSource(url);
                hls.attachMedia(video);
                artInstance.hls = hls;

                artInstance.on('destroy', () => hls.destroy());

                hls.on(Hls.Events.ERROR, function (event, data) {
                  if (data.fatal && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
                    console.warn("Fatal proxy timeout, attempting recovery...");
                    hls.startLoad();
                  }
                });

                hls.on(Hls.Events.AUDIO_TRACKS_UPDATED, (_, data) => {
                  if (data.audioTracks && data.audioTracks.length > 0) {
                    const tracks = data.audioTracks.map((track: any, index: number) => ({
                      id: index,
                      name: track.name || track.lang || track.language || `Audio Track ${index + 1}`
                    }));
                    setAudioTracks(tracks);
                    setActiveAudio(hls.audioTrack !== -1 ? hls.audioTrack : 0);
                  }
                });

              } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
                video.src = url;
              }
            }
          }
        };

        if (parsedSubs.length > 0) {
          artOptions.plugins = [
            artplayerPluginJassub({
              debug: false,
              subUrl: parsedSubs[0].url,
              fonts: fonts,
              workerUrl: '/jassub-worker.js',
              wasmUrl: '/jassub-worker.wasm',
              modernWasmUrl: '/jassub-worker.wasm',
            })
          ];
        }

        artRef.current = new Artplayer(artOptions);
        setIsLoading(false);

      } catch (err: any) {
        if (isMounted) {
          setErrorMsg(err.message || 'An unknown error occurred loading the stream client.');
          setIsLoading(false);
        }
      }
    };

    initializePlayer();

    return () => {
      isMounted = false;
      if (hlsRef.current) {
        hlsRef.current.destroy();
        hlsRef.current = null;
      }
      if (artRef.current) {
        artRef.current.destroy(true);
        artRef.current = null;
      }
    };
  }, [streamInfo]);

  const switchAudio = (trackId: number) => {
    if (hlsRef.current) {
      hlsRef.current.audioTrack = trackId;
      setActiveAudio(trackId);
    }
  };

  const switchSubtitle = (url: string) => {
    if (!artRef.current || !artRef.current.plugins) return;
    
    // Direct, exact match to how your index.html handles it. 
    // No loops, no guessing.
    const p = artRef.current.plugins.artplayerPluginJassub;

    if (p) {
      if (typeof p.switchSubtitle === 'function') p.switchSubtitle(url);
      else if (typeof p.switch === 'function') p.switch(url);
      else if (typeof p.setTrackByUrl === 'function') p.setTrackByUrl(url);
      // These last two lines are what your original Next.js code was missing 
      // but your index.html caught perfectly.
      else if (p.jassub && typeof p.jassub.setTrackByUrl === 'function') p.jassub.setTrackByUrl(url);
      else if (p.instance && typeof p.instance.setTrackByUrl === 'function') p.instance.setTrackByUrl(url);
      
      setActiveSub(url);
    } else {
      console.error("JASSUB plugin is not registered. Subtitle switch failed.");
      if (artRef.current.subtitle && typeof artRef.current.subtitle.switch === 'function') {
        artRef.current.subtitle.switch(url);
        setActiveSub(url);
      }
    }
  };

  return (
    <>
      <div className="w-full aspect-video bg-neutral-950 relative border-b border-neutral-900 mt-0">
        {isLoading && (
          <div className="absolute inset-0 flex items-center justify-center text-neutral-600 text-sm tracking-widest uppercase">
            Initializing Stream Instance...
          </div>
        )}

        {errorMsg && (
          <div className="absolute inset-0 flex flex-col gap-4 items-center justify-center bg-black z-40">
            <span className="text-red-500 text-sm tracking-widest uppercase border border-red-500/30 px-4 py-2 rounded">
              Stream Failure
            </span>
            <span className="text-neutral-400 text-xs">{errorMsg}</span>
          </div>
        )}

        <div ref={playerContainerRef} className="w-full h-full absolute inset-0 z-10" />
      </div>

      {!isLoading && !errorMsg && (
        <div className="w-full max-w-screen-2xl mx-auto p-4 md:p-8 flex flex-col md:flex-row justify-between gap-8">
          
          <div className="flex flex-col gap-3">
            <span className="text-xs text-neutral-600 uppercase tracking-widest font-semibold">
              Audio Override
            </span>
            <div className="flex flex-wrap gap-2 bg-neutral-950 p-2 rounded-2xl border border-neutral-900 w-fit">
              {audioTracks.length > 0 ? (
                audioTracks.map((track) => (
                  <button
                    key={track.id}
                    onClick={() => switchAudio(track.id)}
                    className={`px-4 py-2 rounded-xl text-xs tracking-wider transition-all duration-200 ${activeAudio === track.id
                      ? 'bg-white text-black font-bold shadow-md'
                      : 'bg-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                      }`}
                  >
                    {track.name}
                  </button>
                ))
              ) : (
                <span className="px-4 py-2 text-xs text-neutral-700">No alternate audio</span>
              )}
            </div>
          </div>

          <div className="flex flex-col gap-3 md:items-end">
            <span className="text-xs text-neutral-600 uppercase tracking-widest font-semibold">
              Subtitle Override
            </span>
            <div className="flex flex-wrap gap-2 bg-neutral-950 p-2 rounded-2xl border border-neutral-900 w-fit justify-end">
              {subTracks.length > 0 ? (
                subTracks.map((sub, idx) => (
                  <button
                    key={idx}
                    onClick={() => switchSubtitle(sub.url)}
                    className={`px-4 py-2 rounded-xl text-xs tracking-wider transition-all duration-200 ${activeSub === sub.url
                      ? 'bg-blue-500 text-white font-bold shadow-md shadow-blue-500/20'
                      : 'bg-transparent text-neutral-400 hover:bg-neutral-900 hover:text-neutral-200'
                      }`}
                  >
                    {sub.label}
                  </button>
                ))
              ) : (
                <span className="px-4 py-2 text-xs text-neutral-700">No alternate subtitles</span>
              )}
            </div>
          </div>

        </div>
      )}
    </>
  );
}