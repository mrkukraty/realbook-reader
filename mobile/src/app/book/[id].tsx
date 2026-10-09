import React, { useEffect, useState } from 'react';
import { Alert, KeyboardAvoidingView, Platform, ScrollView, Text, TextInput, View } from 'react-native';
import { Stack, router, useLocalSearchParams } from 'expo-router';
import { useLibrary } from '@/state/library-store';
import { Btn, Card, Chip, SectionTitle, useAppTheme } from '@/components/ui';
import { BookCover } from '@/components/BookCover';
import { formatBytes } from '@/storage/library-logic';
import { formatLabel } from '@/formats/registry';
import { percentLabel } from '@/reader/progress';
import { confirmRemoveBook } from '@/components/remove-book';
import type { BookMetadata } from '@/formats/types';

const FIELDS: { key: keyof BookMetadata; label: string; multiline?: boolean }[] = [
  { key: 'title', label: 'Title' },
  { key: 'author', label: 'Author' },
  { key: 'publisher', label: 'Publisher' },
  { key: 'published', label: 'Published' },
  { key: 'language', label: 'Language' },
  { key: 'description', label: 'Description', multiline: true },
];

export default function BookDetails() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const t = useAppTheme();
  const book = useLibrary((s) => s.books.find((b) => b.id === id));
  const progress = useLibrary((s) => (id ? s.progress[id] : undefined));
  const collections = useLibrary((s) => s.collections);
  const updateMetadata = useLibrary((s) => s.updateMetadata);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const setBookCollections = useLibrary((s) => s.setBookCollections);
  const [form, setForm] = useState<BookMetadata | null>(book?.metadata ?? null);
  const [dirty, setDirty] = useState(false);

  useEffect(() => { if (book && !dirty) setForm(book.metadata); }, [book, dirty]);

  if (!book || !form) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: t.chrome, padding: 24 }}>
        <Text style={{ color: t.chromeText, marginBottom: 12 }}>This book is no longer in your library.</Text>
        <Btn title="Back to library" onPress={() => router.back()} />
      </View>
    );
  }

  const save = async () => {
    if (!form.title.trim()) { Alert.alert('Title required', 'Please enter a title.'); return; }
    await updateMetadata(book.id, form);
    setDirty(false);
    Alert.alert('Saved', 'Book details updated.');
  };

  const inCol = (cid: string) => book.collectionIds.includes(cid);
  const toggleCol = (cid: string) => void setBookCollections(book.id, inCol(cid) ? book.collectionIds.filter((x) => x !== cid) : [...book.collectionIds, cid]);

  return (
    <KeyboardAvoidingView style={{ flex: 1, backgroundColor: t.chrome }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      <Stack.Screen options={{ title: 'Book details' }} />
      <ScrollView contentContainerStyle={{ padding: 16, paddingBottom: 60 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row' }}>
          <BookCover book={book} width={110} />
          <View style={{ flex: 1, marginLeft: 14 }}>
            <Text style={{ color: t.chromeText, fontSize: 18, fontWeight: '700' }} numberOfLines={3}>{book.metadata.title}</Text>
            {book.metadata.author ? <Text style={{ color: t.muted, marginTop: 4 }}>{book.metadata.author}</Text> : null}
            <Text style={{ color: t.muted, marginTop: 8, fontSize: 12 }}>{`${formatLabel(book.format)} · ${formatBytes(book.size)}`}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }} numberOfLines={2}>{book.fileName}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{`Added ${new Date(book.addedAt).toLocaleDateString()}`}</Text>
            <Text style={{ color: t.muted, fontSize: 12 }}>{progress ? `Progress ${percentLabel(progress.fraction)}` : 'Not started'}</Text>
            {book.pageCount ? <Text style={{ color: t.muted, fontSize: 12 }}>{`${book.pageCount} pages`}</Text> : null}
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 10, marginTop: 16 }}>
          <Btn title="Read" icon="book-outline" onPress={() => router.push(`/reader/${book.id}`)} style={{ flex: 1 }} />
          <Btn title={book.favorite ? 'Favorite' : 'Add favorite'} icon={book.favorite ? 'heart' : 'heart-outline'} kind="secondary" onPress={() => void toggleFavorite(book.id)} style={{ flex: 1 }} />
        </View>

        <SectionTitle>Collections</SectionTitle>
        {collections.length ? (
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', rowGap: 8 }}>
            {collections.map((c) => <Chip key={c.id} label={c.name} selected={inCol(c.id)} onPress={() => toggleCol(c.id)} />)}
          </View>
        ) : <Text style={{ color: t.muted }}>No collections yet. Create one from the library screen.</Text>}

        <SectionTitle>Metadata</SectionTitle>
        <Card>
          {FIELDS.map((f) => (
            <View key={f.key} style={{ marginBottom: 10 }}>
              <Text style={{ color: t.muted, fontSize: 12, marginBottom: 4 }}>{f.label}</Text>
              <TextInput
                value={form[f.key] ?? ''}
                onChangeText={(v) => { setForm({ ...form, [f.key]: v }); setDirty(true); }}
                multiline={f.multiline}
                accessibilityLabel={f.label}
                style={{ color: t.chromeText, borderWidth: 1, borderColor: t.border, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15, minHeight: f.multiline ? 100 : undefined, textAlignVertical: f.multiline ? 'top' : 'center' }}
              />
            </View>
          ))}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Btn title="Save changes" icon="save-outline" onPress={() => void save()} disabled={!dirty} style={{ flex: 1 }} />
            <Btn title="Revert" kind="secondary" onPress={() => { setForm(book.metadata); setDirty(false); }} disabled={!dirty} />
          </View>
        </Card>

        <SectionTitle>Danger zone</SectionTitle>
        <Btn title="Remove from library" icon="trash-outline" kind="danger" onPress={() => { void confirmRemoveBook(book).then((ok) => { if (ok) router.back(); }); }} />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
