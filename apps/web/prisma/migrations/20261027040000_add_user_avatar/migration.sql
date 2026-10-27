-- Issue #198: optional profile picture. Additive only.
-- The object lives in the private Supabase Storage bucket `avatars`; the app stores only its key.

-- AlterTable
ALTER TABLE "User" ADD COLUMN "avatarPath" TEXT;

-- Private bucket for profile pictures: 2 MB, images only, no public URL
-- (pictures are served through server-generated signed URLs).
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('avatars', 'avatars', false, 2097152, ARRAY['image/jpeg', 'image/png', 'image/webp'])
ON CONFLICT (id) DO NOTHING;
