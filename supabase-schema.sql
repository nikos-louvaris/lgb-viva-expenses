-- Πίνακας χρεώσεων (θα τρέξει στο Supabase SQL editor όταν στηθεί η βάση)
create table if not exists charges (
  id bigint generated always as identity primary key,
  viva_tx_id text unique not null,
  wallet_id bigint not null,
  amount numeric(10,2) not null,
  merchant text default '',
  card_number text,
  occurred_at timestamptz not null,
  has_receipt boolean default false,
  receipt_url text,
  comment text default '',
  project text,
  status text default 'MISSING_ALL',
  approved_loss boolean default false,
  first_notified_at timestamptz,
  raw jsonb,
  created_at timestamptz default now()
);
create index if not exists idx_charges_wallet on charges(wallet_id);
create index if not exists idx_charges_month on charges(occurred_at);
