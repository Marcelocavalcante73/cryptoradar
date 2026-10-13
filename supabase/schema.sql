-- CryptoRadar: armazenamento do estado do app (carteiras simuladas, histórico, sinais).
-- Rode uma vez no SQL Editor do Supabase. O servidor acessa com a chave "service_role" (nunca exposta ao navegador).

create table if not exists public.app_state (
  key        text primary key,
  value      jsonb  not null,
  saved_at   bigint not null,
  updated_at timestamptz not null default now()
);

-- Só o servidor (service_role) lê e escreve: com RLS ligada e sem políticas, a chave pública (anon) não acessa nada.
alter table public.app_state enable row level security;
