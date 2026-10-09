import React from 'react';
import { Image, Text, View, type StyleProp, type ViewStyle } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import type { BookRecord } from '../storage/types';

const PALETTE = ['#6b2d2d', '#2d4a6b', '#2f5a3e', '#5a4a2d', '#4a2d5a', '#2d5a5a', '#6b4a2d', '#3a3a3a'];

function hashCode(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** Real cover when the book has one, otherwise a generated cloth-bound cover with the title. */
export function BookCover({ book, width, style }: { book: BookRecord; width: number; style?: StyleProp<ViewStyle> }) {
  const height = Math.round(width * 1.5);
  const base = { width, height, borderRadius: 4, overflow: 'hidden' as const };
  const spine = (
    <LinearGradient
      colors={['rgba(0,0,0,0.35)', 'rgba(255,255,255,0.12)', 'rgba(0,0,0,0)']}
      start={{ x: 0, y: 0 }} end={{ x: 1, y: 0 }}
      style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: Math.max(6, width * 0.08) }}
    />
  );
  if (book.coverPath) {
    return (
      <View style={[base, style]}>
        <Image source={{ uri: book.coverPath }} style={{ width, height }} resizeMode="cover" accessibilityIgnoresInvertColors />
        {spine}
      </View>
    );
  }
  const color = PALETTE[hashCode(book.metadata.title + (book.metadata.author ?? '')) % PALETTE.length];
  return (
    <View style={[base, { backgroundColor: color, padding: width * 0.1, justifyContent: 'space-between' }, style]}>
      <View style={{ borderTopWidth: 1, borderBottomWidth: 1, borderColor: 'rgba(240,215,160,0.6)', paddingVertical: 6, marginTop: height * 0.12 }}>
        <Text numberOfLines={4} style={{ color: '#f3e3bf', fontSize: Math.max(10, width * 0.11), fontWeight: '700', textAlign: 'center', fontFamily: 'serif' }}>
          {book.metadata.title}
        </Text>
      </View>
      {book.metadata.author ? (
        <Text numberOfLines={2} style={{ color: '#e8d5ab', fontSize: Math.max(8, width * 0.075), textAlign: 'center', marginBottom: height * 0.05 }}>
          {book.metadata.author}
        </Text>
      ) : <View />}
      {spine}
    </View>
  );
}
