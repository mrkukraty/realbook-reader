import React, { useMemo, useState } from 'react';
import { ActivityIndicator, Alert, FlatList, Pressable, ScrollView, Text, TextInput, View, useWindowDimensions } from 'react-native';
import { Stack, router } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import { useLibrary } from '@/state/library-store';
import { Btn, Chip, IconBtn, PromptModal, useAppTheme } from '@/components/ui';
import { BookCover } from '@/components/BookCover';
import { filterAndSortBooks, formatBytes, SORT_LABELS, type SortKey } from '@/storage/library-logic';
import { formatLabel, supportedFormats } from '@/formats/registry';
import { percentLabel } from '@/reader/progress';
import type { BookRecord } from '@/storage/types';
import { confirmRemoveBook } from '@/components/remove-book';
import { repoFallbackReason } from '@/state/repo';

const SORTS: SortKey[] = ['recent', 'added', 'title', 'author', 'progress', 'size'];

export default function LibraryScreen() {
  const t = useAppTheme();
  const { width } = useWindowDimensions();
  const books = useLibrary((s) => s.books);
  const progress = useLibrary((s) => s.progress);
  const collections = useLibrary((s) => s.collections);
  const loaded = useLibrary((s) => s.loaded);
  const loadError = useLibrary((s) => s.error);
  const importStatus = useLibrary((s) => s.importStatus);
  const pickAndImport = useLibrary((s) => s.pickAndImport);
  const toggleFavorite = useLibrary((s) => s.toggleFavorite);
  const addCollection = useLibrary((s) => s.addCollection);
  const renameCollection = useLibrary((s) => s.renameCollection);
  const deleteCollection = useLibrary((s) => s.deleteCollection);

  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('recent');
  const [favOnly, setFavOnly] = useState(false);
  const [collectionId, setCollectionId] = useState<string | null>(null);
  const [prompt, setPrompt] = useState<null | { mode: 'new' } | { mode: 'rename'; id: string; name: string }>(null);

  const visible = useMemo(
    () => filterAndSortBooks(books, progress, { text: query, sort, favoritesOnly: favOnly, collectionId }),
    [books, progress, query, sort, favOnly, collectionId],
  );

  const cols = Math.max(2, Math.floor((width - 24) / 150));
  const coverW = Math.floor((width - 24 - (cols - 1) * 14) / cols) - 4;

  const doImport = async () => {
    try {
      const r = await pickAndImport();
      if (r && r.summary) Alert.alert(r.results.some((x) => x.status === 'failed') ? 'Import finished with problems' : 'Import finished', r.summary);
    } catch (e) {
      Alert.alert('Import failed', e instanceof Error ? e.message : String(e));
    }
  };

  const cycleSort = () => setSort(SORTS[(SORTS.indexOf(sort) + 1) % SORTS.length]);

  const collectionMenu = (id: string, name: string) => {
    Alert.alert(name, 'Manage this collection', [
      { text: 'Rename', onPress: () => setPrompt({ mode: 'rename', id, name }) },
      {
        text: 'Delete collection', style: 'destructive', onPress: () => Alert.alert('Delete collection?', `"${name}" will be removed. The books in it stay in your library.`, [
          { text: 'Cancel', style: 'cancel' },
          { text: 'Delete', style: 'destructive', onPress: () => { if (collectionId === id) setCollectionId(null); void deleteCollection(id); } },
        ]),
      },
      { text: 'Cancel', style: 'cancel' },
    ]);
  };

  const renderBook = ({ item }: { item: BookRecord }) => {
    const p = progress[item.id];
    return (
      <Pressable
        onPress={() => router.push(`/reader/${item.id}`)}
        onLongPress={() => Alert.alert(item.metadata.title, undefined, [
          { text: 'Open', onPress: () => router.push(`/reader/${item.id}`) },
          { text: 'Details & edit', onPress: () => router.push(`/book/${item.id}`) },
          { text: item.favorite ? 'Remove from favorites' : 'Add to favorites', onPress: () => void toggleFavorite(item.id) },
          { text: 'Remove from library', style: 'destructive', onPress: () => void confirmRemoveBook(item) },
          { text: 'Cancel', style: 'cancel' },
        ])}
        accessibilityRole="button"
        accessibilityLabel={`${item.metadata.title}${item.metadata.author ? ` by ${item.metadata.author}` : ''}, ${formatLabel(item.format)}, ${p ? percentLabel(p.fraction) + ' read' : 'not started'}`}
        accessibilityHint="Opens the book. Long press for more options."
        style={{ width: coverW, marginBottom: 18, marginRight: 14 }}
      >
        <View style={{ shadowColor: '#000', shadowOpacity: 0.35, shadowRadius: 5, shadowOffset: { width: 2, height: 3 }, elevation: 5 }}>
          <BookCover book={item} width={coverW} />
          {item.favorite ? <Ionicons name="heart" size={18} color="#e0565b" style={{ position: 'absolute', top: 6, right: 6 }} /> : null}
          <View style={{ position: 'absolute', left: 4, bottom: 4, backgroundColor: 'rgba(0,0,0,0.6)', borderRadius: 4, paddingHorizontal: 5, paddingVertical: 1 }}>
            <Text style={{ color: '#fff', fontSize: 10, fontWeight: '700' }}>{item.format.toUpperCase()}</Text>
          </View>
        </View>
        <View style={{ height: 3, backgroundColor: t.border, borderRadius: 2, marginTop: 6 }}>
          <View style={{ height: 3, width: `${Math.round((p?.fraction ?? 0) * 100)}%`, backgroundColor: t.accent, borderRadius: 2 }} />
        </View>
        <Text numberOfLines={2} style={{ color: t.chromeText, fontWeight: '600', marginTop: 5, fontSize: 13 }}>{item.metadata.title}</Text>
        {item.metadata.author ? <Text numberOfLines={1} style={{ color: t.muted, fontSize: 12 }}>{item.metadata.author}</Text> : null}
        <Text style={{ color: t.muted, fontSize: 11, marginTop: 2 }}>{`${p ? percentLabel(p.fraction) : 'New'} · ${formatBytes(item.size)}`}</Text>
      </Pressable>
    );
  };

  const header = (
    <View>
      {repoFallbackReason ? <Text style={{ color: '#c0392b', marginBottom: 8 }}>{repoFallbackReason}</Text> : null}
      {loadError ? <Text style={{ color: '#c0392b', marginBottom: 8 }}>{`Library could not be loaded: ${loadError}`}</Text> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', backgroundColor: t.card, borderRadius: 10, borderWidth: 1, borderColor: t.border, paddingHorizontal: 10 }}>
        <Ionicons name="search" size={18} color={t.muted} />
        <TextInput
          value={query} onChangeText={setQuery} placeholder="Search title, author, file" placeholderTextColor={t.muted}
          style={{ flex: 1, color: t.chromeText, paddingVertical: 9, paddingHorizontal: 8, fontSize: 15 }}
          accessibilityLabel="Search library" returnKeyType="search" clearButtonMode="while-editing"
        />
        {query ? <IconBtn icon="close-circle" label="Clear search" onPress={() => setQuery('')} size={18} /> : null}
      </View>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginTop: 10 }} contentContainerStyle={{ alignItems: 'center' }}>
        <Chip label={`Sort: ${SORT_LABELS[sort]}`} icon="swap-vertical" onPress={cycleSort} />
        <Chip label="Favorites" icon="heart" selected={favOnly} onPress={() => setFavOnly(!favOnly)} />
        <Chip label="All books" selected={collectionId === null} onPress={() => setCollectionId(null)} />
        {collections.map((c) => (
          <Chip key={c.id} label={c.name} icon="albums-outline" selected={collectionId === c.id}
            onPress={() => setCollectionId(collectionId === c.id ? null : c.id)} onLongPress={() => collectionMenu(c.id, c.name)} />
        ))}
        <Chip label="New collection" icon="add" onPress={() => setPrompt({ mode: 'new' })} />
      </ScrollView>
      {importStatus ? (
        <View style={{ flexDirection: 'row', alignItems: 'center', marginTop: 12 }}>
          <ActivityIndicator color={t.accent} />
          <Text style={{ color: t.chromeText, marginLeft: 8, flex: 1 }} numberOfLines={1}>
            {`Importing ${importStatus.index + 1}/${importStatus.total}: ${importStatus.fileName} (${Math.round(importStatus.progress * 100)}%${importStatus.label ? ` · ${importStatus.label}` : ''})`}
          </Text>
        </View>
      ) : null}
      <View style={{ height: 14 }} />
    </View>
  );

  const empty = loaded ? (
    books.length === 0 ? (
      <View style={{ alignItems: 'center', paddingTop: 40, paddingHorizontal: 20 }}>
        <Ionicons name="library-outline" size={64} color={t.muted} />
        <Text style={{ color: t.chromeText, fontSize: 20, fontWeight: '700', marginTop: 12 }}>Your shelf is empty</Text>
        <Text style={{ color: t.muted, textAlign: 'center', marginTop: 8, lineHeight: 20 }}>
          {`Import books from your device. Supported: ${supportedFormats.map((f) => f.label).join(', ')}. Everything stays on this device.`}
        </Text>
        <Btn title="Import books" icon="add-circle-outline" onPress={doImport} disabled={!!importStatus} style={{ marginTop: 18 }} />
      </View>
    ) : (
      <Text style={{ color: t.muted, textAlign: 'center', marginTop: 30 }}>No books match the current search or filter.</Text>
    )
  ) : <ActivityIndicator color={t.accent} style={{ marginTop: 40 }} />;

  return (
    <View style={{ flex: 1, backgroundColor: t.chrome }}>
      <Stack.Screen options={{
        title: 'Library',
        headerRight: () => (
          <View style={{ flexDirection: 'row' }}>
            <IconBtn icon="add-circle-outline" label="Import books" onPress={doImport} />
            <IconBtn icon="person-circle-outline" label="Account" onPress={() => router.push('/account')} />
            <IconBtn icon="settings-outline" label="Settings" onPress={() => router.push('/settings')} />
          </View>
        ),
      }} />
      <FlatList
        key={cols}
        data={visible}
        keyExtractor={(b) => b.id}
        numColumns={cols}
        renderItem={renderBook}
        ListHeaderComponent={header}
        ListEmptyComponent={empty}
        contentContainerStyle={{ padding: 12, paddingBottom: 40 }}
        keyboardShouldPersistTaps="handled"
      />
      <PromptModal
        visible={!!prompt}
        title={prompt?.mode === 'rename' ? 'Rename collection' : 'New collection'}
        initial={prompt?.mode === 'rename' ? prompt.name : ''}
        placeholder="Collection name"
        confirmLabel={prompt?.mode === 'rename' ? 'Rename' : 'Create'}
        onCancel={() => setPrompt(null)}
        onSubmit={(v) => {
          const p = prompt;
          setPrompt(null);
          if (!v.trim() || !p) return;
          if (p.mode === 'rename') void renameCollection(p.id, v);
          else void addCollection(v).then((c) => setCollectionId(c.id));
        }}
      />
    </View>
  );
}
