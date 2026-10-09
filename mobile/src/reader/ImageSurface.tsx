// A fixed-layout page (PDF render / comic image) displayed with a native Image.
import React, { memo, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Image, StyleSheet, Text, View } from 'react-native';

interface Props {
  sid: string;
  page: number | null;      // null = blank page (e.g. inside cover of a spread)
  targetKey: string | null; // changes whenever the reader re-targets this surface
  getPageUri(page: number): Promise<string>;
  pageColor: string;
  textColor: string;
  onShown(sid: string, page: number | null): void;
  /** dark themes dim bright page images slightly */
  dim: boolean;
}

function ImageSurfaceImpl({ sid, page, targetKey, getPageUri, pageColor, textColor, onShown, dim }: Props) {
  const [uri, setUri] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reqPage = useRef<number | null>(null);

  const shownPage = useRef<number | null>(null);
  useEffect(() => {
    // same page re-targeted (new key): it is already on screen, just report again
    if (page !== null && page === reqPage.current && uri && shownPage.current === page) { onShown(sid, page); return; }
    reqPage.current = page;
    setError(null);
    if (page === null) { setUri(null); shownPage.current = null; onShown(sid, null); return; }
    let cancelled = false;
    getPageUri(page).then((u) => {
      if (cancelled || reqPage.current !== page) return;
      setUri(u);
    }).catch((e) => {
      if (cancelled) return;
      setError(e instanceof Error ? e.message : String(e));
      onShown(sid, page);
    });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page, getPageUri, targetKey]);

  return (
    <View style={[StyleSheet.absoluteFill, { backgroundColor: pageColor, alignItems: 'center', justifyContent: 'center' }]} pointerEvents="none">
      {page !== null && uri ? (
        <Image
          source={{ uri }}
          resizeMode="contain"
          style={[StyleSheet.absoluteFill, dim ? { opacity: 0.86 } : null]}
          onLoad={() => { shownPage.current = page; onShown(sid, page); }}
          onError={() => { setError('This page image could not be displayed.'); onShown(sid, page); }}
          accessibilityLabel={`Page ${page + 1}`}
        />
      ) : null}
      {page !== null && !uri && !error ? <ActivityIndicator color={textColor} /> : null}
      {error ? <Text style={{ color: textColor, padding: 16, textAlign: 'center' }}>{`Page ${(page ?? 0) + 1}: ${error}`}</Text> : null}
    </View>
  );
}

export const ImageSurface = memo(ImageSurfaceImpl);
