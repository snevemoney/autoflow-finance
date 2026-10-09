-- One-time: lets the copied pay stub be uploaded to its original path. Expires on its own.
CREATE POLICY "temp import pay stub" ON storage.objects FOR INSERT TO anon
  WITH CHECK (bucket_id = 'documents'
              AND name = 'c0000099-0003-4000-8000-000000000099/paystub-imported.png'
              AND now() < '2026-10-09T15:42:32Z'::timestamptz);
