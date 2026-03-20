// app/components/ClientPlayer.tsx
'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';

// You still need proxy utilities here because the browser requests the HLS segments (.ts files)
const CORS_PROXY_BASE = "https://xkca.dadalapathy756.workers.dev/?url=";

export default function ClientPlayer({ streamInfo, backLink }: { streamInfo: any, backLink: string }) {
  const playerContainerRef = useRef<HTMLDivElement>(null);
  const artRef = useRef<any>(null);
  const hlsRef = useRef<any>(null);

  const[isLoading, setIsLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const [audioTracks, setAudioTracks] = useState<{ id: number; name: string }[]>([]);
  const [activeAudio, setActiveAudio] = useState<number>(0);
  // (Include Subtitle state similar to your original code...)

  useEffect(() => {
    let isMounted = true;

    const initialize = async () => {
      try {
        const Artplayer = (await import('artplayer')).default;
        const Hls = (await import('hls.js')).default;
        const artplayerPluginJassub = (await import('artplayer-plugin-jassub')).default;

        if (!playerContainerRef.current) return;

        // Custom Proxy Loader for HLS chunks (Browsers still need this for CORS)
        class HfBucketsProxyLoader extends Hls.DefaultConfig.loader {
          load(context: any, config: any, callbacks: any) {
             if (context.url && context.url.includes('huggingface.co/buckets/')) {
               context.url = CORS_PROXY_BASE + encodeURIComponent(context.url);
             }
             super.load(context, config, callbacks);
          }
        }

        const artOptions = {
          container: playerContainerRef.current,
          url: streamInfo.hls_manifest_url, // URL was sanitized on the server
          type: 'm3u8',
          // ... (Paste your ArtPlayer config here exactly as you had it)
        };

        artRef.current = new Artplayer(artOptions);
        setIsLoading(false);

      } catch (err: any) {
        if (isMounted) setErrorMsg(err.message);
      }
    };

    initialize();

    return () => {
      isMounted = false;
      if (hlsRef.current) hlsRef.current.destroy();
      if (artRef.current) artRef.current.destroy(true);
    };
  }, [streamInfo]);

  // Track Selector functions (switchAudio, switchSubtitle)...

  return (
    // Paste the return JSX from your original `play/page.tsx` here, 
    // including the Header, Video Container, and Tracks section.
    // Replace the `<Link>` back string with `href={backLink}`
    <></> 
  );
}