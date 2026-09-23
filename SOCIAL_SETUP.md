# Akun dan Social Messaging

Fitur sosial memakai Supabase Auth + Postgres + Realtime + Storage. Music player tetap berjalan seperti sebelumnya dan data player lokal tetap memakai localStorage.

## 1. Install

```bash
npm install
```

`@supabase/supabase-js` sudah tercantum di `package.json`. `node_modules` sengaja tidak disertakan.

## 2. Buat project Supabase

1. Buat project Supabase.
2. Buka SQL Editor dan jalankan seluruh `supabase/schema.sql`.
3. Di Authentication, atur email confirmation sesuai kebutuhan project. Jika email confirmation aktif, user harus memverifikasi email sebelum session login tersedia.
4. Di Realtime Settings, nonaktifkan public channel access jika tersedia untuk project, karena aplikasi memakai private channels dan RLS untuk Presence/Broadcast.
5. Deploy Edge Function `login-with-username` dan set secret `SUPABASE_SERVICE_ROLE_KEY` dan `SUPABASE_PUBLISHABLE_KEY` pada Edge Function. Keduanya tetap server-side; jangan pernah memasukkan service-role key ke frontend.

Contoh deploy dengan Supabase CLI:

```bash
supabase functions deploy login-with-username
supabase secrets set SUPABASE_SERVICE_ROLE_KEY=YOUR_SERVER_ONLY_SERVICE_ROLE_KEY SUPABASE_PUBLISHABLE_KEY=YOUR_PUBLISHABLE_KEY
```

## 3. Environment frontend

Salin `.env.example` menjadi `.env.local` lalu isi:

```env
VITE_SUPABASE_URL=https://YOUR_PROJECT.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Publishable key boleh digunakan frontend. Jangan menaruh `SUPABASE_SERVICE_ROLE_KEY` di file `.env` yang dibundle Vite atau di Cloudflare Pages environment variable yang terekspos ke browser.

## 4. Jalankan

```bash
npm run dev
```

Untuk Cloudflare Pages, build command tetap:

```bash
npm run build
```

Output Vite tetap berada di `dist`.

## 5. Fitur yang terhubung ke server

- Register/login/logout melalui Supabase Auth.
- Session persisten setelah refresh.
- Username login menggunakan Edge Function server-side. Email Auth tidak dikirim kembali ke browser; function mengembalikan session token saja.
- Profile, avatar, bio, dan negara di Postgres/Storage.
- Follow/unfollow di Postgres.
- Percakapan 1-on-1 di Postgres.
- Pesan realtime melalui Supabase Realtime/Postgres Changes.
- Typing indicator melalui Realtime Broadcast.
- Online status melalui Realtime Presence.
- Read status melalui RPC `mark_messages_read`.
- Block/report di database dengan RLS.
- Share lagu dan playlist melalui metadata pesan, bukan file audio.
- Riwayat pesan mengambil 60 pesan pertama dan menyediakan tombol untuk memuat pesan sebelumnya.
- Realtime listener dibersihkan ketika komponen/chat dilepas.

## 6. Keamanan

RLS di `schema.sql` membatasi percakapan/pesan berdasarkan membership dan `auth.uid()`. Password tidak pernah ditulis ke tabel aplikasi; password ditangani Supabase Auth.
