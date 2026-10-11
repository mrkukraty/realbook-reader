-- RealBook Reader accounts: run this once in the Supabase SQL editor of a new project.
-- It creates a table listing each person's books and a private file bucket, both locked so that
-- a signed-in person can only ever read or change their own rows and files.

create table if not exists public.books (
  user_id     uuid   not null default auth.uid() references auth.users (id) on delete cascade,
  hash        text   not null,            -- sha-256 of the book file; the same book has the same hash on every device
  file_name   text   not null,
  format      text   not null,
  size        bigint not null,
  title       text   not null default '',
  author      text   not null default '',
  added_at    bigint not null,
  progress    jsonb,                      -- reading position
  progress_at bigint not null default 0,
  primary key (user_id, hash)
);

alter table public.books enable row level security;

drop policy if exists "own books" on public.books;
create policy "own books" on public.books
  for all to authenticated
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- Book files live at  <user id>/<hash>.<ext>  in a private bucket.
insert into storage.buckets (id, name, public)
values ('books', 'books', false)
on conflict (id) do nothing;

drop policy if exists "own book files: read" on storage.objects;
create policy "own book files: read" on storage.objects
  for select to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own book files: add" on storage.objects;
create policy "own book files: add" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own book files: replace" on storage.objects;
create policy "own book files: replace" on storage.objects
  for update to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text)
  with check (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "own book files: delete" on storage.objects;
create policy "own book files: delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'books' and (storage.foldername(name))[1] = auth.uid()::text);
