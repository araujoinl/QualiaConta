-- OPERACIÓN DESTRUCTIVA: NO
-- Este archivo no contiene operaciones destructivas.
--
-- Bucket privado para los espejos de ADM (jsonl) que consumen los detectores
-- serverless (F1). Separado de qualia-conta a propósito: aquel bucket es de
-- DOCUMENTOS de la mesa y restringe MIME; los espejos son datos internos.
-- Sin policies sobre storage.objects para este bucket: solo el service role
-- de las functions y el subidor del server (mismo service role) lo tocan.

insert into storage.buckets (id, name, public)
values ('qualia-espejos', 'qualia-espejos', false)
on conflict (id) do nothing;
